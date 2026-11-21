import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  CabinetButton,
  ControlIcon,
  GameContext,
  GameInput,
} from '../../core/types';

export type CarWashAction = 'summonCar' | 'waterTool' | 'soapTool' | 'dryTool';

type StepKey = 'wash' | 'soap' | 'rinse' | 'dry';
type ActiveTool = 'water' | 'soap' | 'dry' | null;
type VehicleStyle = 'sedan' | 'suv' | 'bug' | 'pickup';

interface StepSpec {
  key: StepKey;
  label: string;
  button: CabinetButton;
  buttonHex: string;
  glowRgba: string;
  icon: ControlIcon;
}

const WASH_STEPS: StepSpec[] = [
  {
    key: 'wash',
    label: 'WASH',
    button: 'BLUE',
    buttonHex: '#29B6F6',
    glowRgba: 'rgba(41, 182, 246, 0.85)',
    icon: 'spray',
  },
  {
    key: 'soap',
    label: 'SOAP',
    button: 'YELLOW',
    buttonHex: '#FDD835',
    glowRgba: 'rgba(253, 216, 53, 0.85)',
    icon: 'bubbles',
  },
  {
    key: 'rinse',
    label: 'RINSE',
    button: 'BLUE',
    buttonHex: '#29B6F6',
    glowRgba: 'rgba(41, 182, 246, 0.85)',
    icon: 'spray',
  },
  {
    key: 'dry',
    label: 'DRY',
    button: 'RED',
    buttonHex: '#EF5350',
    glowRgba: 'rgba(239, 83, 80, 0.85)',
    icon: 'wind',
  },
];

interface MudSplat {
  nx: number;
  ny: number;
  r: number;
  zone: number;
}

interface SoapBubble {
  nx: number;
  ny: number;
  r: number;
  zone: number;
  hue: number;
}

interface Vehicle {
  id: number;
  style: VehicleStyle;
  paintColor: string;
  paintDark: string;
  hornPitch: number;
  screenX: number;
  targetX: number;
  wheelAngle: number;
  stepDone: Record<StepKey, boolean>;
  /** Set once all 4 steps are completed; counts down briefly then auto-exits! */
  celebratingClean: boolean;
  autoExitTimer: number;
  /** Playful wiggle if kid presses Green while car is still dirty */
  nudgeTimer: number;
  /** 8 horizontal zones across the vehicle body */
  dirtZones: number[]; // 1 = muddy, 0 = clean
  soapZones: number[]; // 0 = no soap, 1 = thick suds
  wetZones: number[]; // 0 = dry, 1 = wet droplets
  mudSplats: MudSplat[];
  foamBubbles: SoapBubble[];
  headlightsFlashTimer: number;
}

interface SprayParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
  maxAge: number;
  kind: 'water' | 'soap' | 'air' | 'sparkle';
  color: string;
}

const CAR_PALETTE: Array<{ main: string; dark: string }> = [
  { main: '#FF5252', dark: '#C62828' },
  { main: '#29B6F6', dark: '#0277BD' },
  { main: '#FFCA28', dark: '#F57F17' },
  { main: '#66BB6A', dark: '#2E7D32' },
  { main: '#AB47BC', dark: '#6A1B9A' },
  { main: '#FF7043', dark: '#D84315' },
  { main: '#26C6DA', dark: '#00838F' },
  { main: '#EC407A', dark: '#AD1457' },
];

const VEHICLE_STYLES: VehicleStyle[] = ['sedan', 'bug', 'suv', 'pickup'];
const ZONE_COUNT = 8;

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

class CarWashGame implements ArcadeGameInstance<CarWashAction> {
  private audio: GameContext['audio'];
  private nextCarId = 1;

  private queue: Vehicle[] = [];
  private activeCar: Vehicle | null = null;
  private exitingCars: Vehicle[] = [];

  /** Overhead nozzle position normalized -1 (left bumper) to +1 (right bumper) */
  private nozzleNormX = 0;
  private nozzleTilt = 0;
  private brushSpin = 0;
  private activeTool: ActiveTool = null;
  private prevJoystickX = 0;
  private sweepBoost = 0;
  private bubblePopCooldown = 0;

  /** Flashes lights on incomplete steps when Green is pressed while car is still dirty */
  private flashIncompleteTimer = 0;
  /** Gentle hint flash if wrong tool is held before an earlier required step */
  private hintStepKey: StepKey | null = null;
  private hintStepTimer = 0;

  private particles: SprayParticle[] = [];
  private time = 0;
  private lastLayoutWidth = 1280;

  constructor(context: GameContext) {
    this.audio = context.audio;
    for (let i = 0; i < 4; i++) {
      const car = this.createDirtyVehicle();
      car.screenX = -80 - i * 190;
      this.queue.push(car);
    }
  }

  private createDirtyVehicle(): Vehicle {
    const id = this.nextCarId++;
    const color = CAR_PALETTE[(id * 3) % CAR_PALETTE.length];
    const style = VEHICLE_STYLES[id % VEHICLE_STYLES.length];

    const mudSplats: MudSplat[] = [];
    for (let i = 0; i < 24; i++) {
      const nx = -0.82 + (i / 23) * 1.64 + (Math.random() - 0.5) * 0.12;
      const clampedNx = Math.max(-0.85, Math.min(0.85, nx));
      const zone = Math.min(
        ZONE_COUNT - 1,
        Math.max(0, Math.floor(((clampedNx + 1) / 2) * ZONE_COUNT))
      );
      mudSplats.push({
        nx: clampedNx,
        ny: 0.15 + Math.random() * 0.72,
        r: 10 + Math.random() * 14,
        zone,
      });
    }

    const foamBubbles: SoapBubble[] = [];
    for (let i = 0; i < 34; i++) {
      const nx = -0.86 + (i / 33) * 1.72 + (Math.random() - 0.5) * 0.1;
      const clampedNx = Math.max(-0.88, Math.min(0.88, nx));
      const zone = Math.min(
        ZONE_COUNT - 1,
        Math.max(0, Math.floor(((clampedNx + 1) / 2) * ZONE_COUNT))
      );
      foamBubbles.push({
        nx: clampedNx,
        ny: 0.08 + Math.random() * 0.82,
        r: 12 + Math.random() * 15,
        zone,
        hue: Math.floor(Math.random() * 360),
      });
    }

    return {
      id,
      style,
      paintColor: color.main,
      paintDark: color.dark,
      hornPitch: 0.85 + (id % 5) * 0.09,
      screenX: -300,
      targetX: 0,
      wheelAngle: 0,
      stepDone: {
        wash: false,
        soap: false,
        rinse: false,
        dry: false,
      },
      celebratingClean: false,
      autoExitTimer: 0,
      nudgeTimer: 0,
      dirtZones: new Array(ZONE_COUNT).fill(1),
      soapZones: new Array(ZONE_COUNT).fill(0),
      wetZones: new Array(ZONE_COUNT).fill(0),
      mudSplats,
      foamBubbles,
      headlightsFlashTimer: 0,
    };
  }

  private computeBayCenterX(width: number): number {
    return Math.round(width * 0.6);
  }

  private updateQueueTargets(width: number): void {
    const frontWaitX = Math.round(width * 0.17);
    this.queue.forEach((car, idx) => {
      car.targetX = frontWaitX - idx * 175;
    });
    if (this.activeCar) {
      this.activeCar.targetX = this.computeBayCenterX(width);
    }
  }

  private summonNextDirtyCarFromQueue(): void {
    const width = this.lastLayoutWidth;
    const next = this.queue.shift();
    if (next) {
      next.targetX = this.computeBayCenterX(width);
      next.headlightsFlashTimer = 0.45;
      this.activeCar = next;
      this.audio.playCarHorn(next.hornPitch);
    }

    const newcomer = this.createDirtyVehicle();
    const tailX =
      this.queue.length > 0
        ? this.queue[this.queue.length - 1].screenX - 185
        : -220;
    newcomer.screenX = tailX;
    this.queue.push(newcomer);
    this.updateQueueTargets(width);
    this.nozzleNormX = 0;
    this.flashIncompleteTimer = 0;
  }

  private sendActiveCarOut(): void {
    if (!this.activeCar) return;
    this.audio.playCarHorn(this.activeCar.hornPitch);
    this.activeCar.headlightsFlashTimer = 0.65;
    this.activeCar.targetX = this.lastLayoutWidth + 340;
    this.exitingCars.push(this.activeCar);
    this.activeCar = null;
    this.flashIncompleteTimer = 0;
  }

  private getIncompleteSteps(car: Vehicle): StepSpec[] {
    return WASH_STEPS.filter((s) => !car.stepDone[s.key]);
  }

  private getCurrentNextStep(car: Vehicle): StepKey | null {
    for (const s of WASH_STEPS) {
      if (!car.stepDone[s.key]) return s.key;
    }
    return null;
  }

  public getFlashingButtons(): CabinetButton[] {
    if (this.flashIncompleteTimer > 0 && this.activeCar) {
      const buttons = new Set<CabinetButton>();
      for (const st of this.getIncompleteSteps(this.activeCar)) {
        buttons.add(st.button);
      }
      return [...buttons];
    }
    if (this.hintStepTimer > 0 && this.hintStepKey) {
      const spec = WASH_STEPS.find((s) => s.key === this.hintStepKey);
      if (spec) return [spec.button];
    }
    return [];
  }

  public update(dt: number, input: GameInput<CarWashAction>): void {
    this.time += dt;
    this.bubblePopCooldown = Math.max(0, this.bubblePopCooldown - dt);
    if (this.flashIncompleteTimer > 0) {
      this.flashIncompleteTimer = Math.max(0, this.flashIncompleteTimer - dt);
    }
    if (this.hintStepTimer > 0) {
      this.hintStepTimer = Math.max(0, this.hintStepTimer - dt);
      if (this.hintStepTimer === 0) this.hintStepKey = null;
    }

    this.updateQueueTargets(this.lastLayoutWidth);

    // 1. Green button:
    // - If bay is empty -> summon first dirty car from queue!
    // - If car is in bay & still needs steps -> flash the lights of the steps still needed!
    // - If car is already celebrating 100% clean -> let it exit right away & summon next car!
    if (input.justPressed('summonCar')) {
      if (!this.activeCar) {
        this.summonNextDirtyCarFromQueue();
      } else if (this.activeCar.celebratingClean) {
        this.sendActiveCarOut();
        this.summonNextDirtyCarFromQueue();
      } else {
        // Car is still dirty/soapy/wet! Flash all remaining incomplete step lights!
        this.flashIncompleteTimer = 2.4;
        this.activeCar.nudgeTimer = 0.42;
        this.audio.playStepsNeededAlert();
      }
    }

    // Move cars smoothly toward target X
    const moveVehicle = (car: Vehicle, speed: number) => {
      const diff = car.targetX - car.screenX;
      if (Math.abs(diff) > 1) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
        car.screenX += step;
        car.wheelAngle += step / 26;
      }
      if (car.headlightsFlashTimer > 0) {
        car.headlightsFlashTimer = Math.max(0, car.headlightsFlashTimer - dt);
      }
      if (car.nudgeTimer > 0) {
        car.nudgeTimer = Math.max(0, car.nudgeTimer - dt);
      }
    };

    for (const qCar of this.queue) {
      moveVehicle(qCar, 310);
    }
    if (this.activeCar) {
      moveVehicle(this.activeCar, 420);

      // Handle automatic drive-out once all 4 steps are done!
      if (this.activeCar.celebratingClean) {
        this.activeCar.autoExitTimer -= dt;
        if (Math.random() < dt * 10) {
          this.particles.push({
            x: this.activeCar.screenX + (Math.random() - 0.5) * 230,
            y: -45 - Math.random() * 90,
            vx: (Math.random() - 0.5) * 25,
            vy: -30 - Math.random() * 30,
            radius: 7 + Math.random() * 5,
            age: 0,
            maxAge: 0.7,
            kind: 'sparkle',
            color: '#FFF59D',
          });
        }
        if (this.activeCar.autoExitTimer <= 0) {
          // Drive off on its own, leaving bay empty until Green is pressed!
          this.sendActiveCarOut();
        }
      }
    }

    for (let i = this.exitingCars.length - 1; i >= 0; i--) {
      const ex = this.exitingCars[i];
      moveVehicle(ex, 480);
      if (ex.screenX > this.lastLayoutWidth + 300) {
        this.exitingCars.splice(i, 1);
      }
    }

    // 2. Overhead Nozzle movement via Joystick Left/Right
    if (Math.abs(input.axisX) > 0.1) {
      this.nozzleNormX += input.axisX * 1.95 * dt;
      this.nozzleNormX = Math.max(-1, Math.min(1, this.nozzleNormX));
      this.nozzleTilt = input.axisX * 0.2;
    } else {
      this.nozzleTilt *= 0.88;
    }

    const deltaStick = Math.abs(input.axisX - this.prevJoystickX);
    this.prevJoystickX = input.axisX;
    if (deltaStick > 0.05 || Math.abs(input.axisX) > 0.2) {
      this.sweepBoost = Math.min(1.6, this.sweepBoost + dt * 3.5);
    } else {
      this.sweepBoost = Math.max(0.45, this.sweepBoost - dt * 1.8);
    }

    // 3. Explicit Tool Selection by Held Button:
    // Blue = Water | Yellow = Soap | Red = Dry
    let selectedTool: ActiveTool = null;
    if (input.isDown('waterTool')) {
      selectedTool = 'water';
    } else if (input.isDown('soapTool')) {
      selectedTool = 'soap';
    } else if (input.isDown('dryTool')) {
      selectedTool = 'dry';
    }

    this.activeTool = selectedTool;

    const carInBay =
      this.activeCar &&
      !this.activeCar.celebratingClean &&
      Math.abs(this.activeCar.screenX - this.activeCar.targetX) < 45;

    if (selectedTool) {
      const audioMode =
        selectedTool === 'water'
          ? this.activeCar?.stepDone.soap
            ? 'rinse'
            : 'wash'
          : selectedTool;
      this.audio.startWashStream(audioMode);
      if (selectedTool === 'soap') {
        this.brushSpin += dt * 9;
      }

      if (carInBay && this.activeCar) {
        this.applyToolToCar(this.activeCar, selectedTool, dt);
      }
      this.emitNozzleParticles(audioMode, dt);
    } else {
      this.audio.stopWashStream();
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'water') {
        p.vy += 320 * dt;
      } else if (p.kind === 'soap') {
        p.vy -= 38 * dt;
      }
    }
  }

  private applyToolToCar(car: Vehicle, tool: 'water' | 'soap' | 'dry', dt: number): void {
    const centerZone = ((this.nozzleNormX + 1) * 0.5) * (ZONE_COUNT - 1);
    const rate = 1.45 * this.sweepBoost * dt;

    for (let z = 0; z < ZONE_COUNT; z++) {
      const dist = Math.abs(z - centerZone);
      if (dist > 2.3) continue;
      const falloff = Math.max(0.22, 1 - dist / 2.4);
      const power = rate * falloff;

      if (tool === 'water') {
        if (!car.stepDone.wash) {
          // Step 1 (WASH): Pre-wet car and blast heavy mud chunks down to ~0.32
          car.dirtZones[z] = Math.max(0.32, car.dirtZones[z] - power * 0.95);
          car.wetZones[z] = Math.min(1, car.wetZones[z] + power * 1.45);
        } else if (!car.stepDone.soap) {
          // Already washed, waiting for Yellow Soap! Keep wet & pulse Soap step hint
          car.wetZones[z] = Math.min(1, car.wetZones[z] + power);
          this.triggerStepHint('soap');
        } else {
          // Step 3 (RINSE): Wash away all soap foam, leaving clean water droplets!
          car.soapZones[z] = Math.max(0, car.soapZones[z] - power * 1.45);
          car.dirtZones[z] = Math.max(0, car.dirtZones[z] - power);
          car.wetZones[z] = Math.min(1, car.wetZones[z] + power * 1.3);
          if (car.stepDone.dry && car.wetZones[z] > 0.25) {
            car.stepDone.dry = false;
          }
        }
      } else if (tool === 'soap') {
        if (!car.stepDone.wash) {
          // Need Step 1 (Blue Water Wash) before scrubbing with soap!
          this.triggerStepHint('wash');
        } else {
          // Step 2 (SOAP): Lather fluffy suds across the car & dissolve remaining mud!
          car.soapZones[z] = Math.min(1, car.soapZones[z] + power * 1.35);
          car.dirtZones[z] = Math.max(0, car.dirtZones[z] - power * 0.95);
          if (this.bubblePopCooldown <= 0 && Math.random() < 0.25) {
            this.bubblePopCooldown = 0.14;
            this.audio.playBubblePop();
          }
          // Putting new soap on an already-rinsed car means it needs rinsing & drying again!
          if (car.stepDone.rinse && car.soapZones[z] > 0.25) {
            car.stepDone.rinse = false;
            car.stepDone.dry = false;
          }
        }
      } else if (tool === 'dry') {
        if (!car.stepDone.wash) {
          this.triggerStepHint('wash');
        } else if (!car.stepDone.soap) {
          this.triggerStepHint('soap');
        } else if (!car.stepDone.rinse) {
          this.triggerStepHint('rinse');
        } else {
          // Step 4 (DRY): Blow warm air to whisk water droplets off the rinsed car!
          car.wetZones[z] = Math.max(0, car.wetZones[z] - power * 1.45);
        }
      }
    }

    // Check individual step completions!
    if (!car.stepDone.wash && avg(car.wetZones) >= 0.8 && avg(car.dirtZones) <= 0.46) {
      car.stepDone.wash = true;
      this.hintStepKey = null;
      this.audio.playStageComplete(false);
    }

    if (car.stepDone.wash && !car.stepDone.soap && avg(car.soapZones) >= 0.8) {
      for (let z = 0; z < ZONE_COUNT; z++) car.dirtZones[z] = 0;
      car.stepDone.soap = true;
      this.hintStepKey = null;
      this.audio.playStageComplete(false);
    }

    if (
      car.stepDone.wash &&
      car.stepDone.soap &&
      !car.stepDone.rinse &&
      avg(car.soapZones) <= 0.08
    ) {
      for (let z = 0; z < ZONE_COUNT; z++) car.soapZones[z] = 0;
      car.stepDone.rinse = true;
      this.hintStepKey = null;
      this.audio.playStageComplete(false);
    }

    if (
      car.stepDone.wash &&
      car.stepDone.soap &&
      car.stepDone.rinse &&
      !car.stepDone.dry &&
      avg(car.wetZones) <= 0.08
    ) {
      for (let z = 0; z < ZONE_COUNT; z++) car.wetZones[z] = 0;
      car.stepDone.dry = true;
      car.celebratingClean = true;
      car.autoExitTimer = 1.15;
      this.flashIncompleteTimer = 0;
      this.hintStepKey = null;
      this.audio.stopWashStream();
      this.audio.playStageComplete(true);
      car.headlightsFlashTimer = 1.0;

      for (let i = 0; i < 24; i++) {
        this.particles.push({
          x: car.screenX + (Math.random() - 0.5) * 250,
          y: -40 - Math.random() * 100,
          vx: (Math.random() - 0.5) * 150,
          vy: -60 - Math.random() * 95,
          radius: 7 + Math.random() * 5,
          age: 0,
          maxAge: 0.9,
          kind: 'sparkle',
          color: i % 2 === 0 ? '#FFF59D' : '#80DEEA',
        });
      }
    }
  }

  private triggerStepHint(step: StepKey): void {
    this.hintStepKey = step;
    this.hintStepTimer = 0.5;
  }

  private getStepProgress(car: Vehicle | null, key: StepKey): number {
    if (!car) return 0;
    if (car.stepDone[key]) return 1;
    if (key === 'wash') {
      return Math.min(1, avg(car.wetZones) / 0.8);
    }
    if (key === 'soap') {
      if (!car.stepDone.wash) return 0;
      return Math.min(1, avg(car.soapZones) / 0.8);
    }
    if (key === 'rinse') {
      if (!car.stepDone.soap) return 0;
      return Math.min(1, Math.max(0, 1 - avg(car.soapZones) / 0.85));
    }
    if (!car.stepDone.rinse) return 0;
    return Math.min(1, Math.max(0, 1 - avg(car.wetZones) / 0.9));
  }

  private emitNozzleParticles(
    mode: 'wash' | 'soap' | 'rinse' | 'dry',
    dt: number
  ): void {
    const bayX = this.computeBayCenterX(this.lastLayoutWidth);
    const nozzleX = bayX + this.nozzleNormX * 130;
    const count = Math.max(1, Math.round(dt * 95));

    for (let i = 0; i < count; i++) {
      if (mode === 'wash' || mode === 'rinse') {
        this.particles.push({
          x: nozzleX + (Math.random() - 0.5) * 18,
          y: -205,
          vx: (Math.random() - 0.5) * 110 + this.nozzleTilt * 160,
          vy: 280 + Math.random() * 120,
          radius: 4 + Math.random() * 4,
          age: 0,
          maxAge: 0.48,
          kind: 'water',
          color: mode === 'rinse' ? '#4FC3F7' : '#81D4FA',
        });
      } else if (mode === 'soap') {
        this.particles.push({
          x: nozzleX + (Math.random() - 0.5) * 34,
          y: -195 + Math.random() * 70,
          vx: (Math.random() - 0.5) * 90,
          vy: 140 + Math.random() * 80,
          radius: 8 + Math.random() * 10,
          age: 0,
          maxAge: 0.85,
          kind: 'soap',
          color: Math.random() > 0.35 ? '#FFFFFF' : '#FFF59D',
        });
      } else {
        this.particles.push({
          x: nozzleX + (Math.random() - 0.5) * 28,
          y: -205,
          vx: (Math.random() - 0.5) * 130,
          vy: 340 + Math.random() * 90,
          radius: 5 + Math.random() * 5,
          age: 0,
          maxAge: 0.4,
          kind: 'air',
          color: 'rgba(255, 210, 160, 0.78)',
        });
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.lastLayoutWidth = width;
    const roadY = Math.round(height * 0.79);
    const bayCenterX = this.computeBayCenterX(width);
    const bayWidth = 430;
    const bayLeft = bayCenterX - bayWidth / 2;

    // 1. Sunny sky & playful backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, roadY);
    sky.addColorStop(0, '#4FC3F7');
    sky.addColorStop(1, '#E1F5FE');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, roadY);

    // Grass + Asphalt road
    ctx.fillStyle = '#81C784';
    ctx.fillRect(0, roadY - 34, width, 38);
    ctx.fillStyle = '#455A64';
    ctx.fillRect(0, roadY, width, height - roadY);
    ctx.fillStyle = '#37474F';
    ctx.fillRect(0, roadY, width, 8);

    ctx.fillStyle = '#FFD54F';
    for (let x = 20; x < width; x += 68) {
      ctx.fillRect(x, roadY + (height - roadY) * 0.45, 36, 6);
    }

    // Queue sign on the left
    this.drawQueueSign(ctx, Math.round(width * 0.24), roadY);

    // 2. Car Wash Bay Tiled Interior Wall
    this.drawWashBayBack(ctx, bayLeft, bayWidth, roadY);

    // 3. Queue cars (left), exiting clean cars (right), active car (center)
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.drawVehicle(ctx, this.queue[i], roadY);
    }
    for (const ex of this.exitingCars) {
      this.drawVehicle(ctx, ex, roadY);
    }
    if (this.activeCar) {
      this.drawVehicle(ctx, this.activeCar, roadY);
    }

    // 4. Particles (water, soap suds, warm air, sparkles)
    for (const p of this.particles) {
      const alpha = Math.max(0, 1 - p.age / p.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.kind === 'sparkle') {
        this.drawSparkleStar(ctx, p.x, roadY + p.y, p.radius, p.color);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, roadY + p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        if (p.kind === 'soap') {
          ctx.strokeStyle = 'rgba(129, 212, 250, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 5. Front Pillars, Moving Overhead Gantry & Button-Linked Step Lights!
    this.drawWashBayFrontAndGantry(ctx, bayLeft, bayWidth, roadY);

    // 6. Empty-bay Green Button prompt (when waiting for Green to bring next car in)
    this.drawEmptyBayPrompt(ctx, bayCenterX, roadY);
  }

  private drawQueueSign(ctx: CanvasRenderingContext2D, x: number, roadY: number): void {
    ctx.fillStyle = '#546E7A';
    ctx.fillRect(x - 4, roadY - 110, 8, 86);
    ctx.fillStyle = '#FFB300';
    ctx.beginPath();
    ctx.roundRect(x - 44, roadY - 142, 88, 38, 10);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAIT HERE', x, roadY - 123);
  }

  private drawWashBayBack(
    ctx: CanvasRenderingContext2D,
    bayLeft: number,
    bayWidth: number,
    roadY: number
  ): void {
    const bayHeight = 270;
    const bayTop = roadY - bayHeight;

    ctx.fillStyle = '#CFD8DC';
    ctx.fillRect(bayLeft, bayTop, bayWidth, bayHeight);

    ctx.strokeStyle = 'rgba(120, 144, 156, 0.28)';
    ctx.lineWidth = 2;
    for (let tx = bayLeft + 32; tx < bayLeft + bayWidth; tx += 32) {
      ctx.beginPath();
      ctx.moveTo(tx, bayTop + 30);
      ctx.lineTo(tx, roadY);
      ctx.stroke();
    }
    for (let ty = bayTop + 36; ty < roadY; ty += 32) {
      ctx.beginPath();
      ctx.moveTo(bayLeft, ty);
      ctx.lineTo(bayLeft + bayWidth, ty);
      ctx.stroke();
    }

    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(bayLeft + 60, roadY + 4, bayWidth - 120, 12, 4);
    ctx.fill();

    ctx.fillStyle = 'rgba(3, 169, 244, 0.42)';
    for (let s = 0; s < 3; s++) {
      ctx.fillRect(bayLeft + 6 + s * 10, bayTop + 44, 8, bayHeight - 52);
      ctx.fillRect(bayLeft + bayWidth - 34 + s * 10, bayTop + 44, 8, bayHeight - 52);
    }
  }

  private drawWashBayFrontAndGantry(
    ctx: CanvasRenderingContext2D,
    bayLeft: number,
    bayWidth: number,
    roadY: number
  ): void {
    const bayHeight = 270;
    const bayTop = roadY - bayHeight;
    const bayCenterX = bayLeft + bayWidth / 2;

    // Overhead rail track
    ctx.fillStyle = '#37474F';
    ctx.fillRect(bayLeft + 18, bayTop + 44, bayWidth - 36, 12);

    // Moving Nozzle Gantry controlled by Joystick X
    const nozzleX = bayCenterX + this.nozzleNormX * 135;

    ctx.save();
    ctx.translate(nozzleX, bayTop + 50);

    ctx.fillStyle = '#FFB300';
    ctx.beginPath();
    ctx.roundRect(-26, -12, 52, 26, 8);
    ctx.fill();

    ctx.rotate(this.nozzleTilt);
    ctx.fillStyle = '#546E7A';
    ctx.fillRect(-8, 12, 16, 24);

    // Nozzle head matches currently held button color (or next needed step color!)
    const nextStepKey = this.activeCar ? this.getCurrentNextStep(this.activeCar) : null;
    const nextSpec = WASH_STEPS.find((s) => s.key === nextStepKey);
    const nozzleColor =
      this.activeTool === 'water'
        ? '#29B6F6'
        : this.activeTool === 'soap'
          ? '#FDD835'
          : this.activeTool === 'dry'
            ? '#EF5350'
            : nextSpec
              ? nextSpec.buttonHex
              : '#66BB6A';

    ctx.fillStyle = nozzleColor;
    ctx.beginPath();
    ctx.moveTo(-24, 36);
    ctx.lineTo(24, 36);
    ctx.lineTo(32, 52);
    ctx.lineTo(-32, 52);
    ctx.closePath();
    ctx.fill();

    // Spinning soap brush bristles when holding Yellow (Soap)
    if (this.activeTool === 'soap') {
      ctx.save();
      ctx.translate(0, 92);
      ctx.rotate(this.brushSpin);
      ctx.fillStyle = 'rgba(253, 216, 53, 0.78)';
      for (let b = 0; b < 8; b++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.roundRect(-6, 0, 12, 42, 6);
        ctx.fill();
      }
      ctx.restore();
    }

    // Water spray fan cone when holding Blue (Water)
    if (this.activeTool === 'water') {
      const fan = ctx.createLinearGradient(0, 52, 0, 205);
      fan.addColorStop(0, 'rgba(41, 182, 246, 0.65)');
      fan.addColorStop(1, 'rgba(41, 182, 246, 0.05)');
      ctx.fillStyle = fan;
      ctx.beginPath();
      ctx.moveTo(-18, 52);
      ctx.lineTo(18, 52);
      ctx.lineTo(64, 205);
      ctx.lineTo(-64, 205);
      ctx.closePath();
      ctx.fill();
    }

    // Warm air stream cone when holding Red (Dry)
    if (this.activeTool === 'dry') {
      const airGrad = ctx.createLinearGradient(0, 52, 0, 205);
      airGrad.addColorStop(0, 'rgba(255, 138, 101, 0.48)');
      airGrad.addColorStop(1, 'rgba(255, 224, 130, 0.04)');
      ctx.fillStyle = airGrad;
      ctx.beginPath();
      ctx.moveTo(-20, 52);
      ctx.lineTo(20, 52);
      ctx.lineTo(56, 205);
      ctx.lineTo(-56, 205);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();

    // Structural Pillars
    ctx.fillStyle = '#1E88E5';
    ctx.fillRect(bayLeft - 14, bayTop, 24, bayHeight + 4);
    ctx.fillRect(bayLeft + bayWidth - 10, bayTop, 24, bayHeight + 4);

    // --- Overhead Button-Matched 4-Step Scoreboard Sign ---
    const signW = bayWidth + 68;
    const signH = 122;
    const signX = bayCenterX - signW / 2;
    const signY = bayTop - signH + 34;

    ctx.fillStyle = '#16243B';
    ctx.beginPath();
    ctx.roundRect(signX, signY, signW, signH, 20);
    ctx.fill();
    ctx.strokeStyle = '#607D8B';
    ctx.lineWidth = 3;
    ctx.stroke();

    const cardW = 102;
    const cardH = 100;
    const gap = 16;
    const rowW = WASH_STEPS.length * cardW + (WASH_STEPS.length - 1) * gap;
    const startX = bayCenterX - rowW / 2;
    const cardY = signY + 11;

    const flashPhaseOn = Math.sin(this.time * 18) > 0;
    const currentNext = this.activeCar ? this.getCurrentNextStep(this.activeCar) : null;

    WASH_STEPS.forEach((step, idx) => {
      const cx = startX + idx * (cardW + gap);
      const isDone = !!this.activeCar?.stepDone[step.key];
      const isCurrent = !!this.activeCar && currentNext === step.key;
      const isFlashingAlert =
        (this.flashIncompleteTimer > 0 && !!this.activeCar && !isDone) ||
        (this.hintStepTimer > 0 && this.hintStepKey === step.key);
      const flashBright = isFlashingAlert && flashPhaseOn;

      ctx.save();
      if (flashBright) {
        ctx.translate(cx + cardW / 2, cardY + cardH / 2);
        ctx.scale(1.07, 1.07);
        ctx.translate(-(cx + cardW / 2), -(cardY + cardH / 2));
        ctx.shadowColor = step.glowRgba;
        ctx.shadowBlur = 26;
      } else if (isCurrent) {
        ctx.shadowColor = step.glowRgba;
        ctx.shadowBlur = 16;
      }

      // Card housing
      ctx.fillStyle = flashBright
        ? step.buttonHex
        : isDone
          ? 'rgba(46, 125, 50, 0.38)'
          : isCurrent
            ? '#263859'
            : 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.roundRect(cx, cardY, cardW, cardH, 14);
      ctx.fill();

      // Card border
      ctx.lineWidth = flashBright ? 4 : isCurrent ? 3 : 1.5;
      ctx.strokeStyle = flashBright
        ? '#FFFFFF'
        : isDone
          ? '#66BB6A'
          : isCurrent
            ? step.buttonHex
            : 'rgba(255,255,255,0.18)';
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Physical Chrome-Bezel Colored Arcade Button Graphic inside the step card!
      const btnCenterX = cx + cardW / 2;
      const btnCenterY = cardY + 34;
      const btnR = 20;

      // Chrome outer ring
      ctx.fillStyle = isDone || isCurrent || isFlashingAlert ? '#ECEFF1' : '#78909C';
      ctx.beginPath();
      ctx.arc(btnCenterX, btnCenterY, btnR + 4, 0, Math.PI * 2);
      ctx.fill();

      // Colored LED button cap (Blue = Water, Yellow = Soap, Red = Dry)
      ctx.globalAlpha = !this.activeCar || isDone || isCurrent || isFlashingAlert ? 1 : 0.55;
      ctx.fillStyle = flashBright ? '#FFFFFF' : step.buttonHex;
      ctx.beginPath();
      ctx.arc(btnCenterX, btnCenterY, btnR, 0, Math.PI * 2);
      ctx.fill();
      if (flashBright) {
        ctx.fillStyle = step.buttonHex;
        ctx.beginPath();
        ctx.arc(btnCenterX, btnCenterY, btnR - 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Matching button icon inside cap
      this.drawStepIcon(ctx, btnCenterX, btnCenterY, step.icon);
      ctx.globalAlpha = 1;

      // Step label ("WASH", "SOAP", "RINSE", "DRY")
      ctx.fillStyle = flashBright ? '#141926' : '#FFFFFF';
      ctx.font = '900 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(step.label, btnCenterX, cardY + 71);

      // Live fill progress bar along bottom of step card
      const prog = this.getStepProgress(this.activeCar, step.key);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.roundRect(cx + 12, cardY + 84, cardW - 24, 8, 4);
      ctx.fill();
      if (prog > 0.02) {
        ctx.fillStyle = isDone ? '#66BB6A' : step.buttonHex;
        ctx.beginPath();
        ctx.roundRect(cx + 12, cardY + 84, (cardW - 24) * prog, 8, 4);
        ctx.fill();
      }

      // Green Checkmark badge when step is completed!
      if (isDone) {
        const checkX = cx + cardW - 14;
        const checkY = cardY + 14;
        ctx.fillStyle = '#4CAF50';
        ctx.beginPath();
        ctx.arc(checkX, checkY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(checkX - 5, checkY);
        ctx.lineTo(checkX - 1, checkY + 4);
        ctx.lineTo(checkX + 5, checkY - 4);
        ctx.stroke();
      }

      ctx.restore();

      // Connecting arrow between steps (1 -> 2 -> 3 -> 4)
      if (idx < WASH_STEPS.length - 1) {
        const arrowX = cx + cardW + gap / 2;
        const arrowY = cardY + cardH / 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.moveTo(arrowX - 4, arrowY - 6);
        ctx.lineTo(arrowX + 5, arrowY);
        ctx.lineTo(arrowX - 4, arrowY + 6);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  private drawStepIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    icon: ControlIcon
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#141926';
    ctx.fillStyle = '#141926';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (icon === 'spray') {
      ctx.beginPath();
      ctx.arc(0, 3, 5.5, 0, Math.PI);
      ctx.moveTo(0, -8);
      ctx.lineTo(-5.5, 3);
      ctx.lineTo(5.5, 3);
      ctx.closePath();
      ctx.fill();
    } else if (icon === 'bubbles') {
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.arc(-4, 3, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(4.5, -2.5, 3.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(2.5, 5.5, 2.2, 0, Math.PI * 2);
      ctx.stroke();
    } else if (icon === 'wind') {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-8, -4.5);
      ctx.lineTo(4, -4.5);
      ctx.arc(4, -6.8, 2.3, Math.PI * 0.5, Math.PI * 1.8, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, 1);
      ctx.lineTo(7, 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-7, 5.5);
      ctx.lineTo(3.5, 5.5);
      ctx.arc(3.5, 7.8, 2.3, -Math.PI * 0.5, Math.PI * 0.8, false);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawVehicle(
    ctx: CanvasRenderingContext2D,
    car: Vehicle,
    roadY: number
  ): void {
    const nudgeOffset =
      car.nudgeTimer > 0 ? Math.sin(car.nudgeTimer * 45) * 7 : 0;

    ctx.save();
    ctx.translate(car.screenX + nudgeOffset, roadY + 4);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 102, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawBodyShape = () => {
      ctx.beginPath();
      if (car.style === 'bug') {
        ctx.moveTo(-92, -18);
        ctx.quadraticCurveTo(-94, -56, -55, -62);
        ctx.quadraticCurveTo(0, -118, 52, -62);
        ctx.quadraticCurveTo(94, -54, 94, -18);
        ctx.closePath();
      } else if (car.style === 'suv') {
        ctx.roundRect(-98, -62, 196, 44, 12);
        ctx.roundRect(-78, -104, 138, 50, [14, 18, 0, 0]);
      } else if (car.style === 'pickup') {
        ctx.roundRect(-100, -58, 200, 40, 10);
        ctx.roundRect(-22, -100, 82, 48, [10, 16, 0, 0]);
      } else {
        ctx.roundRect(-96, -56, 192, 38, 12);
        ctx.roundRect(-58, -96, 114, 46, [16, 20, 0, 0]);
      }
    };

    ctx.fillStyle = car.paintColor;
    drawBodyShape();
    ctx.fill();

    // Windows
    ctx.fillStyle = '#B3E5FC';
    if (car.style === 'bug') {
      ctx.beginPath();
      ctx.arc(0, -60, 36, Math.PI * 1.08, Math.PI * 1.92);
      ctx.closePath();
      ctx.fill();
    } else if (car.style === 'suv') {
      ctx.beginPath();
      ctx.roundRect(-66, -96, 54, 34, 6);
      ctx.roundRect(-2, -96, 52, 34, 6);
      ctx.fill();
    } else if (car.style === 'pickup') {
      ctx.beginPath();
      ctx.roundRect(-10, -92, 58, 34, 6);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-46, -88, 42, 32, 6);
      ctx.roundRect(4, -88, 42, 32, 6);
      ctx.fill();
    }

    // Bumpers & Headlight
    ctx.fillStyle = '#CFD8DC';
    ctx.beginPath();
    ctx.roundRect(-102, -28, 16, 12, 4);
    ctx.roundRect(86, -28, 16, 12, 4);
    ctx.fill();

    const lightsOn = car.headlightsFlashTimer > 0 || car.celebratingClean;
    ctx.fillStyle = lightsOn ? '#FFF176' : '#FFE082';
    ctx.beginPath();
    ctx.arc(92, -40, 8, 0, Math.PI * 2);
    ctx.fill();
    if (car.headlightsFlashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 249, 170, 0.45)';
      ctx.beginPath();
      ctx.moveTo(96, -48);
      ctx.lineTo(175, -72);
      ctx.lineTo(175, -12);
      ctx.lineTo(96, -32);
      ctx.closePath();
      ctx.fill();
    }

    // Gloss highlight streak when mud is gone!
    const totalDirt = avg(car.dirtZones);
    if (totalDirt < 0.2) {
      ctx.save();
      drawBodyShape();
      ctx.clip();
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.28 * (1 - totalDirt * 5)).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(-40, -115);
      ctx.lineTo(-10, -115);
      ctx.lineTo(-55, -10);
      ctx.lineTo(-85, -10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Clipped Mud & Water Droplet Overlays
    ctx.save();
    drawBodyShape();
    ctx.clip();

    for (const m of car.mudSplats) {
      const dirtAmt = car.dirtZones[m.zone];
      if (dirtAmt <= 0.02) continue;
      ctx.fillStyle = `rgba(109, 76, 65, ${(0.88 * dirtAmt).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(m.nx * 98, -22 - m.ny * 68, m.r * (0.4 + 0.6 * dirtAmt), 0, Math.PI * 2);
      ctx.fill();
    }

    for (let z = 0; z < ZONE_COUNT; z++) {
      const wetAmt = car.wetZones[z];
      if (wetAmt <= 0.05) continue;
      const zx = -88 + (z + 0.5) * (176 / ZONE_COUNT);
      ctx.fillStyle = `rgba(41, 182, 246, ${(0.82 * wetAmt).toFixed(2)})`;
      for (let d = 0; d < 4; d++) {
        const dy = -26 - ((d * 19 + z * 11) % 58);
        ctx.beginPath();
        ctx.arc(zx + (d - 1.5) * 6, dy, 4.2 * wetAmt, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Fluffy Soap Suds
    for (const b of car.foamBubbles) {
      const soapAmt = car.soapZones[b.zone];
      if (soapAmt <= 0.04) continue;
      const bx = b.nx * 96;
      const by = -22 - b.ny * 74;
      const r = b.r * soapAmt;
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.92 * Math.min(1, soapAmt * 1.2)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `hsla(${b.hue}, 85%, 76%, ${(0.7 * soapAmt).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Wheels
    for (const wx of [-60, 60]) {
      ctx.save();
      ctx.translate(wx, -18);
      ctx.rotate(car.wheelAngle);
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(0, 0, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ECEFF1';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#78909C';
      ctx.fillRect(-9, -2, 18, 4);
      ctx.fillRect(-2, -9, 4, 18);
      ctx.restore();

      const wheelZone = wx < 0 ? 1 : 6;
      if (car.dirtZones[wheelZone] > 0.3) {
        ctx.fillStyle = `rgba(109, 76, 65, ${(0.6 * car.dirtZones[wheelZone]).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(wx, -18, 19, 0.2, Math.PI - 0.2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawSparkleStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.35;
      const a = (Math.PI * i) / 4;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      else ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }

  private drawEmptyBayPrompt(
    ctx: CanvasRenderingContext2D,
    bayCenterX: number,
    roadY: number
  ): void {
    if (this.activeCar) return;
    const pulse = Math.sin(this.time * 4.5) * 5;
    const py = roadY - 122 + pulse;

    ctx.fillStyle = 'rgba(22, 36, 59, 0.92)';
    ctx.beginPath();
    ctx.roundRect(bayCenterX - 135, py - 34, 270, 68, 34);
    ctx.fill();
    ctx.strokeStyle = '#2ECC71';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Matching Green Chrome Arcade Button icon inside the prompt!
    const bx = bayCenterX - 92;
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath();
    ctx.arc(bx, py, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2ECC71';
    ctx.beginPath();
    ctx.arc(bx, py, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#141926';
    ctx.beginPath();
    ctx.roundRect(bx - 9, py - 1, 18, 6, 2);
    ctx.roundRect(bx - 5, py - 7, 10, 6, 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRESS GREEN', bx + 32, py - 8);
    ctx.fillStyle = '#A5D6A7';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('FOR NEXT CAR!', bx + 32, py + 11);
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const carWashGameDefinition: ArcadeGameDefinition<CarWashAction> = {
  id: 'car-wash',
  title: 'Bubble Car Wash',
  subtitle: 'Wash, soap, rinse & dry muddy cars!',
  accentColor: '#29B6F6',
  developmental: {
    parentCategory: 'Routines & Order',
    primaryTags: ['D2', 'E2'],
    secondaryTags: ['A1', 'D3'],
  },
  controls: [
    { action: 'summonCar', button: 'GREEN', label: 'Next Car', icon: 'car' },
    { action: 'waterTool', button: 'BLUE', label: 'Water', icon: 'spray' },
    { action: 'soapTool', button: 'YELLOW', label: 'Soap', icon: 'bubbles' },
    { action: 'dryTool', button: 'RED', label: 'Dry', icon: 'wind' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#29B6F6');
    grad.addColorStop(0.75, '#E1F5FE');
    grad.addColorStop(0.75, '#455A64');
    grad.addColorStop(1, '#37474F');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.52;
    const roadY = height * 0.78;
    ctx.fillStyle = '#16243B';
    ctx.fillRect(cx - 88, 22, 18, roadY - 22);
    ctx.fillRect(cx + 70, 22, 18, roadY - 22);
    ctx.beginPath();
    ctx.roundRect(cx - 98, 12, 196, 34, 10);
    ctx.fill();

    // Mini 4 colored step button dots on cover sign (Blue, Yellow, Blue, Red)
    const dotColors = ['#29B6F6', '#FDD835', '#29B6F6', '#EF5350'];
    dotColors.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx - 54 + i * 36, 29, 8, 0, Math.PI * 2);
      ctx.fill();
    });

    const sweep = selected ? Math.sin(timeSec * 3.5) * 38 : 0;
    ctx.fillStyle = '#FFB300';
    ctx.beginPath();
    ctx.roundRect(cx - 18 + sweep, 46, 36, 15, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(129, 212, 250, 0.55)';
    ctx.beginPath();
    ctx.moveTo(cx - 10 + sweep, 61);
    ctx.lineTo(cx + 10 + sweep, 61);
    ctx.lineTo(cx + 42 + sweep, roadY - 24);
    ctx.lineTo(cx - 42 + sweep, roadY - 24);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFCA28';
    ctx.beginPath();
    ctx.roundRect(cx - 64, roadY - 40, 128, 28, 10);
    ctx.roundRect(cx - 38, roadY - 68, 76, 32, [12, 14, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#B3E5FC';
    ctx.beginPath();
    ctx.roundRect(cx - 28, roadY - 62, 56, 22, 5);
    ctx.fill();

    for (const wx of [cx - 40, cx + 40]) {
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(wx, roadY - 12, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ECEFF1';
      ctx.beginPath();
      ctx.arc(wx, roadY - 12, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 7; i++) {
      const bx = cx - 50 + i * 17;
      const by = roadY - 46 - ((timeSec * 28 + i * 19) % 45);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.beginPath();
      ctx.arc(bx, by, 7 + (i % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  create(context) {
    return new CarWashGame(context);
  },
};
