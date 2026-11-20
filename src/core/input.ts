import {
  CabinetButton,
  CabinetSnapshot,
  Direction,
  GameControlDescriptor,
  GameInput,
  GamepadMappingConfig,
} from './types';

const STORAGE_KEY = 'toddler_arcade_gamepad_v1';
const AXIS_DEADZONE = 0.35;

export const ALL_CABINET_BUTTONS: CabinetButton[] = [
  'GREEN',
  'YELLOW',
  'RED',
  'BLUE',
  'OK',
  'ESC',
];

export const ALL_DIRECTIONS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

export function createDefaultMapping(): GamepadMappingConfig {
  return {
    // Typical Zero Delay USB Encoder header defaults (K1..K4 = 0..3, Coin/1P = 8..11)
    buttons: {
      GREEN: [0],
      YELLOW: [1],
      RED: [2],
      BLUE: [3],
      OK: [9, 0], // 1-Player Start (or Green button) confirms in menu
      ESC: [8, 6], // Coin / Select / Back button returns to menu
    },
    axisXIndex: 0,
    axisYIndex: 1,
    invertX: false,
    invertY: false,
  };
}

const KEYBOARD_MAP: Record<string, CabinetButton | Direction> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyW: 'UP',
  KeyS: 'DOWN',
  KeyA: 'LEFT',
  KeyD: 'RIGHT',

  Digit1: 'GREEN',
  KeyZ: 'GREEN',
  KeyG: 'GREEN',

  Digit2: 'YELLOW',
  KeyX: 'YELLOW',
  KeyY: 'YELLOW',

  Digit3: 'RED',
  KeyC: 'RED',
  KeyR: 'RED',

  Digit4: 'BLUE',
  KeyV: 'BLUE',
  KeyB: 'BLUE',

  Enter: 'OK',
  Space: 'OK',

  Escape: 'ESC',
  Backspace: 'ESC',
};

export interface RawGamepadDebug {
  connected: boolean;
  id: string | null;
  pressedButtons: number[];
  axes: number[];
}

export class InputManager {
  private mapping: GamepadMappingConfig;
  private keysDown = new Set<string>();
  private latchedKeys = new Set<string>();
  private virtualButtonsDown = new Set<CabinetButton>();
  private latchedVirtualButtons = new Set<CabinetButton>();
  private virtualDirsDown = new Set<Direction>();
  private latchedVirtualDirs = new Set<Direction>();

  private prevButtons: Record<CabinetButton, boolean> = {
    GREEN: false,
    YELLOW: false,
    RED: false,
    BLUE: false,
    OK: false,
    ESC: false,
  };

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
      // On macOS, holding Cmd/Ctrl suppresses keyup events for letter keys (e.g. Cmd+R),
      // which would otherwise leave 'KeyR' stuck in keysDown! Clear held keys on modifiers.
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

  private getActiveGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (pad && pad.connected) {
        return pad;
      }
    }
    return null;
  }

  public getRawGamepadDebug(): RawGamepadDebug {
    const pad = this.getActiveGamepad();
    if (!pad) {
      return { connected: false, id: null, pressedButtons: [], axes: [] };
    }
    const pressedButtons: number[] = [];
    pad.buttons.forEach((b, idx) => {
      if (b && (b.pressed || b.value > 0.5)) {
        pressedButtons.push(idx);
      }
    });
    return {
      connected: true,
      id: pad.id,
      pressedButtons,
      axes: pad.axes.map((a) => Number(a.toFixed(2))),
    };
  }

  public poll(): CabinetSnapshot {
    const pad = this.getActiveGamepad();

    const buttonDown: Record<CabinetButton, boolean> = {
      GREEN: false,
      YELLOW: false,
      RED: false,
      BLUE: false,
      OK: false,
      ESC: false,
    };

    const dirDown: Record<Direction, boolean> = {
      UP: false,
      DOWN: false,
      LEFT: false,
      RIGHT: false,
    };

    let axisX = 0;
    let axisY = 0;

    // 1. Read keyboard (both currently held and sub-frame latched taps)
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

    // Also let Green button keyboard keys act as OK if needed by menu
    if (activeCodes.has('Digit1') || activeCodes.has('KeyZ')) {
      buttonDown.OK = true;
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

    // 3. Read USB HID Gamepad (EG STARTS / Zero Delay Encoder or standard controller)
    if (pad) {
      for (const cabBtn of ALL_CABINET_BUTTONS) {
        const indices = this.mapping.buttons[cabBtn] ?? [];
        for (const idx of indices) {
          const gpBtn = pad.buttons[idx];
          if (gpBtn && (gpBtn.pressed || gpBtn.value > 0.5)) {
            buttonDown[cabBtn] = true;
          }
        }
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

      // Support D-pad buttons 12..15 (in case encoder MODE switched to D-pad buttons)
      if (pad.buttons[12]?.pressed) dirDown.UP = true;
      if (pad.buttons[13]?.pressed) dirDown.DOWN = true;
      if (pad.buttons[14]?.pressed) dirDown.LEFT = true;
      if (pad.buttons[15]?.pressed) dirDown.RIGHT = true;
    }

    // Synthesize normalized digital axis if keyboard/virtual D-pad was used
    if (axisX === 0) {
      if (dirDown.LEFT && !dirDown.RIGHT) axisX = -1;
      else if (dirDown.RIGHT && !dirDown.LEFT) axisX = 1;
    }
    if (axisY === 0) {
      if (dirDown.UP && !dirDown.DOWN) axisY = -1;
      else if (dirDown.DOWN && !dirDown.UP) axisY = 1;
    }

    const buttonJustPressed = {} as Record<CabinetButton, boolean>;
    const buttonJustReleased = {} as Record<CabinetButton, boolean>;
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
      gamepadConnected: !!pad,
      gamepadName: pad ? pad.id : null,
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
    };
  }

  private createEmptySnapshot(): CabinetSnapshot {
    return {
      axisX: 0,
      axisY: 0,
      dirDown: { UP: false, DOWN: false, LEFT: false, RIGHT: false },
      dirJustPressed: { UP: false, DOWN: false, LEFT: false, RIGHT: false },
      buttonDown: {
        GREEN: false,
        YELLOW: false,
        RED: false,
        BLUE: false,
        OK: false,
        ESC: false,
      },
      buttonJustPressed: {
        GREEN: false,
        YELLOW: false,
        RED: false,
        BLUE: false,
        OK: false,
        ESC: false,
      },
      buttonJustReleased: {
        GREEN: false,
        YELLOW: false,
        RED: false,
        BLUE: false,
        OK: false,
        ESC: false,
      },
      gamepadConnected: false,
      gamepadName: null,
    };
  }
}
