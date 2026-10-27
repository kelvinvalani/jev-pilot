const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRequest } = require("../scripts/mock-jev");

test("mock enforces the documented auth, JSON, model and question contract", () => {
  assert.equal(validateRequest(null).status, 400);
  assert.equal(validateRequest({ model: "jev-1.14-free" }).status, 422);
  assert.equal(
    validateRequest({
      model: "jev-1.14-free",
      state: { fields: [] },
      questions: {
        field_0: {
          type: "choice",
          instructions: "Which slot?",
          criteria: { none: "None", "slot:legal first name:default": "legal first name (default)" },
        },
      },
    }),
    null
  );
});
