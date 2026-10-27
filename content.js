/**
 * Jev Fill — page script.
 * Resolves one form's empty fields and writes answers with native setters.
 */

(() => {
  if (window.__jevFillContentLoaded) {
    return;
  }
  window.__jevFillContentLoaded = true;

  const TEXT_TYPES = new Set(["text", "email", "tel", "url", "search", "number"]);
  const LABEL_MAX = 96;

  /** @type {Map<string, Element>} */
  let fieldMap = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;
    try {
      if (message.type === "PING") {
        sendResponse({ ok: true });
        return;
      }
      if (message.type === "LIST_FORM") {
        sendResponse(listForm(message.focusedSelector || null));
        return;
      }
      if (message.type === "WRITE_FIELD") {
        sendResponse(writeField(message.fieldId, message.value));
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  function listForm() {
    clearMarkers();
    fieldMap = new Map();
    const formEl = pickForm();
    if (!formEl) {
      return { ok: true, fields: [] };
    }
    const fields = collectEmptyFields(formEl);
    const result = [];
    for (let i = 0; i < fields.length; i += 1) {
      const id = "field_" + i;
      const entry = fields[i];
      entry.el.setAttribute("data-jev-id", id);
      fieldMap.set(id, entry.el);
      result.push({
        id,
        wording: entry.wording,
        headingWording: entry.headingWording,
        kind: entry.kind,
        options: entry.options || [],
      });
    }
    return { ok: true, fields: result };
  }

  function pickForm() {
    const forms = Array.from(document.querySelectorAll("form")).filter((form) => !isExtensionUi(form));
    if (!forms.length) {
      const fields = collectEmptyFields(document.body);
      return fields.length ? document.body : null;
    }
    let best = forms[0];
    let bestCount = collectEmptyFields(best).length;
    for (let i = 1; i < forms.length; i += 1) {
      const count = collectEmptyFields(forms[i]).length;
      if (count > bestCount) {
        best = forms[i];
        bestCount = count;
      }
    }
    return best;
  }

  function collectEmptyFields(root) {
    const out = [];
    const nodes = queryAllDeep(root, "input, textarea, select, [contenteditable='true']");
    for (const el of nodes) {
      if (!isField(el)) continue;
      if (!isEmpty(el)) continue;
      const wording = fieldWording(el);
      if (!wording) continue;
      out.push({
        el,
        wording,
        headingWording: headingWording(el),
        kind: fieldKind(el),
        options: [],
      });
    }
    return out;
  }

  function isField(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (isExtensionUi(el)) return false;
    if (el.closest("script, style, noscript, template")) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (!isVisible(el)) return false;
    if (el instanceof HTMLInputElement) {
      const type = (el.type || "text").toLowerCase();
      if (el.autocomplete === "cc-number" || el.autocomplete === "cc-csc") return false;
      if (type === "password" || type === "hidden" || type === "checkbox" || type === "radio") return false;
      if (type === "file" || type === "button" || type === "submit" || type === "reset" || type === "image") return false;
      if (type === "range" || type === "color" || type === "time" || type === "month" || type === "week") return false;
      if (type === "datetime-local") return false;
      if (type === "date") return true;
      return TEXT_TYPES.has(type);
    }
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLSelectElement) return !el.multiple;
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return true;
    return false;
  }

  function isEmpty(el) {
    if (el instanceof HTMLSelectElement) {
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (!opt) return true;
      if (opt.disabled) return true;
      return String(opt.value || "").trim() === "";
    }
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      return String(el.textContent || "").trim() === "";
    }
    return String(el.value || "").trim() === "";
  }

  function fieldKind(el) {
    if (el instanceof HTMLSelectElement) return "select";
    if (el instanceof HTMLTextAreaElement) return "textarea";
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return "contenteditable";
    if (el instanceof HTMLInputElement && (el.type || "").toLowerCase() === "date") return "date";
    return "text";
  }

  function fieldWording(el) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => {
          const node = document.getElementById(id);
          return node ? innerText(node) : "";
        })
        .join(" ")
        .trim();
      if (text) return clip(text, LABEL_MAX);
    }
    const aria = String(el.getAttribute("aria-label") || "").trim();
    if (aria) return clip(aria, LABEL_MAX);
    if (el.id) {
      const forLabel = document.querySelector('label[for="' + cssEscape(el.id) + '"]');
      if (forLabel) {
        const text = innerText(forLabel);
        if (text) return clip(text, LABEL_MAX);
      }
    }
    const wrapping = el.closest("label");
    if (wrapping) {
      const text = innerText(wrapping);
      if (text) return clip(text, LABEL_MAX);
    }
    const placeholder = String(el.getAttribute("placeholder") || "").trim();
    if (placeholder) return clip(placeholder, LABEL_MAX);
    return "";
  }

  function headingWording(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node instanceof HTMLFieldSetElement) {
        const legend = node.querySelector(":scope > legend");
        if (legend) {
          const text = innerText(legend);
          if (text) return clip(text, LABEL_MAX);
        }
      }
      node = node.parentElement;
    }
    const all = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    let best = "";
    let bestRank = 99;
    for (const heading of all) {
      if (!(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const rank = Number(heading.tagName.charAt(1));
      const after = all.find(
        (h) =>
          Number(h.tagName.charAt(1)) <= rank &&
          heading.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING &&
          h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (after) continue;
      if (rank <= bestRank) {
        bestRank = rank;
        best = innerText(heading);
      }
    }
    return clip(best, LABEL_MAX);
  }

  function writeField(fieldId, value) {
    const el = fieldMap.get(fieldId) || document.querySelector('[data-jev-id="' + cssEscape(fieldId) + '"]');
    if (!el) return { ok: false, error: "Field is no longer in the DOM." };
    const text = value == null ? "" : String(value);
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, data: text, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    setNativeValue(el, text);
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: text,
        inputType: "insertText",
      })
    );
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (String(el.value) !== text) {
      setNativeValue(el, "");
      return { ok: false, error: "rejected" };
    }
    return { ok: true };
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

  function isExtensionUi(el) {
    const root = el.getRootNode();
    return Boolean(
      el.closest("[data-jev-fast-ui]") ||
        (root instanceof ShadowRoot && root.host && root.host.id === "jev-fast-launcher-root")
    );
  }

  function isVisible(el) {
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else if (hasHiddenAncestor(el)) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    return true;
  }

  function hasHiddenAncestor(el) {
    let node = el.parentElement;
    while (node) {
      if (node.hidden) return true;
      const style = window.getComputedStyle(node);
      if (style && style.display === "none") return true;
      node = node.parentElement;
    }
    return false;
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
      if (node.shadowRoot) queryAllDeep(node.shadowRoot, selector, out);
    }
    return out;
  }

  function clearMarkers() {
    for (const el of fieldMap.values()) {
      if (el && el.removeAttribute) el.removeAttribute("data-jev-id");
    }
    for (const el of queryAllDeep(document, "[data-jev-id]")) {
      el.removeAttribute("data-jev-id");
    }
    fieldMap = new Map();
  }

  function innerText(el) {
    return String(el.innerText || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clip(text, max) {
    const value = String(text || "");
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + "…";
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }
})();
