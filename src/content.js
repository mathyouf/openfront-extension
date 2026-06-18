/**
 * OpenFront Enhanced — Content Script (runs in ISOLATED world)
 *
 * Adds highly visible markers for nations and high-level building stacks so
 * you can see them from any zoom level.
 *
 * Reads data from attributes on <html> set by page-hook.js (MAIN world):
 *   - data-ofe-game-phase: current game phase from the live GameView
 *   - data-ofe-nations: nation positions
 *   - data-ofe-building-stacks: high-level structure positions
 *   - data-ofe-map-transform: current world-to-screen transform
 */

"use strict";

(() => {
  let watchInterval = null;
  let markersActive = false;
  let dotContainer = null;
  let cachedNameLayerContainer = null;
  let gameDataObserver = null;
  const markerById = new Map();
  const MARKER_SIZE = 24;
  const MARKER_TARGET_SCREEN_SIZE = 24;
  const MARKER_MIN_SCALE = 0.03;
  const MARKER_MAX_SCALE = 1.15;
  const NATION_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='none' stroke='#111827' stroke-width='12' opacity='0.75'/>" +
        "<circle cx='50' cy='50' r='31' fill='none' stroke='#ffffff' stroke-width='8'/>" +
        "<circle cx='50' cy='50' r='20' fill='none' stroke='#ef4444' stroke-width='10'/>" +
        "<circle cx='50' cy='50' r='7' fill='#ef4444'/>" +
      "</svg>",
    );
  const BUILDING_STACK_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<path d='M50 6 94 50 50 94 6 50Z' fill='none' stroke='#111827' stroke-width='16' stroke-linejoin='round' opacity='0.92'/>" +
        "<path d='M50 9 91 50 50 91 9 50Z' fill='none' stroke='#fef3c7' stroke-width='9' stroke-linejoin='round'/>" +
        "<path d='M50 17 83 50 50 83 17 50Z' fill='none' stroke='#f59e0b' stroke-width='8' stroke-linejoin='round'/>" +
        "<path d='M50 25 75 50 50 75 25 50Z' fill='none' stroke='#111827' stroke-width='4' stroke-linejoin='round' opacity='0.74'/>" +
      "</svg>",
    );

  function readMarkerData(attributeName) {
    try {
      const raw = document.documentElement.getAttribute(attributeName);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getNationPositions() {
    return readMarkerData("data-ofe-nations");
  }

  function getBuildingStackPositions() {
    return readMarkerData("data-ofe-building-stacks");
  }

  function getMapTransform() {
    return readMarkerData("data-ofe-map-transform");
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

  function hasActiveGamePhase() {
    const phase = document.documentElement.getAttribute("data-ofe-game-phase");
    return phase === "spawn" || phase === "playing";
  }

  function ensureDotContainer() {
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) {
      const mapTransform = getMapTransform();
      if (
        !mapTransform ||
        !Number.isFinite(Number(mapTransform.x)) ||
        !Number.isFinite(Number(mapTransform.y)) ||
        !Number.isFinite(Number(mapTransform.scale)) ||
        Number(mapTransform.scale) <= 0
      ) {
        return false;
      }

      if (dotContainer && dotContainer.dataset.ofeMarkerHost === "fallback") {
        return true;
      }
      if (dotContainer) dotContainer.remove();

      dotContainer = document.createElement("div");
      dotContainer.id = "ofe-dot-container";
      dotContainer.dataset.ofeMarkerHost = "fallback";
      dotContainer.style.cssText =
        "position:fixed;left:50%;top:50%;pointer-events:none;z-index:3;" +
        "--ofe-marker-scale:1;";
      document.body.appendChild(dotContainer);
      return true;
    }

    if (dotContainer && nameLayerContainer.contains(dotContainer)) {
      dotContainer.dataset.ofeMarkerHost = "name-layer";
      return true;
    }
    if (dotContainer) dotContainer.remove();

    dotContainer = document.createElement("div");
    dotContainer.id = "ofe-dot-container";
    dotContainer.dataset.ofeMarkerHost = "name-layer";
    dotContainer.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;z-index:4;" +
      "--ofe-marker-scale:1;";
    nameLayerContainer.appendChild(dotContainer);
    return true;
  }

  function updateMarkerScale() {
    if (!markersActive || !dotContainer) return;
    const nameLayerContainer = getNameLayerContainer();
    const mapTransform = getMapTransform();
    let zoomScale = 1;
    if (nameLayerContainer) {
      const tf = nameLayerContainer.style.transform || getComputedStyle(nameLayerContainer).transform;
      zoomScale = Math.max(0.0001, extractScaleFromTransform(tf));
    } else if (Number.isFinite(Number(mapTransform.scale))) {
      zoomScale = Math.max(0.0001, Number(mapTransform.scale));
    } else {
      return;
    }
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

  function styleMarker(marker, kind) {
    const image =
      kind === "building-stack"
        ? BUILDING_STACK_MARKER_SVG_DATA_URI
        : NATION_MARKER_SVG_DATA_URI;
    const shadow =
      kind === "building-stack"
        ? "drop-shadow(0 0 7px rgba(245,158,11,0.82)) drop-shadow(0 1px 2px rgba(0,0,0,0.72))"
        : "drop-shadow(0 0 6px rgba(239,68,68,0.55))";

    marker.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;" +
      `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;` +
      "display:flex;align-items:center;justify-content:center;" +
      "background-repeat:no-repeat;background-size:contain;background-position:center;" +
      `filter:${shadow};` +
      `background-image:url(\"${image}\");`;
    marker.dataset.ofeMarkerKind = kind;
  }

  function getOrCreateMarker(markerId, kind) {
    let marker = markerById.get(markerId);
    if (marker && dotContainer && dotContainer.contains(marker)) {
      if (marker.dataset.ofeMarkerKind !== kind) {
        marker.textContent = "";
        styleMarker(marker, kind);
      }
      return marker;
    }

    marker = document.createElement("div");
    marker.id = markerId;
    styleMarker(marker, kind);

    markerById.set(markerId, marker);
    dotContainer.appendChild(marker);
    return marker;
  }

  function setBuildingStackLabel(marker, level) {
    const text = Number.isFinite(Number(level)) ? String(Math.floor(Number(level))) : "";
    if (!text) {
      marker.textContent = "";
      return;
    }

    let label = marker.querySelector("span");
    if (!label) {
      marker.textContent = "";
      label = document.createElement("span");
      label.style.cssText =
        "position:absolute;left:50%;top:-9px;transform:translateX(-50%);" +
        "display:block;min-width:14px;max-width:24px;height:11px;padding:0 2px;overflow:hidden;text-align:center;" +
        "border:1px solid #111827;border-radius:2px;background:#fef3c7;" +
        "box-shadow:0 0 0 1px rgba(254,243,199,0.82),0 1px 3px rgba(0,0,0,0.65);" +
        "font:800 9px/11px Arial,sans-serif;color:#111827;text-shadow:none;";
      marker.appendChild(label);
    }
    label.textContent = text;
  }

  function updateMarkers() {
    if (!markersActive) return;
    if (!ensureDotContainer()) return;

    const nations = getNationPositions();
    const buildingStacks = getBuildingStackPositions();
    const mapTransform = getMapTransform();
    if (
      dotContainer.dataset.ofeMarkerHost === "fallback" &&
      mapTransform &&
      Number.isFinite(Number(mapTransform.x)) &&
      Number.isFinite(Number(mapTransform.y)) &&
      Number.isFinite(Number(mapTransform.scale))
    ) {
      dotContainer.style.transform =
        `translate(${Number(mapTransform.x)}px, ${Number(mapTransform.y)}px) scale(${Number(mapTransform.scale)})`;
    }
    const usedDots = new Set();

    for (const pid in nations) {
      const pos = nations[pid];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-nation-${pid}`;
      const marker = getOrCreateMarker(markerId, "nation");
      marker.textContent = "";
      marker.style.transform =
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`;

      usedDots.add(markerId);
    }

    for (const id in buildingStacks) {
      const pos = buildingStacks[id];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-building-stack-${id}`;
      const marker = getOrCreateMarker(markerId, "building-stack");
      setBuildingStackLabel(marker, pos.level);
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
          syncMarkerState();
          return;
        }
        if (
          mutation.attributeName === "data-ofe-nations" ||
          mutation.attributeName === "data-ofe-building-stacks" ||
          mutation.attributeName === "data-ofe-map-transform"
        ) {
          if (markersActive) updateMarkers();
          if (markersActive) updateMarkerScale();
          return;
        }
      }
    });
    gameDataObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-ofe-game-phase",
        "data-ofe-nations",
        "data-ofe-building-stacks",
        "data-ofe-map-transform",
      ],
    });
  }

  function syncMarkerState() {
    const active = hasActiveGamePhase();
    if (active === markersActive) return;

    markersActive = active;
    if (markersActive) {
      updateMarkers();
      updateMarkerScale();
      return;
    }

    clearMarkers();
  }

  function init() {
    if (watchInterval) return;
    initGameDataObserver();
    watchInterval = setInterval(() => {
      syncMarkerState();
      if (markersActive) {
        if (!dotContainer || !document.contains(dotContainer)) {
          updateMarkers();
        }
        updateMarkerScale();
      }
    }, 120);
    syncMarkerState();
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
