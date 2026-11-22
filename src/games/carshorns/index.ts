/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world:horn-parade-garage
 * activity: four-cars-horns-and-skins
 * primary_tags: [A1, G1]
 * secondary_tags: [C1, B2]
 * concept:
 *   - Pressing the 4 colored buttons honks 4 distinct vehicles (Turbo Racer, Bouncy Bug, Big Pickup, Sunny Van), each with its own unique, harmonious horn sound.
 *   - Moving the joystick selects one of the 4 cars, and pressing any of the 6 white shape buttons applies that shape's matching paint skin directly to the selected car.
 * child_action: "Press the 4 colored buttons to honk each car's horn, move the joystick left/right to pick a car, and press any white shape button to paint it with that shape's skin."
 * complexity_step: "Coordinate directional selection (joystick) with 1-to-1 shape-to-skin customization while exploring 4 distinct horn timbres."
 * not_complexity: "No timers, wrong buttons, or failure states."
 * feedback: "Selected car glows on a golden turntable; shape-skin changes burst with matching shape sparkles; honks bounce the car, flash headlights, and float musical horn bubbles."
 * real_world_extension: "Compare toy cars of different shapes/sizes and make silly horn sounds for each one together."
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
  ShapeButton,
  ShapeKind,
} from '../../core/types';

type HornAction = 'honkRed' | 'honkGreen' | 'honkBlue' | 'honkYellow';

type CarBodyStyle = 'racer' | 'buggy' | 'truck' | 'van';

type SkinPatternId =
  | 'classic'
  | 'squares'
  | 'circles'
  | 'triangles'
  | 'diamonds'
  | 'stars'
  | 'hearts';

interface SkinSpec {
  id: SkinPatternId;
  label: string;
  /** Used when pattern !== 'classic' (classic uses each car's signature cabinet color) */
  baseHex: string;
  darkHex: string;
  accentHex: string;
  badgeShape: ShapeKind;
}

const CLASSIC_SKIN: SkinSpec = {
  id: 'classic',
  label: 'Classic Gloss',
  baseHex: '#EF5350',
  darkHex: '#B71C1C',
  accentHex: '#FFFFFF',
  badgeShape: 'circle',
};

/** 1-to-1 mapping from each physical White Shape Button (X1..X6) to its matching shape livery! */
const SHAPE_SKINS: Record<ShapeButton, SkinSpec> = {
  X1: {
    id: 'squares',
    label: 'Checkered Squares',
    baseHex: '#FFB300',
    darkHex: '#E65100',
    accentHex: '#FFFFFF',
    badgeShape: 'square',
  },
  X2: {
    id: 'circles',
    label: 'Bubble Circles',
    baseHex: '#00ACC1',
    darkHex: '#006064',
    accentHex: '#FFF59D',
    badgeShape: 'circle',
  },
  X3: {
    id: 'triangles',
    label: 'Speed Triangles',
    baseHex: '#1E88E5',
    darkHex: '#0D47A1',
    accentHex: '#FFD54F',
    badgeShape: 'triangle',
  },
  X4: {
    id: 'diamonds',
    label: 'Super Diamonds',
    baseHex: '#7B1FA2',
    darkHex: '#4A148C',
    accentHex: '#80DEEA',
    badgeShape: 'diamond',
  },
  X5: {
    id: 'stars',
    label: 'Starry Galaxy',
    baseHex: '#283593',
    darkHex: '#1A237E',
    accentHex: '#FFEE58',
    badgeShape: 'star',
  },
  X6: {
    id: 'hearts',
    label: 'Sweet Hearts',
    baseHex: '#EC407A',
    darkHex: '#AD1457',
    accentHex: '#FFF59D',
    badgeShape: 'heart',
  },
};

interface CarSlotSpec {
  color: MergedColorButton;
  style: CarBodyStyle;
  name: string;
  hornLabel: string;
}

const CAR_SLOTS: CarSlotSpec[] = [
  { color: 'RED', style: 'racer', name: 'Racer', hornLabel: 'Beep-Beep!' },
  { color: 'GREEN', style: 'buggy', name: 'Buggy', hornLabel: 'Awoo-ga!' },
  { color: 'BLUE', style: 'truck', name: 'Big Truck', hornLabel: 'Hooonk!' },
  { color: 'YELLOW', style: 'van', name: 'Sunny Van', hornLabel: 'Chime!' },
];

interface ShowroomCar {
  slotIdx: number;
  color: MergedColorButton;
  style: CarBodyStyle;
  name: string;
  skinButton: ShapeButton | null;
  hopOffset: number;
  hopVel: number;
  squish: number;
  wheelAngle: number;
  wheelSpinVel: number;
  headlightTimer: number;
  hornWaveAge: number;
  holdRepeatTimer: number;
  selectPulse: number;
}

interface HornBubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  fillHex: string;
  rimHex: string;
  noteVariant: 0 | 1;
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

interface PaintSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  shape: ShapeKind;
  size: number;
  rot: number;
  vRot: number;
  age: number;
  maxAge: number;
}

interface ScheduledHonk {
  carIdx: number;
  delay: number;
}

class CarsAndHornsGame implements ArcadeGameInstance<HornAction> {
  private audio: GameContext['audio'];
  private time = 0;

  private selectedCarIdx = 0;
  private stickHoldDir: -1 | 0 | 1 = 0;
  private stickRepeatTimer = 0;

  private cars: ShowroomCar[] = CAR_SLOTS.map((s, idx) => ({
    slotIdx: idx,
    color: s.color,
    style: s.style,
    name: s.name,
    skinButton: null,
    hopOffset: 0,
    hopVel: 0,
    squish: 0,
    wheelAngle: 0,
    wheelSpinVel: 0,
    headlightTimer: 0,
    hornWaveAge: 99,
    holdRepeatTimer: 0,
    selectPulse: idx === 0 ? 1 : 0,
  }));

  private hornBubbles: HornBubble[] = [];
  private popRings: PopRing[] = [];
  private paintSparks: PaintSpark[] = [];
  private recentHonks: Array<{ color: MergedColorButton; paintHex: string }> = [];
  private scheduledHonks: ScheduledHonk[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red Horn',
        GREEN: 'Green Horn',
        BLUE: 'Blue Horn',
        YELLOW: 'Yellow Horn',
      },
      shapesActive: true,
      selectedShape: this.cars[this.selectedCarIdx]?.skinButton ?? null,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  private getSlotLayout(width: number, height: number) {
    const roadTopY = Math.round(height * 0.72);
    const carBaseY = Math.round(height * 0.81);
    const availW = Math.min(width - 64, 1140);
    const spacing = availW / 4;
    const startX = width / 2 - spacing * 1.5;
    const carScale = Math.min(1.06, Math.max(0.68, spacing / 245));
    return { roadTopY, carBaseY, spacing, startX, carScale };
  }

  private getCarColors(car: ShowroomCar): { base: string; dark: string; accent: string; skin: SkinSpec } {
    if (!car.skinButton) {
      const pal = CABINET_COLOR_PALETTE[car.color];
      return {
        base: pal.face,
        dark: pal.dark,
        accent: '#FFFFFF',
        skin: CLASSIC_SKIN,
      };
    }
    const skin = SHAPE_SKINS[car.skinButton];
    return {
      base: skin.baseHex,
      dark: skin.darkHex,
      accent: skin.accentHex,
      skin,
    };
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    // 1. Tap floating musical horn bubbles to pop them
    for (let i = this.hornBubbles.length - 1; i >= 0; i--) {
      const b = this.hornBubbles[i];
      const dx = x - b.x * width;
      const dy = y - b.y * height;
      if (dx * dx + dy * dy <= (b.radius + 14) * (b.radius + 14)) {
        this.popSingleBubble(i);
        return;
      }
    }

    const { carBaseY, spacing, startX } = this.getSlotLayout(width, height);

    // 2. Tap one of the 6 mini shape-skin buttons in the top-left pill -> apply that shape's skin!
    if (y >= 12 && y <= 60 && x >= 16 && x <= 290) {
      for (let i = 0; i < SHAPE_BUTTON_LIST.length; i++) {
        const bx = 38 + i * 32;
        if (Math.abs(x - bx) <= 16) {
          this.applySelectedCarShapeSkin(SHAPE_BUTTON_LIST[i]);
          return;
        }
      }
    }

    // 3. Tap any of the 4 cars -> select it and honk its horn!
    for (let i = 0; i < 4; i++) {
      const cx = startX + i * spacing;
      if (Math.abs(x - cx) < spacing * 0.46 && y > carBaseY - 140 && y < carBaseY + 42) {
        if (this.selectedCarIdx !== i) {
          this.selectCar(i, true);
        }
        this.honkCar(i);
        return;
      }
    }
  }

  public update(dt: number, input: GameInput<HornAction>): void {
    this.time += dt;

    // 1. Joystick LEFT / RIGHT selects one of the 4 cars (discrete tap + gentle held repeat)
    if (input.dirJustPressed.RIGHT) {
      this.selectCar((this.selectedCarIdx + 1) % 4);
      this.stickHoldDir = 1;
      this.stickRepeatTimer = 0.34;
    } else if (input.dirJustPressed.LEFT) {
      this.selectCar((this.selectedCarIdx + 3) % 4);
      this.stickHoldDir = -1;
      this.stickRepeatTimer = 0.34;
    } else if (input.dirDown.RIGHT && !input.dirDown.LEFT) {
      if (this.stickHoldDir !== 1) {
        this.stickHoldDir = 1;
        this.stickRepeatTimer = 0.34;
      } else {
        this.stickRepeatTimer -= dt;
        if (this.stickRepeatTimer <= 0) {
          this.selectCar((this.selectedCarIdx + 1) % 4);
          this.stickRepeatTimer = 0.26;
        }
      }
    } else if (input.dirDown.LEFT && !input.dirDown.RIGHT) {
      if (this.stickHoldDir !== -1) {
        this.stickHoldDir = -1;
        this.stickRepeatTimer = 0.34;
      } else {
        this.stickRepeatTimer -= dt;
        if (this.stickRepeatTimer <= 0) {
          this.selectCar((this.selectedCarIdx + 3) % 4);
          this.stickRepeatTimer = 0.26;
        }
      }
    } else {
      this.stickHoldDir = 0;
      this.stickRepeatTimer = 0;
    }

    // Playful bonus: nudging Joystick UP gives the selected car a cheerful tire bounce!
    if (input.dirJustPressed.UP) {
      const sel = this.cars[this.selectedCarIdx];
      sel.hopVel = -210;
      sel.squish = 0.28;
      this.audio.playTireBounce();
    }

    // 2. Each White Shape Button (X1..X6) directly applies that shape's matching skin!
    for (const sBtn of SHAPE_BUTTON_LIST) {
      if (input.justPressedButton(sBtn)) {
        this.applySelectedCarShapeSkin(sBtn);
        break;
      }
    }

    // 3. 4 Colored Buttons (RED, GREEN, BLUE, YELLOW) honk the 4 cars' horns!
    const actions: HornAction[] = ['honkRed', 'honkGreen', 'honkBlue', 'honkYellow'];
    actions.forEach((act, idx) => {
      const car = this.cars[idx];
      if (input.justPressed(act)) {
        this.honkCar(idx);
        car.holdRepeatTimer = 0.52;
      } else if (input.isDown(act)) {
        car.headlightTimer = Math.max(car.headlightTimer, 0.12);
        car.holdRepeatTimer -= dt;
        if (car.holdRepeatTimer <= 0) {
          this.honkCar(idx);
          car.holdRepeatTimer = 0.48;
        }
      } else {
        car.holdRepeatTimer = 0;
      }
    });

    // 4. OK Button triggers a cheerful 4-car musical horn wave!
    if (input.justPressedButton('OK')) {
      this.triggerParadeHonkWave();
    }

    // Process scheduled parade honks
    for (let i = this.scheduledHonks.length - 1; i >= 0; i--) {
      const item = this.scheduledHonks[i];
      item.delay -= dt;
      if (item.delay <= 0) {
        this.honkCar(item.carIdx);
        this.scheduledHonks.splice(i, 1);
      }
    }

    // 5. Spring physics & animations on all 4 cars
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];

      // Springy suspension hop
      c.hopVel += 980 * dt;
      c.hopOffset += c.hopVel * dt;
      if (c.hopOffset > 0) {
        if (c.hopVel > 90) {
          c.squish = Math.max(c.squish, Math.min(0.32, c.hopVel / 850));
          c.hopVel = -c.hopVel * 0.28;
        } else {
          c.hopVel = 0;
        }
        c.hopOffset = 0;
      }

      c.squish += (0 - c.squish) * Math.min(1, dt * 10);
      c.wheelAngle += c.wheelSpinVel * dt;
      c.wheelSpinVel *= Math.pow(0.06, dt);
      c.hornWaveAge += dt;

      if (c.headlightTimer > 0) {
        c.headlightTimer = Math.max(0, c.headlightTimer - dt);
      }

      const targetSelect = i === this.selectedCarIdx ? 1 : 0;
      c.selectPulse += (targetSelect - c.selectPulse) * Math.min(1, dt * 12);
    }

    // 6. Floating musical horn bubbles
    for (let i = this.hornBubbles.length - 1; i >= 0; i--) {
      const b = this.hornBubbles[i];
      b.age += dt;
      if (b.age >= b.maxAge || b.y < -0.12) {
        this.popSingleBubble(i, true);
        continue;
      }
      const wobble = Math.sin(this.time * 2.8 + b.wobbleSeed) * 0.032;
      b.x += (b.vx + wobble) * dt;
      b.y += b.vy * dt;
      b.x = Math.max(0.05, Math.min(0.95, b.x));
    }

    // 7. Pop rings & paint sparkles
    for (let i = this.popRings.length - 1; i >= 0; i--) {
      const r = this.popRings[i];
      r.age += dt;
      if (r.age >= 0.35) {
        this.popRings.splice(i, 1);
      }
    }

    for (let i = this.paintSparks.length - 1; i >= 0; i--) {
      const p = this.paintSparks[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.paintSparks.splice(i, 1);
        continue;
      }
      p.vy += 0.48 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;
    }
  }

  private selectCar(nextIdx: number, silent = false): void {
    this.selectedCarIdx = ((nextIdx % 4) + 4) % 4;
    const car = this.cars[this.selectedCarIdx];
    car.hopVel = -145;
    car.squish = 0.18;
    if (!silent) {
      this.audio.playMenuMove();
    }
  }

  private applySelectedCarShapeSkin(sBtn: ShapeButton): void {
    const car = this.cars[this.selectedCarIdx];
    car.skinButton = sBtn;
    car.hopVel = -225;
    car.squish = 0.34;
    car.wheelSpinVel = 14;
    car.headlightTimer = 0.45;

    const { base, accent, skin } = this.getCarColors(car);
    const shapeIdx = Math.max(0, SHAPE_BUTTON_LIST.indexOf(sBtn));
    this.audio.playShapeSparkle(shapeIdx);

    const normX = 0.155 + this.selectedCarIdx * 0.23;
    const normY = 0.72;
    const sparkPalette = [base, accent, '#FFD54F', '#FFFFFF', '#80DEEA'];
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2 + Math.random() * 0.25;
      const spd = 0.14 + Math.random() * 0.22;
      this.paintSparks.push({
        x: normX + (Math.random() - 0.5) * 0.06,
        y: normY + (Math.random() - 0.5) * 0.05,
        vx: Math.cos(ang) * spd * 0.65,
        vy: Math.sin(ang) * spd - 0.12,
        color: sparkPalette[k % sparkPalette.length],
        shape: skin.badgeShape,
        size: 6.5 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 9,
        age: 0,
        maxAge: 0.65 + Math.random() * 0.25,
      });
    }
  }

  private honkCar(carIdx: number): void {
    const car = this.cars[carIdx];
    if (!car) return;

    car.hopVel = -255;
    car.squish = 0.32;
    car.wheelSpinVel = 18;
    car.headlightTimer = 0.55;
    car.hornWaveAge = 0;

    this.audio.playUniqueCarHorn(carIdx);

    const { base, accent } = this.getCarColors(car);
    const pal = CABINET_COLOR_PALETTE[car.color];
    const normX = 0.155 + carIdx * 0.23;

    if (this.hornBubbles.length >= 26) {
      this.hornBubbles.shift();
    }
    this.hornBubbles.push({
      x: normX + 0.03,
      y: 0.64,
      vx: (Math.random() - 0.5) * 0.045,
      vy: -(0.115 + Math.random() * 0.03),
      radius: 31 + (carIdx === 2 ? 4 : 0),
      fillHex: pal.light,
      rimHex: base,
      noteVariant: (carIdx % 2) as 0 | 1,
      wobbleSeed: Math.random() * Math.PI * 2,
      age: 0,
      maxAge: 7.0 + Math.random() * 2.0,
    });
    void accent;

    this.recentHonks.push({ color: car.color, paintHex: base });
    if (this.recentHonks.length > 8) {
      this.recentHonks.shift();
    }
  }

  private triggerParadeHonkWave(): void {
    this.scheduledHonks = [
      { carIdx: 0, delay: 0 },
      { carIdx: 1, delay: 0.15 },
      { carIdx: 2, delay: 0.3 },
      { carIdx: 3, delay: 0.45 },
    ];
  }

  private popSingleBubble(idx: number, silent = false): void {
    const b = this.hornBubbles[idx];
    if (!b) return;
    this.popRings.push({
      x: b.x,
      y: b.y,
      radius: b.radius,
      color: b.rimHex,
      age: 0,
    });
    this.hornBubbles.splice(idx, 1);
    if (!silent) {
      this.audio.playBubblePop();
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const { roadTopY, carBaseY, spacing, startX, carScale } = this.getSlotLayout(width, height);

    // 1. Sunny Parkland Highway Backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, roadTopY);
    sky.addColorStop(0, '#81D4FA');
    sky.addColorStop(0.65, '#E1F5FE');
    sky.addColorStop(1, '#FFFDE7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, roadTopY);

    // Drifting clouds
    this.drawSoftCloud(ctx, ((width * 0.2 + this.time * 10) % (width + 180)) - 90, height * 0.16, 0.9);
    this.drawSoftCloud(ctx, ((width * 0.72 + this.time * 7) % (width + 180)) - 90, height * 0.13, 0.78);

    // Rolling green hills behind the showroom strip
    ctx.fillStyle = '#AED581';
    ctx.beginPath();
    ctx.moveTo(0, roadTopY);
    ctx.quadraticCurveTo(width * 0.26, roadTopY - 54, width * 0.56, roadTopY - 22);
    ctx.quadraticCurveTo(width * 0.82, roadTopY - 48, width, roadTopY - 14);
    ctx.lineTo(width, roadTopY);
    ctx.closePath();
    ctx.fill();

    // Grass verge & wide showroom asphalt boulevard
    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, roadTopY - 14, width, 18);

    ctx.fillStyle = '#37474F';
    ctx.fillRect(0, roadTopY, width, height - roadTopY);
    ctx.fillStyle = '#ECEFF1';
    ctx.fillRect(0, roadTopY, width, 4);

    // Dashed yellow highway centerline along bottom
    ctx.fillStyle = '#FFD54F';
    const dashY = Math.min(height - 14, carBaseY + 36);
    for (let x = 24; x < width; x += 68) {
      ctx.fillRect(x, dashY, 34, 5);
    }

    // 2. Overhead 8-Honk Highway Gantry Trail (mirrors Music & Bubbles' melody vine!)
    this.renderOverheadHonkSign(ctx, width);

    // 3. Floating Musical Horn Bubbles & Pop Ripples
    this.renderHornBubbles(ctx, width, height);

    // 4. Render 4 Colored Turntable Spots + 4 Distinct Customizable Cars!
    for (let i = 0; i < 4; i++) {
      const cx = startX + i * spacing;
      const car = this.cars[i];
      const isSelected = i === this.selectedCarIdx;
      this.drawParkingPad(ctx, cx, carBaseY, spacing, car, isSelected);
      this.drawShowroomCar(ctx, cx, carBaseY, carScale, car, isSelected);
      if (isSelected) {
        this.drawSelectedCarFloatingBadge(ctx, cx, carBaseY - 150 * carScale, car);
      }
    }

    // 5. Paint-Swap Sparkles
    for (const p of this.paintSparks) {
      const alpha = Math.max(0, 1 - p.age / p.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x * width, p.y * height);
      ctx.rotate(p.rot);
      drawCabinetShape(ctx, 0, 0, p.size, p.shape, {
        fill: p.color,
        stroke: '#FFFFFF',
        lineWidth: 1.5,
      });
      ctx.restore();
    }

    // 6. Top-Left Selected Car & Skin Helper Pill
    this.drawTopLeftSkinPill(ctx, 18, 14);
  }

  private drawSoftCloud(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.arc(22, -6, 27, 0, Math.PI * 2);
    ctx.arc(46, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderOverheadHonkSign(ctx: CanvasRenderingContext2D, width: number): void {
    const signY = 38;
    const slotCount = 8;
    const beadGap = 40;
    const barW = (slotCount - 1) * beadGap + 68;
    const barX = width / 2 - barW / 2;

    ctx.fillStyle = 'rgba(38, 50, 56, 0.84)';
    ctx.strokeStyle = '#90A4AE';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(barX, signY - 20, barW, 40, 20);
    ctx.fill();
    ctx.stroke();

    const startX = width / 2 - ((slotCount - 1) * beadGap) / 2;
    for (let i = 0; i < slotCount; i++) {
      const bx = startX + i * beadGap;
      const item = this.recentHonks[i];
      if (!item) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        ctx.arc(bx, signY, 10, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const pal = CABINET_COLOR_PALETTE[item.color];
      ctx.fillStyle = item.paintHex;
      ctx.strokeStyle = pal.face;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, signY, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tiny musical eighth note inside bead
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(bx - 1.5, signY + 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 1, signY + 3);
      ctx.lineTo(bx + 1, signY - 5);
      ctx.lineTo(bx + 5, signY - 3.5);
      ctx.stroke();
    }
  }

  private renderHornBubbles(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    for (const b of this.hornBubbles) {
      const bx = b.x * width;
      const by = b.y * height;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = b.fillHex;
      ctx.strokeStyle = b.rimHex;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw crisp musical note / horn icon inside bubble
      ctx.fillStyle = b.rimHex;
      ctx.strokeStyle = b.rimHex;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (b.noteVariant === 0) {
        // Beamed double eighth note
        ctx.beginPath();
        ctx.arc(bx - 7, by + 6, 4.5, 0, Math.PI * 2);
        ctx.arc(bx + 6, by + 4, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx - 3, by + 6);
        ctx.lineTo(bx - 3, by - 9);
        ctx.lineTo(bx + 10, by - 11);
        ctx.lineTo(bx + 10, by + 4);
        ctx.stroke();
      } else {
        // Mini trumpet/bulb horn icon
        ctx.beginPath();
        ctx.moveTo(bx - 10, by - 3);
        ctx.lineTo(bx - 3, by - 3);
        ctx.lineTo(bx + 6, by - 9);
        ctx.lineTo(bx + 6, by + 9);
        ctx.lineTo(bx - 3, by + 3);
        ctx.lineTo(bx - 10, by + 3);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx + 8, by, 5.5, -0.7, 0.7);
        ctx.stroke();
      }

      // Gloss highlight dot
      ctx.fillStyle = 'rgba(255, 255, 255, 0.76)';
      ctx.beginPath();
      ctx.arc(bx - b.radius * 0.34, by - b.radius * 0.34, b.radius * 0.19, 0, Math.PI * 2);
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
  }

  private drawParkingPad(
    ctx: CanvasRenderingContext2D,
    cx: number,
    carBaseY: number,
    spacing: number,
    car: ShowroomCar,
    isSelected: boolean
  ): void {
    const pal = CABINET_COLOR_PALETTE[car.color];
    const padRx = Math.min(112, spacing * 0.44);
    const padRy = 22;

    ctx.save();

    // Soft spotlight beam & golden outer ring when selected by Joystick!
    if (isSelected) {
      const pulse = 1 + Math.sin(this.time * 5.5) * 0.04;
      const beam = ctx.createLinearGradient(cx, carBaseY - 170, cx, carBaseY + 18);
      beam.addColorStop(0, 'rgba(255, 213, 79, 0)');
      beam.addColorStop(1, 'rgba(255, 213, 79, 0.24)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(cx - padRx * 0.65, carBaseY - 165);
      ctx.lineTo(cx + padRx * 0.65, carBaseY - 165);
      ctx.lineTo(cx + padRx * 1.08, carBaseY + 8);
      ctx.lineTo(cx - padRx * 1.08, carBaseY + 8);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#FFD54F';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, carBaseY + 4, (padRx + 9) * pulse, (padRy + 5) * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Colored showroom turntable platform matching the Red/Green/Blue/Yellow horn button
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.ellipse(cx, carBaseY + 7, padRx, padRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal.face;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, carBaseY + 2, padRx * 0.94, padRy * 0.86, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  private traceBodySilhouette(ctx: CanvasRenderingContext2D, style: CarBodyStyle): void {
    ctx.beginPath();
    if (style === 'racer') {
      // Sleek low-slung sports coupe with rear spoiler wing
      ctx.moveTo(-98, -18);
      ctx.lineTo(-98, -42);
      ctx.lineTo(-108, -66);
      ctx.lineTo(-86, -66);
      ctx.lineTo(-80, -48);
      ctx.lineTo(-42, -52);
      ctx.quadraticCurveTo(-20, -86, 18, -84);
      ctx.lineTo(54, -52);
      ctx.quadraticCurveTo(96, -46, 102, -24);
      ctx.lineTo(102, -18);
      ctx.closePath();
    } else if (style === 'buggy') {
      // Friendly round beetle dome
      ctx.moveTo(-90, -18);
      ctx.quadraticCurveTo(-94, -56, -54, -60);
      ctx.quadraticCurveTo(-4, -118, 48, -60);
      ctx.quadraticCurveTo(92, -54, 92, -18);
      ctx.closePath();
    } else if (style === 'truck') {
      // Chunky big pickup truck with tall cab and open cargo bed
      ctx.moveTo(-100, -24);
      ctx.lineTo(-100, -68);
      ctx.lineTo(-32, -68);
      ctx.lineTo(-32, -108);
      ctx.quadraticCurveTo(18, -110, 44, -104);
      ctx.lineTo(56, -68);
      ctx.quadraticCurveTo(98, -66, 100, -52);
      ctx.lineTo(100, -24);
      ctx.closePath();
    } else {
      // Retro boxy camper/ice-cream van
      ctx.roundRect(-94, -102, 188, 84, [24, 30, 10, 10]);
    }
  }

  private drawSkinOverlay(
    ctx: CanvasRenderingContext2D,
    car: ShowroomCar,
    skin: SkinSpec,
    darkHex: string,
    accentHex: string
  ): void {
    if (skin.id === 'classic') {
      // Crisp white racing door roundel with vehicle number 1..4
      const rx = car.style === 'truck' ? 8 : -4;
      const ry = car.style === 'racer' ? -38 : -46;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath();
      ctx.arc(rx, ry, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = darkHex;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.fillStyle = '#141926';
      ctx.font = '900 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(car.slotIdx + 1), rx, ry + 1);
    } else if (skin.id === 'squares') {
      // X1 (Square): Bold 2-row black & white rally square checkerboard band!
      const bandY = car.style === 'racer' ? -44 : -50;
      const sq = 13;
      for (let x = -110; x < 110; x += sq) {
        const col = Math.floor((x + 110) / sq);
        ctx.fillStyle = col % 2 === 0 ? '#141926' : '#FFFFFF';
        ctx.fillRect(x, bandY, sq, sq);
        ctx.fillStyle = col % 2 === 1 ? '#141926' : '#FFFFFF';
        ctx.fillRect(x, bandY + sq, sq, sq);
      }
    } else if (skin.id === 'circles') {
      // X2 (Circle): Playful multi-color candy polka circles & bubble rings!
      const dots: Array<[number, number, number, string]> = [
        [-72, -36, 9.5, '#FFF59D'],
        [-46, -54, 8.5, '#FFFFFF'],
        [-36, -28, 7.5, '#FF80AB'],
        [-10, -44, 11, '#FFF59D'],
        [16, -30, 8.5, '#FFFFFF'],
        [26, -56, 8, '#B2FF59'],
        [50, -38, 10, '#FFF59D'],
        [74, -32, 8.5, '#FFFFFF'],
        [-58, -80, 7.5, '#FFFFFF'],
        [-10, -86, 8.5, '#FFF59D'],
        [34, -84, 7.5, '#FF80AB'],
      ];
      for (const [dx, dy, r, col] of dots) {
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (skin.id === 'triangles') {
      // X3 (Triangle): Bold racing stripe + upright colorful triangle pennants!
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(-110, -34, 220, 6);

      const tris: Array<[number, number, number, string]> = [
        [-68, -36, 11, '#FFD54F'],
        [-34, -44, 12, '#FFFFFF'],
        [0, -36, 12, accentHex],
        [34, -44, 11.5, '#FFFFFF'],
        [68, -34, 10.5, '#FFD54F'],
        [-22, -82, 9.5, '#FFD54F'],
        [18, -82, 9.5, '#FFFFFF'],
      ];
      for (const [tx, ty, tr, col] of tris) {
        drawCabinetShape(ctx, tx, ty, tr, 'triangle', {
          fill: col,
          stroke: '#0D47A1',
          lineWidth: 1.5,
        });
      }
    } else if (skin.id === 'diamonds') {
      // X4 (Diamond): Gleaming harlequin crystal diamonds across the body!
      const diamonds: Array<[number, number, number, string]> = [
        [-68, -38, 11, '#80DEEA'],
        [-36, -50, 11.5, '#FFD54F'],
        [-6, -34, 12, '#FFFFFF'],
        [26, -48, 11.5, '#80DEEA'],
        [58, -36, 11, '#FFD54F'],
        [-34, -82, 9.5, '#FFFFFF'],
        [10, -84, 10, '#80DEEA'],
      ];
      for (const [dx, dy, dr, col] of diamonds) {
        drawCabinetShape(ctx, dx, dy, dr, 'diamond', {
          fill: col,
          stroke: '#FFFFFF',
          lineWidth: 1.4,
        });
      }
    } else if (skin.id === 'stars') {
      // X5 (Star): Sparkling golden galaxy stars & shimmer dots!
      const stars: Array<[number, number, number]> = [
        [-66, -38, 10.5],
        [-22, -48, 13],
        [22, -34, 11.5],
        [64, -42, 10],
        [-42, -82, 9.5],
        [12, -86, 10],
      ];
      for (const [sx, sy, sr] of stars) {
        drawCabinetShape(ctx, sx, sy, sr, 'star', {
          fill: '#FFEE58',
          stroke: '#FFFFFF',
          lineWidth: 1.3,
        });
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      for (const [tx, ty] of [
        [-45, -28],
        [-2, -28],
        [42, -52],
        [80, -28],
      ]) {
        ctx.beginPath();
        ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (skin.id === 'hearts') {
      // X6 (Heart): Cheerful sweet candy hearts across the body!
      const hearts: Array<[number, number, number, string]> = [
        [-66, -38, 10.5, '#FFFFFF'],
        [-26, -46, 12.5, '#FFF59D'],
        [16, -35, 11.5, '#FFFFFF'],
        [58, -40, 10.5, '#FFE082'],
        [-38, -82, 9.5, '#FFF59D'],
        [14, -84, 9.5, '#FFFFFF'],
      ];
      for (const [hx, hy, hr, col] of hearts) {
        drawCabinetShape(ctx, hx, hy, hr, 'heart', {
          fill: col,
          stroke: '#AD1457',
          lineWidth: 1.3,
        });
      }
    }

    // Diagonal top-coat gloss shine across every car
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(-62, -118);
    ctx.lineTo(-30, -118);
    ctx.lineTo(-74, -10);
    ctx.lineTo(-106, -10);
    ctx.closePath();
    ctx.fill();
  }

  private drawShowroomCar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    carBaseY: number,
    baseScale: number,
    car: ShowroomCar,
    isSelected: boolean
  ): void {
    const { base, dark, accent, skin } = this.getCarColors(car);
    const liftScale = baseScale * (1 + car.selectPulse * 0.075);
    const sx = liftScale * (1 + car.squish * 0.22);
    const sy = liftScale * (1 - car.squish * 0.22);
    const idleSelectBob = isSelected ? Math.sin(this.time * 4.2) * 2.2 : 0;

    ctx.save();
    ctx.translate(cx, carBaseY + car.hopOffset + idleSelectBob);
    ctx.scale(sx, sy);

    // Ground contact shadow (shrinks slightly when car hops into the air)
    const shadowScale = Math.max(0.65, 1 + car.hopOffset / 180);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 96 * shadowScale, 10 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Extra vehicle-specific rear/roof hardware drawn behind main body
    if (car.style === 'truck') {
      // Chrome exhaust stack behind pickup cab
      ctx.fillStyle = '#CFD8DC';
      ctx.strokeStyle = '#546E7A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-42, -122, 10, 58, 4);
      ctx.fill();
      ctx.stroke();
    } else if (car.style === 'buggy') {
      // Bouncy spring antenna on roof
      const sway = Math.sin(this.time * 8 + car.slotIdx) * 5;
      ctx.strokeStyle = '#37474F';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-14, -86);
      ctx.quadraticCurveTo(-18, -106, -12 + sway, -116);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(-12 + sway, -117, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (car.style === 'van') {
      // Cute roof rack + novelty horn trumpet on Sunny Van!
      ctx.fillStyle = '#CFD8DC';
      ctx.fillRect(-56, -109, 104, 5);
      ctx.fillStyle = '#FFD54F';
      ctx.strokeStyle = '#F57F17';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, -112);
      ctx.lineTo(34, -121);
      ctx.lineTo(34, -105);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 1. Base Body Paint + Clipped Livery Skin Pattern
    ctx.fillStyle = base;
    this.traceBodySilhouette(ctx, car.style);
    ctx.fill();

    ctx.save();
    this.traceBodySilhouette(ctx, car.style);
    ctx.clip();
    this.drawSkinOverlay(ctx, car, skin, dark, accent);
    ctx.restore();

    ctx.strokeStyle = dark;
    ctx.lineWidth = 3;
    this.traceBodySilhouette(ctx, car.style);
    ctx.stroke();

    // 2. Windows & Windshields (with friendly eyes/glint!)
    ctx.fillStyle = '#B3E5FC';
    ctx.strokeStyle = '#E1F5FE';
    ctx.lineWidth = 2;
    if (car.style === 'racer') {
      ctx.beginPath();
      ctx.moveTo(-30, -52);
      ctx.quadraticCurveTo(-12, -77, 16, -76);
      ctx.lineTo(44, -52);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (car.style === 'buggy') {
      ctx.beginPath();
      ctx.arc(-2, -58, 34, Math.PI * 1.08, Math.PI * 1.92);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Split window pillar
      ctx.fillStyle = base;
      ctx.fillRect(-4, -92, 6, 35);
    } else if (car.style === 'truck') {
      ctx.beginPath();
      ctx.roundRect(-22, -100, 62, 32, [6, 14, 4, 4]);
      ctx.fill();
      ctx.stroke();
    } else {
      // Panoramic camper van windows
      ctx.beginPath();
      ctx.roundRect(-78, -90, 44, 30, 7);
      ctx.roundRect(-26, -90, 44, 30, 7);
      ctx.roundRect(26, -90, 52, 30, [7, 16, 7, 7]);
      ctx.fill();
      ctx.stroke();
    }

    // 3. Chrome Bumpers & Headlights
    ctx.fillStyle = '#ECEFF1';
    ctx.strokeStyle = '#90A4AE';
    ctx.lineWidth = 1.8;
    const bumperY = car.style === 'truck' ? -32 : -26;
    ctx.beginPath();
    ctx.roundRect(-104, bumperY, 16, 10, 4);
    ctx.roundRect(88, bumperY, 16, 10, 4);
    ctx.fill();
    ctx.stroke();

    const headY = car.style === 'truck' ? -48 : car.style === 'van' ? -44 : -36;
    const beaming = car.headlightTimer > 0;
    ctx.fillStyle = beaming ? '#FFFF8D' : '#FFE082';
    ctx.beginPath();
    ctx.arc(95, headY, car.style === 'buggy' ? 9 : 7.5, 0, Math.PI * 2);
    ctx.fill();

    if (beaming) {
      ctx.fillStyle = 'rgba(255, 249, 170, 0.48)';
      ctx.beginPath();
      ctx.moveTo(98, headY - 8);
      ctx.lineTo(164, headY - 30);
      ctx.lineTo(164, headY + 24);
      ctx.lineTo(98, headY + 8);
      ctx.closePath();
      ctx.fill();
    }

    // 4. Expanding Sound-Wave Horn Rings from front grille when honking!
    if (car.hornWaveAge < 0.5) {
      const p = car.hornWaveAge / 0.5;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = CABINET_COLOR_PALETTE[car.color].face;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let ring = 0; ring < 2; ring++) {
        const rad = 18 + ring * 14 + p * 44;
        ctx.beginPath();
        ctx.arc(104, headY - 4, rad, -0.68, 0.68);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Bouncy Spinning Wheels (oversized knobby tires on Big Truck!)
    const wheelR = car.style === 'truck' ? 25 : car.style === 'racer' ? 19 : 20;
    const wheelPositions = car.style === 'truck' ? [-62, 62] : [-58, 58];
    for (const wx of wheelPositions) {
      ctx.save();
      ctx.translate(wx, -wheelR + 2);
      ctx.rotate(car.wheelAngle);

      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(0, 0, wheelR, 0, Math.PI * 2);
      ctx.fill();

      // Whitewall / rim
      ctx.fillStyle = '#ECEFF1';
      ctx.beginPath();
      ctx.arc(0, 0, wheelR * 0.54, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(0, 0, wheelR * 0.24, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#546E7A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-wheelR * 0.46, 0);
      ctx.lineTo(wheelR * 0.46, 0);
      ctx.moveTo(0, -wheelR * 0.46);
      ctx.lineTo(0, wheelR * 0.46);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  private drawSelectedCarFloatingBadge(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    car: ShowroomCar
  ): void {
    const { base, skin } = this.getCarColors(car);
    const bob = Math.sin(this.time * 5.2) * 5;
    const by = Math.max(76, topY + bob);

    ctx.save();

    // Pill showing current skin on selected car
    const pillW = 148;
    const pillH = 32;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.88)';
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.roundRect(cx - pillW / 2, by - pillH / 2, pillW, pillH, 16);
    ctx.fill();
    ctx.stroke();

    drawCabinetShape(ctx, cx - pillW / 2 + 18, by, 8.5, skin.badgeShape, {
      fill: base,
      stroke: '#FFFFFF',
      lineWidth: 1.8,
    });

    ctx.fillStyle = '#FFE082';
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(skin.label, cx - pillW / 2 + 32, by + 0.5, pillW - 40);

    // Downward golden selector pointer triangle
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.moveTo(cx - 9, by + pillH / 2 + 2);
    ctx.lineTo(cx + 9, by + pillH / 2 + 2);
    ctx.lineTo(cx, by + pillH / 2 + 12);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawTopLeftSkinPill(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const selCar = this.cars[this.selectedCarIdx];

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, 212, 42, 21);
    ctx.fill();
    ctx.stroke();

    // 6 clickable white shape-skin buttons (X1..X6 -> Square, Circle, Triangle, Diamond, Star, Heart)
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      const bx = 38 + idx * 32;
      const by = y + 21;
      const skin = SHAPE_SKINS[sBtn];
      const active = selCar.skinButton === sBtn;

      ctx.fillStyle = active ? '#FFF8E1' : '#FFFFFF';
      ctx.strokeStyle = active ? '#FFB300' : '#90A4AE';
      ctx.lineWidth = active ? 2.6 : 1.6;
      ctx.beginPath();
      ctx.arc(bx, by, active ? 13 : 11.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawCabinetShape(ctx, bx, by, active ? 7.5 : 6.5, skin.badgeShape, {
        fill: skin.baseHex,
        stroke: '#141926',
        lineWidth: 1.3,
      });
    });

    ctx.restore();
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const carsHornsGameDefinition: ArcadeGameDefinition<HornAction> = {
  id: 'cars-horns',
  title: 'Cars & Horns',
  subtitle: 'Honk 4 silly horns & pick 6 shape skins!',
  accentColor: '#FFA726',
  developmental: {
    parentCategory: 'Sound & Choice',
    primaryTags: ['A1', 'G1'],
    secondaryTags: ['C1', 'B2'],
  },
  controls: [
    { action: 'honkRed', button: 'RED', label: 'Red Horn', icon: 'horn' },
    { action: 'honkGreen', button: 'GREEN', label: 'Green Horn', icon: 'horn' },
    { action: 'honkBlue', button: 'BLUE', label: 'Blue Horn', icon: 'horn' },
    { action: 'honkYellow', button: 'YELLOW', label: 'Yellow Horn', icon: 'horn' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const roadY = height * 0.76;
    const sky = ctx.createLinearGradient(0, 0, 0, roadY);
    sky.addColorStop(0, '#81D4FA');
    sky.addColorStop(1, '#FFFDE7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, roadY);

    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, roadY - 6, width, 8);
    ctx.fillStyle = '#37474F';
    ctx.fillRect(0, roadY, width, height - roadY);

    const spacing = width * 0.22;
    const startX = width / 2 - spacing * 1.5;

    CABINET_COLOR_COLUMNS.forEach((col, idx) => {
      const pal = CABINET_COLOR_PALETTE[col];
      const cx = startX + idx * spacing;
      const hop = selected ? Math.abs(Math.sin(timeSec * 4.5 + idx * 0.9)) * 5 : 0;
      const cy = roadY + 4 - hop;

      // Colored turntable dot
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.ellipse(cx, roadY + 10, spacing * 0.4, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Golden ring on selected cover car (#2)
      if (idx === 1) {
        ctx.strokeStyle = '#FFD54F';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(cx, roadY + 10, spacing * 0.45, 8, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 4 mini silhouettes: Racer, Buggy, Truck, Van
      ctx.fillStyle = idx === 1 ? '#EC407A' : pal.face;
      ctx.beginPath();
      if (idx === 0) {
        // Racer
        ctx.roundRect(cx - 21, cy - 16, 42, 11, 4);
        ctx.roundRect(cx - 10, cy - 24, 20, 10, [5, 7, 0, 0]);
      } else if (idx === 1) {
        // Polka-dot Buggy
        ctx.roundRect(cx - 19, cy - 15, 38, 10, 5);
        ctx.arc(cx, cy - 14, 13, Math.PI, 0);
      } else if (idx === 2) {
        // Truck
        ctx.roundRect(cx - 21, cy - 19, 42, 13, 3);
        ctx.roundRect(cx - 4, cy - 29, 20, 13, [3, 6, 0, 0]);
      } else {
        // Van
        ctx.roundRect(cx - 20, cy - 27, 40, 21, [6, 8, 3, 3]);
      }
      ctx.fill();

      if (idx === 1) {
        // Cute dots on cover buggy to hint at skin cycling!
        ctx.fillStyle = '#FFF59D';
        ctx.beginPath();
        ctx.arc(cx - 7, cy - 12, 2.5, 0, Math.PI * 2);
        ctx.arc(cx + 5, cy - 17, 2.5, 0, Math.PI * 2);
        ctx.arc(cx + 9, cy - 10, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mini wheels
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(cx - 11, cy - 5, 5.5, 0, Math.PI * 2);
      ctx.arc(cx + 11, cy - 5, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Floating musical horn bubble above each car
      const by = height * 0.28 + (idx % 2) * 12 - hop * 0.6;
      ctx.fillStyle = pal.light;
      ctx.strokeStyle = pal.face;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, by, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.arc(cx - 2, by + 3, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pal.dark;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, by + 3);
      ctx.lineTo(cx + 0.5, by - 5);
      ctx.lineTo(cx + 5, by - 3.5);
      ctx.stroke();
    });
  },
  create(context) {
    return new CarsAndHornsGame(context);
  },
};
