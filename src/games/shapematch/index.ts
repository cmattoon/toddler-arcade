/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: shape-garden / wooden-sorter-box
 * activity: flexible-color-or-shape-match
 * primary_tags: [B2]
 * secondary_tags: [B1, A1, E4]
 * concept: "Each wooden puzzle block has both a painted color and a carved shape; children can match it by pressing EITHER its colored button column OR its white shape button."
 * child_action: "Press any matching colored button pair (Red, Green, Blue, Yellow) OR the matching white shape button (Square, Circle, Triangle, Diamond, Star, Heart)."
 * complexity_step: "Notice two distinct attributes (color and shape) on the same object and match using either rule without intermediate menus."
 * not_complexity: "No timers, distractors, or error buzzers."
 * feedback: "Matched blocks glide smoothly into the chosen shape cutout or painted bin; non-matching slots wiggle gently with a soft wooden knock."
 * real_world_extension: "Sort real wooden blocks or household toys by either color or shape."
 */

import { CABINET_COLOR_COLUMNS, CABINET_COLOR_PALETTE, drawCabinetShape } from '../../core/shapes';
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
  ShapeKind,
} from '../../core/types';

type MatchAction = 'binRed' | 'binGreen' | 'binBlue' | 'binYellow';

interface CelebrationSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  shape: ShapeKind;
  age: number;
}

class ShapeColorMatchGame implements ArcadeGameInstance<MatchAction> {
  private audio: GameContext['audio'];
  private time = 0;

  private currentColor: MergedColorButton = 'YELLOW';
  private currentShapeBtn: ShapeButton = 'X6'; // Heart
  private slideProgress = 0;
  private matchedVia: 'color' | 'shape' = 'color';
  private sortedCount = 0;

  private shapeWiggle: Record<ShapeButton, number> = {
    X1: 0,
    X2: 0,
    X3: 0,
    X4: 0,
    X5: 0,
    X6: 0,
  };
  private colorWiggle: Record<MergedColorButton, number> = {
    RED: 0,
    GREEN: 0,
    BLUE: 0,
    YELLOW: 0,
  };
  private sparks: CelebrationSpark[] = [];

  private shapeTargets = new Map<ShapeButton, { x: number; y: number }>();
  private colorTargets = new Map<MergedColorButton, { x: number; y: number }>();

  constructor(context: GameContext) {
    this.audio = context.audio;
    this.spawnNextBlock();
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Match Red',
        GREEN: 'Match Green',
        BLUE: 'Match Blue',
        YELLOW: 'Match Yellow',
      },
      shapesActive: true,
      selectedShape: null,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number): void {
    if (this.slideProgress > 0) return;

    for (const [sBtn, pt] of this.shapeTargets.entries()) {
      if (Math.hypot(x - pt.x, y - pt.y) <= 46) {
        this.tryShapeInput(sBtn);
        return;
      }
    }

    for (const [col, pt] of this.colorTargets.entries()) {
      if (Math.abs(x - pt.x) <= 52 && Math.abs(y - pt.y) <= 70) {
        this.tryColorInput(col);
        return;
      }
    }
  }

  private spawnNextBlock(): void {
    const prevColIdx = CABINET_COLOR_COLUMNS.indexOf(this.currentColor);
    const prevShapeIdx = SHAPE_BUTTON_LIST.indexOf(this.currentShapeBtn);

    this.currentColor =
      CABINET_COLOR_COLUMNS[(prevColIdx + 1 + Math.floor(Math.random() * 3)) % 4];
    this.currentShapeBtn =
      SHAPE_BUTTON_LIST[(prevShapeIdx + 1 + Math.floor(Math.random() * 5)) % 6];
    this.slideProgress = 0;
  }

  private tryShapeInput(sBtn: ShapeButton): void {
    if (sBtn === this.currentShapeBtn) {
      this.matchedVia = 'shape';
      this.slideProgress = 0.01;
      this.sortedCount += 1;
      this.audio.playStageComplete(this.sortedCount % 5 === 0);
      const pt = this.shapeTargets.get(sBtn);
      if (pt) this.emitSparks(pt.x, pt.y);
    } else {
      this.shapeWiggle[sBtn] = 0.42;
      this.audio.playGentleWoodKnock();
    }
  }

  private tryColorInput(col: MergedColorButton): void {
    if (col === this.currentColor) {
      this.matchedVia = 'color';
      this.slideProgress = 0.01;
      this.sortedCount += 1;
      this.audio.playStageComplete(this.sortedCount % 5 === 0);
      const pt = this.colorTargets.get(col);
      if (pt) this.emitSparks(pt.x, pt.y);
    } else {
      this.colorWiggle[col] = 0.42;
      this.audio.playGentleWoodKnock();
    }
  }

  private emitSparks(x: number, y: number): void {
    const pal = CABINET_COLOR_PALETTE[this.currentColor];
    const shape = SHAPE_BUTTON_META[this.currentShapeBtn].shape;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.35;
      const spd = 110 + Math.random() * 110;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 60,
        color: pal.face,
        shape,
        age: 0,
      });
    }
  }

  public update(dt: number, input: GameInput<MatchAction>): void {
    this.time += dt;

    for (const sBtn of SHAPE_BUTTON_LIST) {
      if (this.shapeWiggle[sBtn] > 0) {
        this.shapeWiggle[sBtn] = Math.max(0, this.shapeWiggle[sBtn] - dt);
      }
    }
    for (const col of CABINET_COLOR_COLUMNS) {
      if (this.colorWiggle[col] > 0) {
        this.colorWiggle[col] = Math.max(0, this.colorWiggle[col] - dt);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.age += dt;
      if (sp.age > 0.85) {
        this.sparks.splice(i, 1);
        continue;
      }
      sp.vy += 320 * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
    }

    if (this.slideProgress > 0) {
      this.slideProgress += dt * 2.3;
      if (this.slideProgress >= 1) {
        this.spawnNextBlock();
      }
      return;
    }

    // 1. Match by SHAPE (any of the 6 White Shape Buttons X1..X6)
    for (const sBtn of SHAPE_BUTTON_LIST) {
      if (input.justPressedButton(sBtn)) {
        this.tryShapeInput(sBtn);
        return;
      }
    }

    // 2. Match by COLOR (any of the 4 Merged Color Columns: Red, Green, Blue, Yellow)
    const acts: MatchAction[] = ['binRed', 'binGreen', 'binBlue', 'binYellow'];
    for (let i = 0; i < acts.length; i++) {
      if (input.justPressed(acts[i])) {
        this.tryColorInput(CABINET_COLOR_COLUMNS[i]);
        return;
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const benchY = Math.round(height * 0.82);

    // Warm sunlit playroom background & wooden workbench
    const wall = ctx.createLinearGradient(0, 0, 0, benchY);
    wall.addColorStop(0, '#FFFDF7');
    wall.addColorStop(1, '#FFE0B2');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, width, benchY);

    ctx.fillStyle = '#D7CCC8';
    ctx.fillRect(0, benchY - 8, width, 10);
    const wood = ctx.createLinearGradient(0, benchY, 0, height);
    wood.addColorStop(0, '#BCAAA4');
    wood.addColorStop(1, '#8D6E63');
    ctx.fillStyle = wood;
    ctx.fillRect(0, benchY, width, height - benchY);

    this.shapeTargets.clear();
    this.colorTargets.clear();

    const sorterY = Math.round(benchY * 0.62);

    // Left: 2x3 Wooden Shape Sorter Lid (mirrors X1..X6 layout)
    const leftCx = Math.round(width * 0.27);
    ctx.fillStyle = '#EFEBE9';
    ctx.strokeStyle = '#8D6E63';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(leftCx - 170, sorterY - 116, 340, 232, 24);
    ctx.fill();
    ctx.stroke();

    for (const sBtn of SHAPE_BUTTON_LIST) {
      const meta = SHAPE_BUTTON_META[sBtn];
      const wig = this.shapeWiggle[sBtn] > 0 ? Math.sin(this.time * 38) * 6 : 0;
      const sx = leftCx + (meta.col - 1) * 102 + wig;
      const sy = sorterY + (meta.row === 0 ? -52 : 52);
      this.shapeTargets.set(sBtn, { x: sx, y: sy });

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#BCAAA4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 39, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawCabinetShape(ctx, sx, sy, 24, meta.shape, {
        fill: '#D7CCC8',
        stroke: '#3E2723',
        lineWidth: 3.2,
      });
    }

    // Right: 4 Painted Color Bins (mirrors R, G, B, Y columns)
    const rightStart = Math.round(width * 0.56);
    const spacing = Math.min(124, (width - rightStart - 56) / 3.2);
    CABINET_COLOR_COLUMNS.forEach((col, idx) => {
      const pal = CABINET_COLOR_PALETTE[col];
      const wig = this.colorWiggle[col] > 0 ? Math.sin(this.time * 38) * 6 : 0;
      const bx = rightStart + idx * spacing + wig;
      const by = sorterY + 28;
      this.colorTargets.set(col, { x: bx, y: by });

      ctx.fillStyle = pal.face;
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(bx - 46, by - 67, 92, 134, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
      ctx.beginPath();
      ctx.roundRect(bx - 33, by - 51, 66, 30, 12);
      ctx.fill();
    });

    // Overhead Active Puzzle Block (slides into matched shape OR color slot)
    const startX = Math.round(width * 0.66);
    const startY = Math.round(benchY * 0.21);
    const fallbackTarget = { x: startX, y: sorterY };
    const targetPt =
      this.matchedVia === 'shape'
        ? (this.shapeTargets.get(this.currentShapeBtn) ?? fallbackTarget)
        : (this.colorTargets.get(this.currentColor) ?? fallbackTarget);

    const t = Math.min(1, this.slideProgress);
    const ease = t * t * (3 - 2 * t);
    const px = startX + (targetPt.x - startX) * ease;
    const py = startY + (targetPt.y - startY) * ease;
    const scale = 1 - ease * 0.34;
    const hoverBob = Math.sin(this.time * 4) * 4 * (1 - ease);

    const pal = CABINET_COLOR_PALETTE[this.currentColor];
    const shape = SHAPE_BUTTON_META[this.currentShapeBtn].shape;

    ctx.save();
    ctx.translate(px, py + hoverBob);
    ctx.scale(scale, scale);

    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = pal.face;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(-56, -56, 112, 112, 22);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    drawCabinetShape(ctx, 0, 0, 35, shape, {
      fill: '#FFFFFF',
      stroke: pal.dark,
      lineWidth: 3.5,
    });
    ctx.restore();

    for (const sp of this.sparks) {
      const alpha = Math.max(0, 1 - sp.age / 0.85);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCabinetShape(ctx, sp.x, sp.y, 11, sp.shape, {
        fill: sp.color,
        stroke: '#FFFFFF',
        lineWidth: 2,
      });
      ctx.restore();
    }
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const shapeColorMatchGameDefinition: ArcadeGameDefinition<MatchAction> = {
  id: 'shape-match',
  title: 'Shape & Color Match',
  subtitle: 'Match blocks by shape OR painted color!',
  accentColor: '#AB47BC',
  developmental: {
    parentCategory: 'Matching & Sorting',
    primaryTags: ['B2'],
    secondaryTags: ['B1', 'A1', 'E4'],
  },
  controls: [
    { action: 'binRed', button: 'RED', label: 'Match Red', icon: 'block' },
    { action: 'binGreen', button: 'GREEN', label: 'Match Green', icon: 'block' },
    { action: 'binBlue', button: 'BLUE', label: 'Match Blue', icon: 'block' },
    { action: 'binYellow', button: 'YELLOW', label: 'Match Yellow', icon: 'block' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    ctx.fillStyle = '#FFF8E1';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#A1887F';
    ctx.fillRect(0, height * 0.82, width, height * 0.18);

    ctx.fillStyle = '#EFEBE9';
    ctx.strokeStyle = '#8D6E63';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(width * 0.08, height * 0.34, width * 0.4, height * 0.44, 12);
    ctx.fill();
    ctx.stroke();

    const coverShapes: ShapeKind[] = ['square', 'circle', 'triangle', 'diamond', 'star', 'heart'];
    coverShapes.forEach((sh, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      drawCabinetShape(
        ctx,
        width * 0.16 + col * width * 0.12,
        height * 0.46 + row * height * 0.2,
        9,
        sh,
        { fill: '#D7CCC8', stroke: '#3E2723', lineWidth: 2 }
      );
    });

    const cols: MergedColorButton[] = ['RED', 'GREEN', 'BLUE', 'YELLOW'];
    cols.forEach((c, idx) => {
      ctx.fillStyle = CABINET_COLOR_PALETTE[c].face;
      ctx.beginPath();
      ctx.roundRect(width * 0.54 + idx * width * 0.1, height * 0.5, width * 0.085, height * 0.3, 6);
      ctx.fill();
    });

    const bob = selected ? Math.sin(timeSec * 5) * 4 : 0;
    const bx = width * 0.72;
    const by = height * 0.26 + bob;
    ctx.fillStyle = '#FFCA28';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(bx - 22, by - 22, 44, 44, 10);
    ctx.fill();
    ctx.stroke();
    drawCabinetShape(ctx, bx, by, 13, 'heart', {
      fill: '#FFFFFF',
      stroke: '#F9A825',
      lineWidth: 2,
    });
  },
  create(context) {
    return new ShapeColorMatchGame(context);
  },
};
