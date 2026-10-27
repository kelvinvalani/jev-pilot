# 08 — A failed call stops cleanly

**What to build:** The one Jev call keeps the existing failure behavior. A failed fill keeps the writes already made and opens no further checks.

**Blocked by:** 01 — A confident fill writes one text field

**Status:** ready-for-agent

- [ ] A 429 or 529 waits and retries within the existing bound, then the fill can succeed.
- [ ] A 5xx and a network failure retry within the existing bound. A non-retryable client error stops the fill.
- [ ] A malformed choice stops the fill and writes nothing from that response.
- [ ] Stop during a wait cancels the call. A response that arrives after stop does not write.
- [ ] A failed call keeps writes already made and opens no check for the undecided fields.
- [ ] The API key is absent from the status and the log.
- [ ] A localhost test endpoint is accepted. A remote override is refused.
- [ ] The page script is injected when the page has no listener.
- [ ] A restricted page or a closed tab ends the fill with an explanation.
- [ ] A field in an open shadow root can be filled. The launcher is not a field.
