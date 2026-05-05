/**
 * OpenFront Enhanced — Content Script (runs in ISOLATED world)
 *
 * During spawn phase: adds highly visible markers on every nation so you can
 * see them from any zoom level when picking a start location. Removed when
 * the game starts.
 *
 * Reads data from attributes on <html> set by page-hook.js (MAIN world):
 *   - data-ofe-game-phase: current game phase from the live GameView
 *   - data-ofe-nations: nation positions for spawn dots
 */

"use strict";

(() => {
  let watchInterval = null;
  let spawnActive = false;
  let dotContainer = null;
  let cachedNameLayerContainer = null;
  let gameDataObserver = null;
  const markerById = new Map();
  const MARKER_SIZE = 24;
  const MARKER_TARGET_SCREEN_SIZE = 24;
  const MARKER_MIN_SCALE = 0.03;
  const MARKER_MAX_SCALE = 1.15;
  const MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='none' stroke='#111827' stroke-width='12' opacity='0.75'/>" +
        "<circle cx='50' cy='50' r='31' fill='none' stroke='#ffffff' stroke-width='8'/>" +
        "<circle cx='50' cy='50' r='20' fill='none' stroke='#ef4444' stroke-width='10'/>" +
        "<circle cx='50' cy='50' r='7' fill='#ef4444'/>" +
      "</svg>",
    );

  function getNationPositions() {
    try {
      const raw = document.documentElement.getAttribute("data-ofe-nations");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getNameLayerContainer() {
    if (
      cachedNameLayerContainer &&
      document.contains(cachedNameLayerContainer) &&
      cachedNameLayerContainer.style &&
      cachedNameLayerContainer.style.left === "50%" &&
      cachedNameLayerContainer.style.top === "50%" &&
      cachedNameLayerContainer.style.zIndex === "2"
    ) {
      return cachedNameLayerContainer;
    }

    // Match the container by its structural CSS properties set in NameLayer.init():
    // position: fixed, left: 50%, top: 50%, pointer-events: none, z-index: 2
    const divs = document.querySelectorAll("div[style*='position: fixed']");
    for (const div of divs) {
      if (
        div.style.left === "50%" &&
        div.style.top === "50%" &&
        div.style.zIndex === "2" &&
        div.style.pointerEvents === "none"
      ) {
        cachedNameLayerContainer = div;
        return div;
      }
    }
    cachedNameLayerContainer = null;
    return null;
  }

  function extractScaleFromTransform(tf) {
    if (!tf || tf === "none") return 1;

    if (tf.startsWith("matrix3d(")) {
      const values = tf.slice(9, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 16 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    if (tf.startsWith("matrix(")) {
      const values = tf.slice(7, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 6 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    const sMatch = tf.match(/scale\(\s*([-\d.]+)\s*\)/);
    if (sMatch) {
      const s = Number(sMatch[1]);
      return Number.isFinite(s) && s > 0 ? s : 1;
    }

    return 1;
  }

  function isSpawnPhase() {
    return document.documentElement.getAttribute("data-ofe-game-phase") === "spawn";
  }

  function ensureDotContainer() {
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) return false;

    if (dotContainer && nameLayerContainer.contains(dotContainer)) return true;
    if (dotContainer) dotContainer.remove();

    dotContainer = document.createElement("div");
    dotContainer.id = "ofe-dot-container";
    dotContainer.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;z-index:4;" +
      "--ofe-marker-scale:1;";
    nameLayerContainer.appendChild(dotContainer);
    return true;
  }

  function updateMarkerScale() {
    if (!spawnActive || !dotContainer) return;
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) return;
    const tf = nameLayerContainer.style.transform || getComputedStyle(nameLayerContainer).transform;
    const zoomScale = Math.max(0.0001, extractScaleFromTransform(tf));
    const highZoomTarget =
      zoomScale > 8 ? MARKER_TARGET_SCREEN_SIZE * 0.72 : MARKER_TARGET_SCREEN_SIZE;
    const desiredScale = highZoomTarget / (MARKER_SIZE * zoomScale);
    const clampedScale = Math.max(MARKER_MIN_SCALE, Math.min(MARKER_MAX_SCALE, desiredScale));
    const next = clampedScale.toFixed(4);
    if (dotContainer.style.getPropertyValue("--ofe-marker-scale") !== next) {
      dotContainer.style.setProperty("--ofe-marker-scale", next);
    }
  }

  function clearMarkers() {
    markerById.clear();
    if (dotContainer) {
      dotContainer.remove();
      dotContainer = null;
    }
  }

  function getOrCreateMarker(markerId) {
    let marker = markerById.get(markerId);
    if (marker && dotContainer && dotContainer.contains(marker)) return marker;

    marker = document.createElement("div");
    marker.id = markerId;
    marker.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;" +
      `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;` +
      "background-repeat:no-repeat;background-size:contain;background-position:center;" +
      "filter:drop-shadow(0 0 6px rgba(239,68,68,0.55));" +
      `background-image:url(\"${MARKER_SVG_DATA_URI}\");`;

    markerById.set(markerId, marker);
    dotContainer.appendChild(marker);
    return marker;
  }

  function updateSpawnDots() {
    if (!spawnActive) return;
    if (!ensureDotContainer()) return;

    const nations = getNationPositions();
    const usedDots = new Set();

    for (const pid in nations) {
      const pos = nations[pid];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-dot-${pid}`;
      const marker = getOrCreateMarker(markerId);
      marker.style.transform =
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`;

      usedDots.add(markerId);
    }

    for (const [id, marker] of markerById.entries()) {
      if (!usedDots.has(id)) {
        marker.remove();
        markerById.delete(id);
      }
    }
  }

  function initGameDataObserver() {
    if (gameDataObserver) return;
    gameDataObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;
        if (mutation.attributeName === "data-ofe-game-phase") {
          syncSpawnState();
          return;
        }
        if (mutation.attributeName === "data-ofe-nations") {
          if (spawnActive) updateSpawnDots();
          return;
        }
      }
    });
    gameDataObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-ofe-game-phase", "data-ofe-nations"],
    });
  }

  function syncSpawnState() {
    const spawning = isSpawnPhase();
    if (spawning === spawnActive) return;

    spawnActive = spawning;
    if (spawnActive) {
      updateSpawnDots();
      updateMarkerScale();
      return;
    }

    clearMarkers();
  }

  function init() {
    if (watchInterval) return;
    initGameDataObserver();
    watchInterval = setInterval(() => {
      syncSpawnState();
      if (spawnActive) {
        if (!dotContainer || !document.contains(dotContainer)) {
          updateSpawnDots();
        }
        updateMarkerScale();
      }
    }, 120);
    syncSpawnState();
  }

  function waitForCanvas() {
    if (document.querySelector("canvas")) {
      init();
      return;
    }
    const target = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      if (document.querySelector("canvas")) {
        observer.disconnect();
        init();
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForCanvas);
  } else {
    waitForCanvas();
  }
})();
