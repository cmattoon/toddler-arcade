/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: music-studio / bubble-garden
 * activity: musical-blooms-and-shaped-bubbles
 * primary_tags: [A1]
 * secondary_tags: [B2, G1]
 * concept:
 *   - Pressing the 4 colored buttons plays distinct major-chord flower notes (Do-Mi-Sol-Do) and releases matching colored bubbles.
 *   - Pressing the 6 white shape buttons changes the Bubble Wand shape (Square, Circle, Triangle, Diamond, Star, Heart) and floats shimmering shape bubbles.
 * child_action: "Press the 4 colored buttons to play singing flowers, press the 6 white shape buttons to pick bubble shapes, and press OK to pop bubbles."
 * complexity_step: "Combine chosen shapes with chosen flower colors and create visual note trails along the overhead vine."
 * not_complexity: "No rhythm timing penalties or wrong-note buzzers."
 * feedback: "Each flower blooms with expanding sound ripples, adds a colored bead to the melody vine, and floats shaped bubbles."
 * real_world_extension: "Blow real soap bubbles with different wand shapes or tap kitchen bowls of different sizes."
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

type MusicAction = 'bloomRed' | 'bloomGreen' | 'bloomBlue' | 'bloomYellow';

interface GardenBubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  lightColor: string;
  shape: ShapeKind;
  wobbleSeed: number;
  age: number;
  maxAge: number;
}

interface PopRing {
  x: number;
  y: number;
  radius: number;
  color: string;
  age: number;
}

interface FlowerPipe {
  color: MergedColorButton;
  baseFreq: number;
  bloomScale: number;
  stemHeightFactor: number;
  rippleAge: number;
}

const FLOWER_SPECS: Array<{
  color: MergedColorButton;
  freq: number;
}> = [
  { color: 'RED', freq: 261.63 }, // C4 (Do)
  { color: 'GREEN', freq: 329.63 }, // E4 (Mi)
  { color: 'BLUE', freq: 392.0 }, // G4 (Sol)
  { color: 'YELLOW', freq: 523.25 }, // C5 (High Do)
];

class MusicBubbleGardenGame implements ArcadeGameInstance<MusicAction> {
  private audio: GameContext['audio'];
  private time = 0;

  private flowers: FlowerPipe[] = FLOWER_SPECS.map((s) => ({
    color: s.color,
    baseFreq: s.freq,
    bloomScale: 1,
    stemHeightFactor: 1,
    rippleAge: 99,
  }));

  private selectedShapeBtn: ShapeButton = 'X2'; // Circle by default
  private bubbles: GardenBubble[] = [];
  private popRings: PopRing[] = [];
  private recentTrail: MergedColorButton[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red Note',
        GREEN: 'Green Note',
        BLUE: 'Blue Note',
        YELLOW: 'Yellow Note',
      },
      shapesActive: true,
      selectedShape: this.selectedShapeBtn,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    // 1. Allow popping individual bubbles by tapping them
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bub = this.bubbles[i];
      const dx = x - bub.x * width;
      const dy = y - bub.y * height;
      if (dx * dx + dy * dy <= (bub.radius + 14) * (bub.radius + 14)) {
        this.popSingleBubble(i);
        return;
      }
    }

    // 2. Allow tapping any flower bloom directly
    const availW = Math.min(width - 100, 1020);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;
    for (let i = 0; i < 4; i++) {
      const fx = startX + i * spacing;
      if (Math.abs(x - fx) < spacing * 0.44 && y > height * 0.45) {
        this.triggerFlower(i);
        return;
      }
    }
  }

  public update(dt: number, input: GameInput<MusicAction>): void {
    this.time += dt;

    // 1. 6 White Shape Buttons (X1..X6): select bubble wand shape & float a shimmering shape bubble
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      if (input.justPressedButton(sBtn)) {
        this.selectedShapeBtn = sBtn;
        this.audio.playShapeSparkle(idx);
        const shape = SHAPE_BUTTON_META[sBtn].shape;
        this.spawnBubble(0.5 + (idx - 2.5) * 0.1, 0.76, 35, '#FFFFFF', '#E1F5FE', shape, -0.13);
      }
    });

    // 2. 4 Colored Buttons (RED, GREEN, BLUE, YELLOW): play singing flowers & float colored shape bubbles
    const acts: MusicAction[] = ['bloomRed', 'bloomGreen', 'bloomBlue', 'bloomYellow'];
    acts.forEach((act, idx) => {
      if (input.justPressed(act)) {
        this.triggerFlower(idx);
      }
    });

    // 3. OK Button: gently pops all bubbles in a musical cascade
    if (input.justPressedButton('OK')) {
      this.popAllBubbles();
    }

    // 4. Animate flowers, bubbles & pop rings
    for (const fl of this.flowers) {
      fl.bloomScale += (1 - fl.bloomScale) * Math.min(1, dt * 8);
      fl.stemHeightFactor += (1 - fl.stemHeightFactor) * Math.min(1, dt * 5);
      fl.rippleAge += dt;
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.age += dt;
      if (b.age >= b.maxAge || b.y < -0.12) {
        this.popSingleBubble(i, true);
        continue;
      }
      const wobble = Math.sin(this.time * 2.6 + b.wobbleSeed) * 0.035;
      b.x += (b.vx + wobble + input.axisX * 0.22) * dt;
      b.y += (b.vy + input.axisY * 0.14) * dt;
      b.x = Math.max(0.06, Math.min(0.94, b.x));
    }

    for (let i = this.popRings.length - 1; i >= 0; i--) {
      const r = this.popRings[i];
      r.age += dt;
      if (r.age >= 0.35) {
        this.popRings.splice(i, 1);
      }
    }
  }

  private triggerFlower(flowerIdx: number): void {
    const fl = this.flowers[flowerIdx];
    if (!fl) return;
    const pal = CABINET_COLOR_PALETTE[fl.color];
    const activeShape = SHAPE_BUTTON_META[this.selectedShapeBtn].shape;
    const normX = 0.19 + flowerIdx * 0.206;

    fl.bloomScale = 1.36;
    fl.stemHeightFactor = 1.15;
    fl.rippleAge = 0;

    this.audio.playMusicalBloom(fl.baseFreq, 'warm');
    this.spawnBubble(normX, 0.64, 34, pal.face, pal.light, activeShape, -0.12);

    this.recentTrail.push(fl.color);
    if (this.recentTrail.length > 8) {
      this.recentTrail.shift();
    }
  }

  private spawnBubble(
    x: number,
    y: number,
    radius: number,
    color: string,
    lightColor: string,
    shape: ShapeKind,
    vy: number
  ): void {
    if (this.bubbles.length >= 28) {
      this.bubbles.shift();
    }
    this.bubbles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.04,
      vy,
      radius,
      color,
      lightColor,
      shape,
      wobbleSeed: Math.random() * Math.PI * 2,
      age: 0,
      maxAge: 7.5 + Math.random() * 2.5,
    });
  }

  private popSingleBubble(idx: number, silent = false): void {
    const b = this.bubbles[idx];
    if (!b) return;
    this.popRings.push({
      x: b.x,
      y: b.y,
      radius: b.radius,
      color: b.color,
      age: 0,
    });
    this.bubbles.splice(idx, 1);
    if (!silent) {
      this.audio.playBubblePop();
    }
  }

  private popAllBubbles(): void {
    if (this.bubbles.length === 0) {
      for (let i = 0; i < 4; i++) {
        this.triggerFlower(i);
      }
      return;
    }
    while (this.bubbles.length > 0) {
      this.popSingleBubble(this.bubbles.length - 1, true);
    }
    this.audio.playStageComplete(false);
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const groundY = Math.round(height * 0.82);

    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#E1F5FE');
    sky.addColorStop(0.6, '#F3E5F5');
    sky.addColorStop(1, '#FFFDE7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    ctx.fillStyle = '#AED581';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(width * 0.3, groundY - 42, width * 0.62, groundY - 18);
    ctx.quadraticCurveTo(width * 0.85, groundY - 38, width, groundY - 10);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(0, groundY, width, height - groundY);

    // Overhead 8-Note Recent Melody Bead Vine
    this.renderOverheadBeadVine(ctx, width);

    // Floating Shape-Stamped Bubbles & Pop Ripples
    for (const b of this.bubbles) {
      const bx = b.x * width;
      const by = b.y * height;
      ctx.save();
      ctx.globalAlpha = 0.84;
      ctx.fillStyle = b.lightColor;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawCabinetShape(ctx, bx, by, b.radius * 0.52, b.shape, {
        fill: b.color,
        stroke: '#FFFFFF',
        lineWidth: 2,
      });

      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(bx - b.radius * 0.34, by - b.radius * 0.34, b.radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const r of this.popRings) {
      const p = r.age / 0.35;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(r.x * width, r.y * height, r.radius * (1 + p * 0.65), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const availW = Math.min(width - 100, 1020);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;

    this.flowers.forEach((fl, idx) => {
      const fx = startX + idx * spacing;
      this.drawMusicalFlower(ctx, fx, groundY, height, fl, idx);
    });

    this.drawBubbleWandBadge(ctx, 18, 14);
  }

  private renderOverheadBeadVine(ctx: CanvasRenderingContext2D, width: number): void {
    const vineY = 44;
    const slotCount = 8;
    const beadGap = 42;
    const startX = width / 2 - ((slotCount - 1) * beadGap) / 2;

    ctx.strokeStyle = '#689F38';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX - 30, vineY);
    ctx.lineTo(startX + (slotCount - 1) * beadGap + 30, vineY);
    ctx.stroke();

    for (let i = 0; i < slotCount; i++) {
      const bx = startX + i * beadGap;
      const col = this.recentTrail[i];
      if (!col) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(bx, vineY, 12, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const pal = CABINET_COLOR_PALETTE[col];
      ctx.fillStyle = pal.face;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(bx, vineY, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawMusicalFlower(
    ctx: CanvasRenderingContext2D,
    cx: number,
    groundY: number,
    height: number,
    fl: FlowerPipe,
    idx: number
  ): void {
    const pal = CABINET_COLOR_PALETTE[fl.color];
    const baseStemH = Math.min(185, height * 0.31);
    const sway = Math.sin(this.time * 2.2 + idx * 1.3) * 6;
    const headX = cx + sway;
    const headY = groundY - baseStemH * fl.stemHeightFactor;

    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.moveTo(cx - 38, groundY - 28);
    ctx.lineTo(cx + 38, groundY - 28);
    ctx.lineTo(cx + 28, groundY + 10);
    ctx.lineTo(cx - 28, groundY + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pal.face;
    ctx.beginPath();
    ctx.roundRect(cx - 42, groundY - 36, 84, 12, 6);
    ctx.fill();

    ctx.strokeStyle = '#558B2F';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, groundY - 32);
    ctx.quadraticCurveTo(cx + sway * 0.4, (groundY + headY) * 0.5, headX, headY);
    ctx.stroke();

    ctx.fillStyle = '#7CB342';
    const midY = (groundY - 28 + headY) * 0.55;
    ctx.beginPath();
    ctx.ellipse(cx - 22, midY, 18, 9, -0.4, 0, Math.PI * 2);
    ctx.ellipse(cx + 22, midY + 10, 18, 9, 0.4, 0, Math.PI * 2);
    ctx.fill();

    if (fl.rippleAge < 0.55) {
      const p = fl.rippleAge / 0.55;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = pal.face;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(headX, headY, 38 + p * 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(headX, headY);
    ctx.scale(fl.bloomScale, fl.bloomScale);

    for (let p = 0; p < 6; p++) {
      const a = (p * Math.PI) / 3 + this.time * 0.25;
      ctx.fillStyle = pal.face;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#FFF9C4';
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(-6, -3, 2.6, 0, Math.PI * 2);
    ctx.arc(6, -3, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 1, 7, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  private drawBubbleWandBadge(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const meta = SHAPE_BUTTON_META[this.selectedShapeBtn];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 174, 40, 20);
    ctx.fill();
    ctx.stroke();

    drawCabinetShape(ctx, x + 26, y + 20, 12, meta.shape, {
      stroke: '#141926',
      lineWidth: 2.5,
      fill: '#FFE082',
    });

    ctx.fillStyle = '#263238';
    ctx.font = '800 13.5px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Wand: ${meta.label}`, x + 46, y + 20.5);
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const musicGardenGameDefinition: ArcadeGameDefinition<MusicAction> = {
  id: 'music-bubbles',
  title: 'Music & Bubbles',
  subtitle: 'Play singing flowers & float shape bubbles!',
  accentColor: '#AB47BC',
  developmental: {
    parentCategory: 'Sound & Bubbles',
    primaryTags: ['A1'],
    secondaryTags: ['B2', 'G1'],
  },
  controls: [
    { action: 'bloomRed', button: 'RED', label: 'Red Note', icon: 'music' },
    { action: 'bloomGreen', button: 'GREEN', label: 'Green Note', icon: 'music' },
    { action: 'bloomBlue', button: 'BLUE', label: 'Blue Note', icon: 'music' },
    { action: 'bloomYellow', button: 'YELLOW', label: 'Yellow Note', icon: 'music' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const groundY = height * 0.8;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#E1F5FE');
    sky.addColorStop(1, '#F3E5F5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    ctx.fillStyle = '#8BC34A';
    ctx.fillRect(0, groundY, width, height - groundY);

    const spacing = width * 0.2;
    const startX = width / 2 - spacing * 1.5;
    const shapes: ShapeKind[] = ['star', 'heart', 'triangle', 'diamond'];

    CABINET_COLOR_COLUMNS.forEach((col, idx) => {
      const pal = CABINET_COLOR_PALETTE[col];
      const cx = startX + idx * spacing;
      const stemTop = groundY - 42 - (idx % 2) * 12;

      ctx.strokeStyle = '#558B2F';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx, groundY);
      ctx.lineTo(cx, stemTop);
      ctx.stroke();

      ctx.fillStyle = pal.face;
      for (let p = 0; p < 5; p++) {
        const a = (p * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 11, stemTop + Math.sin(a) * 11, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#FFF9C4';
      ctx.beginPath();
      ctx.arc(cx, stemTop, 8, 0, Math.PI * 2);
      ctx.fill();

      const bob = selected ? Math.sin(timeSec * 3 + idx) * 6 : 0;
      const by = height * 0.28 + (idx % 2) * 14 + bob;
      ctx.fillStyle = pal.light;
      ctx.strokeStyle = pal.face;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, by, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawCabinetShape(ctx, cx, by, 8, shapes[idx], { fill: pal.face });
    });
  },
  create(context) {
    return new MusicBubbleGardenGame(context);
  },
};
