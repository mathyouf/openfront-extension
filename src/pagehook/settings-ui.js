"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  const ROOT_ID = "ofe-extension-settings-root";
  const TAB_BUTTON_ID = "ofe-extension-settings-tab";
  const MOBILE_TAB_ROW_ID = "ofe-extension-settings-mobile-tabs";
  const SECTION_TITLE = "OpenFront Enhanced";
  const DEFAULT_HOST_ATTR = "data-ofe-default-settings-host";
  const PREVIEW_ICON_SVG =
    "<svg viewBox='0 0 24 24' width='14' height='14' aria-hidden='true'>" +
    "<path d='M8 6V18L18 12Z' fill='currentColor'/>" +
    "</svg>";
  const HOST_TAB_INACTIVE_CLASS =
    "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 border border-transparent";
  const TAB_ACTIVE_CLASS =
    "bg-malibu-blue/20 text-aquarius border border-malibu-blue/30 shadow-[var(--shadow-malibu-blue)]";
  const TAB_INACTIVE_CLASS =
    "text-white/40 hover:text-white hover:bg-white/5 border border-transparent";

  function formatCodeForDisplay(code) {
    if (!code || code === "Null") return "";
    if (code.startsWith("Shift+")) {
      return `Shift+${formatCodeForDisplay(code.slice(6))}`;
    }
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  function findCurrentSettingsContainer(modal) {
    const existing = modal.querySelector(`[${DEFAULT_HOST_ATTR}="1"]`);
    if (existing) return existing;

    const anchor = Array.from(
      modal.querySelectorAll(
        "setting-keybind, setting-toggle, setting-slider, setting-select",
      ),
    ).find((el) => !el.closest(`#${ROOT_ID}`));
    if (!anchor || !anchor.parentElement) return null;
    anchor.parentElement.setAttribute(DEFAULT_HOST_ATTR, "1");
    return anchor.parentElement;
  }

  function findTabRow(header) {
    if (!header) return null;
    return Array.from(header.querySelectorAll("div")).find(
      (el) => el.querySelectorAll(":scope > button").length >= 2,
    ) || null;
  }

  function findModalContext() {
    const modal = document.querySelector("user-setting");
    if (!modal || !modal.isModalOpen) return null;
    const defaultContent = findCurrentSettingsContainer(modal);
    if (!defaultContent || !defaultContent.parentElement) return null;

    return {
      modal,
      scroll: defaultContent.parentElement,
      defaultContent,
      header: defaultContent.parentElement.previousElementSibling,
      tabRow: findTabRow(defaultContent.parentElement.previousElementSibling),
    };
  }

  function extensionBindingEntry(action) {
    const raw = fn.getExtensionBindingsRaw ? fn.getExtensionBindingsRaw() : {};
    return raw[action] || null;
  }

  function getCurrentCode(action) {
    const bindings = fn.getEffectiveExtensionBindings
      ? fn.getEffectiveExtensionBindings()
      : {};
    return bindings[action] || constants.EXT_SHORTCUTS[action].defaultCode;
  }

  function soundSettingEnabled(key) {
    return fn.extensionSoundEnabled ? fn.extensionSoundEnabled(key) : true;
  }

  function showErrorMessage(text) {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: text,
          color: "red",
          duration: 2500,
        },
      }),
    );
  }

  function validateExtensionBinding(action, code) {
    const value = fn.normalizeKeybindValue ? fn.normalizeKeybindValue(code) : code;
    if (!value || value === "Null") return [];

    const gameBindings = fn.getEffectiveGameKeybinds
      ? fn.getEffectiveGameKeybinds()
      : {};
    const extBindings = fn.getEffectiveExtensionBindings
      ? fn.getEffectiveExtensionBindings()
      : {};

    const conflicts = [];

    for (const [gameAction, gameCode] of Object.entries(gameBindings)) {
      const normalizedGameCode = fn.normalizeKeybindValue
        ? fn.normalizeKeybindValue(gameCode)
        : gameCode;
      if (normalizedGameCode === value) {
        conflicts.push(`game:${gameAction}`);
      }
    }

    for (const [otherAction, otherCode] of Object.entries(extBindings)) {
      if (otherAction === action) continue;
      const normalizedOtherCode = fn.normalizeKeybindValue
        ? fn.normalizeKeybindValue(otherCode)
        : otherCode;
      if (normalizedOtherCode === value) {
        const label = constants.EXT_SHORTCUTS[otherAction]
          ? constants.EXT_SHORTCUTS[otherAction].label
          : otherAction;
        conflicts.push(`extension:${label}`);
      }
    }

    return conflicts;
  }

  function syncSettingElementValue(el, action) {
    const entry = extensionBindingEntry(action);
    const rawCode = getCurrentCode(action);
    const code = fn.normalizeKeybindValue ? fn.normalizeKeybindValue(rawCode) : rawCode;
    el.value = code === "Null" ? "" : code;
    el.display = entry && entry.key ? entry.key : formatCodeForDisplay(code);
    el.requestUpdate();
  }

  function onKeybindChange(event) {
    const detail = event.detail || {};
    const fullAction = detail.action;
    if (!fullAction || typeof fullAction !== "string") return;
    if (!fullAction.startsWith("ofe.")) return;

    const action = fullAction.slice(4);
    const meta = constants.EXT_SHORTCUTS[action];
    if (!meta) return;

    const value = detail.value;
    const key = typeof detail.key === "string" ? detail.key : "";

    const conflicts = validateExtensionBinding(action, value);
    if (conflicts.length > 0 && value !== "Null") {
      showErrorMessage(
        `OFE keybind conflict for ${meta.label}: ${conflicts.join(", ")}`,
      );

      const root = document.getElementById(ROOT_ID);
      if (root) {
        const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
        if (el) syncSettingElementValue(el, action);
      }
      return;
    }

    if (fn.saveExtensionBinding) {
      fn.saveExtensionBinding(action, value, key);
    }

    const root = document.getElementById(ROOT_ID);
    if (root) {
      const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
      if (el) syncSettingElementValue(el, action);
    }
  }

  function syncToggleValue(el, key) {
    if (!el) return;
    el.checked = soundSettingEnabled(key);
  }

  function onSoundToggleChange(event) {
    const enabled = event?.currentTarget?.checked;
    const key = event?.currentTarget?.dataset?.ofeSetting;
    if (typeof enabled !== "boolean") return;
    if (!key) return;
    if (fn.saveExtensionSetting) {
      fn.saveExtensionSetting(key, enabled);
    }
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const toggle = root.querySelector(`[data-ofe-setting="${key}"]`);
    if (toggle) syncToggleValue(toggle, key);
  }

  function onSoundPreviewClick(event) {
    const key = event?.currentTarget?.dataset?.ofeSoundPreview;
    if (!key || !fn.previewExtensionSound) return;
    fn.previewExtensionSound(key);
  }

  function buildSoundSettingRow(key, meta) {
    const row = document.createElement("div");
    row.className =
      "flex flex-col sm:flex-row sm:items-center sm:justify-between w-full p-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all gap-3 sm:gap-4";

    const copy = document.createElement("div");
    copy.className = "flex flex-col flex-1 min-w-0";

    const label = document.createElement("div");
    label.className = "text-white font-bold text-base block mb-1";
    label.textContent = meta.label;

    const description = document.createElement("div");
    description.className = "text-white/50 text-sm leading-snug";
    description.textContent = meta.desc;

    copy.appendChild(label);
    copy.appendChild(description);

    const controls = document.createElement("div");
    controls.className = "flex items-center justify-end gap-3 shrink-0";

    const preview = document.createElement("button");
    preview.type = "button";
    preview.dataset.ofeSoundPreview = key;
    preview.innerHTML = PREVIEW_ICON_SVG;
    preview.title = `Preview ${meta.label}`;
    preview.setAttribute("aria-label", `Preview ${meta.label}`);
    preview.className =
      "inline-flex h-9 w-9 items-center justify-center text-aquarius transition-all duration-200 rounded-lg bg-malibu-blue/15 hover:bg-malibu-blue/25 border border-malibu-blue/30";
    preview.addEventListener("click", onSoundPreviewClick);

    const toggleWrap = document.createElement("label");
    toggleWrap.className = "relative inline-block w-[52px] h-[28px] shrink-0 cursor-pointer";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.id = `ofe-sound-${key}`;
    toggle.dataset.ofeSetting = key;
    toggle.className = "opacity-0 w-0 h-0 peer";
    syncToggleValue(toggle, key);
    toggle.addEventListener("change", onSoundToggleChange);

    const slider = document.createElement("span");
    slider.className =
      "absolute inset-0 bg-black/60 border border-white/10 transition-all duration-300 rounded-full before:absolute before:content-[''] before:h-5 before:w-5 before:left-[3px] before:top-[3px] before:bg-white/40 before:transition-all before:duration-300 before:rounded-full before:shadow-sm hover:before:bg-white/60 peer-checked:bg-malibu-blue peer-checked:border-malibu-blue peer-checked:before:translate-x-[24px] peer-checked:before:bg-white";

    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(slider);

    controls.appendChild(preview);
    controls.appendChild(toggleWrap);
    row.appendChild(copy);
    row.appendChild(controls);

    return row;
  }

  function buildExtensionKeybindRows(root) {
    const keybindHeading = document.createElement("h2");
    keybindHeading.textContent = "Extension Keybinds";
    keybindHeading.className =
      "text-aquarius text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2";
    root.appendChild(keybindHeading);

    for (const [action, meta] of Object.entries(constants.EXT_SHORTCUTS)) {
      const row = document.createElement("setting-keybind");
      row.action = `ofe.${action}`;
      row.label = `OFE: ${meta.label}`;
      row.description = meta.desc;
      row.defaultKey = meta.defaultCode;

      syncSettingElementValue(row, action);

      row.addEventListener("change", onKeybindChange);
      root.appendChild(row);
    }
  }

  function buildExtensionTabContent(root) {
    const heading = document.createElement("h2");
    heading.textContent = SECTION_TITLE;
    heading.className =
      "text-aquarius text-xl font-bold mt-4 mb-3 border-b border-white/10 pb-2";

    const soundHeading = document.createElement("h2");
    soundHeading.textContent = "Extension Sounds";
    soundHeading.className =
      "text-aquarius text-xl font-bold mt-2 mb-3 border-b border-white/10 pb-2";

    root.appendChild(heading);
    root.appendChild(soundHeading);

    for (const [key, meta] of Object.entries(constants.EXT_SOUND_SETTINGS)) {
      root.appendChild(buildSoundSettingRow(key, meta));
    }

    buildExtensionKeybindRows(root);
  }

  function ensureExtensionRoot(scroll) {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.className = "flex flex-col gap-2";
      buildExtensionTabContent(root);
      fn.installOverlayInteractionGuards?.(root);
      scroll.appendChild(root);
    }
    return root;
  }

  function updateTabButtonState(button, active) {
    if (!button) return;
    button.className = [
      "px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest",
      active ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS,
    ].join(" ");
  }

  function updateMobileTabButtonState(button, active) {
    if (!button) return;
    button.className = [
      "flex-1 px-4 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest",
      active ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS,
    ].join(" ");
  }

  function syncHostTabButtonState(ctx) {
    if (!ctx?.tabRow) return;

    const active = Boolean(state.extensionSettingsTabActive);
    for (const button of ctx.tabRow.querySelectorAll(":scope > button")) {
      if (button.id === TAB_BUTTON_ID) continue;

      if (active) {
        if (button.dataset.ofeOriginalClass == null) {
          button.dataset.ofeOriginalClass = button.className || "";
        }
        button.className = HOST_TAB_INACTIVE_CLASS;
        continue;
      }

      if (button.dataset.ofeOriginalClass != null) {
        button.className = button.dataset.ofeOriginalClass;
        delete button.dataset.ofeOriginalClass;
      }
    }
  }

  function ensureTabButton(ctx) {
    if (!ctx.tabRow) return null;

    for (const button of ctx.tabRow.querySelectorAll(":scope > button")) {
      if (button.id === TAB_BUTTON_ID || button.dataset.ofeTabBound === "1") continue;
      button.dataset.ofeTabBound = "1";
      button.addEventListener("click", () => {
        state.extensionSettingsTabActive = false;
      });
    }

    let button = document.getElementById(TAB_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = TAB_BUTTON_ID;
      button.textContent = "Extension";
      button.addEventListener("click", () => {
        state.extensionSettingsTabActive = true;
        applyExtensionTabState();
      });
      ctx.tabRow.appendChild(button);
    }

    updateTabButtonState(button, Boolean(state.extensionSettingsTabActive));
    return button;
  }

  function ensureMobileTabRow(ctx) {
    let row = document.getElementById(MOBILE_TAB_ROW_ID);
    if (!row) {
      row = document.createElement("div");
      row.id = MOBILE_TAB_ROW_ID;
      row.className = "lg:hidden flex items-center gap-2 mb-4";

      const gameButton = document.createElement("button");
      gameButton.type = "button";
      gameButton.dataset.ofeMobileSettingsTab = "game";
      gameButton.textContent = "Game";
      gameButton.addEventListener("click", () => {
        state.extensionSettingsTabActive = false;
        applyExtensionTabState();
      });

      const extensionButton = document.createElement("button");
      extensionButton.type = "button";
      extensionButton.dataset.ofeMobileSettingsTab = "extension";
      extensionButton.textContent = "Extension";
      extensionButton.addEventListener("click", () => {
        state.extensionSettingsTabActive = true;
        applyExtensionTabState();
      });

      row.appendChild(gameButton);
      row.appendChild(extensionButton);
    }

    if (row.parentElement !== ctx.scroll) {
      ctx.scroll.insertBefore(row, ctx.defaultContent);
    }

    const active = Boolean(state.extensionSettingsTabActive);
    updateMobileTabButtonState(
      row.querySelector('[data-ofe-mobile-settings-tab="game"]'),
      !active,
    );
    updateMobileTabButtonState(
      row.querySelector('[data-ofe-mobile-settings-tab="extension"]'),
      active,
    );
    return row;
  }

  function syncExtensionKeybindRows(root) {
    for (const action of Object.keys(constants.EXT_SHORTCUTS)) {
      const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
      if (el) syncSettingElementValue(el, action);
    }
    for (const key of Object.keys(constants.EXT_SOUND_SETTINGS)) {
      const toggle = root.querySelector(`[data-ofe-setting="${key}"]`);
      if (toggle) syncToggleValue(toggle, key);
    }
  }

  function applyExtensionTabState() {
    const ctx = findModalContext();
    if (!ctx) return;

    const root = ensureExtensionRoot(ctx.scroll);
    ensureTabButton(ctx);
    ensureMobileTabRow(ctx);
    syncExtensionKeybindRows(root);
    syncHostTabButtonState(ctx);

    const active = Boolean(state.extensionSettingsTabActive);
    ctx.defaultContent.style.display = active ? "none" : "";
    root.style.display = active ? "" : "none";
  }

  function ensureSettingsSection() {
    const ctx = findModalContext();
    if (!ctx) return;

    ensureExtensionRoot(ctx.scroll);
    ensureTabButton(ctx);
    applyExtensionTabState();
  }

  fn.initSettingsIntegration = () => {
    if (state.settingsIntegrationInit) return;
    state.settingsIntegrationInit = true;
    state.extensionSettingsTabActive = false;

    setInterval(() => {
      ensureSettingsSection();
    }, 800);
  };
})();
