/**
 * Mock JEV System One responses.
 * Shapes follow the typed answer contract used by BeatAPI and TypeSafe:
 *   choice → { type: "choice", choice, confidence, probabilities }
 *   noul   → { type: "noul", noul }   (probability in [0, 1])
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

function noul(value) {
  return { type: "noul", noul: value };
}

/**
 * Build a 200 body for a request. `decide(request)` returns
 * { target, action, confidence?, complex?, text? } where text is the
 * literal value to type (mapped back to a text_candidate key).
 */
function answerFor(request, decision) {
  const q = request.questions;
  const confidence = decision.confidence == null ? 0.95 : decision.confidence;
  const answers = {
    target_element_id: choice(decision.target, confidence, q.target_element_id.criteria),
    action_type: choice(decision.action, decision.actionConfidence || 0.97, q.action_type.criteria),
    requires_complex_text: noul(decision.complex == null ? 0.04 : decision.complex),
  };
  if (q.text_candidate) {
    let key = "none";
    if (decision.text) {
      const hit = Object.entries(q.text_candidate.criteria).find(
        ([, label]) => label === "Type exactly: " + decision.text
      );
      if (hit) key = hit[0];
    }
    answers.text_candidate = choice(key, 0.93, q.text_candidate.criteria);
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

function errorBody(status, code, message, extra) {
  return { error: { type: code, code, message, status, ...(extra || {}) } };
}

/** Find an element id whose criteria label matches `pattern`. */
function findElement(request, pattern) {
  const criteria = request.questions.target_element_id.criteria;
  const hit = Object.entries(criteria).find(([id, label]) => id !== "none_applicable" && pattern.test(label));
  if (!hit) throw new Error("Fixture could not find element matching " + pattern + " in " + JSON.stringify(criteria));
  return hit[0];
}

module.exports = { answerFor, choice, noul, errorBody, findElement };
