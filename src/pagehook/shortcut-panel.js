"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  const COUNTRY_MARKER_SVG_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='none' stroke='#111827' stroke-width='12' opacity='0.75'/>" +
        "<circle cx='50' cy='50' r='31' fill='none' stroke='#ffffff' stroke-width='8'/>" +
        "<circle cx='50' cy='50' r='20' fill='none' stroke='#ef4444' stroke-width='10'/>" +
        "<circle cx='50' cy='50' r='7' fill='#ef4444'/>" +
      "</svg>",
    );
  const SHORT_LABELS = {
    chatSearch: "Chat",
    emojiSearch: "Emoji",
    allianceRequest: "Alliance",
    boatOnePercent: "Boat 1%",
    territoryCycle: "Cycle Mini",
    lastOfeAlert: "Last Alert",
  };

  function keyCodeLabel(code) {
    if (!code) return "unbound";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  function readPanelVisibleSetting() {
    try {
      const raw = localStorage.getItem(constants.SHORTCUT_PANEL_VISIBLE_KEY);
      if (raw === null) return true;
      return raw === "1";
    } catch (_) {
      return true;
    }
  }

  function writePanelVisibleSetting(visible) {
    try {
      localStorage.setItem(constants.SHORTCUT_PANEL_VISIBLE_KEY, visible ? "1" : "0");
    } catch (_) {}
  }

  function setShortcutPanelVisible(visible) {
    if (!state.shortcutPanelState) return;
    state.shortcutPanelState.visible = visible;
    state.shortcutPanelState.panel.style.display = visible ? "" : "none";
    state.shortcutPanelState.notice.style.display = "none";
    state.shortcutPanelState.toggle.style.display = visible ? "none" : "";
    hideInfoTooltip();
    updatePanelPlacement();
    writePanelVisibleSetting(visible);
  }

  function updatePanelPlacement() {
    if (!state.shortcutPanelState) return;
    const { panel, toggle, notice } = state.shortcutPanelState;

    panel.style.left = "12px";
    panel.style.top = "50%";
    panel.style.transform = "translateY(-50%)";

    toggle.style.left = "12px";
    toggle.style.top = "50%";
    toggle.style.transform = "translateY(-50%)";

    if (notice) {
      const panelRect = panel.getBoundingClientRect();
      notice.style.left = `${Math.round(panelRect.left)}px`;
      notice.style.top = `${Math.round(panelRect.bottom + 8)}px`;
    }
  }

  function showInfoTooltip(anchor, text) {
    if (!state.shortcutPanelState || !state.shortcutPanelState.tooltip) return;
    const tooltip = state.shortcutPanelState.tooltip;
    tooltip.textContent = text || "";
    tooltip.style.display = "block";

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 8;

    let left = anchorRect.right + 6;
    if (left + tooltipRect.width > window.innerWidth - margin) {
      left = anchorRect.left - tooltipRect.width - 6;
    }
    if (left < margin) left = margin;

    let top = anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2;
    if (top < margin) top = margin;
    if (top + tooltipRect.height > window.innerHeight - margin) {
      top = window.innerHeight - margin - tooltipRect.height;
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function hideInfoTooltip() {
    if (!state.shortcutPanelState || !state.shortcutPanelState.tooltip) return;
    state.shortcutPanelState.tooltip.style.display = "none";
  }

  function renderShortcutPanel() {
    if (!state.shortcutPanelState || !fn.getShortcutDiagnostics) return;

    const diagnostics = fn.getShortcutDiagnostics();
    const statusEl = state.shortcutPanelState.status;
    statusEl.textContent = "";
    hideInfoTooltip();

    state.shortcutPanelState.panel.style.width = "min(126px,26vw)";
    state.shortcutPanelState.panel.style.padding = "3px 4px";
    state.shortcutPanelState.warning.style.display = "none";
    const showSpawnNotice = state.gamePhase === "spawn" && state.shortcutPanelState.visible;
    state.shortcutPanelState.notice.style.display = showSpawnNotice ? "flex" : "none";
    if (showSpawnNotice) {
      state.shortcutPanelState.notice.textContent = "";
      const noticeIcon = document.createElement("span");
      noticeIcon.style.cssText =
        "display:inline-block;width:14px;height:14px;flex:0 0 14px;" +
        "background-repeat:no-repeat;background-size:contain;" +
        `background-image:url(\"${COUNTRY_MARKER_SVG_URI}\");`;

      const text = document.createElement("span");
      text.textContent = "markers = countries";
      text.style.cssText = "font-size:8px;font-weight:600;color:#dbeafe;";

      state.shortcutPanelState.notice.appendChild(noticeIcon);
      state.shortcutPanelState.notice.appendChild(text);
    }

    for (const meta of Object.values(constants.EXT_SHORTCUTS)) {
      const diag = diagnostics.byAction[meta.action];
      if (!diag) continue;

      const wrap = document.createElement("div");
      wrap.style.cssText =
        "display:flex;flex-direction:column;gap:0;" +
        "padding:3px 4px;margin-bottom:3px;border-radius:7px;" +
        "background:rgba(15,23,42,0.7);border:1px solid rgba(148,163,184,0.2);";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:4px;";

      const left = document.createElement("div");
      left.style.cssText = "display:flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto;";

      const key = document.createElement("span");
      key.textContent = keyCodeLabel(diag.code);
      key.style.cssText =
        "font-size:7px;line-height:1;border-radius:4px;padding:2px 3px;flex:0 0 auto;" +
        "border:1px solid rgba(148,163,184,0.45);background:rgba(15,23,42,0.95);color:#e2e8f0;";

      const name = document.createElement("span");
      name.textContent = SHORT_LABELS[meta.action] || meta.label;
      name.style.cssText =
        "font-size:8px;font-weight:600;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

      const dot = document.createElement("span");
      dot.textContent = "●";
      dot.style.color = diag.ready ? "#86efac" : "#fca5a5";
      dot.style.fontSize = "7px";

      left.appendChild(dot);
      left.appendChild(key);
      left.appendChild(name);

      const right = document.createElement("div");
      right.style.cssText = "display:flex;align-items:center;gap:2px;flex:0 0 auto;";

      const blocked = document.createElement("span");
      blocked.textContent = diag.ready ? "" : "!";
      blocked.style.cssText = `font-size:9px;font-weight:700;color:${diag.ready ? "#86efac" : "#fca5a5"};`;

      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.textContent = "i";
      infoBtn.style.cssText =
        "width:12px;height:12px;border-radius:999px;padding:0;line-height:1;" +
        "border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.9);" +
        "color:#cbd5e1;font-size:7px;font-weight:700;cursor:help;";
      infoBtn.setAttribute("aria-label", `Info: ${meta.label}`);
      infoBtn.addEventListener("mouseenter", () => showInfoTooltip(infoBtn, meta.desc));
      infoBtn.addEventListener("mouseleave", hideInfoTooltip);
      infoBtn.addEventListener("focus", () => showInfoTooltip(infoBtn, meta.desc));
      infoBtn.addEventListener("blur", hideInfoTooltip);

      right.appendChild(blocked);
      right.appendChild(infoBtn);

      row.appendChild(left);
      row.appendChild(right);
      wrap.appendChild(row);

      statusEl.appendChild(wrap);
    }

    updatePanelPlacement();
  }

  fn.initShortcutPanel = () => {
    if (state.shortcutPanelState) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "ofe-shortcuts-toggle";
    toggle.textContent = "Shortcuts";
    toggle.title = "Show shortcuts";
    toggle.setAttribute("aria-label", "Show shortcuts");
    toggle.style.cssText =
      "position:fixed;left:12px;top:50%;z-index:10030;transform:translateY(-50%);" +
      "height:26px;padding:0 10px;border-radius:8px;border:1px solid rgba(148,163,184,0.22);" +
      "background:rgba(9,14,24,0.94);color:#e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.34);" +
      "backdrop-filter:blur(3px);font-size:11px;font-weight:700;" +
      "display:flex;align-items:center;justify-content:center;" +
      "cursor:pointer;display:none;";

    const panel = document.createElement("div");
    panel.id = "ofe-shortcuts-panel";
    panel.style.cssText =
      "position:fixed;left:12px;top:50%;z-index:10029;transform:translateY(-50%);width:min(126px,26vw);" +
      "background:linear-gradient(180deg,rgba(11,18,32,0.96),rgba(10,15,28,0.94));" +
      "border:1px solid rgba(148,163,184,0.3);color:#e2e8f0;border-radius:12px;" +
      "padding:3px 4px;box-shadow:0 10px 22px rgba(0,0,0,0.38);font-size:7px;line-height:1.25;" +
      "backdrop-filter:blur(3px);";

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px;";

    const title = document.createElement("div");
    title.textContent = "Shortcuts";
    title.style.cssText = "font-weight:700;color:#fff;font-size:9px;";

    const hide = document.createElement("button");
    hide.type = "button";
    hide.textContent = "Hide";
    hide.style.cssText =
      "height:18px;padding:0 6px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);" +
      "background:rgba(15,23,42,0.65);color:#cbd5e1;font-size:9px;font-weight:600;cursor:pointer;";
    hide.addEventListener("click", () => setShortcutPanelVisible(false));

    const status = document.createElement("div");
    status.style.cssText = "display:flex;flex-direction:column;gap:0;";

    const notice = document.createElement("div");
    notice.style.cssText =
      "display:none;position:fixed;left:12px;top:50%;z-index:10029;pointer-events:none;" +
      "display:flex;align-items:center;gap:7px;" +
      "width:min(188px,42vw);padding:6px 9px;border-radius:11px;" +
      "background:linear-gradient(180deg,rgba(9,14,28,0.96),rgba(8,18,40,0.9));" +
      "border:1px solid rgba(147,197,253,0.26);" +
      "font-size:8px;font-weight:600;color:#dbeafe;line-height:1.3;" +
      "box-shadow:0 10px 24px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.06);" +
      "backdrop-filter:blur(3px);";

    const warning = document.createElement("div");
    warning.style.cssText = "display:none;";

    const tooltip = document.createElement("div");
    tooltip.id = "ofe-shortcut-tooltip";
    tooltip.style.cssText =
      "display:none;position:fixed;left:0;top:0;z-index:10032;pointer-events:none;" +
      "max-width:220px;padding:5px 6px;border-radius:6px;" +
      "background:rgba(2,6,23,0.96);border:1px solid rgba(148,163,184,0.35);" +
      "color:#e2e8f0;font-size:10px;line-height:1.25;box-shadow:0 6px 20px rgba(0,0,0,0.35);";

    header.appendChild(title);
    header.appendChild(hide);
    panel.appendChild(header);
    panel.appendChild(status);
    panel.appendChild(warning);

    document.body.appendChild(panel);
    document.body.appendChild(toggle);
    document.body.appendChild(notice);
    document.body.appendChild(tooltip);

    state.shortcutPanelState = {
      toggle,
      panel,
      header,
      title,
      hide,
      notice,
      status,
      warning,
      tooltip,
      visible: true,
    };

    toggle.addEventListener("click", () => {
      if (!state.shortcutPanelState) return;
      setShortcutPanelVisible(!state.shortcutPanelState.visible);
    });

    setShortcutPanelVisible(readPanelVisibleSetting());
    renderShortcutPanel();

    state.shortcutPanelWatch = setInterval(renderShortcutPanel, 1000);
  };
})();
