/**
 * jsdom page with the extension content scripts injected and a fake
 * chrome.runtime.onMessage bus shared by content.js and launcher.js.
 */

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function createPage(options) {
  const opts = options || {};
  const html = opts.html || read("demo-page.html");
  const dom = new JSDOM(html, {
    url: opts.url || "https://flights.example.test/search",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  installLayoutStubs(window);

  const listeners = [];
  const storageListeners = [];
  const storage = { ...(opts.storage || {}) };
  window.chrome = {
    runtime: {
      id: "jevfastmockextensionid",
      lastError: undefined,
      getURL: (p) => "chrome-extension://jevfastmockextensionid/" + String(p).replace(/^\//, ""),
      onMessage: {
        addListener: (fn) => listeners.push(fn),
      },
      sendMessage: () => {},
    },
    storage: {
      sync: {
        get: (keys, cb) => {
          const out = {};
          for (const key of keys) if (key in storage) out[key] = storage[key];
          cb(out);
        },
        set: (values, cb) => {
          const changes = {};
          for (const [k, v] of Object.entries(values)) {
            changes[k] = { oldValue: storage[k], newValue: v };
            storage[k] = v;
          }
          for (const fn of storageListeners) fn(changes, "sync");
          if (cb) cb();
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  };

  const page = {
    dom,
    window,
    document: window.document,
    storage,
    injected: new Set(),
    inject(file) {
      window.eval(read(file) + "\n//# sourceURL=" + file);
      page.injected.add(file);
    },
    hasListeners: () => listeners.length > 0,
    /** Deliver a runtime message like chrome.tabs.sendMessage would. */
    deliver(message) {
      return new Promise((resolve) => {
        let responded = false;
        const sendResponse = (value) => {
          if (responded) return;
          responded = true;
          resolve(value);
        };
        for (const fn of listeners) {
          fn(JSON.parse(JSON.stringify(message)), {}, sendResponse);
          if (responded) return;
        }
        if (!responded) resolve(undefined);
      });
    },
    close: () => window.close(),
  };

  if (opts.inject) for (const file of opts.inject) page.inject(file);
  return page;
}

function installLayoutStubs(window) {
  const proto = window.HTMLElement.prototype;
  proto.getBoundingClientRect = function getBoundingClientRect() {
    const index = Array.prototype.indexOf.call(window.document.querySelectorAll("*"), this);
    const top = 20 + Math.max(0, index) * 4;
    return { x: 20, y: top, top, left: 20, width: 160, height: 32, right: 180, bottom: top + 32, toJSON() {} };
  };
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};
}

module.exports = { createPage, read, ROOT };
