/**
 * Jev Fast — popup controller.
 * Talks to the service worker over chrome.runtime messaging.
 * When opened outside the extension (local preview), a mock session
 * produces the same log format so the UI can be exercised without Chrome.
 */

const IS_EXTENSION =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  typeof chrome.runtime.getManifest === "function";

const STORAGE_KEYS = {
  apiKey: "TYPESAFE_API_KEY",
  provider: "jevProvider",
  goal: "lastGoal",
};

const PROVIDERS = {
  beatapi: {
    label: "BeatAPI API key",
    placeholder: "BEATAPI_API_KEY",
    note: "BeatAPI free tier: 1 request per minute until you top up. No TypeSafe key needed.",
  },
  typesafe: {
    label: "TypeSafe API key",
    placeholder: "TYPESAFE_API_KEY",
    note: "Official TypeSafe System One. Requires a console.typesafe.ai key, not a BeatAPI key.",
  },
};

const els = {
  provider: document.getElementById("provider"),
  providerNote: document.getElementById("providerNote"),
  keyLabel: document.getElementById("key-label"),
  apiKey: document.getElementById("apiKey"),
  toggleKey: document.getElementById("toggleKey"),
  keySaved: document.getElementById("keySaved"),
  goal: document.getElementById("goal"),
  goalCount: document.getElementById("goalCount"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  statusChip: document.getElementById("statusChip"),
  log: document.getElementById("log"),
  emptyLog: document.getElementById("emptyLog"),
  clearLog: document.getElementById("clearLog"),
  confirmBar: document.getElementById("confirmBar"),
  confirmText: document.getElementById("confirmText"),
  confirmTextRow: document.getElementById("confirmTextRow"),
  confirmInput: document.getElementById("confirmInput"),
  confirmBtn: document.getElementById("confirmBtn"),
  skipBtn: document.getElementById("skipBtn"),
  confirmStopBtn: document.getElementById("confirmStopBtn"),
};

let pendingConfirmation = null;
let saveTimer = 0;

if (!IS_EXTENSION && window.self === window.top) {
  document.documentElement.classList.add("preview-mode");
}

const mockChrome = IS_EXTENSION ? null : createMockChrome();

function runtime() {
  return IS_EXTENSION ? chrome : mockChrome;
}

function setStatus(state, label) {
  els.statusChip.dataset.state = state;
  els.statusChip.className = "chip " + state;
  els.statusChip.textContent = label;
}

function setRunningUi(running, paused) {
  els.startBtn.disabled = running;
  els.stopBtn.disabled = !running;
  els.goal.disabled = running;
  els.apiKey.disabled = running;
  els.provider.disabled = running;
  if (!running) {
    hideConfirm();
  } else if (paused) {
    els.startBtn.disabled = true;
  }
}

function hideConfirm() {
  pendingConfirmation = null;
  els.confirmBar.hidden = true;
  els.confirmTextRow.hidden = true;
  els.confirmInput.value = "";
}

function showConfirm(payload) {
  pendingConfirmation = payload;
  els.confirmBar.hidden = false;
  els.confirmText.textContent = payload.message;
  const needsText = payload.reason === "text" || payload.reason === "complex_text";
  els.confirmTextRow.hidden = !needsText;
  if (needsText) {
    els.confirmInput.value = payload.suggestedText || "";
    els.confirmInput.focus();
  }
}

function renderLogs(entries) {
  const rows = (entries || []).filter((e) => e && e.text);
  if (!rows.length) {
    els.log.innerHTML = "";
    els.log.appendChild(els.emptyLog);
    els.emptyLog.hidden = false;
    return;
  }
  els.emptyLog.hidden = true;
  els.log.innerHTML = "";
  for (const entry of rows) {
    const row = document.createElement("div");
    row.className = "row " + (entry.level || "system");
    row.textContent = entry.text;
    els.log.appendChild(row);
  }
  els.log.scrollTop = els.log.scrollHeight;
}

function applyState(state) {
  if (!state) return;
  setRunningUi(Boolean(state.running), Boolean(state.paused));
  if (state.running && state.paused) {
    setStatus("paused", "Paused");
  } else if (state.running) {
    const step = state.step || 0;
    setStatus("running", "Step " + step + "/15");
  } else if (state.lastError) {
    setStatus("error", "Error");
  } else if (state.finished) {
    setStatus("done", "Done");
  } else {
    setStatus("idle", "Idle");
  }
  renderLogs(state.logs);
  if (state.pendingConfirmation) {
    showConfirm(state.pendingConfirmation);
  } else if (!state.paused) {
    hideConfirm();
  }
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

function applyProviderUi() {
  const provider = PROVIDERS[els.provider.value] || PROVIDERS.beatapi;
  els.keyLabel.textContent = provider.label;
  els.apiKey.placeholder = provider.placeholder;
  els.providerNote.textContent = provider.note;
}

function persistSettings() {
  const apiKey = els.apiKey.value.trim();
  const goal = els.goal.value;
  const payload = {
    [STORAGE_KEYS.apiKey]: apiKey,
    [STORAGE_KEYS.provider]: els.provider.value,
    [STORAGE_KEYS.goal]: goal,
  };
  runtime().storage.sync.set(payload, () => {
    els.keySaved.hidden = !apiKey;
    window.setTimeout(() => {
      els.keySaved.hidden = true;
    }, 1200);
  });
}

function updateGoalCount() {
  els.goalCount.textContent = String(els.goal.value.length) + " / 2000";
}

async function loadSettings() {
  await new Promise((resolve) => {
    runtime().storage.sync.get(
      [STORAGE_KEYS.apiKey, STORAGE_KEYS.provider, STORAGE_KEYS.goal],
      (result) => {
        if (result[STORAGE_KEYS.apiKey]) {
          els.apiKey.value = result[STORAGE_KEYS.apiKey];
        }
        if (result[STORAGE_KEYS.provider] && PROVIDERS[result[STORAGE_KEYS.provider]]) {
          els.provider.value = result[STORAGE_KEYS.provider];
        }
        if (result[STORAGE_KEYS.goal]) {
          els.goal.value = result[STORAGE_KEYS.goal];
        }
        applyProviderUi();
        updateGoalCount();
        resolve();
      }
    );
  });
}

async function refreshState() {
  try {
    const state = await send({ type: "GET_STATUS" });
    applyState(state);
  } catch {
    // Service worker may be asleep before the first start.
  }
}

els.toggleKey.addEventListener("click", () => {
  const hidden = els.apiKey.type === "password";
  els.apiKey.type = hidden ? "text" : "password";
  els.toggleKey.textContent = hidden ? "Hide" : "Show";
  els.toggleKey.setAttribute("aria-label", hidden ? "Hide API key" : "Show API key");
});

els.provider.addEventListener("change", () => {
  applyProviderUi();
  persistSettings();
});

els.apiKey.addEventListener("input", () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistSettings, 250);
});

els.goal.addEventListener("input", () => {
  updateGoalCount();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistSettings, 250);
});

els.startBtn.addEventListener("click", async () => {
  const apiKey = els.apiKey.value.trim();
  const goal = els.goal.value.trim();
  if (!apiKey) {
    setStatus("error", "Need key");
    renderLogs([{ level: "error", text: "Add an API key for the selected provider before starting." }]);
    els.apiKey.focus();
    return;
  }
  if (!goal) {
    setStatus("error", "Need goal");
    renderLogs([{ level: "error", text: "Describe the user goal before starting." }]);
    els.goal.focus();
    return;
  }
  persistSettings();
  hideConfirm();
  setRunningUi(true, false);
  setStatus("running", "Starting");
  try {
    const state = await send({ type: "START", apiKey, goal, provider: els.provider.value });
    applyState(state);
  } catch (err) {
    setRunningUi(false, false);
    setStatus("error", "Error");
    renderLogs([{ level: "error", text: String(err.message || err) }]);
  }
});

els.stopBtn.addEventListener("click", async () => {
  const state = await send({ type: "STOP" });
  applyState(state);
});

els.clearLog.addEventListener("click", async () => {
  const state = await send({ type: "CLEAR_LOG" });
  applyState(state);
});

els.confirmBtn.addEventListener("click", async () => {
  if (!pendingConfirmation) return;
  const textValue = els.confirmInput.value;
  const state = await send({
    type: "CONFIRM",
    textValue,
  });
  applyState(state);
});

els.skipBtn.addEventListener("click", async () => {
  const state = await send({ type: "SKIP" });
  applyState(state);
});

els.confirmStopBtn.addEventListener("click", async () => {
  const state = await send({ type: "STOP" });
  applyState(state);
});

runtime().runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "STATE") return;
  applyState(message.state);
});

loadSettings().then(refreshState);

function createMockChrome() {
  const memory = {
    TYPESAFE_API_KEY: "",
    jevProvider: "beatapi",
    lastGoal: "Search for flights from Melbourne to Tokyo",
  };
  const listeners = [];
  let timer = 0;
  let mockState = emptyState();

  function emptyState() {
    return {
      running: false,
      paused: false,
      finished: false,
      lastError: "",
      step: 0,
      logs: [],
      pendingConfirmation: null,
    };
  }

  function push(level, text) {
    mockState.logs = mockState.logs.concat([{ level, text, ts: Date.now() }]);
    broadcast();
  }

  function broadcast() {
    const snapshot = JSON.parse(JSON.stringify(mockState));
    for (const fn of listeners) {
      fn({ type: "STATE", state: snapshot });
    }
    return snapshot;
  }

  function formatStep(step, action, target, confidence, latency) {
    return (
      "[Step " +
      step +
      "] Action: " +
      action +
      " | Target: " +
      target +
      " | Confidence: " +
      confidence.toFixed(2) +
      " | Latency: " +
      latency +
      "ms"
    );
  }

  async function runDemo() {
    mockState = emptyState();
    mockState.running = true;
    push("system", "Preview demo — load the unpacked extension to control a live tab.");
    const script = [
      { action: "TYPE", target: "elem_0", confidence: 0.97, latency: 118, extra: "Typed “Melbourne”" },
      { action: "TYPE", target: "elem_1", confidence: 0.96, latency: 104, extra: "Typed “Tokyo”" },
      { action: "CLICK", target: "elem_3", confidence: 0.99, latency: 91, extra: "Clicked “Search flights”" },
      { action: "FINISH", target: "none_applicable", confidence: 0.94, latency: 87, extra: "" },
    ];
    for (let i = 0; i < script.length; i += 1) {
      if (!mockState.running) return broadcast();
      mockState.step = i + 1;
      const row = script[i];
      await delay(280);
      if (!mockState.running) return broadcast();
      push("action", formatStep(i + 1, row.action, row.target, row.confidence, row.latency));
      if (row.extra) push("system", row.extra);
    }
    mockState.running = false;
    mockState.finished = true;
    mockState.paused = false;
    push("done", "Goal complete after 4 steps.");
    return broadcast();
  }

  function delay(ms) {
    return new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms);
    });
  }

  return {
    runtime: {
      sendMessage(message, cb) {
        const type = message && message.type;
        let response = mockState;
        if (type === "GET_STATUS") {
          response = mockState;
        } else if (type === "CLEAR_LOG") {
          mockState.logs = [];
          response = broadcast();
        } else if (type === "STOP") {
          mockState.running = false;
          mockState.paused = false;
          window.clearTimeout(timer);
          push("warn", "Stopped.");
          response = broadcast();
        } else if (type === "START") {
          window.clearTimeout(timer);
          runDemo();
          response = mockState;
        } else if (type === "CONFIRM" || type === "SKIP") {
          mockState.paused = false;
          mockState.pendingConfirmation = null;
          response = broadcast();
        }
        if (typeof cb === "function") cb(JSON.parse(JSON.stringify(response)));
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
