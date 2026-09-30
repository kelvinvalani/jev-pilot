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
    rateNote: "Free BeatAPI keys allow 1 successful request per minute until you top up.",
    defaultRetrySeconds: 60,
  },
  typesafe: {
    id: "typesafe",
    name: "TypeSafe",
    endpoint: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    rateNote: "",
    defaultRetrySeconds: 0,
  },
};
const MAX_STEPS = 15;
const CONFIDENCE_THRESHOLD = 0.6;
const DOM_SETTLE_MS = 300;
const JEV_TIMEOUT_MS = 12000;
const MAX_NONE_STREAK = 2;
const COMPLEX_TEXT_THRESHOLD = 0.7;
const LOG_LIMIT = 200;
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_SERVER_RETRIES = 2;
const KEEPALIVE_INTERVAL_MS = 20000;
const EXTRACT_ATTEMPTS = 3;
const ACTION_TYPES = ["click", "type", "finish"];
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:",
  "https://chrome.google.com/webstore",
  "https://chromewebstore.google.com/",
];

class JevApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "JevApiError";
    this.status = status;
    this.code = code || "";
  }
}

class RunCancelled extends Error {
  constructor() {
    super("Run cancelled.");
    this.name = "RunCancelled";
  }
}

const session = {
  running: false,
  paused: false,
  finished: false,
  lastError: "",
  step: 0,
  tabId: null,
  tabUrl: "",
  tabTitle: "",
  goal: "",
  apiKey: "",
  provider: PROVIDERS.beatapi,
  resolvedModel: "",
  logs: [],
  pendingConfirmation: null,
  pendingAction: null,
  lastResult: "",
  noneStreak: 0,
  generation: 0,
  waitingUntil: 0,
  waitReason: "",
  minIntervalMs: 0,
  lastRequestAt: 0,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !isControlMessage(message.type)) return false;
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((err) => {
      session.lastError = errorText(err);
      log("error", session.lastError);
      sendResponse(broadcast());
    });
  return true;
});

function isControlMessage(type) {
  return ["GET_STATUS", "CLEAR_LOG", "STOP", "START", "CONFIRM", "SKIP"].includes(type);
}

async function handleMessage(message, sender) {
  const type = message.type;
  if (type === "GET_STATUS") return publicState();
  if (type === "CLEAR_LOG") {
    session.logs = [];
    if (!session.running) {
      session.finished = false;
      session.lastError = "";
    }
    return broadcast();
  }
  if (type === "STOP") {
    stopRun("Stopped by you.");
    return publicState();
  }
  if (type === "START") {
    await startRun(message.apiKey, message.goal, message.provider, sender && sender.tab);
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

async function startRun(apiKey, goal, providerId, senderTab) {
  const key = String(apiKey || "").trim();
  const userGoal = String(goal || "").trim();
  const provider = PROVIDERS[providerId] || PROVIDERS.beatapi;
  if (!key) throw new Error("Add your " + provider.name + " API key in Settings first.");
  if (!userGoal) throw new Error("Describe what Jev should do first.");
  if (session.running) throw new Error("A task is already running. Stop it before starting another.");

  const tab = await resolveTargetTab(senderTab);
  const sameProvider = session.provider && session.provider.id === provider.id && session.apiKey === key;
  session.generation += 1;
  session.running = true;
  session.paused = false;
  session.finished = false;
  session.lastError = "";
  session.step = 0;
  session.tabId = tab.id;
  session.tabUrl = tab.url || "";
  session.tabTitle = tab.title || "";
  session.goal = userGoal;
  session.apiKey = key;
  session.provider = provider;
  session.resolvedModel = "";
  session.logs = [];
  session.pendingConfirmation = null;
  session.pendingAction = null;
  session.lastResult = "";
  session.noneStreak = 0;
  session.waitingUntil = 0;
  session.waitReason = "";
  if (!sameProvider) {
    session.minIntervalMs = 0;
    session.lastRequestAt = 0;
  }

  log(
    "system",
    "Started on " +
      (tab.title || tab.url || "the active tab") +
      " via " +
      provider.name +
      " (" +
      provider.model +
      ") — max " +
      MAX_STEPS +
      " steps.",
    { kind: "start" }
  );
  if (provider.rateNote) log("info", provider.rateNote);
  broadcast();
  const generation = session.generation;
  queueMicrotask(() => runLoop(generation));
}

function stopRun(reason) {
  const wasRunning = session.running;
  session.generation += 1;
  session.running = false;
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  session.waitingUntil = 0;
  session.waitReason = "";
  if (reason && wasRunning) log("warn", reason, { kind: "stopped" });
  broadcast();
}

function finishRun(reason) {
  session.running = false;
  session.paused = false;
  session.finished = true;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  session.waitingUntil = 0;
  session.waitReason = "";
  log("done", reason || "Finished.", { kind: "finish" });
  broadcast();
}

function failRun(err) {
  session.lastError = errorText(err);
  session.running = false;
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  session.waitingUntil = 0;
  session.waitReason = "";
  log("error", session.lastError, { kind: "error" });
  broadcast();
}

function isCurrent(generation) {
  return session.running && generation === session.generation;
}

async function runLoop(generation) {
  while (isCurrent(generation) && !session.paused) {
    if (session.step >= MAX_STEPS) {
      finishRun("Reached the " + MAX_STEPS + "-step limit before Jev reported the goal complete.");
      return;
    }
    session.step += 1;
    broadcast();
    try {
      const continued = await runOneStep(generation);
      if (!continued) return;
    } catch (err) {
      if (err instanceof RunCancelled || !isCurrent(generation)) return;
      failRun(err);
      return;
    }
  }
}

async function runOneStep(generation) {
  const tabId = session.tabId;
  const snapshot = await extractSnapshot(tabId, generation);

  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  const elementsById = new Map(elements.map((el) => [el.id, el]));
  const currentUrl = snapshot.url || "";
  const pageTitle = snapshot.title || "";
  session.tabUrl = currentUrl || session.tabUrl;
  session.tabTitle = pageTitle || session.tabTitle;
  const candidates = extractTextCandidates(session.goal);

  log(
    "system",
    "[Step " +
      session.step +
      "] Extracted " +
      elements.length +
      " interactive element" +
      (elements.length === 1 ? "" : "s") +
      ".",
    { kind: "extract", step: session.step, count: elements.length }
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

  const { payload: jev, latencyMs } = await callJev(session.apiKey, body, generation);
  if (!isCurrent(generation)) return false;
  if (jev.model && !session.resolvedModel) session.resolvedModel = String(jev.model);

  const decision = readDecision(jev.answers, body.questions);
  const { targetId, actionType, confidence, complexNoul, textChoice } = decision;
  const actionLabel = actionType.toUpperCase();
  const target = elementsById.get(targetId);
  const targetLabel = target ? target.label : targetId === "none_applicable" ? "No matching element" : targetId;

  let textValue = "";
  if (actionType === "type" && textChoice && textChoice !== "none" && candidates[textChoice]) {
    textValue = candidates[textChoice];
  }

  log("action", formatStepLog(session.step, actionLabel, targetId, confidence, latencyMs), {
    kind: "step",
    step: session.step,
    action: actionType,
    targetId,
    targetLabel,
    targetType: target ? target.type : "",
    confidence,
    latencyMs,
    textValue,
  });

  if (actionType === "finish") {
    finishRun("Jev reported the goal is complete.");
    return false;
  }

  if (targetId === "none_applicable") {
    session.noneStreak += 1;
    log("warn", "Jev found no matching element on this page (" + session.noneStreak + "/" + MAX_NONE_STREAK + ").");
    if (session.noneStreak >= MAX_NONE_STREAK) {
      finishRun("Stopped: Jev could not find a matching element on the page.");
      return false;
    }
    await sleep(DOM_SETTLE_MS, generation);
    return isCurrent(generation);
  }

  session.noneStreak = 0;

  const base = {
    targetId,
    targetLabel,
    actionType,
    textValue,
    confidence,
    latencyMs,
    step: session.step,
  };

  if (actionType === "type") {
    const needsComplex = complexNoul >= COMPLEX_TEXT_THRESHOLD;
    if (needsComplex || !textValue) {
      const message = needsComplex
        ? "This field looks like it needs written text. Check or edit what Jev should type, then continue."
        : "Jev wants to type into “" + targetLabel + "” but could not pick a value from your goal. Enter the text to type.";
      pauseForConfirmation({
        ...base,
        reason: needsComplex ? "complex_text" : "text",
        title: needsComplex ? "Review the text to type" : "What should Jev type?",
        message,
        suggestedText: textValue,
      });
      return false;
    }
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    pauseForConfirmation({
      ...base,
      reason: "confidence",
      title: "Low confidence — review this step",
      message:
        "Jev is " +
        Math.round(confidence * 100) +
        "% confident about this step, below the " +
        Math.round(CONFIDENCE_THRESHOLD * 100) +
        "% auto-run threshold.",
      suggestedText: textValue,
    });
    return false;
  }

  await dispatchAction(tabId, targetId, actionType, textValue, targetLabel, generation);
  return isCurrent(generation);
}

function readDecision(answers, questions) {
  if (!answers || typeof answers !== "object") {
    throw new Error("Jev returned a response without an answers object.");
  }
  const targetAnswer = answers.target_element_id;
  const actionAnswer = answers.action_type;
  if (!targetAnswer || targetAnswer.type !== "choice" || typeof targetAnswer.choice !== "string") {
    throw new Error("Jev did not return a typed Choice for target_element_id.");
  }
  if (!actionAnswer || actionAnswer.type !== "choice" || typeof actionAnswer.choice !== "string") {
    throw new Error("Jev did not return a typed Choice for action_type.");
  }
  const targetId = targetAnswer.choice;
  if (!Object.prototype.hasOwnProperty.call(questions.target_element_id.criteria, targetId)) {
    throw new Error("Jev picked “" + targetId + "”, which is not an element on this page.");
  }
  const actionType = actionAnswer.choice.toLowerCase();
  if (!ACTION_TYPES.includes(actionType)) {
    throw new Error("Jev returned an unsupported action “" + actionAnswer.choice + "”.");
  }

  const complexAnswer = answers.requires_complex_text;
  const textAnswer = answers.text_candidate;
  const textCriteria = questions.text_candidate ? questions.text_candidate.criteria : {};
  let textChoice = "none";
  if (
    textAnswer &&
    textAnswer.type === "choice" &&
    typeof textAnswer.choice === "string" &&
    Object.prototype.hasOwnProperty.call(textCriteria, textAnswer.choice)
  ) {
    textChoice = textAnswer.choice;
  }

  return {
    targetId,
    actionType,
    confidence: choiceConfidence(targetAnswer),
    complexNoul: complexAnswer && complexAnswer.type === "noul" ? probability(complexAnswer.noul) : 0,
    textChoice,
  };
}

function choiceConfidence(answer) {
  if (typeof answer.confidence === "number" && Number.isFinite(answer.confidence)) {
    return probability(answer.confidence);
  }
  const probs = answer.probabilities;
  if (probs && typeof probs[answer.choice] === "number") {
    return probability(probs[answer.choice]);
  }
  return 0;
}

function probability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function pauseForConfirmation(payload) {
  session.paused = true;
  session.pendingAction = {
    targetId: payload.targetId,
    targetLabel: payload.targetLabel,
    actionType: payload.actionType,
    textValue: payload.textValue || "",
  };
  session.pendingConfirmation = payload;
  log("warn", payload.title + ": " + payload.message, { kind: "review", step: payload.step });
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
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  const generation = session.generation;
  if (action.actionType === "type" && !String(action.textValue || "").length) {
    log("warn", "No text provided, so this step was skipped.");
    broadcast();
    queueMicrotask(() => runLoop(generation));
    return;
  }
  log("system", "Confirmed. Resuming.");
  broadcast();
  try {
    await dispatchAction(
      session.tabId,
      action.targetId,
      action.actionType,
      action.textValue,
      action.targetLabel,
      generation
    );
    if (isCurrent(generation)) {
      queueMicrotask(() => runLoop(generation));
    }
  } catch (err) {
    if (err instanceof RunCancelled || !isCurrent(generation)) return;
    failRun(err);
  }
}

async function skipPending() {
  if (!session.running || !session.paused) return;
  session.paused = false;
  session.pendingConfirmation = null;
  session.pendingAction = null;
  log("warn", "Skipped this step. Continuing.");
  broadcast();
  const generation = session.generation;
  try {
    await sleep(DOM_SETTLE_MS, generation);
  } catch {
    return;
  }
  if (isCurrent(generation)) {
    queueMicrotask(() => runLoop(generation));
  }
}

async function extractSnapshot(tabId, generation) {
  let lastError = null;
  for (let attempt = 0; attempt < EXTRACT_ATTEMPTS; attempt += 1) {
    if (!isCurrent(generation)) throw new RunCancelled();
    try {
      await waitForTabReady(tabId);
      await ensureContentScript(tabId);
      const snapshot = await sendToTab(tabId, { type: "EXTRACT" });
      if (snapshot && snapshot.ok) return snapshot;
      lastError = new Error((snapshot && snapshot.error) || "Could not read the page.");
    } catch (err) {
      if (err && err.fatal) throw err;
      lastError = err;
    }
    await sleep(500 * (attempt + 1), generation);
  }
  throw new Error("Could not read the page: " + errorText(lastError));
}

async function dispatchAction(tabId, targetId, actionType, textValue, targetLabel, generation) {
  if (!isCurrent(generation)) throw new RunCancelled();
  const result = await sendToTab(tabId, {
    type: "EXECUTE",
    targetId,
    actionType,
    textValue: textValue || "",
  });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || "The page did not accept the action.");
  }
  const label = targetLabel || targetId;
  if (actionType === "type" && textValue && !result.coerced) {
    session.lastResult = "Typed into " + targetId + ": " + clip(textValue, 80);
    log("system", "Typed “" + clip(textValue, 80) + "” into " + clip(label, 60) + ".", { kind: "result" });
  } else if (result.coerced === "click") {
    session.lastResult = "Coerced TYPE to CLICK on " + targetId;
    log("system", "That element can't take text, so Jev clicked “" + clip(label, 60) + "” instead.", {
      kind: "result",
    });
  } else {
    session.lastResult = "Clicked " + targetId;
    log("system", "Clicked “" + clip(label, 60) + "”.", { kind: "result" });
  }
  broadcast();
  await sleep(DOM_SETTLE_MS, generation);
  await waitForTabReady(tabId);
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

async function callJev(apiKey, body, generation) {
  const provider = session.provider || PROVIDERS.beatapi;
  let rateLimitRetries = 0;
  let serverRetries = 0;

  for (;;) {
    await paceRequests(generation);
    if (!isCurrent(generation)) throw new RunCancelled();

    const started = performance.now();
    session.lastRequestAt = Date.now();
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
      if (!isCurrent(generation)) throw new RunCancelled();
      const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
      if (serverRetries < MAX_SERVER_RETRIES) {
        serverRetries += 1;
        log("warn", (timedOut ? "Jev timed out" : "Network error reaching Jev") + " — retrying (" + serverRetries + "/" + MAX_SERVER_RETRIES + ").");
        await waitWithStatus(1000 * serverRetries, "Retrying after a network error", generation);
        continue;
      }
      throw new JevApiError(
        timedOut
          ? "Jev did not respond within " + JEV_TIMEOUT_MS / 1000 + "s. Check your connection and try again."
          : "Could not reach " + provider.name + ": " + errorText(err),
        0,
        timedOut ? "timeout" : "network"
      );
    }
    const latencyMs = Math.round(performance.now() - started);
    if (!isCurrent(generation)) throw new RunCancelled();

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const apiError = readApiError(payload);

    if (response.status === 429 || response.status === 529) {
      if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
        throw new JevApiError(
          provider.name + " is still rate-limiting requests (HTTP " + response.status + "). Try again in a minute.",
          response.status,
          apiError.code
        );
      }
      const seconds = retryAfterSeconds(response, apiError, provider, rateLimitRetries);
      rateLimitRetries += 1;
      if (response.status === 429 && seconds >= 1) {
        session.minIntervalMs = Math.max(session.minIntervalMs, Math.round(seconds * 1000));
      }
      log(
        "warn",
        (response.status === 429 ? provider.name + " rate limit reached" : "Jev is overloaded") +
          " — waiting " +
          formatSeconds(seconds) +
          " before retrying.",
        { kind: "wait" }
      );
      await waitWithStatus(Math.round(seconds * 1000), "Waiting for the " + provider.name + " rate limit", generation);
      continue;
    }

    if (response.status >= 500 && serverRetries < MAX_SERVER_RETRIES && apiError.retryable !== false) {
      serverRetries += 1;
      log("warn", "Jev server error (HTTP " + response.status + ") — retrying (" + serverRetries + "/" + MAX_SERVER_RETRIES + ").");
      await waitWithStatus(1000 * serverRetries, "Retrying after a server error", generation);
      continue;
    }

    if (!response.ok) {
      throw new JevApiError(describeHttpError(response.status, apiError, provider), response.status, apiError.code);
    }
    if (!payload || typeof payload !== "object" || !payload.answers) {
      throw new JevApiError("Jev returned a response without an answers object.", response.status, "bad_response");
    }
    return { payload, latencyMs };
  }
}

async function paceRequests(generation) {
  if (!session.minIntervalMs || !session.lastRequestAt) return;
  const waitMs = session.lastRequestAt + session.minIntervalMs - Date.now();
  if (waitMs > 0) {
    await waitWithStatus(waitMs, "Pacing requests for the " + session.provider.name + " rate limit", generation);
  }
}

async function waitWithStatus(ms, reason, generation) {
  session.waitingUntil = Date.now() + ms;
  session.waitReason = reason;
  broadcast();
  try {
    await sleep(ms, generation);
  } finally {
    if (generation === session.generation) {
      session.waitingUntil = 0;
      session.waitReason = "";
      broadcast();
    }
  }
}

function readApiError(payload) {
  const out = { message: "", code: "", retryable: undefined, retryAfter: NaN };
  if (!payload || typeof payload !== "object") return out;
  const err = payload.error;
  if (err && typeof err === "object") {
    out.message = String(err.message || err.detail || "");
    out.code = String(err.code || err.type || "");
    if (typeof err.retryable === "boolean") out.retryable = err.retryable;
    if (typeof err.retry_after_seconds === "number") out.retryAfter = err.retry_after_seconds;
  } else if (typeof err === "string") {
    out.message = err;
  }
  if (!out.message && (payload.message || payload.detail)) {
    const detail = payload.message || payload.detail;
    out.message = typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  if (!out.code && typeof payload.code === "string") out.code = payload.code;
  if (!Number.isFinite(out.retryAfter) && typeof payload.retry_after_seconds === "number") {
    out.retryAfter = payload.retry_after_seconds;
  }
  return out;
}

function retryAfterSeconds(response, apiError, provider, attempt) {
  const fromHeader = Number(response.headers.get("retry-after"));
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  if (Number.isFinite(apiError.retryAfter) && apiError.retryAfter > 0) return apiError.retryAfter;
  if (response.status === 429 && provider.defaultRetrySeconds) return provider.defaultRetrySeconds;
  return 0.4 * 2 ** attempt;
}

function describeHttpError(status, apiError, provider) {
  const detail = apiError.message ? " (" + apiError.message + ")" : "";
  if (status === 401) {
    return (
      provider.name +
      " rejected this API key (HTTP 401). Check the key in Settings — BeatAPI keys only work with BeatAPI, and TypeSafe keys only work with TypeSafe."
    );
  }
  if (status === 402) {
    return provider.name + " says the account is out of credits (HTTP 402). Top up, or switch to the free BeatAPI model." + detail;
  }
  if (status === 403) {
    return provider.name + " refused the request (HTTP 403). The account may be inactive." + detail;
  }
  if (status === 404) {
    return provider.name + " does not recognise model “" + provider.model + "” (HTTP 404)." + detail;
  }
  if (status === 400 || status === 422) {
    return "Jev rejected the request (HTTP " + status + ")" + detail + ".";
  }
  return "Jev API error (HTTP " + status + ")" + detail + ".";
}

function extractTextCandidates(goal) {
  const map = {};
  const seen = new Set();
  const skip = new Set(["the", "a", "an", "and", "or", "my", "me", "please"]);
  const add = (raw) => {
    const text = String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    if (text.length < 2 || text.length > 80) return;
    if (skip.has(text.toLowerCase())) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    map["text_" + Object.keys(map).length] = text;
  };

  const quoted = goal.match(/["“‘][^"“”‘’]+["”’]/g);
  if (quoted) {
    for (const chunk of quoted) add(chunk.replace(/["'“”‘’]/g, ""));
  }

  const parts = String(goal || "").split(
    /\b(?:from|to|for|in|at|near|via|search(?:\s+for)?|flights?|type|enter|find|open|go to|and|then|with)\b/i
  );
  for (const part of parts) add(part.replace(/["“”‘’]/g, ""));

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

async function resolveTargetTab(senderTab) {
  let tab = senderTab && typeof senderTab.id === "number" ? senderTab : null;
  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0];
  }
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab found.");
  }
  const url = tab.url || "";
  if (RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    throw new Error("Chrome doesn't allow extensions to control this page. Open a regular website and try again.");
  }
  if (url && !url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file:")) {
    throw new Error("Jev can only run on regular http(s) pages.");
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
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    const message = errorText(err);
    if (/cannot access|cannot be scripted|extensions gallery|permission/i.test(message)) {
      const fatal = new Error("Chrome doesn't allow Jev to access this page (" + message + ").");
      fatal.fatal = true;
      throw fatal;
    }
    throw err;
  }
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (/No tab with id/i.test(err.message || "")) {
          const closed = new Error("The tab Jev was working on was closed.");
          closed.fatal = true;
          reject(closed);
          return;
        }
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
    const err = new Error("The tab Jev was working on was closed.");
    err.fatal = true;
    throw err;
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

function log(level, text, meta) {
  session.logs.push({ level, text, ts: Date.now(), ...(meta || {}) });
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
    maxSteps: MAX_STEPS,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    goal: session.goal,
    provider: session.provider ? session.provider.id : "",
    providerName: session.provider ? session.provider.name : "",
    model: session.resolvedModel || (session.provider ? session.provider.model : ""),
    tabId: session.tabId,
    tabTitle: session.tabTitle,
    tabUrl: session.tabUrl,
    waitingUntil: session.waitingUntil,
    waitReason: session.waitReason,
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
    // No extension pages are open.
  }
  if (typeof session.tabId === "number") {
    try {
      chrome.tabs.sendMessage(
        session.tabId,
        {
          type: "JEV_FAST_STATUS",
          status: {
            running: state.running,
            paused: state.paused,
            finished: state.finished,
            error: Boolean(state.lastError),
          },
        },
        { frameId: 0 },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // Tab may be gone.
    }
  }
  return state;
}

function sleep(ms, generation) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    let timer = 0;
    const tick = () => {
      if (generation !== undefined && generation !== session.generation) {
        reject(new RunCancelled());
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        resolve();
        return;
      }
      if (ms > KEEPALIVE_INTERVAL_MS) keepAlive();
      timer = setTimeout(tick, Math.min(remaining, generation === undefined ? remaining : 1000));
    };
    timer = setTimeout(tick, Math.min(ms, generation === undefined ? ms : 1000));
    void timer;
  });
}

function keepAlive() {
  try {
    chrome.runtime.getPlatformInfo(() => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Best effort; extension API calls reset the service worker idle timer.
  }
}

function formatSeconds(seconds) {
  if (seconds < 1) return Math.round(seconds * 1000) + "ms";
  return Math.round(seconds) + "s";
}

function errorText(err) {
  if (!err) return "Unknown error";
  return String(err.message || err);
}

function clip(text, max) {
  const value = String(text || "");
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}
