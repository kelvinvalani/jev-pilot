/**
 * Loads background.js into an isolated VM context with a fake chrome API,
 * a scripted fetch, and a virtual clock. The active tab is a jsdom page.
 */

const vm = require("node:vm");
const { createClock } = require("./clock");
const { createPage, read } = require("./page");

function jsonResponse(status, body, headers) {
  const map = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (map.has(name.toLowerCase()) ? map.get(name.toLowerCase()) : null) },
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return JSON.parse(JSON.stringify(body));
    },
  };
}

function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

/**
 * @param {object} options
 * @param {(request: object, call: number) => any} options.respond
 *   Returns a response from jsonResponse(), a plain body (200), a thrown
 *   error, or a Promise of either.
 */
function loadBackground(options) {
  const opts = options || {};
  const clock = createClock();
  const page = opts.page || createPage({ url: opts.url, html: opts.html, inject: opts.preinject || [] });
  const tab = {
    id: 7,
    url: opts.tabUrl || page.window.location.href,
    title: opts.tabTitle || page.document.title,
    status: "complete",
    active: true,
  };

  const runtimeListeners = [];
  const updatedListeners = [];
  const broadcasts = [];
  const tabMessages = [];
  const calls = [];
  let tabClosed = false;

  const chrome = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      sendMessage(message, cb) {
        broadcasts.push(message);
        if (cb) cb();
      },
      getPlatformInfo(cb) {
        if (cb) cb({ os: "linux" });
      },
    },
    tabs: {
      async query() {
        return [tab];
      },
      async get(id) {
        if (tabClosed || id !== tab.id) throw new Error("No tab with id: " + id);
        return { ...tab };
      },
      sendMessage(id, message, _opts, cb) {
        tabMessages.push(message);
        const done = (value, error) => {
          chrome.runtime.lastError = error ? { message: error } : undefined;
          try {
            if (cb) cb(value);
          } finally {
            chrome.runtime.lastError = undefined;
          }
        };
        if (tabClosed || id !== tab.id) {
          setImmediate(() => done(undefined, "No tab with id: " + id));
          return;
        }
        if (!page.hasListeners()) {
          setImmediate(() => done(undefined, "Could not establish connection. Receiving end does not exist."));
          return;
        }
        page.deliver(message).then((value) => setImmediate(() => done(value)));
      },
      onUpdated: {
        addListener: (fn) => updatedListeners.push(fn),
        removeListener: (fn) => {
          const i = updatedListeners.indexOf(fn);
          if (i >= 0) updatedListeners.splice(i, 1);
        },
      },
    },
    scripting: {
      async executeScript({ files }) {
        if (opts.scriptingError) throw new Error(opts.scriptingError);
        for (const file of files) page.inject(file);
        return [{ result: undefined }];
      },
    },
  };

  async function fetch(url, init) {
    const request = JSON.parse(init.body);
    const call = { url, init, request, at: clock.now() };
    calls.push(call);
    clock.advance(opts.latencyMs == null ? 90 : opts.latencyMs);
    const out = await opts.respond(request, calls.length, call);
    if (out && typeof out.status === "number" && out.headers) return out;
    return jsonResponse(200, out);
  }

  const context = {
    chrome,
    fetch,
    console,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask,
    Date: clock.Date,
    performance: clock.performance,
    AbortSignal: { timeout: () => ({ aborted: false }) },
    URL,
    URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(read("background.js"), context, { filename: "background.js" });

  function send(message, sender) {
    return new Promise((resolve) => {
      const listener = runtimeListeners[0];
      const handled = listener(message, sender || {}, resolve);
      if (!handled) resolve(undefined);
    });
  }

  async function status() {
    return send({ type: "GET_STATUS" });
  }

  async function waitFor(predicate, label, maxTicks) {
    const limit = maxTicks || 5000;
    for (let i = 0; i < limit; i += 1) {
      const state = await status();
      if (predicate(state)) return state;
      await new Promise((r) => setImmediate(r));
    }
    const state = await status();
    throw new Error("Timed out waiting for " + (label || "condition") + ". State: " + JSON.stringify(state, null, 2));
  }

  function start(extra) {
    return send({
      type: "START",
      apiKey: "sk-mock-not-a-real-key",
      goal: "Search for flights from Melbourne to Tokyo",
      provider: "beatapi",
      ...(extra || {}),
    });
  }

  return {
    chrome,
    page,
    tab,
    clock,
    calls,
    broadcasts,
    tabMessages,
    context,
    send,
    status,
    start,
    waitFor,
    idle: () => waitFor((s) => !s.running || s.paused, "run to settle"),
    closeTab() {
      tabClosed = true;
    },
    evaluate: (code) => vm.runInContext(code, context),
  };
}

module.exports = { loadBackground, jsonResponse, timeoutError };
