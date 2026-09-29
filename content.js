/**
 * Jev Fast — DOM extractor and native event dispatcher.
 * Injected into the active tab. Keeps an in-memory map of data-jev-id
 * markers so execute can still reach open shadow-root nodes.
 */

(() => {
  if (window.__jevFastContentLoaded) {
    return;
  }
  window.__jevFastContentLoaded = true;

  const INTERACTIVE_SELECTOR = [
    "button",
    "a",
    "input",
    "select",
    "textarea",
    '[role="button"]',
    "[onclick]",
  ].join(",");

  const MAX_ELEMENTS = 80;
  const LABEL_MAX = 96;

  /** @type {Map<string, Element>} */
  let elementMap = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    try {
      if (message.type === "PING") {
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "EXTRACT") {
        sendResponse({
          ok: true,
          elements: extractInteractiveElements(),
          url: location.href,
          title: document.title || "",
        });
        return;
      }
      if (message.type === "EXECUTE") {
        sendResponse(
          executeElementAction(message.targetId, message.actionType, message.textValue || "")
        );
        return;
      }
      if (message.type === "CLEAR_MARKERS") {
        clearMarkers();
        sendResponse({ ok: true });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  function extractInteractiveElements() {
    clearMarkers();
    elementMap = new Map();

    const found = queryAllDeep(document, INTERACTIVE_SELECTOR);
    const unique = [];
    const seen = new Set();
    for (const el of found) {
      if (seen.has(el)) continue;
      seen.add(el);
      unique.push(el);
    }

    const scored = [];
    for (const el of unique) {
      if (!isEligible(el)) continue;
      const rect = el.getBoundingClientRect();
      const inViewport =
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
      scored.push({ el, inViewport, top: rect.top, left: rect.left });
    }

    scored.sort((a, b) => {
      if (a.inViewport !== b.inViewport) return a.inViewport ? -1 : 1;
      if (a.top !== b.top) return a.top - b.top;
      return a.left - b.left;
    });

    const picked = scored.slice(0, MAX_ELEMENTS);
    const result = [];
    for (let i = 0; i < picked.length; i += 1) {
      const id = "elem_" + i;
      const el = picked[i].el;
      el.setAttribute("data-jev-id", id);
      elementMap.set(id, el);
      result.push({
        id,
        tag: el.tagName,
        label: describeElement(el),
        type: elementType(el),
      });
    }
    return result;
  }

  function executeElementAction(targetId, actionType, textValue) {
    const el = resolveTarget(targetId);
    if (!el) {
      clearMarkers();
      return { ok: false, error: "Target " + targetId + " is no longer in the DOM." };
    }

    try {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    } catch {
      el.scrollIntoView(true);
    }

    let result;
    const type = String(actionType || "").toLowerCase();
    if (type === "type") {
      if (isTypable(el)) {
        result = typeInto(el, textValue);
      } else {
        clickElement(el);
        result = {
          ok: true,
          coerced: "click",
          detail: "Element is not typable; dispatched click instead.",
        };
      }
    } else {
      clickElement(el);
      result = { ok: true, detail: "Clicked " + targetId };
    }

    clearMarkers();
    return result;
  }

  function resolveTarget(targetId) {
    if (elementMap.has(targetId)) {
      const mapped = elementMap.get(targetId);
      if (mapped && mapped.isConnected) return mapped;
    }
    return document.querySelector('[data-jev-id="' + cssEscape(targetId) + '"]');
  }

  function clickElement(el) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      // Some elements reject focus.
    }
    const opts = { bubbles: true, cancelable: true, view: window, composed: true };
    el.dispatchEvent(new MouseEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    if (typeof el.click === "function") {
      el.click();
    }
  }

  function typeInto(el, textValue) {
    const value = textValue == null ? "" : String(textValue);
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignore
    }

    if (el instanceof HTMLSelectElement) {
      return setSelectValue(el, value);
    }

    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, data: value, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, detail: "Typed into contenteditable" };
    }

    setNativeValue(el, value);
    dispatchTypingEvents(el, value);
    return { ok: true, detail: "Typed into " + el.tagName.toLowerCase() };
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchTypingEvents(el, value) {
    const lastChar = value.slice(-1) || "a";
    const keyOpts = {
      bubbles: true,
      cancelable: true,
      key: lastChar,
      code: lastChar.length === 1 ? "Key" + lastChar.toUpperCase() : "Unidentified",
    };
    el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: value,
        inputType: "insertText",
      })
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelectValue(el, value) {
    const needle = value.trim().toLowerCase();
    let matched = "";
    for (const opt of Array.from(el.options)) {
      const label = String(opt.textContent || "").trim();
      const val = String(opt.value || "").trim();
      if (
        val === value ||
        label === value ||
        val.toLowerCase() === needle ||
        label.toLowerCase() === needle ||
        label.toLowerCase().includes(needle) ||
        val.toLowerCase().includes(needle)
      ) {
        matched = opt.value;
        break;
      }
    }
    if (matched !== "") {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(el, matched);
      } else {
        el.value = matched;
      }
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, detail: "Set select value" };
  }

  function isTypable(el) {
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLSelectElement) return true;
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return true;
    if (!(el instanceof HTMLInputElement)) return false;
    const type = (el.type || "text").toLowerCase();
    if (["button", "submit", "reset", "checkbox", "radio", "file", "image", "hidden", "range", "color"].includes(type)) {
      return false;
    }
    return true;
  }

  function isEligible(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("script, style, noscript, template")) return false;
    if (el instanceof HTMLInputElement && String(el.type).toLowerCase() === "hidden") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return isVisible(el);
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    const rect = el.getBoundingClientRect();
    const tiny = rect.width < 2 || rect.height < 2;
    if (tiny && !(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLTextAreaElement)) {
      return false;
    }
    return true;
  }

  function describeElement(el) {
    const bits = [];
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => {
          const node = document.getElementById(id);
          return node ? innerLabel(node) : "";
        })
        .join(" ")
        .trim();
      if (text) bits.push(text);
    }
    pushUnique(bits, el.getAttribute("aria-label"));
    if (el.id) {
      const forLabel = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (forLabel) pushUnique(bits, innerLabel(forLabel));
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel) pushUnique(bits, innerLabel(wrappingLabel));
    pushUnique(bits, el.getAttribute("placeholder"));
    pushUnique(bits, el.getAttribute("title"));
    pushUnique(bits, el.getAttribute("alt"));
    pushUnique(bits, el.getAttribute("name"));
    pushUnique(bits, innerLabel(el));
    pushUnique(bits, el.getAttribute("value"));
    const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") : "";
    if (href && href !== "#") pushUnique(bits, href.slice(0, 60));
    const joined = bits.filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
    return clip(joined || el.tagName.toLowerCase(), LABEL_MAX);
  }

  function elementType(el) {
    if (el instanceof HTMLInputElement) return el.type || "text";
    if (el instanceof HTMLTextAreaElement) return "textarea";
    if (el instanceof HTMLSelectElement) return "select";
    if (el instanceof HTMLAnchorElement) return "link";
    if (el instanceof HTMLButtonElement) return el.type || "button";
    const role = el.getAttribute("role");
    if (role) return role;
    return el.tagName.toLowerCase();
  }

  function innerLabel(el) {
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return clip(text, LABEL_MAX);
  }

  function pushUnique(bits, value) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;
    const clipped = clip(text, LABEL_MAX);
    if (bits.some((b) => b.toLowerCase() === clipped.toLowerCase())) return;
    bits.push(clipped);
  }

  function clip(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function queryAllDeep(root, selector, acc) {
    const out = acc || [];
    if (!root) return out;
    try {
      out.push(...root.querySelectorAll(selector));
    } catch {
      return out;
    }
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const node of all) {
      if (node.shadowRoot) {
        queryAllDeep(node.shadowRoot, selector, out);
      }
    }
    return out;
  }

  function clearMarkers() {
    for (const el of elementMap.values()) {
      if (el && el.removeAttribute) el.removeAttribute("data-jev-id");
    }
    const leftover = queryAllDeep(document, "[data-jev-id]");
    for (const el of leftover) {
      el.removeAttribute("data-jev-id");
    }
    elementMap = new Map();
  }
})();
