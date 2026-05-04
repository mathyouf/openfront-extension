"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  function sendAllianceRequestToHoveredPlayer() {
    const recipient = fn.getHoveredPlayer();
    if (!recipient || typeof recipient.id !== "function") return;

    const recipientName = fn.getPlayerDisplayName(recipient) || `#${recipient.id()}`;
    const recipientFocusID = fn.resolvePlayerSmallID?.(recipient);

    const playerPanel = document.querySelector("player-panel");
    if (
      playerPanel &&
      playerPanel.g &&
      typeof playerPanel.g.myPlayer === "function" &&
      typeof playerPanel.handleAllianceClick === "function"
    ) {
      const myPlayer = playerPanel.g.myPlayer();
      if (myPlayer && typeof myPlayer.id === "function") {
        if (myPlayer.id() === recipient.id()) return;
        try {
          playerPanel.handleAllianceClick(new MouseEvent("click"), myPlayer, recipient);
          fn.pushBottomRightLog(
            `Alliance request sent to ${recipientName}`,
            constants.MESSAGE_TYPE.ALLIANCE_REQUEST,
            { focusID: recipientFocusID },
          );
          return;
        } catch (_) {}
      }
    }

    if (state.latestGameSocket && state.latestGameSocket.readyState === WebSocket.OPEN) {
      try {
        state.latestGameSocket.send(
          JSON.stringify({
            type: "intent",
            intent: {
              type: "allianceRequest",
              recipient: recipient.id(),
            },
          }),
        );
        fn.pushBottomRightLog(
          `Alliance request sent to ${recipientName}`,
          constants.MESSAGE_TYPE.ALLIANCE_REQUEST,
          { focusID: recipientFocusID },
        );
      } catch (_) {}
    }
  }

  function getShortcutActionForCode(code) {
    if (!fn.getShortcutActionByCode) return null;
    return fn.getShortcutActionByCode(code);
  }

  fn.initShortcutHandlers = () => {
    if (state.shortcutHandlersInitialized) return;
    state.shortcutHandlersInitialized = true;

    window.addEventListener(
      "keydown",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForCode(e.code);
        if (!action) return;
        if (!fn.isShortcutCodeReady || !fn.isShortcutCodeReady(e.code)) return;

        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );

    window.addEventListener(
      "keyup",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForCode(e.code);
        if (!action) return;

        if (!fn.isShortcutCodeReady || !fn.isShortcutCodeReady(e.code)) {
          fn.maybeNotifyShortcutBlocked(e.code);
          return;
        }

        e.stopImmediatePropagation();
        e.preventDefault();

        switch (action) {
          case "territoryCycle": {
            if (fn.triggerTerritoryCycle) fn.triggerTerritoryCycle();
            break;
          }
          case "chatSearch": {
            if (fn.hideEmojiSearchPalette) fn.hideEmojiSearchPalette();
            if (fn.openChatForHoveredPlayer) fn.openChatForHoveredPlayer();
            break;
          }
          case "emojiSearch": {
            if (fn.hideChatSearchPalette) fn.hideChatSearchPalette();
            if (fn.openEmojiForHoveredTile) fn.openEmojiForHoveredTile();
            break;
          }
          case "allianceRequest": {
            sendAllianceRequestToHoveredPlayer();
            break;
          }
          case "boatOnePercent": {
            if (fn.triggerBoatOnePercentAttack) fn.triggerBoatOnePercentAttack();
            break;
          }
          case "lastOfeAlert": {
            if (!fn.focusLastOfeAlert || !fn.focusLastOfeAlert()) {
              fn.pushBottomRightLog("No recent OFE alert to jump to.");
            }
            break;
          }
          default:
            break;
        }
      },
      true,
    );
  };
})();
