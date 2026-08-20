"use strict";

/**
 * Attack-readiness badges — for each NEIGHBOR you could attack, show the
 * slider % you'd need for an efficient attack, colored by whether your
 * CURRENT slider commitment meets it.
 *
 * Why 1.66x: the attacker-loss formula clamps defenderTroops/attackTroops
 * to [0.6, 2] (Config.ts attackLogic). Committing >= troops/0.6 = 1.66x the
 * defender's troops saturates the discount — attacking with less pays a
 * higher per-tile price; more buys nothing further on the clamp term.
 * Terrain (plains 80 / highland 100 / mountain 120), defense posts, and the
 * bot 0.7x modifier still matter — the badge is the troop-ratio picture.
 *
 * Badge: "≥37%" = slider needed for 1.66x at your current pool.
 *   green  = your current slider already commits >= 1.66x their troops
 *   amber  = current slider commits >= 1.0x (workable, paying extra losses)
 *   red    = current slider commits < 1.0x their troops
 *   "MAX"  = even 100% of your pool is < 1.66x (label shows the shortfall)
 *
 * Info-only: reads game state, never sends intents or takes actions.
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  const OPTIMAL_MULT = 1.66; // saturates the [0.6, 2] loss clamp
  const PUBLISH_INTERVAL_TICKS = 10;
  const ENABLED_KEY = "ofe.attackready.enabled";

  const ar = (state.attackReadyState = state.attackReadyState || {
    enabled: true,
    lastPublishTick: -1,
    initialized: false,
  });

  function clearPublished() {
    try {
      document.documentElement.removeAttribute("data-ofe-attack-ready");
    } catch (_) {}
  }

  function publish(tick) {
    if (!ar.enabled || state.gamePhase !== "playing") {
      clearPublished();
      return;
    }

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (
      !game ||
      typeof game.myPlayer !== "function" ||
      typeof game.playerBySmallID !== "function"
    ) {
      return;
    }

    let me = null;
    let myPool = null;
    try {
      me = game.myPlayer();
      myPool = me ? Number(me.troops()) : null;
    } catch (_) {}
    if (!me || !Number.isFinite(myPool) || myPool <= 0) return;

    const ratio = fn.readCurrentAttackRatio ? fn.readCurrentAttackRatio() : null;
    const committed = ratio != null ? ratio * myPool : null;

    const badges = {};
    const neighborIds = Object.keys(state.neighborStatusById || {});
    for (const key of neighborIds) {
      const smallID = Number(key);
      if (!Number.isFinite(smallID)) continue;

      let player = null;
      try {
        player = game.playerBySmallID(smallID);
      } catch (_) {
        continue;
      }
      if (!player) continue;
      try {
        if (typeof player.isAlive === "function" && !player.isAlive()) continue;
        if (typeof me.isFriendly === "function" && me.isFriendly(player)) {
          continue;
        }

        const def = Number(player.troops());
        if (!Number.isFinite(def) || def < 0) continue;

        const location =
          typeof player.nameLocation === "function"
            ? player.nameLocation()
            : null;
        const x = location ? Number(location.x) : NaN;
        const y = location ? Number(location.y) : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const optimalTroops = OPTIMAL_MULT * def;
        const neededFraction = optimalTroops / myPool;

        let label;
        if (neededFraction > 1) {
          label = `MAX ${(neededFraction).toFixed(1)}×`;
        } else {
          label = `≥${Math.max(1, Math.ceil(neededFraction * 100))}%`;
        }

        let color = "#94a3b8";
        if (committed != null) {
          if (committed >= optimalTroops) color = "#22c55e";
          else if (committed >= def) color = "#f59e0b";
          else color = "#ef4444";
        }

        const type =
          typeof player.type === "function" ? String(player.type()) : "";
        badges[smallID] = {
          x,
          y,
          label,
          color,
          bot: type === "BOT",
        };
      } catch (_) {}
    }

    try {
      document.documentElement.setAttribute(
        "data-ofe-attack-ready",
        JSON.stringify(badges),
      );
    } catch (_) {}
  }

  function onTick(gu) {
    if (state.gamePhase !== "playing") return;
    const tick = Number(gu && gu.tick);
    if (!Number.isFinite(tick)) return;
    if (
      ar.lastPublishTick >= 0 &&
      tick - ar.lastPublishTick < PUBLISH_INTERVAL_TICKS
    ) {
      return;
    }
    ar.lastPublishTick = tick;
    publish(tick);
  }

  fn.setAttackReadyEnabled = (enabled) => {
    ar.enabled = Boolean(enabled);
    try {
      localStorage.setItem(ENABLED_KEY, ar.enabled ? "1" : "0");
    } catch (_) {}
    if (!ar.enabled) clearPublished();
  };

  fn.attackReadyEnabled = () => ar.enabled;

  fn.initAttackReady = () => {
    if (ar.initialized) return;
    ar.initialized = true;
    try {
      ar.enabled = localStorage.getItem(ENABLED_KEY) !== "0";
    } catch (_) {}
    if (fn.onGameTick) fn.onGameTick(onTick);
    if (fn.onGamePhaseChange) {
      fn.onGamePhaseChange((oldPhase, newPhase) => {
        if (newPhase !== "playing") clearPublished();
      });
    }
  };
})();
