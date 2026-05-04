"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  const OFE_EVENT_MARKER = "\u2063\u2064\u2063";

  fn.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  fn.splitTokens = (text) =>
    String(text || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  fn.matchesAllTokens = (haystack, tokens) => {
    if (!tokens.length) return true;
    const normalized = String(haystack || "").toLowerCase();
    return tokens.every((token) => normalized.includes(token));
  };

  fn.hasCommandModifier = (event) =>
    event.ctrlKey || event.metaKey || event.altKey;

  fn.isTextInput = (el) => {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    if (el.tagName === "INPUT") {
      return !(el.id === "attack-ratio" && el.type === "range");
    }
    return false;
  };

  fn.getChatModal = () => document.querySelector("chat-modal");
  fn.getEmojiTable = () => document.querySelector("emoji-table");

  fn.getHoveredPlayer = () => {
    const overlay = document.querySelector("player-info-overlay");
    if (!overlay) return null;
    const hovered = overlay.player;
    if (!hovered || typeof hovered.id !== "function") return null;
    return hovered;
  };

  fn.getPlayerDisplayName = (player) => {
    if (!player) return "";
    if (typeof player.displayName === "function") {
      try {
        return String(player.displayName() || "");
      } catch (_) {}
    }
    if (typeof player.name === "function") {
      try {
        return String(player.name() || "");
      } catch (_) {}
    }
    return "";
  };

  fn.resolvePlayerSmallID = (playerOrId) => {
    if (playerOrId == null) return null;

    if (typeof playerOrId === "object") {
      if (typeof playerOrId.smallID === "function") {
        try {
          const smallID = Number(playerOrId.smallID());
          if (Number.isFinite(smallID)) return smallID;
        } catch (_) {}
      }
      if (typeof playerOrId.id === "function") {
        try {
          playerOrId = playerOrId.id();
        } catch (_) {
          return null;
        }
      } else {
        return null;
      }
    }

    const numericId = Number(playerOrId);
    if (!Number.isFinite(numericId)) return null;

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (game) {
      if (typeof game.player === "function") {
        try {
          const player = game.player(numericId);
          if (player && typeof player.smallID === "function") {
            const smallID = Number(player.smallID());
            if (Number.isFinite(smallID)) return smallID;
          }
        } catch (_) {}
      }
      if (typeof game.playerBySmallID === "function") {
        try {
          const player = game.playerBySmallID(numericId);
          if (player && typeof player.smallID === "function") {
            const smallID = Number(player.smallID());
            if (Number.isFinite(smallID)) return smallID;
          }
        } catch (_) {}
      }
    }

    return numericId;
  };

  fn.resolveUnitView = (unitOrId) => {
    if (!unitOrId) return null;
    if (typeof unitOrId === "object") {
      return unitOrId;
    }

    const numericId = Number(unitOrId);
    if (!Number.isFinite(numericId)) return null;

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.unit !== "function") return null;

    try {
      return game.unit(numericId) || null;
    } catch (_) {
      return null;
    }
  };

  fn.getCurrentCameraTarget = () => {
    const buildMenu = document.querySelector("build-menu");
    const th = buildMenu && buildMenu.transformHandler;
    if (!th || typeof th.boundingRect !== "function") return null;

    const rect = th.boundingRect();
    if (!rect) return null;

    if (typeof th.screenToWorldCoordinates === "function") {
      try {
        const center = th.screenToWorldCoordinates(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (
          center &&
          Number.isFinite(Number(center.x)) &&
          Number.isFinite(Number(center.y))
        ) {
          return { x: Number(center.x), y: Number(center.y) };
        }
      } catch (_) {}
    }

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (
      game &&
      typeof game.width === "function" &&
      typeof game.height === "function" &&
      Number.isFinite(Number(th.offsetX)) &&
      Number.isFinite(Number(th.offsetY))
    ) {
      return {
        x: Number(th.offsetX) + Number(game.width()) / 2,
        y: Number(th.offsetY) + Number(game.height()) / 2,
      };
    }

    return null;
  };

  fn.focusOfeTarget = (target, options = {}) => {
    if (!target || typeof target !== "object") return false;
    const instant = options.instant === true;

    if (
      Number.isFinite(Number(target.x)) &&
      Number.isFinite(Number(target.y)) &&
      typeof fn.navigateToPosition === "function"
    ) {
      fn.navigateToPosition(Number(target.x), Number(target.y), instant);
      return true;
    }

    const eventsDisplay = document.querySelector("events-display");
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;

    const unitView =
      target.unitView || target.unitID != null
        ? fn.resolveUnitView(target.unitView || target.unitID)
        : null;
    if (instant && unitView && game && typeof fn.navigateToPosition === "function") {
      try {
        const tile =
          typeof unitView.lastTile === "function" ? unitView.lastTile() : null;
        if (
          tile != null &&
          typeof game.x === "function" &&
          typeof game.y === "function"
        ) {
          fn.navigateToPosition(game.x(tile), game.y(tile), true);
          return true;
        }
      } catch (_) {}
    }
    if (unitView && eventsDisplay && typeof eventsDisplay.emitGoToUnitEvent === "function") {
      try {
        eventsDisplay.emitGoToUnitEvent(unitView);
        return true;
      } catch (_) {}
    }

    const focusID =
      target.focusID != null ? fn.resolvePlayerSmallID(target.focusID) : null;
    if (instant && Number.isFinite(focusID) && game && typeof fn.navigateToPosition === "function") {
      try {
        const player =
          typeof game.playerBySmallID === "function" ? game.playerBySmallID(focusID) : null;
        const location =
          player && typeof player.nameLocation === "function" ? player.nameLocation() : null;
        if (
          location &&
          Number.isFinite(location.x) &&
          Number.isFinite(location.y)
        ) {
          fn.navigateToPosition(location.x, location.y, true);
          return true;
        }
      } catch (_) {}
    }
    if (
      Number.isFinite(focusID) &&
      eventsDisplay &&
      typeof eventsDisplay.emitGoToPlayerEvent === "function"
    ) {
      try {
        eventsDisplay.emitGoToPlayerEvent(focusID);
        return true;
      } catch (_) {}
    }

    return false;
  };

  fn.focusLastOfeAlert = () => {
    if (!state.lastOfeAlertTarget) return false;

    const currentTarget = fn.getCurrentCameraTarget ? fn.getCurrentCameraTarget() : null;
    const hasNewAlert =
      Number(state.lastOfeAlertSequence || 0) !== Number(state.lastOfeAlertJumpSequence || 0);

    if (!hasNewAlert && state.lastOfeAlertReturnTarget) {
      const returnTarget = state.lastOfeAlertReturnTarget;
      state.lastOfeAlertReturnTarget = currentTarget;
      return fn.focusOfeTarget(returnTarget, { instant: true });
    }

    state.lastOfeAlertReturnTarget = currentTarget;
    state.lastOfeAlertJumpSequence = Number(state.lastOfeAlertSequence || 0);
    return fn.focusOfeTarget(state.lastOfeAlertTarget, { instant: true });
  };

  fn.pushBottomRightEvent = (event) => {
    const eventsDisplay = document.querySelector("events-display");
    if (!eventsDisplay || !event || !event.description) return;

    const createdAt =
      eventsDisplay.game && typeof eventsDisplay.game.ticks === "function"
        ? eventsDisplay.game.ticks()
        : 0;

    const description = String(event.description || "");
    const resolvedFocusID =
      event.focusID != null ? fn.resolvePlayerSmallID(event.focusID) : null;
    const resolvedUnitView =
      event.unitView || event.unitID != null ? fn.resolveUnitView(event.unitView || event.unitID) : null;
    const shouldUsePlayerFocus =
      !resolvedUnitView || event.preferPlayerFocus === true;
    const payload = {
      description: `${OFE_EVENT_MARKER}${description}`,
      type: event.type != null ? event.type : constants.MESSAGE_TYPE.CHAT,
      highlight: event.highlight !== false,
      createdAt,
      unsafeDescription: Boolean(event.unsafeDescription),
      focusID:
        shouldUsePlayerFocus && Number.isFinite(resolvedFocusID)
          ? resolvedFocusID
          : undefined,
      unitView: resolvedUnitView || undefined,
      duration: event.duration,
      priority: event.priority,
      ofeExtensionEvent: true,
      x: Number.isFinite(Number(event.x)) ? Number(event.x) : undefined,
      y: Number.isFinite(Number(event.y)) ? Number(event.y) : undefined,
    };

    if (resolvedUnitView || Number.isFinite(resolvedFocusID)) {
      let resolvedUnitID = null;
      if (resolvedUnitView && typeof resolvedUnitView.id === "function") {
        try {
          const unitID = Number(resolvedUnitView.id());
          if (Number.isFinite(unitID)) {
            resolvedUnitID = unitID;
          }
        } catch (_) {}
      }
      if (resolvedUnitID == null && event.unitID != null) {
        const numericUnitID = Number(event.unitID);
        if (Number.isFinite(numericUnitID)) {
          resolvedUnitID = numericUnitID;
        }
      }

      state.lastOfeAlertTarget = {
        focusID: Number.isFinite(resolvedFocusID) ? resolvedFocusID : null,
        unitID: resolvedUnitID,
        x: Number.isFinite(Number(event.x)) ? Number(event.x) : null,
        y: Number.isFinite(Number(event.y)) ? Number(event.y) : null,
      };
      state.lastOfeAlertSequence = Number(state.lastOfeAlertSequence || 0) + 1;
    }

    if (typeof eventsDisplay.addEvent === "function") {
      try {
        eventsDisplay.addEvent(payload);
        return;
      } catch (_) {}
    }

    if (Array.isArray(eventsDisplay.events)) {
      try {
        eventsDisplay.events = [...eventsDisplay.events, payload];
        if (typeof eventsDisplay.requestUpdate === "function") {
          eventsDisplay.requestUpdate();
        }
      } catch (_) {}
    }
  };

  fn.pushBottomRightLog = (description, type, options = {}) => {
    if (!description) return;
    fn.pushBottomRightEvent({
      description,
      type: type != null ? type : constants.MESSAGE_TYPE.CHAT,
      unsafeDescription: false,
      focusID: options.focusID,
      unitID: options.unitID,
      unitView: options.unitView,
      preferPlayerFocus: options.preferPlayerFocus,
      duration: options.duration,
    });
  };

  fn.getAnyGameView = () => {
    const eventsDisplay = document.querySelector("events-display");
    if (eventsDisplay && eventsDisplay.game) return eventsDisplay.game;

    const selectors = ["control-panel", "player-panel", "chat-modal", "emoji-table"];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if (el.game) return el.game;
      if (el.g) return el.g;
    }
    return null;
  };

  fn.initPointerTracking = () => {
    if (state.pointerTrackingInitialized) return;
    state.pointerTrackingInitialized = true;

    window.addEventListener(
      "mousemove",
      (e) => {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
      },
      true,
    );

    window.addEventListener(
      "pointermove",
      (e) => {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
      },
      true,
    );
  };

  fn.installOverlayInteractionGuards = (root) => {
    if (!root || root.__ofeOverlayGuardsInstalled) return root;

    const stopPropagation = (event) => {
      event.stopPropagation();
    };

    const guardedEvents = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "touchcancel",
      "click",
      "dblclick",
      "contextmenu",
      "wheel",
    ];

    for (const type of guardedEvents) {
      root.addEventListener(type, stopPropagation);
    }

    root.__ofeOverlayGuardsInstalled = true;
    return root;
  };

  fn.maybeNotifyShortcutBlocked = (code) => {
    const now = Date.now();
    const last = state.lastShortcutWarnAt[code] || 0;
    if (now - last < 1800) return;
    state.lastShortcutWarnAt[code] = now;

    if (!fn.getShortcutConflictSummary) return;
    const summary = fn.getShortcutConflictSummary(code);
    if (!summary) return;

    fn.pushBottomRightLog(
      `Shortcut ${summary.label} blocked: ${summary.conflicts.join(", ")}. Configure in Settings > Keybinds > OpenFront Enhanced.`,
      constants.MESSAGE_TYPE.CHAT,
    );
  };
})();
