"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  ns.constants.SHORTCUT_PANEL_VISIBLE_KEY = "ofe.shortcuts.panel.visible";

  // Values from OpenFront MessageType enum.
  ns.constants.MESSAGE_TYPE = {
    MIRV_INBOUND: 4,
    NUKE_INBOUND: 5,
    HYDROGEN_BOMB_INBOUND: 7,
    NAVAL_INVASION_INBOUND: 8,
    ALLIANCE_REQUEST: 15,
    UNIT_DESTROYED: 12,
    CHAT: 20,
  };

  ns.constants.GAME_UPDATE_TYPE = {
    UNIT: 1,
    PLAYER: 2,
    DISPLAY_EVENT: 3,
    ALLIANCE_EXTENSION: 9,
    UNIT_INCOMING: 14,
    BONUS_EVENT: 15,
  };

  // Keyboard shortcuts removed 2026-08-20 (feature strip-down). Keep the
  // container so keybinds.js/settings-ui iterate an empty set harmlessly.
  ns.constants.EXT_SHORTCUTS = {};

  ns.constants.EXT_SOUND_SETTINGS = {
    spawnEntry: {
      label: "OFE: Spawn Phase",
      desc: "Play a short chime when spawn phase begins.",
    },
    gameStart: {
      label: "OFE: Game Start",
      desc: "Play a short chime when the match starts.",
    },
    boatLanding: {
      label: "OFE: Boat Landing",
      desc: "Play a harbor bell when one of your transport ships lands.",
    },
    boatInbound: {
      label: "OFE: Boat Inbound",
      desc: "Play a loud naval horn and sonar ping when an enemy transport ship is sent to you.",
    },
    boatDestroyed: {
      label: "OFE: Boat Destroyed",
      desc: "Play a splash-like alert when one of your transport ships is destroyed.",
    },
    groundAttackInbound: {
      label: "OFE: Ground Attack Inbound",
      desc: "Play a harsh marching alarm when a new ground attack is launched at you.",
    },
    warshipDestroyed: {
      label: "OFE: Warship Destroyed",
      desc: "Play a heavy horn when one of your warships is destroyed.",
    },
    neighborSleeping: {
      label: "OFE: Neighbor Sleeping",
      desc: "Play a soft drooping alert when a neighboring player falls asleep.",
    },
    neighborTraitor: {
      label: "OFE: Neighbor Traitor",
      desc: "Play a sharp warning when a neighboring player betrays and becomes traitor.",
    },
    nukeInbound: {
      label: "OFE: Atom Nuke",
      desc: "Play an air-raid warning when an atom bomb is inbound.",
    },
    hydrogenInbound: {
      label: "OFE: Hydrogen Bomb",
      desc: "Play a deeper long-form alarm when a hydrogen bomb is inbound.",
    },
    mirvInbound: {
      label: "OFE: MIRV",
      desc: "Play the highest-urgency alarm when a MIRV is inbound.",
    },
  };

  ns.constants.EMOJI_SEARCH_PRIORITY = {
    "🏭": 40,
    "🚂": 34,
    "❤️": 32,
    "💔": 28,
    "🤝": 30,
    "☢️": 29,
    "🆘": 27,
  };

  ns.constants.EMOJI_KEYWORDS = {
    "😀": ["grin", "happy", "smile"],
    "😊": ["smile", "blush", "nice"],
    "🥰": ["love", "hearts", "adorable"],
    "😇": ["angel", "innocent", "halo"],
    "😎": ["cool", "sunglasses", "swag"],
    "😞": ["sad", "down", "disappointed"],
    "🥺": ["please", "beg", "puppy"],
    "😭": ["cry", "tears", "sob"],
    "😱": ["shock", "scream", "scared"],
    "😡": ["angry", "mad", "rage"],
    "😈": ["devil", "evil"],
    "🤡": ["clown", "joke"],
    "🥱": ["yawn", "bored", "sleepy"],
    "🫡": ["salute", "respect", "sir"],
    "🖕": ["middle", "finger", "rude"],
    "👋": ["wave", "hello", "bye"],
    "👏": ["clap", "applause", "gg"],
    "✋": ["stop", "hand", "halt"],
    "🙏": ["pray", "thanks", "please"],
    "💪": ["strong", "flex", "power"],
    "👍": ["thumbs", "up", "yes", "good"],
    "👎": ["thumbs", "down", "no", "bad"],
    "🫴": ["offer", "give", "hand"],
    "🤌": ["pinch", "what", "italian"],
    "🤦‍♂️": ["facepalm", "fail", "disbelief"],
    "🤝": ["handshake", "deal", "ally"],
    "🆘": ["help", "sos", "rescue"],
    "🕊️": ["peace", "dove", "calm"],
    "🏳️": ["white", "flag", "surrender"],
    "⏳": ["wait", "time", "soon"],
    "🔥": ["fire", "hot", "burn"],
    "💥": ["boom", "explode", "impact"],
    "💀": ["skull", "dead", "rip"],
    "☢️": ["nuke", "nuclear", "nucelar", "radiation"],
    "⚠️": ["warning", "alert", "danger"],
    "↖️": ["northwest", "up", "left"],
    "⬆️": ["up", "north", "top"],
    "↗️": ["northeast", "up", "right"],
    "👑": ["crown", "king", "winner"],
    "🥇": ["gold", "first", "1st"],
    "⬅️": ["left", "west", "back"],
    "🎯": ["target", "aim", "focus"],
    "➡️": ["right", "east", "forward"],
    "🥈": ["silver", "second", "2nd"],
    "🥉": ["bronze", "third", "3rd"],
    "↙️": ["southwest", "down", "left"],
    "⬇️": ["down", "south", "bottom"],
    "↘️": ["southeast", "down", "right"],
    "❤️": ["heart", "love", "care"],
    "💔": ["broken", "heart", "sad"],
    "💰": ["money", "gold", "cash"],
    "⚓": ["anchor", "navy", "port"],
    "⛵": ["boat", "sail", "ship"],
    "🏡": ["home", "house", "base"],
    "🛡️": ["shield", "defense", "protect"],
    "🏭": ["factory", "industry", "build"],
    "🚂": ["train", "rail", "locomotive"],
    "❓": ["question", "what", "confused"],
    "🐔": ["chicken", "coward", "bird"],
    "🐀": ["rat", "sneaky", "rodent"],
  };
})();
