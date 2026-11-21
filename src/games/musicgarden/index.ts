/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: music-studio / bubble-garden
 * activity: musical-blooms, high-low-experiment, & pattern-vine
 * primary_tags: [A1, A2, B4]
 * secondary_tags: [B2, G1]
 * concept:
 *   - Explore (A1): Pressing colored buttons produces distinct, harmonious notes and matching colored bubbles; white shape buttons change bubble shapes.
 *   - High / Low +/- (A2): Top row (+) vs bottom row (-) changes pitch octave (high vs bass) and bubble scale (giant floaty vs small bouncy), letting children compare two outcomes intentionally.
 *   - Pattern (B4): Complete simple repeating color sequences (ABAB, AABB) along the caterpillar vine.
 * child_action: "Press colored button columns (merged in Explore/Pattern, split +/- in High/Low) and white Shape buttons."
 * complexity_step: "Move from single-press cause & effect (A1) to comparing a variable across top/bottom rows (A2) or extending a visual pattern (B4)."
 * not_complexity: "No rhythm timing penalties or wrong-note buzzers."
 * feedback: "Flower stems stretch tall for High (+) or crouch wide for Low (-); bubbles carry the chosen shape and pop gently."
 * real_world_extension: "Tap big vs small bowls with a wooden spoon, or string alternating colored beads."
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
  SplitColorButton,
} from '../../core/types';

type MusicAction = 'bloomRed' | 'bloomGreen' | 'bloomBlue' | 'bloomYellow';
type MusicBranch = 'explore' | 'highlow' | 'pattern';

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
  topBtn: SplitColorButton;
  bottomBtn: SplitColorButton;
  baseFreq: number; // C4, E4, G4, C5 major chord
  noteLabel: string;
  bloomScale: number;
  stemHeightFactor: number; // 1.0 neutral, 1.32 high (+), 0.72 low (-)
  rippleAge: number;
}

const FLOWER_SPECS: Array<{
  color: MergedColorButton;
  topBtn: SplitColorButton;
  bottomBtn: SplitColorButton;
  freq: number;
  note: string;
}> = [
  { color: 'RED', topBtn: 'R1', bottomBtn: 'R2', freq: 261.63, note: 'Do' },
  { color: 'GREEN', topBtn: 'G1', bottomBtn: 'G2', freq: 329.63, note: 'Mi' },
  { color: 'BLUE', topBtn: 'B1', bottomBtn: 'B2', freq: 392.0, note: 'Sol' },
  { color: 'YELLOW', topBtn: 'Y1', bottomBtn: 'Y2', freq: 523.25, note: 'High Do' },
];

const PATTERN_TEMPLATES: MergedColorButton[][] = [
  ['RED', 'YELLOW', 'RED', 'YELLOW'],
  ['GREEN', 'BLUE', 'GREEN', 'BLUE'],
  ['RED', 'RED', 'BLUE', 'BLUE'],
  ['GREEN', 'YELLOW', 'BLUE', 'GREEN', 'YELLOW', 'BLUE'],
  ['RED', 'GREEN', 'BLUE', 'YELLOW'],
];

class MusicBubbleGardenGame implements ArcadeGameInstance<MusicAction> {
  private audio: GameContext['audio'];
  private time = 0;
  private branch: MusicBranch = 'highlow';

  private flowers: FlowerPipe[] = FLOWER_SPECS.map((s) => ({
    color: s.color,
    topBtn: s.topBtn,
    bottomBtn: s.bottomBtn,
    baseFreq: s.freq,
    noteLabel: s.note,
    bloomScale: 1,
    stemHeightFactor: 1,
    rippleAge: 99,
  }));

  private selectedShapeBtn: ShapeButton = 'X2'; // Circle by default
  private bubbles: GardenBubble[] = [];
  private popRings: PopRing[] = [];
  private recentTrail: MergedColorButton[] = [];

  // Pattern branch state
  private patternIndex = 0;
  private patternTarget: MergedColorButton[] = [...PATTERN_TEMPLATES[0]];
  private patternProgress = 2; // First 2 beads pre-lit as the visible model, child extends remaining beads!
  private patternCelebrateTimer = 0;

  constructor(context: GameContext, initialModeId?: string) {
    this.audio = context.audio;
    if (initialModeId === 'highlow' || initialModeId === 'pattern') {
      this.branch = initialModeId;
      if (initialModeId === 'pattern') {
        this.loadPattern(this.patternIndex);
      }
    }
  }

  public getMode(): string {
    return this.branch;
  }

  public setMode(modeId: string): void {
    if (modeId === 'explore' || modeId === 'highlow' || modeId === 'pattern') {
      this.switchBranch(modeId);
    }
  }

  public getDeckOverride(): DeckVisualOverride {
    if (this.branch === 'highlow') {
      return {
        colorMode: 'split8',
        columnLabels: {
          RED: 'Red +/-',
          GREEN: 'Green +/-',
          BLUE: 'Blue +/-',
          YELLOW: 'Yellow +/-',
        },
        splitIcons: {
          R1: 'plus',
          G1: 'plus',
          B1: 'plus',
          Y1: 'plus',
          R2: 'minus',
          G2: 'minus',
          B2: 'minus',
          Y2: 'minus',
        },
        shapesActive: true,
        selectedShape: this.selectedShapeBtn,
      };
    }

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
    if (this.branch === 'pattern' && this.patternCelebrateTimer <= 0) {
      const nextColor = this.patternTarget[this.patternProgress];
      if (nextColor) return [nextColor];
    }
    return [];
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    // 1. Allow popping individual bubbles by tapping them!
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
        if (this.branch === 'highlow') {
          this.triggerFlower(i, y < height * 0.72 ? 'high' : 'low');
        } else {
          this.triggerFlower(i, 'mid');
        }
        return;
      }
    }
  }

  private switchBranch(next: MusicBranch): void {
    if (this.branch === next) return;
    this.branch = next;
    this.flowers.forEach((f) => {
      f.stemHeightFactor = 1;
    });
    if (next === 'pattern') {
      this.loadPattern(this.patternIndex);
    }
  }

  private loadPattern(idx: number): void {
    const tpl = PATTERN_TEMPLATES[idx % PATTERN_TEMPLATES.length];
    this.patternTarget = [...tpl];
    this.patternProgress = 2; // Show first 2 elements already lit so pattern rule is visible!
    this.patternCelebrateTimer = 0;
  }

  public update(dt: number, input: GameInput<MusicAction>): void {
    this.time += dt;

    // Parent/cabinet shortcut: Hold OK + press X1/X2/X3 to switch branches without a mouse
    if (input.isButtonDown('OK')) {
      if (input.justPressedButton('X1')) {
        this.switchBranch('explore');
        return;
      }
      if (input.justPressedButton('X2')) {
        this.switchBranch('highlow');
        return;
      }
      if (input.justPressedButton('X3')) {
        this.switchBranch('pattern');
        return;
      }
    }

    // 1. White Shape Buttons (X1..X6): select bubble shape & float a shimmering shape bubble!
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      if (input.justPressedButton(sBtn)) {
        this.selectedShapeBtn = sBtn;
        this.audio.playShapeSparkle(idx);
        const shape = SHAPE_BUTTON_META[sBtn].shape;
        this.spawnBubble(0.5 + (idx - 2.5) * 0.1, 0.76, 34, '#FFFFFF', '#E1F5FE', shape, -0.14);
      }
    });

    // 2. Colored Buttons:
    // - In 'highlow' branch: R1..Y1 (+) trigger 'high', R2..Y2 (-) trigger 'low'
    // - In 'explore' & 'pattern' branches: merged RED/GREEN/BLUE/YELLOW (8 buttons = 4!)
    if (this.branch === 'highlow') {
      this.flowers.forEach((fl, idx) => {
        if (input.justPressedButton(fl.topBtn)) {
          this.triggerFlower(idx, 'high');
        }
        if (input.justPressedButton(fl.bottomBtn)) {
          this.triggerFlower(idx, 'low');
        }
      });
    } else {
      const acts: MusicAction[] = ['bloomRed', 'bloomGreen', 'bloomBlue', 'bloomYellow'];
      acts.forEach((act, idx) => {
        if (input.justPressed(act)) {
          this.triggerFlower(idx, 'mid');
        }
      });
    }

    // 3. OK Button: gently pops all bubbles in a musical cascade!
    if (input.justPressedButton('OK') && !SHAPE_BUTTON_LIST.some((s) => input.isButtonDown(s))) {
      this.popAllBubbles();
    }

    // 4. Pattern celebration advance
    if (this.branch === 'pattern' && this.patternCelebrateTimer > 0) {
      this.patternCelebrateTimer -= dt;
      if (this.patternCelebrateTimer <= 0) {
        this.patternIndex = (this.patternIndex + 1) % PATTERN_TEMPLATES.length;
        this.loadPattern(this.patternIndex);
      }
    }

    // 5. Animate flowers, bubbles & pop rings
    for (const fl of this.flowers) {
      fl.bloomScale += (1 - fl.bloomScale) * Math.min(1, dt * 8);
      fl.rippleAge += dt;
      if (this.branch !== 'highlow') {
        fl.stemHeightFactor += (1 - fl.stemHeightFactor) * Math.min(1, dt * 5);
      }
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

  private triggerFlower(flowerIdx: number, register: 'low' | 'mid' | 'high'): void {
    const fl = this.flowers[flowerIdx];
    if (!fl) return;
    const pal = CABINET_COLOR_PALETTE[fl.color];
    const activeShape = SHAPE_BUTTON_META[this.selectedShapeBtn].shape;
    const normX = 0.19 + flowerIdx * 0.206;

    fl.bloomScale = register === 'high' ? 1.42 : register === 'low' ? 1.22 : 1.32;
    fl.rippleAge = 0;

    if (register === 'high') {
      fl.stemHeightFactor = 1.34;
      this.audio.playMusicalBloom(fl.baseFreq * 2, 'bright');
      // One GIANT floaty bubble!
      this.spawnBubble(normX, 0.56, 48, pal.face, pal.light, activeShape, -0.15);
    } else if (register === 'low') {
      fl.stemHeightFactor = 0.68;
      this.audio.playMusicalBloom(fl.baseFreq * 0.5, 'bass');
      // Cluster of 3 small bouncy bubbles!
      for (let k = -1; k <= 1; k++) {
        this.spawnBubble(
          normX + k * 0.032,
          0.74,
          19,
          pal.face,
          pal.light,
          activeShape,
          -0.085 - Math.random() * 0.03
        );
      }
    } else {
      fl.stemHeightFactor = 1.08;
      this.audio.playMusicalBloom(fl.baseFreq, 'warm');
      this.spawnBubble(normX, 0.66, 32, pal.face, pal.light, activeShape, -0.115);
    }

    // Update free-play visual note bead trail
    this.recentTrail.push(fl.color);
    if (this.recentTrail.length > 8) {
      this.recentTrail.shift();
    }

    // Check pattern completion if in 'pattern' branch!
    if (this.branch === 'pattern' && this.patternCelebrateTimer <= 0) {
      const expected = this.patternTarget[this.patternProgress];
      if (fl.color === expected) {
        this.patternProgress++;
        if (this.patternProgress >= this.patternTarget.length) {
          this.patternCelebrateTimer = 2.4;
          this.audio.playStageComplete(true);
        }
      }
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
      // Spawn a cheerful rainbow burst of 4 bubbles if empty!
      for (let i = 0; i < 4; i++) {
        this.triggerFlower(i, 'mid');
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

    // 1. Soft Pastel Dawn-Garden Sky
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#E1F5FE');
    sky.addColorStop(0.6, '#F3E5F5');
    sky.addColorStop(1, '#FFFDE7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    // Gentle rolling garden lawn
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

    // 2. Top-Center Pattern Caterpillar Vine (or 8-Note Recent Melody Bead String!)
    this.renderOverheadBeadVine(ctx, width);

    // 3. Floating Shape-Stamped Bubbles & Pop Ripples
    for (const b of this.bubbles) {
      const bx = b.x * width;
      const by = b.y * height;
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = b.lightColor;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Shape emblem floating inside the bubble!
      drawCabinetShape(ctx, bx, by, b.radius * 0.52, b.shape, {
        fill: b.color,
        stroke: '#FFFFFF',
        lineWidth: 2,
      });

      // Glossy bubble highlight crescent
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

    // 4. The 4 Musical Flower-Pipes (arranged in R, G, B, Y cabinet order!)
    const availW = Math.min(width - 100, 1020);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;

    this.flowers.forEach((fl, idx) => {
      const fx = startX + idx * spacing;
      this.drawMusicalFlower(ctx, fx, groundY, height, fl, idx);
    });

    // 5. Active Bubble Wand Shape Indicator at bottom-left of lawn
    this.drawBubbleWandBadge(ctx, 26, groundY + 12);
  }

  private renderOverheadBeadVine(ctx: CanvasRenderingContext2D, width: number): void {
    const vineY = 74;
    const isPattern = this.branch === 'pattern';
    const beads = isPattern ? this.patternTarget : this.recentTrail;
    const slotCount = isPattern ? this.patternTarget.length : 8;
    const beadGap = 44;
    const startX = width / 2 - ((slotCount - 1) * beadGap) / 2;

    // Leafy green vine stem
    ctx.strokeStyle = '#689F38';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX - 34, vineY);
    ctx.lineTo(startX + (slotCount - 1) * beadGap + 34, vineY);
    ctx.stroke();

    // Smiling caterpillar head on the left when in Pattern branch!
    if (isPattern) {
      const hx = startX - 36;
      ctx.fillStyle = '#7CB342';
      ctx.beginPath();
      ctx.arc(hx, vineY, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(hx - 5, vineY - 4, 2.5, 0, Math.PI * 2);
      ctx.arc(hx + 5, vineY - 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, vineY + 1, 7, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    for (let i = 0; i < slotCount; i++) {
      const bx = startX + i * beadGap;
      const col = beads[i];
      if (!col) {
        // Empty bead slot in Explore trail
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(bx, vineY, 13, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const pal = CABINET_COLOR_PALETTE[col];
      const filled = !isPattern || i < this.patternProgress;
      const isNextTarget = isPattern && i === this.patternProgress && this.patternCelebrateTimer <= 0;

      ctx.save();
      if (isNextTarget) {
        const pulse = 1 + Math.sin(this.time * 7) * 0.14;
        ctx.translate(bx, vineY);
        ctx.scale(pulse, pulse);
        ctx.translate(-bx, -vineY);
      }

      ctx.fillStyle = filled ? pal.face : pal.light;
      ctx.strokeStyle = isNextTarget ? '#141926' : filled ? '#FFFFFF' : pal.face;
      ctx.lineWidth = isNextTarget ? 3.5 : 2.5;
      if (isNextTarget) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(bx, vineY, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
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

    // Wooden flower pot / marimba resonator base
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

    // Stem & leaves
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

    // Expanding sound ripple ring when played
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

    // 6-petal flower head!
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

    // Smiling flower center
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

    // In 'High / Low (+/-)' branch, display clear + (High/Big) & - (Low/Small) badges on each flower!
    if (this.branch === 'highlow') {
      ctx.fillStyle = pal.face;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 38, groundY - 58, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 38, groundY - 26, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#141926';
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', cx + 38, groundY - 57.5);
      ctx.fillText('−', cx + 38, groundY - 25.5);
    }
  }

  private drawBubbleWandBadge(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const meta = SHAPE_BUTTON_META[this.selectedShapeBtn];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, 162, 40, 20);
    ctx.fill();

    drawCabinetShape(ctx, x + 24, y + 20, 12, meta.shape, {
      stroke: '#141926',
      lineWidth: 2.5,
      fill: '#FFE082',
    });

    ctx.fillStyle = '#263238';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Wand: ${meta.label}`, x + 44, y + 21);
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const musicGardenGameDefinition: ArcadeGameDefinition<MusicAction> = {
  id: 'music-bubbles',
  title: 'Music & Bubbles',
  subtitle: 'High (+) & low (-) flower notes + shape bubbles!',
  accentColor: '#AB47BC',
  developmental: {
    parentCategory: 'Sound & Bubbles · +/-',
    primaryTags: ['A1', 'A2'],
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

      // Floating shaped bubble above each flower
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
