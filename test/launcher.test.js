const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage } = require("./helpers/page");

function mount(storage) {
  const page = createPage({ storage, inject: ["launcher.js"] });
  const host = page.document.getElementById("jev-fast-launcher-root");
  const shadow = host && host.shadowRoot;
  return {
    page,
    host,
    shadow,
    layer: () => shadow.querySelector(".layer"),
    button: () => shadow.querySelector(".launcher"),
    frame: () => shadow.querySelector("iframe"),
    isOpen: () => shadow.querySelector(".layer").classList.contains("open"),
  };
}

test("mounts a single bottom-right launcher in an isolated shadow root", () => {
  const l = mount();
  assert.ok(l.host, "host exists");
  assert.equal(l.host.dataset.jevFastUi, "true");
  assert.equal(l.host.hidden, false);
  assert.equal(l.button().getAttribute("aria-label"), "Open Jev Fast");
  assert.equal(l.frame(), null, "iframe is created lazily");
  l.page.inject("launcher.js");
  assert.equal(l.page.document.querySelectorAll("#jev-fast-launcher-root").length, 1);
});

test("clicking the launcher opens the overlay with the extension UI, clicking again closes", () => {
  const l = mount();
  l.button().click();
  assert.ok(l.isOpen());
  assert.equal(l.button().getAttribute("aria-expanded"), "true");
  assert.equal(l.frame().src, "chrome-extension://jevfastmockextensionid/popup.html?surface=overlay");
  assert.equal(l.page.window.sessionStorage.getItem("jevFastOverlayOpen"), "1");
  l.button().click();
  assert.ok(!l.isOpen());
  assert.equal(l.button().getAttribute("aria-label"), "Open Jev Fast");
});

test("Escape closes the overlay", () => {
  const l = mount();
  l.button().click();
  l.page.window.dispatchEvent(new l.page.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!l.isOpen());
});

test("a CLOSE message from the overlay iframe closes it; other windows are ignored", () => {
  const l = mount();
  l.button().click();
  const { window } = l.page;
  window.dispatchEvent(new window.MessageEvent("message", { data: { source: "jev-fast", type: "CLOSE" }, source: window }));
  assert.ok(l.isOpen(), "message from the page itself is ignored");
  window.dispatchEvent(
    new window.MessageEvent("message", { data: { source: "jev-fast", type: "CLOSE" }, source: l.frame().contentWindow })
  );
  assert.ok(!l.isOpen());
});

test("run status drives the badge and auto-opens when a step needs review", async () => {
  const l = mount();
  const send = (status) => l.page.deliver({ type: "JEV_FAST_STATUS", status });
  await send({ running: true, paused: false });
  assert.equal(l.layer().dataset.status, "running");
  assert.ok(!l.isOpen());
  await send({ running: true, paused: true });
  assert.equal(l.layer().dataset.status, "paused");
  assert.ok(l.isOpen(), "opens so the user can confirm");
  await send({ running: false, error: true });
  assert.equal(l.layer().dataset.status, "error");
  await send({ running: false, finished: true });
  assert.equal(l.layer().dataset.status, "idle");
});

test("hidden when the user turns the floating button off, and reacts live to the setting", () => {
  const l = mount({ showLauncher: false });
  assert.equal(l.host.hidden, true);
  l.page.window.chrome.storage.sync.set({ showLauncher: true });
  assert.equal(l.host.hidden, false);
  l.button().click();
  l.page.window.chrome.storage.sync.set({ showLauncher: false });
  assert.equal(l.host.hidden, true);
  assert.ok(!l.isOpen());
});

test("restores the open overlay after same-tab navigation", () => {
  const page = createPage();
  page.window.sessionStorage.setItem("jevFastOverlayOpen", "1");
  page.inject("launcher.js");
  const layer = page.document.getElementById("jev-fast-launcher-root").shadowRoot.querySelector(".layer");
  assert.ok(layer.classList.contains("open"));
});

test("does not respond to background EXTRACT/EXECUTE messages", async () => {
  const l = mount();
  const res = await l.page.deliver({ type: "EXTRACT" });
  assert.equal(res, undefined);
});
