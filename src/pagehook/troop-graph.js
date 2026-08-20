"use strict";

/**
 * Mini control panel + the SMART SLIDER (40% mode).
 *
 * The panel is a small draggable strip: live troops / % of cap / gold, and
 * toggle pills for the three features (smart slider, $/min labels, ⚔ ready
 * badges).
 *
 * Smart slider (toggle ⚖): keeps the game's attack-ratio slider set so ONE
 * click is optimal:
 *   - hovering an ENEMY: commit exactly what tops your TOTAL wave against
 *     them up to 1.66x their troops — counting troops you have ALREADY SENT
 *     (your in-flight outgoing attacks on that player). Already at 1.66x or
 *     beyond -> slider parks at 1%.
 *   - hovering an ALLY: the maximum donation that keeps you at the 40%
 *     growth floor (the donate intent carries the slider amount; the server
 *     truncates to the ally's free cap space).
 *   - hovering nothing: one click spends you down to exactly 40% of cap
 *     (the fast-regen band).
 * It only adjusts the game's own slider setting — every attack, boat, and
 * donation is still the player's own click.
 *
 * Regen math (openfrontio Config.ts): growth peaks ~42% of cap;
 * maxTroops = 2*(tiles^0.6*1000 + 50000) + cityLevels*250000.
 * Loss clamp: attacker losses saturate at 1.66x the defender's troops.
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  const TICKS_PER_SEC = 10;
  const VISIBLE_KEY = "ofe.troopgraph.visible";
  const POS_KEY = "ofe.troopgraph.pos";
  const SMART_SLIDER_KEY = "ofe.troopgraph.smartslider";
  const SMART_FLOOR = 0.4; // never let one click take the pool below 40% of cap
  const OPTIMAL_ATTACK_MULT = 1.66; // saturates the [0.6,2] loss clamp
  const PANEL_W = 264;

  const CAP_ZONES = [
    { test: (p) => p < 9 || p > 82, color: "#f87171" },
    { test: (p) => p < 18 || p > 70, color: "#fb923c" },
    { test: (p) => p < 23 || p > 64, color: "#eab308" },
    { test: (p) => p < 31 || p > 54, color: "#22c55e" },
    { test: () => true, color: "#22d3ee" },
  ];

  const tg = (state.troopGraphState = state.troopGraphState || {});
  Object.assign(tg, {
    smartSlider: tg.smartSlider ?? false,
    lastSliderApplyTick: tg.lastSliderApplyTick ?? -1,
    panel: tg.panel || null,
    visible: tg.visible ?? true,
    initialized: tg.initialized ?? false,
    lastGameTick: tg.lastGameTick ?? -1,
    lastRenderTick: tg.lastRenderTick ?? -1,
  });

  function troopInc(troops, max) {
    if (!(max > 0) || !(troops >= 0)) return 0;
    let toAdd = 10 + Math.pow(troops, 0.73) / 4;
    toAdd *= 1 - troops / max;
    return Math.min(troops + toAdd, max) - troops;
  }

  fn._troopGraphMath = { troopInc };

  // ---------------------------------------------------------------------------
  // Live game reads (shared with attack-ready via fn exports)
  // ---------------------------------------------------------------------------

  function getMyPlayerView() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.myPlayer !== "function") return null;
    try {
      return game.myPlayer() || null;
    } catch (_) {
      return null;
    }
  }

  function readMaxTroops(me) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (game && typeof game.config === "function") {
      try {
        const config = game.config();
        if (config && typeof config.maxTroops === "function") {
          const max = Number(config.maxTroops(me));
          if (Number.isFinite(max) && max > 0) return max;
        }
      } catch (_) {}
    }
    try {
      const tiles = Number(me.numTilesOwned());
      if (!Number.isFinite(tiles) || tiles < 0) return null;
      let cityLevels = 0;
      if (typeof me.units === "function") {
        const cities = me.units("City") || [];
        for (const city of cities) {
          try {
            if (
              typeof city.isUnderConstruction === "function" &&
              city.isUnderConstruction()
            ) {
              continue;
            }
            const level =
              typeof city.level === "function" ? Number(city.level()) : 1;
            cityLevels += Number.isFinite(level) ? level : 1;
          } catch (_) {
            cityLevels += 1;
          }
        }
      }
      return 2 * (Math.pow(tiles, 0.6) * 1000 + 50000) + cityLevels * 250000;
    } catch (_) {
      return null;
    }
  }

  fn.readMyMaxTroops = () => {
    const me = getMyPlayerView();
    return me ? readMaxTroops(me) : null;
  };

  function attackField(attack, name) {
    if (!attack) return null;
    let raw;
    try {
      raw = typeof attack[name] === "function" ? attack[name]() : attack[name];
    } catch (_) {
      return null;
    }
    if (typeof raw === "boolean") return raw;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  // Troops currently committed against a specific player (in-flight ground
  // attacks; retreating waves excluded — they're coming home, not attacking).
  fn.readSentTroopsOn = (targetSmallID) => {
    const me = getMyPlayerView();
    if (!me || typeof me.outgoingAttacks !== "function") return 0;
    let total = 0;
    try {
      const attacks = me.outgoingAttacks() || [];
      for (const attack of attacks) {
        if (attackField(attack, "retreating") === true) continue;
        const target = attackField(attack, "targetID");
        if (target == null || Number(target) !== Number(targetSmallID)) {
          continue;
        }
        const troops = attackField(attack, "troops");
        if (troops != null && troops > 0) total += troops;
      }
    } catch (_) {}
    return total;
  };

  function readGold(me) {
    try {
      const gold = Number(me.gold());
      if (Number.isFinite(gold) && gold >= 0) return gold;
    } catch (_) {}
    return null;
  }

  function resolveSmallID(player) {
    try {
      if (player && typeof player.smallID === "function") {
        const id = Number(player.smallID());
        if (Number.isFinite(id)) return id;
      }
    } catch (_) {}
    return null;
  }

  // ---------------------------------------------------------------------------
  // Smart slider
  // ---------------------------------------------------------------------------

  function smartSliderTick(tick, pool, max) {
    if (!tg.smartSlider) return;
    if (!(pool > 0) || !(max > 0)) return;
    if (tick - tg.lastSliderApplyTick < 3) return;
    if (!fn.applyAttackRatio || !fn.readCurrentAttackRatio) return;

    // Ratio that lands the pool exactly on the 40% floor.
    const floorRatio = 1 - (SMART_FLOOR * max) / pool;

    let target = floorRatio;
    const hovered = fn.getHoveredPlayer ? fn.getHoveredPlayer() : null;
    if (hovered) {
      try {
        const me = getMyPlayerView();
        const isSelf =
          me &&
          typeof me.id === "function" &&
          typeof hovered.id === "function" &&
          me.id() === hovered.id();
        const friendly =
          me && typeof me.isFriendly === "function" && me.isFriendly(hovered);
        if (!isSelf && !friendly) {
          const def = Number(hovered.troops());
          if (Number.isFinite(def) && def >= 0) {
            const smallID = resolveSmallID(hovered);
            const sent = smallID != null ? fn.readSentTroopsOn(smallID) : 0;
            // Top the TOTAL wave up to 1.66x their troops — no more.
            const remaining = Math.max(0, OPTIMAL_ATTACK_MULT * def - sent);
            const attackRatio = remaining / pool;
            target = Math.min(attackRatio, Math.max(floorRatio, 0));
          }
        }
        // Hovered ALLY: keep the floor target — one donation click sends the
        // maximum that leaves the pool at the 40% growth floor.
      } catch (_) {}
    }

    const clamped = Math.min(1, Math.max(0.01, target));
    const current = fn.readCurrentAttackRatio();
    if (current == null || Math.abs(current - clamped) > 0.005) {
      tg.lastSliderApplyTick = tick;
      fn.applyAttackRatio(clamped);
    }
  }

  // ---------------------------------------------------------------------------
  // Mini panel
  // ---------------------------------------------------------------------------

  function fmt(n) {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + "K";
    return String(Math.round(n));
  }

  function capZone(pct) {
    for (const zone of CAP_ZONES) {
      if (zone.test(pct)) return zone;
    }
    return CAP_ZONES[CAP_ZONES.length - 1];
  }

  function readStoredJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (_) {
      return null;
    }
  }

  function ensurePanel() {
    if (tg.panel && document.body.contains(tg.panel)) return tg.panel;

    const panel = document.createElement("div");
    panel.id = "ofe-troop-graph";
    panel.style.cssText = [
      "position:fixed",
      "z-index:9000",
      `width:${PANEL_W}px`,
      "background:rgba(15,23,42,0.88)",
      "border:1px solid rgba(148,163,184,0.35)",
      "border-radius:10px",
      "box-shadow:0 4px 16px rgba(0,0,0,0.45)",
      "color:#e2e8f0",
      "font:11px/1.35 system-ui,sans-serif",
      "user-select:none",
      "backdrop-filter:blur(4px)",
      "display:none",
    ].join(";");

    const pos = readStoredJSON(POS_KEY);
    if (
      pos &&
      Number.isFinite(pos.left) &&
      Number.isFinite(pos.top) &&
      pos.left >= 0 &&
      pos.top >= 0 &&
      pos.left < window.innerWidth - 40 &&
      pos.top < window.innerHeight - 40
    ) {
      panel.style.left = pos.left + "px";
      panel.style.top = pos.top + "px";
    } else {
      panel.style.left = Math.max(8, window.innerWidth - PANEL_W - 12) + "px";
      panel.style.top = "64px";
    }

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:5px 8px 2px;cursor:move;font-weight:600";
    panel.appendChild(header);

    const pillCss = (on) =>
      "border-radius:5px;padding:1px 7px;cursor:pointer;font:10px system-ui;" +
      (on
        ? "background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.45);color:#86efac"
        : "background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.3);color:#94a3b8");

    const controls = document.createElement("div");
    controls.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:3px 8px 6px";

    const smartBtn = document.createElement("button");
    smartBtn.title =
      "40% mode: auto-set the attack slider. Hover an enemy → top your total wave (incl. troops already sent) up to 1.66× theirs; hover an ally → max donation keeping you at 40%; otherwise → one click spends down to 40% of cap.";
    const syncSmartBtn = () => {
      smartBtn.style.cssText = pillCss(tg.smartSlider);
      smartBtn.textContent = "⚖ 40% mode";
    };
    smartBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      tg.smartSlider = !tg.smartSlider;
      try {
        localStorage.setItem(SMART_SLIDER_KEY, tg.smartSlider ? "1" : "0");
      } catch (_) {}
      syncSmartBtn();
    });
    syncSmartBtn();
    controls.appendChild(smartBtn);

    const econBtn = document.createElement("button");
    econBtn.title =
      "Label your ports/factories/cities on the map with measured gold per minute of existence.";
    const syncEconBtn = () => {
      econBtn.style.cssText = pillCss(
        fn.econMarkersEnabled ? fn.econMarkersEnabled() : false,
      );
      econBtn.textContent = "$/min";
    };
    econBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (fn.setEconMarkersEnabled && fn.econMarkersEnabled) {
        fn.setEconMarkersEnabled(!fn.econMarkersEnabled());
      }
      syncEconBtn();
    });
    syncEconBtn();
    controls.appendChild(econBtn);

    const readyBtn = document.createElement("button");
    readyBtn.title =
      "Badge each neighbor: slider % needed for a 1.66× attack, colored by whether your spendable troops (above the 40% floor) could afford it. Neighbors you're attacking show your current sent multiple instead (white once ≥1.66×).";
    const syncReadyBtn = () => {
      readyBtn.style.cssText = pillCss(
        fn.attackReadyEnabled ? fn.attackReadyEnabled() : false,
      );
      readyBtn.textContent = "⚔ ready";
    };
    readyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (fn.setAttackReadyEnabled && fn.attackReadyEnabled) {
        fn.setAttackReadyEnabled(!fn.attackReadyEnabled());
      }
      syncReadyBtn();
    });
    syncReadyBtn();
    controls.appendChild(readyBtn);

    panel.appendChild(controls);

    let dragOffset = null;
    header.addEventListener("pointerdown", (e) => {
      dragOffset = {
        x: e.clientX - panel.offsetLeft,
        y: e.clientY - panel.offsetTop,
      };
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener("pointermove", (e) => {
      if (!dragOffset) return;
      const left = fn.clamp(e.clientX - dragOffset.x, 0, window.innerWidth - 60);
      const top = fn.clamp(e.clientY - dragOffset.y, 0, window.innerHeight - 30);
      panel.style.left = left + "px";
      panel.style.top = top + "px";
    });
    header.addEventListener("pointerup", () => {
      if (!dragOffset) return;
      dragOffset = null;
      try {
        localStorage.setItem(
          POS_KEY,
          JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }),
        );
      } catch (_) {}
    });

    document.body.appendChild(panel);
    tg.panel = panel;
    tg.header = header;
    return panel;
  }

  function phaseActive() {
    return state.gamePhase === "playing" || state.gamePhase === "spawn";
  }

  function render(sample) {
    if (!tg.visible || !phaseActive()) {
      if (tg.panel) tg.panel.style.display = "none";
      return;
    }
    if (!document.body) return;
    const panel = ensurePanel();
    panel.style.display = "block";

    let statsHtml = "Troops —";
    if (sample && Number.isFinite(sample.pool)) {
      statsHtml = `Troops ${fmt(sample.pool)}`;
      if (sample.max > 0) {
        const pct = (sample.pool / sample.max) * 100;
        const zone = capZone(pct);
        statsHtml += ` <span style="color:${zone.color}">${pct.toFixed(0)}%</span>`;
        const spendable = Math.max(0, sample.pool - SMART_FLOOR * sample.max);
        statsHtml += ` <span style="color:#94a3b8;font-weight:400">spend ${fmt(spendable)}</span>`;
      }
      if (sample.gold != null) {
        statsHtml += ` <span style="color:#fde68a;font-weight:400">⛁${fmt(sample.gold)}</span>`;
      }
    }
    tg.header.innerHTML = `<span style="flex:1">${statsHtml}</span>`;
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  function onTick(gu) {
    const tick = Number(gu && gu.tick);
    if (!Number.isFinite(tick)) return;
    tg.lastGameTick = tick;

    if (!phaseActive()) return;

    const me = getMyPlayerView();
    let sample = null;
    if (me) {
      let pool = null;
      try {
        pool = Number(me.troops());
      } catch (_) {}
      if (!Number.isFinite(pool)) pool = Number(state.myPlayerTroops);
      if (Number.isFinite(pool) && pool >= 0) {
        const max = readMaxTroops(me);
        sample = { pool, max: max || 0, gold: readGold(me) };
        smartSliderTick(tick, pool, max || 0);
      }
    }

    if (tick - tg.lastRenderTick >= 5 || sample == null) {
      tg.lastRenderTick = tick;
      render(sample);
    }
  }

  fn.toggleTroopGraph = () => {
    tg.visible = !tg.visible;
    try {
      localStorage.setItem(VISIBLE_KEY, tg.visible ? "1" : "0");
    } catch (_) {}
    render(null);
  };

  fn.initTroopGraph = () => {
    if (tg.initialized) return;
    tg.initialized = true;

    try {
      tg.visible = localStorage.getItem(VISIBLE_KEY) !== "0";
    } catch (_) {}
    try {
      tg.smartSlider = localStorage.getItem(SMART_SLIDER_KEY) === "1";
    } catch (_) {}

    if (fn.onGameTick) fn.onGameTick(onTick);
    if (fn.onGamePhaseChange) {
      fn.onGamePhaseChange((oldPhase, newPhase) => {
        if (tg.panel) {
          tg.panel.style.display =
            tg.visible && (newPhase === "playing" || newPhase === "spawn")
              ? "block"
              : "none";
        }
        if (newPhase === "spawn" || newPhase === "playing") render(null);
      });
    }
  };
})();
