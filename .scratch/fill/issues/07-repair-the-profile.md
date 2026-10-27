# 07 — The profile can be repaired

**What to build:** The person can rename a slot, edit a stored answer, delete a slot, and delete an alias. A card secret cannot be minted. The profile lives in Chrome sync.

**Blocked by:** 04 — A situation keeps its own answer

**Status:** ready-for-agent

- [ ] The person can rename a slot, edit a default answer, and edit a situational answer.
- [ ] Deleting a slot removes its answers and its field aliases. A situation another slot still uses remains.
- [ ] Deleting an alias removes that extra wording.
- [ ] A slot named as a card number or a card security code is refused. A tax file number can be saved.
- [ ] A refused name during minting leaves the check open.
- [ ] The profile is one Chrome sync record, separate from the API key.
- [ ] When sync refuses the write, that field is not written, the fill stops with an explanation, and writes already saved stay.
