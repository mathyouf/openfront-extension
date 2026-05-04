/**
 * OpenFront Enhanced — MAIN world bootstrap
 *
 * Modules loaded before this file register behavior on `window.__OFE`.
 * This bootstrap wires startup ordering only.
 */

"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns || !ns.fn || ns.__bootstrapped) return;
  ns.__bootstrapped = true;

  ns.fn.initPointerTracking?.();
  ns.fn.initWorkerHooks?.();
  ns.fn.initSocketHooks?.();
  ns.fn.initNeighborWatch?.();
  ns.fn.initShortcutHandlers?.();
  ns.fn.initSettingsIntegration?.();
  ns.fn.initEventsPanelIntegration?.();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ns.fn.initShortcutPanel?.();
      ns.fn.initAlliancePanel?.();
    });
  } else {
    ns.fn.initShortcutPanel?.();
    ns.fn.initAlliancePanel?.();
  }
})();
