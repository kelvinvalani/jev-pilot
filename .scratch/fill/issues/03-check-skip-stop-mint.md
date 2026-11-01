# 03 — A check, a skip, a stop, and a minted slot

**What to build:** After the confident writes, the fill asks about the remaining fields one at a time. The person can attach a slot, mint one, skip, or stop.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [x] A choice below 0.85, and a choice of none, opens a check after the confident writes.
- [x] Checks open one at a time, in page order.
- [x] One saved check settles the slot and the answer, then writes the field.
- [x] Skip leaves that field blank, stores nothing, and opens the next check.
- [x] A skipped field is asked again on a later fill.
- [x] Stop ends the remaining checks. Writes already made stay.
- [x] Closing the panel is stop.
- [x] The person can attach the field to an existing slot.
- [x] Minting uses the field wording as the slot name and its first alias, and the person can edit that name before save.
- [x] A second fill is refused while one is in progress.
