Status: ready-for-agent

# Fill the current page

Glossary: `CONTEXT.md`. Decisions: `docs/adr/0001` through `docs/adr/0010`. ADR 0002 is superseded by ADR 0008. Personal email and work email stay different slots.

## Problem Statement

The person has a form open and has to retype the same facts into it. Jev Fast asks them to type a goal, then clicks, types, and moves around the page, including pressing Submit. They wanted the answers written into the form they already have open, and they still want to send the form themselves.

## Solution

A fill writes the profile into the empty fields of one form on the page already open. The person starts it from the Jev button or the toolbar panel. Jev chooses which slot and which situation a field is asking for. The extension writes the stored answer, asks when it is not sure, and leaves Submit to the person.

The profile is slots, situations, and answers. It is the same profile on each of their browsers, stored with Chrome sync. A new profile starts with empty starter slots: legal first name, family name, personal email, phone, street address, city, region, postcode, and country.

## User Stories

1. As a person filling a form, I want one click to write my answers into the form I already have open, so that I can submit it myself.
2. As a person filling a form, I want the fill to use the field that had focus when I clicked, so that the Jev button taking focus does not change which form is written.
3. As a person filling a form, I want the form tag around that focused field to be the form, so that a second form on the page is left alone.
4. As a person filling a form, I want a focused field that is not inside a form tag to fill the visual group under its nearest heading, so that a heading-sized section is the form.
5. As a person filling a form, I want a focused field with no heading to fill the fields that share its parent, so that a group with no heading still has a boundary.
6. As a person filling a form, I want an unfocused page to fill the form tag with the most empty fields, so that a click with nothing selected still picks one form.
7. As a person filling a form, I want an unfocused page with no form tag to fill the largest visual group, so that the page still has one form.
8. As a person filling a form, I want a tie between forms to go to the first form in page order, so that the choice is stable.
9. As a person filling a form, I want fields that already have a value left as they are, so that I do not lose something I typed.
10. As a person filling a form, I want an unchecked radio group treated as empty, so that an unanswered choice can be filled.
11. As a person filling a form, I want a value of only spaces treated as empty, so that a blank-looking field is filled.
12. As a person filling a form, I want a dropdown with a blank or disabled selected option treated as empty, so that a placeholder can be filled.
13. As a person filling a form, I want any other selected dropdown option left alone, so that an answer already chosen stays chosen.
14. As a person filling a form, I want checkboxes, file pickers, passwords, hidden controls, disabled controls, buttons, readonly controls, and multi-selects left untouched, so that a fill only writes fields.
15. As a person filling a form, I want a card-number field and a card-security-code field left untouched, so that those facts never enter my profile.
16. As a person filling a form, I want a new profile to contain the empty starter slots, so that the usual identity facts are ready to match.
17. As a person filling a form, I want personal email and work email to stay different slots, so that a work address is never written into a personal email field.
18. As a person filling a form, I want a confident match to write that slot's answer, so that a wording Jev is sure about is filled immediately.
19. As a person filling a form, I want that confident field wording stored as an alias, so that the same wording fills next time without asking.
20. As a person filling a form, I want a wording that already matches an alias to fill without a call, so that a repeat visit does not spend the free-tier call.
21. As a person filling a form, I want a confident match whose slot has no answer yet to ask me for the answer, so that an empty starter slot becomes useful on first use.
22. As a person filling a form, I want the confident writes to land before any check, so that I can see what was filled while I resolve the rest.
23. As a person filling a form, I want the checks one at a time in page order, so that I finish one field before the next opens.
24. As a person filling a form, I want one check to settle the slot, the situation name, the answer, and the option, so that the field can be written when I save it.
25. As a person filling a form, I want a low-confidence match to be a check, so that an unsure wording is not stored as an alias.
26. As a person filling a form, I want a match of none to be a check, so that I can still attach the field or leave it.
27. As a person filling a form, I want Skip to leave that field blank and store nothing, so that I can pass on a field I do not want saved.
28. As a person filling a form, I want the next check to open after Skip, so that the rest of the form continues.
29. As a person filling a form, I want a skipped field asked again on a later fill, so that Skip is not a permanent dismissal.
30. As a person filling a form, I want Stop to end the rest of the fill, so that I can halt when the remaining fields are wrong.
31. As a person filling a form, I want closing the panel to stop the fill, so that dismissing the panel is the same halt.
32. As a person filling a form, I want writes already made to stay after Stop, so that the fields already filled are not wiped by stopping.
33. As a person filling a form, I want to attach a check to an existing slot, so that a new wording reuses a fact I already keep.
34. As a person filling a form, I want to mint a slot from a check, so that a fact the profile does not have can be saved.
35. As a person filling a form, I want the field wording to be the new slot's name and its first alias, so that the next form with that wording matches.
36. As a person filling a form, I want to edit that name before the slot is saved, so that the slot name can be the fact rather than the page's wording.
37. As a person filling a form, I want a minted tax file number to sync with the rest of the profile, so that a sensitive fact other than a password or a card secret is still mine to keep.
38. As a person filling a form, I want a refused card-number name or card-security-code name to keep the check open, so that I can pick another slot instead.
39. As a person filling a form, I want the heading around a field to be the proposed situation name, so that "Shipping address" and "Place of birth" can hold different answers for one slot.
40. As a person filling a form, I want to accept or edit that situation name in a check, so that a new circumstance is never written on confidence alone.
41. As a person filling a form, I want a heading with no text to leave the situation name blank for me to type, so that Jev does not invent a name.
42. As a person filling a form, I want the default answer used when the heading is the usual ask, so that my ordinary country is written under an ordinary "Country" label.
43. As a person filling a form, I want a special heading to store a situation and leave the default empty, so that the first form I fill cannot poison the default with someone else's fact.
44. As a person filling a form, I want "this is my usual answer" to save the default when the slot has none yet, so that I can mark the ordinary answer myself.
45. As a person filling a form, I want "this is my usual answer" to write the stored default once one exists, without replacing it, so that I change the stored string in the profile.
46. As a person filling a form, I want an answer I type for a new situation stored only on that situation, so that a circumstance does not overwrite the default.
47. As a person filling a form, I want a confident match to an existing situation to write that answer and store the heading as an alias, so that the same heading means that situation next time.
48. As a person filling a form, I want each field to use its own heading, so that one form tag can hold two situations.
49. As a person filling a form, I want a dropdown or a radio group chosen on this machine, so that my answer strings are never sent to Jev.
50. As a person filling a form, I want a radio group treated as one field, so that the group is one question rather than one question per option.
51. As a person filling a form, I want an option whose label matches the answer, ignoring letter case and extra space, to be selected, so that "Australia" selects "australia".
52. As a person filling a form, I want a previously accepted option wording to select that option too, so that "AUS" can mean the stored "Australia".
53. As a person filling a form, I want the picked option label stored as an option wording, so that the answer string itself stays unchanged.
54. As a person filling a form, I want an unmatched dropdown or radio to become a check where I pick the option, so that a coded list can still be filled.
55. As a person filling a form, I want a text box to receive the stored string unchanged, so that spacing I saved is what gets written.
56. As a person filling a form, I want a date I typed stored as I typed it, so that a text date keeps its original form.
57. As a person filling a form, I want a browser date control filled only when the stored string is already `YYYY-MM-DD`, so that a control that cannot hold another shape asks me instead.
58. As a person filling a form, I want a control that rejects the written value to become a check, with the field cleared again, so that a rejected write does not look filled.
59. As a person filling a form, I want one Jev request for the whole fill, so that a ten-field form finishes inside the free tier of one successful call per minute.
60. As a person filling a form, I want that request to carry the empty fields, the slot names, the situation names, and the aliases, so that Jev can choose a meaning.
61. As a person filling a form, I want answer strings and option labels kept out of that request, so that the call is only deciding which slot a wording means.
62. As a person filling a form, I want each field to be its own flat choice, so that one field's answer is not required to decide the next.
63. As a person filling a form, I want Jev limited to the options the request supplies, so that a situation name comes from a heading or from me.
64. As a person filling a form, I want a fill whose fields all match aliases to make no request, so that a fully learned form spends no call.
65. As a person filling a form, I want a failed call to keep the writes already made and to open no further checks, so that I can undo or try again later.
66. As a person filling a form, I want Stop during a wait to cancel the call and ignore a late response, so that a halt cannot write afterwards.
67. As a person filling a form, I want the same provider, key, retries, and localhost test endpoint I already have, so that BeatAPI and TypeSafe keep working for this one call.
68. As a person filling a form, I want the API key absent from the status and the log, so that the panel cannot reveal it.
69. As a person filling a form, I want Undo to revert the latest fill, including after Stop, until I start another fill, so that I can take back a click I do not want.
70. As a person filling a form, I want Undo to clear the fields that click wrote and to drop the slots, answers, aliases, situations, and option wordings that click stored, so that the profile returns to what it was before that click.
71. As a person filling a form, I want an answer that already existed before that click to remain in the profile, so that Undo removes the write and the learning, not facts I already kept.
72. As a person filling a form, I want a later click to fill whatever is still empty, so that a skipped or stopped field can be completed without touching filled fields.
73. As a person filling a form, I want to rename a slot, edit its stored answers, delete a slot, and delete an alias in the profile, so that repair is delete and fill again.
74. As a person filling a form, I want the profile in Chrome sync, so that my other signed-in browsers have the same slots, situations, and answers.
75. As a person filling a form, I want a profile Chrome sync will not store to stop the fill with an explanation, so that the page is not written for a fact that was not saved.
76. As a person filling a form, I want a missing API key to open Settings and send no request, so that the first run still asks me for a key.
77. As a person filling a form, I want a second fill refused while one is in progress, so that two clicks cannot write the same form at once.
78. As a person filling a form, I want fields inside an open shadow root to be fillable, and the Jev button itself ignored, so that the page's fields are in scope and the extension's own controls are not.
79. As a person filling a form, I want a text write to use the control's native value and to fire input and change, so that the page's own scripts see the answer.
80. As a person filling a form, I want a restricted page, a closed tab, or a blocked content script to end the fill with an explanation, so that I know why nothing was written.

## Implementation Decisions

### Modules

- The page script resolves one form, lists its empty fields, and writes a value into a field. Option labels stay in that result for the service worker and are not forwarded to Jev.
- The service worker owns the profile, the single request, alias matching, confident writes, checks, stop, and undo.
- The panel starts a fill, shows one check, edits the profile, and offers undo. Settings still hold the provider, the API key, the launcher visibility, and the localhost test endpoint.
- The launcher captures the focused element at the start of the click, then opens the panel. Closing the panel while a fill is resolving checks is stop. Closing it after the fill has finished leaves the writes in place.

### Profile record

The profile is one Chrome sync record, separate from the API key.

- A slot has an id, a name, and field-wording aliases. The name matches as an alias.
- A situation has an id, a name, and heading-wording aliases. The name matches as an alias. Situations belong to the profile, and a slot stores at most one answer for each situation.
- An answer has a slot, either the default or one situation, the stored string, and option wordings.
- Comparison for alias, situation identity, option labels, and the ban list trims, collapses internal space, and ignores letter case. The stored answer string is written to the page unchanged.
- The nine starter slots are created when the record is absent. They are empty. Work email is not a starter slot.
- A slot name is refused when it is a card number or a card security code. The refused wordings are: card number, credit card number, debit card number, card security code, security code, cvc, cvv, cvc2, and cid. A tax file number is allowed. There is no digit-pattern ban.
- Deleting a slot deletes its answers and its field aliases. A situation another slot still uses remains. Deleting an alias deletes that extra wording. Renaming is how the slot's own name stops matching.
- There is no merge.

### What a field is

A field is a text box, a textarea, a contenteditable control, a date control (`input type="date"`), a single-select dropdown, or a radio group. Text-like input types are text, email, tel, url, search, and number.

These controls are outside a fill: checkbox, file picker, password, hidden control, disabled control, button, link, readonly control, multi-select, range, color, time, month, week, datetime-local, and any control whose autocomplete is `cc-number` or `cc-csc`. A field wording that matches the ban list is outside a fill. The launcher is outside a fill. A control that is not visible is outside a fill, including hidden, aria-hidden, and closed-off shadow content. An open shadow root is in scope.

A radio group is the radios that share a name inside the form. Radios with no name that share a fieldset are one group. Its wording is the fieldset legend, otherwise the group's accessible name.

A field wording is its accessible name from the label, `aria-labelledby`, or `aria-label`. When that is empty, the placeholder is the wording. The heading wording is the text of the nearest heading. A heading is a legend of an ancestor fieldset, otherwise the nearest preceding `h1`–`h6` in tree order such that the field comes before the next heading of equal or higher rank.

### Which form

The focused element is the one captured at click, before the button takes focus. If that element is a field or is inside a field, that field is the focused field. If it sits in a form tag, the form is that tag's fields. Otherwise the form is the focused field's visual group: the fields under its nearest heading, or the fields that share its parent when it has no heading.

When nothing on the page is focused, the form is the form tag with the most empty fields. When the page has no form tag, the form is the visual group with the most empty fields. Ties go to the first in tree order.

Empty means: a text-like value that is empty after trim; an unchecked radio group; a dropdown whose selected option has a blank value or is disabled. Any other selected option is occupied. Only empty fields are in the fill.

### One fill

1. Refuse when the API key is missing, a fill is already running, the tab is restricted, or the page script cannot be injected. A missing key opens Settings.
2. Resolve the form and its empty fields in tree order.
3. Match aliases locally. A slot hit plus a situation hit selects that pair. A slot hit with no heading text selects the default. A slot hit whose heading is not an alias waits for Jev. No slot hit waits for Jev.
4. Write each local hit that has an answer. A missing answer, an unmatched option, or a rejected write becomes a check with the slot and situation already chosen. A local hit stores nothing new.
5. Send one request when any field is still undecided. A transport failure stops the fill. Writes already saved stay. Checks for the undecided fields do not open.
6. Apply confident choices, then open the remaining checks one at a time.

A choice at a confidence of 0.85 or above is confident. Below that, a missing confidence and a missing probability, an unknown option, or `none` is a check. When confidence is absent and the chosen option has a probability, that probability is the confidence.

Confident choices:

- Default, and the default answer exists: write it, and store the field wording as a slot alias. The heading is not stored as a situation.
- Default, and no default answer exists: check, with that slot and "this is my usual answer" selected.
- Existing situation, and that answer exists: write it, store the field wording as a slot alias, and store a non-empty heading as a situation alias.
- Existing situation, and no answer exists: check, with that slot and situation selected.
- New situation: do not write. Check, with the heading text as the proposed name. An empty heading leaves the name blank.

A write uses the native value setter on a text box or textarea and fires input and change. A contenteditable control receives the string as its text and fires the same events. A dropdown or radio is set to the option whose label matches the answer or an option wording. A date control is written only when the string is already `YYYY-MM-DD`. If the control does not keep the value, restore it to empty and open a check.

### The request

One POST to the selected provider, with the existing model, bearer token, timeout, retries, rate-limit pacing, and localhost-only test endpoint. Stop aborts the wait and discards a late response.

The state carries the undecided fields (id, wording, heading wording) and the profile's slot names, situation names, and aliases. It carries no answer string, no option label, no user goal, no page text, and no action history.

Each undecided field is one choice question. Every question offers the same options: each slot with its default, each existing pair of a slot and a situation, a new-situation option for each slot, and none. The criteria name those options. They do not contain answer strings. The questions are independent.

A fill that resolves every field locally sends no request.

### A check

The panel shows one check: the field wording, the heading wording, the slot (an existing slot or a new name), the situation (an existing situation, a name to accept or edit, or "this is my usual answer"), the answer, and the option labels when the field is a dropdown or a radio.

Saving a new situation stores the typed answer only on that situation. The default is unchanged. The accepted name reuses a situation with the same comparison key. A heading wording that differs from the saved name is stored as an alias of that situation.

"This is my usual answer" stores no situation and stores the field wording as a slot alias. When the slot has no default, the typed answer becomes the default. When a default exists, the field is written with the stored default and the stored string is not replaced.

Skip stores nothing about that field and opens the next check. Stop discards the remaining checks. Writes already saved stay.

Minting uses the field wording as the slot name and as an alias. The person may edit the name before save. The field wording is still stored as an alias. A refused ban name leaves the check open.

### Undo

The service worker remembers the profile and the field values from the start of the fill. Undo is available after the fill ends, including after Stop, until another fill starts. It clears every field that fill wrote and drops slots, answers, aliases, situations, and option wordings that fill stored. Answers, slots, and situations that existed before the fill stay. Profile edits made afterwards in the profile view are not a fill and are not what Undo reverts. Starting another fill retires the previous undo.

### Panel status

The status broadcast for a fill includes: in progress or not, the current check (wording, heading, pre-selected slot, pre-selected situation, whether an option is required, option labels), whether undo is available, and the last error. The API key is absent. The panel sends fill, skip, stop, undo, a check resolution, and profile edits. The launcher opens when a check is waiting.

The goal box, the step timeline, and the 0.60 review card are removed with the goal loop.

### Sync failure

When Chrome sync refuses the profile write, that field is not written, the fill stops, and the status explains that the profile could not be saved. Writes already saved in that fill stay, and undo can revert them.

## Testing Decisions

A good test asserts what a person can observe: the values in the form, the profile record in sync storage, the single request body, and the check status broadcast after fill, skip, stop, undo, and a check resolution. Internal helpers are not the assertion surface.

The seam is the existing service-worker harness: a jsdom page, a scripted Jev response, and the message the panel sends to start a fill. The page script is reached through that harness. Fill behavior has no separate page-script suite, profile suite, or panel-DOM suite.

`npm test` and `npm run check` are the bar. The static check stays a syntax and manifest check.

The harness today describes the automater. These behaviors are deleted, and tests that exist only to prove them are deleted with them:

- A typed goal, a multi-step loop, a 15-step cap, a repeated-step stop, and a finish action.
- Clicking buttons, pressing Enter to submit, and coercing a type into a click.
- The 0.60 review pause, Noul, and text candidates taken from the goal.
- Sending a user goal, page text, or action history to Jev.
- The flight-search run as the product's happy path.

These behaviors stay and are proven again on a fill, at the same seam: provider endpoint and model, bearer auth, the 12-second timeout, 429 and 529 pacing, bounded 5xx and network retries, a non-retryable client error, a malformed choice, stop cancelling a late response, the API key absent from status, the localhost test endpoint, injection when the page has no listener, a closed tab, a restricted page, native value setting, open shadow roots, and the launcher ignored as a field. Settings tests that only save the provider and the API key may stay. Launcher tests that only mount and show the button may stay, provided they no longer describe a goal run.

Prior art is that harness and its scripted response. The new tests start a fill instead of a goal.

## Out of Scope

- Submitting, navigating, or clicking through a multi-step task.
- Filling more than one form per click, or writing over a non-empty field.
- Inventing an answer string or a situation name.
- Sending answers or option labels to Jev.
- Merging slots, a server account, or a password manager.
- A second Jev call in the same fill.
- Time, month, week, and datetime-local controls.
- Renaming the extension in the Chrome Web Store.

## Further Notes

The confirmed picture includes the rules that were not yet in an ADR: check order, skip, stop, undo, a later fill, a rejected write, what is empty, readonly and multi-select, no merge, a blank heading, and the ban list of passwords, card numbers, and card security codes.

Chrome sync storage is about 100KB. That budget is for this profile. A shared browser profile shares the record, which is the sync ADR's accepted consequence.

The free BeatAPI tier allows one successful call per minute. Retries of a failed call are the existing transport. A successful fill makes at most one successful call.
