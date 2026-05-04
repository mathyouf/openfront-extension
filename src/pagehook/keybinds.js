"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  const EXT_KEYBINDS_STORAGE_KEY = "ofe.keybinds";
  const EXT_SETTINGS_STORAGE_KEY = "ofe.settings";

  function gameKeybindActionLabel(action) {
    return action;
  }

  function defaultGameKeybinds() {
    const isMac = /Mac/.test(navigator.userAgent);
    return {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "KeyT",
      attackRatioUp: "KeyY",
      boatAttack: "KeyB",
      groundAttack: "KeyG",
      swapDirection: "KeyU",
      modifierKey: isMac ? "MetaLeft" : "ControlLeft",
      altKey: "AltLeft",
      buildCity: "Digit1",
      buildFactory: "Digit2",
      buildPort: "Digit3",
      buildDefensePost: "Digit4",
      buildMissileSilo: "Digit5",
      buildSamLauncher: "Digit6",
      buildWarship: "Digit7",
      buildAtomBomb: "Digit8",
      buildHydrogenBomb: "Digit9",
      buildMIRV: "Digit0",
      resetGfx: "KeyR",
    };
  }

  function readGameSettingKeybindValue(parsed, key, fallback) {
    const entry = parsed && parsed[key];
    if (entry && typeof entry === "object" && typeof entry.value === "string") {
      return entry.value;
    }
    if (typeof entry === "string") return entry;
    return fallback;
  }

  function getGameSettingsKeybindsRaw() {
    try {
      return JSON.parse(localStorage.getItem("settings.keybinds") || "{}");
    } catch (_) {
      return {};
    }
  }

  function getEffectiveGameKeybinds() {
    const defaults = defaultGameKeybinds();
    const saved = getGameSettingsKeybindsRaw();
    const merged = { ...defaults };

    for (const key of Object.keys(defaults)) {
      merged[key] = readGameSettingKeybindValue(saved, key, defaults[key]);
    }

    for (const [key, value] of Object.entries(saved)) {
      if (merged[key] != null) continue;
      if (typeof value === "string") {
        merged[key] = value;
      } else if (value && typeof value === "object" && typeof value.value === "string") {
        merged[key] = value.value;
      }
    }

    return merged;
  }

  function getDefaultExtensionBindings() {
    const map = {};
    for (const [action, meta] of Object.entries(constants.EXT_SHORTCUTS)) {
      map[action] = meta.defaultCode;
    }
    return map;
  }

  function getExtensionBindingsRaw() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXT_KEYBINDS_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function getEffectiveExtensionBindings() {
    const defaults = getDefaultExtensionBindings();
    const raw = getExtensionBindingsRaw();
    const merged = { ...defaults };

    for (const action of Object.keys(defaults)) {
      const entry = raw[action];
      if (entry && typeof entry === "object" && typeof entry.value === "string") {
        merged[action] = entry.value;
      } else if (typeof entry === "string") {
        merged[action] = entry;
      }
    }

    return merged;
  }

  function saveExtensionBinding(action, value, keyLabel) {
    const raw = getExtensionBindingsRaw();
    raw[action] = {
      value,
      key: typeof keyLabel === "string" ? keyLabel : "",
    };
    localStorage.setItem(EXT_KEYBINDS_STORAGE_KEY, JSON.stringify(raw));
  }

  function getDefaultExtensionSettings() {
    return {
      spawnEntry: true,
      gameStart: true,
      boatLanding: true,
      boatInbound: true,
      boatDestroyed: true,
      groundAttackInbound: true,
      warshipDestroyed: true,
      neighborSleeping: true,
      neighborTraitor: true,
      nukeInbound: true,
      hydrogenInbound: true,
      mirvInbound: true,
    };
  }

  function primeExtensionSettingsCache() {
    if (state.extensionSettingsCache) {
      return state.extensionSettingsCache;
    }
    const defaults = getDefaultExtensionSettings();
    const raw = getExtensionSettingsRaw();
    state.extensionSettingsCache = { ...defaults };

    for (const key of Object.keys(defaults)) {
      if (typeof raw[key] === "boolean") {
        state.extensionSettingsCache[key] = raw[key];
      }
    }

    return state.extensionSettingsCache;
  }

  function getExtensionSettingsRaw() {
    try {
      const parsed = JSON.parse(localStorage.getItem(EXT_SETTINGS_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function getEffectiveExtensionSettings() {
    return { ...primeExtensionSettingsCache() };
  }

  function saveExtensionSetting(key, value) {
    const cached = primeExtensionSettingsCache();
    cached[key] = value;
    const raw = getExtensionSettingsRaw();
    raw[key] = value;
    localStorage.setItem(EXT_SETTINGS_STORAGE_KEY, JSON.stringify(raw));
  }

  function codeToActionsMap(bindings) {
    const map = {};
    for (const [action, code] of Object.entries(bindings)) {
      if (!code || code === "Null") continue;
      if (!map[code]) map[code] = [];
      map[code].push(action);
    }
    return map;
  }

  function getShortcutDiagnostics() {
    const game = getEffectiveGameKeybinds();
    const ext = getEffectiveExtensionBindings();

    const gameByCode = codeToActionsMap(game);
    const extByCode = codeToActionsMap(ext);

    const byAction = {};
    const byCode = {};

    for (const [action, meta] of Object.entries(constants.EXT_SHORTCUTS)) {
      const code = ext[action];
      const gameConflicts = ((code && gameByCode[code]) || []).map((id) => ({
        scope: "game",
        id,
        label: gameKeybindActionLabel(id),
      }));

      const extConflicts = ((code && extByCode[code]) || [])
        .filter((id) => id !== action)
        .map((id) => ({
          scope: "extension",
          id,
          label: constants.EXT_SHORTCUTS[id]
            ? constants.EXT_SHORTCUTS[id].label
            : id,
        }));

      const conflicts = [...gameConflicts, ...extConflicts];
      const ready = Boolean(code && code !== "Null" && conflicts.length === 0);

      const diag = {
        action,
        label: meta.label,
        desc: meta.desc,
        code,
        defaultCode: meta.defaultCode,
        conflicts,
        ready,
      };

      byAction[action] = diag;
      if (code) byCode[code] = diag;
    }

    return { byAction, byCode };
  }

  fn.getGameSettingsKeybinds = getGameSettingsKeybindsRaw;
  fn.getEffectiveGameKeybinds = getEffectiveGameKeybinds;
  fn.getBoatAttackKey = () => getEffectiveGameKeybinds().boatAttack || "KeyB";

  fn.getDefaultExtensionBindings = getDefaultExtensionBindings;
  fn.getExtensionBindingsRaw = getExtensionBindingsRaw;
  fn.getEffectiveExtensionBindings = getEffectiveExtensionBindings;
  fn.saveExtensionBinding = saveExtensionBinding;
  fn.getDefaultExtensionSettings = getDefaultExtensionSettings;
  fn.getExtensionSettingsRaw = getExtensionSettingsRaw;
  fn.getEffectiveExtensionSettings = getEffectiveExtensionSettings;
  fn.saveExtensionSetting = saveExtensionSetting;
  fn.extensionSoundEnabled = (key) => primeExtensionSettingsCache()[key] !== false;
  fn.anyExtensionSoundsEnabled = () =>
    Object.values(primeExtensionSettingsCache()).some((value) => value !== false);

  fn.getShortcutDiagnostics = getShortcutDiagnostics;

  fn.getShortcutCodeForAction = (action) => {
    return getEffectiveExtensionBindings()[action] || null;
  };

  fn.getShortcutActionByCode = (code) => {
    const diagnostics = getShortcutDiagnostics();
    const diag = diagnostics.byCode[code];
    return diag ? diag.action : null;
  };

  fn.isShortcutActionReady = (action) => {
    const diagnostics = getShortcutDiagnostics();
    const diag = diagnostics.byAction[action];
    return !!diag && diag.ready;
  };

  fn.isShortcutCodeReady = (code) => {
    const diagnostics = getShortcutDiagnostics();
    const diag = diagnostics.byCode[code];
    return !!diag && diag.ready;
  };

  fn.getShortcutConflictSummary = (code) => {
    const diagnostics = getShortcutDiagnostics();
    const diag = diagnostics.byCode[code];
    if (!diag || diag.ready) return null;
    return {
      label: diag.label,
      conflicts: diag.conflicts.map((c) => c.label),
    };
  };
})();
