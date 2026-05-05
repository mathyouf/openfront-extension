"use strict";

(() => {
  const ns = (window.__OFE = window.__OFE || {});

  ns.constants = ns.constants || {};
  ns.fn = ns.fn || {};

  if (!ns.state) {
    ns.state = {
      // Worker-derived runtime game state
      playerTypeById: {},
      myPlayerTroops: 0,
      myClientID: null,
      playerTroopsById: {},
      clientIDToPlayerID: {},

      // Pointer position for hover-driven shortcuts
      lastMouseX: window.innerWidth / 2,
      lastMouseY: window.innerHeight / 2,

      // Search overlays
      chatSearchState: null,
      chatSearchWatch: null,
      emojiSearchState: null,
      emojiSearchWatch: null,

      // Network/socket tracking
      latestGameSocket: null,
      gameSockets: new Set(),
      overrideNextBoat: false,
      boatDispatching: false,
      seenIncomingBoatUnitIds: new Set(),
      boatInboundAlertTickByAttacker: new Map(),
      groundAttackTrackingReady: false,
      seenIncomingGroundAttackIds: new Set(),
      groundAttackInboundAlertTickByAttacker: new Map(),
      lastBoatLandingSoundTick: -1,
      lastBoatInboundSoundTick: -1,
      lastBoatDestroyedSoundTick: -1,
      lastGroundAttackInboundSoundTick: -1,
      lastWarshipDestroyedSoundTick: -1,
      lastMirvInboundSoundTick: -1,
      lastNukeInboundSoundTick: -1,
      lastHydrogenInboundSoundTick: -1,

      // Territory cycle
      territoryCycleIndex: 0,

      // Info panel
      shortcutPanelState: null,
      shortcutPanelWatch: null,
      alliancePanelState: null,
      alliancePanelWatch: null,
      allianceExtensionPendingById: new Map(),
      eventsPanelState: null,
      eventsPanelWatch: null,
      lastOfeAlertTarget: null,
      lastOfeAlertSequence: 0,
      lastOfeAlertJumpSequence: 0,
      lastOfeAlertReturnTarget: null,
      extensionSettingsTabActive: false,
      extensionSettingsCache: null,

      // Neighbor status monitor
      neighborWatchInterval: null,
      neighborWatchBusy: false,
      neighborStatusById: {},

      // Throttled notifications
      lastShortcutWarnAt: {},

      // Game phase tracking
      gamePhase: "none",
    };
  }

  ns._phaseListeners = ns._phaseListeners || [];
})();
