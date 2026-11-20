# Toddler Arcade

A developmental arcade launcher and mini-game system for toddlers, designed to run fullscreen in a browser on a **Raspberry Pi** (or any desktop/laptop) with an **EG STARTS USB Arcade DIY Kit** (`Zero Delay Arcade USB Encoder` + 8-way 5-pin joystick + LED push buttons).

## Why Browser JS + Gamepad API Works Great Here

The **EG STARTS USB Encoder** (`DragonRise Inc. Generic USB Joystick`, USB ID `0079:0006`) is a class-compliant USB HID gamepad:
- **Raspberry Pi OS / Linux** recognizes it out of the box (`usbhid` / `/dev/input/js0`) with zero drivers.
- **Chromium's HTML5 Gamepad API** (`navigator.getGamepads()`) reads both the 5-pin joystick (`axes[0]` / `axes[1]` as well as D-pad mode `buttons[12..15]`) and all 12 button slots (`buttons[0..11]`) at 60fps.
- Launching Chromium on the Pi with `--kiosk --autoplay-policy=no-user-gesture-required` (see `scripts/start-pi-kiosk.sh`) unlocks Web Audio synthesis immediately without requiring a mouse click or keyboard press.

---

## Quick Start (Desktop Development)

```bash
npm install
npm run dev
```

Build static bundle for Raspberry Pi deployment:

```bash
npm run build
npm run preview
```

---

## Controls

### Keyboard Fallback (Works Alongside USB Arcade Stick)
- **Joystick**: `Arrow Keys` or `W` `A` `S` `D`
- **Green Button**: `1` or `Z` or `G`
- **Yellow Button**: `2` or `X` or `Y`
- **Red Button**: `3` or `C` or `R`
- **Blue Button**: `4` or `V` or `B`
- **OK (Main Menu Select)**: `Enter` or `Space` (or `1` / `Z` / Green button)
- **Esc (Return to Main Menu / Soft Reset)**: `Escape` or `Backspace`
- **USB Encoder Remap Utility (Parent/Builder)**: `F2` (or click `SET` in top-right)
- **Toggle On-Screen Arcade Deck Strip**: `Tab`

You can also click/tap the illuminated arcade buttons directly in the bottom deck bar when testing on a laptop or tablet.

### Wiring & Mapping Your EG STARTS USB Encoder
Because you can plug your physical colored buttons into any `K1`–`K12` 2-pin header on the encoder board:
1. Plug the 5-pin joystick cable into the 5-pin header on the encoder PCB.
2. Plug your Green, Yellow, Red, Blue LED buttons plus your `1 Player` (`OK`) and `Coin` (`Esc`) buttons into any 2-pin button headers (or 3-pin headers if powering the 5V button LEDs).
3. Press **`F2`** (or click **`SET`** in the top-right corner) to open the **USB Arcade Encoder Setup** modal, see live raw button numbers, and bind each logical color/system button with a single press. Mappings are saved in `localStorage`.

---

## Included Games

1. **Choo-Choo Train (`src/games/train/index.ts`)**
   - **Joystick Left / Right**: Push right to accelerate forward (automatically starts the engine if off); release to coast smoothly with inertia; push left to slow down or gently reverse.
   - **Green Button**: Start engine (or shut down when stopped).
   - **Yellow Button**: Blast the steam whistle & puff steam.
   - **Red Button**: Apply air brakes with friction sparks.
   - **Red Button**: Momentary air brakes with friction sparks (auto-releases at standstill so brakes never get stuck on).
   - **Blue Button**: Cycle locomotive paint colors.
   - **World Loop**: Travels endlessly through `[station -> cityscape -> suburbscape -> rural -> rural2 -> suburb -> city -> station -> ...]`.

2. **Bubble Car Wash (`src/games/carwash/index.ts`)**
   - **Green Button (`Next Car`)**: Summon a muddy car from the waiting queue into the empty wash bay. If pressed while a car still needs steps completed, all remaining step lights (and matching buttons) flash to show what's left!
   - **Blue Button (`Water`)** + **Sweep Joystick Left/Right**: Spray water for **1. WASH** and **3. RINSE**.
   - **Yellow Button (`Soap`)** + **Sweep Joystick Left/Right**: Scrub bubbly foam for **2. SOAP**.
   - **Red Button (`Dry`)** + **Sweep Joystick Left/Right**: Blow warm air for **4. DRY**.
   - **Auto-Exit**: Once all 4 steps (`Wash -> Soap -> Rinse -> Dry`) are completed, the sparkling clean car drives out on its own and the bay waits for **Green** to bring the next car in.

---

## Adding a New Game

1. Implement `ArcadeGameDefinition` (see `src/core/types.ts`) in `src/games/<your-game>/index.ts`, specifying its custom `controls` mapping, `renderCover()`, and `create()`.
2. Add it to `GAME_REGISTRY` in `src/games/registry.ts` — its card will automatically appear in the main menu grid, and `ESC` is handled globally by the outer shell.
