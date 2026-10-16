const test = require("node:test");
const assert = require("node:assert/strict");
const { createMockJevServer, validateRequest } = require("../scripts/mock-jev");
const { loadBackground, jsonResponse } = require("./helpers/background");

async function listen(scenario) {
  const server = createMockJevServer({ scenario });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/v1/systemone";
  return { server, url, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Background fetches are forwarded over real HTTP to the mock server. */
function overTheWire(url) {
  return async (request, _n, call) => {
    const res = await fetch(url, { method: "POST", headers: call.init.headers, body: call.init.body });
    const headers = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return jsonResponse(res.status, await res.json(), headers);
  };
}

async function post(url, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-mock", ...(headers || {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), retryAfter: res.headers.get("retry-after") };
}

test("over HTTP: the extension completes the demo flight search against the mock Jev", async (t) => {
  const mock = await listen();
  t.after(mock.close);
  const bg = loadBackground({ respond: overTheWire(mock.url) });
  await bg.start({ endpoint: "http://127.0.0.1:41786/v1/systemone" });
  const state = await bg.idle();
  assert.equal(state.finished, true, JSON.stringify(state.logs.map((l) => l.text)));
  assert.equal(state.lastError, "");
  const doc = bg.page.document;
  assert.equal(doc.getElementById("origin").value, "Melbourne");
  assert.equal(doc.getElementById("destination").value, "Tokyo");
  assert.equal(doc.getElementById("results").hidden, false);
  assert.deepEqual(
    Array.from(state.logs.filter((l) => l.kind === "step"), (l) => l.action),
    ["type", "type", "click", "finish"]
  );
  assert.equal(mock.server.requests.length, 4);
  assert.ok(mock.server.requests.every((r) => r.status === 200 && validateRequest(r.body) === null));
});

test("over HTTP: review scenario pauses on the low-confidence click, Confirm finishes", async (t) => {
  const mock = await listen("review");
  t.after(mock.close);
  const bg = loadBackground({ respond: overTheWire(mock.url) });
  await bg.start();
  let state = await bg.idle();
  assert.equal(state.paused, true);
  assert.equal(state.pendingConfirmation.actionType, "click");
  await bg.send({ type: "CONFIRM" });
  state = await bg.waitFor((s) => !s.running, "finish");
  assert.equal(state.finished, true);
  assert.equal(bg.page.document.getElementById("results").hidden, false);
});

test("over HTTP: rate-limit scenario returns 429 + Retry-After and the run recovers", async (t) => {
  const mock = await listen("rate-limit");
  t.after(mock.close);
  const bg = loadBackground({ respond: overTheWire(mock.url) });
  await bg.start();
  await bg.waitFor((s) => s.waitingUntil > 0, "rate-limit wait");
  bg.clock.advance(3000);
  const state = await bg.waitFor((s) => !s.running, "finish");
  assert.equal(state.finished, true, JSON.stringify(state.logs.map((l) => l.text)));
  assert.equal(mock.server.requests[0].body.state.step, 1);
});

test("mock enforces the documented auth, JSON, model and question contract", async (t) => {
  const mock = await listen();
  t.after(mock.close);
  const ok = {
    model: "jev-1.14-free",
    state: { user_goal: "x" },
    questions: { q: { type: "choice", instructions: "Pick", criteria: { a: "A", b: "B" } } },
  };
  assert.equal((await post(mock.url, ok)).status, 200);
  const noAuth = await post(mock.url, ok, { Authorization: "" });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.body.error.code, "unauthorized");
  assert.match(noAuth.body.error.request_id, /^req_mock_/);
  assert.equal((await post(mock.url, "{nope")).status, 400);
  assert.equal((await post(mock.url, { ...ok, model: "jev-9" })).status, 404);
  assert.equal((await post(mock.url, { ...ok, questions: {} })).status, 422);
  const oneOption = { ...ok, questions: { q: { type: "choice", instructions: "Pick", criteria: { a: "A" } } } };
  assert.equal((await post(mock.url, oneOption)).status, 422);
  const badType = { ...ok, questions: { q: { type: "text", instructions: "Say" } } };
  assert.equal((await post(mock.url, badType)).status, 422);
});
