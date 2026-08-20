"use strict";

/**
 * Troop Graph — top-right trajectory panel.
 *
 * Shows troop history, current growth rate (first derivative), and two
 * forward projections simulated with the game's exact regen formula:
 *   - where your troops are headed NOW, and
 *   - the counterfactual trajectory you were on before your LAST
 *     troop-spending click (attack / boat / donation), i.e. "one click back".
 *
 * Info-only: reads game state, never sends intents or takes actions.
 *
 * Regen formula (OpenFrontIO src/core/configuration/Config.ts, Human player,
 * applied every tick at 10 ticks/sec):
 *   maxTroops = 2 * (tiles^0.6 * 1000 + 50000) + sum(cityLevels) * 250000
 *   inc = (10 + troops^0.73 / 4) * (1 - troops / max), clamped to max
 */

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  const TICKS_PER_SEC = 10;
  const HISTORY_MAX_TICKS = 6 * 60 * TICKS_PER_SEC;
  const SPEND_INTENT_TYPES = new Set(["attack", "boat", "donate_troops"]);
  // An own spend intent arms rebase detection for this many ticks.
  const SPEND_PENDING_TICKS = 25;
  const HORIZONS_SEC = [30, 60, 120, 300];
  const VISIBLE_KEY = "ofe.troopgraph.visible";
  const POS_KEY = "ofe.troopgraph.pos";
  const HORIZON_KEY = "ofe.troopgraph.horizon";
  const PANEL_W = 300;
  const CANVAS_H = 150;

  // Growth-zone coloring for troops as % of cap (income rate is fastest
  // mid-range; matches the community control-panel-enhancement thresholds).
  const CAP_ZONES = [
    { test: (p) => p < 9 || p > 82, color: "#f87171", label: "critical" },
    { test: (p) => p < 18 || p > 70, color: "#fb923c", label: "warning" },
    { test: (p) => p < 23 || p > 64, color: "#eab308", label: "caution" },
    { test: (p) => p < 31 || p > 54, color: "#22c55e", label: "good" },
    { test: () => true, color: "#22d3ee", label: "excellent" },
  ];

  const tg = (state.troopGraphState = state.troopGraphState || {
    samples: [], // {tick, actual, cf, max}
    cfTroops: null,
    pendingSpendUntilTick: -1,
    spendEvents: [], // {tick, amount}
    lastSpendAmount: 0,
    growthEma: null, // troops per second, smoothed
    horizonIdx: 1,
    panel: null,
    canvas: null,
    header: null,
    subline: null,
    visible: true,
    initialized: false,
    lastGameTick: -1,
  });

  // ---------------------------------------------------------------------------
  // Pure math (also exposed for tests via fn._troopGraphMath)
  // ---------------------------------------------------------------------------

  function troopInc(troops, max) {
    if (!(max > 0) || !(troops >= 0)) return 0;
    let toAdd = 10 + Math.pow(troops, 0.73) / 4;
    toAdd *= 1 - troops / max;
    return Math.min(troops + toAdd, max) - troops;
  }

  // Simulate `ticks` ticks of pure regen from `troops` with cap `max`.
  // Returns an array of length ticks+1 including the starting value.
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

  fn._troopGraphMath = { troopInc, projectTrajectory };

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
    // Preferred: the game's own config (exact, includes game modifiers).
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

    // Fallback: recompute from the published formula.
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

  function readSample() {
    const me = getMyPlayerView();
    if (!me) return null;
    let actual = null;
    try {
      actual = Number(me.troops());
    } catch (_) {}
    if (!Number.isFinite(actual)) {
      actual = Number(state.myPlayerTroops);
    }
    if (!Number.isFinite(actual) || actual < 0) return null;
    return { actual, max: readMaxTroops(me) };
  }

  // ---------------------------------------------------------------------------
  // Per-tick update
  // ---------------------------------------------------------------------------

  function resetForNewGame() {
    tg.samples.length = 0;
    tg.cfTroops = null;
    tg.pendingSpendUntilTick = -1;
    tg.spendEvents.length = 0;
    tg.lastSpendAmount = 0;
    tg.growthEma = null;
    tg.lastGameTick = -1;
  }

  function onTick(gu) {
    const tick = Number(gu && gu.tick);
    if (!Number.isFinite(tick)) return;
    if (tick < tg.lastGameTick - 5) resetForNewGame();
    tg.lastGameTick = tick;

    if (state.gamePhase !== "playing") return;

    const live = readSample();
    if (!live) return;
    const { actual, max } = live;

    const prev = tg.samples.length
      ? tg.samples[tg.samples.length - 1]
      : null;

    // --- counterfactual evolution ---
    if (tg.cfTroops == null) {
      tg.cfTroops = actual;
    } else if (max > 0) {
      tg.cfTroops += troopInc(tg.cfTroops, max);
      if (tg.cfTroops > max) tg.cfTroops = max;
    }

    // --- own-click spend detection → rebase counterfactual ---
    if (prev && tick <= tg.pendingSpendUntilTick) {
      const expected = max > 0 ? troopInc(prev.actual, max) : 0;
      const delta = actual - prev.actual;
      const drop = expected - delta;
      if (delta < 0 && drop > Math.max(50, expected * 2)) {
        // The trajectory you were on before this click continues from the
        // pre-drop value (one regen step forward to stay in sync with now).
        tg.cfTroops =
          prev.actual + (max > 0 ? troopInc(prev.actual, max) : 0);
        tg.spendEvents.push({ tick, amount: drop });
        tg.lastSpendAmount = drop;
        if (tg.spendEvents.length > 40) tg.spendEvents.shift();
        tg.pendingSpendUntilTick = -1;
      }
    }

    // Converged: you're back on (or above) the old trajectory.
    if (tg.cfTroops <= actual) tg.cfTroops = actual;

    // --- derivative (troops/sec, EMA-smoothed) ---
    if (prev && tick > prev.tick) {
      const perSec =
        ((actual - prev.actual) / (tick - prev.tick)) * TICKS_PER_SEC;
      tg.growthEma =
        tg.growthEma == null ? perSec : tg.growthEma * 0.85 + perSec * 0.15;
    }

    tg.samples.push({ tick, actual, cf: tg.cfTroops, max });
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
    canvas.style.cssText = `display:block;width:100%;height:${CANVAS_H}px;padding:0 4px 2px;box-sizing:border-box`;
    panel.appendChild(canvas);

    const footer = document.createElement("div");
    footer.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:2px 8px 6px;color:#94a3b8";

    const legend = document.createElement("span");
    legend.innerHTML =
      "<span style='color:#6ee7a8'>— now</span> " +
      "<span style='color:#fbbf24'>-- one click back</span> " +
      "<span style='color:#64748b'>·· projected</span>";
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

    // Dragging (header only).
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

  function render() {
    if (!tg.visible || state.gamePhase !== "playing") {
      if (tg.panel) tg.panel.style.display = "none";
      return;
    }
    if (!document.body) return;
    const panel = ensurePanel();
    panel.style.display = "block";

    const last = tg.samples.length
      ? tg.samples[tg.samples.length - 1]
      : null;

    const horizonSec = HORIZONS_SEC[tg.horizonIdx] || 60;
    tg.horizonBtn.textContent = "±" + horizonSec + "s";

    // Header: troops, growth/sec, % of cap colored by growth zone.
    const growth = tg.growthEma;
    const growthColor =
      growth == null ? "#94a3b8" : growth >= 0 ? "#6ee7a8" : "#f87171";
    let capHtml = "";
    if (last && last.max > 0) {
      const pct = (last.actual / last.max) * 100;
      const zone = capZone(pct);
      capHtml = ` <span style="color:${zone.color}">${pct.toFixed(0)}% of cap</span>`;
    }
    tg.header.innerHTML =
      `<span style="flex:1">Troops ${last ? fmt(last.actual) : "—"}</span>` +
      `<span style="color:${growthColor}">${growth == null ? "" : fmtSigned(growth) + "/s"}</span>` +
      `<span style="color:#94a3b8;font-weight:400">${capHtml}</span>`;

    // Subline: counterfactual delta now and at horizon.
    if (last && last.cf > last.actual + 1 && last.max > 0) {
      const ticksAhead = horizonSec * TICKS_PER_SEC;
      const projActual = projectTrajectory(last.actual, last.max, ticksAhead);
      const projCf = projectTrajectory(last.cf, last.max, ticksAhead);
      const deltaNow = last.cf - last.actual;
      const deltaEnd = projCf[ticksAhead] - projActual[ticksAhead];
      tg.subline.innerHTML =
        `one click back: <span style="color:#fbbf24">${fmtSigned(deltaNow)}</span> now, ` +
        `<span style="color:#fbbf24">${fmtSigned(deltaEnd)}</span> in ${horizonSec}s`;
    } else {
      tg.subline.textContent = "no recent troop spends — on trajectory";
    }

    drawChart(horizonSec);
  }

  function drawChart(horizonSec) {
    const canvas = tg.canvas;
    if (!canvas) return;
    const cssWidth = canvas.clientWidth || PANEL_W - 8;
    const cssHeight = CANVAS_H;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssWidth * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const last = tg.samples.length
      ? tg.samples[tg.samples.length - 1]
      : null;
    if (!last) return;

    const horizonTicks = horizonSec * TICKS_PER_SEC;
    const pastTicks = horizonTicks; // symmetric window: "now" sits mid-chart
    const startTick = last.tick - pastTicks;
    const endTick = last.tick + horizonTicks;

    const projActual =
      last.max > 0
        ? projectTrajectory(last.actual, last.max, horizonTicks)
        : null;
    const projCf =
      last.max > 0 && last.cf > last.actual + 1
        ? projectTrajectory(last.cf, last.max, horizonTicks)
        : null;

    // Y domain across everything drawn.
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
      if (s.cf > s.actual) consider(s.cf);
    }
    if (projActual) {
      consider(projActual[0]);
      consider(projActual[projActual.length - 1]);
    }
    if (projCf) consider(projCf[projCf.length - 1]);
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
    const plotW = cssWidth - padL - padR;
    const plotH = cssHeight - padT - padB;
    const xOf = (tick) =>
      padL + ((tick - startTick) / (endTick - startTick)) * plotW;
    const yOf = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // Gridlines + right-edge labels.
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

    // Troop cap line, if in view.
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

    // "Now" vertical line.
    const nowX = xOf(last.tick);
    ctx.strokeStyle = "rgba(226,232,240,0.35)";
    ctx.beginPath();
    ctx.moveTo(nowX, padT);
    ctx.lineTo(nowX, padT + plotH);
    ctx.stroke();
    ctx.fillStyle = "#7c8aa0";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("now", nowX - 9, cssHeight - 2);

    const drawSeries = (points, color, dash) => {
      if (!points.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (const [x, y] of points) {
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Counterfactual history (only where it diverges).
    const cfPts = [];
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      if (s.cf > s.actual + 1) cfPts.push([xOf(s.tick), yOf(s.cf)]);
      else if (cfPts.length && cfPts[cfPts.length - 1] !== null) {
        cfPts.push(null);
      }
    }
    // Split on gaps.
    let seg = [];
    for (const p of cfPts) {
      if (p === null) {
        drawSeries(seg, "#fbbf24", [4, 3]);
        seg = [];
      } else {
        seg.push(p);
      }
    }
    drawSeries(seg, "#fbbf24", [4, 3]);

    // Actual history.
    const actualPts = [];
    for (const s of tg.samples) {
      if (s.tick < startTick) continue;
      actualPts.push([xOf(s.tick), yOf(s.actual)]);
    }
    drawSeries(actualPts, "#6ee7a8", []);

    // Projections (sampled every 5 ticks to keep point counts small).
    if (projActual) {
      const pts = [];
      for (let i = 0; i < projActual.length; i += 5) {
        pts.push([xOf(last.tick + i), yOf(projActual[i])]);
      }
      drawSeries(pts, "rgba(110,231,168,0.7)", [1.5, 3]);
    }
    if (projCf) {
      const pts = [];
      for (let i = 0; i < projCf.length; i += 5) {
        pts.push([xOf(last.tick + i), yOf(projCf[i])]);
      }
      drawSeries(pts, "rgba(251,191,36,0.7)", [1.5, 3]);
    }

    // Spend-event markers.
    ctx.fillStyle = "#f87171";
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
