const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPopup } = require("./helpers/popup");

const KEY = { TYPESAFE_API_KEY: "sk-mock", jevProvider: "beatapi" };

test("first run without a key opens Settings", async () => {
  const p = loadPopup();
  await p.settle();
  await p.sleep(20);
  assert.ok(p.visible("settingsView"));
  assert.ok(!p.visible("mainView"));
  assert.equal(p.document.activeElement, p.$("apiKey"));
});

test("entering a key and provider is persisted to chrome.storage.sync", async () => {
  const p = loadPopup();
  await p.settle();
  p.document.querySelector('input[value="typesafe"]').click();
  assert.equal(p.$("keyLabel").textContent, "TypeSafe API key");
  assert.match(p.$("keyLink").href, /typesafe/);
  p.type("apiKey", "  ts-mock-key  ");
  await p.sleep(300);
  assert.equal(p.storage.TYPESAFE_API_KEY, "ts-mock-key");
  assert.equal(p.storage.jevProvider, "typesafe");
  p.click("settingsDone");
  assert.ok(p.visible("mainView"));
  assert.ok(!p.visible("setupCard"));
});

test("overlay surface: close button and Escape ask the page to close the overlay", async () => {
  const p = loadPopup({ storage: KEY, surface: "overlay" });
  await p.settle();
  assert.ok(p.document.documentElement.classList.contains("surface-overlay"));
  assert.ok(p.visible("closeBtn"));
  p.click("closeBtn");
  p.document.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const closes = p.parentMessages.filter((m) => m.data && m.data.type === "CLOSE" && m.data.source === "jev-fast");
  assert.equal(closes.length, 2);
});

test("toolbar popup surface hides the overlay close button", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  assert.ok(p.document.documentElement.classList.contains("surface-popup"));
  assert.ok(!p.visible("closeBtn"));
});

test("floating button toggle is saved", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.click("settingsBtn");
  const toggle = p.$("showLauncher");
  assert.equal(toggle.checked, true);
  toggle.click();
  assert.equal(p.storage.showLauncher, false);
});
