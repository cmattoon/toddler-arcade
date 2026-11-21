/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: animal-doors
 * activity: peekaboo-explore & hide-and-find
 * primary_tags: [A1, E1]
 * secondary_tags: [G1, B2]
 * concept:
 *   - Explore (A1): Deliberate button presses open matching colored doors to reveal familiar animals and repeat playful greetings.
 *   - Find Friend (E1): An animal visibly hides behind one colored door and stays there until found (object permanence & location memory).
 * child_action: "Press any Red, Green, Blue, or Yellow button pair to open that door; press white Shape buttons to share hats, kites, stars, or hearts."
 * complexity_step: "Progress from free peekaboo discovery (A1) to remembering which door a friend just entered (E1)."
 * not_complexity: "No timers, speed pressure, or failure buzzers."
 * feedback: "Doors swing open on hinges; empty doors show a cozy empty room with a soft knock; occupied doors reveal the waving animal."
 * real_world_extension: "Play peekaboo with a blanket or hide a favorite plush animal under one of two colored cups."
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

type DoorsAction = 'doorRed' | 'doorGreen' | 'doorBlue' | 'doorYellow';
type AnimalId = 'puppy' | 'frog' | 'duck' | 'kitty';
type ActivityBranch = 'explore' | 'find';

interface DoorState {
  color: MergedColorButton;
  animal: AnimalId;
  animalLabel: string;
  isOpen: boolean;
  openProgress: number; // 0 (closed) .. 1 (open)
  bounceTimer: number;
  autoCloseTimer: number;
}

interface FloatingShapeToken {
  x: number;
  y: number;
  vx: number;
  vy: number;
  shape: ShapeKind;
  color: string;
  size: number;
  age: number;
  maxAge: number;
}

const DOOR_ANIMALS: Array<{ color: MergedColorButton; animal: AnimalId; label: string }> = [
  { color: 'RED', animal: 'puppy', label: 'Puppy' },
  { color: 'GREEN', animal: 'frog', label: 'Frog' },
  { color: 'BLUE', animal: 'duck', label: 'Duck' },
  { color: 'YELLOW', animal: 'kitty', label: 'Kitty' },
];

class PeekabooDoorsGame implements ArcadeGameInstance<DoorsAction> {
  private audio: GameContext['audio'];
  private time = 0;
  private branch: ActivityBranch = 'explore';

  private doors: DoorState[] = DOOR_ANIMALS.map((d) => ({
    color: d.color,
    animal: d.animal,
    animalLabel: d.label,
    isOpen: false,
    openProgress: 0,
    bounceTimer: 0,
    autoCloseTimer: 0,
  }));

  // White Shape button active prop/accessory state
  private activeShapeButton: ShapeButton | null = null;
  private wearingPartyHats = false;
  private kiteTimer = 0;
  private sunGlowTimer = 0;
  private giftBoxVisible = false;
  private floatingTokens: FloatingShapeToken[] = [];

  // 'Find Friend' (E1 Location Memory) state
  private hidingDoorIdx = 1;
  private hidingAnimal: AnimalId = 'frog';
  private findPhase: 'walking_in' | 'waiting_guess' | 'celebrating' = 'walking_in';
  private phaseTimer = 0;
  private walkerStartX = 0.15;

  constructor(context: GameContext, initialModeId?: string) {
    this.audio = context.audio;
    if (initialModeId === 'find') {
      this.branch = 'find';
      this.startNextHideRound();
    }
  }

  public getMode(): string {
    return this.branch;
  }

  public setMode(modeId: string): void {
    this.switchBranch(modeId === 'find' ? 'find' : 'explore');
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red Door',
        GREEN: 'Green Door',
        BLUE: 'Blue Door',
        YELLOW: 'Yellow Door',
      },
      shapesActive: true,
      selectedShape: this.activeShapeButton,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    // Allow tapping directly on any of the 4 cottage doors on touchscreens
    const layout = this.computeDoorLayout(width, height);
    for (let i = 0; i < 4; i++) {
      const dx = layout.startX + i * layout.spacing;
      if (
        x >= dx - layout.doorW * 0.6 &&
        x <= dx + layout.doorW * 0.6 &&
        y >= layout.groundY - layout.doorH * 1.3 &&
        y <= layout.groundY + 20
      ) {
        this.triggerDoor(i);
        return;
      }
    }
  }

  private switchBranch(next: ActivityBranch): void {
    if (this.branch === next) return;
    this.branch = next;
    for (const d of this.doors) {
      d.isOpen = false;
      d.bounceTimer = 0;
      d.autoCloseTimer = 0;
    }
    if (next === 'find') {
      this.startNextHideRound();
    }
  }

  private startNextHideRound(): void {
    for (const d of this.doors) {
      d.isOpen = false;
      d.bounceTimer = 0;
    }
    // Pick a new door & animal (varied from previous so it feels fresh)
    const nextDoor = (this.hidingDoorIdx + 1 + Math.floor(Math.random() * 3)) % 4;
    this.hidingDoorIdx = nextDoor;
    this.hidingAnimal = DOOR_ANIMALS[Math.floor(Math.random() * DOOR_ANIMALS.length)].animal;
    this.walkerStartX = nextDoor < 2 ? 0.88 : 0.12;
    this.findPhase = 'walking_in';
    this.phaseTimer = 0;
  }

  public update(dt: number, input: GameInput<DoorsAction>): void {
    this.time += dt;

    // Parent/cabinet shortcut: Hold OK + press X1/X2 to switch between Explore & Find Friend
    if (input.isButtonDown('OK')) {
      if (input.justPressedButton('X1')) {
        this.switchBranch('explore');
        return;
      }
      if (input.justPressedButton('X2')) {
        this.switchBranch('find');
        return;
      }
    }

    // 1. Handle the 6 White Shape Buttons (X1..X6)
    for (let idx = 0; idx < SHAPE_BUTTON_LIST.length; idx++) {
      const sBtn = SHAPE_BUTTON_LIST[idx];
      if (input.justPressedButton(sBtn)) {
        this.triggerShapeSurprise(sBtn, idx);
      }
    }

    // 2. Handle the 4 Merged Colored Button Pairs (R1/R2, G1/G2, B1/B2, Y1/Y2)
    const actions: DoorsAction[] = ['doorRed', 'doorGreen', 'doorBlue', 'doorYellow'];
    actions.forEach((act, idx) => {
      if (input.justPressed(act)) {
        this.triggerDoor(idx);
      }
    });

    // 3. OK button: in Explore mode, opens all doors for a group hello (or closes if all open);
    // in Find mode during celebration, starts the next round right away.
    if (input.justPressedButton('OK') && !SHAPE_BUTTON_LIST.some((s) => input.isButtonDown(s))) {
      if (this.branch === 'explore') {
        const allOpen = this.doors.every((d) => d.isOpen);
        if (allOpen) {
          this.doors.forEach((d) => {
            d.isOpen = false;
          });
          this.audio.playGentleWoodKnock();
        } else {
          this.doors.forEach((d, idx) => {
            d.isOpen = true;
            d.bounceTimer = 0.9;
            d.autoCloseTimer = 7.0;
            if (idx === 0) this.audio.playStageComplete(false);
          });
        }
      } else if (this.findPhase === 'celebrating') {
        this.startNextHideRound();
      }
    }

    // 4. Update 'Find Friend' phase state machine
    if (this.branch === 'find') {
      this.phaseTimer += dt;
      if (this.findPhase === 'walking_in') {
        // Open target door briefly as friend walks inside, then close it!
        const target = this.doors[this.hidingDoorIdx];
        target.isOpen = this.phaseTimer > 0.95 && this.phaseTimer < 1.85;
        if (this.phaseTimer >= 2.05) {
          target.isOpen = false;
          this.findPhase = 'waiting_guess';
          this.phaseTimer = 0;
          this.audio.playGentleWoodKnock();
        }
      } else if (this.findPhase === 'celebrating') {
        if (this.phaseTimer >= 3.0) {
          this.startNextHideRound();
        }
      }
    }

    // 5. Smoothly animate doors & animal bounces
    for (const d of this.doors) {
      const targetOpen = d.isOpen ? 1 : 0;
      d.openProgress += (targetOpen - d.openProgress) * Math.min(1, dt * 9);
      if (d.bounceTimer > 0) {
        d.bounceTimer = Math.max(0, d.bounceTimer - dt);
      }
      if (this.branch === 'explore' && d.isOpen) {
        d.autoCloseTimer -= dt;
        if (d.autoCloseTimer <= 0) {
          d.isOpen = false;
        }
      }
    }

    if (this.kiteTimer > 0) this.kiteTimer = Math.max(0, this.kiteTimer - dt);
    if (this.sunGlowTimer > 0) this.sunGlowTimer = Math.max(0, this.sunGlowTimer - dt);

    // Optional playful joystick breeze nudges floating tokens gently left/right!
    for (let i = this.floatingTokens.length - 1; i >= 0; i--) {
      const t = this.floatingTokens[i];
      t.age += dt;
      if (t.age >= t.maxAge) {
        this.floatingTokens.splice(i, 1);
        continue;
      }
      t.x += (t.vx + input.axisX * 36) * dt;
      t.y += t.vy * dt;
    }
  }

  private triggerDoor(doorIdx: number): void {
    const door = this.doors[doorIdx];
    if (!door) return;

    if (this.branch === 'explore') {
      const wasOpen = door.isOpen;
      door.isOpen = true;
      door.bounceTimer = 0.85;
      door.autoCloseTimer = 6.5;
      this.audio.playAnimalDoorGreeting(door.animal, wasOpen);
      return;
    }

    // 'Find Friend' mode
    if (this.findPhase !== 'waiting_guess') return;
    if (doorIdx === this.hidingDoorIdx) {
      door.isOpen = true;
      door.bounceTimer = 1.4;
      this.findPhase = 'celebrating';
      this.phaseTimer = 0;
      this.audio.playAnimalDoorGreeting(this.hidingAnimal, false);
      this.spawnCelebrationShapes(doorIdx, 'star', '#FFD54F');
    } else if (!door.isOpen) {
      // Non-punitive intelligible feedback: door opens to show an empty room with a gentle knock!
      door.isOpen = true;
      this.audio.playGentleWoodKnock();
    }
  }

  private triggerShapeSurprise(sBtn: ShapeButton, shapeIdx: number): void {
    this.activeShapeButton = sBtn;
    const meta = SHAPE_BUTTON_META[sBtn];
    this.audio.playShapeSparkle(shapeIdx);

    if (meta.shape === 'triangle') {
      this.wearingPartyHats = !this.wearingPartyHats;
    } else if (meta.shape === 'square') {
      this.giftBoxVisible = !this.giftBoxVisible;
    } else if (meta.shape === 'circle') {
      this.sunGlowTimer = 4.5;
    } else if (meta.shape === 'diamond') {
      this.kiteTimer = 6.0;
    }

    const tokenColors: Record<ShapeKind, string> = {
      square: '#AB47BC',
      circle: '#FFD54F',
      triangle: '#FF7043',
      diamond: '#26C6DA',
      star: '#FFEE58',
      heart: '#EC407A',
    };

    // Float gentle matching shapes across the meadow (especially above open doors!)
    for (let i = 0; i < 4; i++) {
      this.spawnCelebrationShapes(i, meta.shape, tokenColors[meta.shape]);
    }
  }

  private spawnCelebrationShapes(doorIdx: number, shape: ShapeKind, color: string): void {
    const normX = 0.16 + doorIdx * 0.226;
    for (let k = 0; k < 2; k++) {
      this.floatingTokens.push({
        x: normX + (Math.random() - 0.5) * 0.08,
        y: 0.62 - Math.random() * 0.08,
        vx: (Math.random() - 0.5) * 0.04,
        vy: -(0.09 + Math.random() * 0.06),
        shape,
        color,
        size: 15 + Math.random() * 6,
        age: 0,
        maxAge: 2.2 + Math.random() * 0.6,
      });
    }
  }

  private computeDoorLayout(width: number, height: number) {
    const groundY = Math.round(height * 0.8);
    const availW = Math.min(width - 80, 1080);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;
    const doorW = Math.min(156, spacing * 0.66);
    const doorH = Math.min(215, height * 0.43);
    return { groundY, spacing, startX, doorW, doorH };
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const { groundY, spacing, startX, doorW, doorH } = this.computeDoorLayout(width, height);

    // 1. Calm Storybook Sky & Rolling Meadow Hills
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#90CAF9');
    sky.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    // Smiling Sun (beams extra warmly when Circle X2 button is pressed!)
    const sunX = width * 0.86;
    const sunY = height * 0.17;
    const sunPulse = this.sunGlowTimer > 0 ? 1 + Math.sin(this.time * 6) * 0.12 : 1;
    if (this.sunGlowTimer > 0) {
      ctx.fillStyle = 'rgba(255, 238, 88, 0.34)';
      ctx.beginPath();
      ctx.arc(sunX, sunY, 58 * sunPulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#FDD835';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34 * sunPulse, 0, Math.PI * 2);
    ctx.fill();

    // Diamond Kite flying across the sky when X4 (Diamond) was pressed!
    if (this.kiteTimer > 0) {
      const kx = width * 0.5 + Math.sin(this.time * 1.8) * (width * 0.22);
      const ky = height * 0.2 + Math.cos(this.time * 2.7) * 16;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(kx, ky + 22);
      ctx.quadraticCurveTo(kx - 24, ky + 62, kx - 52, ky + 95);
      ctx.stroke();
      drawCabinetShape(ctx, kx, ky, 24, 'diamond', {
        fill: '#26C6DA',
        stroke: '#FFFFFF',
        lineWidth: 3,
      });
    }

    // Soft distant meadow hills
    ctx.fillStyle = '#A5D6A7';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(width * 0.25, groundY - 76, width * 0.55, groundY - 34);
    ctx.quadraticCurveTo(width * 0.82, groundY - 70, width, groundY - 22);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Foreground grassy lawn & stone garden path
    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#DCE775';
    ctx.fillRect(0, groundY, width, 6);

    // 2. Render the 4 Colored Cottages & Swinging Peekaboo Doors!
    for (let i = 0; i < 4; i++) {
      const d = this.doors[i];
      const cx = startX + i * spacing;
      this.drawCottageDoor(ctx, cx, groundY, doorW, doorH, d, i);
    }

    // 3. In 'Find Friend' mode, draw the animal walking into the hiding door + visual prompt badge!
    if (this.branch === 'find') {
      this.renderFindFriendOverlay(ctx, width, groundY, startX, spacing, doorH);
    }

    // 4. Floating Shape Tokens (Stars, Hearts, Diamonds, etc.)
    for (const t of this.floatingTokens) {
      const alpha = Math.max(0, 1 - t.age / t.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCabinetShape(ctx, t.x * width, t.y * height, t.size, t.shape, {
        fill: t.color,
        stroke: '#FFFFFF',
        lineWidth: 2.2,
      });
      ctx.restore();
    }
  }

  private drawCottageDoor(
    ctx: CanvasRenderingContext2D,
    cx: number,
    groundY: number,
    doorW: number,
    doorH: number,
    d: DoorState,
    doorIdx: number
  ): void {
    const pal = CABINET_COLOR_PALETTE[d.color];
    const houseW = doorW * 1.24;
    const houseH = doorH * 1.08;

    // Cozy cream cottage wall & pitched roof
    ctx.fillStyle = '#FFFDF7';
    ctx.strokeStyle = '#BCAAA4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cx - houseW / 2, groundY - houseH, houseW, houseH, [12, 12, 4, 4]);
    ctx.fill();
    ctx.stroke();

    // Colored gable roof matching the door's arcade button!
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.moveTo(cx - houseW * 0.58, groundY - houseH + 6);
    ctx.lineTo(cx, groundY - houseH - 54);
    ctx.lineTo(cx + houseW * 0.58, groundY - houseH + 6);
    ctx.closePath();
    ctx.fill();

    // Doorway interior recess
    const frameX = cx - doorW / 2;
    const frameY = groundY - doorH;
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(frameX, frameY, doorW, doorH, [doorW * 0.42, doorW * 0.42, 0, 0]);
    ctx.fill();

    // Warm interior room wallpaper & rug when door swings open
    if (d.openProgress > 0.03) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(frameX + 4, frameY + 4, doorW - 8, doorH - 4, [doorW * 0.4, doorW * 0.4, 0, 0]);
      ctx.clip();

      ctx.fillStyle = '#FFF8E1';
      ctx.fillRect(frameX, frameY, doorW, doorH);
      ctx.fillStyle = '#FFE0B2';
      ctx.fillRect(frameX, groundY - 26, doorW, 26);

      // Should an animal be drawn inside this doorway?
      const showAnimal =
        this.branch === 'explore' ||
        (this.branch === 'find' &&
          this.findPhase === 'celebrating' &&
          doorIdx === this.hidingDoorIdx);
      const animalToDraw =
        this.branch === 'explore' ? d.animal : this.hidingAnimal;

      if (showAnimal) {
        const hop =
          d.bounceTimer > 0
            ? Math.abs(Math.sin(this.time * 12)) * 20 * Math.min(1, d.bounceTimer * 1.5)
            : Math.sin(this.time * 3 + doorIdx) * 3;
        this.drawAnimalFriend(
          ctx,
          cx,
          groundY - 14 - hop,
          Math.min(1, doorW / 140),
          animalToDraw,
          this.wearingPartyHats
        );
      }
      ctx.restore();
    }

    // Swinging Colored Wooden Door Panel (hinged on left edge!)
    const swing = d.openProgress;
    const panelW = Math.max(12, doorW * (1 - swing * 0.86));
    const skewY = swing * 14;

    ctx.save();
    ctx.fillStyle = pal.face;
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(frameX, groundY);
    ctx.lineTo(frameX, frameY + doorW * 0.36);
    ctx.quadraticCurveTo(
      frameX + panelW * 0.5,
      frameY - skewY * 0.5,
      frameX + panelW,
      frameY + doorW * 0.36 - skewY
    );
    ctx.lineTo(frameX + panelW, groundY - skewY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Shape window on door face (Square, Circle, Triangle, Heart) + brass doorknob!
    if (swing < 0.72) {
      const doorShapes: ShapeKind[] = ['square', 'circle', 'triangle', 'heart'];
      const winX = frameX + panelW * 0.54;
      const winY = frameY + doorH * 0.36 - skewY * 0.55;
      ctx.save();
      ctx.scale(Math.max(0.25, 1 - swing * 0.82), 1);
      drawCabinetShape(
        ctx,
        winX / Math.max(0.25, 1 - swing * 0.82),
        winY,
        18,
        doorShapes[doorIdx],
        {
          fill: pal.light,
          stroke: pal.dark,
          lineWidth: 2.5,
        }
      );
      ctx.restore();

      // Brass doorknob
      ctx.fillStyle = '#FFD54F';
      ctx.beginPath();
      ctx.arc(frameX + panelW * 0.82, groundY - doorH * 0.42 - skewY * 0.8, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Stone doorstep (+ optional Square Gift Box when X1 was toggled!)
    ctx.fillStyle = '#CFD8DC';
    ctx.beginPath();
    ctx.roundRect(cx - doorW * 0.58, groundY, doorW * 1.16, 12, 5);
    ctx.fill();

    if (this.giftBoxVisible) {
      const gx = cx + doorW * 0.42;
      const gy = groundY - 2;
      ctx.fillStyle = '#AB47BC';
      ctx.fillRect(gx - 13, gy - 24, 26, 24);
      ctx.fillStyle = '#FFD54F';
      ctx.fillRect(gx - 3, gy - 24, 6, 24);
      ctx.fillRect(gx - 13, gy - 14, 26, 5);
    }

    // Matching colored button dot indicator on path below doorstep
    ctx.fillStyle = pal.face;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, groundY + 34, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawAnimalFriend(
    ctx: CanvasRenderingContext2D,
    cx: number,
    feetY: number,
    scale: number,
    animal: AnimalId,
    partyHat: boolean
  ): void {
    ctx.save();
    ctx.translate(cx, feetY);
    ctx.scale(scale, scale);

    if (animal === 'puppy') {
      // Body & wagging tail
      const wag = Math.sin(this.time * 14) * 10;
      ctx.strokeStyle = '#A1887F';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(22, -26);
      ctx.quadraticCurveTo(42, -38, 38 + wag * 0.6, -54);
      ctx.stroke();

      ctx.fillStyle = '#D7CCC8';
      ctx.beginPath();
      ctx.ellipse(0, -34, 30, 34, 0, 0, Math.PI * 2);
      ctx.fill();

      // Floppy ears
      ctx.fillStyle = '#795548';
      ctx.beginPath();
      ctx.ellipse(-28, -76, 11, 24, 0.25, 0, Math.PI * 2);
      ctx.ellipse(28, -76, 11, 24, -0.25, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = '#D7CCC8';
      ctx.beginPath();
      ctx.arc(0, -82, 28, 0, Math.PI * 2);
      ctx.fill();

      // Red collar
      ctx.fillStyle = '#EF5350';
      ctx.fillRect(-18, -58, 36, 7);

      // Eyes & nose
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(-10, -86, 3.8, 0, Math.PI * 2);
      ctx.arc(10, -86, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -76, 6, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (animal === 'frog') {
      // Plump green body
      ctx.fillStyle = '#66BB6A';
      ctx.beginPath();
      ctx.ellipse(0, -34, 34, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#DCEDC8';
      ctx.beginPath();
      ctx.ellipse(0, -28, 22, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head & big friendly frog eyes on top
      ctx.fillStyle = '#66BB6A';
      ctx.beginPath();
      ctx.ellipse(0, -72, 32, 24, 0, 0, Math.PI * 2);
      ctx.arc(-16, -94, 12, 0, Math.PI * 2);
      ctx.arc(16, -94, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(-16, -94, 8, 0, Math.PI * 2);
      ctx.arc(16, -94, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(-16, -94, 4, 0, Math.PI * 2);
      ctx.arc(16, -94, 4, 0, Math.PI * 2);
      ctx.fill();

      // Big cheerful grin
      ctx.strokeStyle = '#1B5E20';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -70, 15, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (animal === 'duck') {
      // Fluffy yellow duckling with flapping wings
      const flap = Math.sin(this.time * 12) * 8;
      ctx.fillStyle = '#FFEE58';
      ctx.beginPath();
      ctx.ellipse(0, -34, 30, 32, 0, 0, Math.PI * 2);
      ctx.ellipse(-30, -38 - flap * 0.4, 10, 18, 0.4, 0, Math.PI * 2);
      ctx.ellipse(30, -38 - flap * 0.4, 10, 18, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.beginPath();
      ctx.arc(0, -78, 25, 0, Math.PI * 2);
      ctx.fill();

      // Blue sailor bow tie
      ctx.fillStyle = '#29B6F6';
      ctx.beginPath();
      ctx.moveTo(0, -54);
      ctx.lineTo(-12, -60);
      ctx.lineTo(-12, -48);
      ctx.moveTo(0, -54);
      ctx.lineTo(12, -60);
      ctx.lineTo(12, -48);
      ctx.closePath();
      ctx.fill();

      // Orange duck bill & eyes
      ctx.fillStyle = '#FF8F00';
      ctx.beginPath();
      ctx.ellipse(0, -72, 12, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(-9, -82, 3.5, 0, Math.PI * 2);
      ctx.arc(9, -82, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Sweet orange tabby kitty
      const tailSway = Math.sin(this.time * 6) * 8;
      ctx.strokeStyle = '#FFB74D';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(22, -20);
      ctx.quadraticCurveTo(44, -36, 36 + tailSway, -64);
      ctx.stroke();

      ctx.fillStyle = '#FFB74D';
      ctx.beginPath();
      ctx.ellipse(0, -34, 28, 32, 0, 0, Math.PI * 2);
      ctx.fill();

      // Pointy cat ears + round head
      ctx.beginPath();
      ctx.moveTo(-24, -88);
      ctx.lineTo(-26, -114);
      ctx.lineTo(-6, -100);
      ctx.moveTo(24, -88);
      ctx.lineTo(26, -114);
      ctx.lineTo(6, -100);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, -80, 26, 0, Math.PI * 2);
      ctx.fill();

      // Whiskers & pink nose
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(-9, -84, 3.5, 0, Math.PI * 2);
      ctx.arc(9, -84, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F06292';
      ctx.beginPath();
      ctx.arc(0, -76, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5D4037';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -76);
      ctx.lineTo(-28, -79);
      ctx.moveTo(-12, -73);
      ctx.lineTo(-28, -71);
      ctx.moveTo(12, -76);
      ctx.lineTo(28, -79);
      ctx.moveTo(12, -73);
      ctx.lineTo(28, -71);
      ctx.stroke();
    }

    // Optional Triangle Party Hat (toggled by White Triangle Button X3!)
    if (partyHat) {
      ctx.fillStyle = '#FF7043';
      ctx.beginPath();
      ctx.moveTo(-14, -104);
      ctx.lineTo(0, -136);
      ctx.lineTo(14, -104);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFEE58';
      ctx.beginPath();
      ctx.arc(0, -138, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private renderFindFriendOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    groundY: number,
    startX: number,
    spacing: number,
    doorH: number
  ): void {
    const targetX = startX + this.hidingDoorIdx * spacing;

    // 1. Visual picture badge at top-center showing who we're looking for (no reading needed!)
    const badgeW = 190;
    const badgeH = 56;
    const bx = width / 2 - badgeW / 2;
    const by = 14;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#FFB300';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(bx, by, badgeW, badgeH, 28);
    ctx.fill();
    ctx.stroke();

    // Mini portrait of the hiding animal inside the top badge
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx + 34, by + 28, 22, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#E3F2FD';
    ctx.fillRect(bx + 10, by + 4, 48, 48);
    this.drawAnimalFriend(ctx, bx + 34, by + 62, 0.42, this.hidingAnimal, false);
    ctx.restore();

    ctx.fillStyle = '#263238';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      this.findPhase === 'celebrating' ? 'Found!' : 'Where are they?',
      bx + 62,
      by + 29
    );

    // 2. During 'walking_in', show the animal trotting across the garden path into the hiding door!
    if (this.findPhase === 'walking_in') {
      const t = Math.min(1, this.phaseTimer / 1.55);
      const smooth = t * t * (3 - 2 * t);
      const wx = this.walkerStartX * width + (targetX - this.walkerStartX * width) * smooth;
      const walkBob = Math.abs(Math.sin(this.time * 14)) * 10;
      const fadeInDoor = this.phaseTimer > 1.35 ? Math.max(0, 1 - (this.phaseTimer - 1.35) / 0.45) : 1;

      ctx.save();
      ctx.globalAlpha = fadeInDoor;
      this.drawAnimalFriend(
        ctx,
        wx,
        groundY + 8 - walkBob,
        Math.min(1, doorH / 215),
        this.hidingAnimal,
        this.wearingPartyHats
      );
      ctx.restore();
    }
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const animalDoorsGameDefinition: ArcadeGameDefinition<DoorsAction> = {
  id: 'peekaboo-doors',
  title: 'Peekaboo Doors',
  subtitle: 'Open colored doors to greet animal friends!',
  accentColor: '#EF5350',
  developmental: {
    parentCategory: 'Cause & Effect',
    primaryTags: ['A1'],
    secondaryTags: ['G1', 'B2'],
  },
  controls: [
    { action: 'doorRed', button: 'RED', label: 'Red Door', icon: 'paw' },
    { action: 'doorGreen', button: 'GREEN', label: 'Green Door', icon: 'paw' },
    { action: 'doorBlue', button: 'BLUE', label: 'Blue Door', icon: 'paw' },
    { action: 'doorYellow', button: 'YELLOW', label: 'Yellow Door', icon: 'paw' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const groundY = height * 0.78;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#90CAF9');
    sky.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, groundY, width, height - groundY);

    const doorW = Math.min(54, width * 0.16);
    const doorH = height * 0.44;
    const spacing = width * 0.21;
    const startX = width / 2 - spacing * 1.5;

    CABINET_COLOR_COLUMNS.forEach((col, idx) => {
      const pal = CABINET_COLOR_PALETTE[col];
      const cx = startX + idx * spacing;

      ctx.fillStyle = '#FFFDF7';
      ctx.beginPath();
      ctx.roundRect(cx - doorW * 0.6, groundY - doorH * 1.05, doorW * 1.2, doorH * 1.05, 6);
      ctx.fill();

      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.moveTo(cx - doorW * 0.7, groundY - doorH * 1.02);
      ctx.lineTo(cx, groundY - doorH * 1.32);
      ctx.lineTo(cx + doorW * 0.7, groundY - doorH * 1.02);
      ctx.closePath();
      ctx.fill();

      // Open green door slightly on cover to show peeking frog!
      const isPeeking = idx === 1;
      if (isPeeking) {
        ctx.fillStyle = '#263238';
        ctx.fillRect(cx - doorW * 0.45, groundY - doorH * 0.9, doorW * 0.9, doorH * 0.9);
        const hop = selected ? Math.abs(Math.sin(timeSec * 6)) * 5 : 0;
        ctx.fillStyle = '#66BB6A';
        ctx.beginPath();
        ctx.arc(cx + 4, groundY - 18 - hop, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(cx, groundY - 27 - hop, 4, 0, Math.PI * 2);
        ctx.arc(cx + 10, groundY - 27 - hop, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      const panelW = isPeeking ? doorW * 0.34 : doorW * 0.9;
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(cx - doorW * 0.45, groundY - doorH * 0.9, panelW, doorH * 0.9, [10, 10, 0, 0]);
      ctx.fill();
    });
  },
  create(context) {
    return new PeekabooDoorsGame(context);
  },
};
