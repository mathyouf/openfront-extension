"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  function hideChatSearchPalette() {
    if (state.chatSearchWatch) {
      clearInterval(state.chatSearchWatch);
      state.chatSearchWatch = null;
    }
    if (state.chatSearchState && state.chatSearchState.panel) {
      state.chatSearchState.panel.remove();
    }
    state.chatSearchState = null;
  }

  function buildChatPlayerIndex(chatModal, sender, recipient) {
    const game = chatModal && chatModal.g;
    if (!game || typeof game.players !== "function") return [];

    let myId = null;
    try {
      myId = sender && typeof sender.id === "function" ? sender.id() : null;
    } catch (_) {}

    let recipientId = null;
    try {
      recipientId =
        recipient && typeof recipient.id === "function" ? recipient.id() : null;
    } catch (_) {}

    const players = [];
    let leaderId = null;
    let leaderTiles = -Infinity;
    for (const player of game.players()) {
      if (!player || typeof player.id !== "function") continue;
      const id = player.id();
      if (myId != null && id === myId) continue;
      if (typeof player.isAlive === "function" && !player.isAlive()) continue;

      const name = String(fn.getPlayerDisplayName(player) || "").trim() || `#${id}`;
      let tilesOwned = null;
      try {
        if (typeof player.numTilesOwned === "function") {
          const value = Number(player.numTilesOwned());
          if (Number.isFinite(value)) tilesOwned = value;
        }
      } catch (_) {}

      if (tilesOwned != null && tilesOwned > leaderTiles) {
        leaderTiles = tilesOwned;
        leaderId = id;
      }

      players.push({
        id,
        name,
        player,
        tilesOwned,
        isDefault: false,
      });
    }

    const defaultId = leaderId != null ? leaderId : recipientId;
    for (const player of players) {
      player.isDefault = defaultId != null && player.id === defaultId;
    }

    players.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.tilesOwned != null && b.tilesOwned != null && a.tilesOwned !== b.tilesOwned) {
        return b.tilesOwned - a.tilesOwned;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return players;
  }

  function renderChatPlayerResults() {
    const s = state.chatSearchState;
    if (!s || !s.playerInput || !s.playerList) return;

    const tokens = fn.splitTokens(s.playerInput.value);
    s.playerMatches = s.players
      .filter((entry) => fn.matchesAllTokens(entry.name, tokens))
      .slice(0, 8);

    s.playerList.textContent = "";

    if (s.playerMatches.length === 0) {
      s.playerSelectedIndex = -1;
      const empty = document.createElement("div");
      empty.textContent = "No player matches";
      empty.style.cssText = "padding:6px 8px;color:#d1d5db;font-size:12px;";
      s.playerList.appendChild(empty);
      return;
    }

    let selectedId =
      s.selectedPlayer && typeof s.selectedPlayer.id === "function"
        ? s.selectedPlayer.id()
        : null;

    let selectedIndex =
      selectedId != null ? s.playerMatches.findIndex((match) => match.id === selectedId) : -1;
    if (selectedIndex < 0 && s.playerMatches.length > 0) {
      selectedIndex = 0;
      s.selectedPlayer = s.playerMatches[0].player;
      selectedId =
        s.selectedPlayer && typeof s.selectedPlayer.id === "function"
          ? s.selectedPlayer.id()
          : null;
    }
    s.playerSelectedIndex = selectedIndex;

    for (let matchIndex = 0; matchIndex < s.playerMatches.length; matchIndex++) {
      const match = s.playerMatches[matchIndex];
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = match.name;
      const isSelected = selectedId != null && selectedId === match.id;
      button.dataset.playerIndex = String(matchIndex);
      button.style.cssText =
        "display:block;width:100%;text-align:left;border:0;border-radius:8px;" +
        "padding:6px 8px;color:#fff;cursor:pointer;background:" +
        (isSelected ? "#1f2937" : "#0b1220");
      button.addEventListener("click", () => {
        s.selectedPlayer = match.player;
        s.playerSelectedIndex = matchIndex;
        renderChatPlayerResults();
      });
      s.playerList.appendChild(button);
    }
  }

  function buildQuickChatIndex(chatModal) {
    const index = [];
    const categories = Array.isArray(chatModal.categories) ? chatModal.categories : [];

    for (const category of categories) {
      const categoryId =
        typeof category === "string" ? category : category && category.id;
      if (!categoryId) continue;

      let phrases = [];
      if (typeof chatModal.getPhrasesForCategory === "function") {
        try {
          phrases = chatModal.getPhrasesForCategory(categoryId) || [];
        } catch (_) {}
      }

      for (const phrase of phrases) {
        if (!phrase || typeof phrase.key !== "string") continue;

        let text = phrase.key.replace(/[_-]/g, " ");
        if (
          typeof chatModal.selectCategory === "function" &&
          typeof chatModal.renderPhrasePreview === "function"
        ) {
          try {
            chatModal.selectCategory(categoryId);
            const preview = chatModal.renderPhrasePreview(phrase);
            if (typeof preview === "string" && preview.trim()) {
              text = preview;
            }
          } catch (_) {}
        }

        index.push({
          categoryId,
          phraseKey: phrase.key,
          text,
          requiresPlayer: Boolean(phrase.requiresPlayer),
        });
      }
    }

    return index;
  }

  function tryAutoSendQuickChat(chatModal, triesLeft) {
    if (triesLeft <= 0) return;
    const sendButton = chatModal.querySelector(".chat-send-button");
    if (sendButton && !sendButton.disabled && typeof sendButton.click === "function") {
      sendButton.click();
      return;
    }
    setTimeout(() => tryAutoSendQuickChat(chatModal, triesLeft - 1), 35);
  }

  function applyQuickChatMatch(match, sendImmediately) {
    const s = state.chatSearchState;
    if (!s) return;

    const { chatModal, sender, recipient } = s;
    if (typeof chatModal.openWithSelection !== "function") return;

    try {
      chatModal.openWithSelection(match.categoryId, match.phraseKey, sender, recipient);

      if (match.requiresPlayer && typeof chatModal.selectPlayer === "function") {
        let target = s.selectedPlayer;
        if (!target && s.playerMatches.length > 0) target = s.playerMatches[0].player;
        if (!target && s.players.length > 0) target = s.players[0].player;
        if (!target && recipient) target = recipient;
        if (target) {
          try {
            chatModal.selectPlayer(target);
          } catch (_) {}
        }
      }

      setTimeout(() => {
        const sendButton = chatModal.querySelector(".chat-send-button");
        if (sendImmediately) {
          if (typeof chatModal.sendChatMessage === "function") {
            try {
              chatModal.sendChatMessage();
              return;
            } catch (_) {}
          }
          tryAutoSendQuickChat(chatModal, 16);
          return;
        }
        if (sendButton && typeof sendButton.focus === "function") {
          sendButton.focus();
        }
      }, 0);
    } catch (_) {}
  }

  function updatePlayerStepVisibility() {
    const s = state.chatSearchState;
    if (!s) return;
    if (s.quickSection) {
      s.quickSection.style.display = s.isPlayerStepActive ? "none" : "block";
    }
    if (!s.playerSection) return;
    s.playerSection.style.display = s.isPlayerStepActive ? "block" : "none";
  }

  function resetPlayerSelectionStep() {
    const s = state.chatSearchState;
    if (!s) return;
    s.pendingPhraseMatch = null;
    s.isPlayerStepActive = false;
    updatePlayerStepVisibility();
  }

  function beginPlayerSelectionStep(match) {
    const s = state.chatSearchState;
    if (!s || !match || !match.requiresPlayer) return;

    s.pendingPhraseMatch = match;
    s.isPlayerStepActive = true;

    if (!s.selectedPlayer && s.playerMatches.length > 0) {
      s.selectedPlayer = s.playerMatches[0].player;
    }
    if (!s.selectedPlayer && s.players.length > 0) {
      s.selectedPlayer = s.players[0].player;
    }

    s.playerInput.value = "";
    updatePlayerStepVisibility();
    renderChatPlayerResults();

    setTimeout(() => {
      if (!state.chatSearchState || state.chatSearchState !== s) return;
      if (typeof s.playerInput.focus === "function") s.playerInput.focus();
      if (typeof s.playerInput.select === "function") s.playerInput.select();
    }, 0);
  }

  function movePlayerSelection(delta) {
    const s = state.chatSearchState;
    if (!s || !s.isPlayerStepActive || !s.playerMatches.length) return;

    let index =
      typeof s.playerSelectedIndex === "number" ? s.playerSelectedIndex : -1;
    if (index < 0) index = 0;

    const nextIndex = fn.clamp(index + delta, 0, s.playerMatches.length - 1);
    const next = s.playerMatches[nextIndex];
    if (!next) return;

    s.playerSelectedIndex = nextIndex;
    s.selectedPlayer = next.player;
    renderChatPlayerResults();

    const button = s.playerList.querySelector(
      `button[data-player-index="${nextIndex}"]`,
    );
    if (button && typeof button.scrollIntoView === "function") {
      button.scrollIntoView({ block: "nearest" });
    }
  }

  function renderChatSearchResults() {
    const s = state.chatSearchState;
    if (!s) return;

    const tokens = fn.splitTokens(s.input.value || "");
    s.matches = s.index
      .filter((item) =>
        fn.matchesAllTokens(`${item.text} ${item.categoryId} ${item.phraseKey}`, tokens),
      )
      .slice(0, 8);

    if (s.matches.length === 0) {
      s.selected = 0;
    } else {
      s.selected = fn.clamp(s.selected, 0, s.matches.length - 1);
    }

    s.list.textContent = "";
    if (s.matches.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No quick chat matches";
      empty.style.cssText = "padding:6px 8px;color:#d1d5db;font-size:12px;";
      s.list.appendChild(empty);
      return;
    }

    for (let i = 0; i < s.matches.length; i++) {
      const match = s.matches[i];
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${match.text} (${match.categoryId})${
        match.requiresPlayer ? " [P1]" : ""
      }`;
      button.style.cssText =
        "display:block;width:100%;text-align:left;border:0;border-radius:8px;" +
        "padding:6px 8px;color:#fff;cursor:pointer;background:" +
        (s.selected === i ? "#374151" : "#111827");
      button.addEventListener("click", () => {
        s.selected = i;
        if (match.requiresPlayer) {
          beginPlayerSelectionStep(match);
          return;
        }
        resetPlayerSelectionStep();
        applyQuickChatMatch(match, false);
      });
      s.list.appendChild(button);
    }
  }

  function showChatSearchPalette(chatModal, sender, recipient) {
    hideChatSearchPalette();

    const index = buildQuickChatIndex(chatModal);
    if (!index.length) return;

    const panel = document.createElement("div");
    panel.id = "ofe-chat-search";
    panel.style.cssText =
      "position:fixed;left:50%;top:20px;transform:translateX(-50%);" +
      "z-index:10020;width:min(620px,92vw);background:#0f172a;border:1px solid #334155;" +
      "border-radius:12px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,0.5);";
    fn.installOverlayInteractionGuards?.(panel);

    const title = document.createElement("div");
    title.textContent = "Quick chat search";
    title.style.cssText = "color:#e5e7eb;font-size:12px;font-weight:700;margin-bottom:6px;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type to search quick chat (press Enter to send)";
    input.autocomplete = "off";
    input.style.cssText =
      "width:100%;border:1px solid #475569;background:#020617;color:#fff;" +
      "border-radius:8px;padding:8px 10px;outline:none;";

    const list = document.createElement("div");
    list.style.cssText =
      "margin-top:8px;display:flex;flex-direction:column;gap:6px;" +
      "max-height:220px;overflow:auto;";

    const quickSection = document.createElement("div");
    quickSection.appendChild(input);
    quickSection.appendChild(list);

    const playerTitle = document.createElement("div");
    playerTitle.textContent = "Target player for [P1] phrases";
    playerTitle.style.cssText =
      "color:#cbd5e1;font-size:11px;font-weight:700;margin-top:10px;margin-bottom:6px;";

    const playerInput = document.createElement("input");
    playerInput.type = "text";
    playerInput.placeholder = "Search player";
    playerInput.autocomplete = "off";
    playerInput.style.cssText =
      "width:100%;border:1px solid #475569;background:#020617;color:#fff;" +
      "border-radius:8px;padding:8px 10px;outline:none;";

    const playerList = document.createElement("div");
    playerList.style.cssText =
      "margin-top:8px;display:flex;flex-direction:column;gap:6px;" +
      "max-height:140px;overflow:auto;";

    const playerSection = document.createElement("div");
    playerSection.style.cssText = "display:none;";
    playerSection.appendChild(playerTitle);
    playerSection.appendChild(playerInput);
    playerSection.appendChild(playerList);

    const players = buildChatPlayerIndex(chatModal, sender, recipient);
    const defaultPlayer = players.find((p) => p.isDefault) || players[0] || null;

    panel.appendChild(title);
    panel.appendChild(quickSection);
    panel.appendChild(playerSection);
    document.body.appendChild(panel);

    state.chatSearchState = {
      panel,
      input,
      list,
      quickSection,
      index,
      matches: [],
      selected: 0,
      playerInput,
      playerList,
      playerSection,
      players,
      playerMatches: [],
      playerSelectedIndex: -1,
      selectedPlayer: defaultPlayer ? defaultPlayer.player : null,
      pendingPhraseMatch: null,
      isPlayerStepActive: false,
      chatModal,
      sender,
      recipient,
    };

    input.addEventListener("input", () => {
      state.chatSearchState.selected = 0;
      resetPlayerSelectionStep();
      renderChatSearchResults();
    });

    input.addEventListener("keydown", (e) => {
      const s = state.chatSearchState;
      if (!s) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (s.matches.length > 0) {
          s.selected = fn.clamp(s.selected + 1, 0, s.matches.length - 1);
          renderChatSearchResults();
        }
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (s.matches.length > 0) {
          s.selected = fn.clamp(s.selected - 1, 0, s.matches.length - 1);
          renderChatSearchResults();
        }
        return;
      }

      if (e.key === "Enter") {
        const active = s.matches[s.selected];
        if (active) {
          e.preventDefault();
          if (active.requiresPlayer) {
            beginPlayerSelectionStep(active);
            return;
          }
          resetPlayerSelectionStep();
          applyQuickChatMatch(active, true);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        hideChatSearchPalette();
      }
    });

    playerInput.addEventListener("input", () => renderChatPlayerResults());
    playerInput.addEventListener("keydown", (e) => {
      const s = state.chatSearchState;
      if (!s) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        movePlayerSelection(1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        movePlayerSelection(-1);
        return;
      }

      if (e.key === "Enter") {
        if (!s.pendingPhraseMatch || !s.isPlayerStepActive) return;
        if (!s.selectedPlayer && s.playerMatches[0]) {
          s.selectedPlayer = s.playerMatches[0].player;
        }
        if (s.pendingPhraseMatch && s.selectedPlayer) {
          e.preventDefault();
          applyQuickChatMatch(s.pendingPhraseMatch, true);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        hideChatSearchPalette();
      }
    });

    renderChatSearchResults();
    renderChatPlayerResults();
    updatePlayerStepVisibility();

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    state.chatSearchWatch = setInterval(() => {
      const modalEl = chatModal.querySelector("o-modal");
      if (!modalEl || !modalEl.isModalOpen) {
        hideChatSearchPalette();
      }
    }, 200);
  }

  fn.hideChatSearchPalette = hideChatSearchPalette;

  fn.openChatForHoveredPlayer = () => {
    const chatModal = fn.getChatModal();
    if (!chatModal || typeof chatModal.open !== "function") return;

    const game = chatModal.g;
    const sender = game && typeof game.myPlayer === "function" ? game.myPlayer() : null;
    if (!sender) return;

    let recipient = fn.getHoveredPlayer();
    if (!recipient && game && typeof game.players === "function") {
      const candidates = game
        .players()
        .filter(
          (p) =>
            p &&
            typeof p.id === "function" &&
            p.id() !== sender.id() &&
            (!p.isAlive || p.isAlive()),
        );
      recipient = candidates[0] || null;
      if (recipient) {
        fn.pushBottomRightLog(
          `No hovered player detected. Opened chat with ${fn.getPlayerDisplayName(
            recipient,
          )}.`,
          undefined,
          { focusID: fn.resolvePlayerSmallID?.(recipient) },
        );
      }
    }

    if (!recipient) {
      fn.pushBottomRightLog("Hover a player and press chat shortcut again.");
      return;
    }

    chatModal.open(sender, recipient);
    setTimeout(() => showChatSearchPalette(chatModal, sender, recipient), 0);
  };
})();
