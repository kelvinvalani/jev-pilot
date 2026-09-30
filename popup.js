/**
 * Jev Fast — UI controller for the toolbar popup and the in-page overlay.
 * Talks to the service worker over chrome.runtime messaging.
 * When opened outside the extension (local preview), a mock runtime
 * produces the same state shape so the UI can be exercised without Chrome.
 */

const IS_EXTENSION =
  typeof chrome !== "undefined" &&
  Boolean(chrome.runtime) &&
  typeof chrome.runtime.getManifest === "function";

const SURFACE = (() => {
  if (!IS_EXTENSION) return "preview";
  const param = new URLSearchParams(location.search).get("surface");
  return param === "overlay" ? "overlay" : "popup";
})();

const STORAGE_KEYS = {
  apiKey: "TYPESAFE_API_KEY",
  provider: "jevProvider",
  goal: "lastGoal",
  showLauncher: "showLauncher",
};

const PROVIDERS = {
  beatapi: {
    label: "BeatAPI API key",
    placeholder: "Paste your BeatAPI key",
    link: "https://beatapi.io/dashboard/apikeys",
    linkText: "Get a BeatAPI key",
  },
  typesafe: {
    label: "TypeSafe API key",
    placeholder: "Paste your TypeSafe key",
    link: "https://console.typesafe.ai",
    linkText: "Get a TypeSafe key",
  },
};

const GOAL_MAX = 2000;

const ICONS = {
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17h.01"/></svg>',
};

const $ = (id) => document.getElementById(id);

const els = {
  headerSub: $("headerSub"),
  statusPill: $("statusPill"),
  statusText: $("statusText"),
  settingsBtn: $("settingsBtn"),
  closeBtn: $("closeBtn"),
  settingsView: $("settingsView"),
  mainView: $("mainView"),
  providerInputs: Array.from(document.querySelectorAll('input[name="provider"]')),
  keyLabel: $("keyLabel"),
  apiKey: $("apiKey"),
  toggleKey: $("toggleKey"),
  keySaved: $("keySaved"),
  keyLink: $("keyLink"),
  showLauncher: $("showLauncher"),
  settingsDone: $("settingsDone"),
  setupCard: $("setupCard"),
  setupBtn: $("setupBtn"),
  taskForm: $("taskForm"),
  goal: $("goal"),
  goalCount: $("goalCount"),
  examples: $("examples"),
  startBtn: $("startBtn"),
  formError: $("formError"),
  runCard: $("runCard"),
  runGoal: $("runGoal"),
  stopBtn: $("stopBtn"),
  progress: $("progress"),
  progressBar: $("progressBar"),
  runMeta: $("runMeta"),
  waitNotice: $("waitNotice"),
  confirmCard: $("confirmCard"),
  confirmTitle: $("confirmTitle"),
  confirmText: $("confirmText"),
  confirmAction: $("confirmAction"),
  confirmTarget: $("confirmTarget"),
  confirmConfidence: $("confirmConfidence"),
  confirmTextRow: $("confirmTextRow"),
  confirmInput: $("confirmInput"),
  confirmBtn: $("confirmBtn"),
  skipBtn: $("skipBtn"),
  confirmStopBtn: $("confirmStopBtn"),
  resultCard: $("resultCard"),
  resultIcon: $("resultIcon"),
  resultTitle: $("resultTitle"),
  resultText: $("resultText"),
  timeline: $("timeline"),
  emptyLog: $("emptyLog"),
  copyLog: $("copyLog"),
  clearLog: $("clearLog"),
};

const ui = {
  state: null,
  settingsOpen: false,
  confirmKey: "",
  busy: false,
  localError: "",
  waitTimer: 0,
  saveTimer: 0,
  savedTimer: 0,
};

document.documentElement.classList.add("surface-" + SURFACE);
if (SURFACE === "preview" && window.self !== window.top) {
  document.documentElement.classList.add("embedded");
}

const mockChrome = IS_EXTENSION ? null : createMockChrome();

function runtime() {
  return IS_EXTENSION ? chrome : mockChrome;
}

function send(message) {
  return new Promise((resolve, reject) => {
    try {
      runtime().runtime.sendMessage(message, (response) => {
        const err = IS_EXTENSION ? chrome.runtime.lastError : null;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/* ---------- Settings ---------- */

function selectedProvider() {
  const checked = els.providerInputs.find((input) => input.checked);
  return checked && PROVIDERS[checked.value] ? checked.value : "beatapi";
}

function setProvider(id) {
  for (const input of els.providerInputs) input.checked = input.value === id;
}

function applyProviderUi() {
  const provider = PROVIDERS[selectedProvider()];
  els.keyLabel.textContent = provider.label;
  els.apiKey.placeholder = provider.placeholder;
  els.keyLink.href = provider.link;
  els.keyLink.textContent = provider.linkText;
}

function hasKey() {
  return els.apiKey.value.trim().length > 0;
}

function persistSettings(options) {
  const opts = options || {};
  const payload = {
    [STORAGE_KEYS.apiKey]: els.apiKey.value.trim(),
    [STORAGE_KEYS.provider]: selectedProvider(),
    [STORAGE_KEYS.goal]: els.goal.value,
    [STORAGE_KEYS.showLauncher]: els.showLauncher.checked,
  };
  runtime().storage.sync.set(payload, () => {
    if (!opts.flashSaved) return;
    els.keySaved.hidden = false;
    window.clearTimeout(ui.savedTimer);
    ui.savedTimer = window.setTimeout(() => {
      els.keySaved.hidden = true;
    }, 1400);
  });
}

function schedulePersist(flashSaved) {
  window.clearTimeout(ui.saveTimer);
  ui.saveTimer = window.setTimeout(() => persistSettings({ flashSaved }), 250);
}

function loadSettings() {
  return new Promise((resolve) => {
    runtime().storage.sync.get(Object.values(STORAGE_KEYS), (result) => {
      const data = result || {};
      if (data[STORAGE_KEYS.apiKey]) els.apiKey.value = data[STORAGE_KEYS.apiKey];
      if (data[STORAGE_KEYS.provider] && PROVIDERS[data[STORAGE_KEYS.provider]]) {
        setProvider(data[STORAGE_KEYS.provider]);
      }
      if (data[STORAGE_KEYS.goal]) els.goal.value = data[STORAGE_KEYS.goal];
      els.showLauncher.checked = data[STORAGE_KEYS.showLauncher] !== false;
      applyProviderUi();
      updateGoalCount();
      resolve();
    });
  });
}

function openSettings(open) {
  ui.settingsOpen = open;
  els.settingsView.hidden = !open;
  els.mainView.hidden = open;
  els.settingsBtn.setAttribute("aria-pressed", String(open));
  if (open) {
    window.setTimeout(() => (hasKey() ? els.settingsDone : els.apiKey).focus(), 0);
  } else {
    render();
    if (!els.goal.disabled) els.goal.focus();
  }
}

/* ---------- Rendering ---------- */

function statusFor(state) {
  if (!state) return { key: "idle", label: "Ready" };
  if (state.running && state.paused) return { key: "paused", label: "Needs review" };
  if (state.running && state.waitingUntil > Date.now()) return { key: "waiting", label: "Waiting" };
  if (state.running) return { key: "running", label: "Step " + (state.step || 0) + " of " + (state.maxSteps || 15) };
  if (state.lastError) return { key: "error", label: "Error" };
  if (state.finished) return { key: "done", label: "Done" };
  return { key: "idle", label: "Ready" };
}

function render() {
  const state = ui.state || {};
  const running = Boolean(state.running);
  const paused = Boolean(state.paused);
  const status = statusFor(ui.state);

  els.statusPill.dataset.state = status.key;
  els.statusText.textContent = status.label;

  if (SURFACE === "preview") {
    els.headerSub.textContent = "Preview · mock runtime";
  } else if (running && state.tabTitle) {
    els.headerSub.textContent = state.tabTitle;
  } else {
    els.headerSub.textContent = "Automate this page";
  }
  els.headerSub.title = els.headerSub.textContent;

  els.setupCard.hidden = running || hasKey() || SURFACE === "preview";

  els.taskForm.hidden = running;
  els.goal.disabled = running || ui.busy;
  els.startBtn.disabled = running || ui.busy;
  els.apiKey.disabled = running;
  for (const input of els.providerInputs) input.disabled = running;
  els.formError.hidden = !ui.localError;
  els.formError.textContent = ui.localError;

  renderRun(state, running);
  renderConfirm(state, running && paused);
  renderResult(state, running);
  renderTimeline(state.logs || []);
}

function renderRun(state, running) {
  els.runCard.hidden = !running;
  if (!running) {
    stopWaitTimer();
    return;
  }
  const max = state.maxSteps || 15;
  const step = Math.min(state.step || 0, max);
  els.runGoal.textContent = state.goal || els.goal.value.trim();
  els.progress.setAttribute("aria-valuemax", String(max));
  els.progress.setAttribute("aria-valuenow", String(step));
  els.progressBar.style.width = Math.round((step / max) * 100) + "%";
  const bits = ["Step " + step + " of " + max];
  if (state.providerName) bits.push(state.providerName + (state.model ? " · " + state.model : ""));
  els.runMeta.textContent = bits.join(" · ");
  renderWait(state);
}

function renderWait(state) {
  const remaining = state.waitingUntil ? state.waitingUntil - Date.now() : 0;
  if (remaining <= 0 || state.paused) {
    els.waitNotice.hidden = true;
    stopWaitTimer();
    return;
  }
  els.waitNotice.hidden = false;
  els.waitNotice.textContent =
    (state.waitReason || "Waiting") + " — " + Math.ceil(remaining / 1000) + "s left";
  if (!ui.waitTimer) {
    ui.waitTimer = window.setInterval(() => {
      if (!ui.state) return;
      renderWait(ui.state);
      const status = statusFor(ui.state);
      els.statusPill.dataset.state = status.key;
      els.statusText.textContent = status.label;
    }, 1000);
  }
}

function stopWaitTimer() {
  if (ui.waitTimer) {
    window.clearInterval(ui.waitTimer);
    ui.waitTimer = 0;
  }
}

function renderConfirm(state, visible) {
  const pending = visible ? state.pendingConfirmation : null;
  if (!pending) {
    els.confirmCard.hidden = true;
    ui.confirmKey = "";
    return;
  }
  const key = [pending.step, pending.reason, pending.targetId, pending.actionType].join("|");
  const fresh = key !== ui.confirmKey;
  ui.confirmKey = key;

  els.confirmCard.hidden = false;
  els.confirmTitle.textContent = pending.title || "Review this step";
  els.confirmText.textContent = pending.message || "";
  const action = String(pending.actionType || "click").toLowerCase();
  els.confirmAction.textContent = action.toUpperCase();
  els.confirmAction.dataset.action = action;
  els.confirmTarget.textContent = pending.targetLabel || pending.targetId || "";
  els.confirmTarget.title = els.confirmTarget.textContent;
  els.confirmConfidence.textContent =
    typeof pending.confidence === "number" ? Math.round(pending.confidence * 100) + "%" : "";

  const needsText = action === "type";
  els.confirmTextRow.hidden = !needsText;
  els.confirmBtn.textContent = needsText ? "Type it" : "Run this step";
  els.confirmBtn.disabled = ui.busy;
  els.skipBtn.disabled = ui.busy;
  if (fresh) {
    els.confirmInput.value = pending.suggestedText || "";
    window.setTimeout(() => (needsText ? els.confirmInput : els.confirmBtn).focus(), 0);
  }
}

function renderResult(state, running) {
  const logs = state.logs || [];
  let variant = "";
  let title = "";
  let text = "";
  if (!running && state.lastError) {
    variant = "error";
    title = "Something went wrong";
    text = state.lastError;
  } else if (!running && state.finished) {
    const last = findLast(logs, (entry) => entry.kind === "finish" || entry.level === "done");
    const limit = last && /limit|could not/i.test(last.text || "");
    variant = limit ? "warn" : "success";
    title = limit ? "Stopped early" : "Goal complete";
    text = last ? last.text : "";
  } else if (!running && logs.length) {
    const last = logs[logs.length - 1];
    if (last && last.kind === "stopped") {
      variant = "warn";
      title = "Stopped";
      text = "The task was stopped. Nothing else will happen on the page.";
    }
  }
  els.resultCard.hidden = !variant;
  if (!variant) return;
  els.resultCard.className = "callout is-" + variant;
  els.resultIcon.innerHTML = ICONS[variant];
  els.resultTitle.textContent = title;
  els.resultText.textContent = text;
}

function renderTimeline(logs) {
  const items = buildTimeline(logs);
  els.timeline.textContent = "";
  els.emptyLog.hidden = items.length > 0;
  els.copyLog.hidden = items.length === 0;
  els.clearLog.hidden = items.length === 0 || Boolean(ui.state && ui.state.running);
  for (const item of items) els.timeline.appendChild(item);
  const last = els.timeline.lastElementChild;
  if (last && typeof last.scrollIntoView === "function") {
    last.scrollIntoView({ block: "nearest" });
  }
}

function buildTimeline(logs) {
  const nodes = [];
  let lastStep = null;
  for (const entry of logs) {
    if (!entry || !entry.text) continue;
    if (entry.kind === "extract") continue;
    if (entry.kind === "step") {
      lastStep = stepNode(entry);
      nodes.push(lastStep);
      continue;
    }
    if (entry.kind === "result" && lastStep) {
      const sub = document.createElement("p");
      sub.className = "step-sub";
      sub.textContent = entry.text;
      lastStep.querySelector(".step-body").appendChild(sub);
      continue;
    }
    if (entry.kind === "finish" || entry.kind === "error") continue;
    nodes.push(noteNode(entry));
  }
  return nodes;
}

function stepNode(entry) {
  const li = document.createElement("li");
  li.className = "step";
  const body = document.createElement("div");
  body.className = "step-body";

  const top = document.createElement("div");
  top.className = "step-top";
  const num = document.createElement("span");
  num.className = "step-num";
  num.textContent = String(entry.step || "").padStart(2, "0");
  const badge = document.createElement("span");
  badge.className = "action-badge";
  const action = String(entry.action || "").toLowerCase();
  badge.dataset.action = action;
  badge.textContent = action.toUpperCase();
  const target = document.createElement("span");
  target.className = "step-target";
  target.textContent = action === "finish" ? "Goal complete" : entry.targetLabel || entry.targetId || "";
  target.title = (entry.targetId ? entry.targetId + " — " : "") + (entry.targetLabel || "");
  top.append(num, badge, target);

  const meta = document.createElement("div");
  meta.className = "step-meta";
  const confidence = typeof entry.confidence === "number" ? entry.confidence : 0;
  const threshold = (ui.state && ui.state.confidenceThreshold) || 0.6;
  const meter = document.createElement("span");
  meter.className = "meter" + (confidence < threshold ? " is-low" : "");
  const fill = document.createElement("span");
  fill.style.width = Math.round(confidence * 100) + "%";
  meter.appendChild(fill);
  const pct = document.createElement("span");
  pct.textContent = Math.round(confidence * 100) + "% confident";
  const latency = document.createElement("span");
  latency.textContent = typeof entry.latencyMs === "number" ? entry.latencyMs + " ms" : "";
  meta.append(meter, pct, latency);

  body.append(top, meta);
  li.appendChild(body);
  return li;
}

function noteNode(entry) {
  const li = document.createElement("li");
  const level = entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : entry.level === "done" ? "done" : "";
  li.className = "note" + (level ? " " + level : "");
  li.textContent = entry.text;
  return li;
}

function findLast(list, predicate) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return list[i];
  }
  return null;
}

function applyState(state) {
  if (!state || typeof state !== "object") return;
  ui.state = state;
  if (state.running) ui.localError = "";
  render();
}

function updateGoalCount() {
  els.goalCount.textContent = els.goal.value.length + " / " + GOAL_MAX;
}

function showLocalError(message, focusEl) {
  ui.localError = message;
  render();
  if (focusEl) focusEl.focus();
}

async function refreshState() {
  try {
    applyState(await send({ type: "GET_STATUS" }));
  } catch {
    render();
  }
}

async function command(message) {
  ui.busy = true;
  render();
  try {
    applyState(await send(message));
  } catch (err) {
    showLocalError(String((err && err.message) || err));
  } finally {
    ui.busy = false;
    render();
  }
}

function closeSurface() {
  if (SURFACE === "overlay") {
    window.parent.postMessage({ source: "jev-fast", type: "CLOSE" }, "*");
  } else if (SURFACE === "popup") {
    window.close();
  }
}

function logAsText(logs) {
  return (logs || [])
    .filter((entry) => entry && entry.text)
    .map((entry) => new Date(entry.ts || Date.now()).toLocaleTimeString() + "  " + entry.text)
    .join("\n");
}

/* ---------- Events ---------- */

els.settingsBtn.addEventListener("click", () => openSettings(!ui.settingsOpen));
els.settingsDone.addEventListener("click", () => {
  persistSettings();
  openSettings(false);
});
els.setupBtn.addEventListener("click", () => openSettings(true));

if (SURFACE === "overlay") {
  els.closeBtn.hidden = false;
  els.closeBtn.addEventListener("click", closeSurface);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (ui.settingsOpen) {
    event.preventDefault();
    openSettings(false);
    return;
  }
  if (SURFACE === "overlay") {
    event.preventDefault();
    closeSurface();
  }
});

for (const input of els.providerInputs) {
  input.addEventListener("change", () => {
    applyProviderUi();
    persistSettings({ flashSaved: true });
  });
}

els.apiKey.addEventListener("input", () => {
  ui.localError = "";
  schedulePersist(true);
});

els.toggleKey.addEventListener("click", () => {
  const reveal = els.apiKey.type === "password";
  els.apiKey.type = reveal ? "text" : "password";
  els.toggleKey.textContent = reveal ? "Hide" : "Show";
  els.toggleKey.setAttribute("aria-label", reveal ? "Hide API key" : "Show API key");
});

els.showLauncher.addEventListener("change", () => persistSettings());

els.goal.addEventListener("input", () => {
  updateGoalCount();
  if (ui.localError) {
    ui.localError = "";
    render();
  }
  schedulePersist(false);
});

els.goal.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    els.taskForm.requestSubmit();
  }
});

els.examples.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-example]");
  if (!chip || els.goal.disabled) return;
  els.goal.value = chip.dataset.example;
  updateGoalCount();
  schedulePersist(false);
  els.goal.focus();
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = els.apiKey.value.trim();
  const goal = els.goal.value.trim();
  if (!apiKey && SURFACE !== "preview") {
    openSettings(true);
    return;
  }
  if (!goal) {
    showLocalError("Describe what Jev should do on this page.", els.goal);
    return;
  }
  ui.localError = "";
  persistSettings();
  await command({ type: "START", apiKey, goal, provider: selectedProvider() });
});

els.stopBtn.addEventListener("click", () => command({ type: "STOP" }));
els.confirmStopBtn.addEventListener("click", () => command({ type: "STOP" }));
els.skipBtn.addEventListener("click", () => command({ type: "SKIP" }));
els.confirmBtn.addEventListener("click", () => {
  const pending = ui.state && ui.state.pendingConfirmation;
  if (!pending) return;
  if (String(pending.actionType).toLowerCase() === "type" && !els.confirmInput.value.trim()) {
    els.confirmInput.focus();
    return;
  }
  command({ type: "CONFIRM", textValue: els.confirmInput.value });
});
els.confirmInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.confirmBtn.click();
  }
});

els.clearLog.addEventListener("click", () => command({ type: "CLEAR_LOG" }));
els.copyLog.addEventListener("click", async () => {
  const text = logAsText(ui.state && ui.state.logs);
  try {
    await navigator.clipboard.writeText(text);
    els.copyLog.textContent = "Copied";
  } catch {
    els.copyLog.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    els.copyLog.textContent = "Copy";
  }, 1200);
});

runtime().runtime.onMessage.addListener((message) => {
  if (message && message.type === "STATE") applyState(message.state);
});

loadSettings()
  .then(refreshState)
  .then(() => {
    if (!hasKey() && SURFACE !== "preview") openSettings(true);
    else if (!els.goal.disabled) els.goal.focus();
  });

/* ---------- Preview mock runtime ---------- */

function createMockChrome() {
  const memory = {
    TYPESAFE_API_KEY: "",
    jevProvider: "beatapi",
    lastGoal: "Search for flights from Melbourne to Tokyo",
    showLauncher: true,
  };
  const listeners = [];
  let timer = 0;
  let generation = 0;
  let resume = null;
  let mockState = emptyState();

  function emptyState() {
    return {
      running: false,
      paused: false,
      finished: false,
      lastError: "",
      step: 0,
      maxSteps: 15,
      confidenceThreshold: 0.6,
      goal: "",
      provider: "beatapi",
      providerName: "BeatAPI",
      model: "jev-1.13-free",
      tabTitle: "Demo page",
      tabUrl: "",
      waitingUntil: 0,
      waitReason: "",
      logs: [],
      pendingConfirmation: null,
    };
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(mockState));
  }

  function broadcast() {
    const state = snapshot();
    for (const fn of listeners) fn({ type: "STATE", state });
    return state;
  }

  function push(level, text, meta) {
    mockState.logs = mockState.logs.concat([{ level, text, ts: Date.now(), ...(meta || {}) }]);
    broadcast();
  }

  function delay(ms) {
    return new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms);
    });
  }

  const script = [
    { action: "type", targetId: "elem_0", targetLabel: "From · Origin city", confidence: 0.97, latencyMs: 118, textValue: "Melbourne" },
    { action: "type", targetId: "elem_1", targetLabel: "To · Destination city", confidence: 0.96, latencyMs: 104, textValue: "Tokyo" },
    { action: "click", targetId: "elem_3", targetLabel: "Search flights", confidence: 0.54, latencyMs: 91 },
    { action: "finish", targetId: "none_applicable", targetLabel: "", confidence: 0.94, latencyMs: 87 },
  ];

  function resultText(row) {
    return row.action === "type"
      ? "Typed “" + row.textValue + "” into " + row.targetLabel + "."
      : "Clicked “" + row.targetLabel + "”.";
  }

  async function runDemo(goal) {
    generation += 1;
    const gen = generation;
    mockState = emptyState();
    mockState.running = true;
    mockState.goal = goal;
    push("system", "Preview mode — load the unpacked extension to control a real tab.", { kind: "start" });
    for (let i = 0; i < script.length; i += 1) {
      if (gen !== generation) return;
      mockState.step = i + 1;
      broadcast();
      await delay(650);
      if (gen !== generation) return;
      const row = script[i];
      push("action", "[Step " + (i + 1) + "] " + row.action.toUpperCase() + " " + row.targetId, {
        kind: "step",
        step: i + 1,
        ...row,
      });
      if (row.action === "finish") break;
      if (row.confidence < 0.6) {
        mockState.paused = true;
        mockState.pendingConfirmation = {
          step: i + 1,
          reason: "confidence",
          title: "Low confidence — review this step",
          message: "Jev is " + Math.round(row.confidence * 100) + "% confident about this step, below the 60% auto-run threshold.",
          targetId: row.targetId,
          targetLabel: row.targetLabel,
          actionType: row.action,
          confidence: row.confidence,
          suggestedText: "",
        };
        push("warn", "Low confidence — waiting for your review.", { kind: "review" });
        const decision = await new Promise((resolve) => {
          resume = resolve;
        });
        if (gen !== generation) return;
        if (decision === "skip") {
          push("warn", "Skipped this step. Continuing.");
          continue;
        }
      }
      push("system", resultText(row), { kind: "result" });
    }
    if (gen !== generation) return;
    mockState.running = false;
    mockState.finished = true;
    push("done", "Jev reported the goal is complete.", { kind: "finish" });
  }

  function settle(decision) {
    mockState.paused = false;
    mockState.pendingConfirmation = null;
    const fn = resume;
    resume = null;
    if (fn) fn(decision);
  }

  return {
    runtime: {
      sendMessage(message, cb) {
        const type = message && message.type;
        if (type === "CLEAR_LOG") {
          mockState.logs = [];
          if (!mockState.running) {
            mockState.finished = false;
            mockState.lastError = "";
          }
        } else if (type === "STOP") {
          const wasRunning = mockState.running;
          generation += 1;
          window.clearTimeout(timer);
          settle("stop");
          mockState.running = false;
          if (wasRunning) push("warn", "Stopped by you.", { kind: "stopped" });
        } else if (type === "START") {
          window.clearTimeout(timer);
          settle("stop");
          runDemo(String(message.goal || ""));
        } else if (type === "CONFIRM") {
          settle("confirm");
        } else if (type === "SKIP") {
          settle("skip");
        }
        const state = broadcast();
        if (typeof cb === "function") window.setTimeout(() => cb(state), 0);
      },
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
    storage: {
      sync: {
        get(keys, cb) {
          const out = {};
          for (const key of keys) out[key] = memory[key];
          cb(out);
        },
        set(values, cb) {
          Object.assign(memory, values);
          if (typeof cb === "function") cb();
        },
      },
    },
  };
}
