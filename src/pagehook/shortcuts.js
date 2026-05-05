"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  function getShortcutActionForEvent(event) {
    if (fn.getShortcutActionForEvent) return fn.getShortcutActionForEvent(event);
    if (!fn.getShortcutActionByCode) return null;
    return fn.getShortcutActionByCode(event.code);
  }

  function isShortcutReady(event) {
    if (fn.isShortcutEventReady) return fn.isShortcutEventReady(event);
    return fn.isShortcutCodeReady ? fn.isShortcutCodeReady(event.code) : false;
  }

  fn.initShortcutHandlers = () => {
    if (state.shortcutHandlersInitialized) return;
    state.shortcutHandlersInitialized = true;

    window.addEventListener(
      "keydown",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForEvent(e);
        if (!action) return;
        if (!isShortcutReady(e)) return;

        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );

    window.addEventListener(
      "keyup",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForEvent(e);
        if (!action) return;

        if (!isShortcutReady(e)) {
          const key = fn.getShortcutEventKey ? fn.getShortcutEventKey(e) : e.code;
          fn.maybeNotifyShortcutBlocked(key);
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
