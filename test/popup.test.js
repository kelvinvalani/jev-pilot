const test = require("node:test");
const assert = require("node:assert/strict");
const { loadPopup } = require("./helpers/popup");

const KEY = { TYPESAFE_API_KEY: "sk-mock", jevProvider: "beatapi" };

test("first run without a key opens Settings instead of the task form", async () => {
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

test("Run sends START with the trimmed goal, key and provider", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  assert.ok(p.visible("mainView"));
  p.type("goal", "  Search for flights from Melbourne to Tokyo  ");
  p.$("taskForm").requestSubmit();
  await p.settle();
  const start = p.sent.find((m) => m.type === "START");
  assert.deepEqual(JSON.parse(JSON.stringify(start)), {
    type: "START",
    apiKey: "sk-mock",
    goal: "Search for flights from Melbourne to Tokyo",
    provider: "beatapi",
  });
});

test("Run with an empty goal shows an inline error and sends nothing", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.type("goal", "   ");
  p.$("taskForm").requestSubmit();
  await p.settle();
  assert.ok(p.visible("formError"));
  assert.ok(!p.sent.some((m) => m.type === "START"));
});

test("example chips fill the goal", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.document.querySelector("[data-example]").click();
  assert.equal(p.$("goal").value, "Search for flights from Melbourne to Tokyo");
  assert.equal(p.$("goalCount").textContent, "42 / 2000");
});

test("running state shows progress, hides the form, and renders step cards", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.push({
    running: true,
    step: 3,
    goal: "Search flights",
    logs: [
      { level: "system", text: "Started", kind: "start" },
      { level: "system", text: "[Step 1] Extracted 6 elements", kind: "extract" },
      { level: "action", text: "[Step 1]", kind: "step", step: 1, action: "type", targetId: "elem_0", targetLabel: "Origin", confidence: 0.97, latencyMs: 88 },
      { level: "system", text: "Typed “Melbourne” into Origin.", kind: "result" },
    ],
  });
  assert.ok(p.visible("runCard"));
  assert.ok(!p.visible("taskForm"));
  assert.equal(p.$("statusText").textContent, "Step 3 of 15");
  assert.equal(p.$("progressBar").style.width, "20%");
  const steps = p.document.querySelectorAll("#timeline .step");
  assert.equal(steps.length, 1);
  assert.match(steps[0].textContent, /TYPE.*Origin.*97% confident.*88 ms/s);
  assert.match(steps[0].textContent, /Typed “Melbourne”/);
  assert.ok(!p.document.querySelector("#timeline").textContent.includes("Extracted"), "extract noise hidden");
  p.click("stopBtn");
  await p.settle();
  assert.ok(p.sent.some((m) => m.type === "STOP"));
});

test("low-confidence review card shows the proposal and sends CONFIRM / SKIP", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.push({
    running: true,
    paused: true,
    step: 3,
    pendingConfirmation: {
      step: 3,
      reason: "confidence",
      title: "Low confidence — review this step",
      message: "Jev is 42% confident.",
      targetId: "elem_4",
      targetLabel: "Search flights",
      actionType: "click",
      confidence: 0.42,
      suggestedText: "",
    },
  });
  assert.ok(p.visible("confirmCard"));
  assert.equal(p.$("statusText").textContent, "Needs review");
  assert.equal(p.$("confirmAction").textContent, "CLICK");
  assert.equal(p.$("confirmTarget").textContent, "Search flights");
  assert.equal(p.$("confirmConfidence").textContent, "42%");
  assert.ok(!p.visible("confirmTextRow"));
  p.click("confirmBtn");
  await p.settle();
  assert.ok(p.sent.some((m) => m.type === "CONFIRM"));
  p.click("skipBtn");
  await p.settle();
  assert.ok(p.sent.some((m) => m.type === "SKIP"));
});

test("text review prefills the suggestion and refuses to confirm empty text", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.push({
    running: true,
    paused: true,
    step: 1,
    pendingConfirmation: {
      step: 1,
      reason: "complex_text",
      title: "Review the text to type",
      message: "Check it",
      targetId: "elem_0",
      targetLabel: "Origin",
      actionType: "type",
      confidence: 0.9,
      suggestedText: "Melbourne",
    },
  });
  await p.settle();
  assert.ok(p.visible("confirmTextRow"));
  assert.equal(p.$("confirmInput").value, "Melbourne");
  p.$("confirmInput").value = "";
  p.click("confirmBtn");
  await p.settle();
  assert.ok(!p.sent.some((m) => m.type === "CONFIRM"));
  p.$("confirmInput").value = "Melbourne (MEL)";
  p.click("confirmBtn");
  await p.settle();
  const confirm = p.sent.find((m) => m.type === "CONFIRM");
  assert.equal(confirm.textValue, "Melbourne (MEL)");
});

test("error and success results render as banners", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.push({ lastError: "BeatAPI rejected this API key (HTTP 401).", logs: [{ level: "error", text: "x", kind: "error" }] });
  assert.ok(p.visible("resultCard"));
  assert.match(p.$("resultCard").className, /is-error/);
  assert.match(p.$("resultText").textContent, /HTTP 401/);
  assert.equal(p.$("statusText").textContent, "Error");
  p.push({ finished: true, logs: [{ level: "done", text: "Jev reported the goal is complete.", kind: "finish" }] });
  assert.match(p.$("resultCard").className, /is-success/);
  assert.equal(p.$("resultTitle").textContent, "Goal complete");
});

test("rate-limit waits show a countdown", async () => {
  const p = loadPopup({ storage: KEY });
  await p.settle();
  p.push({ running: true, step: 1, waitingUntil: Date.now() + 42000, waitReason: "Waiting for the BeatAPI rate limit" });
  assert.ok(p.visible("waitNotice"));
  assert.match(p.$("waitNotice").textContent, /Waiting for the BeatAPI rate limit — 4[12]s left/);
  assert.equal(p.$("statusText").textContent, "Waiting");
  p.push({ running: false });
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

test("preview mode (no chrome): mock run pauses for review, then finishes after confirm", async () => {
  const p = loadPopup({ extension: false });
  await p.settle();
  assert.ok(p.document.documentElement.classList.contains("surface-preview"));
  assert.ok(p.visible("mainView"), "preview does not require a key");
  p.$("taskForm").requestSubmit();
  for (let i = 0; i < 60 && p.$("confirmCard").hidden; i += 1) await p.sleep(100);
  assert.ok(p.visible("confirmCard"), "mock pauses on its low-confidence step");
  p.click("confirmBtn");
  for (let i = 0; i < 60 && p.$("resultCard").hidden; i += 1) await p.sleep(100);
  assert.equal(p.$("resultTitle").textContent, "Goal complete");
  assert.equal(p.document.querySelectorAll("#timeline .step").length, 4);
});
