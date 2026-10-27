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
