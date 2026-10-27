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


test("check card shows field wording, slot picker, mint name, and actions", async () => {
  const p = loadPopup({
    storage: KEY,
    state: {
      running: true,
      check: {
        fieldId: "field_0",
        wording: "Nickname",
        headingWording: "",
        preSelectedSlotId: null,
        proposedSlotName: "Nickname",
        optionRequired: false,
        optionLabels: [],
        slots: [
          { id: "slot_legal_first_name", name: "legal first name" },
          { id: "slot_family_name", name: "family name" },
        ],
      },
    },
  });
  await p.settle();
  await p.sleep(20);
  assert.ok(p.visible("checkCard"));
  assert.equal(p.$("checkWording").textContent, "Nickname");
  assert.equal(p.$("checkSlot").value, "__mint__");
  assert.ok(p.visible("checkMintRow"));
  assert.equal(p.$("checkMintName").value, "Nickname");
  assert.ok(p.visible("checkSaveBtn"));
  assert.ok(p.visible("checkSkipBtn"));
  assert.ok(p.visible("checkStopBtn"));
  assert.ok(!p.visible("fillCard"));
});

test("closing the overlay while a check is open sends STOP", async () => {
  const p = loadPopup({
    storage: KEY,
    surface: "overlay",
    state: {
      running: true,
      check: {
        fieldId: "field_0",
        wording: "Nickname",
        headingWording: "",
        preSelectedSlotId: null,
        proposedSlotName: "Nickname",
        optionRequired: false,
        optionLabels: [],
        slots: [{ id: "slot_legal_first_name", name: "legal first name" }],
      },
    },
  });
  await p.settle();
  await p.sleep(30);
  assert.ok(p.visible("checkCard"));
  p.click("closeBtn");
  await p.sleep(50);
  assert.ok(p.sent.some((m) => m.type === "STOP"), JSON.stringify(p.sent));
  assert.ok(p.parentMessages.some((m) => m.data && m.data.type === "CLOSE"));
});
