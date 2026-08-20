"use strict";

/**
 * Econ markers — annotate YOUR Ports, Factories, and Cities on the map with
 * their measured economic contribution per minute of existence.
 *
 * Attribution is exact: every tile-stamped gold credit the server grants
 * (trade-ship arrivals at ports, train payouts at stations) is delivered to
 * the client as a BonusEvent game update `{player, tile, gold}` — see
 * PlayerImpl.addGold(gold, tile) in the game source. We match the tile to
 * your nearest station and add it to that building's lifetime ledger.
 *
 * Rendering reuses the marker pipeline: this module publishes
 * `data-ofe-econ-markers` (world coords + label text); content.js draws the
 * labels inside the game's map layer so they pan/zoom with the world.
 *
 * Info-only: reads game state, never sends intents or takes actions.
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  const TICKS_PER_SEC = 10;
  const STATION_TYPES = new Set(["Port", "Factory", "City"]);
  const SWEEP_INTERVAL_TICKS = 20;
  const PUBLISH_INTERVAL_TICKS = 20;
  const MATCH_RADIUS = 4; // tiles: bonus tile -> station match tolerance
  const ENABLED_KEY = "ofe.econmarkers.enabled";

  const em = (state.econMarkersState = state.econMarkersState || {
    stations: new Map(), // unitId -> {type, x, y, bornTick, gold, active}
    myPlayerId: null,
    lastSweepTick: -1,
    lastPublishTick: -1,
    unmatchedGold: 0,
    enabled: true,
    initialized: false,
  });

  function fmt(n) {
    if (!Number.isFinite(n)) return "";
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + "K";
    return String(Math.round(n));
  }

  function clearPublished() {
    try {
      document.documentElement.removeAttribute("data-ofe-econ-markers");
    } catch (_) {}
  }

  function resetForNewGame() {
    em.stations.clear();
    em.myPlayerId = null;
    em.lastSweepTick = -1;
    em.lastPublishTick = -1;
    em.unmatchedGold = 0;
    clearPublished();
  }

  function getGameAndMe() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.myPlayer !== "function") return null;
    try {
      const me = game.myPlayer();
      if (!me) return null;
      return { game, me };
    } catch (_) {
      return null;
    }
  }

  // Periodically sweep my station units: births, deaths, positions.
  function sweepStations(tick) {
    const ctx = getGameAndMe();
    if (!ctx) return;
    const { game, me } = ctx;

    try {
      if (typeof me.id === "function") em.myPlayerId = me.id();
    } catch (_) {}

    let units = [];
    try {
      units = me.units ? me.units() : [];
    } catch (_) {
      return;
    }

    const seen = new Set();
    for (const unit of units) {
      try {
        const type = typeof unit.type === "function" ? unit.type() : null;
        if (!STATION_TYPES.has(type)) continue;
        if (
          typeof unit.isUnderConstruction === "function" &&
          unit.isUnderConstruction()
        ) {
          continue;
        }
        const id = typeof unit.id === "function" ? Number(unit.id()) : NaN;
        if (!Number.isFinite(id)) continue;
        const tile = typeof unit.tile === "function" ? unit.tile() : null;
        const x = Number(game.x(tile));
        const y = Number(game.y(tile));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        seen.add(id);
        const existing = em.stations.get(id);
        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.active = true;
        } else {
          em.stations.set(id, {
            type,
            x,
            y,
            bornTick: tick,
            gold: 0,
            active: true,
          });
        }
      } catch (_) {}
    }

    // Lost buildings (captured/destroyed): drop their labels.
    for (const [id, station] of em.stations.entries()) {
      if (!seen.has(id)) em.stations.delete(id);
    }
  }

  function creditBonus(gameX, gameY, gold) {
    let best = null;
    let bestDist = Infinity;
    for (const station of em.stations.values()) {
      const dist =
        Math.abs(station.x - gameX) + Math.abs(station.y - gameY);
      if (dist < bestDist) {
        bestDist = dist;
        best = station;
      }
    }
    if (best && bestDist <= MATCH_RADIUS) {
      best.gold += gold;
    } else {
      em.unmatchedGold += gold; // conquest loot, off-station bonuses
    }
  }

  function handleBonusEvents(gu) {
    const updates = gu.updates;
    const bonusKey = constants.GAME_UPDATE_TYPE.BONUS_EVENT;
    const events = updates && Array.isArray(updates[bonusKey])
      ? updates[bonusKey]
      : null;
    if (!events || !events.length) return;

    const ctx = getGameAndMe();
    if (!ctx) return;
    const { game } = ctx;

    for (const event of events) {
      try {
        if (!event || event.player == null) continue;
        if (em.myPlayerId == null || event.player !== em.myPlayerId) continue;
        const gold = Number(event.gold);
        if (!Number.isFinite(gold) || gold <= 0) continue;
        const x = Number(game.x(event.tile));
        const y = Number(game.y(event.tile));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        creditBonus(x, y, gold);
      } catch (_) {}
    }
  }

  function publish(tick) {
    if (!em.enabled || state.gamePhase !== "playing") {
      clearPublished();
      return;
    }
    const markers = {};
    for (const [id, station] of em.stations.entries()) {
      const minutes = Math.max(
        0.5,
        (tick - station.bornTick) / TICKS_PER_SEC / 60,
      );
      const perMin = station.gold / minutes;
      // Cities with no train income yet stay unlabeled (less clutter).
      if (station.type === "City" && station.gold <= 0) continue;
      markers[id] = {
        x: station.x,
        y: station.y,
        type: station.type,
        text: station.gold > 0 ? `${fmt(perMin)}/m` : "0/m",
      };
    }
    try {
      document.documentElement.setAttribute(
        "data-ofe-econ-markers",
        JSON.stringify(markers),
      );
    } catch (_) {}
  }

  function onTick(gu) {
    if (state.gamePhase !== "playing") return;
    const tick = Number(gu && gu.tick);
    if (!Number.isFinite(tick)) return;

    if (
      em.lastSweepTick < 0 ||
      tick - em.lastSweepTick >= SWEEP_INTERVAL_TICKS
    ) {
      em.lastSweepTick = tick;
      sweepStations(tick);
    }

    handleBonusEvents(gu);

    if (
      em.lastPublishTick < 0 ||
      tick - em.lastPublishTick >= PUBLISH_INTERVAL_TICKS
    ) {
      em.lastPublishTick = tick;
      publish(tick);
    }
  }

  fn.setEconMarkersEnabled = (enabled) => {
    em.enabled = Boolean(enabled);
    try {
      localStorage.setItem(ENABLED_KEY, em.enabled ? "1" : "0");
    } catch (_) {}
    if (!em.enabled) clearPublished();
  };

  fn.econMarkersEnabled = () => em.enabled;

  fn.initEconMarkers = () => {
    if (em.initialized) return;
    em.initialized = true;
    try {
      em.enabled = localStorage.getItem(ENABLED_KEY) !== "0";
    } catch (_) {}
    if (fn.onGameTick) fn.onGameTick(onTick);
    if (fn.onGamePhaseChange) {
      fn.onGamePhaseChange((oldPhase, newPhase) => {
        if (newPhase === "spawn" || newPhase === "none") resetForNewGame();
      });
    }
  };
})();
