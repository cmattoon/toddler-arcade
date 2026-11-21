import {
  CabinetButton,
  CabinetSnapshot,
  Direction,
  GameControlDescriptor,
  GameInput,
  GamepadButtonSlot,
  GamepadMappingConfig,
  PanelType,
  PhysicalButton,
} from './types';

const STORAGE_KEY = 'toddler_arcade_gamepad_v3';
const AXIS_DEADZONE = 0.35;

/** 12 physical buttons present on the Type 1 (EG STARTS) control panel */
export const TYPE1_PHYSICAL_BUTTONS: PhysicalButton[] = [
  'R1',
  'G1',
  'B1',
  'Y1',
  'ESC',
  'OK',
  'X1',
  'X2',
  'X3',
  'X4',
  'X5',
  'X6',
];

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

/**
 * Creates default USB HID button mappings for the chosen hardware panel profile:
 *
 * Type 1 — EG STARTS Zero Delay 12-Button USB Encoder (pad-agnostic B0..B11):
 *   B0  -> Red            (R1 / RED)
 *   B1  -> Green          (G1 / GREEN)
 *   B2  -> Blue           (B1 / BLUE)
 *   B3  -> Yellow         (Y1 / YELLOW)
 *   B4  -> White Triangle (X3)
 *   B5  -> White Star     (X5)
 *   B6  -> White Heart    (X6)
 *   B7  -> White Circle   (X2)
 *   B8  -> OK / Enter     (OK)
 *   B9  -> ESC / Back     (ESC)
 *   B10 -> White Diamond  (X4)
 *   B11 -> White Square   (X1)
 *
 * Type 2 — Expanded 16+ Button Dual-Row Colored Panel (for future 30-32 button board):
 *   Adds independent R2, G2, B2, Y2 bottom colored row.
 */
export function createDefaultMapping(panelType: PanelType = 'type1'): GamepadMappingConfig {
  if (panelType === 'type1') {
    return {
      panelType: 'type1',
      buttons: {
        R1: [0], // Red
        G1: [1], // Green
        B1: [2], // Blue
        Y1: [3], // Yellow
        X3: [4], // White · Triangle
        X5: [5], // White · Star
        X6: [6], // White · Heart
        X2: [7], // White · Circle
        OK: [8], // OK (Enter)
        ESC: [9], // ESC (Back)
        X4: [10], // White · Diamond
        X1: [11], // White · Square
        R2: [],
        G2: [],
        B2: [],
        Y2: [],
        RED: [],
        GREEN: [],
        BLUE: [],
        YELLOW: [],
      },
      stickPadIndex: undefined,
      stickPadLocked: false,
      axisXIndex: 0,
      axisYIndex: 1,
      invertX: false,
      invertY: false,
    };
  }

  return {
    panelType: 'type2',
    buttons: {
      R1: [0],
      G1: [1],
      B1: [2],
      Y1: [3],
      R2: [4],
      G2: [5],
      B2: [6],
      Y2: [7],
      ESC: [8],
      OK: [9],
      X1: [10],
      X2: [11],
      X3: [12],
      X4: [13],
      X5: [14],
      X6: [15],
      RED: [],
      GREEN: [],
      BLUE: [],
      YELLOW: [],
    },
    stickPadIndex: undefined,
    stickPadLocked: false,
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
  stickPad: number;
  pressedButtons: PressedPadButton[];
  axes: number[];
  axesCompact: string;
}

export type StickCalibrationStep = 'RIGHT' | 'RELEASE' | 'DOWN' | null;

/**
 * Decodes Chromium's raw USB HID 8-way POV Hat Switch exposed on axes[9].
 * In Chromium's Gamepad API (macOS RawInputDataFetcherMac & Linux hidraw),
 * an 8-way hat switch rests at +1.2857 (9/7, or > 1.08) and encodes
 * compass steps 0..7 (N, NE, E, SE, S, SW, W, NW) as (2 * step - 7) / 7 in [-1.0, +1.0].
 */
function decodeChromiumPovHat(val: number): { x: number; y: number } | null {
  if (!Number.isFinite(val) || val < -1.06 || val > 1.06) {
    return null;
  }
  const step = Math.round(((val + 1) * 7) / 2);
  const expected = (2 * step - 7) / 7;
  if (step < 0 || step > 7 || Math.abs(val - expected) > 0.08) {
    return null;
  }
  switch (step) {
    case 0:
      return { x: 0, y: -1 }; // UP (N)
    case 1:
      return { x: 1, y: -1 }; // UP + RIGHT (NE)
    case 2:
      return { x: 1, y: 0 }; // RIGHT (E)
    case 3:
      return { x: 1, y: 1 }; // DOWN + RIGHT (SE)
    case 4:
      return { x: 0, y: 1 }; // DOWN (S)
    case 5:
      return { x: -1, y: 1 }; // DOWN + LEFT (SW)
    case 6:
      return { x: -1, y: 0 }; // LEFT (W)
    case 7:
      return { x: -1, y: -1 }; // UP + LEFT (NW)
    default:
      return null;
  }
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

  /** Tracks initial resting axis values per pad so stuck virtual triggers (-1.0) don't false-fire */
  private padInitialAxes = new Map<number, number[]>();
  /** Tracks which `${padIndex}:${axisIndex}` channels have visibly changed since connection */
  private padMovedAxes = new Set<string>();
  /** Tracks pads whose axes[9] has been observed in neutral POV Hat state (> 1.08) */
  private hatCapablePads = new Set<number>();

  /** Interactive 2-step joystick calibration state ('RIGHT' -> 'RELEASE' -> 'DOWN') */
  private stickCalibStep: StickCalibrationStep = null;
  private stickCalibBaseline = new Map<number, number[]>();
  private stickCalibButtonsBaseline: PressedPadButton[] = [];
  private stickCalibCapturedX: {
    pad: number;
    axis?: number;
    invertX?: boolean;
    hat?: boolean;
    rightBtn?: GamepadButtonSlot;
  } | null = null;

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
        const pType: PanelType = parsed.panelType === 'type2' ? 'type2' : 'type1';
        const def = createDefaultMapping(pType);
        const locked = parsed.stickPadLocked === true;
        return {
          ...def,
          ...parsed,
          panelType: pType,
          // Unlock legacy stickPadIndex: 0 so multi-controller setups read P1/P2 joysticks automatically!
          stickPadLocked: locked,
          stickPadIndex: locked ? parsed.stickPadIndex : undefined,
          buttons: {
            ...def.buttons,
            ...(parsed.buttons ?? {}),
          },
        };
      }
    } catch {
      // Ignore corrupt storage
    }
    return createDefaultMapping('type1');
  }

  public saveMapping(next: GamepadMappingConfig): void {
    this.mapping = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors in private/restricted kiosk profiles
    }
  }

  public setPanelType(panelType: PanelType): void {
    const fresh = createDefaultMapping(panelType);
    fresh.invertX = this.mapping.invertX;
    fresh.invertY = this.mapping.invertY;
    this.saveMapping(fresh);
  }

  public resetMapping(): void {
    this.stickCalibStep = null;
    this.saveMapping(createDefaultMapping(this.mapping.panelType));
  }

  public getMapping(): GamepadMappingConfig {
    return this.mapping;
  }

  public getStickCalibrationStep(): StickCalibrationStep {
    return this.stickCalibStep;
  }

  public startStickCalibration(): void {
    const connected = this.getConnectedGamepads();
    this.stickCalibBaseline.clear();
    this.stickCalibButtonsBaseline = [];
    for (const { index, pad } of connected) {
      this.stickCalibBaseline.set(index, [...pad.axes]);
      pad.buttons.forEach((b, btnIdx) => {
        if (b && (b.pressed || b.value > 0.5)) {
          this.stickCalibButtonsBaseline.push({ pad: index, button: btnIdx });
        }
      });
    }
    this.stickCalibCapturedX = null;
    this.stickCalibStep = 'RIGHT';
  }

  public cancelStickCalibration(): void {
    this.stickCalibStep = null;
    this.stickCalibCapturedX = null;
  }

  /**
   * Advances interactive 2-step joystick calibration ('RIGHT' -> 'RELEASE' -> 'DOWN').
   * Returns 'step' when advancing to DOWN, 'done' when finished, or null if waiting.
   */
  public updateStickCalibration(): 'step' | 'done' | null {
    if (!this.stickCalibStep) return null;
    const connected = this.getConnectedGamepads();
    if (connected.length === 0) return null;

    if (this.stickCalibStep === 'RIGHT') {
      for (const { index, pad } of connected) {
        const base = this.stickCalibBaseline.get(index) ?? pad.axes.map(() => 0);

        // 1. Check POV Hat on axes[9]
        if (pad.axes.length >= 10 && (this.hatCapablePads.has(index) || (base[9] ?? 0) > 1.08)) {
          const hat = decodeChromiumPovHat(pad.axes[9]);
          if (hat && Math.abs(hat.x) > 0.5) {
            this.hatCapablePads.add(index);
            this.saveMapping({
              ...this.mapping,
              stickPadIndex: index,
              stickPadLocked: true,
              invertX: hat.x < 0,
              dirButtons: undefined,
            });
            this.stickCalibStep = null;
            return 'done';
          }
        }

        // 2. Check analog/digital axes 0..8 for strongest deflection from baseline
        let bestAxis = -1;
        let bestDelta = 0;
        let bestVal = 0;
        const maxAxis = Math.min(pad.axes.length, 9);
        for (let a = 0; a < maxAxis; a++) {
          const val = pad.axes[a] ?? 0;
          const bVal = base[a] ?? 0;
          const delta = val - bVal;
          if (Math.abs(delta) > 0.45 && Math.abs(delta) > Math.abs(bestDelta)) {
            bestAxis = a;
            bestDelta = delta;
            bestVal = val;
          }
        }
        if (bestAxis >= 0) {
          this.stickCalibCapturedX = {
            pad: index,
            axis: bestAxis,
            invertX: bestVal < (base[bestAxis] ?? 0),
          };
          this.stickCalibStep = 'RELEASE';
          return 'step';
        }

        // 3. Check if joystick switches are wired to gamepad buttons (e.g. D-pad 12..15)
        for (let bIdx = 0; bIdx < pad.buttons.length; bIdx++) {
          const b = pad.buttons[bIdx];
          const wasDown = this.stickCalibButtonsBaseline.some(
            (p) => p.pad === index && p.button === bIdx
          );
          if (b && (b.pressed || b.value > 0.5) && !wasDown) {
            // Standard D-pad buttons 12..15 can all be inferred at once if standard
            if (bIdx === 15 && pad.buttons.length >= 16) {
              this.saveMapping({
                ...this.mapping,
                stickPadIndex: index,
                stickPadLocked: true,
                invertX: false,
                invertY: false,
                dirButtons: {
                  UP: [{ pad: index, button: 12 }],
                  DOWN: [{ pad: index, button: 13 }],
                  LEFT: [{ pad: index, button: 14 }],
                  RIGHT: [{ pad: index, button: 15 }],
                },
              });
              this.stickCalibStep = null;
              return 'done';
            }
          }
        }
      }
      return null;
    }

    if (this.stickCalibStep === 'RELEASE') {
      const cap = this.stickCalibCapturedX;
      if (!cap || cap.axis === undefined) {
        this.stickCalibStep = 'DOWN';
        return null;
      }
      const target = connected.find((c) => c.index === cap.pad)?.pad;
      const base = this.stickCalibBaseline.get(cap.pad) ?? [];
      const curX = target?.axes[cap.axis] ?? 0;
      if (Math.abs(curX - (base[cap.axis] ?? 0)) < 0.25) {
        // Re-snapshot centered baseline before measuring DOWN
        if (target) {
          this.stickCalibBaseline.set(cap.pad, [...target.axes]);
        }
        this.stickCalibStep = 'DOWN';
      }
      return null;
    }

    if (this.stickCalibStep === 'DOWN') {
      const cap = this.stickCalibCapturedX;
      if (!cap) {
        this.stickCalibStep = null;
        return null;
      }
      const target = connected.find((c) => c.index === cap.pad)?.pad;
      if (!target) return null;
      const base = this.stickCalibBaseline.get(cap.pad) ?? target.axes.map(() => 0);

      let bestAxis = -1;
      let bestDelta = 0;
      let bestVal = 0;
      const maxAxis = Math.min(target.axes.length, 9);
      for (let a = 0; a < maxAxis; a++) {
        if (a === cap.axis) continue;
        const val = target.axes[a] ?? 0;
        const bVal = base[a] ?? 0;
        const delta = val - bVal;
        if (Math.abs(delta) > 0.45 && Math.abs(delta) > Math.abs(bestDelta)) {
          bestAxis = a;
          bestDelta = delta;
          bestVal = val;
        }
      }

      if (bestAxis >= 0 && cap.axis !== undefined) {
        this.saveMapping({
          ...this.mapping,
          stickPadIndex: cap.pad,
          stickPadLocked: true,
          axisXIndex: cap.axis,
          axisYIndex: bestAxis,
          invertX: !!cap.invertX,
          invertY: bestVal < (base[bestAxis] ?? 0),
          dirButtons: undefined,
        });
        this.stickCalibStep = null;
        this.stickCalibCapturedX = null;
        return 'done';
      }
    }

    return null;
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
        this.trackPadBaselines(i, p);
      }
    }
    return out;
  }

  private trackPadBaselines(index: number, pad: Gamepad): void {
    if (!this.padInitialAxes.has(index)) {
      this.padInitialAxes.set(index, [...pad.axes]);
    }
    const init = this.padInitialAxes.get(index)!;
    for (let a = 0; a < pad.axes.length; a++) {
      const v = pad.axes[a] ?? 0;
      if (init[a] === undefined) init[a] = v;
      if (Math.abs(v - init[a]) > 0.3) {
        this.padMovedAxes.add(`${index}:${a}`);
      }
    }
    if (pad.axes.length >= 10 && (pad.axes[9] ?? 0) > 1.08) {
      this.hatCapablePads.add(index);
    }
  }

  /** Infers which gamepad index corresponds to the arcade encoder for debug display */
  private inferPrimaryArcadePad(connected: Array<{ index: number; pad: Gamepad }>): {
    index: number;
    pad: Gamepad;
  } {
    // 1. Prefer explicitly calibrated stick pad if connected
    if (this.mapping.stickPadLocked && this.mapping.stickPadIndex !== undefined) {
      const locked = connected.find((c) => c.index === this.mapping.stickPadIndex);
      if (locked) return locked;
    }

    // 2. Prefer any pad currently showing active stick deflection or button press
    for (const c of connected) {
      const hasBtn = c.pad.buttons.some((b) => b && (b.pressed || b.value > 0.5));
      if (hasBtn) return c;
      if (this.hatCapablePads.has(c.index) && decodeChromiumPovHat(c.pad.axes[9] ?? 9)) {
        return c;
      }
      const x = this.readSafeAxis(c.index, c.pad, this.mapping.axisXIndex);
      const y = this.readSafeAxis(c.index, c.pad, this.mapping.axisYIndex);
      if (Math.abs(x) > AXIS_DEADZONE || Math.abs(y) > AXIS_DEADZONE) {
        return c;
      }
    }

    // 3. Prefer the pad index referenced by remapped arcade buttons (e.g. P2 in multi-pad setups)
    const padCounts = new Map<number, number>();
    for (const cabBtn of ALL_PHYSICAL_BUTTONS) {
      for (const slot of this.mapping.buttons[cabBtn] ?? []) {
        if (typeof slot === 'object' && slot !== null) {
          padCounts.set(slot.pad, (padCounts.get(slot.pad) ?? 0) + 1);
        }
      }
    }
    let bestPadIdx = -1;
    let bestCount = 0;
    for (const [pIdx, cnt] of padCounts.entries()) {
      if (cnt > bestCount && connected.some((c) => c.index === pIdx)) {
        bestPadIdx = pIdx;
        bestCount = cnt;
      }
    }
    if (bestPadIdx >= 0) {
      return connected.find((c) => c.index === bestPadIdx)!;
    }

    // 4. Prefer a USB joystick/encoder over virtual drivers if present
    const nonVirtual = connected.find((c) => !/virtual/i.test(c.pad.id));
    return nonVirtual ?? connected[0];
  }

  /**
   * Reads an axis while ignoring unmoved axes that started stuck away from zero
   * (such as idle analog triggers resting at -1.0 on virtual/flight controllers).
   */
  private readSafeAxis(padIndex: number, pad: Gamepad, axisIndex: number): number {
    const val = pad.axes[axisIndex];
    if (val === undefined || !Number.isFinite(val)) return 0;
    const init = this.padInitialAxes.get(padIndex)?.[axisIndex] ?? 0;
    if (Math.abs(init) > 0.5 && !this.padMovedAxes.has(`${padIndex}:${axisIndex}`)) {
      return 0;
    }
    return val;
  }

  public getRawGamepadDebug(): RawGamepadDebug {
    const connected = this.getConnectedGamepads();
    if (connected.length === 0) {
      return {
        connected: false,
        count: 0,
        id: null,
        stickPad: 0,
        pressedButtons: [],
        axes: [],
        axesCompact: 'none',
      };
    }
    const pressedButtons: PressedPadButton[] = [];
    for (const { index, pad } of connected) {
      pad.buttons.forEach((b, btnIdx) => {
        if (b && (b.pressed || b.value > 0.5)) {
          pressedButtons.push({ pad: index, button: btnIdx });
        }
      });
    }
    const primary = this.inferPrimaryArcadePad(connected);
    const axes = primary.pad.axes.map((a) => Number(a.toFixed(2)));

    // Build concise summary showing configured X/Y plus any moving extra axis or POV Hat
    const parts: string[] = [];
    const xIdx = this.mapping.axisXIndex;
    const yIdx = this.mapping.axisYIndex;
    if (axes[xIdx] !== undefined) parts.push(`A${xIdx}:${axes[xIdx].toFixed(2)}`);
    if (axes[yIdx] !== undefined && yIdx !== xIdx) parts.push(`A${yIdx}:${axes[yIdx].toFixed(2)}`);
    for (let a = 0; a < axes.length; a++) {
      if (a === xIdx || a === yIdx) continue;
      if (a === 9 && this.hatCapablePads.has(primary.index)) {
        const hat = decodeChromiumPovHat(primary.pad.axes[9]);
        if (hat) parts.push(`Hat:[${hat.x},${hat.y}]`);
        continue;
      }
      if (this.padMovedAxes.has(`${primary.index}:${a}`) && Math.abs(axes[a]) > 0.25) {
        parts.push(`A${a}:${axes[a].toFixed(2)}`);
      }
    }

    return {
      connected: true,
      count: connected.length,
      id: connected.map((c) => `#${c.index}:${c.pad.id.slice(0, 22)}`).join(' + '),
      stickPad: primary.index,
      pressedButtons,
      axes,
      axesCompact: parts.join(', ') || '0, 0',
    };
  }

  private isSlotPressed(
    slot: GamepadButtonSlot,
    padMap: Map<number, Gamepad>,
    connected: Array<{ index: number; pad: Gamepad }>
  ): boolean {
    if (typeof slot === 'number') {
      // Pad-agnostic slot: works on whichever USB port/index the arcade encoder enumerates at!
      for (const { pad } of connected) {
        const b = pad.buttons[slot];
        if (b && (b.pressed || b.value > 0.5)) return true;
      }
      return false;
    }
    const target = padMap.get(slot.pad);
    if (target) {
      const b = target.buttons[slot.button];
      return !!(b && (b.pressed || b.value > 0.5));
    }
    // Fallback if another USB controller was unplugged and shifted gamepad indices
    for (const { pad } of connected) {
      const b = pad.buttons[slot.button];
      if (b && (b.pressed || b.value > 0.5)) return true;
    }
    return false;
  }

  public poll(): CabinetSnapshot {
    const connected = this.getConnectedGamepads();
    const padMap = new Map<number, Gamepad>(connected.map((c) => [c.index, c.pad]));

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
          if (this.isSlotPressed(slot, padMap, connected)) {
            buttonDown[cabBtn] = true;
          }
        }
      }

      // Check optional button-mapped joystick directions
      if (this.mapping.dirButtons) {
        for (const dir of ALL_DIRECTIONS) {
          for (const slot of this.mapping.dirButtons[dir] ?? []) {
            if (this.isSlotPressed(slot, padMap, connected)) {
              dirDown[dir] = true;
            }
          }
        }
      }

      const lockToSinglePad =
        this.mapping.stickPadLocked === true &&
        this.mapping.stickPadIndex !== undefined &&
        padMap.has(this.mapping.stickPadIndex);

      // Poll joystick across ALL connected gamepads (or the calibrated stickPadIndex if locked)
      for (const { index, pad } of connected) {
        // Standard 16+ button D-pad (buttons 12..15) — note: 12-btn encoders only have 0..11
        if (pad.mapping === 'standard' || pad.buttons.length >= 16) {
          if (pad.buttons[12]?.pressed) dirDown.UP = true;
          if (pad.buttons[13]?.pressed) dirDown.DOWN = true;
          if (pad.buttons[14]?.pressed) dirDown.LEFT = true;
          if (pad.buttons[15]?.pressed) dirDown.RIGHT = true;
        }

        if (lockToSinglePad && index !== this.mapping.stickPadIndex) {
          continue;
        }

        // A) Configured X/Y axes (defaults to axes[0] & axes[1])
        let padX = this.readSafeAxis(index, pad, this.mapping.axisXIndex);
        let padY = this.readSafeAxis(index, pad, this.mapping.axisYIndex);

        // B) Secondary raw HID encoder axis pairs (e.g. Z/Rz on axes[2]/axes[5] or axes[2]/axes[3] when MODE toggled)
        if (
          !this.mapping.stickPadLocked &&
          pad.mapping === '' &&
          Math.abs(padX) <= AXIS_DEADZONE &&
          Math.abs(padY) <= AXIS_DEADZONE
        ) {
          const altPairs: Array<[number, number]> = [
            [2, 5],
            [2, 3],
            [3, 4],
          ];
          for (const [ax, ay] of altPairs) {
            const cx = this.padMovedAxes.has(`${index}:${ax}`) ? (pad.axes[ax] ?? 0) : 0;
            const cy = this.padMovedAxes.has(`${index}:${ay}`) ? (pad.axes[ay] ?? 0) : 0;
            if (Math.abs(cx) > AXIS_DEADZONE || Math.abs(cy) > AXIS_DEADZONE) {
              padX = cx;
              padY = cy;
              break;
            }
          }
        }

        // C) Chromium 8-way USB HID POV Hat Switch on axes[9] (very common on Generic USB Joystick 0079:0006!)
        if (
          pad.axes.length >= 10 &&
          this.hatCapablePads.has(index) &&
          Math.abs(padX) <= AXIS_DEADZONE &&
          Math.abs(padY) <= AXIS_DEADZONE
        ) {
          const hat = decodeChromiumPovHat(pad.axes[9]);
          if (hat) {
            padX = hat.x;
            padY = hat.y;
          }
        }

        const adjX = this.mapping.invertX ? -padX : padX;
        const adjY = this.mapping.invertY ? -padY : padY;

        if (Math.abs(adjX) > AXIS_DEADZONE && Math.abs(adjX) >= Math.abs(axisX)) {
          axisX = adjX;
          if (adjX < -AXIS_DEADZONE) dirDown.LEFT = true;
          if (adjX > AXIS_DEADZONE) dirDown.RIGHT = true;
        }
        if (Math.abs(adjY) > AXIS_DEADZONE && Math.abs(adjY) >= Math.abs(axisY)) {
          axisY = adjY;
          if (adjY < -AXIS_DEADZONE) dirDown.UP = true;
          if (adjY > AXIS_DEADZONE) dirDown.DOWN = true;
        }
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
