# Jev Fast

A Manifest V3 Chrome extension that automates the **active tab** with **Jev** — not a generative LLM.

Jev is a single-pass decision model (`Choice` and `Noul`) with typical latency well under 300ms. This extension extracts a compact JSON snapshot of visible interactive elements, asks Jev which element to act on, then dispatches native DOM events. It never asks a model to write code or parse free-form instructions.

You can use either:

- **BeatAPI** (default) — a [BeatAPI](https://beatapi.io/jev-api) key with model `jev-1.13-free` at `https://api.beatapi.io/v1/systemone`. Same Jev 1.13 contract. Works with a zero balance. Free accounts are limited to **one successful request per minute** until you top up.
- **TypeSafe** — a [TypeSafe console](https://console.typesafe.ai/settings/keys) key with `jev-latest` at `https://api.typesafe.ai/v1/systemone`.

The keys are not interchangeable. A BeatAPI key sent to TypeSafe (or the reverse) returns HTTP 401.

## Load as an unpacked extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open any website — a round **Jev** button appears in the bottom-right corner. You can also pin **Jev Fast** and use the toolbar icon.

Pick the provider in Settings, then paste that provider’s API key. The key is stored with `chrome.storage.sync` and sent only as `Authorization: Bearer …` to the selected host. You do not need a TypeSafe account if you use BeatAPI.

## Use it

1. Open a normal `http(s)` page (or `demo-page.html` from this repo)
2. Click the round **Jev** button in the bottom-right corner of the page (or the toolbar icon)
3. The first time, Settings opens: pick BeatAPI or TypeSafe and paste that provider’s key
4. Describe the task, for example `Search for flights from Melbourne to Tokyo`, and press **Run** (or ⌘/Ctrl + Enter)

The overlay floats above the page, so you can watch Jev work. Close it with the button, the ✕, or **Esc** — the run keeps going, and the button shows a green pulse while running, amber when a step needs your review (the overlay reopens automatically), and red on error. You can hide the floating button in Settings.

Each step appears in **Activity** with the action, the element, Jev’s confidence, and latency. **Copy** exports the full log.

The loop stops when Jev chooses `finish`, after 15 steps, or when you click **Stop**. If target-element confidence is below **0.60**, the loop pauses and asks you to run the step, skip it, or stop.

### Errors and retries

API calls are designed not to waste requests:

| Response | What happens |
| --- | --- |
| 429 | Waits for `Retry-After` (or `retry_after_seconds`, or 60s on BeatAPI free), then paces later requests to that interval. Up to 4 retries. |
| 529 / 5xx | Up to 2 retries with backoff, unless the error says `retryable: false`. |
| Network error / 12s timeout | Up to 2 retries. |
| 400, 401, 402, 403, 404, 422 | No retry; the run stops with a message saying what to fix (wrong key for provider, no credits, unknown model, …). |
| Malformed answers (missing typed Choice, unknown element id, unsupported action) | No retry, no page action; the run stops with an explanation. |

Stopping cancels any wait or in-flight request, and late responses are discarded.

## How a step works

1. `content.js` tags visible `button`, `a`, `input`, `select`, `[role="button"]`, and `[onclick]` nodes with `data-jev-id="elem_N"`
2. `background.js` POSTs that snapshot to Jev as `state` plus three parallel questions:
   - `target_element_id` (`choice`, always includes `none_applicable`)
   - `action_type` (`choice`: `click` / `type` / `finish`)
   - `requires_complex_text` (`noul`)
3. Typed fields are read directly (`answers.target_element_id.choice`, `.confidence`) — no regex
4. Clicks dispatch `pointerdown` / `mousedown` / `pointerup` / `mouseup` / `click` once. Typing uses the native `value` setter so React, Vue, and Angular see the change
5. After 300ms (and any navigation), the loop extracts the DOM again

Jev cannot generate free-form copy. Values to type are chosen from short fragments already present in the user goal. If Jev says the field needs written language, the popup asks you to supply the text.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 permissions, service worker, popup, launcher content script |
| `launcher.js` | Floating bottom-right button + overlay (shadow DOM, iframe of `popup.html?surface=overlay`) |
| `popup.html` / `popup.js` / `popup.css` | Settings, task input, review step, activity timeline (toolbar popup and overlay) |
| `content.js` | DOM extract + native event dispatch (never targets Jev’s own UI) |
| `background.js` | Jev control loop, validation, retries, rate-limit pacing |
| `demo-page.html` | Local flight-search page for a dry run |
| `test/` | Mocked unit + integration tests (no API key or network needed) |

## Tests

```bash
npm install
npm test        # mocked JEV API + jsdom DOM tests
npm run check   # JS syntax + manifest validation
```

`test/fixtures/jev.js` builds typed System One responses (`choice` with `confidence` and `probabilities`, `noul` probabilities). The integration tests run `background.js` against the real `content.js` on `demo-page.html` with a mocked `fetch` and a virtual clock, covering the full flow, confirmations, 429/5xx/timeouts, auth and billing errors, malformed answers, Stop/cancel races, and restricted pages — without spending any tokens.

## Local UI preview

```bash
npm run preview   # python3 -m http.server 41785 --bind 127.0.0.1
```

Then open `http://127.0.0.1:41785/popup.html`. Outside Chrome the UI uses a mock runtime (including a low-confidence review step) so you can try it without a key; it cannot touch a live page until it is loaded as an extension.
