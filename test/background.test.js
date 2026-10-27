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
