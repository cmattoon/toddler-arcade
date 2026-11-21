export type ShapeButton = 'X1' | 'X2' | 'X3' | 'X4' | 'X5' | 'X6';

export type ShapeKind =
  | 'square'
  | 'circle'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'heart';

export type SplitColorButton =
  | 'R1'
  | 'R2'
  | 'G1'
  | 'G2'
  | 'B1'
  | 'B2'
  | 'Y1'
  | 'Y2';

export type MergedColorButton = 'RED' | 'GREEN' | 'BLUE' | 'YELLOW';

export type PhysicalButton =
  | SplitColorButton
  | ShapeButton
  | 'OK'
  | 'ESC';

/**
 * Logical + Physical cabinet buttons:
 * - In simple modes, `RED` = `R1 || R2`, `GREEN` = `G1 || G2`, `BLUE` = `B1 || B2`, `YELLOW` = `Y1 || Y2`.
 * - In advanced modes, games can bind directly to `R1`..`Y2` (e.g. top = `+`, bottom = `-`) and `X1`..`X6` shapes.
 */
export type CabinetButton = PhysicalButton | MergedColorButton;

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export const SHAPE_BUTTON_LIST: ShapeButton[] = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];

export const SHAPE_BUTTON_META: Record<
  ShapeButton,
  { shape: ShapeKind; label: string; row: 0 | 1; col: 0 | 1 | 2 }
> = {
  X1: { shape: 'square', label: 'Square', row: 0, col: 0 },
  X2: { shape: 'circle', label: 'Circle', row: 0, col: 1 },
  X3: { shape: 'triangle', label: 'Triangle', row: 0, col: 2 },
  X4: { shape: 'diamond', label: 'Diamond', row: 1, col: 0 },
  X5: { shape: 'star', label: 'Star', row: 1, col: 1 },
  X6: { shape: 'heart', label: 'Heart', row: 1, col: 2 },
};

export type ControlIcon =
  | 'engine'
  | 'horn'
  | 'brake'
  | 'palette'
  | 'car'
  | 'spray'
  | 'bubbles'
  | 'wind'
  | 'forkLeft'
  | 'forkStraight'
  | 'forkRight'
  | 'ok'
  | 'back'
  | 'skip'
  | 'square'
  | 'circle'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'heart'
  | 'plus'
  | 'minus'
  | 'music'
  | 'paw'
  | 'block';

export type DevelopmentalTag =
  | 'A1' | 'A2' | 'A3'
  | 'B1' | 'B2' | 'B3' | 'B4' | 'B5'
  | 'C1' | 'C2' | 'C3'
  | 'D1' | 'D2' | 'D3'
  | 'E1' | 'E2' | 'E3' | 'E4'
  | 'F1' | 'F2' | 'F3'
  | 'G1' | 'G2' | 'G3';

export interface DevelopmentalMetadata {
  /** Parent-facing category label (e.g. "Cause & Effect · Memory") */
  parentCategory: string;
  /** Primary skill tag(s) from toddler-arcade-developmental-guide.md */
  primaryTags: DevelopmentalTag[];
  secondaryTags?: DevelopmentalTag[];
}

export interface GameControlDescriptor<Action extends string = string> {
  action: Action;
  button: CabinetButton;
  label: string;
  icon: ControlIcon;
}

export interface DeckVisualOverride {
  /** 'merged4' treats R1+R2, G1+G2, B1+B2, Y1+Y2 as 4 unified color pairs; 'split8' shows independent top/bottom rows */
  colorMode: 'merged4' | 'split8';
  /** Optional labels underneath the 4 color columns */
  columnLabels?: Partial<Record<MergedColorButton, string>>;
  /** Optional icons on top/bottom split color buttons when colorMode === 'split8' */
  splitIcons?: Partial<Record<SplitColorButton, ControlIcon>>;
  /** Whether the 6 white shape buttons are active in the current activity */
  shapesActive?: boolean;
  /** Currently selected/highlighted white shape button (if any) */
  selectedShape?: ShapeButton | null;
}

export interface CabinetSnapshot {
  /** Normalized -1 (left) to +1 (right) */
  axisX: number;
  /** Normalized -1 (up) to +1 (down) */
  axisY: number;
  dirDown: Record<Direction, boolean>;
  dirJustPressed: Record<Direction, boolean>;
  buttonDown: Record<CabinetButton, boolean>;
  buttonJustPressed: Record<CabinetButton, boolean>;
  buttonJustReleased: Record<CabinetButton, boolean>;
  gamepadConnected: boolean;
  gamepadCount: number;
  gamepadName: string | null;
}

export interface GameInput<Action extends string = string> {
  axisX: number;
  axisY: number;
  dirDown: Record<Direction, boolean>;
  dirJustPressed: Record<Direction, boolean>;
  snapshot: CabinetSnapshot;
  isDown(action: Action): boolean;
  justPressed(action: Action): boolean;
  justReleased(action: Action): boolean;
  isButtonDown(button: CabinetButton): boolean;
  justPressedButton(button: CabinetButton): boolean;
}

export interface GameContext {
  audio: import('./audio').ArcadeAudio;
}

export interface ArcadeGameInstance<Action extends string = string> {
  update(dt: number, input: GameInput<Action>): void;
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  /** Optional pointer tap handler for touch/click interactions inside the game viewport */
  onPointerDown?(x: number, y: number, width: number, height: number): void;
  /** Optional list of cabinet buttons to flash in the UI (e.g. steps still needed) */
  getFlashingButtons?(): CabinetButton[];
  /** Optional dynamic deck visual state (e.g. switching between merged 4-color and split +/- rows) */
  getDeckOverride?(): DeckVisualOverride;
  destroy(): void;
}

export interface ArcadeGameDefinition<Action extends string = string> {
  id: string;
  title: string;
  subtitle: string;
  accentColor: string;
  developmental?: DevelopmentalMetadata;
  controls: GameControlDescriptor<Action>[];
  /** Draws the animated or static cover illustration inside a rounded card */
  renderCover(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    selected: boolean
  ): void;
  create(context: GameContext): ArcadeGameInstance<Action>;
}

/** Supports either a button index on any connected gamepad (`number`) or a specific `(pad, button)` pair for dual-encoder builds */
export type GamepadButtonSlot = number | { pad: number; button: number };

export interface GamepadMappingConfig {
  /** Maps each physical/logical cabinet button to one or more USB encoder button slots */
  buttons: Record<CabinetButton, GamepadButtonSlot[]>;
  /** Gamepad index for the joystick (default 0) */
  stickPadIndex?: number;
  /** Axis index for horizontal stick (usually 0 on EG STARTS Zero Delay encoder) */
  axisXIndex: number;
  /** Axis index for vertical stick (usually 1 on EG STARTS Zero Delay encoder) */
  axisYIndex: number;
  invertX: boolean;
  invertY: boolean;
}
