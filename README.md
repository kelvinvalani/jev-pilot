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
4. Pin **Jev Fast**, then click the icon

Pick the provider in the popup, then paste that provider’s API key. The key is stored with `chrome.storage.sync` and sent only as `Authorization: Bearer …` to the selected host. You do not need a TypeSafe account if you use BeatAPI.

## Use it

1. Open a normal `http(s)` page (or `demo-page.html` from this repo)
2. Paste your API key
3. Enter a goal, for example: `Search for flights from Melbourne to Tokyo`
4. Click **Start**

The popup log records each step in this form:

```
[Step 2] Action: CLICK | Target: elem_1 | Confidence: 0.98 | Latency: 112ms
```

The loop stops when Jev chooses `finish`, after 15 steps, or when you click **Stop**. If target-element confidence is below **0.60**, the loop pauses and the popup asks you to confirm, skip, or stop.

## How a step works

1. `content.js` tags visible `button`, `a`, `input`, `select`, `[role="button"]`, and `[onclick]` nodes with `data-jev-id="elem_N"`
2. `background.js` POSTs that snapshot to Jev as `state` plus three parallel questions:
   - `target_element_id` (`choice`, always includes `none_applicable`)
   - `action_type` (`choice`: `click` / `type` / `finish`)
   - `requires_complex_text` (`noul`)
3. Typed fields are read directly (`answers.target_element_id.choice`, `.confidence`) — no regex
4. Clicks dispatch `mousedown` / `mouseup` / `click`. Typing uses the native `value` setter so React, Vue, and Angular see the change
5. After 300ms (and any navigation), the loop extracts the DOM again

Jev cannot generate free-form copy. Values to type are chosen from short fragments already present in the user goal. If Jev says the field needs written language, the popup asks you to supply the text.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 permissions, service worker, popup |
| `popup.html` / `popup.js` / `popup.css` | API key, goal, start/stop, live log |
| `content.js` | DOM extract + native event dispatch |
| `background.js` | Jev control loop |
| `demo-page.html` | Local flight-search page for a dry run |

## Local UI preview

```bash
python3 -m http.server 41785 --bind 127.0.0.1
```

Then open `http://127.0.0.1:41785/popup.html`. Outside Chrome the popup runs a short demo log so you can see the UI; it cannot touch a live page until it is loaded as an extension.
