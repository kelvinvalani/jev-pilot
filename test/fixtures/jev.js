/**
 * Mock JEV System One responses for a fill.
 * Shapes follow the typed answer contract used by BeatAPI and TypeSafe:
 *   choice → { type: "choice", choice, confidence, probabilities }
 */

let seq = 0;

function choice(picked, confidence, criteria) {
  const keys = criteria ? Object.keys(criteria) : [picked];
  const rest = keys.filter((k) => k !== picked);
  const remainder = Math.max(0, 1 - confidence);
  const probabilities = { [picked]: confidence };
  for (const key of rest) probabilities[key] = Number((remainder / Math.max(1, rest.length)).toFixed(4));
  return { type: "choice", choice: picked, confidence, probabilities };
}

/**
 * Build a 200 body for a fill request. `decide(request)` returns
 * { fieldId?, option, confidence? } where option is a choice key from
 * that field's question criteria.
 */
function answerFor(request, decision) {
  const q = request.questions;
  const fieldIds = Object.keys(q);
  const fieldId = decision.fieldId || fieldIds[0];
  const confidence = decision.confidence == null ? 0.95 : decision.confidence;
  const answers = {};
  for (const id of fieldIds) {
    if (id === fieldId) {
      answers[id] = choice(decision.option, confidence, q[id].criteria);
    } else {
      answers[id] = choice("none", 0.9, q[id].criteria);
    }
  }
  seq += 1;
  return {
    id: "sys1_mock_" + String(seq).padStart(4, "0"),
    object: "systemone.response",
    model: request.model,
    created: 1790000000 + seq,
    answers,
    usage: { input_tokens: 812, output_tokens: 9, total_tokens: 821 },
    latency_ms: 84,
  };
}

/** BeatAPI error envelope: {"error":{"code","message","retryable","request_id"}}. */
function errorBody(status, code, message, extra) {
  seq += 1;
  return {
    error: {
      code,
      message,
      retryable: status === 429 || status >= 500,
      request_id: "req_mock_" + String(seq).padStart(4, "0"),
      ...(extra || {}),
    },
  };
}

/** Find a choice key whose criteria label matches `pattern`. */
function findOption(request, pattern) {
  const questions = request.questions;
  for (const q of Object.values(questions)) {
    const hit = Object.entries(q.criteria || {}).find(([, label]) => pattern.test(label));
    if (hit) return hit[0];
  }
  throw new Error("Fixture could not find option matching " + pattern);
}

/** Find the undecided field id whose wording matches `pattern`. */
function findField(request, pattern) {
  const fields = (request.state && request.state.fields) || [];
  const hit = fields.find((f) => pattern.test(f.wording));
  if (!hit) throw new Error("Fixture could not find field matching " + pattern);
  return hit.id;
}

module.exports = { answerFor, choice, errorBody, findOption, findField };
