/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: block-workshop
 * activity: one-to-one-stacking-and-topple
 * primary_tags: [F1, F2]
 * secondary_tags: [A1, B2]
 * concept:
 *   - Pressing any of the 4 colored buttons (Red, Green, Blue, Yellow) drops 1 shaped wooden block onto that peg (F1 one-to-one correspondence) up to 5 blocks, and knocks the tower over joyfully when > 5!
 *   - Pressing any of the 6 white shape buttons (X1..X6) selects the geometric stamp applied to blocks (B2).
 *   - Children can compare taller, shorter, and equal stacks (F2) using visual height and 1-to-1 dot tallies (0..5).
 * child_action: "Press the 4 colored buttons to stack blocks (toppling when > 5), press the 6 white shape buttons to pick stamps, or press OK to clear the workbench."
 * complexity_step: "Toddlers freely stack and topple towers (A1/F1), while older children build specific heights or equal towers across pegs (F2)."
 * not_complexity: "No timers or error buzzers."
 * feedback: "Blocks drop physically onto pegs with rising wooden clacks, show 1-to-1 dot tallies (0..5), and topple playfully when > 5."
 * real_world_extension: "Stack 5 real wooden blocks together, compare taller vs shorter towers, and knock them over!"
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

type StackerAction = 'pegRed' | 'pegGreen' | 'pegBlue' | 'pegYellow';

interface WoodenBlock {
  color: MergedColorButton;
  shape: ShapeKind;
  yOffsetPx: number;
  vy: number;
}

interface TumblingBlock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  color: MergedColorButton;
  shape: ShapeKind;
  age: number;
}

interface PegColumn {
  color: MergedColorButton;
  blocks: WoodenBlock[];
  wiggleTimer: number;
}

const MAX_STANDING_BLOCKS = 5;

class BlockStackerGame implements ArcadeGameInstance<StackerAction> {
  private audio: GameContext['audio'];
  private time = 0;

  private pegs: PegColumn[] = CABINET_COLOR_COLUMNS.map((color) => ({
    color,
    blocks: [],
    wiggleTimer: 0,
  }));

  private selectedShapeBtn: ShapeButton = 'X1'; // Square by default
  private tumbling: TumblingBlock[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
    // Start with 1 welcoming starter block on Green so the peg mechanic is immediately clear
    this.pegs[1].blocks.push({
      color: 'GREEN',
      shape: 'square',
      yOffsetPx: 0,
      vy: 0,
    });
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red Peg',
        GREEN: 'Green Peg',
        BLUE: 'Blue Peg',
        YELLOW: 'Yellow Peg',
      },
      shapesActive: true,
      selectedShape: this.selectedShapeBtn,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number, width: number): void {
    const availW = Math.min(width - 120, 980);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;
    for (let i = 0; i < 4; i++) {
      const cx = startX + i * spacing;
      if (Math.abs(x - cx) < spacing * 0.44 && y > 60) {
        this.addBlockToPeg(i);
        return;
      }
    }
  }

  public update(dt: number, input: GameInput<StackerAction>): void {
    this.time += dt;

    // 1. 6 White Shape Buttons (X1..X6) select the active Wooden Stamper shape
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      if (input.justPressedButton(sBtn)) {
        this.selectedShapeBtn = sBtn;
        this.audio.playShapeSparkle(idx);
      }
    });

    // 2. 4 Colored Buttons (RED, GREEN, BLUE, YELLOW) stack 1 block per press, knocking over when > 5!
    const acts: StackerAction[] = ['pegRed', 'pegGreen', 'pegBlue', 'pegYellow'];
    acts.forEach((act, idx) => {
      if (input.justPressed(act)) {
        this.addBlockToPeg(idx);
      }
    });

    // 3. OK gently knocks over all standing blocks for a fresh bench
    if (input.justPressedButton('OK')) {
      const hadBlocks = this.pegs.some((p) => p.blocks.length > 0);
      if (hadBlocks) {
        this.pegs.forEach((_, idx) => {
          if (this.pegs[idx].blocks.length > 0) {
            this.knockOverPeg(idx);
          }
        });
        this.audio.playStageComplete(false);
      }
    }

    // Animate block drop physics & wiggles
    for (const peg of this.pegs) {
      if (peg.wiggleTimer > 0) peg.wiggleTimer = Math.max(0, peg.wiggleTimer - dt);
      for (const blk of peg.blocks) {
        if (blk.yOffsetPx < 0) {
          blk.vy += 1500 * dt;
          blk.yOffsetPx = Math.min(0, blk.yOffsetPx + blk.vy * dt);
        }
      }
    }

    for (let i = this.tumbling.length - 1; i >= 0; i--) {
      const tb = this.tumbling[i];
      tb.age += dt;
      if (tb.age > 1.9) {
        this.tumbling.splice(i, 1);
        continue;
      }
      tb.vy += 720 * dt;
      tb.x += tb.vx * dt;
      tb.y += tb.vy * dt;
      tb.rot += tb.vrot * dt;
    }
  }

  private addBlockToPeg(pegIdx: number): void {
    const peg = this.pegs[pegIdx];
    if (!peg) return;

    const shape = SHAPE_BUTTON_META[this.selectedShapeBtn].shape;

    // When stack exceeds 5 (> 5), adding the 6th block knocks the whole tower over!
    if (peg.blocks.length >= MAX_STANDING_BLOCKS) {
      peg.blocks.push({
        color: peg.color,
        shape,
        yOffsetPx: 0,
        vy: 0,
      });
      this.knockOverPeg(pegIdx);
      this.audio.playWoodBlockClack(MAX_STANDING_BLOCKS, false);
      this.audio.playStageComplete(true);
      return;
    }

    peg.blocks.push({
      color: peg.color,
      shape,
      yOffsetPx: -180,
      vy: 140,
    });
    this.audio.playWoodBlockClack(peg.blocks.length - 1, false);
  }

  private knockOverPeg(pegIdx: number): void {
    const peg = this.pegs[pegIdx];
    const normX = 0.2 + pegIdx * 0.2;
    const leanDir = Math.random() < 0.5 ? -1 : 1;

    peg.blocks.forEach((b, bIdx) => {
      const heightFactor = bIdx + 1;
      this.tumbling.push({
        x: normX * 1280 + leanDir * bIdx * 6,
        y: 390 - bIdx * 50,
        vx: leanDir * (75 + heightFactor * 42) + (Math.random() - 0.5) * 70,
        vy: -190 - heightFactor * 38,
        rot: leanDir * bIdx * 0.08,
        vrot: leanDir * (2.5 + heightFactor * 0.9),
        color: b.color,
        shape: b.shape,
        age: 0,
      });
    });
    peg.blocks = [];
    peg.wiggleTimer = 0.45;
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const benchY = Math.round(height * 0.8);

    const wall = ctx.createLinearGradient(0, 0, 0, benchY);
    wall.addColorStop(0, '#FFF8E1');
    wall.addColorStop(1, '#FFECB3');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, width, benchY);

    ctx.fillStyle = '#D7CCC8';
    ctx.fillRect(0, benchY - 8, width, 10);
    const wood = ctx.createLinearGradient(0, benchY, 0, height);
    wood.addColorStop(0, '#BCAAA4');
    wood.addColorStop(1, '#8D6E63');
    ctx.fillStyle = wood;
    ctx.fillRect(0, benchY, width, height - benchY);

    const availW = Math.min(width - 120, 980);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;
    const blockH = Math.min(54, Math.floor((benchY - 116) / (MAX_STANDING_BLOCKS + 0.6)));
    const blockW = Math.min(144, spacing * 0.72);
    const pegH = blockH * MAX_STANDING_BLOCKS + 22;

    // Top-left Active Shape Stamper badge
    const activeMeta = SHAPE_BUTTON_META[this.selectedShapeBtn];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#BCAAA4';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(18, 14, 196, 40, 20);
    ctx.fill();
    ctx.stroke();
    drawCabinetShape(ctx, 46, 34, 13, activeMeta.shape, {
      fill: '#FFD54F',
      stroke: '#263238',
      lineWidth: 2.4,
    });
    ctx.fillStyle = '#263238';
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Stamp: ${activeMeta.label}`, 68, 34.5);

    this.pegs.forEach((peg, idx) => {
      const pal = CABINET_COLOR_PALETTE[peg.color];
      const wiggle = peg.wiggleTimer > 0 ? Math.sin(this.time * 36) * 6 : 0;
      const cx = startX + idx * spacing + wiggle;

      // Wooden peg dowel sized for 5 blocks
      ctx.fillStyle = '#A1887F';
      ctx.strokeStyle = '#6D4C41';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(cx - 10, benchY - pegH, 20, pegH, [10, 10, 0, 0]);
      ctx.fill();
      ctx.stroke();

      // Colored base plinth
      ctx.fillStyle = pal.face;
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(cx - blockW * 0.58, benchY - 12, blockW * 1.16, 18, 7);
      ctx.fill();
      ctx.stroke();

      const atMaxWobble =
        peg.blocks.length === MAX_STANDING_BLOCKS ? Math.sin(this.time * 9 + idx) * 2.2 : 0;

      peg.blocks.forEach((blk, bIdx) => {
        const restTopY = benchY - 12 - (bIdx + 1) * blockH;
        const by = restTopY + blk.yOffsetPx;
        const swayX = atMaxWobble * ((bIdx + 1) / MAX_STANDING_BLOCKS);

        ctx.fillStyle = pal.face;
        ctx.strokeStyle = pal.dark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(cx - blockW / 2 + swayX, by + 2, blockW, blockH - 3, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.beginPath();
        ctx.roundRect(cx - blockW / 2 + 6 + swayX, by + 5, blockW - 12, 7, 3);
        ctx.fill();

        drawCabinetShape(
          ctx,
          cx + swayX,
          by + blockH / 2,
          Math.min(16, blockH * 0.32),
          blk.shape,
          {
            fill: '#FFFFFF',
            stroke: pal.dark,
            lineWidth: 2,
          }
        );
      });

      // 5 Dot Pips + Count Badge along workbench front
      const count = peg.blocks.length;
      const badgeY = benchY + Math.min(44, (height - benchY) * 0.52);

      const pipGap = 16;
      const pipStartX = cx - ((MAX_STANDING_BLOCKS - 1) * pipGap) / 2;
      for (let p = 0; p < MAX_STANDING_BLOCKS; p++) {
        ctx.fillStyle = p < count ? pal.face : 'rgba(255,255,255,0.3)';
        ctx.strokeStyle = p < count ? '#FFFFFF' : 'rgba(62,39,35,0.3)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(pipStartX + p * pipGap, badgeY - 14, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath();
      ctx.roundRect(cx - 24, badgeY, 48, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.font = '900 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(count), cx, badgeY + 15);
    });

    for (const tb of this.tumbling) {
      const pal = CABINET_COLOR_PALETTE[tb.color];
      ctx.save();
      ctx.translate((tb.x / 1280) * width, tb.y);
      ctx.rotate(tb.rot);
      ctx.fillStyle = pal.face;
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-44, -23, 88, 46, 10);
      ctx.fill();
      ctx.stroke();
      drawCabinetShape(ctx, 0, 0, 15, tb.shape, {
        fill: '#FFFFFF',
        stroke: pal.dark,
        lineWidth: 2,
      });
      ctx.restore();
    }
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const shapeStackerGameDefinition: ArcadeGameDefinition<StackerAction> = {
  id: 'block-stacker',
  title: 'Block Stacker',
  subtitle: 'Stack shaped wooden blocks — topples over 5!',
  accentColor: '#42A5F5',
  developmental: {
    parentCategory: 'Shapes & Counting',
    primaryTags: ['F1', 'F2'],
    secondaryTags: ['A1', 'B2'],
  },
  controls: [
    { action: 'pegRed', button: 'RED', label: 'Red Peg', icon: 'block' },
    { action: 'pegGreen', button: 'GREEN', label: 'Green Peg', icon: 'block' },
    { action: 'pegBlue', button: 'BLUE', label: 'Blue Peg', icon: 'block' },
    { action: 'pegYellow', button: 'YELLOW', label: 'Yellow Peg', icon: 'block' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const benchY = height * 0.82;
    ctx.fillStyle = '#FFF8E1';
    ctx.fillRect(0, 0, width, benchY);
    ctx.fillStyle = '#A1887F';
    ctx.fillRect(0, benchY, width, height - benchY);

    const spacing = width * 0.2;
    const startX = width / 2 - spacing * 1.5;
    const counts = [2, 5, 3, 1];
    const shapes: ShapeKind[] = ['square', 'star', 'heart', 'triangle'];

    CABINET_COLOR_COLUMNS.forEach((col, idx) => {
      const pal = CABINET_COLOR_PALETTE[col];
      const cx = startX + idx * spacing;

      ctx.fillStyle = '#8D6E63';
      ctx.fillRect(cx - 4, benchY - 96, 8, 96);

      const n = counts[idx];
      for (let b = 0; b < n; b++) {
        const bounce = selected && b === n - 1 ? Math.abs(Math.sin(timeSec * 5 + idx)) * 4 : 0;
        const by = benchY - (b + 1) * 18 - bounce;
        ctx.fillStyle = pal.face;
        ctx.beginPath();
        ctx.roundRect(cx - 22, by, 44, 16, 5);
        ctx.fill();
        drawCabinetShape(ctx, cx, by + 8, 5.5, shapes[(idx + b) % shapes.length], {
          fill: '#FFFFFF',
        });
      }
    });
  },
  create(context) {
    return new BlockStackerGame(context);
  },
};
