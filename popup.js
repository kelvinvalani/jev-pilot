/**
 * Jev Fill — UI for the toolbar popup and the in-page overlay.
 * Talks to the service worker over chrome.runtime messaging.
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
  showLauncher: "showLauncher",
  testEndpoint: "jevTestEndpoint",
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
  testEndpoint: $("testEndpoint"),
  toggleKey: $("toggleKey"),
  keySaved: $("keySaved"),
  keyLink: $("keyLink"),
  showLauncher: $("showLauncher"),
  settingsDone: $("settingsDone"),
  setupCard: $("setupCard"),
  setupBtn: $("setupBtn"),
  fillBtn: $("fillBtn"),
  stopBtn: $("stopBtn"),
  formError: $("formError"),
  runMeta: $("runMeta"),
  waitNotice: $("waitNotice"),
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
    [STORAGE_KEYS.showLauncher]: els.showLauncher.checked,
    [STORAGE_KEYS.testEndpoint]: els.testEndpoint.value.trim(),
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
      els.showLauncher.checked = data[STORAGE_KEYS.showLauncher] !== false;
      if (data[STORAGE_KEYS.testEndpoint]) els.testEndpoint.value = data[STORAGE_KEYS.testEndpoint];
      applyProviderUi();
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
  }
}

function statusFor(state) {
  if (!state) return { key: "idle", label: "Ready" };
  if (state.running && state.check) return { key: "paused", label: "Needs a check" };
  if (state.running && state.waitingUntil > Date.now()) return { key: "waiting", label: "Waiting" };
  if (state.running) return { key: "running", label: "Filling" };
  if (state.lastError) return { key: "error", label: "Error" };
  if (state.finished) return { key: "done", label: "Done" };
  return { key: "idle", label: "Ready" };
}

function render() {
  const state = ui.state || {};
  const running = Boolean(state.running);
  const status = statusFor(ui.state);

  els.statusPill.dataset.state = status.key;
  els.statusText.textContent = status.label;

  if (SURFACE === "preview") {
    els.headerSub.textContent = "Preview · mock runtime";
  } else if (running && state.tabTitle) {
    els.headerSub.textContent = state.tabTitle;
  } else {
    els.headerSub.textContent = "Fill this page";
  }

  els.setupCard.hidden = running || hasKey() || SURFACE === "preview";
  els.fillBtn.disabled = running || ui.busy || !hasKey();
  els.stopBtn.hidden = !running;
  els.fillBtn.hidden = running;

  const meta = [];
  if (state.providerName) meta.push(state.providerName);
  if (state.model) meta.push(state.model);
  if (state.localEndpoint) meta.push("local test endpoint");
  els.runMeta.textContent = meta.join(" · ");

  if (state.waitingUntil > Date.now() && state.waitReason) {
    els.waitNotice.hidden = false;
    const seconds = Math.max(0, Math.ceil((state.waitingUntil - Date.now()) / 1000));
    els.waitNotice.textContent = state.waitReason + " — " + seconds + "s left";
    window.clearTimeout(ui.waitTimer);
    ui.waitTimer = window.setTimeout(render, 1000);
  } else {
    els.waitNotice.hidden = true;
  }

  if (ui.localError) {
    els.formError.hidden = false;
    els.formError.textContent = ui.localError;
  } else {
    els.formError.hidden = true;
  }

  if (state.lastError) {
    els.resultCard.hidden = false;
    els.resultCard.className = "callout is-error";
    els.resultIcon.innerHTML = ICONS.error;
    els.resultTitle.textContent = "Fill stopped";
    els.resultText.textContent = state.lastError;
  } else if (state.finished && !running) {
    els.resultCard.hidden = false;
    els.resultCard.className = "callout is-success";
    els.resultIcon.innerHTML = ICONS.success;
    els.resultTitle.textContent = "Fill complete";
    els.resultText.textContent = "Review the form, then submit it yourself.";
  } else {
    els.resultCard.hidden = true;
  }

  renderTimeline(state.logs || []);
}

function renderTimeline(logs) {
  const rows = logs.filter((entry) => entry && entry.text && entry.kind !== "extract");
  els.timeline.innerHTML = "";
  els.emptyLog.hidden = rows.length > 0;
  els.copyLog.hidden = rows.length === 0;
  els.clearLog.hidden = rows.length === 0;
  for (const entry of rows) {
    const li = document.createElement("li");
    li.className = "step";
    li.textContent = entry.text;
    els.timeline.appendChild(li);
  }
}

function applyState(state) {
  ui.state = state || null;
  if (state && state.openSettings) openSettings(true);
  render();
}

async function refreshState() {
  try {
    applyState(await send({ type: "GET_STATUS" }));
  } catch {
    applyState(null);
  }
}

async function command(message) {
  ui.busy = true;
  render();
  try {
    applyState(await send(message));
  } catch (err) {
    ui.localError = String((err && err.message) || err);
    render();
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
  render();
});

els.testEndpoint.addEventListener("input", () => schedulePersist(true));

els.toggleKey.addEventListener("click", () => {
  const reveal = els.apiKey.type === "password";
  els.apiKey.type = reveal ? "text" : "password";
  els.toggleKey.textContent = reveal ? "Hide" : "Show";
  els.toggleKey.setAttribute("aria-label", reveal ? "Hide API key" : "Show API key");
});

els.showLauncher.addEventListener("change", () => persistSettings());

els.fillBtn.addEventListener("click", async () => {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey && SURFACE !== "preview") {
    openSettings(true);
    return;
  }
  ui.localError = "";
  persistSettings();
  const endpoint = els.testEndpoint.value.trim();
  await command({ type: "FILL", apiKey, provider: selectedProvider(), ...(endpoint ? { endpoint } : {}) });
});

els.stopBtn.addEventListener("click", () => command({ type: "STOP" }));
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
  });

function createMockChrome() {
  const memory = {
    TYPESAFE_API_KEY: "",
    jevProvider: "beatapi",
    showLauncher: true,
  };
  const listeners = [];
  let mockState = emptyState();

  function emptyState() {
    return {
      running: false,
      finished: false,
      lastError: "",
      check: null,
      undoAvailable: false,
      openSettings: false,
      confidenceThreshold: 0.85,
      provider: "beatapi",
      providerName: "BeatAPI",
      model: "jev-1.14-free",
      tabTitle: "Demo page",
      tabUrl: "",
      waitingUntil: 0,
      waitReason: "",
      logs: [],
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
          mockState.running = false;
        } else if (type === "FILL") {
          mockState = emptyState();
          mockState.finished = true;
          mockState.logs = [{ level: "done", text: "Preview mode — load the unpacked extension to fill a real tab.", kind: "finish", ts: Date.now() }];
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
