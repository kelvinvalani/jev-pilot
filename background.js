/**
 * Jev Fast — service worker orchestrator.
 * Extracts the live DOM, asks Jev (Choice + Noul) what to do next,
 * then dispatches native clicks/keystrokes in the page. No generated
 * code, no regex parsing of model output.
 */

const PROVIDERS = {
  beatapi: {
    id: "beatapi",
    name: "BeatAPI",
    endpoint: "https://api.beatapi.io/v1/systemone",
    model: "jev-1.13-free",
    rateNote: "Free BeatAPI allows 1 successful request per minute until you top up.",
  },
  typesafe: {
    id: "typesafe",
    name: "TypeSafe",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    rateNote: "",
  },
};
const MAX_STEPS = 15;
const CONFIDENCE_THRESHOLD = 0.6;
const DOM_SETTLE_MS = 300;
const JEV_TIMEOUT_MS = 12000;
const MAX_NONE_STREAK = 2;
const COMPLEX_TEXT_THRESHOLD = 0.7;
const LOG_LIMIT = 200;
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "https://chrome.google.com/",
  "https://chromewebstore.google.com/",
];

const session = {
  running: false,
  paused: false,
  finished: false,
  lastError: "",
  step: 0,
  tabId: null,
  goal: "",
  apiKey: "",
  provider: PROVIDERS.beatapi,
  logs: [],
  pendingConfirmation: null,
  pendingAction: null,
  lastResult: "",
  noneStreak: 0,
  generation: 0,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse(result))
    .catch((err) => {
      log("error", String(err && err.message ? err.message : err));
      sendResponse(publicState());
    });
  return true;
});

async function handleMessage(message) {
  const type = message && message.type;
  if (type === "GET_STATUS") return publicState();
  if (type === "CLEAR_LOG") {
    session.logs = [];
    broadcast();
    return publicState();
  }
  if (type === "STOP") {
    stopRun("Stopped.");
    return publicState();
  }
  if (type === "START") {
    await startRun(message.apiKey, message.goal, message.provider);
    return publicState();
  }
  if (type === "CONFIRM") {
    await confirmPending(message.textValue);
    return publicState();
  }
  if (type === "SKIP") {
    await skipPending();
    return publicState();
  }
  return publicState();
}

async function startRun(apiKey, goal, providerId) {
  const key = String(apiKey || "").trim();
  const userGoal = String(goal || "").trim();
  const provider = PROVIDERS[providerId] || PROVIDERS.beatapi;
  if (!key) throw new Error(provider.name + " API key is required.");
  if (!userGoal) throw new Error("User goal is required.");

  const tab = await getActiveHttpTab();
  session.generation += 1;
  session.running = true;
  session.paused = false;
  session.finished = false;
  session.lastError = "";
  session.step = 0;
  session.tabId = tab.id;
  session.goal = userGoal;
  session.apiKey = key;
  session.provider = provider;
  session.logs = [];
  session.pendingConfirmation = null;
  session.pendingAction = null;
  session.lastResult = "";
  session.noneStreak = 0;

  log(
    "system",
    "Started on " +
      (tab.url || "active tab") +
      " via " +
      provider.name +
      " (" +
      provider.model +
      ") — max " +
      MAX_STEPS +
      " steps."
  );
  if (provider.rateNote) log("warn", provider.rateNote);
  broadcast();
  queueMicrotask(() => runLoop(session.generation));
}

function stopRun(reason) {
  session.running = false;
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  if (reason) log("warn", reason);
  broadcast();
}

function finishRun(reason) {
  session.running = false;
  session.paused = false;
  session.finished = true;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  log("done", reason || "Finished.");
  broadcast();
}

async function runLoop(generation) {
  while (session.running && !session.paused && generation === session.generation) {
    if (session.step >= MAX_STEPS) {
      finishRun("Reached max_steps (" + MAX_STEPS + ").");
      return;
    }
    session.step += 1;
    broadcast();
    try {
      const continued = await runOneStep(generation);
      if (!continued) return;
    } catch (err) {
      session.lastError = String(err && err.message ? err.message : err);
      session.running = false;
      session.paused = false;
      log("error", session.lastError);
      broadcast();
      return;
    }
  }
}

async function runOneStep(generation) {
  const tabId = session.tabId;
  await ensureContentScript(tabId);
  await waitForTabReady(tabId);

  const snapshot = await sendToTab(tabId, { type: "EXTRACT" });
  if (!snapshot || !snapshot.ok) {
    throw new Error((snapshot && snapshot.error) || "Failed to extract interactive elements.");
  }

  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  const currentUrl = snapshot.url || "";
  const pageTitle = snapshot.title || "";
  const candidates = extractTextCandidates(session.goal);

  log(
    "system",
    "[Step " + session.step + "] Extracted " + elements.length + " interactive element" + (elements.length === 1 ? "" : "s") + "."
  );

  const body = buildJevRequest({
    goal: session.goal,
    currentUrl,
    pageTitle,
    elements,
    candidates,
    lastResult: session.lastResult,
    step: session.step,
  });

  const started = performance.now();
  const jev = await callJev(session.apiKey, body);
  const latencyMs = Math.round(performance.now() - started);

  const answers = jev.answers || {};
  const targetAnswer = answers.target_element_id;
  const actionAnswer = answers.action_type;
  const complexAnswer = answers.requires_complex_text;
  const textAnswer = answers.text_candidate;

  if (!targetAnswer || targetAnswer.type !== "choice") {
    throw new Error("Jev did not return a typed Choice for target_element_id.");
  }
  if (!actionAnswer || actionAnswer.type !== "choice") {
    throw new Error("Jev did not return a typed Choice for action_type.");
  }

  const targetId = targetAnswer.choice;
  const actionType = actionAnswer.choice;
  const confidence =
    typeof targetAnswer.confidence === "number" ? targetAnswer.confidence : 0;
  const complexNoul =
    complexAnswer && typeof complexAnswer.noul === "number" ? complexAnswer.noul : 0;
  const textChoice = textAnswer && textAnswer.type === "choice" ? textAnswer.choice : "none";

  const actionLabel = String(actionType || "unknown").toUpperCase();
  log(
    "action",
    formatStepLog(session.step, actionLabel, targetId, confidence, latencyMs)
  );

  if (actionType === "finish") {
    finishRun("Jev reported the goal is complete.");
    return false;
  }

  if (targetId === "none_applicable") {
    session.noneStreak += 1;
    log("warn", "Jev chose none_applicable (streak " + session.noneStreak + ").");
    if (session.noneStreak >= MAX_NONE_STREAK) {
      finishRun("No matching element on the page. Stopping.");
      return false;
    }
    await sleep(DOM_SETTLE_MS);
    return generation === session.generation && session.running;
  }

  session.noneStreak = 0;

  let textValue = "";
  if (actionType === "type") {
    if (textChoice && textChoice !== "none" && candidates[textChoice]) {
      textValue = candidates[textChoice];
    }
    const needsComplex = complexNoul >= COMPLEX_TEXT_THRESHOLD;
    const missingText = !textValue;
    if (needsComplex || missingText) {
      const reason = needsComplex ? "complex_text" : "text";
      const message = needsComplex
        ? "Typing this field looks like it needs written language. Confirm or edit the text, then continue."
        : "Jev wants to type into " + targetId + " but did not pick a value from the goal. Enter the text to type.";
      pauseForConfirmation({
        reason,
        message:
          message +
          " Proposed " +
          actionLabel +
          " on " +
          targetId +
          " (confidence " +
          confidence.toFixed(2) +
          ").",
        suggestedText: textValue,
        targetId,
        actionType,
        textValue,
        confidence,
        latencyMs,
      });
      return false;
    }
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    pauseForConfirmation({
      reason: "confidence",
      message:
        "Jev confidence " +
        confidence.toFixed(2) +
        " is below 0.60. Proposed " +
        actionLabel +
        " on " +
        targetId +
        ". Confirm to execute.",
      suggestedText: textValue,
      targetId,
      actionType,
      textValue,
      confidence,
      latencyMs,
    });
    return false;
  }

  await dispatchAction(tabId, targetId, actionType, textValue);
  return generation === session.generation && session.running;
}

function pauseForConfirmation(payload) {
  session.paused = true;
  session.pendingAction = {
    targetId: payload.targetId,
    actionType: payload.actionType,
    textValue: payload.textValue || "",
  };
  session.pendingConfirmation = payload;
  log("warn", payload.message);
  broadcast();
}

async function confirmPending(textValue) {
  if (!session.running || !session.paused || !session.pendingAction) {
    return;
  }
  const action = session.pendingAction;
  if (textValue != null && String(textValue).length) {
    action.textValue = String(textValue);
  }
  if (action.actionType === "type" && !String(action.textValue || "").length) {
    log("warn", "No text provided. Skipping this step.");
    session.paused = false;
    session.pendingConfirmation = null;
    session.pendingAction = null;
    broadcast();
    const generation = session.generation;
    queueMicrotask(() => runLoop(generation));
    return;
  }
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  log("system", "Confirmed. Resuming.");
  broadcast();
  const generation = session.generation;
  try {
    await dispatchAction(session.tabId, action.targetId, action.actionType, action.textValue);
    if (session.running && generation === session.generation) {
      queueMicrotask(() => runLoop(generation));
    }
  } catch (err) {
    session.lastError = String(err && err.message ? err.message : err);
    session.running = false;
    log("error", session.lastError);
    broadcast();
  }
}

async function skipPending() {
  if (!session.running) return;
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  log("warn", "Skipped this step. Continuing.");
  broadcast();
  const generation = session.generation;
  await sleep(DOM_SETTLE_MS);
  if (session.running && generation === session.generation) {
    queueMicrotask(() => runLoop(generation));
  }
}

async function dispatchAction(tabId, targetId, actionType, textValue) {
  const result = await sendToTab(tabId, {
    type: "EXECUTE",
    targetId,
    actionType,
    textValue: textValue || "",
  });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || "Action execution failed.");
  }
  if (actionType === "type" && textValue) {
    session.lastResult = "Typed into " + targetId + ": " + clip(textValue, 80);
    log("system", session.lastResult);
  } else if (result.coerced === "click") {
    session.lastResult = "Coerced TYPE to CLICK on " + targetId;
    log("system", result.detail || session.lastResult);
  } else {
    session.lastResult = "Clicked " + targetId;
    log("system", session.lastResult);
  }
  await sleep(DOM_SETTLE_MS);
  await waitForTabReady(tabId);
  broadcast();
}

function buildJevRequest({ goal, currentUrl, pageTitle, elements, candidates, lastResult, step }) {
  const criteria = {};
  for (const el of elements) {
    criteria[el.id] = el.tag + " - " + el.label + " (" + el.type + ")";
  }
  criteria.none_applicable = "No visible element matches the goal";

  const questions = {
    target_element_id: {
      type: "choice",
      instructions:
        "Which element ID should be acted on next to fulfill the user goal? Pick none_applicable if nothing on this page is the right next control.",
      criteria,
    },
    action_type: {
      type: "choice",
      instructions: "What action should be taken on this element?",
      criteria: {
        click: "Click the element",
        type: "Input text into a field",
        finish: "Goal is completely achieved",
      },
    },
    requires_complex_text: {
      type: "noul",
      instructions:
        "Does typing into this element require complex natural language generation rather than a short value already present in the user goal?",
    },
  };

  const candidateKeys = Object.keys(candidates);
  if (candidateKeys.length) {
    const textCriteria = {};
    for (const key of candidateKeys) {
      textCriteria[key] = "Type exactly: " + candidates[key];
    }
    textCriteria.none = "None of these values should be typed";
    questions.text_candidate = {
      type: "choice",
      instructions:
        "If the next action is typing, which value taken from the user goal should be entered? Choose none if typing is not needed or the value is missing.",
      criteria: textCriteria,
    };
  }

  return {
    model: session.provider.model,
    state: {
      user_goal: goal,
      current_url: currentUrl,
      page_title: pageTitle,
      step,
      max_steps: MAX_STEPS,
      last_result: lastResult || "",
      interactive_elements: elements,
    },
    questions,
  };
}

async function callJev(apiKey, body, attempt) {
  const round = attempt || 0;
  const provider = session.provider || PROVIDERS.beatapi;
  let response;
  try {
    response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error("Jev request failed: " + (err && err.message ? err.message : err));
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 429 || response.status === 529) {
    if (round >= 4) {
      throw new Error("Jev is rate-limited or overloaded (HTTP " + response.status + ").");
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const fromHeader = Number(retryAfterHeader);
    const fromBody =
      payload && typeof payload.retry_after_seconds === "number" ? payload.retry_after_seconds : NaN;
    const seconds =
      Number.isFinite(fromHeader) && fromHeader > 0
        ? fromHeader
        : Number.isFinite(fromBody) && fromBody > 0
          ? fromBody
          : provider.id === "beatapi"
            ? 60
            : 0.4 * 2 ** round;
    const waitMs = Math.round(seconds * 1000);
    log("warn", "Jev HTTP " + response.status + " — retrying in " + waitMs + "ms.");
    await sleep(waitMs);
    return callJev(apiKey, body, round + 1);
  }

  if (response.status === 401) {
    throw new Error(
      provider.name +
        " rejected this API key (HTTP 401). A BeatAPI key only works with the BeatAPI provider, and a TypeSafe key only works with TypeSafe."
    );
  }
  if (!response.ok) {
    const detail =
      payload && (payload.error || payload.message || payload.detail)
        ? String(payload.error || payload.message || payload.detail)
        : "HTTP " + response.status;
    throw new Error("Jev API error: " + detail);
  }
  if (!payload || typeof payload !== "object" || !payload.answers) {
    throw new Error("Jev returned a response without an answers object.");
  }
  return payload;
}

function extractTextCandidates(goal) {
  const map = {};
  const seen = new Set();
  const skip = new Set(["the", "a", "an", "and", "or", "my", "me", "please"]);
  const add = (raw) => {
    const text = String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.,;:]+$/g, "");
    if (text.length < 2 || text.length > 80) return;
    if (skip.has(text.toLowerCase())) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    map["text_" + Object.keys(map).length] = text;
  };

  const quoted = goal.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/g);
  if (quoted) {
    for (const chunk of quoted) add(chunk.replace(/["'“”‘’]/g, ""));
  }

  const parts = String(goal || "").split(
    /\b(?:from|to|for|in|at|near|via|search(?:\s+for)?|flights?|type|enter|find|open|go to|and|then|with)\b/i
  );
  for (const part of parts) add(part);

  return map;
}

function formatStepLog(step, action, target, confidence, latencyMs) {
  return (
    "[Step " +
    step +
    "] Action: " +
    action +
    " | Target: " +
    target +
    " | Confidence: " +
    Number(confidence).toFixed(2) +
    " | Latency: " +
    latencyMs +
    "ms"
  );
}

async function getActiveHttpTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab found.");
  }
  const url = tab.url || "";
  if (RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    throw new Error("This tab cannot be automated. Open a regular http(s) page and try again.");
  }
  if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file:")) {
    throw new Error("The active tab is not an http(s) page.");
  }
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const ping = await sendToTab(tabId, { type: "PING" });
    if (ping && ping.ok) return;
  } catch {
    // Not injected yet.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function waitForTabReady(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error("The target tab was closed.");
  }
  if (tab.status === "complete") return;

  await new Promise((resolve) => {
    const timeout = setTimeout(finish, 8000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    function finish() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function log(level, text) {
  session.logs.push({ level, text, ts: Date.now() });
  if (session.logs.length > LOG_LIMIT) {
    session.logs = session.logs.slice(-LOG_LIMIT);
  }
}

function publicState() {
  return {
    running: session.running,
    paused: session.paused,
    finished: session.finished,
    lastError: session.lastError,
    step: session.step,
    logs: session.logs.slice(),
    pendingConfirmation: session.pendingConfirmation,
  };
}

function broadcast() {
  const state = publicState();
  try {
    chrome.runtime.sendMessage({ type: "STATE", state }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Popup may be closed.
  }
  return state;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}
