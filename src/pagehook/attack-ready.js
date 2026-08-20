"use strict";

/**
 * Attack-readiness badges — for each NEIGHBOR you could attack, show the
 * slider % you'd need for an efficient attack, colored by whether your
 * SPENDABLE troops could afford it.
 *
 * Why 1.66x: the attacker-loss formula clamps defenderTroops/attackTroops
 * to [0.6, 2] (Config.ts attackLogic). Committing >= troops/0.6 = 1.66x the
 * defender's troops saturates the discount — attacking with less pays a
 * higher per-tile price; more buys nothing further on the clamp term.
 * Terrain (plains 80 / highland 100 / mountain 120), defense posts, and the
 * bot 0.7x modifier still matter — the badge is the troop-ratio picture.
 *
 * NOT-YET-ATTACKED neighbor (rounded pill, ⚔/🤖 prefix):
 *   label "≥37%" = slider needed for 1.66x at your current pool
 *   ("MAX n×" when even 100% falls short);
 *   color = gradient on q = spendable / theirTroops, where spendable =
 *   pool MINUS the 40%-of-cap growth floor.
 *
 * ALREADY-ATTACKING neighbor (sharp square badge, ▶ prefix):
 *   label = your current sent multiple, e.g. "1.2×" (in-flight outgoing
 *   attacks on them / their troops);
 *   color = gradient on q = (sent + spendable) / theirTroops — can you
 *   still top the wave up to the optimum — and WHITE once sent >= 1.66x.
 *
 * Gradient: red (0) → orange (0.5) → yellow (1: match) → green (1.66:
 * loss-optimal) → blue (2+: overwhelming).
 *
 * Info-only: reads game state, never sends intents or takes actions.
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  const OPTIMAL_MULT = 1.66; // saturates the [0.6, 2] loss clamp
  const GROWTH_FLOOR = 0.4; // don't count troops below 40% of cap as spendable
  const PUBLISH_INTERVAL_TICKS = 2; // 5x/sec — badges must feel live
  const ENABLED_KEY = "ofe.attackready.enabled";
  const WHITE = "#ffffff";

  // Gradient stops on q = spendable / defenderTroops.
  const GRADIENT_STOPS = [
    [0.0, [239, 68, 68]], // red
    [0.5, [249, 115, 22]], // orange
    [1.0, [234, 179, 8]], // yellow
    [1.66, [34, 197, 94]], // green
    [2.0, [59, 130, 246]], // blue
  ];

  function gradientColor(q) {
    if (!Number.isFinite(q)) return "#94a3b8";
    const stops = GRADIENT_STOPS;
    if (q <= stops[0][0]) return rgb(stops[0][1]);
    const lastStop = stops[stops.length - 1];
    if (q >= lastStop[0]) return rgb(lastStop[1]);
    for (let i = 1; i < stops.length; i++) {
      const [q1, c1] = stops[i];
      const [q0, c0] = stops[i - 1];
      if (q <= q1) {
        const t = (q - q0) / (q1 - q0);
        return rgb([
          Math.round(c0[0] + (c1[0] - c0[0]) * t),
          Math.round(c0[1] + (c1[1] - c0[1]) * t),
          Math.round(c0[2] + (c1[2] - c0[2]) * t),
        ]);
      }
    }
    return rgb(lastStop[1]);
  }

  function rgb(c) {
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  fn._attackReadyGradient = gradientColor;

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

    // Spendable = everything above the 40%-of-cap growth floor.
    const myMax = fn.readMyMaxTroops ? fn.readMyMaxTroops() : null;
    const spendable =
      myMax != null && myMax > 0
        ? Math.max(0, myPool - GROWTH_FLOOR * myMax)
        : myPool;

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

        const sent = fn.readSentTroopsOn ? fn.readSentTroopsOn(smallID) : 0;
        const type =
          typeof player.type === "function" ? String(player.type()) : "";

        let label;
        let color;
        let attacking = false;
        if (sent > 0) {
          // Already attacking: show the current wave as a multiple of their
          // troops; color = can (sent + spendable) still reach the optimum.
          attacking = true;
          const mult = def > 0 ? sent / def : Infinity;
          label = mult === Infinity ? "∞×" : `${mult.toFixed(mult < 10 ? 1 : 0)}×`;
          if (mult >= OPTIMAL_MULT) {
            color = WHITE;
          } else {
            const q = def > 0 ? (sent + spendable) / def : Infinity;
            color = gradientColor(q === Infinity ? 99 : q);
          }
        } else {
          const optimalTroops = OPTIMAL_MULT * def;
          const neededFraction = optimalTroops / myPool;
          if (neededFraction > 1) {
            label = `MAX ${neededFraction.toFixed(1)}×`;
          } else {
            label = `≥${Math.max(1, Math.ceil(neededFraction * 100))}%`;
          }
          const q = def > 0 ? spendable / def : Infinity;
          color = gradientColor(q === Infinity ? 99 : q);
        }

        badges[smallID] = {
          x,
          y,
          label,
          color,
          atk: attacking,
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
