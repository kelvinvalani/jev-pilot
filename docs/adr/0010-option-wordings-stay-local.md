# Dropdowns and radios are matched on the machine

Jev never receives answer strings, so it cannot see that a stored "Australia" is the option labelled "AUS". A radio group is one field. After a slot and a situation are chosen, the extension selects the option whose label matches the answer or an option wording already accepted for it, ignoring letter case and extra space. If none match, the field is a check and the user picks the option. The picked label is stored as an option wording of that answer. The answer string is not replaced.

Sending the answer so Jev could pick the option was rejected because it breaks the rule that answers stay on the machine. Skipping an unmatched dropdown was rejected because a coded option list would then never fill.

A dropdown whose selected option has a blank value, or is disabled, is empty. Any other selected option is left alone. A date is stored as the user typed it. A browser date control is filled only when that string is already `YYYY-MM-DD`. A text box receives the stored string unchanged.
