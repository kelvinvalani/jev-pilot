#!/usr/bin/env node
/**
 * Deterministic local stand-in for the Jev System One API.
 *
 * Validates requests against the documented contract (POST /v1/systemone,
 * Bearer auth, { model, state, questions } with typed choice/noul questions)
 * and answers with the documented response and error envelopes. Answers come
 * from a small rule-based planner, so runs are repeatable and free.
 *
 *   node scripts/mock-jev.js [--port 41786] [--scenario default|review|rate-limit]
 *
 * Point the extension at it via Settings → Local test endpoint:
 *   http://127.0.0.1:41786/v1/systemone
 */

const http = require("node:http");

const PATH = "/v1/systemone";
const MODELS = ["jev-1.14-free", "jev-1.13-free", "jev-latest"];
const SCENARIOS = ["default", "review", "rate-limit"];
const TEXT_TYPES = ["text", "search", "email", "url", "tel", "number", "textarea", "contenteditable"];
const FIELD_HINTS = {
  from: /\b(origin|from|departure city|leaving)\b/i,
  to: /\b(destination|to|arrival|going)\b/i,
};

let seq = 0;

function nextId(prefix) {
  seq += 1;
  return prefix + String(seq).padStart(4, "0");
}

function errorEnvelope(status, code, message) {
  return {
    status,
    body: {
      error: { code, message, retryable: status === 429 || status >= 500, request_id: nextId("req_mock_") },
    },
  };
}

/** Returns null when the body matches the documented request contract, else an error envelope. */
function validateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorEnvelope(400, "invalid_request", "Request body must be a JSON object.");
  }
  if (typeof body.model !== "string" || !body.model) {
    return errorEnvelope(422, "validation_error", "model is required.");
  }
  if (!MODELS.includes(body.model)) {
    return errorEnvelope(404, "model_not_found", "Model " + body.model + " does not exist.");
  }
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return errorEnvelope(422, "validation_error", "state must be an object.");
  }
  const questions = body.questions;
  if (!questions || typeof questions !== "object" || !Object.keys(questions).length) {
    return errorEnvelope(422, "validation_error", "questions must be a non-empty object.");
  }
  for (const [name, q] of Object.entries(questions)) {
    if (!q || typeof q.instructions !== "string" || !q.instructions.trim()) {
      return errorEnvelope(422, "validation_error", "questions." + name + ".instructions is required.");
    }
    if (q.type === "choice") {
      const keys = q.criteria && typeof q.criteria === "object" ? Object.keys(q.criteria) : [];
      if (keys.length < 2) {
        return errorEnvelope(422, "validation_error", "questions." + name + ".criteria needs at least 2 options.");
      }
      if (keys.some((k) => typeof q.criteria[k] !== "string")) {
        return errorEnvelope(422, "validation_error", "questions." + name + ".criteria values must be strings.");
      }
    } else if (q.type !== "noul") {
      return errorEnvelope(422, "validation_error", "questions." + name + ".type must be choice or noul.");
    }
  }
  return null;
}

function choice(picked, confidence, criteria) {
  const keys = Object.keys(criteria);
  const rest = keys.filter((k) => k !== picked);
  const probabilities = { [picked]: confidence };
  for (const key of rest) probabilities[key] = Number(((1 - confidence) / Math.max(1, rest.length)).toFixed(4));
  return { type: "choice", choice: picked, probabilities, confidence };
}

function elementsOf(state) {
  return Array.isArray(state.interactive_elements) ? state.interactive_elements : [];
}

function isTextField(el) {
  return TEXT_TYPES.includes(String(el.type || "").toLowerCase()) && !el.disabled;
}

function goalWords(goal) {
  return String(goal || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

function fieldFor(value, goal, fields) {
  const before = String(goal || "").match(new RegExp("(\\w+)\\s+" + value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const hint = before && FIELD_HINTS[before[1].toLowerCase()];
  const empty = fields.filter((el) => !el.value);
  return (hint && empty.find((el) => hint.test(el.label))) || empty[0] || null;
}

/** Rule-based next step: type each quoted value once, click the best matching button once, then finish. */
function plan(request, scenario) {
  const { state, questions } = request;
  const elements = elementsOf(state);
  const done = Array.isArray(state.completed_actions) ? state.completed_actions : [];
  const candidates = questions.text_candidate ? questions.text_candidate.criteria : {};
  const fields = elements.filter(isTextField);

  for (const [key, label] of Object.entries(candidates)) {
    const m = /^Type exactly: (.+)$/.exec(label);
    if (!m) continue;
    const value = m[1];
    if (fields.some((el) => el.value === value) || done.some((d) => d.endsWith(": " + value))) continue;
    const field = fieldFor(value, state.user_goal, fields);
    if (field) return { target: field.id, action: "type", text: key, confidence: 0.96 };
  }

  if (!done.some((d) => /Clicked|Pressed Enter/.test(d))) {
    const words = goalWords(state.user_goal);
    const buttons = elements.filter(
      (el) => !el.disabled && /^(BUTTON|A)$|button|submit/i.test(el.tag + " " + el.type) && !isTextField(el)
    );
    const scored = buttons
      .map((el) => ({ el, score: words.filter((w) => el.label.toLowerCase().includes(w)).length }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length) {
      return { target: scored[0].el.id, action: "click", confidence: scenario === "review" ? 0.55 : 0.93 };
    }
    const typed = fields.filter((el) => el.value);
    if (typed.length) return { target: typed[typed.length - 1].id, action: "submit", confidence: 0.9 };
    return { target: "none_applicable", action: "click", confidence: 0.9 };
  }
  return { target: "none_applicable", action: "finish", confidence: 0.94 };
}

function answer(request, scenario) {
  const decision = plan(request, scenario);
  const answers = {};
  for (const [name, q] of Object.entries(request.questions)) {
    if (q.type === "noul") {
      answers[name] = { type: "noul", noul: 0.05 };
      continue;
    }
    let picked = Object.keys(q.criteria)[0];
    let confidence = 0.9;
    if (name === "target_element_id" && decision.target in q.criteria) {
      picked = decision.target;
      confidence = decision.confidence;
    } else if (name === "action_type" && decision.action in q.criteria) {
      picked = decision.action;
      confidence = 0.97;
    } else if (name === "text_candidate") {
      picked = decision.text && decision.text in q.criteria ? decision.text : "none";
      if (!(picked in q.criteria)) picked = Object.keys(q.criteria).at(-1);
      confidence = 0.95;
    }
    answers[name] = choice(picked, confidence, q.criteria);
  }
  return {
    id: nextId("sys1_mock_"),
    object: "systemone.response",
    model: request.model,
    created: Math.floor(Date.now() / 1000),
    answers,
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    latency_ms: 40,
  };
}

function createMockJevServer(options) {
  const scenario = (options && options.scenario) || "default";
  if (!SCENARIOS.includes(scenario)) throw new Error("Unknown scenario " + scenario);
  const requests = [];
  let rateLimited = false;

  const server = http.createServer((req, res) => {
    const send = (status, body, headers) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        ...(headers || {}),
      });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.method === "OPTIONS") return send(204);
    if (req.url !== PATH) return send(404, errorEnvelope(404, "not_found", "Use POST " + PATH + ".").body);
    if (req.method !== "POST") return send(405, errorEnvelope(405, "method_not_allowed", "Use POST.").body);

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!/^Bearer \S+/.test(req.headers.authorization || "")) {
        return send(401, errorEnvelope(401, "unauthorized", "Missing or invalid API key.").body);
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, errorEnvelope(400, "invalid_json", "Request body is not valid JSON.").body);
      }
      const invalid = validateRequest(body);
      requests.push({ body, status: invalid ? invalid.status : 200 });
      if (invalid) return send(invalid.status, invalid.body);
      if (scenario === "rate-limit" && !rateLimited) {
        rateLimited = true;
        const limited = errorEnvelope(429, "rate_limit_exceeded", "Free tier: 1 successful request per minute.");
        return send(429, limited.body, { "Retry-After": "3" });
      }
      const out = answer(body, scenario);
      log(body, out);
      return send(200, out);
    });
  });

  const log = (body, out) => {
    if (!options || !options.verbose) return;
    const a = out.answers;
    const pick = (n) => (a[n] ? a[n].choice : "-");
    process.stdout.write(
      "step " + body.state.step + ": " + pick("action_type") + " " + pick("target_element_id") + " " + pick("text_candidate") + "\n"
    );
  };

  server.requests = requests;
  return server;
}

module.exports = { createMockJevServer, validateRequest, plan, MODELS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const port = Number(arg("port", "41786"));
  const scenario = arg("scenario", "default");
  createMockJevServer({ scenario, verbose: true }).listen(port, "127.0.0.1", () => {
    process.stdout.write("Mock Jev (" + scenario + ") on http://127.0.0.1:" + port + PATH + "\n");
  });
}
