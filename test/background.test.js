const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground, jsonResponse, timeoutError } = require("./helpers/background");
const { answerFor, errorBody, findOption, findField } = require("./fixtures/jev");

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

const TWO_FIELD_FORM = `<!doctype html><title>Signup</title>
  <form id="signup">
    <label for="first">First name</label>
    <input id="first" name="first" type="text" />
    <label for="nickname">Nickname</label>
    <input id="nickname" name="nickname" type="text" />
  </form>`;

function answersForFields(request, decisions) {
  const answers = {};
  for (const [pattern, decision] of decisions) {
    const fieldId = findField(request, pattern);
    const option =
      decision.option === "none"
        ? "none"
        : decision.option || findOption(request, decision.optionPattern || /legal first name.*default/i);
    answers[fieldId] = {
      type: "choice",
      choice: option,
      confidence: decision.confidence == null ? 0.95 : decision.confidence,
      probabilities: { [option]: decision.confidence == null ? 0.95 : decision.confidence },
    };
  }
  for (const id of Object.keys(request.questions)) {
    if (!answers[id]) {
      answers[id] = { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } };
    }
  }
  return {
    id: "sys1_mock_multi",
    object: "systemone.response",
    model: request.model,
    created: 1790000100,
    answers,
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    latency_ms: 40,
  };
}

test("a low-confidence choice opens a check after confident writes, in page order", async () => {
  const bg = loadBackground({
    html: TWO_FIELD_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const first = findField(request, /First name/);
      const nick = findField(request, /Nickname/);
      const firstOpt = findOption(request, /legal first name.*default/i);
      return {
        id: "sys1_mock_order",
        object: "systemone.response",
        model: request.model,
        created: 1790000200,
        answers: {
          [first]: { type: "choice", choice: firstOpt, confidence: 0.95, probabilities: { [firstOpt]: 0.95 } },
          [nick]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  const state = await bg.idle();

  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("nickname").value, "");
  assert.equal(state.running, true);
  assert.ok(state.check);
  assert.equal(state.check.wording, "Nickname");
  assert.equal(state.check.proposedSlotName, "Nickname");
  assert.ok(Array.isArray(state.check.slots));
  assert.ok(state.check.slots.some((s) => s.name === "legal first name"));
  const blob = JSON.stringify(state);
  assert.ok(!blob.includes("sk-mock"), "API key must stay out of status");
});

test("saving a check settles the slot and answer, then writes the field", async () => {
  const bg = loadBackground({
    html: TWO_FIELD_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const first = findField(request, /First name/);
      const nick = findField(request, /Nickname/);
      const firstOpt = findOption(request, /legal first name.*default/i);
      return {
        id: "sys1_mock_save",
        object: "systemone.response",
        model: request.model,
        created: 1790000300,
        answers: {
          [first]: { type: "choice", choice: firstOpt, confidence: 0.95, probabilities: { [firstOpt]: 0.95 } },
          [nick]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  assert.equal((await bg.status()).check.wording, "Nickname");

  await bg.send({
    type: "RESOLVE_CHECK",
    slotId: "slot_legal_first_name",
    answer: "Ace",
  });
  const state = await bg.idle();
  assert.equal(state.check, null);
  assert.equal(state.finished, true);
  assert.equal(bg.page.document.getElementById("nickname").value, "Ace");
  const slot = bg.storage.jevProfile.slots.find((s) => s.id === "slot_legal_first_name");
  assert.ok(slot.aliases.map((a) => a.toLowerCase()).includes("nickname"));
  const answer = bg.storage.jevProfile.answers.find(
    (a) => a.slotId === "slot_legal_first_name" && a.situationId === null
  );
  assert.equal(answer.value, "Ace");
});

test("minting uses the field wording as the slot name and first alias", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM.replace("First name", "Loyalty number").replace('id="first"', 'id="loyalty"').replace('for="first"', 'for="loyalty"'),
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const fieldId = findField(request, /Loyalty number/);
      return {
        id: "sys1_mock_mint",
        object: "systemone.response",
        model: request.model,
        created: 1790000400,
        answers: {
          [fieldId]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  const check = (await bg.status()).check;
  assert.equal(check.wording, "Loyalty number");
  assert.equal(check.proposedSlotName, "Loyalty number");

  await bg.send({ type: "RESOLVE_CHECK", mintName: "Loyalty number", answer: "L-42" });
  await bg.idle();

  assert.equal(bg.page.document.getElementById("loyalty").value, "L-42");
  const minted = bg.storage.jevProfile.slots.find((s) => s.name === "Loyalty number");
  assert.ok(minted, "minted slot exists");
  assert.ok(minted.aliases.includes("Loyalty number"));
  const answer = bg.storage.jevProfile.answers.find((a) => a.slotId === minted.id && a.situationId === null);
  assert.equal(answer.value, "L-42");
});

test("the person can edit the minted slot name before save", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM.replace("First name", "Loyalty number").replace('id="first"', 'id="loyalty"').replace('for="first"', 'for="loyalty"'),
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const fieldId = findField(request, /Loyalty number/);
      return {
        id: "sys1_mock_mint_edit",
        object: "systemone.response",
        model: request.model,
        created: 1790000410,
        answers: {
          [fieldId]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  await bg.send({ type: "RESOLVE_CHECK", mintName: "shop loyalty id", answer: "L-99" });
  await bg.idle();

  const minted = bg.storage.jevProfile.slots.find((s) => s.name === "shop loyalty id");
  assert.ok(minted);
  assert.ok(minted.aliases.includes("Loyalty number"));
  assert.equal(bg.page.document.getElementById("loyalty").value, "L-99");
});

test("skip leaves the field blank, stores nothing, and opens the next check", async () => {
  const bg = loadBackground({
    html: TWO_FIELD_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const first = findField(request, /First name/);
      const nick = findField(request, /Nickname/);
      return {
        id: "sys1_mock_skip",
        object: "systemone.response",
        model: request.model,
        created: 1790000500,
        answers: {
          [first]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
          [nick]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  let state = await bg.idle();
  assert.equal(state.check.wording, "First name");

  await bg.send({ type: "SKIP" });
  state = await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "");
  assert.equal(state.check.wording, "Nickname");
  assert.equal(bg.storage.jevProfile.answers.length, 1, "skip stores nothing new");
});

test("a skipped field is asked again on a later fill", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const fieldId = findField(request, /First name/);
      return {
        id: "sys1_mock_skip_later",
        object: "systemone.response",
        model: request.model,
        created: 1790000600,
        answers: {
          [fieldId]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  await bg.send({ type: "SKIP" });
  await bg.idle();
  assert.equal((await bg.status()).finished, true);
  assert.equal(bg.page.document.getElementById("first").value, "");
  const callsAfterSkip = bg.calls.length;

  await bg.fill();
  const state = await bg.idle();
  assert.ok(state.check);
  assert.equal(state.check.wording, "First name");
  assert.equal(bg.calls.length, callsAfterSkip + 1);
});

test("stop ends remaining checks while keeping writes already made", async () => {
  const bg = loadBackground({
    html: TWO_FIELD_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const first = findField(request, /First name/);
      const nick = findField(request, /Nickname/);
      const firstOpt = findOption(request, /legal first name.*default/i);
      return {
        id: "sys1_mock_stop",
        object: "systemone.response",
        model: request.model,
        created: 1790000700,
        answers: {
          [first]: { type: "choice", choice: firstOpt, confidence: 0.95, probabilities: { [firstOpt]: 0.95 } },
          [nick]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.ok((await bg.status()).check);

  await bg.send({ type: "STOP" });
  const state = await bg.status();
  assert.equal(state.running, false);
  assert.equal(state.check, null);
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("nickname").value, "");
});

test("a choice below 0.85 opens a check even when a slot was picked", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const fieldId = findField(request, /First name/);
      const option = findOption(request, /legal first name.*default/i);
      return answerFor(request, { fieldId, option, confidence: 0.84 });
    },
  });

  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "");
  assert.ok(state.check);
  assert.equal(state.check.wording, "First name");
  assert.equal(state.check.preSelectedSlotId, "slot_legal_first_name");
});

test("a second fill is refused while one is in progress", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond(request) {
      const fieldId = findField(request, /First name/);
      return {
        id: "sys1_mock_busy",
        object: "systemone.response",
        model: request.model,
        created: 1790000800,
        answers: {
          [fieldId]: { type: "choice", choice: "none", confidence: 0.9, probabilities: { none: 0.9 } },
        },
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latency_ms: 20,
      };
    },
  });

  await bg.fill();
  await bg.idle();
  assert.ok((await bg.status()).check);

  const state = await bg.fill();
  assert.match(state.lastError, /already in progress/i);
  assert.ok((await bg.status()).check, "original check remains");
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

function logTexts(state) {
  return state.logs.map((l) => l.text);
}

function twoFieldForm() {
  return `<!doctype html><title>Signup</title>
  <form id="signup">
    <label for="first">First name</label>
    <input id="first" name="first" type="text" />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" />
  </form>`;
}

function profileWithAliasAndEmail() {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.slots[0].aliases = ["First name"];
  storage.jevProfile.answers.push({
    slotId: "slot_personal_email",
    situationId: null,
    value: "alex@example.com",
    optionWordings: [],
  });
  return storage;
}

test("429 with Retry-After waits the advised time, then the fill succeeds", async () => {
  let n = 0;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (request) => {
      n += 1;
      if (n === 1) {
        return jsonResponse(429, errorBody(429, "rate_limit_exceeded", "Free tier: 1 request per minute"), {
          "Retry-After": "37",
        });
      }
      return confidentFirstName(request);
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.calls.length, 2);
  assert.ok(bg.calls[1].at - bg.calls[0].at >= 37000);
  assert.ok(logTexts(state).some((t) => /rate limit reached — waiting 37s/.test(t)));
});

test("529 waits and retries, then the fill succeeds", async () => {
  let n = 0;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (request) => {
      n += 1;
      if (n === 1) {
        return jsonResponse(529, errorBody(529, "overloaded", "Jev is busy"), { "Retry-After": "2" });
      }
      return confidentFirstName(request);
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.calls.length, 2);
  assert.ok(logTexts(state).some((t) => /Jev is overloaded/.test(t)));
});

test("429 without Retry-After on BeatAPI waits the free-tier 60s", async () => {
  let n = 0;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (request) => {
      n += 1;
      if (n === 1) return jsonResponse(429, errorBody(429, "rate_limit_exceeded", "Too many requests"));
      return confidentFirstName(request);
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.ok(bg.calls[1].at - bg.calls[0].at >= 60000);
});

test("429 retries are bounded (5 calls max) and end with a clear error", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "slow down"), { "Retry-After": "1" }),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.running, false);
  assert.equal(state.finished, false);
  assert.equal(bg.calls.length, 5);
  assert.match(state.lastError, /still rate-limiting/);
  assert.equal(bg.page.document.getElementById("first").value, "");
  assert.equal(state.check, null);
});

test("5xx is retried once, then the fill succeeds", async () => {
  let n = 0;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (request) => {
      n += 1;
      if (n === 1) return jsonResponse(503, errorBody(503, "unavailable", "upstream busy"));
      return confidentFirstName(request);
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.calls.length, 2);
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
});

test("a second consecutive 5xx stops the fill after 2 calls and shows the request id", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => jsonResponse(502, errorBody(502, "upstream_error", "model unavailable", { request_id: "req_abc123" })),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 2);
  assert.equal(state.running, false);
  assert.match(state.lastError, /HTTP 502.*model unavailable.*Request ID: req_abc123/);
  assert.equal(bg.page.document.getElementById("first").value, "");
  assert.equal(state.check, null);
});

test("5xx marked retryable:false fails immediately", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => jsonResponse(500, errorBody(500, "internal", "bad schema", { retryable: false })),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 1);
  assert.match(state.lastError, /HTTP 500.*bad schema/);
});

for (const [status, pattern] of [
  [401, /rejected this API key \(HTTP 401\)/],
  [402, /out of credits \(HTTP 402\)\. Top up at beatapi\.io\/dashboard\/billing/],
  [403, /refused the request \(HTTP 403\)/],
  [404, /does not recognise model “jev-1\.14-free” \(HTTP 404\)/],
  [400, /rejected the request \(HTTP 400\) \(questions\.field_0\.criteria is empty\)/],
  [422, /rejected the request \(HTTP 422\)/],
]) {
  test("HTTP " + status + " is not retried and stops the fill", async () => {
    const bg = loadBackground({
      html: SIMPLE_FORM,
      storage: profileWithFirstName("Alex"),
      respond: () => jsonResponse(status, errorBody(status, "err_" + status, "questions.field_0.criteria is empty")),
    });
    await bg.fill();
    const state = await bg.idle();
    assert.equal(bg.calls.length, 1, "must not burn retries on HTTP " + status);
    assert.equal(state.running, false);
    assert.match(state.lastError, pattern);
    assert.equal(bg.page.document.getElementById("first").value, "");
    assert.equal(state.check, null);
  });
}

test("network errors retry twice then fail with a readable message", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 3);
  assert.match(state.lastError, /Could not reach BeatAPI: Failed to fetch/);
  assert.equal(bg.page.document.getElementById("first").value, "");
});

test("timeouts retry and then report the 12s limit", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => {
      throw timeoutError();
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 3);
  assert.match(state.lastError, /did not respond within 12s/);
});

test("a single transient timeout is recovered and the fill succeeds", async () => {
  let n = 0;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (request) => {
      n += 1;
      if (n === 1) throw timeoutError();
      return confidentFirstName(request);
    },
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
});

const malformed = [
  ["no answers object", () => ({ id: "x", model: "jev-1.14-free" }), /without an answers object/],
  ["non-JSON body", () => jsonResponse(200, undefined), /without an answers object/],
  [
    "answer not typed as choice",
    (r) => {
      const body = confidentFirstName(r);
      const id = Object.keys(body.answers)[0];
      body.answers[id] = { type: "text", text: "Alex" };
      return body;
    },
    /did not return a typed Choice/,
  ],
  [
    "hallucinated choice key",
    (r) => {
      const body = confidentFirstName(r);
      const id = Object.keys(body.answers)[0];
      body.answers[id] = { type: "choice", choice: "default:slot_not_real", confidence: 0.99 };
      return body;
    },
    /was not an offered option/,
  ],
  [
    "empty choice",
    (r) => {
      const body = confidentFirstName(r);
      const id = Object.keys(body.answers)[0];
      body.answers[id] = { type: "choice", choice: "", confidence: 0.99 };
      return body;
    },
    /empty choice/,
  ],
];
for (const [name, respond, pattern] of malformed) {
  test("malformed response (" + name + ") stops the fill and writes nothing", async () => {
    const bg = loadBackground({
      html: SIMPLE_FORM,
      storage: profileWithFirstName("Alex"),
      respond,
    });
    await bg.fill();
    const state = await bg.idle();
    assert.equal(bg.calls.length, 1);
    assert.equal(state.running, false);
    assert.match(state.lastError, pattern);
    assert.equal(bg.page.document.getElementById("first").value, "");
    assert.equal(state.check, null);
    assert.ok(!bg.tabMessages.some((m) => m.type === "WRITE_FIELD"));
  });
}

test("Stop during a rate-limit wait cancels without further API calls", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "wait"), { "Retry-After": "60" }),
  });
  const filling = bg.fill();
  await bg.waitFor((s) => s.waitingUntil > 0, "rate-limit wait");
  const stopped = await bg.send({ type: "STOP" });
  assert.equal(stopped.running, false);
  await filling;
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(bg.calls.length, 1);
  assert.equal(bg.page.document.getElementById("first").value, "");
});

test("a response that arrives after Stop does not write", async () => {
  let resolveFetch;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (r) =>
      new Promise((resolve) => {
        resolveFetch = () => resolve(confidentFirstName(r));
      }),
  });
  const filling = bg.fill();
  await bg.waitFor(() => bg.calls.length === 1, "fetch in flight");
  await bg.send({ type: "STOP" });
  resolveFetch();
  await filling;
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(bg.page.document.getElementById("first").value, "");
  assert.ok(!bg.tabMessages.some((m) => m.type === "WRITE_FIELD"));
  const state = await bg.status();
  assert.equal(state.running, false);
  assert.equal(state.lastError, "");
  assert.equal(state.check, null);
});

test("a failed call keeps local alias writes and opens no check", async () => {
  const bg = loadBackground({
    html: twoFieldForm(),
    storage: profileWithAliasAndEmail(),
    respond: () => jsonResponse(401, errorBody(401, "invalid_api_key", "bad key")),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex", "alias hit stays written");
  assert.equal(bg.page.document.getElementById("email").value, "", "undecided field not written");
  assert.equal(state.running, false);
  assert.equal(state.check, null);
  assert.match(state.lastError, /rejected this API key/);
  assert.equal(bg.calls.length, 1);
});

test("scripting blocked by Chrome ends the fill with an explanation", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    scriptingError: "Cannot access contents of the page. Extension manifest must request permission.",
    respond: () => assert.fail("must not call API"),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.match(state.lastError, /doesn't allow Jev to access this page/);
  assert.equal(bg.calls.length, 0);
});

test("closing the tab mid-fill ends with an explanation", async () => {
  let bgRef;
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: (r) => {
      bgRef.closeTab();
      return confidentFirstName(r);
    },
  });
  bgRef = bg;
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.running, false);
  assert.match(state.lastError, /tab Jev was working on was closed/);
  assert.equal(bg.page.document.getElementById("first").value, "");
});

test("a field in an open shadow root can be filled; the launcher is not a field", async () => {
  const bg = loadBackground({
    html: `<!doctype html><title>Shadow</title>
      <form id="signup"><div id="shadow-host"></div></form>
      <div id="jev-fast-launcher-root"></div>`,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  const host = bg.page.document.getElementById("shadow-host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<label for="first">First name</label><input id="first" type="text" />`;

  const launcher = bg.page.document.getElementById("jev-fast-launcher-root");
  const launcherShadow = launcher.attachShadow({ mode: "open" });
  launcherShadow.innerHTML = `<label for="fake">Launcher decoy</label><input id="fake" type="text" />`;

  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(shadow.getElementById("first").value, "Alex");
  assert.equal(launcherShadow.getElementById("fake").value, "");
  const body = bg.calls[0].request;
  assert.deepEqual(
    body.state.fields.map((f) => f.wording),
    ["First name"]
  );
});

function profileWithCountry(answer, optionWordings) {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.answers.push({
    slotId: "slot_country",
    situationId: null,
    value: answer,
    optionWordings: optionWordings || [],
  });
  storage.jevProfile.slots.find((s) => s.id === "slot_country").aliases = ["Country"];
  return storage;
}

function confidentCountry(request) {
  const fieldId = findField(request, /Country/);
  const option = findOption(request, /country.*default/i);
  return answerFor(request, { fieldId, option, confidence: 0.85 });
}

const COUNTRY_SELECT_FORM = `<!doctype html><title>Country</title>
  <form>
    <label for="country">Country</label>
    <select id="country" name="country">
      <option value="" disabled selected>Select…</option>
      <option value="au">australia</option>
      <option value="nz">New Zealand</option>
    </select>
  </form>`;

const COUNTRY_RADIO_FORM = `<!doctype html><title>Country</title>
  <form>
    <fieldset>
      <legend>Country</legend>
      <label><input type="radio" name="country" value="au" /> australia</label>
      <label><input type="radio" name="country" value="nz" /> New Zealand</label>
    </fieldset>
  </form>`;

const MIXED_EXCLUSIONS_FORM = `<!doctype html><title>Mixed</title>
  <form>
    <label for="first">First name</label>
    <input id="first" name="first" type="text" />
    <label for="pw">Password</label>
    <input id="pw" type="password" />
    <label for="secret">Hidden</label>
    <input id="secret" type="hidden" value="" />
    <label for="file">Resume</label>
    <input id="file" type="file" />
    <label><input id="news" type="checkbox" /> Newsletter</label>
    <label for="cc">Card number</label>
    <input id="cc" type="text" autocomplete="cc-number" />
    <label for="cvc">CVC</label>
    <input id="cvc" type="text" />
    <label for="multi">Pets</label>
    <select id="multi" multiple><option>Cat</option><option>Dog</option></select>
    <button type="submit">Send</button>
  </form>`;

test("a radio group is one field and an unchecked group is filled from the answer", async () => {
  const bg = loadBackground({
    html: COUNTRY_RADIO_FORM,
    storage: profileWithCountry("Australia"),
    respond: confidentCountry,
  });
  await bg.fill();
  const state = await bg.idle();
  assert.equal(state.lastError, "");
  assert.equal(bg.calls.length, 1);
  assert.equal(bg.calls[0].request.state.fields.length, 1);
  assert.equal(bg.calls[0].request.state.fields[0].wording, "Country");
  const checked = bg.page.document.querySelector('input[name="country"]:checked');
  assert.ok(checked);
  assert.equal(checked.value, "au");
});

test("an unchecked radio group without a heading fills from a local alias", async () => {
  const html = `<!doctype html><title>Country</title>
    <form>
      <span id="clabel">Country</span>
      <input type="radio" name="country" value="au" id="c-au" aria-labelledby="clabel" />
      <label for="c-au">australia</label>
      <input type="radio" name="country" value="nz" id="c-nz" aria-labelledby="clabel" />
      <label for="c-nz">New Zealand</label>
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithCountry("Australia"),
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg.fill();
  await bg.idle();
  const checked = bg.page.document.querySelector('input[name="country"]:checked');
  assert.ok(checked);
  assert.equal(checked.value, "au");
  assert.equal(bg.calls.length, 0);
});

test("an option whose label matches the answer ignoring case and extra space is selected", async () => {
  const bg = loadBackground({
    html: COUNTRY_SELECT_FORM,
    storage: profileWithCountry("  Australia  "),
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg.fill();
  await bg.idle();
  const select = bg.page.document.getElementById("country");
  assert.equal(select.value, "au");
  assert.equal(select.selectedOptions[0].textContent.trim(), "australia");
});

test("a stored option wording selects that option and stores the picked label; answer string stays unchanged", async () => {
  const storage = profileWithCountry("Australia", ["AUS"]);
  const html = `<!doctype html><title>Country</title>
    <form>
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="" selected>Select…</option>
        <option value="au">AUS</option>
        <option value="nz">NZ</option>
      </select>
    </form>`;
  const bg = loadBackground({
    html,
    storage,
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("country").value, "au");
  const answer = bg.storage.jevProfile.answers.find((a) => a.slotId === "slot_country");
  assert.equal(answer.value, "Australia");
  assert.ok(answer.optionWordings.map((w) => w.toLowerCase()).includes("aus"));
});

test("an unmatched dropdown opens a check that asks for the option", async () => {
  const html = `<!doctype html><title>Country</title>
    <form>
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="" selected>Select…</option>
        <option value="au">AU</option>
        <option value="nz">NZ</option>
      </select>
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithCountry("Australia"),
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg.fill();
  const state = await bg.idle();
  assert.ok(state.check);
  assert.equal(state.check.optionRequired, true);
  assert.equal(state.check.optionLabels.length, 3);
  assert.ok(state.check.optionLabels.includes("AU"));
  assert.ok(state.check.optionLabels.includes("NZ"));
  assert.equal(state.check.reason, "unmatched_option");
  assert.equal(bg.page.document.getElementById("country").value, "");
  assert.equal(bg.calls.length, 0);
});

test("option labels are absent from the Jev request", async () => {
  const html = `<!doctype html><title>Signup</title>
    <form>
      <label for="first">First name</label>
      <input id="first" name="first" type="text" />
      <label for="country">Nation</label>
      <select id="country" name="country">
        <option value="" selected>Choose</option>
        <option value="au">SecretOptionLabel</option>
      </select>
    </form>`;
  const bg = loadBackground({
    html,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  await bg.fill();
  await bg.idle();
  const blob = JSON.stringify(bg.calls[0].request);
  assert.ok(!blob.includes("SecretOptionLabel"));
  assert.ok(!("options" in bg.calls[0].request.state.fields[0]));
});

test("a text box receives the stored string unchanged; spaces-only is empty and filled", async () => {
  const storage = profileWithFirstName("  Alex  ");
  const html = `<!doctype html><title>Signup</title>
    <form>
      <label for="first">First name</label>
      <input id="first" name="first" type="text" value="   " />
    </form>`;
  const bg = loadBackground({
    html,
    storage,
    respond: confidentFirstName,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "  Alex  ");
});

test("a date control is filled only when the string is already YYYY-MM-DD", async () => {
  const storage = profileWithFirstName("Alex");
  storage.jevProfile.answers.push({
    slotId: "slot_city",
    situationId: null,
    value: "12/25/1990",
    optionWordings: [],
  });
  storage.jevProfile.slots.find((s) => s.id === "slot_city").aliases = ["Birthday"];
  const html = `<!doctype html><title>Birthday</title>
    <form>
      <label for="bday">Birthday</label>
      <input id="bday" name="bday" type="date" />
    </form>`;
  const bg = loadBackground({
    html,
    storage,
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg.fill();
  let state = await bg.idle();
  assert.ok(state.check);
  assert.equal(state.check.reason, "bad_date");
  assert.equal(bg.page.document.getElementById("bday").value, "");

  storage.jevProfile.answers.find((a) => a.slotId === "slot_city").value = "1990-12-25";
  const bg2 = loadBackground({
    html,
    storage,
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg2.fill();
  state = await bg2.idle();
  assert.equal(state.check, null);
  assert.equal(bg2.page.document.getElementById("bday").value, "1990-12-25");
});

test("a control that does not keep the written value is cleared and becomes a check", async () => {
  const bg = loadBackground({
    html: SIMPLE_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  const input = bg.page.document.getElementById("first");
  const proto = bg.page.window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  Object.defineProperty(proto, "value", {
    configurable: true,
    get: desc.get,
    set(v) {
      desc.set.call(this, "");
    },
  });
  await bg.fill();
  const state = await bg.idle();
  Object.defineProperty(proto, "value", desc);
  assert.ok(state.check);
  assert.equal(state.check.reason, "rejected");
  assert.equal(desc.get.call(input), "");
});

test("a dropdown with a blank or disabled selected option is empty; any other selected option is left alone", async () => {
  const occupied = `<!doctype html><title>Country</title>
    <form>
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="">Select…</option>
        <option value="nz" selected>New Zealand</option>
      </select>
      <label for="first">First name</label>
      <input id="first" name="first" type="text" />
    </form>`;
  const bg = loadBackground({
    html: occupied,
    storage: profileWithCountry("Australia"),
    respond: confidentFirstName,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("country").value, "nz");
  assert.equal(bg.page.document.getElementById("first").value, "Alex");

  const emptyDisabled = `<!doctype html><title>Country</title>
    <form>
      <label for="country">Country</label>
      <select id="country" name="country">
        <option value="x" disabled selected>Pick</option>
        <option value="au">australia</option>
      </select>
    </form>`;
  const bg2 = loadBackground({
    html: emptyDisabled,
    storage: profileWithCountry("Australia"),
    respond: () => assert.fail("alias hit must not call Jev"),
  });
  await bg2.fill();
  await bg2.idle();
  assert.equal(bg2.page.document.getElementById("country").value, "au");
});

test("excluded controls are absent from the fill", async () => {
  const bg = loadBackground({
    html: MIXED_EXCLUSIONS_FORM,
    storage: profileWithFirstName("Alex"),
    respond: confidentFirstName,
  });
  await bg.fill();
  await bg.idle();
  assert.equal(bg.page.document.getElementById("first").value, "Alex");
  assert.equal(bg.page.document.getElementById("pw").value, "");
  assert.equal(bg.page.document.getElementById("cc").value, "");
  assert.equal(bg.page.document.getElementById("cvc").value, "");
  assert.equal(bg.page.document.getElementById("news").checked, false);
  assert.equal(bg.calls[0].request.state.fields.length, 1);
  assert.equal(bg.calls[0].request.state.fields[0].wording, "First name");
});
