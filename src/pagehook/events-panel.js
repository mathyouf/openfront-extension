"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const FILTER_KEY = "ofe.events.panel.hidden";
  const BUTTON_ID = "ofe-events-filter-toggle";
  const MARKER = "\u2063\u2064\u2063";
  const CATEGORY = {
    ATTACK: "ATTACK",
    NUKE: "NUKE",
    ALLIANCE: "ALLIANCE",
    CHAT: "CHAT",
  };

  function readHiddenSetting() {
    try {
      return localStorage.getItem(FILTER_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function writeHiddenSetting(hidden) {
    try {
      localStorage.setItem(FILTER_KEY, hidden ? "1" : "0");
    } catch (_) {}
  }

  function ensureState() {
    if (!state.eventsPanelState) {
      state.eventsPanelState = {
        hidden: readHiddenSetting(),
      };
    }
    return state.eventsPanelState;
  }

  function isOfeRow(row) {
    return String(row && row.textContent ? row.textContent : "").includes(MARKER);
  }

  function getMessageCategory(type) {
    if (
      type === ns.constants.MESSAGE_TYPE.NAVAL_INVASION_INBOUND ||
      type === ns.constants.MESSAGE_TYPE.UNIT_DESTROYED
    ) {
      return CATEGORY.ATTACK;
    }
    if (
      type === ns.constants.MESSAGE_TYPE.MIRV_INBOUND ||
      type === ns.constants.MESSAGE_TYPE.NUKE_INBOUND ||
      type === ns.constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND
    ) {
      return CATEGORY.NUKE;
    }
    if (type === ns.constants.MESSAGE_TYPE.ALLIANCE_REQUEST) {
      return CATEGORY.ALLIANCE;
    }
    return CATEGORY.CHAT;
  }

  function getVisibleOfeEvents(eventsDisplay) {
    const events = Array.isArray(eventsDisplay.events) ? eventsDisplay.events : [];
    const filters = eventsDisplay.eventsFilters instanceof Map
      ? eventsDisplay.eventsFilters
      : null;

    return events
      .filter((event) => event && event.ofeExtensionEvent)
      .filter((event) => {
        const category = getMessageCategory(event.type);
        return !(filters && filters.get(category));
      })
      .sort((a, b) => {
        const aPrior = a.priority ?? 100000;
        const bPrior = b.priority ?? 100000;
        if (aPrior === bPrior) {
          return a.createdAt - b.createdAt;
        }
        return bPrior - aPrior;
      });
  }

  function bindOfeRowInteraction(row, event) {
    if (row.__ofeClickHandler) {
      row.removeEventListener("click", row.__ofeClickHandler, true);
      row.__ofeClickHandler = null;
    }

    const hasExactLocation =
      event &&
      Number.isFinite(Number(event.x)) &&
      Number.isFinite(Number(event.y));

    if (!hasExactLocation) {
      row.style.cursor = "";
      row.title = "";
      return;
    }

    const handler = (domEvent) => {
      if (fn.focusOfeTarget?.({ x: event.x, y: event.y }, { instant: true })) {
        domEvent.preventDefault();
        domEvent.stopImmediatePropagation();
      }
    };

    row.__ofeClickHandler = handler;
    row.addEventListener("click", handler, true);
    row.style.cursor = "pointer";
    row.title = "Jump to event location";
  }

  function updateButtonAppearance(button, hidden) {
    button.style.opacity = hidden ? "0.45" : "1";
    button.style.filter = hidden ? "grayscale(1)" : "none";
    button.title = hidden ? "Show OFE messages" : "Hide OFE messages";
    button.setAttribute("aria-label", button.title);
  }

  function ensureButton(eventsDisplay) {
    const controlsRow = Array.from(eventsDisplay.querySelectorAll("div.flex.gap-4")).find(
      (el) => el.querySelector("img"),
    );
    if (!controlsRow) return null;

    let button = eventsDisplay.querySelector(`#${BUTTON_ID}`);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = BUTTON_ID;
      button.textContent = "OFE";
      button.style.cssText =
        "display:inline-flex;align-items:center;justify-content:center;height:20px;min-width:30px;" +
        "padding:0 6px;border:1px solid rgba(148,163,184,0.28);border-radius:6px;" +
        "background:rgba(15,23,42,0.72);color:#e2e8f0;font-size:10px;font-weight:700;" +
        "cursor:pointer;line-height:1;";
      button.addEventListener("click", () => {
        const panelState = ensureState();
        panelState.hidden = !panelState.hidden;
        writeHiddenSetting(panelState.hidden);
        syncEventsPanel();
      });
      controlsRow.appendChild(button);
    }

    updateButtonAppearance(button, ensureState().hidden);
    return button;
  }

  function syncEventsPanel() {
    const eventsDisplay = document.querySelector("events-display");
    if (!eventsDisplay) return;

    const panelState = ensureState();
    ensureButton(eventsDisplay);

    const rows = eventsDisplay.querySelectorAll(".events-container tbody tr");
    const ofeEvents = getVisibleOfeEvents(eventsDisplay);
    let ofeIndex = 0;

    for (const row of rows) {
      if (!isOfeRow(row)) continue;
      const event = ofeEvents[ofeIndex++] || null;
      row.style.display = panelState.hidden ? "none" : "";
      bindOfeRowInteraction(row, event);
    }
  }

  fn.initEventsPanelIntegration = () => {
    if (state.eventsPanelWatch) return;
    ensureState();
    state.eventsPanelWatch = window.setInterval(syncEventsPanel, 250);
  };
})();
