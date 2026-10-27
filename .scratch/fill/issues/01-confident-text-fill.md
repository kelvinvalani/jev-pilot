# 01 — A confident fill writes one text field

**What to build:** One click writes a stored answer into the single empty text field of the only form. The field wording is stored as an alias. The same wording fills again with no Jev call. The goal loop is gone.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] A fill whose scripted choice is at a confidence of 0.85 or above writes the stored answer into the empty text field.
- [x] That field wording is stored as an alias of the slot.
- [x] A later fill of the same wording writes the answer and sends no request.
- [x] The request carries the field wording, the slot names, and the aliases, and carries no answer string.
- [x] A missing API key opens Settings and sends no request.
- [x] The write uses the native value and fires input and change.
- [x] A new profile contains the empty starter slots, including personal email and not work email.
- [x] The typed goal, the multi-step loop, button clicks, and Submit are gone. Tests that exist only to prove them are gone.
- [x] Transport tests are adapted just enough that `npm test` and `npm run check` pass. Their failure paths are ticket 08.
