/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: stunt-ramp-garage
 * activity: button-mash-car-launch
 * primary_tags: [A1, A2]
 * secondary_tags: [B1, B2, G2]
 * concept:
 *   - 4 colored garage bays (Red, Green, Blue, Yellow) launch matching chunky toy vehicles down a turbo booster track and off an adjustable wooden stunt ramp.
 *   - 6 white shape buttons switch vehicle styles (Dump Truck, Buggy, Race Car, Tractor, Rescue Cruiser, Ice Cream Van), spawn floating shape balloons, and launch bonus vehicles so every button on the panel produces immediate cause-and-effect joy.
 * child_action: "Press or mash Red, Green, Blue, Yellow, White Shape buttons, or OK to launch cars over the ramp and pop floating shape balloons; move the joystick to tilt the stunt ramp!"
 * not_complexity: "Zero failure states, timers, or wrong buttons — holding or mashing any button launches cars and music."
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

type StuntAction = 'launchRed' | 'launchGreen' | 'launchBlue' | 'launchYellow';

type VehicleStyle = 'dump' | 'buggy' | 'racer' | 'tractor' | 'rescue' | 'icecream';

const SHAPE_TO_VEHICLE: Record<
  ShapeButton,
  { style: VehicleStyle; label: string; shape: ShapeKind }
> = {
  X1: { style: 'dump', label: 'Dump Truck', shape: 'square' },
  X2: { style: 'buggy', label: 'Bouncy Buggy', shape: 'circle' },
  X3: { style: 'racer', label: 'Race Car', shape: 'triangle' },
  X4: { style: 'tractor', label: 'Big Tractor', shape: 'diamond' },
  X5: { style: 'rescue', label: 'Rescue Car', shape: 'star' },
  X6: { style: 'icecream', label: 'Ice Cream Van', shape: 'heart' },
};

interface GarageBay {
  color: MergedColorButton;
  openProgress: number;
  holdOpenTimer: number;
  cooldown: number;
}

interface StuntCar {
  id: number;
  color: MergedColorButton;
  colorIdx: number;
  style: VehicleStyle;
  decalShape: ShapeKind;
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  angle: number;
  spinRate: number;
  doFlip: boolean;
  flipAccum: number;
  phase: 'approach' | 'ramp' | 'airborne' | 'landed';
  wheelSpin: number;
  squish: number;
  bounceCount: number;
  puffTimer: number;
}

interface SkyBalloon {
  nx: number;
  ny: number;
  baseNY: number;
  shape: ShapeKind;
  colorHex: string;
  bobPhase: number;
  scale: number;
}

interface ConfettiSpark {
  nx: number;
  ny: number;
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

interface ExhaustPuff {
  nx: number;
  ny: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  age: number;
  maxAge: number;
}

const GROUND_NY = 0.81;
const RAMP_START_NX = 0.37;
const RAMP_LIP_NX = 0.50;

const BALLOON_COLORS: Record<ShapeKind, string> = {
  square: '#AB47BC',
  circle: '#FFCA28',
  triangle: '#FF7043',
  diamond: '#26C6DA',
  star: '#FFEE58',
  heart: '#EC407A',
};

class StuntRampGarageGame implements ArcadeGameInstance<StuntAction> {
  private audio: GameContext['audio'];
  private time = 0;
  private nextCarId = 1;

  private activeShapeBtn: ShapeButton = 'X3'; // Starts on Race Car (Triangle)

  /** 0 = low speed-jump ramp, 0.52 = balanced jump, 1 = high moon-jump ramp */
  private rampElevate = 0.52;
  private finishFlagWave = 0;
  private poppedCount = 0;

  private bays: GarageBay[] = CABINET_COLOR_COLUMNS.map((color) => ({
    color,
    openProgress: 0,
    holdOpenTimer: 0,
    cooldown: 0,
  }));

  private cars: StuntCar[] = [];
  private balloons: SkyBalloon[] = [];
  private confetti: ConfettiSpark[] = [];
  private puffs: ExhaustPuff[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
    this.spawnBalloonWave();
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red Car',
        GREEN: 'Green Car',
        BLUE: 'Blue Car',
        YELLOW: 'Yellow Car',
      },
      shapesActive: true,
      selectedShape: this.activeShapeBtn,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    const nx = x / Math.max(1, width);
    const ny = y / Math.max(1, height);

    // Tap on any of the 4 left garage bays -> launch from that bay
    for (let i = 0; i < 4; i++) {
      const bx = this.getBayNX(i);
      if (Math.abs(nx - bx) < 0.042 && ny > GROUND_NY - 0.28 && ny < GROUND_NY + 0.05) {
        this.launchFromBay(i, false);
        return;
      }
    }

    // Tap on a balloon -> pop it directly (does not launch a car)
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      if (Math.hypot(nx - b.nx, ny - b.ny) < 0.075) {
        this.popBalloonAt(i);
        return;
      }
    }

    // Tap on the stunt ramp -> launch a 4-car stunt squad!
    if (nx >= RAMP_START_NX - 0.04 && nx <= RAMP_LIP_NX + 0.04 && ny > GROUND_NY - 0.25) {
      this.launchMegaSquad();
      return;
    }
  }

  private getBayNX(bayIdx: number): number {
    return 0.068 + bayIdx * 0.072;
  }

  private getRampHeightNY(): number {
    return 0.115 + this.rampElevate * 0.095;
  }

  private sampleRampNY(nx: number): { ny: number; angle: number } {
    const span = RAMP_LIP_NX - RAMP_START_NX;
    const u = Math.max(0, Math.min(1, (nx - RAMP_START_NX) / span));
    const rh = this.getRampHeightNY();
    const ny = GROUND_NY - rh * Math.pow(u, 1.35);
    const dnyDnx = (-1.35 * rh * Math.pow(Math.max(0.05, u), 0.35)) / span;
    const angle = Math.atan2(dnyDnx, 1);
    return { ny, angle };
  }

  private spawnBalloonWave(): void {
    const shapes: ShapeKind[] = ['square', 'circle', 'triangle', 'diamond', 'star', 'heart'];
    const slots: Array<{ nx: number; ny: number }> = [
      { nx: 0.59, ny: 0.44 },
      { nx: 0.67, ny: 0.30 },
      { nx: 0.75, ny: 0.46 },
      { nx: 0.83, ny: 0.28 },
      { nx: 0.89, ny: 0.43 },
      { nx: 0.72, ny: 0.22 },
    ];
    for (let i = 0; i < slots.length; i++) {
      const sh = shapes[i % shapes.length];
      this.balloons.push({
        nx: slots[i].nx + (Math.random() - 0.5) * 0.02,
        ny: slots[i].ny,
        baseNY: slots[i].ny,
        shape: sh,
        colorHex: BALLOON_COLORS[sh],
        bobPhase: Math.random() * Math.PI * 2,
        scale: 0.05,
      });
    }
  }

  private spawnExtraBalloons(shape: ShapeKind, count: number): void {
    for (let k = 0; k < count; k++) {
      if (this.balloons.length >= 11) {
        this.balloons.shift();
      }
      const baseNY = 0.24 + Math.random() * 0.26;
      this.balloons.push({
        nx: 0.57 + Math.random() * 0.34,
        ny: baseNY,
        baseNY,
        shape,
        colorHex: BALLOON_COLORS[shape],
        bobPhase: Math.random() * Math.PI * 2,
        scale: 0.05,
      });
    }
  }

  private launchFromBay(bayIdx: number, doFlip: boolean, silent = false): void {
    const bay = this.bays[bayIdx];
    if (!bay || bay.cooldown > 0) return;

    bay.cooldown = 0.03;
    bay.holdOpenTimer = 0.45;

    const vehMeta = SHAPE_TO_VEHICLE[this.activeShapeBtn];
    const startNX = this.getBayNX(bayIdx) + 0.015;

    // Keep framerate silky even under enthusiastic two-handed mashing
    if (this.cars.length >= 18) {
      this.cars.shift();
    }

    this.cars.push({
      id: this.nextCarId++,
      color: bay.color,
      colorIdx: bayIdx,
      style: vehMeta.style,
      decalShape: vehMeta.shape,
      nx: startNX,
      ny: GROUND_NY,
      vx: 0.46 + bayIdx * 0.012,
      vy: 0,
      angle: 0,
      spinRate: 0,
      doFlip,
      flipAccum: 0,
      phase: 'approach',
      wheelSpin: 0,
      squish: 0.25,
      bounceCount: 0,
      puffTimer: 0,
    });

    if (!silent) {
      this.audio.playCarLaunch(bayIdx, vehMeta.style);
    }
  }

  private launchMegaSquad(): void {
    this.audio.playStageComplete(false);
    for (let i = 0; i < 4; i++) {
      this.bays[i].cooldown = 0;
      this.launchFromBay(i, true, true);
      // Slight speed stagger so all 4 soar in a rainbow arc formation!
      const last = this.cars[this.cars.length - 1];
      if (last) {
        last.vx = 0.43 + i * 0.035;
      }
    }
  }

  private popBalloonAt(idx: number): void {
    const b = this.balloons[idx];
    if (!b) return;
    this.balloons.splice(idx, 1);
    this.poppedCount++;
    this.audio.playBalloonPop(this.poppedCount);

    const burstColors = ['#FF5252', '#FFD54F', '#66BB6A', '#42A5F5', '#AB47BC', '#FF7043'];
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 0.12 + Math.random() * 0.22;
      this.confetti.push({
        nx: b.nx,
        ny: b.ny,
        vx: Math.cos(ang) * spd * 0.65,
        vy: Math.sin(ang) * spd - 0.08,
        color: k % 2 === 0 ? b.colorHex : burstColors[k % burstColors.length],
        shape: b.shape,
        size: 6 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 9,
        age: 0,
        maxAge: 0.85 + Math.random() * 0.4,
      });
    }

    // Refill sky with a fresh wave whenever the last balloon pops!
    if (this.balloons.length === 0) {
      this.spawnBalloonWave();
      this.finishFlagWave = 1.2;
    }
  }

  public update(dt: number, input: GameInput<StuntAction>): void {
    this.time += dt;

    // 1. Joystick UP/DOWN tilts the hydraulic stunt ramp; RIGHT boosts speed; LEFT gives floaty moon-jumps
    if (Math.abs(input.axisY) > 0.2) {
      this.rampElevate = Math.max(0, Math.min(1, this.rampElevate - input.axisY * dt * 1.35));
    }
    const turboBoost = input.axisX > 0.3 ? 1.32 : input.axisX < -0.3 ? 0.84 : 1.0;
    const gravityScale = input.axisX < -0.3 ? 0.72 : 1.0;

    // 2. White Shape Buttons (X1..X6): switch vehicle style & float matching shape balloons (no car launch!)
    for (let idx = 0; idx < SHAPE_BUTTON_LIST.length; idx++) {
      const sBtn = SHAPE_BUTTON_LIST[idx];
      if (input.justPressedButton(sBtn)) {
        this.activeShapeBtn = sBtn;
        const meta = SHAPE_TO_VEHICLE[sBtn];
        this.audio.playShapeSparkle(idx);
        this.spawnExtraBalloons(meta.shape, 2);
      }
    }

    // 3. 4 Colored Garage Buttons: each discrete press launches 1 matching colored car
    const actions: StuntAction[] = ['launchRed', 'launchGreen', 'launchBlue', 'launchYellow'];
    actions.forEach((act, idx) => {
      const bay = this.bays[idx];
      if (bay.cooldown > 0) {
        bay.cooldown = Math.max(0, bay.cooldown - dt);
      }

      if (input.justPressed(act)) {
        this.launchFromBay(idx, this.activeShapeBtn === 'X5');
      }

      if (bay.holdOpenTimer > 0) {
        bay.holdOpenTimer = Math.max(0, bay.holdOpenTimer - dt);
      }
      const targetOpen = bay.holdOpenTimer > 0 ? 1 : 0;
      bay.openProgress += (targetOpen - bay.openProgress) * Math.min(1, dt * 15);
    });

    // 4. OK Button: 4-Car Rainbow Mega Squad Launch!
    if (input.justPressedButton('OK')) {
      this.launchMegaSquad();
    }

    // 5. Update floating sky balloons
    for (const b of this.balloons) {
      b.scale += (1 - b.scale) * Math.min(1, dt * 7);
      b.ny = b.baseNY + Math.sin(this.time * 2.1 + b.bobPhase) * 0.018;
    }

    // 6. Update stunt cars along approach -> ramp -> airborne -> landing runway
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      c.wheelSpin += dt * 22 * turboBoost;
      if (c.squish > 0) {
        c.squish = Math.max(0, c.squish - dt * 3.5);
      }

      // Puff cheerful exhaust clouds
      c.puffTimer -= dt;
      if (c.puffTimer <= 0) {
        c.puffTimer = c.phase === 'airborne' ? 0.045 : 0.075;
        const pal = CABINET_COLOR_PALETTE[c.color];
        this.puffs.push({
          nx: c.nx - 0.024,
          ny: c.ny - 0.018,
          vx: -0.05 - Math.random() * 0.04,
          vy: -0.02 + (Math.random() - 0.5) * 0.03,
          color: turboBoost > 1.1 || c.doFlip ? pal.light : 'rgba(255,255,255,0.78)',
          radius: 5 + Math.random() * 5,
          age: 0,
          maxAge: 0.42,
        });
      }

      if (c.phase === 'approach') {
        // Accelerate across the turbo strip toward the ramp!
        c.vx = Math.min(0.62, c.vx + dt * 0.55) * (turboBoost > 1.1 ? 1.06 : 1.0);
        c.nx += c.vx * turboBoost * dt;
        c.ny = GROUND_NY;
        c.angle += (0 - c.angle) * Math.min(1, dt * 14);
        if (c.nx >= RAMP_START_NX) {
          c.phase = 'ramp';
        }
      } else if (c.phase === 'ramp') {
        c.nx += Math.max(0.42, c.vx) * turboBoost * dt;
        const sample = this.sampleRampNY(c.nx);
        c.ny = sample.ny;
        c.angle = sample.angle;

        if (c.nx >= RAMP_LIP_NX) {
          c.phase = 'airborne';
          const jitter = (Math.random() - 0.5) * 0.07;
          c.vx = (0.32 + (1 - this.rampElevate) * 0.09 + Math.random() * 0.04) * turboBoost;
          c.vy = -(0.54 + this.rampElevate * 0.40 + jitter);
          if (c.doFlip || turboBoost > 1.15) {
            c.doFlip = true;
            c.spinRate = -Math.PI * 2.15; // Joyful 360 backflip!
          }
        }
      } else if (c.phase === 'airborne') {
        c.nx += c.vx * dt;
        c.vy += 1.45 * gravityScale * dt;
        c.ny += c.vy * dt;

        if (c.doFlip && c.flipAccum < Math.PI * 2) {
          const step = Math.abs(c.spinRate) * dt;
          c.angle -= step;
          c.flipAccum += step;
          if (c.flipAccum >= Math.PI * 2) {
            c.angle = Math.atan2(c.vy * 0.55, c.vx);
          }
        } else {
          const targetAng = Math.max(-0.65, Math.min(0.55, Math.atan2(c.vy * 0.52, c.vx)));
          c.angle += (targetAng - c.angle) * Math.min(1, dt * 10);
        }

        // Check mid-air balloon pops!
        for (let bIdx = this.balloons.length - 1; bIdx >= 0; bIdx--) {
          const b = this.balloons[bIdx];
          if (Math.abs(c.nx - b.nx) < 0.052 && Math.abs(c.ny - 0.02 - b.ny) < 0.075) {
            this.popBalloonAt(bIdx);
          }
        }

        // Touchdown on the landing track!
        if (c.ny >= GROUND_NY) {
          c.ny = GROUND_NY;
          c.squish = 0.38;
          if (c.bounceCount === 0 && Math.abs(c.vy) > 0.25) {
            c.bounceCount++;
            c.vy = -Math.min(0.32, Math.abs(c.vy) * 0.36);
            c.vx = Math.max(0.38, c.vx * 1.08);
            c.doFlip = false;
            c.angle = -0.12;
            this.audio.playTireBounce();
          } else {
            c.phase = 'landed';
            c.vy = 0;
            c.angle = 0;
          }
        }
      } else {
        // Zoom across the checkered finish line!
        const prevNX = c.nx;
        c.vx = Math.min(0.75, c.vx + dt * 0.65);
        c.nx += c.vx * turboBoost * dt;
        c.ny = GROUND_NY;
        c.angle += (0 - c.angle) * Math.min(1, dt * 14);
        if (prevNX < 0.93 && c.nx >= 0.93) {
          this.finishFlagWave = 0.9;
        }
      }

      if (c.nx > 1.12) {
        this.cars.splice(i, 1);
      }
    }

    if (this.finishFlagWave > 0) {
      this.finishFlagWave = Math.max(0, this.finishFlagWave - dt);
    }

    // 7. Update confetti & exhaust particles
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.confetti.splice(i, 1);
        continue;
      }
      p.vy += 0.55 * dt;
      p.nx += p.vx * dt;
      p.ny += p.vy * dt;
      p.rot += p.vRot * dt;
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.puffs.splice(i, 1);
        continue;
      }
      p.nx += p.vx * dt;
      p.ny += p.vy * dt;
      p.radius += dt * 16;
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const groundY = Math.round(height * GROUND_NY);

    // 1. Bright Sunny Stunt Park Sky & Rolling Hills
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#64B5F6');
    sky.addColorStop(0.65, '#BBDEFB');
    sky.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    // Warm cheerful sun
    const sunX = width * 0.14;
    const sunY = height * 0.14;
    ctx.fillStyle = 'rgba(255, 241, 118, 0.32)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 50 + Math.sin(this.time * 2.5) * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 34, 0, Math.PI * 2);
    ctx.fill();

    // Drifting puffy clouds
    this.drawCloud(ctx, ((width * 0.34 + this.time * 12) % (width + 180)) - 90, height * 0.13, 0.9);
    this.drawCloud(ctx, ((width * 0.78 + this.time * 8) % (width + 180)) - 90, height * 0.10, 0.75);

    // Soft distant hills
    ctx.fillStyle = '#AED581';
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.quadraticCurveTo(width * 0.26, groundY - height * 0.18, width * 0.54, groundY - height * 0.04);
    ctx.quadraticCurveTo(width * 0.80, groundY - height * 0.16, width, groundY - height * 0.03);
    ctx.lineTo(width, groundY);
    ctx.closePath();
    ctx.fill();

    // Grass & Asphalt Stunt Track
    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, groundY, width, height - groundY);

    const roadH = Math.max(36, height * 0.085);
    ctx.fillStyle = '#37474F';
    ctx.fillRect(0, groundY - 6, width, roadH);

    // Crisp road edge stripes
    ctx.fillStyle = '#ECEFF1';
    ctx.fillRect(0, groundY - 6, width, 4);
    ctx.fillRect(0, groundY - 6 + roadH - 4, width, 4);

    // Dashed yellow center line along approach & landing runway
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 14]);
    ctx.beginPath();
    ctx.moveTo(0, groundY - 6 + roadH * 0.5);
    ctx.lineTo(width * RAMP_START_NX, groundY - 6 + roadH * 0.5);
    ctx.moveTo(width * 0.56, groundY - 6 + roadH * 0.5);
    ctx.lineTo(width, groundY - 6 + roadH * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // Crash-pad mattress in the gap right after the ramp for playful safety detail
    const padX = width * (RAMP_LIP_NX + 0.008);
    const padW = width * 0.065;
    ctx.fillStyle = '#29B6F6';
    ctx.beginPath();
    ctx.roundRect(padX, groundY - 16, padW, 18, 6);
    ctx.fill();
    ctx.strokeStyle = '#0288D1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Animated Turbo Chevron Booster Strip before the ramp
    this.drawTurboStrip(ctx, width, groundY, roadH);

    // 3. Curved Wooden Hot-Wheels Stunt Ramp + Hydraulic Tilt Jack
    this.drawStuntRamp(ctx, width, height, groundY);

    // 4. 4 Colored Garage Bays on the Left (Red, Green, Blue, Yellow)
    this.drawGarageBays(ctx, width, height, groundY);

    // 5. Floating Shape Balloons in the Sky
    this.drawSkyBalloons(ctx, width, height);

    // 6. Checkered Finish Arch Back Pillar
    const archX = width * 0.94;
    this.drawFinishArch(ctx, archX, groundY, height, 'back');

    // 7. Exhaust Puffs & Stunt Cars!
    for (const p of this.puffs) {
      const alpha = Math.max(0, 1 - p.age / p.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.nx * width, p.ny * height, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const carScale = Math.min(1.15, Math.max(0.72, width / 1180));
    for (const c of this.cars) {
      this.drawStuntVehicle(ctx, c, width, height, carScale);
    }

    // 8. Checkered Finish Arch Front Banner & Flags
    this.drawFinishArch(ctx, archX, groundY, height, 'front');

    // 9. Confetti Sparks
    for (const p of this.confetti) {
      const alpha = Math.max(0, 1 - p.age / p.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.nx * width, p.ny * height);
      ctx.rotate(p.rot);
      drawCabinetShape(ctx, 0, 0, p.size, p.shape, { fill: p.color, stroke: '#FFFFFF', lineWidth: 1.5 });
      ctx.restore();
    }

    // 10. Top-Left Active Vehicle Badge Pill (shows current White Shape vehicle)
    this.drawVehicleSelectorPill(ctx);
  }

  private drawCloud(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.arc(22, -6, 28, 0, Math.PI * 2);
    ctx.arc(48, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawTurboStrip(
    ctx: CanvasRenderingContext2D,
    width: number,
    groundY: number,
    roadH: number
  ): void {
    const sx = width * 0.305;
    const sw = width * (RAMP_START_NX - 0.305);
    const sy = groundY - 2;
    const sh = Math.min(28, roadH - 8);

    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 5);
    ctx.fill();

    const phase = (this.time * 5) % 1;
    for (let i = 0; i < 4; i++) {
      const u = ((i + phase) / 4) % 1;
      const cx = sx + 8 + u * (sw - 16);
      const cy = sy + sh / 2;
      ctx.strokeStyle = i % 2 === 0 ? '#FFD54F' : '#FF7043';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - 6);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx - 5, cy + 6);
      ctx.stroke();
    }
  }

  private drawStuntRamp(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    groundY: number
  ): void {
    const x0 = width * RAMP_START_NX;
    const x1 = width * RAMP_LIP_NX;
    const lipY = height * (GROUND_NY - this.getRampHeightNY());

    // Hydraulic scissor/piston post under the ramp lip (shows Joystick UP/DOWN tilt!)
    const postX = x1 - (x1 - x0) * 0.22;
    ctx.strokeStyle = '#90A4AE';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(postX, groundY);
    ctx.lineTo(postX, lipY + 14);
    ctx.stroke();

    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(postX, groundY - 12);
    ctx.lineTo(postX, lipY + 14);
    ctx.stroke();

    ctx.fillStyle = '#546E7A';
    ctx.beginPath();
    ctx.roundRect(postX - 14, groundY - 10, 28, 12, 4);
    ctx.fill();

    // Warm wooden stunt ramp wedge
    const woodGrad = ctx.createLinearGradient(x0, groundY, x1, lipY);
    woodGrad.addColorStop(0, '#FFB74D');
    woodGrad.addColorStop(1, '#FF8F00');
    ctx.fillStyle = woodGrad;

    ctx.beginPath();
    ctx.moveTo(x0, groundY);
    const steps = 16;
    for (let s = 1; s <= steps; s++) {
      const nx = RAMP_START_NX + ((RAMP_LIP_NX - RAMP_START_NX) * s) / steps;
      const sample = this.sampleRampNY(nx);
      ctx.lineTo(nx * width, sample.ny * height);
    }
    ctx.lineTo(x1, groundY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#E65100';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Hot-Wheels orange racing top rail + yellow chevrons along the ramp surface
    ctx.strokeStyle = '#FFF8E1';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x0, groundY - 2);
    for (let s = 1; s <= steps; s++) {
      const nx = RAMP_START_NX + ((RAMP_LIP_NX - RAMP_START_NX) * s) / steps;
      const sample = this.sampleRampNY(nx);
      ctx.lineTo(nx * width, sample.ny * height - 2);
    }
    ctx.stroke();
  }

  private drawGarageBays(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    groundY: number
  ): void {
    const bayW = Math.min(82, width * 0.062);
    const bayH = Math.min(112, height * 0.22);

    // Shared garage roof beam spanning all 4 bays
    const leftX = this.getBayNX(0) * width - bayW * 0.62;
    const rightX = this.getBayNX(3) * width + bayW * 0.62;
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath();
    ctx.roundRect(leftX, groundY - bayH - 22, rightX - leftX, bayH + 22, [14, 14, 4, 4]);
    ctx.fill();
    ctx.strokeStyle = '#90A4AE';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Checkered racing trim along top of garage building
    const sqSize = 10;
    const headerY = groundY - bayH - 20;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(leftX + 4, headerY, rightX - leftX - 8, 16, 6);
    ctx.clip();
    for (let x = leftX; x < rightX; x += sqSize) {
      const colIdx = Math.floor((x - leftX) / sqSize);
      ctx.fillStyle = colIdx % 2 === 0 ? '#263238' : '#FFFFFF';
      ctx.fillRect(x, headerY, sqSize, 8);
      ctx.fillStyle = colIdx % 2 === 1 ? '#263238' : '#FFFFFF';
      ctx.fillRect(x, headerY + 8, sqSize, 8);
    }
    ctx.restore();

    this.bays.forEach((bay, idx) => {
      const pal = CABINET_COLOR_PALETTE[bay.color];
      const cx = this.getBayNX(idx) * width;
      const doorW = bayW * 0.84;
      const doorH = bayH * 0.82;
      const dx = cx - doorW / 2;
      const dy = groundY - doorH;

      // Colored bay arch surround
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(dx - 5, dy - 16, doorW + 10, doorH + 16, [10, 10, 0, 0]);
      ctx.fill();

      // Warm lit garage interior
      ctx.fillStyle = bay.openProgress > 0.1 ? '#FFF8E1' : '#263238';
      ctx.fillRect(dx, dy, doorW, doorH);

      if (bay.openProgress > 0.15) {
        // Soft golden ceiling spotlight inside open bay
        ctx.fillStyle = 'rgba(255, 213, 79, 0.38)';
        ctx.beginPath();
        ctx.moveTo(cx - 10, dy);
        ctx.lineTo(cx + 10, dy);
        ctx.lineTo(cx + doorW * 0.48, dy + doorH);
        ctx.lineTo(cx - doorW * 0.48, dy + doorH);
        ctx.closePath();
        ctx.fill();
      }

      // Segmented roll-up garage door (slides upward as openProgress -> 1)
      const closedH = doorH * (1 - bay.openProgress * 0.88);
      if (closedH > 3) {
        ctx.fillStyle = pal.face;
        ctx.fillRect(dx, dy, doorW, closedH);

        // Horizontal roll-up door slats
        ctx.strokeStyle = pal.dark;
        ctx.lineWidth = 2;
        const slatStep = 14;
        for (let sy = dy + closedH - slatStep; sy > dy + 2; sy -= slatStep) {
          ctx.beginPath();
          ctx.moveTo(dx + 2, sy);
          ctx.lineTo(dx + doorW - 2, sy);
          ctx.stroke();
        }

        // Bottom grab handle
        ctx.fillStyle = '#FFFDF7';
        ctx.beginPath();
        ctx.roundRect(cx - 10, dy + closedH - 7, 20, 4, 2);
        ctx.fill();
      }

      // Matching colored pennant flag on roof above each bay
      const poleTopY = groundY - bayH - 42;
      ctx.strokeStyle = '#546E7A';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 6, groundY - bayH - 22);
      ctx.lineTo(cx - 6, poleTopY);
      ctx.stroke();

      const wave = Math.sin(this.time * 4 + idx) * 2.5;
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.moveTo(cx - 5, poleTopY);
      ctx.lineTo(cx + 16, poleTopY + 7 + wave);
      ctx.lineTo(cx - 5, poleTopY + 14);
      ctx.closePath();
      ctx.fill();
    });
  }

  private drawSkyBalloons(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const rBase = Math.min(28, Math.max(20, width * 0.022));
    for (const b of this.balloons) {
      const bx = b.nx * width;
      const by = b.ny * height;
      const r = rBase * b.scale;

      ctx.save();
      ctx.translate(bx, by);

      // Curly ribbon string hanging below balloon
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, r + 2);
      ctx.quadraticCurveTo(6 * Math.sin(this.time * 3 + b.bobPhase), r + 16, -3, r + 30);
      ctx.stroke();

      // Balloon knot
      ctx.fillStyle = b.colorHex;
      ctx.beginPath();
      ctx.moveTo(-4, r + 3);
      ctx.lineTo(4, r + 3);
      ctx.lineTo(0, r - 2);
      ctx.closePath();
      ctx.fill();

      // Plump glossy oval balloon body
      ctx.fillStyle = b.colorHex;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.92, r * 1.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Specular shine
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.34, -r * 0.36, r * 0.2, r * 0.32, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Crisp white geometric shape stamped right on the balloon!
      drawCabinetShape(ctx, 0, 2, r * 0.52, b.shape, {
        fill: '#FFFFFF',
        stroke: 'rgba(20, 25, 38, 0.35)',
        lineWidth: 2,
      });

      ctx.restore();
    }
  }

  private drawFinishArch(
    ctx: CanvasRenderingContext2D,
    archX: number,
    groundY: number,
    height: number,
    layer: 'back' | 'front'
  ): void {
    const archH = Math.min(148, height * 0.28);
    if (layer === 'back') {
      ctx.fillStyle = '#455A64';
      ctx.beginPath();
      ctx.roundRect(archX - 18, groundY - archH, 10, archH, 4);
      ctx.fill();
      return;
    }

    // Front pillar
    ctx.fillStyle = '#607D8B';
    ctx.beginPath();
    ctx.roundRect(archX + 8, groundY - archH, 10, archH, 4);
    ctx.fill();

    // Overhead checkered FINISH banner
    const bw = 46;
    const bh = 22;
    const bx = archX - bw / 2;
    const by = groundY - archH - 8;
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.roundRect(bx - 3, by - 3, bw + 6, bh + 6, 7);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 5);
    ctx.clip();
    const sq = 7.5;
    for (let x = bx; x < bx + bw; x += sq) {
      const ci = Math.floor((x - bx) / sq);
      ctx.fillStyle = ci % 2 === 0 ? '#141926' : '#FFFFFF';
      ctx.fillRect(x, by, sq, bh / 2);
      ctx.fillStyle = ci % 2 === 1 ? '#141926' : '#FFFFFF';
      ctx.fillRect(x, by + bh / 2, sq, bh / 2);
    }
    ctx.restore();

    // Celebratory waving flags when cars cross finish!
    const excitement = 1 + this.finishFlagWave * 3.2;
    const wave = Math.sin(this.time * 7 * excitement) * (3 + this.finishFlagWave * 6);
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(archX, by - 3);
    ctx.lineTo(archX, by - 22);
    ctx.stroke();

    ctx.fillStyle = '#EF5350';
    ctx.beginPath();
    ctx.moveTo(archX, by - 22);
    ctx.lineTo(archX + 20, by - 15 + wave);
    ctx.lineTo(archX, by - 8);
    ctx.closePath();
    ctx.fill();
  }

  private drawStuntVehicle(
    ctx: CanvasRenderingContext2D,
    car: StuntCar,
    width: number,
    height: number,
    scale: number
  ): void {
    const pal = CABINET_COLOR_PALETTE[car.color];
    const x = car.nx * width;
    const y = car.ny * height;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(car.angle);
    const sx = scale * (1 + car.squish * 0.22);
    const sy = scale * (1 - car.squish * 0.22);
    ctx.scale(sx, sy);

    const wheelR = car.style === 'tractor' ? 14 : 11;
    const wheelY = -wheelR;

    // Vehicle body per selected White Shape button style
    if (car.style === 'dump') {
      // Tilting dump bed with wooden cargo blocks + boxy cab
      ctx.fillStyle = '#FFD54F';
      ctx.beginPath();
      ctx.roundRect(-30, -36, 30, 12, 3);
      ctx.fill();

      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.moveTo(-34, -30);
      ctx.lineTo(-2, -30);
      ctx.lineTo(-2, -12);
      ctx.lineTo(-30, -12);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(0, -34, 28, 22, [4, 8, 3, 3]);
      ctx.fill();

      ctx.fillStyle = '#E1F5FE';
      ctx.beginPath();
      ctx.roundRect(8, -31, 16, 10, 3);
      ctx.fill();
    } else if (car.style === 'buggy') {
      // Round bubbly VW-style buggy
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(-28, -24, 56, 14, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-2, -22, 19, Math.PI, 0);
      ctx.fill();

      ctx.fillStyle = '#E1F5FE';
      ctx.beginPath();
      ctx.arc(1, -22, 13, Math.PI * 1.08, -0.12);
      ctx.fill();
    } else if (car.style === 'tractor') {
      // Big tractor with tall chimney stack + rear cab
      ctx.fillStyle = '#37474F';
      ctx.fillRect(10, -40, 5, 16);

      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(-28, -40, 26, 28, 5);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(-4, -27, 30, 15, 5);
      ctx.fill();

      ctx.fillStyle = '#E1F5FE';
      ctx.beginPath();
      ctx.roundRect(-23, -36, 16, 12, 3);
      ctx.fill();
    } else if (car.style === 'rescue') {
      // Rescue cruiser with flashing red/blue lightbar!
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(-30, -24, 60, 14, 6);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(-18, -35, 34, 13, [7, 7, 2, 2]);
      ctx.fill();

      ctx.fillStyle = '#B3E5FC';
      ctx.fillRect(-13, -32, 24, 8);

      const flash = Math.floor(this.time * 12) % 2 === 0;
      ctx.fillStyle = flash ? '#FF1744' : '#2979FF';
      ctx.beginPath();
      ctx.roundRect(-6, -41, 12, 6, 3);
      ctx.fill();
    } else if (car.style === 'icecream') {
      // Cheerful boxy van with pastel stripe + swirled ice cream cone on roof!
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.roundRect(-30, -36, 58, 25, 7);
      ctx.fill();

      ctx.fillStyle = '#FFF8E1';
      ctx.fillRect(-29, -24, 56, 6);

      ctx.fillStyle = '#E1F5FE';
      ctx.beginPath();
      ctx.roundRect(8, -33, 16, 10, 3);
      ctx.fill();

      // Roof ice cream cone
      ctx.fillStyle = '#FFB74D';
      ctx.beginPath();
      ctx.moveTo(-10, -36);
      ctx.lineTo(4, -36);
      ctx.lineTo(-3, -48);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F48FB1';
      ctx.beginPath();
      ctx.arc(-3, -39, 6.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Sleek Spoiler Race Car (default)
      // Rear wing spoiler
      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.moveTo(-30, -22);
      ctx.lineTo(-36, -34);
      ctx.lineTo(-24, -34);
      ctx.lineTo(-22, -22);
      ctx.closePath();
      ctx.fill();

      // Aerodynamic body
      ctx.fillStyle = pal.face;
      ctx.beginPath();
      ctx.moveTo(-30, -11);
      ctx.lineTo(-30, -23);
      ctx.lineTo(-12, -32);
      ctx.lineTo(10, -32);
      ctx.lineTo(32, -19);
      ctx.lineTo(32, -11);
      ctx.closePath();
      ctx.fill();

      // Racing stripe & cockpit canopy
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-28, -17, 58, 3.5);
      ctx.fillStyle = '#E1F5FE';
      ctx.beginPath();
      ctx.moveTo(-9, -30);
      ctx.lineTo(8, -30);
      ctx.lineTo(18, -21);
      ctx.lineTo(-9, -21);
      ctx.closePath();
      ctx.fill();
    }

    // Bright headlight beam cone
    ctx.fillStyle = '#FFF59D';
    ctx.beginPath();
    ctx.arc(29, -17, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Door shape emblem matching the White Shape button!
    drawCabinetShape(ctx, -6, -18, 6.5, car.decalShape, {
      fill: '#FFFFFF',
      stroke: pal.dark,
      lineWidth: 1.5,
    });

    // Bouncy spinning front & rear wheels
    const wxList = [-18, 18];
    wxList.forEach((wx, wIdx) => {
      const r = car.style === 'tractor' && wIdx === 0 ? 15.5 : wheelR;
      const wy = -r;
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(car.wheelSpin);

      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#CFD8DC';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
      ctx.fill();

      // Wheel spoke so rotation is visibly lively
      ctx.strokeStyle = '#455A64';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.45, 0);
      ctx.lineTo(r * 0.45, 0);
      ctx.moveTo(0, -r * 0.45);
      ctx.lineTo(0, r * 0.45);
      ctx.stroke();

      ctx.restore();
    });

    // Unused variable guard
    void wheelY;
    ctx.restore();
  }

  private drawVehicleSelectorPill(ctx: CanvasRenderingContext2D): void {
    const meta = SHAPE_TO_VEHICLE[this.activeShapeBtn];
    const px = 16;
    const py = 14;
    const pw = 186;
    const ph = 38;

    ctx.save();
    ctx.fillStyle = 'rgba(20, 25, 38, 0.72)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 19);
    ctx.fill();

    drawCabinetShape(ctx, px + 22, py + ph / 2, 10, meta.shape, {
      fill: '#FFFFFF',
      stroke: '#FFD54F',
      lineWidth: 2,
    });

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.label, px + 40, py + ph / 2 + 0.5);
    ctx.restore();
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const stuntRampGameDefinition: ArcadeGameDefinition<StuntAction> = {
  id: 'stunt-ramp',
  title: 'Stunt Ramp Garage',
  subtitle: 'Mash buttons to launch cars & pop sky balloons!',
  accentColor: '#FF7043',
  developmental: {
    parentCategory: 'Cause & Effect · Vehicles',
    primaryTags: ['A1', 'A2'],
    secondaryTags: ['B1', 'B2'],
  },
  controls: [
    { action: 'launchRed', button: 'RED', label: 'Red Car', icon: 'car' },
    { action: 'launchGreen', button: 'GREEN', label: 'Green Car', icon: 'car' },
    { action: 'launchBlue', button: 'BLUE', label: 'Blue Car', icon: 'car' },
    { action: 'launchYellow', button: 'YELLOW', label: 'Yellow Car', icon: 'car' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const groundY = height * 0.8;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#64B5F6');
    sky.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, groundY);

    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, groundY, width, height - groundY);
    ctx.fillStyle = '#37474F';
    ctx.fillRect(0, groundY - 4, width, 16);

    // Mini colored garage doors on left
    const cols = ['#EF5350', '#66BB6A', '#42A5F5', '#FFCA28'];
    cols.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(12 + i * 20, groundY - 34, 16, 30, [4, 4, 0, 0]);
      ctx.fill();
    });

    // Orange wooden stunt ramp in center
    ctx.fillStyle = '#FF9800';
    ctx.beginPath();
    ctx.moveTo(width * 0.34, groundY - 4);
    ctx.quadraticCurveTo(width * 0.44, groundY - 8, width * 0.50, groundY - 38);
    ctx.lineTo(width * 0.50, groundY - 4);
    ctx.closePath();
    ctx.fill();

    // Floating balloons on right
    const bob = selected ? Math.sin(timeSec * 4) * 4 : 0;
    ctx.fillStyle = '#FFEE58';
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.28 + bob, 13, 0, Math.PI * 2);
    ctx.fill();
    drawCabinetShape(ctx, width * 0.78, height * 0.28 + bob, 6.5, 'star', { fill: '#FFFFFF' });

    ctx.fillStyle = '#EC407A';
    ctx.beginPath();
    ctx.arc(width * 0.88, height * 0.42 - bob, 12, 0, Math.PI * 2);
    ctx.fill();
    drawCabinetShape(ctx, width * 0.88, height * 0.42 - bob, 6, 'heart', { fill: '#FFFFFF' });

    // Red race car soaring mid-air off the ramp!
    const jumpArc = selected ? Math.sin(timeSec * 5) * 5 : 0;
    ctx.save();
    ctx.translate(width * 0.63, height * 0.44 + jumpArc);
    ctx.rotate(-0.28);
    ctx.fillStyle = '#EF5350';
    ctx.beginPath();
    ctx.roundRect(-22, -16, 44, 12, 5);
    ctx.fill();
    ctx.fillStyle = '#E1F5FE';
    ctx.beginPath();
    ctx.roundRect(-8, -23, 18, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(-13, -4, 7, 0, Math.PI * 2);
    ctx.arc(13, -4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  create(context) {
    return new StuntRampGarageGame(context);
  },
};
