import {
  CabinetButton,
  CabinetSnapshot,
  Direction,
  GameControlDescriptor,
  GameInput,
  GamepadButtonSlot,
  GamepadMappingConfig,
  PhysicalButton,
} from './types';

const STORAGE_KEY = 'toddler_arcade_gamepad_v2';
const AXIS_DEADZONE = 0.35;

export const ALL_PHYSICAL_BUTTONS: PhysicalButton[] = [
  'R1',
  'G1',
  'B1',
  'Y1',
  'R2',
  'G2',
  'B2',
  'Y2',
  'X1',
  'X2',
  'X3',
  'X4',
  'X5',
  'X6',
  'OK',
  'ESC',
];

export const ALL_CABINET_BUTTONS: CabinetButton[] = [
  ...ALL_PHYSICAL_BUTTONS,
  'RED',
  'GREEN',
  'BLUE',
  'YELLOW',
];

export const ALL_DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

export function createDefaultMapping(): GamepadMappingConfig {
  return {
    // Supports single or dual USB encoders (e.g., two EG STARTS Zero Delay boards)
    buttons: {
      R1: [{ pad: 0, button: 0 }],
      G1: [{ pad: 0, button: 1 }],
      B1: [{ pad: 0, button: 2 }],
      Y1: [{ pad: 0, button: 3 }],
      R2: [{ pad: 0, button: 4 }],
      G2: [{ pad: 0, button: 5 }],
      B2: [{ pad: 0, button: 6 }],
      Y2: [{ pad: 0, button: 7 }],
      ESC: [{ pad: 0, button: 8 }],
      OK: [{ pad: 0, button: 9 }],
      X1: [{ pad: 0, button: 10 }, { pad: 1, button: 0 }],
      X2: [{ pad: 0, button: 11 }, { pad: 1, button: 1 }],
      X3: [{ pad: 1, button: 2 }],
      X4: [{ pad: 1, button: 3 }],
      X5: [{ pad: 1, button: 4 }],
      X6: [{ pad: 1, button: 5 }],
      RED: [],
      GREEN: [],
      BLUE: [],
      YELLOW: [],
    },
    stickPadIndex: 0,
    axisXIndex: 0,
    axisYIndex: 1,
    invertX: false,
    invertY: false,
  };
}

/**
 * Keyboard layout mirroring the physical 3-cluster cabinet schematic:
 * - Left 2x3 White Shapes (X1..X6): Q W E / A S D  (or 5 6 7 / 8 9 0)
 * - Center System + Joystick:       Esc, Enter/Space, Arrow Keys
 * - Right 2x4 Colored (R G B Y):    1 2 3 4 or U I O P or R G B Y (row 1), Z X C V or J K L ; (row 2)
 */
const KEYBOARD_MAP: Record<string, CabinetButton | Direction> = {
  // Center Joystick
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',

  // Center System Buttons
  Enter: 'OK',
  Space: 'OK',
  Escape: 'ESC',
  Backspace: 'ESC',

  // Right Cluster — Top Row Colored (R1, G1, B1, Y1)
  Digit1: 'R1',
  KeyU: 'R1',
  KeyR: 'R1',

  Digit2: 'G1',
  KeyI: 'G1',
  KeyG: 'G1',

  Digit3: 'B1',
  KeyO: 'B1',
  KeyB: 'B1',

  Digit4: 'Y1',
  KeyP: 'Y1',
  KeyY: 'Y1',

  // Right Cluster — Bottom Row Colored (R2, G2, B2, Y2)
  KeyZ: 'R2',
  KeyJ: 'R2',

  KeyX: 'G2',
  KeyK: 'G2',

  KeyC: 'B2',
  KeyL: 'B2',

  KeyV: 'Y2',
  Semicolon: 'Y2',

  // Left Cluster — Top Row White Shapes (X1=Square, X2=Circle, X3=Triangle)
  KeyQ: 'X1',
  Digit5: 'X1',

  KeyW: 'X2',
  Digit6: 'X2',

  KeyE: 'X3',
  Digit7: 'X3',

  // Left Cluster — Bottom Row White Shapes (X4=Diamond, X5=Star, X6=Heart)
  KeyA: 'X4',
  Digit8: 'X4',

  KeyS: 'X5',
  Digit9: 'X5',

  KeyD: 'X6',
  Digit0: 'X6',
};

export interface PressedPadButton {
  pad: number;
  button: number;
}

export interface RawGamepadDebug {
  connected: boolean;
  count: number;
  id: string | null;
  pressedButtons: PressedPadButton[];
  axes: number[];
}

function makeButtonRecord(initial: boolean): Record<CabinetButton, boolean> {
  const rec = {} as Record<CabinetButton, boolean>;
  for (const b of ALL_CABINET_BUTTONS) {
    rec[b] = initial;
  }
  return rec;
}

export class InputManager {
  private mapping: GamepadMappingConfig;
  private keysDown = new Set<string>();
  private latchedKeys = new Set<string>();
  private virtualButtonsDown = new Set<CabinetButton>();
  private latchedVirtualButtons = new Set<CabinetButton>();
  private virtualDirsDown = new Set<Direction>();
  private latchedVirtualDirs = new Set<Direction>();

  private prevButtons: Record<CabinetButton, boolean> = makeButtonRecord(false);
  private prevDirs: Record<Direction, boolean> = {
    UP: false,
    DOWN: false,
    LEFT: false,
    RIGHT: false,
  };

  private lastSnapshot: CabinetSnapshot;

  constructor() {
    this.mapping = this.loadMapping();
    this.lastSnapshot = this.createEmptySnapshot();

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') {
        this.keysDown.clear();
        return;
      }
      if (e.code === 'F5' || e.code === 'F11' || e.code === 'F12') {
        return;
      }
      if (e.code in KEYBOARD_MAP || e.code === 'F2' || e.code === 'Tab') {
        e.preventDefault();
      }
      this.keysDown.add(e.code);
      if (!e.repeat) {
        this.latchedKeys.add(e.code);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') {
        this.keysDown.clear();
      }
    });

    const clearAllHeld = () => {
      this.keysDown.clear();
      this.latchedKeys.clear();
      this.virtualButtonsDown.clear();
      this.latchedVirtualButtons.clear();
      this.virtualDirsDown.clear();
      this.latchedVirtualDirs.clear();
    };

    window.addEventListener('blur', clearAllHeld);
    window.addEventListener('contextmenu', clearAllHeld);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearAllHeld();
    });
  }

  private loadMapping(): GamepadMappingConfig {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GamepadMappingConfig>;
        const def = createDefaultMapping();
        return {
          ...def,
          ...parsed,
          buttons: {
            ...def.buttons,
            ...(parsed.buttons ?? {}),
          },
        };
      }
    } catch {
      // Ignore corrupt storage
    }
    return createDefaultMapping();
  }

  public saveMapping(next: GamepadMappingConfig): void {
    this.mapping = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors in private/restricted kiosk profiles
    }
  }

  public resetMapping(): void {
    this.saveMapping(createDefaultMapping());
  }

  public getMapping(): GamepadMappingConfig {
    return this.mapping;
  }

  public setVirtualButton(button: CabinetButton, down: boolean): void {
    if (down) {
      this.virtualButtonsDown.add(button);
      this.latchedVirtualButtons.add(button);
    } else {
      this.virtualButtonsDown.delete(button);
    }
  }

  public setVirtualDirection(dir: Direction, down: boolean): void {
    if (down) {
      this.virtualDirsDown.add(dir);
      this.latchedVirtualDirs.add(dir);
    } else {
      this.virtualDirsDown.delete(dir);
    }
  }

  public clearVirtualInputs(): void {
    this.virtualButtonsDown.clear();
    this.latchedVirtualButtons.clear();
    this.virtualDirsDown.clear();
    this.latchedVirtualDirs.clear();
  }

  private getConnectedGamepads(): Array<{ index: number; pad: Gamepad }> {
    if (!navigator.getGamepads) return [];
    const pads = navigator.getGamepads();
    const out: Array<{ index: number; pad: Gamepad }> = [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        out.push({ index: i, pad: p });
      }
    }
    return out;
  }

  public getRawGamepadDebug(): RawGamepadDebug {
    const connected = this.getConnectedGamepads();
    if (connected.length === 0) {
      return { connected: false, count: 0, id: null, pressedButtons: [], axes: [] };
    }
    const pressedButtons: PressedPadButton[] = [];
    for (const { index, pad } of connected) {
      pad.buttons.forEach((b, btnIdx) => {
        if (b && (b.pressed || b.value > 0.5)) {
          pressedButtons.push({ pad: index, button: btnIdx });
        }
      });
    }
    const stickPad =
      connected.find((c) => c.index === (this.mapping.stickPadIndex ?? 0))?.pad ??
      connected[0].pad;
    return {
      connected: true,
      count: connected.length,
      id: connected.map((c) => `#${c.index}:${c.pad.id.slice(0, 24)}`).join(' + '),
      pressedButtons,
      axes: stickPad.axes.map((a) => Number(a.toFixed(2))),
    };
  }

  private isSlotPressed(
    slot: GamepadButtonSlot,
    padMap: Map<number, Gamepad>,
    firstPad: Gamepad | undefined
  ): boolean {
    if (typeof slot === 'number') {
      const b = firstPad?.buttons[slot];
      return !!(b && (b.pressed || b.value > 0.5));
    }
    const target = padMap.get(slot.pad);
    const b = target?.buttons[slot.button];
    return !!(b && (b.pressed || b.value > 0.5));
  }

  public poll(): CabinetSnapshot {
    const connected = this.getConnectedGamepads();
    const padMap = new Map<number, Gamepad>(connected.map((c) => [c.index, c.pad]));
    const firstPad = connected[0]?.pad;

    const buttonDown = makeButtonRecord(false);
    const dirDown: Record<Direction, boolean> = {
      UP: false,
      DOWN: false,
      LEFT: false,
      RIGHT: false,
    };

    let axisX = 0;
    let axisY = 0;

    // 1. Read keyboard (currently held + sub-frame latched taps)
    const activeCodes = new Set<string>([...this.keysDown, ...this.latchedKeys]);
    this.latchedKeys.clear();

    for (const code of activeCodes) {
      const mapped = KEYBOARD_MAP[code];
      if (!mapped) continue;
      if (mapped === 'UP' || mapped === 'DOWN' || mapped === 'LEFT' || mapped === 'RIGHT') {
        dirDown[mapped] = true;
      } else {
        buttonDown[mapped] = true;
      }
    }

    // 2. Read virtual touch/click controls
    for (const b of this.virtualButtonsDown) {
      buttonDown[b] = true;
    }
    for (const b of this.latchedVirtualButtons) {
      buttonDown[b] = true;
    }
    this.latchedVirtualButtons.clear();

    for (const d of this.virtualDirsDown) {
      dirDown[d] = true;
    }
    for (const d of this.latchedVirtualDirs) {
      dirDown[d] = true;
    }
    this.latchedVirtualDirs.clear();

    // 3. Read USB HID Gamepad(s)
    if (connected.length > 0) {
      for (const cabBtn of ALL_CABINET_BUTTONS) {
        const slots = this.mapping.buttons[cabBtn] ?? [];
        for (const slot of slots) {
          if (this.isSlotPressed(slot, padMap, firstPad)) {
            buttonDown[cabBtn] = true;
          }
        }
      }

      // Read joystick axes from stickPadIndex (or any pad deflecting past deadzone)
      for (const { index, pad } of connected) {
        if (this.mapping.stickPadIndex !== undefined && connected.length > 1 && index !== this.mapping.stickPadIndex) {
          // Still check D-pad buttons 12..15 across pads
          if (pad.buttons[12]?.pressed) dirDown.UP = true;
          if (pad.buttons[13]?.pressed) dirDown.DOWN = true;
          if (pad.buttons[14]?.pressed) dirDown.LEFT = true;
          if (pad.buttons[15]?.pressed) dirDown.RIGHT = true;
          continue;
        }
        const rawX = pad.axes[this.mapping.axisXIndex] ?? 0;
        const rawY = pad.axes[this.mapping.axisYIndex] ?? 0;
        const adjX = this.mapping.invertX ? -rawX : rawX;
        const adjY = this.mapping.invertY ? -rawY : rawY;

        if (Math.abs(adjX) > AXIS_DEADZONE) {
          axisX = adjX;
          if (adjX < -AXIS_DEADZONE) dirDown.LEFT = true;
          if (adjX > AXIS_DEADZONE) dirDown.RIGHT = true;
        }
        if (Math.abs(adjY) > AXIS_DEADZONE) {
          axisY = adjY;
          if (adjY < -AXIS_DEADZONE) dirDown.UP = true;
          if (adjY > AXIS_DEADZONE) dirDown.DOWN = true;
        }

        if (pad.buttons[12]?.pressed) dirDown.UP = true;
        if (pad.buttons[13]?.pressed) dirDown.DOWN = true;
        if (pad.buttons[14]?.pressed) dirDown.LEFT = true;
        if (pad.buttons[15]?.pressed) dirDown.RIGHT = true;
      }
    }

    // 4. Merge the 8 colored buttons into the 4 simple-mode color channels!
    // Pressing EITHER R1 or R2 activates RED; G1 or G2 -> GREEN; B1 or B2 -> BLUE; Y1 or Y2 -> YELLOW.
    if (buttonDown.R1 || buttonDown.R2) buttonDown.RED = true;
    if (buttonDown.G1 || buttonDown.G2) buttonDown.GREEN = true;
    if (buttonDown.B1 || buttonDown.B2) buttonDown.BLUE = true;
    if (buttonDown.Y1 || buttonDown.Y2) buttonDown.YELLOW = true;

    // Synthesize normalized digital axis if keyboard/virtual D-pad was used
    if (axisX === 0) {
      if (dirDown.LEFT && !dirDown.RIGHT) axisX = -1;
      else if (dirDown.RIGHT && !dirDown.LEFT) axisX = 1;
    }
    if (axisY === 0) {
      if (dirDown.UP && !dirDown.DOWN) axisY = -1;
      else if (dirDown.DOWN && !dirDown.UP) axisY = 1;
    }

    const buttonJustPressed = makeButtonRecord(false);
    const buttonJustReleased = makeButtonRecord(false);
    for (const b of ALL_CABINET_BUTTONS) {
      buttonJustPressed[b] = buttonDown[b] && !this.prevButtons[b];
      buttonJustReleased[b] = !buttonDown[b] && this.prevButtons[b];
      this.prevButtons[b] = buttonDown[b];
    }

    const dirJustPressed = {} as Record<Direction, boolean>;
    for (const d of ALL_DIRECTIONS) {
      dirJustPressed[d] = dirDown[d] && !this.prevDirs[d];
      this.prevDirs[d] = dirDown[d];
    }

    this.lastSnapshot = {
      axisX,
      axisY,
      dirDown,
      dirJustPressed,
      buttonDown,
      buttonJustPressed,
      buttonJustReleased,
      gamepadConnected: connected.length > 0,
      gamepadCount: connected.length,
      gamepadName: connected[0]?.pad.id ?? null,
    };

    return this.lastSnapshot;
  }

  public getLastSnapshot(): CabinetSnapshot {
    return this.lastSnapshot;
  }

  /** Resolves a cabinet snapshot through a specific game's control mapping */
  public createGameInput<Action extends string>(
    snapshot: CabinetSnapshot,
    controls: GameControlDescriptor<Action>[]
  ): GameInput<Action> {
    const actionToButtons = new Map<Action, CabinetButton[]>();
    for (const c of controls) {
      const list = actionToButtons.get(c.action) ?? [];
      list.push(c.button);
      actionToButtons.set(c.action, list);
    }

    return {
      axisX: snapshot.axisX,
      axisY: snapshot.axisY,
      dirDown: snapshot.dirDown,
      dirJustPressed: snapshot.dirJustPressed,
      snapshot,
      isDown: (action: Action) => {
        const btns = actionToButtons.get(action);
        if (!btns) return false;
        return btns.some((b) => snapshot.buttonDown[b]);
      },
      justPressed: (action: Action) => {
        const btns = actionToButtons.get(action);
        if (!btns) return false;
        return btns.some((b) => snapshot.buttonJustPressed[b]);
      },
      justReleased: (action: Action) => {
        const btns = actionToButtons.get(action);
        if (!btns) return false;
        return btns.some((b) => snapshot.buttonJustReleased[b]);
      },
      isButtonDown: (button: CabinetButton) => snapshot.buttonDown[button],
      justPressedButton: (button: CabinetButton) => snapshot.buttonJustPressed[button],
    };
  }

  private createEmptySnapshot(): CabinetSnapshot {
    return {
      axisX: 0,
      axisY: 0,
      dirDown: { UP: false, DOWN: false, LEFT: false, RIGHT: false },
      dirJustPressed: { UP: false, DOWN: false, LEFT: false, RIGHT: false },
      buttonDown: makeButtonRecord(false),
      buttonJustPressed: makeButtonRecord(false),
      buttonJustReleased: makeButtonRecord(false),
      gamepadConnected: false,
      gamepadCount: 0,
      gamepadName: null,
    };
  }
}
