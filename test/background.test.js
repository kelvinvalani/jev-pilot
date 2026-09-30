const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBackground, jsonResponse, timeoutError } = require("./helpers/background");
const { answerFor, errorBody, findElement, choice } = require("./fixtures/jev");

const ORIGIN = /^INPUT - Origin/;
const DESTINATION = /^INPUT - Destination/;
const SEARCH = /Search flights/;

/** Walks the demo flight search: type origin, type destination, click search, finish. */
function flightScript(overrides) {
  const steps = [
    (r) => ({ target: findElement(r, ORIGIN), action: "type", text: "Melbourne", confidence: 0.97 }),
    (r) => ({ target: findElement(r, DESTINATION), action: "type", text: "Tokyo", confidence: 0.96 }),
    (r) => ({ target: findElement(r, SEARCH), action: "click", confidence: 0.99 }),
    () => ({ target: "none_applicable", action: "finish", confidence: 0.94 }),
  ];
  return (request, call) => {
    const pick = (overrides && overrides[call]) || steps[call - 1] || steps[steps.length - 1];
    const decision = pick(request);
    return decision && decision.status ? decision : answerFor(request, decision);
  };
}

function logTexts(state) {
  return state.logs.map((l) => l.text);
}

test("happy path: fills the demo form, searches, and finishes in 4 calls", async () => {
  const bg = loadBackground({ respond: flightScript() });
  const started = await bg.start();
  assert.equal(started.running, true);
  const state = await bg.idle();

  assert.equal(state.running, false);
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(state.lastError, "");
  assert.equal(bg.calls.length, 4);

  const doc = bg.page.document;
  assert.equal(doc.getElementById("origin").value, "Melbourne");
  assert.equal(doc.getElementById("destination").value, "Tokyo");
  assert.equal(doc.getElementById("results").hidden, false);
  assert.equal(doc.querySelectorAll("#results .card").length, 2);

  const steps = state.logs.filter((l) => l.kind === "step");
  assert.deepEqual(
    Array.from(steps, (s) => s.action),
    ["type", "type", "click", "finish"]
  );
  assert.ok(steps.every((s) => typeof s.latencyMs === "number" && s.confidence > 0.9));
  assert.ok(logTexts(state).some((t) => t.includes("Typed “Melbourne”")));
});

test("request contract: endpoint, auth header, model, typed questions and state", async () => {
  const bg = loadBackground({ respond: flightScript() });
  await bg.start();
  await bg.idle();
  const first = bg.calls[0];
  assert.equal(first.url, "https://api.beatapi.io/v1/systemone");
  assert.equal(first.init.method, "POST");
  assert.equal(first.init.headers.Authorization, "Bearer sk-mock-not-a-real-key");
  assert.equal(first.init.headers["Content-Type"], "application/json");

  const body = first.request;
  assert.equal(body.model, "jev-1.13-free");
  assert.equal(body.state.user_goal, "Search for flights from Melbourne to Tokyo");
  assert.equal(body.state.step, 1);
  assert.equal(body.state.max_steps, 15);
  assert.equal(body.state.current_url, "https://flights.example.test/search");
  assert.ok(Array.isArray(body.state.interactive_elements) && body.state.interactive_elements.length >= 5);

  const q = body.questions;
  assert.equal(q.target_element_id.type, "choice");
  assert.ok("none_applicable" in q.target_element_id.criteria);
  for (const el of body.state.interactive_elements) assert.ok(el.id in q.target_element_id.criteria);
  assert.deepEqual(Object.keys(q.action_type.criteria), ["click", "type", "finish"]);
  assert.equal(q.requires_complex_text.type, "noul");
  assert.deepEqual(Object.values(q.text_candidate.criteria), [
    "Type exactly: Melbourne",
    "Type exactly: Tokyo",
    "None of these values should be typed",
  ]);

  assert.equal(bg.calls[1].request.state.last_result.startsWith("Typed into"), true);
  assert.equal(bg.calls[3].request.state.last_result.startsWith("Clicked"), true);
});

test("TypeSafe provider uses its own endpoint and model", async () => {
  const bg = loadBackground({ respond: flightScript() });
  await bg.start({ provider: "typesafe", apiKey: "ts-mock-key" });
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.equal(bg.calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(bg.calls[0].request.model, "jev-latest");
  assert.equal(bg.calls[0].init.headers.Authorization, "Bearer ts-mock-key");
  assert.equal(state.providerName, "TypeSafe");
});

test("confidence falls back to probabilities when confidence is absent", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: (r) => {
        const body = answerFor(r, { target: findElement(r, ORIGIN), action: "type", text: "Melbourne", confidence: 0.91 });
        delete body.answers.target_element_id.confidence;
        return { status: 200, headers: { get: () => null }, ok: true, json: async () => body };
      },
    }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(state.logs.find((l) => l.kind === "step").confidence, 0.91);
});

test("low confidence pauses for review; Confirm runs the proposed step and resumes", async () => {
  const bg = loadBackground({
    respond: flightScript({ 3: (r) => ({ target: findElement(r, SEARCH), action: "click", confidence: 0.42 }) }),
  });
  await bg.start();
  const paused = await bg.idle();
  assert.equal(paused.running, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.pendingConfirmation.reason, "confidence");
  assert.equal(paused.pendingConfirmation.actionType, "click");
  assert.match(paused.pendingConfirmation.targetLabel, SEARCH);
  assert.match(paused.pendingConfirmation.message, /42% confident/);
  assert.equal(bg.page.document.getElementById("results").hidden, true, "must not click before confirmation");
  assert.equal(bg.calls.length, 3);

  await bg.send({ type: "CONFIRM", textValue: "" });
  const done = await bg.waitFor((s) => !s.running, "finish after confirm");
  assert.equal(done.finished, true);
  assert.equal(bg.page.document.getElementById("results").hidden, false);
  assert.equal(bg.calls.length, 4);
});

test("low confidence → Skip does not touch the page and asks Jev again", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: (r) => ({ target: findElement(r, SEARCH), action: "click", confidence: 0.3 }),
      2: (r) => ({ target: findElement(r, ORIGIN), action: "type", text: "Melbourne" }),
      3: (r) => ({ target: findElement(r, DESTINATION), action: "type", text: "Tokyo" }),
      4: (r) => ({ target: findElement(r, SEARCH), action: "click" }),
      5: () => ({ target: "none_applicable", action: "finish" }),
    }),
  });
  await bg.start();
  await bg.idle();
  await bg.send({ type: "SKIP" });
  const done = await bg.waitFor((s) => !s.running, "finish after skip");
  assert.equal(done.finished, true);
  assert.equal(bg.calls.length, 5);
  assert.equal(bg.page.document.getElementById("origin").value, "Melbourne");
});

test("complex text (high Noul) pauses with the suggested text; edited text is typed", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: (r) => ({ target: findElement(r, ORIGIN), action: "type", text: "Melbourne", complex: 0.88 }),
    }),
  });
  await bg.start();
  const paused = await bg.idle();
  assert.equal(paused.pendingConfirmation.reason, "complex_text");
  assert.equal(paused.pendingConfirmation.suggestedText, "Melbourne");
  assert.equal(bg.page.document.getElementById("origin").value, "");
  await bg.send({ type: "CONFIRM", textValue: "Melbourne (MEL)" });
  const done = await bg.waitFor((s) => !s.running, "finish");
  assert.equal(done.finished, true);
  assert.equal(bg.page.document.getElementById("origin").value, "Melbourne (MEL)");
});

test("TYPE without a text candidate asks the user what to type", async () => {
  const bg = loadBackground({
    respond: flightScript({ 1: (r) => ({ target: findElement(r, ORIGIN), action: "type" }) }),
  });
  await bg.start();
  const paused = await bg.idle();
  assert.equal(paused.pendingConfirmation.reason, "text");
  assert.equal(paused.pendingConfirmation.suggestedText, "");
});

test("Confirm with empty text on a TYPE step skips rather than typing nothing", async () => {
  const bg = loadBackground({
    respond: flightScript({ 1: (r) => ({ target: findElement(r, ORIGIN), action: "type" }) }),
  });
  await bg.start();
  await bg.idle();
  await bg.send({ type: "CONFIRM", textValue: "" });
  const state = await bg.waitFor((s) => bg.calls.length >= 2 || !s.running, "next call");
  assert.ok(logTexts(state).some((t) => /No text provided/.test(t)));
});

test("429 with Retry-After waits the advised time, then succeeds without failing the run", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "Free tier: 1 request per minute"), { "Retry-After": "37" }),
      2: (r) => ({ target: findElement(r, ORIGIN), action: "type", text: "Melbourne" }),
      3: (r) => ({ target: findElement(r, DESTINATION), action: "type", text: "Tokyo" }),
      4: (r) => ({ target: findElement(r, SEARCH), action: "click" }),
      5: () => ({ target: "none_applicable", action: "finish" }),
    }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(bg.calls.length, 5);
  const gap = bg.calls[1].at - bg.calls[0].at;
  assert.ok(gap >= 37000, "waited " + gap + "ms");
  assert.ok(logTexts(state).some((t) => /rate limit reached — waiting 37s/.test(t)));
  // Later requests are paced to the learned interval instead of hitting 429 again.
  const pacing = bg.calls[2].at - bg.calls[1].at;
  assert.ok(pacing >= 37000, "paced " + pacing + "ms");
});

test("429 without Retry-After on BeatAPI waits the free-tier 60s", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "Too many requests")),
      2: () => ({ target: "none_applicable", action: "finish" }),
    }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.ok(bg.calls[1].at - bg.calls[0].at >= 60000);
});

test("429 retries are bounded (5 calls max) and end with a clear error", async () => {
  const bg = loadBackground({
    respond: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "slow down"), { "Retry-After": "1" }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.running, false);
  assert.equal(bg.calls.length, 5);
  assert.match(state.lastError, /still rate-limiting/);
});

test("5xx is retried twice, then succeeds", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: () => jsonResponse(503, errorBody(503, "unavailable", "upstream busy")),
      2: () => jsonResponse(500, undefined),
      3: () => ({ target: "none_applicable", action: "finish" }),
    }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(logTexts(state)));
  assert.equal(bg.calls.length, 3);
});

test("5xx marked retryable:false fails immediately", async () => {
  const bg = loadBackground({
    respond: () => jsonResponse(500, errorBody(500, "internal", "bad schema", { retryable: false })),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 1);
  assert.match(state.lastError, /HTTP 500.*bad schema/);
});

for (const [status, pattern] of [
  [401, /rejected this API key \(HTTP 401\)/],
  [402, /out of credits \(HTTP 402\)/],
  [403, /refused the request \(HTTP 403\)/],
  [404, /does not recognise model “jev-1.13-free” \(HTTP 404\)/],
  [400, /rejected the request \(HTTP 400\) \(questions\.target_element_id\.criteria is empty\)/],
  [422, /rejected the request \(HTTP 422\)/],
]) {
  test("HTTP " + status + " is not retried and explains what to fix", async () => {
    const bg = loadBackground({
      respond: () => jsonResponse(status, errorBody(status, "err_" + status, "questions.target_element_id.criteria is empty")),
    });
    await bg.start();
    const state = await bg.idle();
    assert.equal(bg.calls.length, 1, "must not burn retries on HTTP " + status);
    assert.equal(state.running, false);
    assert.match(state.lastError, pattern);
    assert.equal(bg.page.document.getElementById("origin").value, "");
  });
}

test("network errors retry twice then fail with a readable message", async () => {
  const bg = loadBackground({
    respond: () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 3);
  assert.match(state.lastError, /Could not reach BeatAPI: Failed to fetch/);
});

test("timeouts retry and then report the 12s limit", async () => {
  const bg = loadBackground({
    respond: () => {
      throw timeoutError();
    },
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 3);
  assert.match(state.lastError, /did not respond within 12s/);
});

test("a single transient timeout is recovered", async () => {
  const bg = loadBackground({
    respond: flightScript({
      1: () => {
        throw timeoutError();
      },
      2: () => ({ target: "none_applicable", action: "finish" }),
    }),
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true);
});

const malformed = [
  ["no answers object", () => ({ id: "x", model: "jev-1.13-free" }), /without an answers object/],
  ["non-JSON body", () => jsonResponse(200, undefined), /without an answers object/],
  [
    "target not typed as choice",
    (r) => {
      const body = answerFor(r, { target: "elem_0", action: "click" });
      body.answers.target_element_id = { type: "text", text: "elem_0" };
      return body;
    },
    /typed Choice for target_element_id/,
  ],
  [
    "missing action_type",
    (r) => {
      const body = answerFor(r, { target: "elem_0", action: "click" });
      delete body.answers.action_type;
      return body;
    },
    /typed Choice for action_type/,
  ],
  [
    "hallucinated element id",
    (r) => {
      const body = answerFor(r, { target: "elem_0", action: "click" });
      body.answers.target_element_id = choice("elem_999", 0.99);
      return body;
    },
    /“elem_999”, which is not an element on this page/,
  ],
  [
    "unsupported action",
    (r) => {
      const body = answerFor(r, { target: "elem_0", action: "click" });
      body.answers.action_type = choice("scroll", 0.9);
      return body;
    },
    /unsupported action “scroll”/,
  ],
];
for (const [name, respond, pattern] of malformed) {
  test("malformed response (" + name + ") fails safely without acting or retrying", async () => {
    const bg = loadBackground({ respond });
    await bg.start();
    const state = await bg.idle();
    assert.equal(bg.calls.length, 1);
    assert.equal(state.running, false);
    assert.match(state.lastError, pattern);
    assert.ok(!bg.tabMessages.some((m) => m.type === "EXECUTE"), "no DOM action");
  });
}

test("text_candidate outside the offered keys is ignored and the user is asked", async () => {
  const bg = loadBackground({
    respond: (r) => {
      const body = answerFor(r, { target: findElement(r, ORIGIN), action: "type", text: "Melbourne" });
      body.answers.text_candidate = choice("text_42", 0.9);
      return body;
    },
  });
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.pendingConfirmation.reason, "text");
});

test("none_applicable twice in a row ends gracefully", async () => {
  const bg = loadBackground({ respond: (r) => answerFor(r, { target: "none_applicable", action: "click" }) });
  await bg.start();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 2);
  assert.equal(state.finished, true);
  assert.match(logTexts(state).at(-1), /could not find a matching element/);
});

test("stops at the 15-step limit", async () => {
  const bg = loadBackground({ respond: (r) => answerFor(r, { target: findElement(r, /Cabin|select/i), action: "click" }) });
  await bg.start();
  const state = await bg.idle();
  assert.equal(bg.calls.length, 15);
  assert.equal(state.step, 15);
  assert.match(logTexts(state).at(-1), /15-step limit/);
});

test("Stop during a rate-limit wait cancels without any further API calls", async () => {
  let release;
  const bg = loadBackground({
    respond: () => jsonResponse(429, errorBody(429, "rate_limit_exceeded", "wait"), { "Retry-After": "60" }),
  });
  await bg.start();
  await bg.waitFor((s) => s.waitingUntil > 0, "rate-limit wait");
  const stopped = await bg.send({ type: "STOP" });
  assert.equal(stopped.running, false);
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(bg.calls.length, 1);
  void release;
});

test("a response that arrives after Stop is discarded (no stale DOM action)", async () => {
  let resolveFetch;
  const bg = loadBackground({
    respond: (r) =>
      new Promise((resolve) => {
        resolveFetch = () => resolve(answerFor(r, { target: findElement(r, SEARCH), action: "click" }));
      }),
  });
  await bg.start();
  await bg.waitFor(() => bg.calls.length === 1, "fetch in flight");
  await bg.send({ type: "STOP" });
  resolveFetch();
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
  assert.ok(!bg.tabMessages.some((m) => m.type === "EXECUTE"));
  assert.equal(bg.page.document.getElementById("results").hidden, true);
  const state = await bg.status();
  assert.equal(state.running, false);
  assert.equal(state.lastError, "");
});

test("a new run after Stop is not affected by the old loop", async () => {
  let gate;
  let n = 0;
  const bg = loadBackground({
    respond: (r) => {
      n += 1;
      if (n === 1) return new Promise((resolve) => (gate = () => resolve(answerFor(r, { target: findElement(r, SEARCH), action: "click" }))));
      return answerFor(r, { target: "none_applicable", action: "finish" });
    },
  });
  await bg.start();
  await bg.waitFor(() => bg.calls.length === 1, "first fetch");
  await bg.send({ type: "STOP" });
  await bg.start({ goal: "Just finish" });
  const done = await bg.waitFor((s) => !s.running, "second run");
  gate();
  for (let i = 0; i < 200; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(done.finished, true);
  assert.equal(bg.page.document.getElementById("results").hidden, true);
});

test("START validation: missing key, missing goal, already running", async () => {
  const bg = loadBackground({ respond: () => new Promise(() => {}) });
  let state = await bg.start({ apiKey: "  " });
  assert.match(state.lastError, /Add your BeatAPI API key/);
  state = await bg.start({ goal: "" });
  assert.match(state.lastError, /Describe what Jev should do/);
  await bg.start();
  state = await bg.start();
  assert.match(state.lastError, /already running/);
  assert.equal(state.running, true);
  await bg.send({ type: "STOP" });
});

for (const url of ["chrome://settings/", "https://chromewebstore.google.com/detail/x", "chrome-extension://abc/popup.html"]) {
  test("refuses restricted page " + url + " before calling the API", async () => {
    const bg = loadBackground({ tabUrl: url, respond: () => assert.fail("must not call API") });
    const state = await bg.start();
    assert.equal(state.running, false);
    assert.match(state.lastError, /doesn't allow extensions to control this page/);
    assert.equal(bg.calls.length, 0);
  });
}

test("injects content.js on demand when the page has no listener yet", async () => {
  const bg = loadBackground({ respond: flightScript() });
  assert.equal(bg.page.hasListeners(), false);
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.finished, true);
  assert.ok(bg.page.injected.has("content.js"));
});

test("scripting blocked by Chrome fails fast with a clear message", async () => {
  const bg = loadBackground({
    scriptingError: "Cannot access contents of the page. Extension manifest must request permission.",
    respond: () => assert.fail("must not call API"),
  });
  await bg.start();
  const state = await bg.idle();
  assert.match(state.lastError, /doesn't allow Jev to access this page/);
  assert.equal(bg.calls.length, 0);
});

test("closing the tab mid-run ends the run with an explanation", async () => {
  let bgRef;
  const bg = loadBackground({
    respond: (r, call) => {
      if (call === 1) {
        bgRef.closeTab();
      }
      return answerFor(r, { target: findElement(r, ORIGIN), action: "type", text: "Melbourne" });
    },
  });
  bgRef = bg;
  await bg.start();
  const state = await bg.idle();
  assert.equal(state.running, false);
  assert.match(state.lastError, /tab Jev was working on was closed/);
});

test("element removed between decision and action fails the step clearly", async () => {
  const bg = loadBackground({
    respond: (r) => {
      bg.page.document.getElementById("searchForm").remove();
      return answerFor(r, { target: findElement(r, ORIGIN), action: "type", text: "Melbourne" });
    },
  });
  await bg.start();
  const state = await bg.idle();
  assert.match(state.lastError, /no longer in the DOM/);
});

test("status is broadcast to the popup and the page launcher", async () => {
  const bg = loadBackground({ respond: flightScript() });
  await bg.start();
  await bg.idle();
  assert.ok(bg.broadcasts.some((m) => m.type === "STATE" && m.state.running));
  assert.ok(bg.broadcasts.some((m) => m.type === "STATE" && m.state.finished));
  assert.ok(bg.tabMessages.some((m) => m.type === "JEV_FAST_STATUS" && m.status.running));
});

test("CLEAR_LOG resets logs and the finished/error banner when idle", async () => {
  const bg = loadBackground({ respond: () => jsonResponse(401, errorBody(401, "invalid_api_key", "bad key")) });
  await bg.start();
  await bg.idle();
  const cleared = await bg.send({ type: "CLEAR_LOG" });
  assert.equal(cleared.logs.length, 0);
  assert.equal(cleared.lastError, "");
});

test("the API key never appears in logs or broadcast state", async () => {
  const bg = loadBackground({ respond: () => jsonResponse(401, errorBody(401, "invalid_api_key", "bad key")) });
  await bg.start({ apiKey: "sk-super-secret-123" });
  await bg.idle();
  const everything = JSON.stringify(bg.broadcasts) + JSON.stringify(await bg.status());
  assert.ok(!everything.includes("sk-super-secret-123"));
});
