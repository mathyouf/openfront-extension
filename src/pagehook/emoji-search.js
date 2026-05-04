"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  function hideEmojiSearchPalette() {
    if (state.emojiSearchWatch) {
      clearInterval(state.emojiSearchWatch);
      state.emojiSearchWatch = null;
    }
    if (state.emojiSearchState && state.emojiSearchState.panel) {
      state.emojiSearchState.panel.remove();
    }
    state.emojiSearchState = null;
  }

  function getEmojiButtons() {
    const emojiTable = fn.getEmojiTable();
    if (!emojiTable) return [];
    return Array.from(emojiTable.querySelectorAll(".grid button"));
  }

  function findEmojiIndex(emoji) {
    const buttons = getEmojiButtons();
    for (let index = 0; index < buttons.length; index++) {
      const text = (buttons[index].textContent || "").trim();
      if (text === emoji) {
        return index;
      }
    }
    return -1;
  }

  function emojiMatchesQuery(emoji, tokens) {
    const keywords = constants.EMOJI_KEYWORDS[emoji] || [];
    return fn.matchesAllTokens(`${emoji} ${keywords.join(" ")}`, tokens);
  }

  function applyEmojiFilter() {
    const s = state.emojiSearchState;
    if (!s) return null;

    const tokens = fn.splitTokens(s.input.value);
    const matches = [];

    for (const [index, button] of getEmojiButtons().entries()) {
      const emoji = (button.textContent || "").trim();
      const visible = emojiMatchesQuery(emoji, tokens);
      button.style.display = visible ? "" : "none";
      if (!visible) {
        button.style.order = "";
        continue;
      }

      matches.push({ button, emoji, index });
    }

    let firstVisible = null;
    if (!tokens.length) {
      for (const match of matches) {
        match.button.style.order = "";
      }
      firstVisible = matches.length ? matches[0].button : null;
    } else {
      const ranked =
        typeof fn.rankEmojiMatches === "function"
          ? fn.rankEmojiMatches(matches, tokens)
          : matches.slice().sort((a, b) => a.index - b.index);

      for (const [rank, match] of ranked.entries()) {
        match.button.style.order = String(rank);
      }
      firstVisible = ranked.length ? ranked[0].button : null;
    }

    s.firstVisible = firstVisible;
    return firstVisible;
  }

  function showEmojiSearchPalette() {
    const emojiTable = fn.getEmojiTable();
    if (!emojiTable || !emojiTable.isVisible) return;

    hideEmojiSearchPalette();

    const panel = document.createElement("div");
    panel.id = "ofe-emoji-search";
    panel.style.cssText =
      "position:fixed;left:50%;top:20px;transform:translateX(-50%);" +
      "z-index:10021;width:min(520px,90vw);background:#0f172a;border:1px solid #334155;" +
      "border-radius:12px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,0.5);";

    const title = document.createElement("div");
    title.textContent = "Emoji search";
    title.style.cssText = "color:#e5e7eb;font-size:12px;font-weight:700;margin-bottom:6px;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type keywords (fire, target, heart, surrender...)";
    input.autocomplete = "off";
    input.style.cssText =
      "width:100%;border:1px solid #475569;background:#020617;color:#fff;" +
      "border-radius:8px;padding:8px 10px;outline:none;";

    panel.appendChild(title);
    panel.appendChild(input);
    document.body.appendChild(panel);

    state.emojiSearchState = { panel, input, emojiTable, firstVisible: null };

    input.addEventListener("input", () => applyEmojiFilter());
    input.addEventListener("keydown", (e) => {
      if (!state.emojiSearchState) return;

      if (e.key === "Enter") {
        const first = applyEmojiFilter();
        if (first) {
          e.preventDefault();
          first.click();
          hideEmojiSearchPalette();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof emojiTable.hideTable === "function") {
          emojiTable.hideTable();
        }
        hideEmojiSearchPalette();
      }
    });

    applyEmojiFilter();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    state.emojiSearchWatch = setInterval(() => {
      if (!emojiTable.isVisible) hideEmojiSearchPalette();
    }, 200);
  }

  function showEmojiSearchPaletteWhenReady(triesLeft = 16) {
    const emojiTable = fn.getEmojiTable();
    if (emojiTable && emojiTable.isVisible) {
      showEmojiSearchPalette();
      return;
    }
    if (triesLeft <= 0) return;
    setTimeout(() => showEmojiSearchPaletteWhenReady(triesLeft - 1), 25);
  }

  function getEmojiTargetContext(emojiTable) {
    const game =
      (emojiTable && emojiTable.game) ||
      (fn.getAnyGameView ? fn.getAnyGameView() : null);
    if (!game || typeof game.myPlayer !== "function") return null;

    const myPlayer = game.myPlayer();
    if (!myPlayer || typeof myPlayer.id !== "function") return null;

    const hoveredPlayer = fn.getHoveredPlayer ? fn.getHoveredPlayer() : null;
    if (hoveredPlayer && typeof hoveredPlayer.id === "function") {
      return {
        game,
        recipient: hoveredPlayer.id() === myPlayer.id() ? "AllPlayers" : hoveredPlayer,
      };
    }

    const transformHandler = emojiTable && emojiTable.transformHandler;
    if (
      !transformHandler ||
      typeof transformHandler.screenToWorldCoordinates !== "function" ||
      typeof game.isValidCoord !== "function" ||
      typeof game.ref !== "function" ||
      typeof game.hasOwner !== "function" ||
      typeof game.owner !== "function"
    ) {
      return null;
    }

    const x = fn.clamp(state.lastMouseX, 0, window.innerWidth - 1);
    const y = fn.clamp(state.lastMouseY, 0, window.innerHeight - 1);
    const cell = transformHandler.screenToWorldCoordinates(x, y);
    if (!cell || !game.isValidCoord(cell.x, cell.y)) return null;

    const tile = game.ref(cell.x, cell.y);
    if (!game.hasOwner(tile)) return null;

    const owner = game.owner(tile);
    if (!owner || typeof owner.id !== "function") return null;

    return {
      game,
      recipient: owner.id() === myPlayer.id() ? "AllPlayers" : owner,
    };
  }

  function sendEmojiIntent(recipient, emojiIndex) {
    if (
      !state.latestGameSocket ||
      state.latestGameSocket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    try {
      state.latestGameSocket.send(
        JSON.stringify({
          type: "intent",
          intent: {
            type: "emoji",
            recipient:
              recipient === "AllPlayers" ? "AllPlayers" : recipient.id(),
            emoji: emojiIndex,
          },
        }),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  fn.hideEmojiSearchPalette = hideEmojiSearchPalette;

  fn.openEmojiForHoveredTile = () => {
    const emojiTable = fn.getEmojiTable();
    if (!emojiTable || typeof emojiTable.showTable !== "function") return;

    const target = getEmojiTargetContext(emojiTable);
    const targetFocusID = target && target.recipient
      ? fn.resolvePlayerSmallID?.(target.recipient)
      : null;
    if (!target || !target.recipient) {
      fn.pushBottomRightLog("Hover a player or owned tile and press emoji again.");
      return;
    }

    hideEmojiSearchPalette();

    emojiTable.showTable((emoji) => {
      const emojiIndex = findEmojiIndex(emoji);
      if (emojiIndex < 0) {
        fn.pushBottomRightLog("Could not send emoji.", undefined, { focusID: targetFocusID });
        return;
      }

      if (!sendEmojiIntent(target.recipient, emojiIndex)) {
        fn.pushBottomRightLog("Emoji send unavailable right now.", undefined, {
          focusID: targetFocusID,
        });
        return;
      }

      if (typeof emojiTable.hideTable === "function") {
        emojiTable.hideTable();
      }
      hideEmojiSearchPalette();
    });

    showEmojiSearchPaletteWhenReady();
  };
})();
