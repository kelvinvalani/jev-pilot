/**
 * Jev Fill — service worker.
 * Owns the profile, one Jev request per fill, alias matching, confident writes,
 * checks, stop, and undo. The page script lists fields and writes values.
 */

const PROVIDERS = {
  beatapi: {
    id: "beatapi",
    name: "BeatAPI",
    endpoint: "https://api.beatapi.io/v1/systemone",
    model: "jev-1.14-free",
    rateNote: "Free BeatAPI calls are limited to 1 successful request per minute before your first top-up, and 10 per minute after.",
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

const CONFIDENCE_THRESHOLD = 0.85;
const JEV_TIMEOUT_MS = 12000;
const LOG_LIMIT = 200;
const MAX_RATE_LIMIT_RETRIES = 4;
const MAX_SERVER_RETRIES = 2;
const MAX_HTTP_5XX_RETRIES = 1;
const KEEPALIVE_INTERVAL_MS = 20000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const PROFILE_KEY = "jevProfile";
const STARTER_SLOTS = [
  "legal first name",
  "family name",
  "personal email",
  "phone",
  "street address",
  "city",
  "region",
  "postcode",
  "country",
];
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
    super("Fill cancelled.");
    this.name = "RunCancelled";
  }
}

const session = {
  running: false,
  finished: false,
  lastError: "",
  tabId: null,
  tabUrl: "",
  tabTitle: "",
  apiKey: "",
  provider: PROVIDERS.beatapi,
  endpoint: PROVIDERS.beatapi.endpoint,
  resolvedModel: "",
  logs: [],
  check: null,
  undoAvailable: false,
  openSettings: false,
  generation: 0,
  waitingUntil: 0,
  waitReason: "",
  minIntervalMs: 0,
  lastRequestAt: 0,
  profile: null,
  pendingChecks: [],
  fillGeneration: 0,
  focusedSelector: null,
  /** @type {{ tabId: number|null, selector: string|null }} */
  capturedFocus: { tabId: null, selector: null },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  if (message.type === "FOCUS_CAPTURE") {
    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;
    session.capturedFocus = {
      tabId,
      selector: message.focusedSelector ? String(message.focusedSelector) : null,
    };
    sendResponse({ ok: true });
    return false;
  }
  if (!isControlMessage(message.type)) return false;
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
  return ["GET_STATUS", "CLEAR_LOG", "STOP", "FILL", "SKIP", "RESOLVE_CHECK", "UNDO"].includes(type);
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
    stopFill("Stopped by you.");
    return publicState();
  }
  if (type === "SKIP") {
    await skipCheck();
    return publicState();
  }
  if (type === "RESOLVE_CHECK") {
    await resolveCheck(message);
    return publicState();
  }
  if (type === "FILL") {
    await startFill(message.apiKey, message.provider, sender && sender.tab, message.endpoint, message.focusedSelector);
    return publicState();
  }
  if (type === "UNDO") {
    // Undo persistence lands in a later ticket.
    return publicState();
  }
  return publicState();
}

async function startFill(apiKey, providerId, senderTab, endpointOverride, focusedSelector) {
  const key = String(apiKey || "").trim();
  const provider = PROVIDERS[providerId] || PROVIDERS.beatapi;
  const endpoint = resolveEndpoint(provider, endpointOverride);
  session.openSettings = false;
  if (!key) {
    session.openSettings = true;
    session.lastError = "Add your " + provider.name + " API key in Settings first.";
    log("error", session.lastError);
    broadcast();
    return;
  }
  if (session.running || session.check) {
    throw new Error("A fill is already in progress. Stop it before starting another.");
  }

  const tab = await resolveTargetTab(senderTab);
  const sameProvider =
    session.provider && session.provider.id === provider.id && session.apiKey === key && session.endpoint === endpoint;
  session.generation += 1;
  const generation = session.generation;
  session.running = true;
  session.finished = false;
  session.lastError = "";
  session.tabId = tab.id;
  session.tabUrl = tab.url || "";
  session.tabTitle = tab.title || "";
  session.apiKey = key;
  session.provider = provider;
  session.endpoint = endpoint;
  session.resolvedModel = "";
  session.logs = [];
  session.check = null;
  session.pendingChecks = [];
  session.fillGeneration = generation;
  session.undoAvailable = false;
  session.waitingUntil = 0;
  session.waitReason = "";
  session.focusedSelector = resolveFocusedSelector(focusedSelector, tab.id);
  if (!sameProvider) {
    session.minIntervalMs = 0;
    session.lastRequestAt = 0;
  }

  log("system", "Fill started on " + (tab.title || tab.url || "the active tab") + " via " + provider.name + ".", {
    kind: "start",
  });
  if (endpoint !== provider.endpoint) log("info", "Using local test endpoint " + endpoint + " instead of " + provider.name + ".");
  else if (provider.rateNote) log("info", provider.rateNote);
  broadcast();

  try {
    await runFill(generation);
  } catch (err) {
    if (err instanceof RunCancelled || !isCurrent(generation)) return;
    failFill(err);
  }
}

function resolveFocusedSelector(fromMessage, tabId) {
  if (fromMessage != null && String(fromMessage).trim()) {
    session.capturedFocus = { tabId: null, selector: null };
    return String(fromMessage);
  }
  const captured = session.capturedFocus;
  if (captured && captured.tabId === tabId && captured.selector) {
    const selector = captured.selector;
    session.capturedFocus = { tabId: null, selector: null };
    return selector;
  }
  session.capturedFocus = { tabId: null, selector: null };
  return null;
}

async function runFill(generation) {
  await waitForTabReady(session.tabId);
  if (!isCurrent(generation)) return;
  await ensureContentScript(session.tabId);
  if (!isCurrent(generation)) return;

  const profile = await loadProfile();
  session.profile = profile;

  const listMessage = { type: "LIST_FORM" };
  if (session.focusedSelector) listMessage.focusedSelector = session.focusedSelector;
  const listed = await sendToTab(session.tabId, listMessage);
  if (!isCurrent(generation)) return;
  if (!listed || !listed.ok) throw new Error((listed && listed.error) || "Could not read the form on this page.");
  const fields = listed.fields || [];
  if (!fields.length) {
    finishFill("No empty fields to fill.");
    return;
  }

  const undecided = [];
  const checks = [];
  for (const field of fields) {
    if (!isCurrent(generation)) return;
    const local = matchAlias(profile, field);
    if (local && local.answer != null) {
      await writeAndRemember(field, local.answer, generation);
      continue;
    }
    if (local && local.slot && local.answer == null && local.situationId === undefined) {
      // Slot hit whose heading is not an alias waits for Jev.
      undecided.push(field);
      continue;
    }
    if (local && local.slot && local.answer == null) {
      checks.push(buildCheck(field, local.slot.id, local.situationId));
      continue;
    }
    undecided.push(field);
  }

  if (!undecided.length) {
    await saveProfile(profile);
    if (!isCurrent(generation)) return;
    if (checks.length) {
      beginChecks(checks, profile, generation);
      return;
    }
    finishFill("Filled from aliases.");
    return;
  }

  const body = buildFillRequest(undecided, profile);
  const { payload, latencyMs } = await callJev(session.apiKey, body, generation);
  if (!isCurrent(generation)) return;
  session.resolvedModel = payload.model || session.provider.model;
  log("info", "Jev answered in " + latencyMs + "ms.", { kind: "jev", latencyMs });

  for (const field of undecided) {
    if (!isCurrent(generation)) return;
    const answer = payload.answers && payload.answers[field.id];
    const outcome = await applyChoice(field, answer, profile, generation);
    if (outcome && outcome.check) checks.push(outcome.check);
  }

  await saveProfile(profile);
  if (!isCurrent(generation)) return;
  if (checks.length) {
    beginChecks(checks, profile, generation);
    return;
  }
  finishFill("Fill complete.");
}

async function applyChoice(field, answer, profile, generation) {
  const confidence = choiceConfidence(answer);
  const picked = answer && answer.type === "choice" ? String(answer.choice || "") : "";
  if (!picked || picked === "none" || confidence < CONFIDENCE_THRESHOLD) {
    const parsedLow = picked && picked !== "none" ? parseOptionKey(picked) : null;
    const slotId = parsedLow && parsedLow.kind !== "new" ? parsedLow.slotId : null;
    const situationId = parsedLow && parsedLow.kind === "situation" ? parsedLow.situationId : null;
    return { check: buildCheck(field, slotId, situationId) };
  }
  const parsed = parseOptionKey(picked);
  if (!parsed) {
    return { check: buildCheck(field, null, null) };
  }
  if (parsed.kind === "new") {
    // Situational answers land in a later ticket; a new-situation choice is a check.
    return { check: buildCheck(field, parsed.slotId, null) };
  }
  const slot = profile.slots.find((s) => s.id === parsed.slotId);
  if (!slot) {
    return { check: buildCheck(field, null, null) };
  }
  const stored = findAnswer(profile, parsed.slotId, parsed.situationId);
  if (!stored) {
    return { check: buildCheck(field, parsed.slotId, parsed.situationId) };
  }
  await writeAndRemember(field, stored.value, generation);
  addAlias(slot, field.wording);
  if (parsed.kind === "situation" && parsed.situationId && field.headingWording) {
    const situation = profile.situations.find((s) => s.id === parsed.situationId);
    if (situation) addAlias(situation, field.headingWording);
  }
  return null;
}

function buildCheck(field, preSelectedSlotId, preSelectedSituationId) {
  return {
    fieldId: field.id,
    wording: field.wording || "",
    headingWording: field.headingWording || "",
    preSelectedSlotId: preSelectedSlotId || null,
    preSelectedSituationId: preSelectedSituationId == null ? null : preSelectedSituationId,
    proposedSlotName: String(field.wording || "").trim(),
    optionRequired: false,
    optionLabels: [],
  };
}

function beginChecks(checks, profile, generation) {
  session.pendingChecks = checks.slice();
  session.profile = profile;
  session.fillGeneration = generation;
  session.running = true;
  openNextCheck();
}

function publicCheck(check, profile) {
  if (!check) return null;
  return {
    fieldId: check.fieldId,
    wording: check.wording,
    headingWording: check.headingWording,
    preSelectedSlotId: check.preSelectedSlotId,
    preSelectedSituationId: check.preSelectedSituationId,
    proposedSlotName: check.proposedSlotName,
    optionRequired: Boolean(check.optionRequired),
    optionLabels: Array.isArray(check.optionLabels) ? check.optionLabels.slice() : [],
    slots: (profile && profile.slots ? profile.slots : []).map((s) => ({ id: s.id, name: s.name })),
  };
}

function openNextCheck() {
  const next = session.pendingChecks.shift();
  if (!next) {
    session.check = null;
    finishFill("Fill complete.");
    return;
  }
  session.check = next;
  log("warn", "Check: “" + next.wording + "”.", { kind: "check" });
  broadcast();
}

async function skipCheck() {
  if (!session.check) return;
  const wording = session.check.wording;
  session.check = null;
  log("warn", "Skipped “" + wording + "”.", { kind: "skip" });
  openNextCheck();
}

async function resolveCheck(message) {
  if (!session.check) return;
  const generation = session.fillGeneration;
  if (!isCurrent(generation)) return;
  const check = session.check;
  let profile = session.profile || (await loadProfile());
  const answerText = String((message && message.answer) || "").trim();
  if (!answerText) {
    session.lastError = "Type an answer before saving this check.";
    broadcast();
    return;
  }

  const mintName = String((message && message.mintName) || "").trim();
  const slotId = String((message && message.slotId) || "").trim();
  let slot = null;

  if (!slotId) {
    const name = mintName || check.proposedSlotName || check.wording;
    if (!String(name || "").trim()) {
      session.lastError = "Name the new slot before saving.";
      broadcast();
      return;
    }
    slot = mintSlot(profile, name, check.wording);
  } else {
    slot = profile.slots.find((s) => s.id === slotId);
    if (!slot) {
      session.lastError = "That slot is no longer in the profile.";
      broadcast();
      return;
    }
    addAlias(slot, check.wording);
  }

  // Situations stay default-only until ticket 04.
  upsertAnswer(profile, slot.id, null, answerText);
  await saveProfile(profile);
  if (!isCurrent(generation)) return;

  await writeAndRemember({ id: check.fieldId, wording: check.wording }, answerText, generation);
  if (!isCurrent(generation)) return;

  session.lastError = "";
  session.check = null;
  log("system", "Saved check for “" + check.wording + "”.", { kind: "check_saved" });
  openNextCheck();
}

function mintSlot(profile, name, fieldWording) {
  const trimmed = String(name || "").trim();
  const id = uniqueSlotId(profile, trimmed);
  const slot = { id: id, name: trimmed, aliases: [] };
  const wording = String(fieldWording || "").trim();
  if (wording) {
    slot.aliases.push(wording);
  }
  profile.slots.push(slot);
  return slot;
}

function uniqueSlotId(profile, name) {
  const base = "slot_" + String(name || "slot")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  const root = base || "slot_custom";
  let id = root;
  let n = 2;
  const used = new Set(profile.slots.map((s) => s.id));
  while (used.has(id)) {
    id = root + "_" + n;
    n += 1;
  }
  return id;
}

function upsertAnswer(profile, slotId, situationId, value) {
  const existing = findAnswer(profile, slotId, situationId);
  if (existing) {
    existing.value = value;
    return existing;
  }
  const row = { slotId: slotId, situationId: situationId, value: value, optionWordings: [] };
  profile.answers.push(row);
  return row;
}

async function writeAndRemember(field, value, generation) {
  if (!isCurrent(generation)) return;
  const result = await sendToTab(session.tabId, { type: "WRITE_FIELD", fieldId: field.id, value });
  if (!isCurrent(generation)) return;
  if (!result || !result.ok) {
    log("warn", "Could not write “" + field.wording + "”.");
    return;
  }
  log("system", "Wrote “" + value + "” into " + field.wording + ".", { kind: "write" });
}

function matchAlias(profile, field) {
  const key = compareKey(field.wording);
  for (const slot of profile.slots) {
    const names = [slot.name].concat(slot.aliases || []).map(compareKey);
    if (!names.includes(key)) continue;
    const heading = compareKey(field.headingWording);
    if (!heading) {
      const answer = findAnswer(profile, slot.id, null);
      return { slot, situationId: null, answer: answer ? answer.value : null };
    }
    for (const situation of profile.situations) {
      const situationNames = [situation.name].concat(situation.aliases || []).map(compareKey);
      if (!situationNames.includes(heading)) continue;
      const answer = findAnswer(profile, slot.id, situation.id);
      return { slot, situationId: situation.id, answer: answer ? answer.value : null };
    }
    return { slot, situationId: undefined, answer: undefined };
  }
  return null;
}

function findAnswer(profile, slotId, situationId) {
  return profile.answers.find((a) => a.slotId === slotId && a.situationId === situationId) || null;
}

function addAlias(owner, wording) {
  const text = String(wording || "").trim();
  if (!text) return;
  const key = compareKey(text);
  const existing = [owner.name].concat(owner.aliases || []).map(compareKey);
  if (existing.includes(key)) return;
  owner.aliases = (owner.aliases || []).concat([text]);
}

function compareKey(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildFillRequest(fields, profile) {
  const criteria = buildOptionCriteria(profile);
  const questions = {};
  for (const field of fields) {
    questions[field.id] = {
      type: "choice",
      instructions:
        "Which profile slot and situation does this empty form field ask for? Pick an existing option, or none. Do not invent answers.",
      criteria: { ...criteria },
    };
  }
  return {
    model: session.provider.model,
    state: {
      fields: fields.map((f) => ({
        id: f.id,
        wording: f.wording,
        headingWording: f.headingWording || "",
      })),
      slots: profile.slots.map((s) => ({
        id: s.id,
        name: s.name,
        aliases: (s.aliases || []).slice(),
      })),
      situations: profile.situations.map((s) => ({
        id: s.id,
        name: s.name,
        aliases: (s.aliases || []).slice(),
      })),
    },
    questions,
  };
}

function buildOptionCriteria(profile) {
  const criteria = {};
  for (const slot of profile.slots) {
    criteria["default:" + slot.id] = slot.name + " · default";
    criteria["new:" + slot.id] = slot.name + " · new situation";
  }
  for (const situation of profile.situations) {
    for (const slot of profile.slots) {
      criteria["situation:" + slot.id + ":" + situation.id] = slot.name + " · " + situation.name;
    }
  }
  criteria.none = "none";
  return criteria;
}

function parseOptionKey(key) {
  if (!key || key === "none") return null;
  if (key.startsWith("default:")) return { kind: "default", slotId: key.slice("default:".length), situationId: null };
  if (key.startsWith("new:")) return { kind: "new", slotId: key.slice("new:".length), situationId: null };
  if (key.startsWith("situation:")) {
    const rest = key.slice("situation:".length);
    const i = rest.indexOf(":");
    if (i < 0) return null;
    return { kind: "situation", slotId: rest.slice(0, i), situationId: rest.slice(i + 1) };
  }
  return null;
}

function choiceConfidence(answer) {
  if (!answer || answer.type !== "choice") return 0;
  if (typeof answer.confidence === "number") return answer.confidence;
  if (answer.probabilities && typeof answer.probabilities === "object" && answer.choice != null) {
    const p = answer.probabilities[answer.choice];
    return typeof p === "number" ? p : 0;
  }
  return 0;
}

function emptyProfile() {
  return {
    slots: STARTER_SLOTS.map((name, i) => ({
      id: "slot_" + name.replace(/\s+/g, "_"),
      name,
      aliases: [],
    })),
    situations: [],
    answers: [],
  };
}

async function loadProfile() {
  const result = await storageGet([PROFILE_KEY]);
  const stored = result && result[PROFILE_KEY];
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.slots)) {
    const profile = emptyProfile();
    await saveProfile(profile);
    return profile;
  }
  return {
    slots: stored.slots.slice(),
    situations: Array.isArray(stored.situations) ? stored.situations.slice() : [],
    answers: Array.isArray(stored.answers) ? stored.answers.slice() : [],
  };
}

async function saveProfile(profile) {
  await storageSet({ [PROFILE_KEY]: profile });
  session.profile = profile;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result || {}));
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(values, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message || "Could not save the profile."));
      else resolve();
    });
  });
}

function resolveEndpoint(provider, override) {
  const raw = String(override || "").trim();
  if (!raw) return provider.endpoint;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The local test endpoint is not a valid URL.");
  }
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    throw new Error("The local test endpoint must be on localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

function stopFill(reason) {
  if (!session.running && !session.check) return;
  session.generation += 1;
  session.running = false;
  session.check = null;
  session.pendingChecks = [];
  session.waitingUntil = 0;
  session.waitReason = "";
  if (reason) log("warn", reason, { kind: "stopped" });
  broadcast();
}

function finishFill(reason) {
  session.running = false;
  session.finished = true;
  session.check = null;
  session.pendingChecks = [];
  session.waitingUntil = 0;
  session.waitReason = "";
  if (reason) log("done", reason, { kind: "finish" });
  broadcast();
}

function failFill(err) {
  session.running = false;
  session.finished = false;
  session.check = null;
  session.pendingChecks = [];
  session.waitingUntil = 0;
  session.waitReason = "";
  session.lastError = errorText(err);
  log("error", session.lastError);
  broadcast();
}

function isCurrent(generation) {
  return generation === session.generation;
}

async function callJev(apiKey, body, generation) {
  const provider = session.provider || PROVIDERS.beatapi;
  let rateLimitRetries = 0;
  let serverRetries = 0;
  let http5xxRetries = 0;

  for (;;) {
    await paceRequests(generation);
    if (!isCurrent(generation)) throw new RunCancelled();

    const started = performance.now();
    session.lastRequestAt = Date.now();
    let response;
    try {
      response = await fetch(session.endpoint || provider.endpoint, {
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

    if (response.status >= 500 && http5xxRetries < MAX_HTTP_5XX_RETRIES && apiError.retryable !== false) {
      http5xxRetries += 1;
      log("warn", "Jev server error (HTTP " + response.status + ") — retrying (" + http5xxRetries + "/" + MAX_HTTP_5XX_RETRIES + ").");
      await waitWithStatus(1000 * http5xxRetries, "Retrying after a server error", generation);
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
  const out = { message: "", code: "", retryable: undefined, retryAfter: NaN, requestId: "" };
  if (!payload || typeof payload !== "object") return out;
  const err = payload.error;
  if (err && typeof err === "object") {
    out.message = String(err.message || err.detail || "");
    out.code = String(err.code || err.type || "");
    if (typeof err.retryable === "boolean") out.retryable = err.retryable;
    if (typeof err.retry_after_seconds === "number") out.retryAfter = err.retry_after_seconds;
    if (err.request_id) out.requestId = String(err.request_id);
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
  const message = httpErrorMessage(status, apiError, provider);
  return apiError.requestId ? message + " Request ID: " + apiError.requestId : message;
}

function httpErrorMessage(status, apiError, provider) {
  const detail = apiError.message ? " (" + apiError.message + ")" : "";
  if (status === 401) {
    return (
      provider.name +
      " rejected this API key (HTTP 401). Check the key in Settings — BeatAPI keys only work with BeatAPI, and TypeSafe keys only work with TypeSafe."
    );
  }
  if (status === 402) {
    return (
      provider.name +
      " says the account is out of credits (HTTP 402)." +
      (provider.id === "beatapi"
        ? " Top up at beatapi.io/dashboard/billing, or check the model is jev-1.13-free."
        : " Top up your balance to continue.") +
      detail
    );
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
    finished: session.finished,
    lastError: session.lastError,
    check: publicCheck(session.check, session.profile),
    undoAvailable: session.undoAvailable,
    openSettings: session.openSettings,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    provider: session.provider ? session.provider.id : "",
    providerName: session.provider ? session.provider.name : "",
    model: session.resolvedModel || (session.provider ? session.provider.model : ""),
    endpoint: session.endpoint,
    localEndpoint: Boolean(session.provider && session.endpoint && session.endpoint !== session.provider.endpoint),
    tabId: session.tabId,
    tabTitle: session.tabTitle,
    tabUrl: session.tabUrl,
    waitingUntil: session.waitingUntil,
    waitReason: session.waitReason,
    logs: session.logs.slice(),
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
            check: state.check,
            paused: Boolean(state.check),
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
    // Best effort.
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
