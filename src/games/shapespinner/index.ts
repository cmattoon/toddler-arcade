/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: shape-spinner
 * activity: single-shape-color-and-spin
 * primary_tags: [A1, C1]
 * secondary_tags: [B2, G1]
 * concept:
 *   - One large, calm geometric icon in the center of the screen responds directly to every control without visual clutter.
 *   - Colored buttons choose its color, white shape buttons choose its shape, and joystick direction spins it clockwise or counter-clockwise.
 * child_action: "Move the joystick in any direction (or stir it in circles) to spin the shape; press colored buttons to change its color and white buttons to change its shape."
 * complexity_step: "Notice direct 1-to-1 cause and effect across shape, color, and rotational direction."
 * not_complexity: "No distractions, background clutter, timers, or wrong buttons."
 * feedback: "The center icon smoothly accelerates in the direction pushed, coasts with gentle wooden spinner ticks, and pops softly when changing shape or color."
 * real_world_extension: "Spin a wooden top, lazy Susan, or pinwheel in both directions with your hand."
 */

import {
  CABINET_COLOR_COLUMNS,
  CABINET_COLOR_PALETTE,
  drawCabinetShape,
  traceCabinetShapePath,
} from '../../core/shapes';
import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  CabinetButton,
  DeckVisualOverride,
  GameContext,
  GameInput,
  MergedColorButton,
  SHAPE_BUTTON_LIST,
  SHAPE_BUTTON_META,
  ShapeButton,
} from '../../core/types';

type SpinnerAction = 'colorRed' | 'colorGreen' | 'colorBlue' | 'colorYellow';

const COLOR_NOTES: Record<MergedColorButton, number> = {
  RED: 261.63, // C4
  GREEN: 329.63, // E4
  BLUE: 392.0, // G4
  YELLOW: 523.25, // C5
};

class ShapeSpinnerGame implements ArcadeGameInstance<SpinnerAction> {
  private audio: GameContext['audio'];
  private time = 0;

  private activeColor: MergedColorButton = 'BLUE';
  private activeShapeBtn: ShapeButton = 'X5'; // Star

  /** Current rotation angle in radians */
  private angle = 0;
  /** Angular velocity in rad/sec (+ = clockwise, - = counter-clockwise) */
  private angularVel = 0;
  private spinDirMemory: 1 | -1 = 1;

  /** Tracks previous joystick vector angle so circular stirring spins naturally */
  private prevStickActive = false;
  private prevStickAngle = 0;

  /** Accumulates rotation for soft wooden spinner ticks */
  private tickAngleAccum = 0;

  /** Subtle pop scale when switching shape or color */
  private popScale = 1;

  constructor(context: GameContext) {
    this.audio = context.audio;
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red',
        GREEN: 'Green',
        BLUE: 'Blue',
        YELLOW: 'Yellow',
      },
      shapesActive: true,
      selectedShape: this.activeShapeBtn,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, _y: number, width: number, _height: number): void {
    void _y;
    void _height;
    // Tapping left or right half nudges spin in that direction
    const dir: 1 | -1 = x >= width * 0.5 ? 1 : -1;
    this.spinDirMemory = dir;
    this.angularVel = Math.max(-9.5, Math.min(9.5, this.angularVel + dir * 4.2));
    this.popScale = 1.08;
    this.audio.playSpinnerTick(0.7);
  }

  public update(dt: number, input: GameInput<SpinnerAction>): void {
    this.time += dt;

    // 1. 6 White Shape Buttons (X1..X6): directly set the center icon's shape
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      if (input.justPressedButton(sBtn)) {
        this.activeShapeBtn = sBtn;
        this.popScale = 1.16;
        this.audio.playShapeSparkle(idx);
      }
    });

    // 2. 4 Colored Buttons (RED, GREEN, BLUE, YELLOW): directly set the center icon's color
    const colorMap: Array<{ action: SpinnerAction; color: MergedColorButton }> = [
      { action: 'colorRed', color: 'RED' },
      { action: 'colorGreen', color: 'GREEN' },
      { action: 'colorBlue', color: 'BLUE' },
      { action: 'colorYellow', color: 'YELLOW' },
    ];
    for (const item of colorMap) {
      if (input.justPressed(item.action)) {
        this.activeColor = item.color;
        this.popScale = 1.16;
        this.audio.playMusicalBloom(COLOR_NOTES[item.color], 'warm');
      }
    }

    // 3. OK Button: gentle spin boost in the current direction
    if (input.justPressedButton('OK')) {
      this.angularVel = Math.max(
        -9.5,
        Math.min(9.5, this.angularVel + this.spinDirMemory * 4.6)
      );
      this.popScale = 1.12;
      this.audio.playSpinnerTick(0.85);
    }

    // 4. Joystick Direction -> Spin!
    const ax = input.axisX;
    const ay = input.axisY;
    const mag = Math.hypot(ax, ay);

    if (mag > 0.22) {
      const curStickAngle = Math.atan2(ay, ax);
      let stirred = false;

      if (this.prevStickActive) {
        let delta = curStickAngle - this.prevStickAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        // If the child is stirring/rotating the stick around the gate, follow that circular motion!
        if (Math.abs(delta) > 0.04) {
          stirred = true;
          const stirDir: 1 | -1 = delta > 0 ? 1 : -1;
          this.spinDirMemory = stirDir;
          this.angularVel += (delta / Math.max(0.008, dt)) * 0.42 * dt * 10;
        }
      }

      if (!stirred) {
        // Steady directional hold:
        // Right or Up -> clockwise (+1); Left or Down -> counter-clockwise (-1)
        let targetDir: 1 | -1 = this.spinDirMemory;
        if (Math.abs(ax) >= Math.abs(ay)) {
          targetDir = ax >= 0 ? 1 : -1;
        } else {
          targetDir = ay < 0 ? 1 : -1;
        }
        this.spinDirMemory = targetDir;
        const targetSpeed = targetDir * (5.8 * Math.min(1, mag));
        this.angularVel += (targetSpeed - this.angularVel) * Math.min(1, dt * 6.5);
      }

      this.prevStickActive = true;
      this.prevStickAngle = curStickAngle;
    } else {
      this.prevStickActive = false;
      // Smooth ball-bearing coasting decay when stick is centered
      this.angularVel *= Math.pow(0.28, dt);
      if (Math.abs(this.angularVel) < 0.03) {
        this.angularVel = 0;
      }
    }

    this.angularVel = Math.max(-10.5, Math.min(10.5, this.angularVel));
    const stepAngle = this.angularVel * dt;
    this.angle = (this.angle + stepAngle) % (Math.PI * 2);

    // Whisper-soft wooden tick every 90 degrees when spinning noticeably
    if (Math.abs(this.angularVel) > 0.65) {
      this.tickAngleAccum += Math.abs(stepAngle);
      const tickSpacing = Math.PI * 0.5;
      if (this.tickAngleAccum >= tickSpacing) {
        this.tickAngleAccum %= tickSpacing;
        this.audio.playSpinnerTick(Math.min(1, Math.abs(this.angularVel) / 8));
      }
    } else {
      this.tickAngleAccum = 0;
    }

    this.popScale += (1 - this.popScale) * Math.min(1, dt * 11);
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const pal = CABINET_COLOR_PALETTE[this.activeColor];
    const shape = SHAPE_BUTTON_META[this.activeShapeBtn].shape;

    // Calm, uncluttered warm ivory background
    const bg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      20,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65
    );
    bg.addColorStop(0, '#FFFDF9');
    bg.addColorStop(1, '#EEF2F6');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseRadius = Math.min(width, height) * 0.31;
    const r = baseRadius * this.popScale;

    // Soft grounded shadow underneath the single icon
    ctx.save();
    ctx.fillStyle = 'rgba(20, 25, 38, 0.09)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.1, r * 0.96, r * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Single centered rotating Shape & Color icon
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    // 1. Main shape fill
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    traceCabinetShapePath(ctx, 0, 0, r, shape);
    ctx.fillStyle = pal.face;
    ctx.fill();

    // 2. Clipped two-tone bevel + orientation gloss inlay (makes even Circle's spin unmistakable!)
    ctx.save();
    traceCabinetShapePath(ctx, 0, 0, r, shape);
    ctx.clip();

    // Subtle sunlit half-sheen that rotates with the icon
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 1.3);

    // Concentric lighter inner shape inlay
    drawCabinetShape(ctx, 0, 0, r * 0.56, shape, {
      fill: pal.light,
      stroke: '#FFFFFF',
      lineWidth: Math.max(3, r * 0.04),
    });

    // Clean orientation gloss pearl near top of inlay so Circle rotation is crystal clear
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, -r * 0.63, Math.max(6, r * 0.075), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // 3. Crisp outer outline
    traceCabinetShapePath(ctx, 0, 0, r, shape);
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = Math.max(5, r * 0.065);
    ctx.stroke();

    ctx.restore();
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const shapeSpinnerGameDefinition: ArcadeGameDefinition<SpinnerAction> = {
  id: 'shape-spinner',
  title: 'Shape Spinner',
  subtitle: 'Pick a shape & color, then spin with the stick!',
  accentColor: '#42A5F5',
  developmental: {
    parentCategory: 'Simple Spin & Choice',
    primaryTags: ['A1', 'C1'],
    secondaryTags: ['B2', 'G1'],
  },
  controls: [
    { action: 'colorRed', button: 'RED', label: 'Red', icon: 'palette' },
    { action: 'colorGreen', button: 'GREEN', label: 'Green', icon: 'palette' },
    { action: 'colorBlue', button: 'BLUE', label: 'Blue', icon: 'palette' },
    { action: 'colorYellow', button: 'YELLOW', label: 'Yellow', icon: 'palette' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const bg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      10,
      width * 0.5,
      height * 0.5,
      width * 0.7
    );
    bg.addColorStop(0, '#FFFDF9');
    bg.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.52;
    const r = Math.min(width, height) * 0.34;
    const spin = selected ? timeSec * 1.8 : 0.35;

    // Subtle spin motion arc around the icon on cover
    ctx.strokeStyle = 'rgba(66, 165, 245, 0.35)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const colIdx = selected ? Math.floor(timeSec * 0.6) % 4 : 2;
    const pal = CABINET_COLOR_PALETTE[CABINET_COLOR_COLUMNS[colIdx]];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    drawCabinetShape(ctx, 0, 0, r, 'star', {
      fill: pal.face,
      stroke: pal.dark,
      lineWidth: 4,
    });
    drawCabinetShape(ctx, 0, 0, r * 0.52, 'star', {
      fill: pal.light,
      stroke: '#FFFFFF',
      lineWidth: 2,
    });
    ctx.restore();
  },
  create(context) {
    return new ShapeSpinnerGame(context);
  },
};
