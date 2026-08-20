# OpenFront Enhanced

Chrome extension for [openfront.io](https://openfront.io) / [openfront.dev](https://openfront.dev), focused on **optimal troop management**. Info-plus-slider only: it reads game state and adjusts the game's own attack-ratio slider — every attack, boat, and donation is still your own click.

## The math it runs on (from the game source)

- Troop growth peaks at **~42% of your cap**; the extension treats troops above the **40% floor** as "spendable".
- Attacker losses saturate once you commit **1.66×** the defender's troops (the `[0.6, 2]` loss clamp) — less pays a higher per-tile price, more buys nothing further.
- `maxTroops = 2·(tiles^0.6·1000 + 50000) + cityLevels·250000`.

## Features

A small draggable panel (top-right) shows your troops, % of cap (colored by growth zone), spendable amount, and gold — plus three toggles:

### ⚖ 40% mode (the smart slider)
Keeps the game's attack-ratio slider continuously set so **one click is optimal**:
- **Hovering an enemy** — commits exactly what tops your **total wave** against them up to 1.66× their troops, *counting troops you've already sent* (your in-flight attacks on them). Already at 1.66×? The slider parks at 1%.
- **Hovering an ally** — the maximum donation that keeps you at the 40% floor (the server truncates to the ally's free cap space, so nothing is wasted).
- **Hovering nothing** — one click spends you down to exactly 40% of cap.

### ⚔ Ready badges
Every border neighbor gets a live badge (updates 5×/sec):
- **Not yet attacked** (rounded pill, ⚔ or 🤖 for bots): `≥37%` = the slider you'd need to commit 1.66× their troops (`MAX n×` when even 100% falls short). Color = a smooth gradient on what your **spendable** troops could afford against them: red → orange → **yellow** (1×, you can match) → **green** (1.66×, loss-optimal) → **blue** (2×+, overwhelming).
- **Already attacking** (sharp square badge, ▶): shows your current sent wave as a multiple of their troops (e.g. `0.7×`). Color = the same gradient on `(sent + spendable) / their troops` — can you still top the wave up to the optimum — and **white** once your sent wave is ≥1.66×.

### $/min labels
Your Ports, Factories, and Cities are annotated on the map with their measured **gold per minute of existence** — exact attribution from the game's tile-stamped gold events (trade-ship arrivals, train stops).

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` directory

The extension activates automatically on `openfront.io`, `openfront.dev`, and any `*.openfront.dev` subdomain.

## Contributing

Found a bug or have a feature idea? [Open an issue](../../issues/new/choose).
