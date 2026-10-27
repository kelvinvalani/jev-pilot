/**
 * Jev Fill — page script.
 * Resolves one form's empty fields and writes answers with native setters.
 * Option labels stay on this machine for the service worker; they are not
 * forwarded to Jev.
 */

(() => {
  if (window.__jevFillContentLoaded) {
    return;
  }
  window.__jevFillContentLoaded = true;

  const TEXT_TYPES = new Set(["text", "email", "tel", "url", "search", "number"]);
  const LABEL_MAX = 96;
  const BAN_WORDINGS = new Set(
    [
      "card number",
      "credit card number",
      "debit card number",
      "card security code",
      "security code",
      "cvc",
      "cvv",
      "cvc2",
      "cid",
    ].map(compareKey)
  );

  /** @type {Map<string, { kind: string, el?: Element, radios?: HTMLInputElement[] }>} */
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
      if (entry.kind === "radio") {
        for (const radio of entry.radios) {
          radio.setAttribute("data-jev-id", id);
        }
        fieldMap.set(id, { kind: "radio", radios: entry.radios });
      } else {
        entry.el.setAttribute("data-jev-id", id);
        fieldMap.set(id, { kind: entry.kind, el: entry.el });
      }
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
    const seenRadios = new Set();
    const nodes = queryAllDeep(root, "input, textarea, select, [contenteditable='true']");
    for (const el of nodes) {
      if (el instanceof HTMLInputElement && (el.type || "").toLowerCase() === "radio") {
        if (seenRadios.has(el)) continue;
        const group = radioGroup(el, root);
        for (const radio of group) seenRadios.add(radio);
        if (!group.length || !group.every((r) => isRadioEligible(r))) continue;
        if (!isRadioGroupEmpty(group)) continue;
        const wording = radioGroupWording(group);
        if (!wording || isBannedWording(wording)) continue;
        out.push({
          kind: "radio",
          radios: group,
          wording,
          headingWording: headingWording(group[0]),
          options: group.map(radioOptionLabel).filter(Boolean),
        });
        continue;
      }
      if (!isField(el)) continue;
      if (!isEmpty(el)) continue;
      const wording = fieldWording(el);
      if (!wording || isBannedWording(wording)) continue;
      const kind = fieldKind(el);
      out.push({
        el,
        wording,
        headingWording: headingWording(el),
        kind,
        options: kind === "select" ? selectOptionLabels(el) : [],
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

  function isRadioEligible(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (isExtensionUi(el)) return false;
    if (el.closest("script, style, noscript, template")) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return isVisible(el);
  }

  function radioGroup(el, root) {
    const name = String(el.name || "");
    if (name) {
      return queryAllDeep(root, 'input[type="radio"]').filter(
        (r) => r instanceof HTMLInputElement && r.name === name && isInside(root, r)
      );
    }
    const fieldset = el.closest("fieldset");
    if (!fieldset) return [el];
    return Array.from(fieldset.querySelectorAll('input[type="radio"]')).filter(
      (r) => r instanceof HTMLInputElement && !r.name
    );
  }

  function isInside(root, el) {
    if (root.contains && root.contains(el)) return true;
    let node = el;
    while (node) {
      if (node === root) return true;
      const parent = node.parentNode;
      if (parent) {
        node = parent;
        continue;
      }
      const host = node.host;
      if (host) {
        node = host;
        continue;
      }
      break;
    }
    return false;
  }

  function isRadioGroupEmpty(group) {
    return !group.some((r) => r.checked);
  }

  function radioGroupWording(group) {
    const first = group[0];
    const fieldset = first.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector(":scope > legend");
      if (legend) {
        const text = innerText(legend);
        if (text) return clip(text, LABEL_MAX);
      }
    }
    for (const radio of group) {
      const wording = fieldWording(radio);
      if (wording) return wording;
    }
    return "";
  }

  function radioOptionLabel(radio) {
    if (radio.id) {
      const forLabel = document.querySelector('label[for="' + cssEscape(radio.id) + '"]');
      if (forLabel) {
        const text = innerText(forLabel);
        if (text) return text;
      }
    }
    const wrapping = radio.closest("label");
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      for (const input of clone.querySelectorAll("input")) input.remove();
      const text = String(clone.innerText || clone.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text) return text;
    }
    const aria = String(radio.getAttribute("aria-label") || "").trim();
    if (aria) return aria;
    return String(radio.value || "").trim();
  }

  function selectOptionLabels(select) {
    return Array.from(select.options)
      .map((opt) => innerText(opt) || String(opt.label || "").trim())
      .filter(Boolean);
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

  function isBannedWording(wording) {
    return BAN_WORDINGS.has(compareKey(wording));
  }

  function compareKey(text) {
    return String(text || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
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
    const entry = fieldMap.get(fieldId);
    const text = value == null ? "" : String(value);
    if (!entry) {
      const el = document.querySelector('[data-jev-id="' + cssEscape(fieldId) + '"]');
      if (!el) return { ok: false, error: "Field is no longer in the DOM." };
      return writeElement(el, text);
    }
    if (entry.kind === "radio") {
      return writeRadio(entry.radios || [], text);
    }
    if (!entry.el) return { ok: false, error: "Field is no longer in the DOM." };
    return writeElement(entry.el, text);
  }

  function writeElement(el, text) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    if (el instanceof HTMLSelectElement) {
      return writeSelect(el, text);
    }
    if (el instanceof HTMLInputElement && (el.type || "").toLowerCase() === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { ok: false, error: "rejected" };
      }
    }
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, data: text, inputType: "insertText" }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }
    setNativeValue(el, text);
    fireInputChange(el, text);
    if (String(el.value) !== text) {
      setNativeValue(el, "");
      fireInputChange(el, "");
      return { ok: false, error: "rejected" };
    }
    return { ok: true };
  }

  function writeSelect(el, label) {
    const targetKey = compareKey(label);
    let matched = null;
    for (const opt of Array.from(el.options)) {
      const optLabel = innerText(opt) || String(opt.label || "").trim();
      if (compareKey(optLabel) === targetKey) {
        matched = opt;
        break;
      }
    }
    if (!matched || matched.disabled) {
      return { ok: false, error: "unmatched" };
    }
    const previous = el.value;
    el.value = matched.value;
    matched.selected = true;
    fireInputChange(el, matched.value);
    const selected = el.selectedOptions && el.selectedOptions[0];
    if (!selected || selected !== matched) {
      el.value = previous;
      fireInputChange(el, previous);
      return { ok: false, error: "rejected" };
    }
    return { ok: true, selectedLabel: innerText(matched) || String(matched.label || "").trim() };
  }

  function writeRadio(radios, label) {
    const targetKey = compareKey(label);
    let matched = null;
    for (const radio of radios) {
      if (compareKey(radioOptionLabel(radio)) === targetKey) {
        matched = radio;
        break;
      }
    }
    if (!matched || matched.disabled) {
      return { ok: false, error: "unmatched" };
    }
    for (const radio of radios) {
      radio.checked = radio === matched;
    }
    try {
      matched.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    matched.dispatchEvent(new Event("input", { bubbles: true }));
    matched.dispatchEvent(new Event("change", { bubbles: true }));
    if (!matched.checked) {
      for (const radio of radios) radio.checked = false;
      return { ok: false, error: "rejected" };
    }
    return { ok: true, selectedLabel: radioOptionLabel(matched) };
  }

  function fireInputChange(el, text) {
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
  }

  function setNativeValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? window.HTMLSelectElement.prototype
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
    for (const entry of fieldMap.values()) {
      if (entry.kind === "radio" && entry.radios) {
        for (const radio of entry.radios) {
          if (radio && radio.removeAttribute) radio.removeAttribute("data-jev-id");
        }
      } else if (entry.el && entry.el.removeAttribute) {
        entry.el.removeAttribute("data-jev-id");
      }
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
