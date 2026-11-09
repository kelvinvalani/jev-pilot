# 02 — A fill writes one form

**What to build:** A fill writes the empty fields of one form. The form is chosen from the focus captured at the click, before the Jev button takes focus.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [x] A focused field inside a form tag fills that tag and leaves a second form on the page alone.
- [x] A focused field outside any form tag fills the visual group under its nearest heading.
- [x] A focused field with no heading fills the fields that share its parent.
- [x] With nothing focused, the fill chooses the form tag with the most empty fields.
- [x] With nothing focused and no form tag, the fill chooses the largest visual group.
- [x] A tie goes to the first form in tree order.
- [x] A field that already has a value is left as it is.
- [x] The focused element is the one captured at the start of the click.
