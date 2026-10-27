# Jev Fill

The facts a person reuses across forms, and the fields on the page already open that those facts are written into.

## Language

**Fill**:
Writing answers into the fields of one form on the page the user already has open. The user starts it.
_Avoid_: Run, task, goal, automation

**Form**:
The fields a fill writes together. The form tag that contains the focused field, or the visual group around that field when it is not inside a form tag. When nothing is focused, the form tag with the most empty fields, or the largest visual group when the page has no form tag.
_Avoid_: Page

**Visual group**:
The fields under the nearest heading around the focused field. When that field has no heading, the fields that share its parent.
_Avoid_: Page

**Profile**:
The user's editable set of slots, situations, and answers, the same profile on each of their browsers. Passwords, card numbers, and card security codes are not slots.
_Avoid_: Memory, account, vault, password manager

**Slot**:
A specific kind of fact. Personal email and work email are different slots. A slot has at most one default answer, and at most one answer for each situation.
_Avoid_: Field, attribute, detail

**Starter slot**:
One of the empty slots in a new profile: legal first name, family name, personal email, phone, street address, city, region, postcode, and country.
_Avoid_: Template, default field

**Situation**:
A circumstance, named from the heading around a field, in which a slot has its own answer. Jev chooses among situations that already exist. It does not invent the name.
_Avoid_: Context, site, page

**Default answer**:
The answer for a slot when no situation applies.
_Avoid_: Primary, fallback

**Answer**:
The stored string for a slot's default, or for one situation of a slot.
_Avoid_: Detail, information, value

**Option wording**:
An option label accepted as meaning an answer. A match ignores letter case and extra space. The answer string stays unchanged.
_Avoid_: Value, code

**Field**:
A text-like control, a dropdown, or a radio group on the current page that is asking for an answer. A radio group is one field. Checkboxes, file pickers, passwords, hidden controls, disabled controls, and buttons are not fields.
_Avoid_: Input, element, prompt

**Match**:
The decision that a field is asking for one particular slot, and which situation applies, if any.
_Avoid_: Mapping, guess

**Alias**:
A wording accepted as meaning a slot or a situation. For a slot, it is a field wording. For a situation, it is a heading wording. A match at a confidence of 0.85 or above accepts the wording. The user can delete an alias.
_Avoid_: Label, synonym, keyword

**Check**:
A field that will not be written until the user resolves it. Leaving it unresolved stores nothing about that field.
_Avoid_: Review, prompt, confirmation
