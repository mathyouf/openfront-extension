# OpenFront Enhanced

![Screenshot of spawn phase with nation markers and shortcut panel](screenshot.png)

Chrome extension that adds quality-of-life improvements to [openfront.io](https://openfront.io) and [openfront.dev](https://openfront.dev).

## Features

### Spawn phase
- **Nation markers** — Red dots on nations during spawn selection, visible at any zoom level. Removed when the game starts.
- **Sound notifications** — A chime plays when the spawn phase begins and another when the game starts, so you don't have to stare at the screen.

### Sound alerts
- **Per-sound settings** — Every OFE sound has its own toggle in the Extension settings tab, plus a `Listen` button so you can preview it without waiting for the in-game event.
- **Inbound attack warnings** — Boat attacks and ground attacks each have their own strong, easy-to-tell-apart alert sound.
- **Transport ship sounds** — A distinct sound plays when one of your transport ships lands, and a different sound plays when one is destroyed.
- **Warship destroyed sound** — A separate alert plays when one of your warships is destroyed.
- **Neighbor alerts** — Sleeping neighbors and traitor neighbors each have their own sound and setting.
- **Missile alerts** — Separate alarms play for atom bombs, hydrogen bombs, and MIRVs.

### Troop graph
A draggable top-right panel (toggle with `I`) that turns your troop counter into a trajectory:
- **Growth rate** — your live troop growth in troops/sec (smoothed first derivative), plus your troops as % of cap, color-coded by regen zone (mid-range grows fastest).
- **Forward projection** — where your troop count is headed over the next 30s/60s/120s/300s (cycle with the `±60s` button), simulated with the game's exact regen formula and your current troop cap.
- **"One click back" counterfactual** — when you spend troops (attack, boat, donation), an amber dashed line keeps growing the trajectory you were on *before* that click, and the panel shows how far behind it you are now and at the projection horizon. Watch the gap decay as you regrow — or widen when spending put you on a slower part of the regen curve. Red markers flag each spend. Only your own actions rebase the counterfactual; combat losses don't.

Info-only: it reads game state and never acts for you.

### Territory cycle
- **Mini Territories cycle** — The `Mini Territories` shortcut cycles the camera through your disconnected mini territories (100 tiles or fewer), skipping the shortcut if your land is fully connected or there are no mini territories.

### Keyboard shortcuts

All shortcuts are rebindable in the extension's `Extension` settings tab.

| Default key | Action | Description |
|---|---|---|
| `Z` | Chat Search | Opens chat directed at the hovered player with search |
| `X` | Emoji Search | Opens emoji selector with keyword search |
| `N` | Boat 1% | Sends a boat attack using only 1% of your troops |
| `H` | Mini Territories | Jumps camera between your disconnected mini territories (100 tiles or fewer) |
| `J` | Last OFE Alert | Jumps to the most recent clickable OFE alert |
| `I` | Troop Graph | Toggles the troop trajectory graph panel |

### Neighbor alerts
Notifications appear in the bottom-right when a neighboring player:
- **Falls asleep** (disconnects)
- **Betrays** an alliance and becomes a traitor

### Other
- **Emoji priority & keyword search** — Frequently used emojis are boosted to the top, and all emojis are searchable by keyword.

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` directory

The extension will activate automatically when you visit `openfront.io`, `openfront.dev`, or any `*.openfront.dev` subdomain.

## Contributing

Found a bug or have a feature idea? [Open an issue](../../issues/new/choose).
