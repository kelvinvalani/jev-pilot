# 03 — A check, a skip, a stop, and a minted slot

**What to build:** After the confident writes, the fill asks about the remaining fields one at a time. The person can attach a slot, mint one, skip, or stop.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [ ] A choice below 0.85, and a choice of none, opens a check after the confident writes.
- [ ] Checks open one at a time, in page order.
- [ ] One saved check settles the slot and the answer, then writes the field.
- [ ] Skip leaves that field blank, stores nothing, and opens the next check.
- [ ] A skipped field is asked again on a later fill.
- [ ] Stop ends the remaining checks. Writes already made stay.
- [ ] Closing the panel is stop.
- [ ] The person can attach the field to an existing slot.
- [ ] Minting uses the field wording as the slot name and its first alias, and the person can edit that name before save.
- [ ] A second fill is refused while one is in progress.
