# 05 — An option is chosen on this machine

**What to build:** Dropdowns and radio groups are filled locally from the stored answer. Excluded controls never enter the fill. A control that rejects a write becomes a check.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [ ] A radio group is one field. An unchecked group is empty.
- [ ] An option whose label matches the answer, ignoring letter case and extra space, is selected.
- [ ] A stored option wording selects that option. The picked label is stored as an option wording. The answer string stays unchanged.
- [ ] An unmatched dropdown or radio opens a check that asks for the option.
- [ ] Option labels are absent from the Jev request.
- [ ] A text box receives the stored string unchanged. A value of only spaces is empty.
- [ ] A date stored from a text field stays as typed. A date control is filled only when the string is already `YYYY-MM-DD`.
- [ ] A control that does not keep the written value is cleared and becomes a check.
- [ ] A dropdown whose selected option has a blank value, or is disabled, is empty. Any other selected option is left alone.
- [ ] Checkboxes, file pickers, passwords, hidden controls, disabled controls, buttons, readonly controls, multi-selects, and card-number or card-security-code fields are absent from the fill.
