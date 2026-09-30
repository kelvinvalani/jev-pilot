/**
 * Jev Fast — floating launcher.
 * Adds a small button to the bottom-right of every page. Clicking it opens
 * the extension UI in an isolated iframe so it never inherits page styles.
 */

(() => {
  const HOST_ID = "jev-fast-launcher-root";
  const OPEN_KEY = "jevFastOverlayOpen";
  const SHOW_KEY = "showLauncher";
  if (window.top !== window || document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.jevFastUi = "true";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }

    :host([hidden]) {
      display: none !important;
    }

    * {
      box-sizing: border-box;
    }

    .layer {
      position: fixed;
      right: 0;
      bottom: 0;
      z-index: 2147483646;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .panel {
      position: fixed;
      right: 24px;
      bottom: 92px;
      width: min(420px, calc(100vw - 32px));
      height: min(680px, calc(100vh - 116px));
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 20px;
      background: #ffffff;
      box-shadow:
        0 24px 64px rgba(15, 23, 42, 0.22),
        0 6px 18px rgba(15, 23, 42, 0.1);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(12px) scale(0.98);
      transform-origin: bottom right;
      transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms;
    }

    .panel iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: #ffffff;
      color-scheme: light;
    }

    .launcher {
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: #4f46e5;
      color: #ffffff;
      box-shadow:
        0 10px 28px rgba(79, 70, 229, 0.35),
        0 3px 8px rgba(15, 23, 42, 0.18);
      cursor: pointer;
      transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    .launcher:hover {
      background: #4338ca;
      transform: translateY(-2px);
    }

    .launcher:active {
      transform: translateY(0);
    }

    .launcher:focus-visible {
      outline: 3px solid rgba(129, 140, 248, 0.6);
      outline-offset: 3px;
    }

    .launcher svg {
      width: 24px;
      height: 24px;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    .launcher .icon-close {
      position: absolute;
      opacity: 0;
      transform: rotate(-45deg);
    }

    .badge {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 14px;
      height: 14px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      background: #22c55e;
      display: none;
    }

    .layer[data-status="running"] .badge {
      display: block;
      animation: pulse 1.4s ease-in-out infinite;
    }

    .layer[data-status="paused"] .badge {
      display: block;
      background: #f59e0b;
    }

    .layer[data-status="error"] .badge {
      display: block;
      background: #ef4444;
    }

    .layer.open .panel {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .layer.open .launcher .icon-logo {
      opacity: 0;
      transform: rotate(45deg);
    }

    .layer.open .launcher .icon-close {
      opacity: 1;
      transform: rotate(0deg);
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    @media (max-width: 520px), (max-height: 600px) {
      .panel {
        right: 8px;
        bottom: 76px;
        width: calc(100vw - 16px);
        height: calc(100vh - 88px);
        border-radius: 16px;
      }

      .launcher {
        right: 16px;
        bottom: 16px;
        width: 50px;
        height: 50px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .panel,
      .launcher,
      .launcher svg {
        transition: none;
      }
      .badge {
        animation: none !important;
      }
    }
  `;

  const layer = document.createElement("div");
  layer.className = "layer";
  layer.dataset.status = "idle";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Jev Fast");

  let frame = null;

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML =
    '<svg class="icon-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z"/></svg>' +
    '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
    '<span class="badge" aria-hidden="true"></span>';

  layer.append(panel, launcher);
  shadow.append(style, layer);
  document.documentElement.appendChild(host);
  updateLauncherLabel(false);

  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.title = "Jev Fast";
    frame.src = chrome.runtime.getURL("popup.html?surface=overlay");
    frame.allow = "clipboard-write";
    panel.appendChild(frame);
    return frame;
  }

  function isOpen() {
    return layer.classList.contains("open");
  }

  function updateLauncherLabel(open) {
    const label = open ? "Close Jev Fast" : "Open Jev Fast";
    launcher.setAttribute("aria-label", label);
    launcher.setAttribute("aria-expanded", String(open));
    launcher.title = label;
  }

  function setOpen(open, options) {
    const opts = options || {};
    if (open) ensureFrame();
    layer.classList.toggle("open", open);
    updateLauncherLabel(open);
    try {
      window.sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      // Storage may be blocked on this origin.
    }
    if (open && opts.focus !== false) {
      window.setTimeout(() => frame && frame.focus(), 170);
    } else if (!open && opts.focus !== false) {
      launcher.focus({ preventScroll: true });
    }
  }

  function setVisible(visible) {
    host.hidden = !visible;
    if (!visible && isOpen()) setOpen(false, { focus: false });
  }

  launcher.addEventListener("click", () => setOpen(!isOpen()));

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isOpen() && !host.hidden) setOpen(false);
    },
    true
  );

  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== "jev-fast") return;
    if (data.type === "CLOSE") setOpen(false);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "JEV_FAST_STATUS" || !message.status) return;
    const status = message.status;
    let next = "idle";
    if (status.running && status.paused) next = "paused";
    else if (status.running) next = "running";
    else if (status.error) next = "error";
    layer.dataset.status = next;
    if (next === "paused" && !isOpen() && !host.hidden) setOpen(true, { focus: false });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[SHOW_KEY]) {
      setVisible(changes[SHOW_KEY].newValue !== false);
    }
  });

  chrome.storage.sync.get([SHOW_KEY], (result) => {
    const visible = !result || result[SHOW_KEY] !== false;
    setVisible(visible);
    let restoreOpen = false;
    try {
      restoreOpen = window.sessionStorage.getItem(OPEN_KEY) === "1";
    } catch {
      restoreOpen = false;
    }
    if (visible && restoreOpen) setOpen(true, { focus: false });
  });
})();
