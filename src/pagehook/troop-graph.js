"use strict";

/**
 * Troop Graph v2 — top-right trajectory panel, two stacked charts.
 *
 * MAIN CHART: troop pool history + forward projection, effective troops
 * (pool + troops committed to in-flight attacks), and up to 4 stacked
 * counterfactuals — one per recent troop-spending click — each simulated
 * with the troop CAP FROZEN at click time (no click -> no new territory).
 * The actual projection runs on the CURRENT cap, so a click that captured
 * land visibly out-grows its counterfactual: the crossing is the
 * break-even time, reported in the readout. A failed attack never crosses.
 *
 * RATE CHART: net troop growth per second over time, with the game's pure
 * regen potential overlaid — the gap between them is your combat drain.
 *
 * Info-only: reads game state, never sends intents or takes actions.
 *
 * Mechanics (openfrontio/OpenFrontIO src/core/configuration/Config.ts;
 * full notes in research/TROOP_MECHANICS.md of the workspace):
 *   inc/tick = (10 + troops^0.73/4) * (1 - troops/max), 10 ticks/sec
 *   max = 2*(tiles^0.6*1000 + 50000) + sum(cityLevels)*250000
 *   attack launch removes troops into the attack unit (they mostly return);
 *   conquered tiles raise max, so clicks can pay for themselves.
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  const TICKS_PER_SEC = 10;
  const HISTORY_MAX_TICKS = 6 * 60 * TICKS_PER_SEC;
  const SPEND_INTENT_TYPES = new Set(["attack", "boat", "donate_troops"]);
  const SPEND_PENDING_TICKS = 25;
  const MAX_CFS = 4;
  const BREAK_EVEN_MAX_TICKS = 10 * 60 * TICKS_PER_SEC;
  const HORIZONS_SEC = [30, 60, 120, 300];
  const VISIBLE_KEY = "ofe.troopgraph.visible";
  const POS_KEY = "ofe.troopgraph.pos";
  const HORIZON_KEY = "ofe.troopgraph.horizon";
  const PANEL_W = 300;
  const MAIN_H = 150;
  const RATE_H = 84;

  const COLOR_ACTUAL = "#6ee7a8";
  const COLOR_EFFECTIVE = "#67e8f9";
  const COLOR_CF = "#fbbf24";
  const COLOR_POTENTIAL = "#94a3b8";
  const COLOR_DRAIN = "rgba(248,113,113,0.28)";
  const COLOR_SPEND = "#f87171";

  // Growth-zone coloring for troops as % of cap (regen is fastest mid-band).
  const CAP_ZONES = [
    { test: (p) => p < 9 || p > 82, color: "#f87171" },
    { test: (p) => p < 18 || p > 70, color: "#fb923c" },
    { test: (p) => p < 23 || p > 64, color: "#eab308" },
    { test: (p) => p < 31 || p > 54, color: "#22c55e" },
    { test: () => true, color: "#22d3ee" },
  ];

  const tg = (state.troopGraphState = state.troopGraphState || {});
  Object.assign(tg, {
    samples: tg.samples || [], // {tick, actual, effective, max, rate, pot}
    cfs: tg.cfs || [], // {id, tick, amount, v, max, hist:[[tick,v]]}
    nextCfId: tg.nextCfId || 1,
    pendingSpendUntilTick: tg.pendingSpendUntilTick ?? -1,
    spendEvents: tg.spendEvents || [], // {tick, amount}
    growthEma: tg.growthEma ?? null,
    goldEma: tg.goldEma ?? null,
    horizonIdx: tg.horizonIdx ?? 1,
    panel: tg.panel || null,
    visible: tg.visible ?? true,
    initialized: tg.initialized ?? false,
    lastGameTick: tg.lastGameTick ?? -1,
  });

  // ---------------------------------------------------------------------------
  // Pure math (exposed for tests via fn._troopGraphMath)
  // ---------------------------------------------------------------------------

  function troopInc(troops, max) {
    if (!(max > 0) || !(troops >= 0)) return 0;
    let toAdd = 10 + Math.pow(troops, 0.73) / 4;
    toAdd *= 1 - troops / max;
    return Math.min(troops + toAdd, max) - troops;
  }

  function projectTrajectory(troops, max, ticks) {
    const out = new Array(ticks + 1);
    let t = troops;
    out[0] = t;
    for (let i = 1; i <= ticks; i++) {
      t += troopInc(t, max);
      out[i] = t;
    }
    return out;
  }

  // First tick at which pure regen from (a, maxA) catches (b, maxB); null if
  // not within limit. a = actual (current cap), b = counterfactual (frozen).
  function breakEvenTicks(a, maxA, b, maxB, limit) {
    let x = a;
    let y = b;
    for (let i = 1; i <= limit; i++) {
      x += troopInc(x, maxA);
      y += troopInc(y, maxB);
      if (x >= y) return i;
    }
    return null;
  }

  fn._troopGraphMath = { troopInc, projectTrajectory, breakEvenTicks };
  // trainsPerMin/unitCost are attached below their definitions (test hooks).

  // ---------------------------------------------------------------------------
  // Live game reads
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

  function attackField(attack, name) {
    if (!attack) return null;
    const raw =
      typeof attack[name] === "function" ? attack[name]() : attack[name];
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  // Troops currently committed to your own in-flight attacks/boats.
  function readInFlightTroops(me) {
    let total = 0;
    try {
      if (typeof me.outgoingAttacks === "function") {
        const attacks = me.outgoingAttacks() || [];
        for (const attack of attacks) {
          const troops = attackField(attack, "troops");
          if (troops != null && troops > 0) total += troops;
        }
      }
    } catch (_) {}
    return total;
  }

  function readGold(me) {
    try {
      const gold = Number(me.gold());
      if (Number.isFinite(gold) && gold >= 0) return gold;
    } catch (_) {}
    return null;
  }

  function countUnits(me, type) {
    try {
      if (typeof me.units === "function") {
        const units = me.units(type) || [];
        return units.length;
      }
    } catch (_) {}
    return 0;
  }

  function readSample() {
    const me = getMyPlayerView();
    if (!me) return null;
    let actual = null;
    try {
      actual = Number(me.troops());
    } catch (_) {}
    if (!Number.isFinite(actual)) actual = Number(state.myPlayerTroops);
    if (!Number.isFinite(actual) || actual < 0) return null;
    return {
      actual,
      max: readMaxTroops(me),
      inFlight: readInFlightTroops(me),
      gold: readGold(me),
      nCity: countUnits(me, "City"),
      nPort: countUnits(me, "Port"),
      nFactory: countUnits(me, "Factory"),
      nWarship: countUnits(me, "Warship"),
      nDefensePost: countUnits(me, "Defense Post"),
      nSam: countUnits(me, "SAM Launcher"),
    };
  }

  // Live building cost: prefer the game's own config (exact, includes
  // infinite-gold etc.), fall back to the published price formulas.
  // NB: Port and Factory share one price counter in the current source.
  function unitCost(type, sample, me) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (game && me && typeof game.config === "function") {
      try {
        const info = game.config().unitInfo(type);
        if (info && typeof info.cost === "function") {
          const cost = Number(info.cost(game, me));
          if (Number.isFinite(cost) && cost >= 0) return cost;
        }
      } catch (_) {}
    }
    const s = sample || {};
    switch (type) {
      case "City":
        return Math.min(1e6, 125000 * Math.pow(2, s.nCity || 0));
      case "Port":
      case "Factory":
        return Math.min(
          1e6,
          125000 * Math.pow(2, (s.nPort || 0) + (s.nFactory || 0)),
        );
      case "Warship":
        return Math.min(1e6, ((s.nWarship || 0) + 1) * 250000);
      case "Defense Post":
        return Math.min(250000, ((s.nDefensePost || 0) + 1) * 50000);
      case "SAM Launcher":
        return Math.min(3e6, ((s.nSam || 0) + 1) * 1500000);
      case "Missile Silo":
        return 1e6;
      default:
        return null;
    }
  }

  function readCityCapBonus() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (game && typeof game.config === "function") {
      try {
        const config = game.config();
        if (config && typeof config.cityTroopIncrease === "function") {
          const bonus = Number(config.cityTroopIncrease());
          if (Number.isFinite(bonus) && bonus > 0) return bonus;
        }
      } catch (_) {}
    }
    return 250000;
  }

  // Expected trains per minute for n factories (current source:
  // per-factory spawn chance 1/((n+10)*15) per tick).
  function trainsPerMin(n) {
    if (!(n > 0)) return 0;
    return (n / ((n + 10) * 15)) * 600;
  }

  fn._troopGraphMath.trainsPerMin = trainsPerMin;
  fn._troopGraphMath.unitCost = (type, sample) => unitCost(type, sample, null);

  // ---------------------------------------------------------------------------
  // Per-tick update
  // ---------------------------------------------------------------------------

  function resetForNewGame() {
    tg.samples.length = 0;
    tg.cfs.length = 0;
    tg.pendingSpendUntilTick = -1;
    tg.spendEvents.length = 0;
    tg.growthEma = null;
    tg.goldEma = null;
    tg.lastGameTick = -1;
  }

  function fmtMinSec(ticks) {
    const seconds = Math.round(ticks / TICKS_PER_SEC);
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min}:${String(sec).padStart(2, "0")}` : `${sec}s`;
  }

  function onTick(gu) {
    const tick = Number(gu && gu.tick);
    if (!Number.isFinite(tick)) return;
    if (tick < tg.lastGameTick - 5) resetForNewGame();
    tg.lastGameTick = tick;

    if (state.gamePhase !== "playing") return;

    const live = readSample();
    if (!live) return;
    const { actual, max, inFlight } = live;

    const prev = tg.samples.length ? tg.samples[tg.samples.length - 1] : null;

    // --- evolve each counterfactual on its own frozen cap ---
    for (const cf of tg.cfs) {
      cf.v += troopInc(cf.v, cf.max);
      if (cf.v > cf.max) cf.v = cf.max;
      cf.hist.push([tick, cf.v]);
      if (cf.hist.length > HISTORY_MAX_TICKS) cf.hist.shift();
    }

    // --- own-click spend detection -> new counterfactual ---
    if (prev && tick <= tg.pendingSpendUntilTick) {
      const prevMax = prev.max > 0 ? prev.max : max;
      const expected = prevMax > 0 ? troopInc(prev.actual, prevMax) : 0;
      const delta = actual - prev.actual;
      const drop = expected - delta;
      if (delta < 0 && drop > Math.max(50, expected * 2)) {
        const v = prev.actual + expected; // pre-click state, advanced to now
        tg.cfs.push({
          id: tg.nextCfId++,
          tick,
          amount: drop,
          v,
          max: prevMax, // cap frozen at click time: no click, no new land
          hist: [[tick, v]],
        });
        while (tg.cfs.length > MAX_CFS) tg.cfs.shift();
        tg.spendEvents.push({ tick, amount: drop });
        if (tg.spendEvents.length > 60) tg.spendEvents.shift();
        tg.pendingSpendUntilTick = -1;
      }
    }

    // --- retire counterfactuals that actual has caught (click paid off) ---
    for (let i = tg.cfs.length - 1; i >= 0; i--) {
      const cf = tg.cfs[i];
      if (actual >= cf.v) {
        if (fn.pushBottomRightLog) {
          fn.pushBottomRightLog(
            `OFE: spend of ${fmt(cf.amount)} (${fmtMinSec(tick - cf.tick)} ago) paid off.`,
          );
        }
        tg.cfs.splice(i, 1);
      }
    }

    // --- rates ---
    let rate = null;
    if (prev && tick > prev.tick) {
      rate = ((actual - prev.actual) / (tick - prev.tick)) * TICKS_PER_SEC;
      tg.growthEma =
        tg.growthEma == null ? rate : tg.growthEma * 0.85 + rate * 0.15;
      if (
        Number.isFinite(live.gold) &&
        prev.gold != null &&
        Number.isFinite(prev.gold)
      ) {
        const goldRate =
          ((live.gold - prev.gold) / (tick - prev.tick)) * TICKS_PER_SEC;
        // Ignore huge one-tick jumps (conquest loot) for the income estimate.
        if (goldRate >= 0 && goldRate < 1e6) {
          tg.goldEma =
            tg.goldEma == null ? goldRate : tg.goldEma * 0.9 + goldRate * 0.1;
        }
      }
    }
    const pot = max > 0 ? troopInc(actual, max) * TICKS_PER_SEC : null;

    tg.samples.push({
      tick,
      actual,
      effective: actual + inFlight,
      inFlight,
      max,
      rate: tg.growthEma,
      pot,
      gold: live.gold,
      nCity: live.nCity,
      nPort: live.nPort,
      nFactory: live.nFactory,
      nWarship: live.nWarship,
      nDefensePost: live.nDefensePost,
      nSam: live.nSam,
    });
    if (tg.samples.length > HISTORY_MAX_TICKS) {
      tg.samples.splice(0, tg.samples.length - HISTORY_MAX_TICKS);
    }

    render();
  }

  function onOwnIntent(intent) {
    if (!intent || !SPEND_INTENT_TYPES.has(intent.type)) return;
    if (state.gamePhase !== "playing") return;
    tg.pendingSpendUntilTick = tg.lastGameTick + SPEND_PENDING_TICKS;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function fmt(n) {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + "K";
    return String(Math.round(n));
  }

  function fmtSigned(n) {
    if (!Number.isFinite(n)) return "—";
    return (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
  }

  function capZone(pct) {
    for (const zone of CAP_ZONES) {
      if (zone.test(pct)) return zone;
    }
    return CAP_ZONES[CAP_ZONES.length - 1];
  }

  // ---------------------------------------------------------------------------
  // Panel DOM
  // ---------------------------------------------------------------------------

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
      "display:flex;align-items:center;gap:8px;padding:6px 8px 2px;cursor:move;font-weight:600";
    panel.appendChild(header);

    const subline = document.createElement("div");
    subline.style.cssText = "padding:0 8px 4px;color:#94a3b8";
    panel.appendChild(subline);

    const canvas = document.createElement("canvas");
    canvas.style.cssText = `display:block;width:100%;height:${MAIN_H}px;padding:0 4px 0;box-sizing:border-box`;
    panel.appendChild(canvas);

    const rateLabel = document.createElement("div");
    rateLabel.style.cssText =
      "padding:3px 8px 0;color:#94a3b8;font-size:10px";
    rateLabel.innerHTML =
      `growth rate /s &nbsp;·&nbsp; <span style="color:${COLOR_ACTUAL}">net</span>` +
      ` <span style="color:${COLOR_POTENTIAL}">potential</span>` +
      ` <span style="color:#f87171">drain</span>`;
    panel.appendChild(rateLabel);

    const rateCanvas = document.createElement("canvas");
    rateCanvas.style.cssText = `display:block;width:100%;height:${RATE_H}px;padding:0 4px 2px;box-sizing:border-box`;
    panel.appendChild(rateCanvas);

    const advisor = document.createElement("div");
    advisor.style.cssText =
      "border-top:1px solid rgba(148,163,184,0.25);margin-top:2px;padding:4px 8px 2px;font-size:10.5px;line-height:1.5";
    panel.appendChild(advisor);

    const footer = document.createElement("div");
    footer.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:2px 8px 6px;color:#94a3b8";

    const legend = document.createElement("span");
    legend.innerHTML =
      `<span style='color:${COLOR_ACTUAL}'>— pool</span> ` +
      `<span style='color:${COLOR_EFFECTIVE}'>— +in-flight</span> ` +
      `<span style='color:${COLOR_CF}'>-- no-click</span> ` +
      `<span style='color:#64748b'>·· proj</span>`;
    footer.appendChild(legend);

    const spacer = document.createElement("span");
    spacer.style.cssText = "flex:1";
    footer.appendChild(spacer);

    const horizonBtn = document.createElement("button");
    horizonBtn.style.cssText =
      "background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.3);color:#cbd5e1;border-radius:5px;padding:1px 7px;cursor:pointer;font:10px system-ui";
    horizonBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      tg.horizonIdx = (tg.horizonIdx + 1) % HORIZONS_SEC.length;
      try {
        localStorage.setItem(HORIZON_KEY, String(tg.horizonIdx));
      } catch (_) {}
      render();
    });
    footer.appendChild(horizonBtn);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "background:none;border:none;color:#94a3b8;cursor:pointer;font:14px system-ui;padding:0 2px;line-height:1";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setVisible(false);
    });
    footer.appendChild(closeBtn);

    panel.appendChild(footer);

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
    tg.subline = subline;
    tg.canvas = canvas;
    tg.rateCanvas = rateCanvas;
    tg.advisor = advisor;
    tg.horizonBtn = horizonBtn;
    return panel;
  }

  function setVisible(visible) {
    tg.visible = Boolean(visible);
    try {
      localStorage.setItem(VISIBLE_KEY, tg.visible ? "1" : "0");
    } catch (_) {}
    if (tg.panel) {
      tg.panel.style.display =
        tg.visible && state.gamePhase === "playing" ? "block" : "none";
    }
    if (tg.visible) render();
  }

  fn.toggleTroopGraph = () => {
    ensurePanel();
    setVisible(!tg.visible);
    if (fn.pushBottomRightLog) {
      fn.pushBottomRightLog(
        tg.visible ? "Troop graph shown." : "Troop graph hidden.",
      );
    }
  };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function setupCanvas(canvas, cssHeight) {
    const cssWidth = canvas.clientWidth || PANEL_W - 8;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssWidth * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    return { ctx, w: cssWidth, h: cssHeight };
  }

  function drawSeries(ctx, points, color, dash, width = 1.6) {
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function render() {
    if (!tg.visible || state.gamePhase !== "playing") {
      if (tg.panel) tg.panel.style.display = "none";
      return;
    }
    if (!document.body) return;
    const panel = ensurePanel();
    panel.style.display = "block";

    const last = tg.samples.length ? tg.samples[tg.samples.length - 1] : null;
    const horizonSec = HORIZONS_SEC[tg.horizonIdx] || 60;
    tg.horizonBtn.textContent = "±" + horizonSec + "s";

    // Header: troops (+in-flight), growth/sec, % of cap by zone.
    const growth = tg.growthEma;
    const growthColor =
      growth == null ? "#94a3b8" : growth >= 0 ? COLOR_ACTUAL : COLOR_SPEND;
    let capHtml = "";
    if (last && last.max > 0) {
      const pct = (last.actual / last.max) * 100;
      const zone = capZone(pct);
      capHtml = `<span style="color:${zone.color}">${pct.toFixed(0)}%</span>`;
    }
    const flightHtml =
      last && last.inFlight > 0
        ? ` <span style="color:${COLOR_EFFECTIVE};font-weight:400">(+${fmt(last.inFlight)}✈)</span>`
        : "";
    tg.header.innerHTML =
      `<span style="flex:1">Troops ${last ? fmt(last.actual) : "—"}${flightHtml}</span>` +
      `<span style="color:${growthColor}">${growth == null ? "" : fmtSigned(growth) + "/s"}</span>` +
      `<span style="font-weight:400">${capHtml}</span>`;

    // Subline: newest counterfactual — cost, gap now, break-even.
    if (last && tg.cfs.length && last.max > 0) {
      const cf = tg.cfs[tg.cfs.length - 1];
      const gapNow = cf.v - last.actual;
      const be = breakEvenTicks(
        last.actual,
        last.max,
        cf.v,
        cf.max,
        BREAK_EVEN_MAX_TICKS,
      );
      const beHtml =
        be == null
          ? `<span style="color:${COLOR_SPEND}">no break-even &lt;10m</span>`
          : `breaks even in <span style="color:${COLOR_ACTUAL}">${fmtMinSec(be)}</span>`;
      const others = tg.cfs.length > 1 ? ` · +${tg.cfs.length - 1} older` : "";
      tg.subline.innerHTML =
        `last click −${fmt(cf.amount)} (${fmtMinSec(tg.lastGameTick - cf.tick)} ago): ` +
        `<span style="color:${COLOR_CF}">${fmtSigned(-gapNow)}</span> vs no-click · ${beHtml}${others}`;
    } else {
      tg.subline.textContent = "no outstanding spends — on trajectory";
    }

    drawMainChart(horizonSec);
    drawRateChart(horizonSec);
    renderAdvisor(last);
  }

  // ---------------------------------------------------------------------------
  // Advisor: optimal-band cue + build what-ifs (see research/STRATEGY_NOTES.md)
  // ---------------------------------------------------------------------------

  const OPTIMUM_FRACTION = 0.42; // regen-maximizing pool fraction (wiki-derived)

  function affordHtml(cost, gold, goldRate) {
    if (cost == null) return "";
    if (gold != null && gold >= cost) {
      return `<span style="color:${COLOR_ACTUAL}">now</span>`;
    }
    if (gold != null && goldRate > 0) {
      const sec = (cost - gold) / goldRate;
      if (sec < 3600) return `in ${fmtMinSec(sec * TICKS_PER_SEC)}`;
    }
    return `<span style="color:#64748b">—</span>`;
  }

  function advisorRow(name, cost, gold, goldRate, effectHtml) {
    const costHtml =
      cost == null ? "?" : `<span style="color:#cbd5e1">${fmt(cost)}</span>`;
    return (
      `<div style="display:flex;gap:6px;align-items:baseline">` +
      `<span style="width:52px;color:#e2e8f0">${name}</span>` +
      `<span style="width:74px">${costHtml} · ${affordHtml(cost, gold, goldRate)}</span>` +
      `<span style="flex:1;color:#94a3b8">${effectHtml}</span></div>`
    );
  }

  function renderAdvisor(last) {
    if (!tg.advisor) return;
    if (!last || !(last.max > 0)) {
      tg.advisor.innerHTML = "";
      return;
    }
    const me = getMyPlayerView();
    const gold = last.gold;
    const goldRate = tg.goldEma;
    const parts = [];

    // Gold status line.
    const goldHtml =
      gold == null
        ? ""
        : `<span style="color:#fde68a">⛁ ${fmt(gold)}</span>` +
          (goldRate != null
            ? ` <span style="color:#94a3b8">+${fmt(goldRate)}/s</span>`
            : "");

    // 42% optimum cue.
    const optimum = OPTIMUM_FRACTION * last.max;
    const frac = last.actual / last.max;
    let cue;
    if (frac > 0.52) {
      cue =
        `over the 42% growth peak — spending ` +
        `<b style="color:${COLOR_ACTUAL}">${fmt(last.actual - optimum)}</b> is nearly free`;
    } else if (frac >= 0.32) {
      cue = `in the growth sweet spot (peak 42%)`;
    } else {
      const ticksToOpt = (() => {
        let t = last.actual;
        for (let i = 1; i <= BREAK_EVEN_MAX_TICKS; i++) {
          t += troopInc(t, last.max);
          if (t >= optimum) return i;
        }
        return null;
      })();
      cue =
        `below the 42% peak — big spends are expensive` +
        (ticksToOpt ? `; peak regen in ${fmtMinSec(ticksToOpt)}` : "");
    }
    parts.push(
      `<div style="display:flex;gap:8px"><span style="flex:1;color:#94a3b8">${cue}</span>${goldHtml}</div>`,
    );

    // City: exact cap/regen effect.
    const cityCost = unitCost("City", last, me);
    const capBonus = readCityCapBonus();
    const dRegen =
      (troopInc(last.actual, last.max + capBonus) -
        troopInc(last.actual, last.max)) *
      TICKS_PER_SEC;
    parts.push(
      advisorRow(
        `City<span style="color:#64748b">×${last.nCity ?? 0}</span>`,
        cityCost,
        gold,
        goldRate,
        `+${fmt(capBonus)} cap → regen <b style="color:${COLOR_ACTUAL}">+${fmt(dRegen)}/s</b> now`,
      ),
    );

    // Port: trade income (shared price counter with Factory).
    const portCost = unitCost("Port", last, me);
    parts.push(
      advisorRow(
        `Port<span style="color:#64748b">×${last.nPort ?? 0}</span>`,
        portCost,
        gold,
        goldRate,
        `trade ships ≈75–125K+/route each way; more ports → more ships`,
      ),
    );

    // Factory: expected trains delta from the spawn formula.
    const factoryCost = unitCost("Factory", last, me);
    const n = last.nFactory ?? 0;
    const dTrains = trainsPerMin(n + 1) - trainsPerMin(n);
    parts.push(
      advisorRow(
        `Fctry<span style="color:#64748b">×${n}</span>`,
        factoryCost,
        gold,
        goldRate,
        `+${dTrains.toFixed(1)} trains/min × 10–35K/stop (needs rail links)`,
      ),
    );

    // Compact cost strip for the rest.
    const strip = [
      ["War", unitCost("Warship", last, me)],
      ["DP", unitCost("Defense Post", last, me)],
      ["SAM", unitCost("SAM Launcher", last, me)],
      ["Silo", unitCost("Missile Silo", last, me)],
    ]
      .map(([label, cost]) => {
        const ok = cost != null && gold != null && gold >= cost;
        const color = ok ? "#cbd5e1" : "#64748b";
        return `<span style="color:${color}">${label} ${cost == null ? "?" : fmt(cost)}</span>`;
      })
      .join(" · ");
    parts.push(
      `<div style="color:#64748b;font-size:10px;padding-top:1px">${strip}</div>`,
    );

    tg.advisor.innerHTML = parts.join("");
  }

  function drawMainChart(horizonSec) {
    const surface = tg.canvas ? setupCanvas(tg.canvas, MAIN_H) : null;
    if (!surface) return;
    const { ctx, w, h } = surface;

    const last = tg.samples.length ? tg.samples[tg.samples.length - 1] : null;
    if (!last) return;

    const horizonTicks = horizonSec * TICKS_PER_SEC;
    const startTick = last.tick - horizonTicks;
    const endTick = last.tick + horizonTicks;

    const projActual =
      last.max > 0 ? projectTrajectory(last.actual, last.max, horizonTicks) : null;
    const cfProjections = tg.cfs.map((cf) =>
      projectTrajectory(cf.v, cf.max, horizonTicks),
    );

    let yMin = Infinity;
    let yMax = -Infinity;
    const consider = (v) => {
      if (!Number.isFinite(v)) return;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    };
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      consider(s.actual);
      if (s.effective > s.actual) consider(s.effective);
    }
    for (const cf of tg.cfs) consider(cf.v);
    if (projActual) consider(projActual[projActual.length - 1]);
    for (const proj of cfProjections) consider(proj[proj.length - 1]);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
    if (yMax - yMin < 20) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - 10;
      yMax = mid + 10;
    }
    const yPad = (yMax - yMin) * 0.1;
    yMin = Math.max(0, yMin - yPad);
    yMax += yPad;

    const padL = 4;
    const padR = 34;
    const padT = 4;
    const padB = 12;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const xOf = (tick) =>
      padL + ((tick - startTick) / (endTick - startTick)) * plotW;
    const yOf = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    ctx.fillStyle = "#7c8aa0";
    ctx.font = "9px system-ui";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const v = yMin + ((yMax - yMin) * i) / 3;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(fmt(v), padL + plotW + 3, y);
    }

    if (last.max > 0 && last.max <= yMax) {
      const y = yOf(last.max);
      ctx.strokeStyle = "rgba(148,163,184,0.5)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const nowX = xOf(last.tick);
    ctx.strokeStyle = "rgba(226,232,240,0.35)";
    ctx.beginPath();
    ctx.moveTo(nowX, padT);
    ctx.lineTo(nowX, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "#7c8aa0";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("now", nowX - 9, h - 2);

    // Counterfactual histories + projections (older = fainter).
    tg.cfs.forEach((cf, i) => {
      const age = tg.cfs.length - 1 - i; // 0 = newest
      const alpha = Math.max(0.25, 1 - age * 0.25);
      const color = `rgba(251,191,36,${alpha})`;
      const pts = [];
      for (const [t, v] of cf.hist) {
        if (t < startTick) continue;
        pts.push([xOf(t), yOf(v)]);
      }
      drawSeries(ctx, pts, color, [4, 3]);
      const proj = cfProjections[i];
      if (proj) {
        const ppts = [];
        for (let k = 0; k < proj.length; k += 5) {
          ppts.push([xOf(last.tick + k), yOf(proj[k])]);
        }
        drawSeries(ctx, ppts, `rgba(251,191,36,${alpha * 0.7})`, [1.5, 3]);
      }
    });

    // Effective (pool + in-flight): draw only where it exceeds the pool.
    let seg = [];
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      if (s.effective > s.actual + 1) {
        seg.push([xOf(s.tick), yOf(s.effective)]);
      } else if (seg.length) {
        drawSeries(ctx, seg, COLOR_EFFECTIVE, [], 1.1);
        seg = [];
      }
    }
    drawSeries(ctx, seg, COLOR_EFFECTIVE, [], 1.1);

    // Actual pool history + projection.
    const actualPts = [];
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      actualPts.push([xOf(s.tick), yOf(s.actual)]);
    }
    drawSeries(ctx, actualPts, COLOR_ACTUAL, []);
    if (projActual) {
      const pts = [];
      for (let k = 0; k < projActual.length; k += 5) {
        pts.push([xOf(last.tick + k), yOf(projActual[k])]);
      }
      drawSeries(ctx, pts, "rgba(110,231,168,0.7)", [1.5, 3]);
    }

    // Spend markers.
    ctx.fillStyle = COLOR_SPEND;
    for (const ev of tg.spendEvents) {
      if (ev.tick < startTick || ev.tick > last.tick) continue;
      const x = xOf(ev.tick);
      ctx.beginPath();
      ctx.moveTo(x - 3, padT + plotH);
      ctx.lineTo(x + 3, padT + plotH);
      ctx.lineTo(x, padT + plotH - 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawRateChart(horizonSec) {
    const surface = tg.rateCanvas ? setupCanvas(tg.rateCanvas, RATE_H) : null;
    if (!surface) return;
    const { ctx, w, h } = surface;

    const last = tg.samples.length ? tg.samples[tg.samples.length - 1] : null;
    if (!last) return;

    const horizonTicks = horizonSec * TICKS_PER_SEC;
    const startTick = last.tick - horizonTicks;
    const endTick = last.tick + horizonTicks;

    // Projected rate: derivative of the pure-regen projection (drain-free).
    const projActual =
      last.max > 0 ? projectTrajectory(last.actual, last.max, horizonTicks) : null;

    let yMin = 0;
    let yMax = -Infinity;
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      if (Number.isFinite(s.rate)) {
        if (s.rate > yMax) yMax = s.rate;
        if (s.rate < yMin) yMin = s.rate;
      }
      if (Number.isFinite(s.pot) && s.pot > yMax) yMax = s.pot;
    }
    if (projActual) {
      for (let k = 5; k < projActual.length; k += 5) {
        const r = (projActual[k] - projActual[k - 5]) * 2; // per sec
        if (r > yMax) yMax = r;
      }
    }
    if (!Number.isFinite(yMax) || yMax <= yMin) yMax = yMin + 10;
    const span = yMax - yMin;
    yMax += span * 0.12;
    if (yMin < 0) yMin -= span * 0.08;

    const padL = 4;
    const padR = 34;
    const padT = 3;
    const padB = 3;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const xOf = (tick) =>
      padL + ((tick - startTick) / (endTick - startTick)) * plotW;
    const yOf = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    ctx.fillStyle = "#7c8aa0";
    ctx.font = "9px system-ui";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i++) {
      const v = yMin + ((yMax - yMin) * i) / 2;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(fmt(v), padL + plotW + 3, y);
    }

    // Zero line (visible when negative rates in view).
    if (yMin < 0) {
      const y = yOf(0);
      ctx.strokeStyle = "rgba(226,232,240,0.3)";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }

    // Drain fill: area between potential and net where net < potential.
    ctx.fillStyle = COLOR_DRAIN;
    let region = null;
    const flushRegion = () => {
      if (!region || region.top.length < 2) {
        region = null;
        return;
      }
      ctx.beginPath();
      ctx.moveTo(region.top[0][0], region.top[0][1]);
      for (let i = 1; i < region.top.length; i++) {
        ctx.lineTo(region.top[i][0], region.top[i][1]);
      }
      for (let i = region.bottom.length - 1; i >= 0; i--) {
        ctx.lineTo(region.bottom[i][0], region.bottom[i][1]);
      }
      ctx.closePath();
      ctx.fill();
      region = null;
    };
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      const drainVisible =
        Number.isFinite(s.rate) && Number.isFinite(s.pot) && s.pot > s.rate + 5;
      if (drainVisible) {
        if (!region) region = { top: [], bottom: [] };
        region.top.push([xOf(s.tick), yOf(s.pot)]);
        region.bottom.push([xOf(s.tick), yOf(Math.max(s.rate, yMin))]);
      } else {
        flushRegion();
      }
    }
    flushRegion();

    // Potential regen rate (grey) and net rate (green).
    const potPts = [];
    const netPts = [];
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      if (Number.isFinite(s.pot)) potPts.push([xOf(s.tick), yOf(s.pot)]);
      if (Number.isFinite(s.rate)) netPts.push([xOf(s.tick), yOf(s.rate)]);
    }
    drawSeries(ctx, potPts, "rgba(148,163,184,0.8)", [], 1.1);
    drawSeries(ctx, netPts, COLOR_ACTUAL, [], 1.4);

    // Projected drain-free rate.
    if (projActual) {
      const pts = [];
      for (let k = 5; k < projActual.length; k += 5) {
        const r = (projActual[k] - projActual[k - 5]) * 2;
        pts.push([xOf(last.tick + k), yOf(r)]);
      }
      drawSeries(ctx, pts, "rgba(148,163,184,0.6)", [1.5, 3], 1.1);
    }

    // Now line + spend markers.
    const nowX = xOf(last.tick);
    ctx.strokeStyle = "rgba(226,232,240,0.35)";
    ctx.beginPath();
    ctx.moveTo(nowX, padT);
    ctx.lineTo(nowX, padT + plotH);
    ctx.stroke();

    ctx.fillStyle = COLOR_SPEND;
    for (const ev of tg.spendEvents) {
      if (ev.tick < startTick || ev.tick > last.tick) continue;
      const x = xOf(ev.tick);
      ctx.fillRect(x - 0.5, padT, 1, plotH);
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  fn.initTroopGraph = () => {
    if (tg.initialized) return;
    tg.initialized = true;

    try {
      tg.visible = localStorage.getItem(VISIBLE_KEY) !== "0";
    } catch (_) {}
    try {
      const idx = Number(localStorage.getItem(HORIZON_KEY));
      if (Number.isFinite(idx) && idx >= 0 && idx < HORIZONS_SEC.length) {
        tg.horizonIdx = idx;
      }
    } catch (_) {}

    if (fn.onGameTick) fn.onGameTick(onTick);
    if (fn.onOwnIntent) fn.onOwnIntent(onOwnIntent);
    if (fn.onGamePhaseChange) {
      fn.onGamePhaseChange((oldPhase, newPhase) => {
        if (newPhase === "spawn" || newPhase === "none") resetForNewGame();
        if (tg.panel) {
          tg.panel.style.display =
            tg.visible && newPhase === "playing" ? "block" : "none";
        }
      });
    }
  };
})();
