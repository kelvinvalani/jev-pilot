# 06 — Undo reverts the latest fill

**What to build:** Undo takes back the latest fill, including after stop, until another fill starts. A later click fills only what is still empty.

**Blocked by:** 03 — A check, a skip, a stop, and a minted slot. 04 — A situation keeps its own answer. 05 — An option is chosen on this machine.

**Status:** ready-for-agent

- [ ] Undo clears every field that fill wrote.
- [ ] Undo drops the slots, answers, aliases, situations, and option wordings that fill stored.
- [ ] An answer, slot, or situation that existed before the fill stays in the profile.
- [ ] Undo is available after stop, until another fill starts.
- [ ] Starting another fill retires the previous undo.
- [ ] A later fill writes only the fields that are still empty.
