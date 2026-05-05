"use strict";

(() => {
  const ATTACKING_TROOPS_OVERLAY_KEY = "settings.attackingTroopsOverlay";

  function disableAttackingTroopsOverlay() {
    try {
      localStorage.setItem(ATTACKING_TROOPS_OVERLAY_KEY, "false");
    } catch (_) {}
  }

  disableAttackingTroopsOverlay();
})();
