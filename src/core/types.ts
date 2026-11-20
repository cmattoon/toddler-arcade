export type CabinetButton = 'GREEN' | 'YELLOW' | 'RED' | 'BLUE' | 'OK' | 'ESC';

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type ControlIcon =
  | 'engine'
  | 'horn'
  | 'brake'
  | 'palette'
  | 'car'
  | 'spray'
  | 'bubbles'
  | 'wind'
  | 'ok'
  | 'back'
  | 'skip';

export interface GameControlDescriptor<Action extends string = string> {
  action: Action;
  button: CabinetButton;
  label: string;
  icon: ControlIcon;
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
  gamepadName: string | null;
}

export interface GameInput<Action extends string = string> {
  axisX: number;
  axisY: number;
  dirDown: Record<Direction, boolean>;
  dirJustPressed: Record<Direction, boolean>;
  isDown(action: Action): boolean;
  justPressed(action: Action): boolean;
  justReleased(action: Action): boolean;
}

export interface GameContext {
  audio: import('./audio').ArcadeAudio;
}

export interface ArcadeGameInstance<Action extends string = string> {
  update(dt: number, input: GameInput<Action>): void;
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  /** Optional list of cabinet buttons to flash in the UI (e.g. steps still needed) */
  getFlashingButtons?(): CabinetButton[];
  destroy(): void;
}

export interface ArcadeGameDefinition<Action extends string = string> {
  id: string;
  title: string;
  subtitle: string;
  accentColor: string;
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

export interface GamepadMappingConfig {
  /** Maps each logical cabinet button to one or more USB encoder button indices (0..15) */
  buttons: Record<CabinetButton, number[]>;
  /** Axis index for horizontal stick (usually 0 on EG STARTS Zero Delay encoder) */
  axisXIndex: number;
  /** Axis index for vertical stick (usually 1 on EG STARTS Zero Delay encoder) */
  axisYIndex: number;
  invertX: boolean;
  invertY: boolean;
}
