const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground } = require("./helpers/background");
const { answerFor, findOption, findField } = require("./fixtures/jev");

const SIMPLE_FORM = `<!doctype html><title>Signup</title>
  <form id="signup">
    <label for="first">First name</label>
    <input id="first" name="first" type="text" />
  </form>`;

function profileWithFirstName(answer) {
  return {
    jevProfile: {
      slots: [
        { id: "slot_legal_first_name", name: "legal first name", aliases: [] },
        { id: "slot_family_name", name: "family name", aliases: [] },
        { id: "slot_personal_email", name: "personal email", aliases: [] },
        { id: "slot_phone", name: "phone", aliases: [] },
        { id: "slot_street_address", name: "street address", aliases: [] },
        { id: "slot_city", name: "city", aliases: [] },
        { id: "slot_region", name: "region", aliases: [] },
        { id: "slot_postcode", name: "postcode", aliases: [] },
        { id: "slot_country", name: "country", aliases: [] },
      ],
      situations: [],
      answers: [{ slotId: "slot_legal_first_name", situationId: null, value: answer, optionWordings: [] }],
    },
  };
}

function confidentFirstName(request) {
  const fieldId = findField(request, /First name/);
  const option = findOption(request, /legal first name.*default/i);
  return answerFor(request, { fieldId, option, confidence: 0.85 });
}

test("a confident fill writes the stored answer into the empty text field", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });

  await bg.fill();
  const state = await bg.idle();

  assert.equal(state.running, false);
  assert.equal(state.lastError, "");
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.calls.length, 1);
});

test("a confident fill stores the field wording as an alias of the slot", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });

  await bg.fill();
  await bg.idle();

  const slot = bg.storage.jevProfile.slots.find((s) => s.name === "legal first name");
  assert.ok(slot);
  assert.ok(slot.aliases.map((a) => a.toLowerCase()).includes("first name"));
});

test("a later fill of the same wording writes the answer and sends no request", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });

  await bg.fill();
  await bg.idle();
  assert.equal(bg.calls.length, 1);

  bg.page.document.getElementById("first").value = "";
  await bg.fill();
  await bg.idle();

  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.calls.length, 1, "alias hit must not call Jev");
});

test("the request carries field wording, slot names, and aliases, and no answer string", async () => {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.slots[0].aliases = ["Given name"];
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage,
    respond: confidentFirstName,
  });

  await bg.fill();
  await bg.idle();

  const body = bg.calls[0].request;
  assert.equal(bg.calls[0].url, "https://api.beatapi.io/v1/systemone");
  assert.equal(bg.calls[0].init.headers.Authorization, "Bearer sk-mock-not-a-real-key");
  assert.equal(body.model, "jev-1.14-free");
  assert.deepEqual(
    body.state.fields.map((f) => ({ wording: f.wording, headingWording: f.headingWording })),
    [{ wording: "First name", headingWording: "" }]
  );
  assert.ok(body.state.slots.some((s) => s.name === "legal first name" && s.aliases.includes("Given name")));
  assert.ok(body.state.slots.some((s) => s.name === "personal email"));
  assert.ok(!body.state.slots.some((s) => /work email/i.test(s.name)));
  const blob = JSON.stringify(body);
  assert.ok(!blob.includes("Alex"), "answer strings must stay out of the request");
  assert.equal(blob.includes("user_goal"), false);
  assert.equal("interactive_elements" in body.state, false);
});

test("a missing API key opens Settings and sends no request", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => assert.fail("must not call Jev"),
  });

  const state = await bg.fill({ apiKey: "  " });
  assert.equal(state.running, false);
  assert.equal(state.openSettings, true);
  assert.match(state.lastError, /Add your BeatAPI API key/);
  assert.equal(bg.calls.length, 0);
  assert.equal(bg.page.document.getElementById("first").value, "");
});

test("a text write uses the native value setter and fires input and change", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  const input = bg.page.document.getElementById("first");
  const seen = [];
  for (const type of ["input", "change"]) input.addEventListener(type, () => seen.push(type));
  let setterCalls = 0;
  const proto = bg.page.window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
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

  await bg.fill();
  await bg.idle();
  Object.defineProperty(proto, "value", desc);

  assert.equal(desc.get.call(input), "Alex");
  assert.equal(setterCalls, 1);
  assert.ok(seen.includes("input") && seen.includes("change"), seen.join(","));
});

test("a new profile contains the empty starter slots", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    respond: confidentFirstName,
  });

  await bg.fill();
  await bg.idle();

  const names = bg.storage.jevProfile.slots.map((s) => s.name);
  assert.equal(
    names.join("\n"),
    [
      "legal first name",
      "family name",
      "personal email",
      "phone",
      "street address",
      "city",
      "region",
      "postcode",
      "country",
    ].join("\n")
  );
  assert.ok(!names.includes("work email"));
  assert.equal(bg.storage.jevProfile.answers.length, 0);
});

test("TypeSafe provider uses its own endpoint and model", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  await bg.fill({ provider: "typesafe", apiKey: "ts-mock-key" });
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(bg.calls[0].request.model, "jev-latest");
  assert.equal(bg.calls[0].init.headers.Authorization, "Bearer ts-mock-key");
  assert.equal(state.providerName, "TypeSafe");
});

test("a localhost test endpoint replaces the provider URL; remote overrides are refused", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  let state = await bg.fill({ endpoint: "https://evil.example.com/v1/systemone" });
  assert.equal(state.running, false);
  assert.match(state.lastError, /must be on localhost/);
  state = await bg.fill({ endpoint: "not a url" });
  assert.match(state.lastError, /not a valid URL/);
  assert.equal(bg.calls.length, 0);

  state = await bg.fill({ endpoint: "http://127.0.0.1:41786/v1/systemone" });
  assert.equal(state.localEndpoint, true);
  state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.calls[0].url, "http://127.0.0.1:41786/v1/systemone");
  assert.equal(bg.calls[0].request.model, "jev-1.14-free");
});

test("injects content.js on demand when the page has no listener yet", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  assert.equal(bg.page.hasListeners(), false);
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.ok(bg.page.injected.has("content.js"));
});

for (const url of ["chrome://settings/", "https://chromewebstore.google.com/detail/x", "chrome-extension://abc/popup.html"]) {
  test("refuses restricted page " + url + " before calling the API", async () => {
    const bg = loadBackground({
      html: SIMPLE_FORM,
      tabUrl: url,
      storage: profileWithFirstName("Alex"),
      respond: () => assert.fail("must not call API"),
    });
    const state = await bg.fill();
    assert.equal(state.running, false);
    assert.match(state.lastError, /doesn't allow extensions to control this page/);
    assert.equal(bg.calls.length, 0);
  });
}

test("the API key never appears in logs or broadcast state", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  await bg.fill({ apiKey: "sk-super-secret-123" });
  await bg.idle();
  const everything = JSON.stringify(bg.broadcasts) + JSON.stringify(await bg.status());
  assert.ok(!everything.includes("sk-super-secret-123"));
});

test("status is broadcast to the popup and the page launcher", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  await bg.fill();
  await bg.idle();
  assert.ok(bg.broadcasts.some((m) => m.type === "STATE" && m.state.running));
  assert.ok(bg.broadcasts.some((m) => m.type === "STATE" && m.state.finished));
  assert.ok(bg.tabMessages.some((m) => m.type === "JEV_FAST_STATUS" && m.status.running));
});


function profileWithEmail(answer) {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.answers.push({
    slotId: "slot_personal_email",
    situationId: null,
    value: answer,
    optionWordings: [],
  });
  storage.jevProfile.slots.find((s) => s.id === "slot_personal_email").aliases = ["Email", "Personal email"];
  return storage;
}

function profileWithCity(answer) {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.answers.push({
    slotId: "slot_city",
    situationId: null,
    value: answer,
    optionWordings: [],
  });
  storage.jevProfile.slots.find((s) => s.id === "slot_city").aliases = ["City"];
  return storage;
}

function answerAllConfident(request) {
  const answers = {};
  const fields = (request.state && request.state.fields) || [];
  for (const field of fields) {
    let option = "none";
    if (/first name/i.test(field.wording)) option = findOption(request, /legal first name.*default/i);
    else if (/email/i.test(field.wording)) option = findOption(request, /personal email.*default/i);
    else if (/city/i.test(field.wording)) option = findOption(request, /city.*default/i);
    const q = request.questions[field.id];
    const probabilities = { [option]: option === "none" ? 0.9 : 0.95 };
    if (q && q.criteria) {
      for (const key of Object.keys(q.criteria)) {
        if (!(key in probabilities)) probabilities[key] = 0;
      }
    }
    answers[field.id] = {
      type: "choice",
      choice: option,
      confidence: option === "none" ? 0.9 : 0.95,
      probabilities,
    };
  }
  return {
    id: "sys1_mock_form",
    object: "systemone.response",
    model: request.model,
    created: 1790000000,
    answers,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    latency_ms: 10,
  };
}

test("a focused field inside a form tag fills that tag and leaves a second form alone", async () => {
  const html = `<!doctype html><title>Two forms</title>
    <form id="checkout">
      <label for="first">First name</label>
      <input id="first" type="text" />
      <label for="email">Email</label>
      <input id="email" type="email" />
    </form>
    <form id="newsletter">
      <label for="list">Email</label>
      <input id="list" type="email" />
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithEmail("alex@example.com"),
    respond: answerAllConfident,
  });
  await bg.fill({ focusedSelector: "#email" });
  await bg.idle();
  assert.equal(bg.page.document.getElementById("email").value, "alex@example.com");
  assert.equal(bg.page.document.getElementById("first").value, "Alex", "same form may also fill");
  assert.equal(bg.page.document.getElementById("list").value, "", "second form left alone");
});

test("a focused field outside any form tag fills the visual group under its nearest heading", async () => {
  const html = `<!doctype html><title>Sections</title>
    <h2>Shipping</h2>
    <label for="city">City</label>
    <input id="city" type="text" />
    <label for="first">First name</label>
    <input id="first" type="text" />
    <h2>Newsletter</h2>
    <label for="email">Email</label>
    <input id="email" type="email" />`;
  const bg = loadBackground({
    html,
    storage: profileWithCity("Sydney"),
    respond: answerAllConfident,
  });
  await bg.fill({ focusedSelector: "#city" });
  await bg.idle();
  assert.equal(bg.page.document.getElementById("city").value, "Sydney");
  assert.equal(bg.page.document.getElementById("first").value, "Alex", "same heading group may also fill");
  assert.equal(bg.page.document.getElementById("email").value, "", "other heading group left alone");
});

test("a focused field with no heading fills the fields that share its parent", async () => {
  const html = `<!doctype html><title>Parents</title>
    <div id="group-a">
      <label for="first">First name</label>
      <input id="first" type="text" />
      <label for="city">City</label>
      <input id="city" type="text" />
    </div>
    <div id="group-b">
      <label for="email">Email</label>
      <input id="email" type="email" />
    </div>`;
  const bg = loadBackground({
    html,
    storage: profileWithCity("Melbourne"),
    respond: answerAllConfident,
  });
  await bg.fill({ focusedSelector: "#city" });
  await bg.idle();
  assert.equal(bg.page.document.getElementById("city").value, "Melbourne");
  assert.equal(bg.page.document.getElementById("first").value, "Alex", "same parent may also fill");
  assert.equal(bg.page.document.getElementById("email").value, "", "sibling parent left alone");
});

test("with nothing focused, the fill chooses the form tag with the most empty fields", async () => {
  const html = `<!doctype html><title>Most empty</title>
    <form id="small">
      <label for="email">Email</label>
      <input id="email" type="email" />
    </form>
    <form id="large">
      <label for="first">First name</label>
      <input id="first" type="text" />
      <label for="city">City</label>
      <input id="city" type="text" />
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithFirstName("Alex"),
    respond: answerAllConfident,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("email").value, "", "smaller form left alone");
});

test("with nothing focused and no form tag, the fill chooses the largest visual group", async () => {
  const html = `<!doctype html><title>Largest group</title>
    <h2>Tiny</h2>
    <label for="email">Email</label>
    <input id="email" type="email" />
    <h2>Big</h2>
    <label for="first">First name</label>
    <input id="first" type="text" />
    <label for="city">City</label>
    <input id="city" type="text" />`;
  const bg = loadBackground({
    html,
    storage: profileWithFirstName("Alex"),
    respond: answerAllConfident,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("email").value, "", "smaller visual group left alone");
});

test("a tie goes to the first form in tree order", async () => {
  const html = `<!doctype html><title>Tie</title>
    <form id="first-form">
      <label for="first">First name</label>
      <input id="first" type="text" />
    </form>
    <form id="second-form">
      <label for="email">Email</label>
      <input id="email" type="email" />
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithFirstName("Alex"),
    respond: answerAllConfident,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("email").value, "", "later tied form left alone");
});

test("a field that already has a value is left as it is", async () => {
  const html = `<!doctype html><title>Occupied</title>
    <form>
      <label for="first">First name</label>
      <input id="first" type="text" value="Sam" />
      <label for="email">Email</label>
      <input id="email" type="email" />
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithEmail("alex@example.com"),
    respond: answerAllConfident,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Sam", "occupied field unchanged");
  assert.equal(bg.page.document.getElementById("email").value, "alex@example.com");
});

test("FOCUS_CAPTURE from the page is used when FILL omits focusedSelector", async () => {
  const html = `<!doctype html><title>Capture</title>
    <form id="checkout">
      <label for="first">First name</label>
      <input id="first" type="text" />
    </form>
    <form id="newsletter">
      <label for="email">Email</label>
      <input id="email" type="email" />
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithFirstName("Alex"),
    respond: answerAllConfident,
  });
  await bg.send({ type: "FOCUS_CAPTURE", focusedSelector: "#first" }, { tab: { id: bg.tab.id } });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("email").value, "");
  assert.ok(bg.tabMessages.some((m) => m.type === "LIST_FORM" && m.focusedSelector === "#first"));
});
