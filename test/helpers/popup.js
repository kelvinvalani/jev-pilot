/**
 * Loads popup.html + popup.js in jsdom with either a fake extension
 * runtime (records messages, returns scripted state) or no chrome at all
 * (preview mode, which uses the built-in mock runtime).
 */

const { JSDOM } = require("jsdom");
const { read } = require("./page");

function baseState(extra) {
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
    tabTitle: "Northwind Flights",
    tabUrl: "https://flights.example.test/",
    waitingUntil: 0,
    waitReason: "",
    logs: [],
    pendingConfirmation: null,
    ...(extra || {}),
  };
}

function loadPopup(options) {
  const opts = options || {};
  const html = read("popup.html").replace(/<script src="popup\.js"><\/script>/, "");
  const surface = opts.surface || "popup";
  const url = opts.extension === false ? "http://127.0.0.1:41785/popup.html" : "https://ext.test/popup.html" + (surface === "overlay" ? "?surface=overlay" : "");
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
  if (!window.HTMLFormElement.prototype.requestSubmit) {
    window.HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
      this.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    };
  }

  const sent = [];
  const listeners = [];
  const storage = { ...(opts.storage || {}) };
  let state = baseState(opts.state);
  const parentMessages = [];

  if (opts.extension !== false) {
    window.chrome = {
      runtime: {
        lastError: undefined,
        getManifest: () => ({ version: "test" }),
        sendMessage(message, cb) {
          sent.push(message);
          const reply = opts.reply ? opts.reply(message, state) : null;
          if (reply) state = reply;
          setImmediate(() => cb && cb(JSON.parse(JSON.stringify(state))));
        },
        onMessage: { addListener: (fn) => listeners.push(fn) },
      },
      storage: {
        sync: {
          get: (keys, cb) => {
            const out = {};
            for (const key of keys) if (key in storage) out[key] = storage[key];
            cb(out);
          },
          set: (values, cb) => {
            Object.assign(storage, values);
            if (cb) cb();
          },
        },
      },
    };
  }
  if (surface === "overlay") {
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { postMessage: (data, origin) => parentMessages.push({ data, origin }) },
    });
  }
  window.close = () => parentMessages.push({ data: "window.close" });

  window.eval(read("popup.js") + "\n//# sourceURL=popup.js");

  const $ = (id) => window.document.getElementById(id);
  return {
    window,
    document: window.document,
    $,
    sent,
    storage,
    parentMessages,
    push(next) {
      state = baseState(next);
      for (const fn of listeners) fn({ type: "STATE", state: JSON.parse(JSON.stringify(state)) });
    },
    async settle(ticks) {
      for (let i = 0; i < (ticks || 20); i += 1) await new Promise((r) => setImmediate(r));
    },
    async sleep(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },
    visible: (id) => !$(id).hidden,
    click: (id) => $(id).click(),
    type(id, value) {
      const el = $(id);
      el.value = value;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
  };
}

module.exports = { loadPopup, baseState };
