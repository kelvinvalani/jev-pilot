# A fill writes one form

A fill writes the empty fields of one form, not every match on the page. When the focused field is inside a form tag, that tag is the form. Otherwise the form is the visual group: the fields under the nearest heading around the focused field, or the fields that share its parent when it has no heading. If nothing on the page is focused, the form is the form tag with the most empty fields, or the largest visual group when the page has no form tag. A checkout that also has a mailing-list email is the case that forced this: both fields match personal email, and writing the mailing list would subscribe the user. Filling every match on the page was rejected for that reason. Skipping forms because they look like newsletters or logins was rejected because that is a second product guessing the site's intent.

The Jev button takes focus when it is clicked, so the focused field has to be captured at the start of the click, before focus moves.
