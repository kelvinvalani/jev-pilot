# A slot has a default answer and situational answers

ADR 0002 held that a slot has at most one answer, so a different answer was always a different slot. That cannot represent the same question answered differently under a different heading. "Country" under "Shipping address" can be Australia while "Country" under "Place of birth" is India. Personal email and work email stay different slots. Those are different facts, not two situations of one email slot.

A slot has at most one default answer, used when no situation applies, and at most one answer per situation. A situation is named from the heading around the field. The user accepts or edits that name in a check. Jev does not invent situation names, because a System One answer can only choose among options the request supplies. Jev chooses one of that slot's existing situations, the default, or none. At a confidence of 0.85 or above, that answer is written and the heading is stored as an alias of that situation. Below that, or none, the check lets the user pick a stored situation or save a new answer under a new situation name. Accepting a situation for a heading stores that heading as an alias too. Situation names go in the fill's single request. Answer strings do not. One form tag can hold several headings, and each field uses its own heading.

When an answer becomes the default is ADR 0009.
