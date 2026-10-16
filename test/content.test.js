const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage } = require("./helpers/page");

function demo(inject) {
  return createPage({ inject: inject || ["content.js"] });
}

function labelsOf(res) {
  return Array.from(res.elements, (e) => e.label);
}

async function extract(page) {
  const res = await page.deliver({ type: "EXTRACT" });
  assert.equal(res.ok, true);
  return res;
}

test("EXTRACT lists visible controls with readable labels from the demo page", async () => {
  const page = demo();
  const res = await extract(page);
  assert.ok(res.title.length > 0);
  assert.equal(res.url, "https://flights.example.test/search");
  const byLabel = Object.fromEntries(res.elements.map((e) => [e.label, e]));
  const labels = res.elements.map((e) => e.label);
  assert.ok(labels.some((l) => /^Origin/.test(l)), labels.join(" | "));
  assert.ok(labels.some((l) => /^Destination/.test(l)));
  assert.ok(labels.some((l) => /Search flights/.test(l)));
  for (const el of res.elements) {
    assert.match(el.id, /^elem_\d+$/);
    assert.ok(el.tag && el.type, JSON.stringify(el));
  }
  assert.equal(Object.keys(byLabel).length, res.elements.length, "labels should be unique on the demo page");
  assert.equal(page.document.querySelectorAll("[data-jev-id]").length, res.elements.length);
});

test("EXTRACT skips hidden, aria-hidden and type=hidden controls", async () => {
  const page = createPage({
    html: `<!doctype html><title>t</title>
      <button id="ok">Visible</button>
      <button style="display:none">Gone</button>
      <button style="visibility:hidden">Invisible</button>
      <button aria-hidden="true">Aria hidden</button>
      <input type="hidden" name="csrf" value="x" />
      <div hidden><a href="/x">Hidden link</a></div>`,
    inject: ["content.js"],
  });
  const res = await extract(page);
  assert.deepEqual(
    labelsOf(res),
    ["Visible"]
  );
});

test("EXTRACT reaches into open shadow roots", async () => {
  const page = createPage({ html: "<!doctype html><title>t</title><div id='host'></div>" });
  const shadow = page.document.getElementById("host").attachShadow({ mode: "open" });
  shadow.innerHTML = "<button>Inside shadow</button>";
  page.inject("content.js");
  const res = await extract(page);
  assert.deepEqual(labelsOf(res), ["Inside shadow"]);
  const click = await page.deliver({ type: "EXECUTE", targetId: res.elements[0].id, actionType: "click" });
  assert.equal(click.ok, true);
});

test("the floating launcher is never offered to Jev as a target", async () => {
  const page = createPage({ inject: ["launcher.js", "content.js"] });
  assert.ok(page.document.getElementById("jev-fast-launcher-root"), "launcher mounted");
  const res = await extract(page);
  assert.ok(!res.elements.some((e) => /Jev Fast/i.test(e.label)), res.elements.map((e) => e.label).join(" | "));
});

test("TYPE uses the native value setter and fires input/change for frameworks", async () => {
  const page = demo();
  const origin = page.document.getElementById("origin");
  const seen = [];
  for (const type of ["keydown", "input", "keyup", "change"]) origin.addEventListener(type, () => seen.push(type));
  let setterCalls = 0;
  const proto = page.window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  Object.defineProperty(origin, "value", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
      // React-style instance override: bypassing it is what lets React notice.
      desc.set.call(this, "WRONG:" + v);
    },
  });
  Object.defineProperty(proto, "value", {
    configurable: true,
    get: desc.get,
    set(v) {
      setterCalls += 1;
      desc.set.call(this, v);
    },
  });
  const res = await extract(page);
  const id = res.elements.find((e) => /^Origin/.test(e.label)).id;
  const out = await page.deliver({ type: "EXECUTE", targetId: id, actionType: "type", textValue: "Melbourne" });
  Object.defineProperty(proto, "value", desc);
  assert.equal(out.ok, true);
  assert.equal(desc.get.call(origin), "Melbourne");
  assert.equal(setterCalls, 1);
  assert.ok(seen.includes("input") && seen.includes("change"), seen.join(","));
  assert.equal(page.document.querySelectorAll("[data-jev-id]").length, 0, "markers cleared after execute");
});

test("TYPE on a select picks the matching option by label", async () => {
  const page = demo();
  const res = await extract(page);
  const id = res.elements.find((e) => e.type === "select").id;
  const out = await page.deliver({ type: "EXECUTE", targetId: id, actionType: "type", textValue: "business" });
  assert.equal(out.ok, true);
  assert.equal(page.document.getElementById("cabin").value, "business");
});

test("TYPE on a button is coerced into a single click", async () => {
  const page = demo();
  const res = await extract(page);
  const id = res.elements.find((e) => /Search flights/.test(e.label)).id;
  const out = await page.deliver({ type: "EXECUTE", targetId: id, actionType: "type", textValue: "x" });
  assert.equal(out.ok, true);
  assert.equal(out.coerced, "click");
  assert.equal(page.document.getElementById("results").hidden, false);
});

test("CLICK activates exactly once (no double submit, checkbox really toggles)", async () => {
  const page = createPage({
    html: `<!doctype html><title>t</title>
      <form id="f"><label><input type="checkbox" id="c" /> Accept terms</label><button>Send</button></form>`,
    inject: ["content.js"],
  });
  let submits = 0;
  page.document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    submits += 1;
  });
  const box = (await extract(page)).elements.find((e) => e.type === "checkbox").id;
  await page.deliver({ type: "EXECUTE", targetId: box, actionType: "click" });
  assert.equal(page.document.getElementById("c").checked, true);
  const send = (await extract(page)).elements.find((e) => /Send/.test(e.label)).id;
  await page.deliver({ type: "EXECUTE", targetId: send, actionType: "click" });
  assert.equal(submits, 1);
});

test("TYPE into contenteditable sets text and fires input", async () => {
  const page = createPage({
    html: `<!doctype html><title>t</title><div contenteditable="true" role="textbox" aria-label="Message" onclick=""></div>`,
    inject: ["content.js"],
  });
  const res = await extract(page);
  const out = await page.deliver({ type: "EXECUTE", targetId: res.elements[0].id, actionType: "type", textValue: "Hi there" });
  assert.equal(out.ok, true);
  assert.equal(page.document.querySelector("[contenteditable]").textContent, "Hi there");
});

test("EXECUTE on a stale id fails cleanly", async () => {
  const page = demo();
  await extract(page);
  const out = await page.deliver({ type: "EXECUTE", targetId: "elem_99", actionType: "click" });
  assert.equal(out.ok, false);
  assert.match(out.error, /no longer in the DOM/);
});

test("content.js is idempotent when injected twice", async () => {
  const page = demo(["content.js", "content.js"]);
  const res = await extract(page);
  assert.ok(res.elements.length > 0);
});

test("EXTRACT reports field values, checked/disabled state, options and visible page text", async () => {
  const page = createPage({
    html: `<!doctype html><title>t</title><main>
      <h1>Account</h1><p>Signed out. Fill the form.</p>
      <input aria-label="Email" value="kim@example.test" />
      <input aria-label="Password" type="password" value="hunter2" />
      <label><input type="checkbox" checked /> Remember me</label>
      <select aria-label="Plan"><option>Free</option><option selected>Pro</option></select>
      <button disabled>Delete</button>
    </main>`,
    inject: ["content.js"],
  });
  const res = await extract(page);
  const by = (re) => res.elements.find((e) => re.test(e.label));
  assert.equal(by(/^Email/).value, "kim@example.test");
  assert.equal(by(/^Password/).value, "(filled)");
  assert.ok(!JSON.stringify(res).includes("hunter2"), "password values never leave the page");
  assert.equal(by(/Remember me/).checked, true);
  assert.equal(by(/^Plan/).value, "Pro");
  assert.deepEqual(Array.from(by(/^Plan/).options), ["Free", "Pro"]);
  assert.equal(by(/Delete/).disabled, true);
  assert.match(res.pageText, /Account Signed out\. Fill the form\./);
});

test("SUBMIT presses Enter and submits the enclosing form once", async () => {
  const page = createPage({
    html: `<!doctype html><title>t</title><form id="f"><input aria-label="Search" /></form>`,
    inject: ["content.js"],
  });
  const keys = [];
  let submits = 0;
  const input = page.document.querySelector("input");
  input.addEventListener("keydown", (e) => keys.push(e.key));
  page.document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    submits += 1;
  });
  const id = (await extract(page)).elements[0].id;
  const out = await page.deliver({ type: "EXECUTE", targetId: id, actionType: "submit" });
  assert.equal(out.ok, true);
  assert.deepEqual(keys, ["Enter"]);
  assert.equal(submits, 1);
});
