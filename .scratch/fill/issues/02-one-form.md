# 02 — A fill writes one form

**What to build:** A fill writes the empty fields of one form. The form is chosen from the focus captured at the click, before the Jev button takes focus.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [ ] A focused field inside a form tag fills that tag and leaves a second form on the page alone.
- [ ] A focused field outside any form tag fills the visual group under its nearest heading.
- [ ] A focused field with no heading fills the fields that share its parent.
- [ ] With nothing focused, the fill chooses the form tag with the most empty fields.
- [ ] With nothing focused and no form tag, the fill chooses the largest visual group.
- [ ] A tie goes to the first form in tree order.
- [ ] A field that already has a value is left as it is.
- [ ] The focused element is the one captured at the start of the click.
