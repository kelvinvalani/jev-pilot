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

  function listForm(focusedSelector) {
    clearMarkers();
    fieldMap = new Map();
    const fields = pickEmptyFields(focusedSelector);
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

  function pickEmptyFields(focusedSelector) {
    const focused = resolveFocusedField(focusedSelector);
    if (focused) {
      const form = focused.closest("form");
      if (form && !isExtensionUi(form)) {
        return collectEmptyFields(form);
      }
      return visualGroupFor(focused);
    }
    const forms = Array.from(document.querySelectorAll("form")).filter((form) => !isExtensionUi(form));
    if (forms.length) {
      let best = null;
      let bestCount = -1;
      for (const form of forms) {
        const count = collectEmptyFields(form).length;
        // Strict greater-than keeps the first form on a tie (tree order).
        if (count > bestCount) {
          best = form;
          bestCount = count;
        }
      }
      return best ? collectEmptyFields(best) : [];
    }
    return largestVisualGroup();
  }

  function resolveFocusedField(focusedSelector) {
    if (!focusedSelector) return null;
    let el = null;
    try {
      el = document.querySelector(focusedSelector);
    } catch {
      el = null;
    }
    if (!el) {
      const deep = queryAllDeep(document, focusedSelector);
      el = deep[0] || null;
    }
    if (!el || !(el instanceof Element)) return null;
    if (isExtensionUi(el)) return null;
    if (isField(el)) return el;
    const nested = queryAllDeep(el, "input, textarea, select, [contenteditable='true']");
    for (const candidate of nested) {
      if (isField(candidate)) return candidate;
    }
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (isField(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function visualGroupFor(focusedEl) {
    const heading = nearestHeadingEl(focusedEl);
    if (heading) return fieldsUnderHeading(heading);
    const parent = focusedEl.parentElement || document.body;
    return emptyFieldsSharingParent(parent);
  }

  function largestVisualGroup() {
    const all = collectEmptyFields(document.body);
    if (!all.length) return [];
    /** @type {Map<string, { fields: object[], firstIndex: number }>} */
    const groups = new Map();
    for (let i = 0; i < all.length; i += 1) {
      const entry = all[i];
      const key = visualGroupKey(entry.el);
      let group = groups.get(key);
      if (!group) {
        group = { fields: [], firstIndex: i };
        groups.set(key, group);
      }
      group.fields.push(entry);
    }
    let best = null;
    for (const group of groups.values()) {
      if (
        !best ||
        group.fields.length > best.fields.length ||
        (group.fields.length === best.fields.length && group.firstIndex < best.firstIndex)
      ) {
        best = group;
      }
    }
    return best ? best.fields : [];
  }

  function visualGroupKey(el) {
    const heading = nearestHeadingEl(el);
    if (heading) return "h:" + elementPath(heading);
    const parent = el.parentElement || document.body;
    return "p:" + elementPath(parent);
  }

  function emptyFieldsSharingParent(parent) {
    const out = [];
    for (const entry of collectEmptyFields(parent)) {
      if (entry.el.parentElement === parent) out.push(entry);
    }
    return out;
  }

  function fieldsUnderHeading(heading) {
    if (heading instanceof HTMLLegendElement) {
      const fieldset = heading.closest("fieldset");
      if (fieldset) return collectEmptyFields(fieldset);
    }
    const out = [];
    for (const entry of collectEmptyFields(document.body)) {
      if (nearestHeadingEl(entry.el) === heading) out.push(entry);
    }
    return out;
  }

  function nearestHeadingEl(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node instanceof HTMLFieldSetElement) {
        const legend = node.querySelector(":scope > legend");
        if (legend && innerText(legend)) return legend;
      }
      node = node.parentElement;
    }
    const all = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    let best = null;
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
        best = heading;
      }
    }
    return best;
  }

  function elementPath(el) {
    if (!el || el === document.documentElement) return "html";
    if (el.id) return "#" + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(">") || "html";
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
    const heading = nearestHeadingEl(el);
    if (!heading) return "";
    return clip(innerText(heading), LABEL_MAX);
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
