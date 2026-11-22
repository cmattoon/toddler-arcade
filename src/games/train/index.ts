import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  GameContext,
  GameInput,
} from '../../core/types';

export type TrainAction = 'chugBell' | 'horn' | 'brake' | 'cycleColor';

type BiomeType = 'station' | 'cityscape' | 'suburbscape' | 'rural' | 'rural2';

/**
 * Endless palindrome landscape sequence requested:
 * [station -> cityscape -> suburbscape -> rural -> rural2 -> suburb -> city -> station -> city -> suburb -> rural ...]
 */
const BIOME_CYCLE: BiomeType[] = [
  'station',
  'cityscape',
  'suburbscape',
  'rural',
  'rural2',
  'suburbscape',
  'cityscape',
];

const SEGMENT_WIDTH = 1500;

interface TrainColorTheme {
  name: string;
  body: string;
  dark: string;
  trim: string;
  cab: string;
}

const TRAIN_COLORS: TrainColorTheme[] = [
  { name: 'Ruby Red', body: '#E53935', dark: '#AB1F1D', trim: '#FFD54F', cab: '#C62828' },
  { name: 'Classic Blue', body: '#1E88E5', dark: '#125B9E', trim: '#FFD54F', cab: '#1565C0' },
  { name: 'Emerald Green', body: '#2E9E5B', dark: '#1B6B3B', trim: '#FFE082', cab: '#237A46' },
  { name: 'Sunny Gold', body: '#F9A825', dark: '#C17900', trim: '#FFF59D', cab: '#EF6C00' },
  { name: 'Royal Purple', body: '#8E24AA', dark: '#5C1373', trim: '#FFD54F', cab: '#6A1B9A' },
  { name: 'Tangerine', body: '#FB6A2C', dark: '#BF3E0B', trim: '#FFF176', cab: '#E64A19' },
  { name: 'Berry Pink', body: '#EC407A', dark: '#AD1457', trim: '#FFF59D', cab: '#D81B60' },
  { name: 'Ocean Teal', body: '#00ACC1', dark: '#007C91', trim: '#FFE082', cab: '#00838F' },
];

interface BiomePalette {
  skyTop: [number, number, number];
  skyBottom: [number, number, number];
  farHill: [number, number, number];
  ground: [number, number, number];
}

const BIOME_PALETTES: Record<BiomeType, BiomePalette> = {
  station: {
    skyTop: [108, 180, 245],
    skyBottom: [208, 236, 255],
    farHill: [148, 196, 158],
    ground: [130, 178, 118],
  },
  cityscape: {
    skyTop: [92, 162, 235],
    skyBottom: [204, 226, 248],
    farHill: [138, 162, 190],
    ground: [146, 154, 164],
  },
  suburbscape: {
    skyTop: [106, 184, 248],
    skyBottom: [215, 240, 255],
    farHill: [132, 194, 138],
    ground: [116, 184, 104],
  },
  rural: {
    skyTop: [114, 192, 250],
    skyBottom: [225, 244, 255],
    farHill: [152, 204, 116],
    ground: [136, 194, 88],
  },
  rural2: {
    skyTop: [88, 172, 238],
    skyBottom: [208, 238, 246],
    farHill: [104, 164, 148],
    ground: [96, 166, 108],
  },
};

interface SmokePuff {
  worldX: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxAge: number;
  age: number;
  tint: string;
  isRing?: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  color: string;
}

interface ConfettiPiece {
  /** Screen-space X fraction/offset relative to viewport center so confetti rains cleanly */
  offsetX: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rotation: number;
  vRot: number;
  spinPhase: number;
  spinSpeed: number;
  swayPhase: number;
  age: number;
  maxAge: number;
  color: string;
}

type PassengerAccessory = 'none' | 'cap' | 'bow' | 'beanie' | 'curly';

interface Passenger {
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  accessory: PassengerAccessory;
  /** 0 = ducked below window sill, 1 = seated & visible in window */
  presence: number;
  targetPresence: 0 | 1;
  bobPhase: number;
}

interface ScheduledBoardingEvent {
  delay: number;
  seatIndex: number;
  type: 'alight' | 'board';
}

const SKIN_TONES = ['#FFCCBC', '#F5CBA7', '#E0AC69', '#C68642', '#8D5524'];
const HAIR_COLORS = ['#3E2723', '#5D4037', '#F9A825', '#BF360C', '#263238', '#6D4C41'];
const SHIRT_COLORS = ['#42A5F5', '#EC407A', '#66BB6A', '#FFA726', '#AB47BC', '#26C6DA', '#EF5350'];
const ACCESSORIES: PassengerAccessory[] = ['none', 'cap', 'bow', 'beanie', 'curly'];
const CONFETTI_COLORS = [
  '#FF5252',
  '#FFD54F',
  '#29B6F6',
  '#66BB6A',
  '#AB47BC',
  '#FF7043',
  '#EC407A',
  '#26C6DA',
];
const COACH_WINDOW_COUNT = 4;

function seededRand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): string {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r}, ${g}, ${b})`;
}

function getBiomeForSegment(segIndex: number): BiomeType {
  const len = BIOME_CYCLE.length;
  const mod = ((segIndex % len) + len) % len;
  return BIOME_CYCLE[mod];
}

class TrainGame implements ArcadeGameInstance<TrainAction> {
  private audio: GameContext['audio'];

  // Physics & movement
  private worldX = 820; // Start parked squarely along the first Train Station platform!
  private velocity = 0; // px/sec (+ = forward/right, - = reverse/left)
  private readonly maxForwardSpeed = 520;
  private readonly maxReverseSpeed = 240;
  private readonly thrustAccel = 260;
  private readonly coastDrag = 34; // Gentle rolling inertia so train glides smoothly
  private readonly brakeDecel = 460;

  // Train state (engine always ready to roll so joystick & buttons always respond!)
  private engineRunning = true;
  private hornActive = false;
  private brakingActive = false;
  private brakeHoldElapsed = 0;
  private brakePulseTimer = 0;
  private colorIndex = 0;
  private colorPopTimer = 0;
  private bellSwingTimer = 0;
  private chugHopTimer = 0;
  private bellRingCount = 0;

  // Station stop celebration & passenger boarding state (no penalty for skipping!)
  private canCelebrateNextStop = false;
  private lastStoppedStationWorldX = 820;
  private stationCelebrationTimer = 0;
  private ambientStationTimer = 2.0;
  private seats: Array<Passenger | null> = new Array(COACH_WINDOW_COUNT).fill(null);
  private boardingEvents: ScheduledBoardingEvent[] = [];

  // Animation timers & particles
  private time = 0;
  private wheelPhase = 0;
  private chugStep = 0;
  private idlePuffTimer = 0;
  private whistlePuffTimer = 0;
  private brakeHissTimer = 0;
  private smokePuffs: SmokePuff[] = [];
  private sparks: Spark[] = [];
  private confetti: ConfettiPiece[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
    // Start with 3 cheerful passengers already seated in the coach windows
    [0, 1, 3].forEach((seatIdx) => {
      const p = this.createRandomPassenger();
      p.presence = 1;
      p.targetPresence = 1;
      this.seats[seatIdx] = p;
    });
  }

  private createRandomPassenger(): Passenger {
    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    return {
      skinColor: pick(SKIN_TONES),
      hairColor: pick(HAIR_COLORS),
      shirtColor: pick(SHIRT_COLORS),
      accessory: pick(ACCESSORIES),
      presence: 0,
      targetPresence: 1,
      bobPhase: Math.random() * Math.PI * 2,
    };
  }

  private isTrainAtStationPlatform(): boolean {
    // Check both the locomotive and the passenger coach positions so stopping anywhere along
    // the 1220px station platform counts generously!
    for (const checkWorldX of [this.worldX, this.worldX - 244]) {
      const seg = Math.floor(checkWorldX / SEGMENT_WIDTH);
      if (getBiomeForSegment(seg) === 'station') {
        const localX = checkWorldX - seg * SEGMENT_WIDTH;
        if (localX >= 95 && localX <= 1410) {
          return true;
        }
      }
    }
    return false;
  }

  public update(dt: number, input: GameInput<TrainAction>): void {
    this.time += dt;
    if (this.colorPopTimer > 0) {
      this.colorPopTimer = Math.max(0, this.colorPopTimer - dt);
    }
    if (this.bellSwingTimer > 0) {
      this.bellSwingTimer = Math.max(0, this.bellSwingTimer - dt);
    }
    if (this.chugHopTimer > 0) {
      this.chugHopTimer = Math.max(0, this.chugHopTimer - dt);
    }

    // 1. Green button: Repeatable Chug-Boost + Brass Bell Ring + Giant Steam O-Ring!
    if (input.justPressed('chugBell')) {
      this.engineRunning = true;
      const ringIdx = this.bellRingCount++;
      this.bellSwingTimer = 0.8;
      this.chugHopTimer = 0.28;
      this.audio.playTrainBellChug(ringIdx);
      this.emitSteamRing(ringIdx);
      if (!this.brakingActive) {
        this.velocity = Math.min(
          this.maxForwardSpeed,
          this.velocity < 0 ? 125 : this.velocity + 135
        );
      }
    }

    // 2. Blue (4th) button: Cycle train paint color
    if (input.justPressed('cycleColor')) {
      this.colorIndex = (this.colorIndex + 1) % TRAIN_COLORS.length;
      this.colorPopTimer = 0.55;
      this.audio.playColorCycle(this.colorIndex);
      this.spawnColorSparkles();
    }

    // 3. Yellow button: Train whistle / horn
    if (input.isDown('horn')) {
      if (!this.hornActive) {
        this.hornActive = true;
        this.audio.startTrainHorn();
      }
      this.whistlePuffTimer -= dt;
      if (this.whistlePuffTimer <= 0) {
        this.whistlePuffTimer = 0.07;
        this.emitWhistleSteam();
      }
    } else if (this.hornActive) {
      this.hornActive = false;
      this.audio.stopTrainHorn();
    }

    // 4. Red button: Momentary Brakes vs Joystick thrust + Inertia
    if (input.justPressed('brake')) {
      this.brakeHoldElapsed = 0;
      this.brakePulseTimer = 0.2;
    }
    if (this.brakePulseTimer > 0) {
      this.brakePulseTimer = Math.max(0, this.brakePulseTimer - dt);
    }
    if (input.isDown('brake')) {
      this.brakeHoldElapsed += dt;
    } else {
      this.brakeHoldElapsed = 0;
    }

    // Momentary brake: active only briefly/while stopping, auto-releases at standstill or max 1.6s hold
    const brakeRequested =
      (input.isDown('brake') && this.brakeHoldElapsed < 1.6) || this.brakePulseTimer > 0;
    this.brakingActive = brakeRequested && Math.abs(this.velocity) > 0.5;

    if (this.brakingActive) {
      if (Math.abs(this.velocity) > 5) {
        this.brakeHissTimer -= dt;
        if (this.brakeHissTimer <= 0) {
          this.brakeHissTimer = 0.22;
          this.audio.playBrakeHiss(Math.abs(this.velocity) / this.maxForwardSpeed);
        }
        // Friction sparks near wheels when braking at speed
        if (Math.abs(this.velocity) > 65 && Math.random() < dt * 35) {
          this.spawnBrakeSpark();
        }
      }
      const sign = Math.sign(this.velocity);
      const nextVel = this.velocity - sign * this.brakeDecel * dt;
      if (Math.sign(nextVel) !== sign || Math.abs(nextVel) < 1) {
        this.velocity = 0;
        this.brakingActive = false;
      } else {
        this.velocity = nextVel;
      }
    } else if (this.engineRunning && Math.abs(input.axisX) > 0.1) {
      this.velocity += input.axisX * this.thrustAccel * dt;
      this.velocity = Math.max(
        -this.maxReverseSpeed,
        Math.min(this.maxForwardSpeed, this.velocity)
      );
    } else {
      // Natural coasting inertia
      if (Math.abs(this.velocity) > 0) {
        const sign = Math.sign(this.velocity);
        const nextVel = this.velocity - sign * this.coastDrag * dt;
        this.velocity = Math.sign(nextVel) !== sign ? 0 : nextVel;
      }
    }

    // Advance world position & wheel rotation
    const prevWheelPhase = this.wheelPhase;
    this.worldX += this.velocity * dt;
    const wheelRadius = 34;
    this.wheelPhase += (this.velocity * dt) / wheelRadius;

    if (this.stationCelebrationTimer > 0) {
      this.stationCelebrationTimer = Math.max(0, this.stationCelebrationTimer - dt);
      // Keep raining fresh confetti from the top of the screen throughout the celebration!
      if (Math.random() < dt * 32) {
        this.confetti.push({
          offsetX: (Math.random() - 0.5) * 1050,
          y: -18,
          vx: (Math.random() - 0.5) * 90,
          vy: 85 + Math.random() * 80,
          w: 14 + Math.random() * 8,
          h: 9 + Math.random() * 5,
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 5,
          spinPhase: Math.random() * Math.PI * 2,
          spinSpeed: 4 + Math.random() * 5,
          swayPhase: Math.random() * Math.PI * 2,
          age: 0,
          maxAge: 4.2,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        });
      }
    }

    // Re-arm station stop celebration once the train pulls away from the last station stop
    if (Math.abs(this.worldX - this.lastStoppedStationWorldX) > 260) {
      this.canCelebrateNextStop = true;
    }

    const stoppedAtStation = Math.abs(this.velocity) < 8 && this.isTrainAtStationPlatform();
    if (stoppedAtStation) {
      if (this.canCelebrateNextStop) {
        this.canCelebrateNextStop = false;
        this.lastStoppedStationWorldX = this.worldX;
        this.triggerStationArrival();
      } else if (this.boardingEvents.length === 0) {
        // Occasional passenger hopping on or off while parked at a station
        this.ambientStationTimer -= dt;
        if (this.ambientStationTimer <= 0) {
          this.ambientStationTimer = 2.8 + Math.random() * 1.8;
          this.scheduleSinglePassengerChange();
        }
      }
    } else if (Math.abs(this.velocity) > 35 && this.boardingEvents.length > 0) {
      // Train pulled out — cancel remaining scheduled door swaps so nobody hops off mid-ride!
      this.boardingEvents = [];
    }

    // Process scheduled passenger boarding / alighting events
    for (let i = this.boardingEvents.length - 1; i >= 0; i--) {
      const ev = this.boardingEvents[i];
      ev.delay -= dt;
      if (ev.delay <= 0) {
        this.boardingEvents.splice(i, 1);
        if (ev.type === 'alight') {
          const existing = this.seats[ev.seatIndex];
          if (existing && existing.targetPresence === 1) {
            existing.targetPresence = 0;
            this.audio.playPassengerPop(false);
          }
        } else {
          const cur = this.seats[ev.seatIndex];
          if (!cur || cur.targetPresence === 0) {
            this.seats[ev.seatIndex] = this.createRandomPassenger();
            this.audio.playPassengerPop(true);
          }
        }
      }
    }

    // Animate passenger faces appearing / disappearing in the coach windows
    for (let s = 0; s < COACH_WINDOW_COUNT; s++) {
      const p = this.seats[s];
      if (!p) continue;
      if (p.presence < p.targetPresence) {
        p.presence = Math.min(1, p.presence + dt * 4.2);
      } else if (p.presence > p.targetPresence) {
        p.presence = Math.max(0, p.presence - dt * 4.2);
        if (p.presence === 0 && p.targetPresence === 0) {
          this.seats[s] = null;
        }
      }
    }

    // Emit rhythmic chugs tied to wheel quarter-turns while moving
    const chugInterval = Math.PI * 0.65;
    if (Math.floor(Math.abs(this.wheelPhase) / chugInterval) !== Math.floor(Math.abs(prevWheelPhase) / chugInterval)) {
      if (Math.abs(this.velocity) > 12) {
        this.chugStep = (this.chugStep + 1) % 4;
        const speedNorm = Math.abs(this.velocity) / this.maxForwardSpeed;
        this.audio.playTrainChug(speedNorm, this.chugStep === 0);
        this.emitSmoke(false, 0.85 + speedNorm * 0.5);
      }
    }

    // Gentle idle puffing when engine is running at rest
    if (this.engineRunning && Math.abs(this.velocity) <= 12) {
      this.idlePuffTimer -= dt;
      if (this.idlePuffTimer <= 0) {
        this.idlePuffTimer = 0.85;
        this.emitSmoke(false, 0.65);
      }
    }

    // Update smoke particles
    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.smokePuffs.splice(i, 1);
        continue;
      }
      p.worldX += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 0.985;
      p.radius += 22 * dt;
    }

    // Update sparks / color stars
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 260 * dt;
    }

    // Update celebration confetti
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.age += dt;
      if (c.age >= c.maxAge) {
        this.confetti.splice(i, 1);
        continue;
      }
      c.offsetX += (c.vx + Math.sin(this.time * 5 + c.swayPhase) * 42) * dt;
      c.y += c.vy * dt;
      c.vx *= 0.98;
      c.vy = Math.min(145, c.vy + 165 * dt);
      c.rotation += c.vRot * dt;
      c.spinPhase += c.spinSpeed * dt;
    }
  }

  private triggerStationArrival(): void {
    this.stationCelebrationTimer = 4.0;
    this.ambientStationTimer = 3.2;
    this.audio.playStationCelebration();

    // Burst 90 chunky, vibrant confetti ribbons & streamers across the station!
    for (let i = 0; i < 90; i++) {
      const fromCannons = i < 55;
      this.confetti.push({
        offsetX: (Math.random() - 0.5) * 1000,
        y: fromCannons ? 260 + Math.random() * 90 : -15 - Math.random() * 160,
        vx: (Math.random() - 0.5) * 260,
        vy: fromCannons ? -(210 + Math.random() * 230) : 65 + Math.random() * 90,
        w: 14 + Math.random() * 8,
        h: 9 + Math.random() * 5,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 6,
        spinPhase: Math.random() * Math.PI * 2,
        spinSpeed: 4 + Math.random() * 6,
        swayPhase: Math.random() * Math.PI * 2,
        age: 0,
        maxAge: 3.6 + Math.random() * 1.4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }

    // Schedule random passengers getting off and new passengers getting on!
    this.boardingEvents = [];
    let delay = 0.22;
    const indices = [0, 1, 2, 3].sort(() => Math.random() - 0.5);

    // 1 to 3 seated passengers hop off
    let alightedCount = 0;
    const maxAlight = 1 + Math.floor(Math.random() * 3);
    for (const idx of indices) {
      if (this.seats[idx] && alightedCount < maxAlight) {
        this.boardingEvents.push({ delay, seatIndex: idx, type: 'alight' });
        delay += 0.26;
        alightedCount++;
      }
    }

    // 1 to 3 new passengers climb aboard into open or newly vacated windows
    const boardCandidates = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const desiredBoardCount = 1 + Math.floor(Math.random() * 3);
    let scheduledBoard = 0;
    for (const idx of boardCandidates) {
      const willBeEmpty =
        !this.seats[idx] ||
        this.boardingEvents.some((e) => e.seatIndex === idx && e.type === 'alight');
      if (willBeEmpty && scheduledBoard < desiredBoardCount) {
        this.boardingEvents.push({ delay: delay + 0.12, seatIndex: idx, type: 'board' });
        delay += 0.28;
        scheduledBoard++;
      }
    }

    // Guarantee at least one visible change even if car started completely full or empty
    if (this.boardingEvents.length === 0) {
      this.scheduleSinglePassengerChange();
    }
  }

  private scheduleSinglePassengerChange(): void {
    const occupied = [0, 1, 2, 3].filter((i) => this.seats[i]?.targetPresence === 1);
    const empty = [0, 1, 2, 3].filter((i) => !this.seats[i]);
    if (empty.length > 0 && (occupied.length <= 1 || Math.random() < 0.6)) {
      const pick = empty[Math.floor(Math.random() * empty.length)];
      this.boardingEvents.push({ delay: 0.05, seatIndex: pick, type: 'board' });
    } else if (occupied.length > 1) {
      const pick = occupied[Math.floor(Math.random() * occupied.length)];
      this.boardingEvents.push({ delay: 0.05, seatIndex: pick, type: 'alight' });
    }
  }

  private emitSteamRing(ringIdx: number): void {
    const ringTints = [
      '255, 255, 255',
      '255, 243, 176',
      '196, 236, 255',
      '255, 214, 232',
      '208, 244, 214',
    ];
    const stackWorldX = this.worldX + 118;
    this.smokePuffs.push({
      worldX: stackWorldX,
      y: -174,
      vx: -this.velocity * 0.16 + (Math.random() - 0.5) * 14,
      vy: -(118 + Math.random() * 24),
      radius: 16,
      age: 0,
      maxAge: 2.35,
      tint: ringTints[ringIdx % ringTints.length],
      isRing: true,
    });
  }

  private emitSmoke(isBurst: boolean, scale = 1): void {
    // Smokestack sits forward on the locomotive boiler (relative offset +118 from train center)
    const stackWorldX = this.worldX + 118;
    this.smokePuffs.push({
      worldX: stackWorldX + (Math.random() - 0.5) * 8,
      y: -168, // relative to rail top
      vx: -this.velocity * 0.25 + (Math.random() - 0.5) * 24,
      vy: -(65 + Math.random() * 40) * (isBurst ? 1.3 : 1),
      radius: (14 + Math.random() * 6) * scale,
      age: 0,
      maxAge: 1.8 + Math.random() * 0.6,
      tint: isBurst ? '245, 248, 255' : '232, 238, 246',
    });
  }

  private emitWhistleSteam(): void {
    const whistleWorldX = this.worldX + 36;
    this.smokePuffs.push({
      worldX: whistleWorldX + (Math.random() - 0.5) * 6,
      y: -152,
      vx: -this.velocity * 0.15 + (Math.random() - 0.5) * 35,
      vy: -(130 + Math.random() * 45),
      radius: 9 + Math.random() * 5,
      age: 0,
      maxAge: 0.65,
      tint: '255, 255, 255',
    });
  }

  private spawnBrakeSpark(): void {
    const dir = -Math.sign(this.velocity || 1);
    const wheelOffsets = [-55, 20, 88];
    const wx = wheelOffsets[Math.floor(Math.random() * wheelOffsets.length)];
    this.sparks.push({
      x: wx + (Math.random() - 0.5) * 14,
      y: -6,
      vx: dir * (70 + Math.random() * 110),
      vy: -(40 + Math.random() * 80),
      age: 0,
      maxAge: 0.32 + Math.random() * 0.18,
      color: Math.random() > 0.4 ? '#FFB300' : '#FF5722',
    });
  }

  private spawnColorSparkles(): void {
    const theme = TRAIN_COLORS[this.colorIndex];
    for (let i = 0; i < 18; i++) {
      const angle = (Math.PI * 2 * i) / 18;
      const speed = 90 + Math.random() * 110;
      this.sparks.push({
        x: (Math.random() - 0.5) * 260,
        y: -85 + (Math.random() - 0.5) * 60,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        age: 0,
        maxAge: 0.55 + Math.random() * 0.25,
        color: i % 2 === 0 ? theme.trim : theme.body,
      });
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const railY = Math.round(height * 0.78);
    const trainScreenX = Math.round(width * 0.56);
    const cameraLeftWorld = this.worldX - trainScreenX;

    // Smoothly blend sky & ground palettes across biome boundaries
    const exactSeg = this.worldX / SEGMENT_WIDTH;
    const baseSeg = Math.floor(exactSeg);
    const segFrac = exactSeg - baseSeg;
    // Blend over the final 30% of each segment
    const blendT = segFrac > 0.7 ? (segFrac - 0.7) / 0.3 : 0;
    const palA = BIOME_PALETTES[getBiomeForSegment(baseSeg)];
    const palB = BIOME_PALETTES[getBiomeForSegment(baseSeg + 1)];

    // 1. Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, railY);
    skyGrad.addColorStop(0, lerpRgb(palA.skyTop, palB.skyTop, blendT));
    skyGrad.addColorStop(1, lerpRgb(palA.skyBottom, palB.skyBottom, blendT));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, railY);

    // Friendly warm sun
    this.drawSun(ctx, width * 0.84, height * 0.15);

    // Parallax drifting clouds
    this.drawClouds(ctx, width, height, cameraLeftWorld * 0.18 + this.time * 12);

    // 2. Distant rolling hills (0.35x parallax)
    this.drawFarHills(ctx, width, railY, cameraLeftWorld * 0.35, lerpRgb(palA.farHill, palB.farHill, blendT));

    // 3. Ground strip
    ctx.fillStyle = lerpRgb(palA.ground, palB.ground, blendT);
    ctx.fillRect(0, railY - 26, width, height - (railY - 26));

    // 4. Biome segments along infinite worldX
    const startSeg = Math.floor((cameraLeftWorld - 300) / SEGMENT_WIDTH);
    const endSeg = Math.floor((cameraLeftWorld + width + 300) / SEGMENT_WIDTH);
    for (let seg = startSeg; seg <= endSeg; seg++) {
      const biome = getBiomeForSegment(seg);
      const segScreenX = seg * SEGMENT_WIDTH - cameraLeftWorld;
      this.drawBiomeSegment(ctx, biome, seg, segScreenX, railY);
    }

    // 5. Ballast, wooden sleepers & steel rails
    this.drawTracks(ctx, width, height, railY, cameraLeftWorld);

    // 6. Smoke puffs & buoyant O-shaped Steam Rings (behind/above smokestack in world coordinates)
    for (const p of this.smokePuffs) {
      const sx = p.worldX - cameraLeftWorld;
      const sy = railY + p.y;
      if (p.isRing) {
        const life = Math.max(0, 1 - p.age / p.maxAge);
        const alpha = Math.min(1, life * 1.15) * 0.92;
        const rx = p.radius * 1.25;
        const ry = p.radius * 0.68;
        ctx.save();
        ctx.strokeStyle = `rgba(${p.tint}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(4, 10 * life);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.65).toFixed(3)})`;
        ctx.lineWidth = Math.max(2, 4 * life);
        ctx.beginPath();
        ctx.ellipse(sx, sy - ry * 0.14, rx * 0.9, ry * 0.82, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        const alpha = Math.max(0, 1 - p.age / p.maxAge) * 0.82;
        ctx.fillStyle = `rgba(${p.tint}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Train (Passenger coach + Locomotive in side profile)
    this.drawTrain(ctx, trainScreenX, railY);

    // 8. Brake sparks & paint-change sparkles
    for (const s of this.sparks) {
      const alpha = Math.max(0, 1 - s.age / s.maxAge);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(trainScreenX + s.x, railY + s.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 9. Station arrival confetti celebration!
    for (let idx = 0; idx < this.confetti.length; idx++) {
      const c = this.confetti[idx];
      const fade = c.age > c.maxAge - 0.7 ? Math.max(0, (c.maxAge - c.age) / 0.7) : 1;
      const sx = width * 0.5 + c.offsetX;
      const sy = c.y;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(sx, sy);
      ctx.rotate(c.rotation);
      ctx.fillStyle = c.color;
      if (idx % 5 === 0) {
        // Festive confetti dots
        ctx.beginPath();
        ctx.arc(0, 0, c.h * 0.65, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(1, Math.max(0.32, Math.abs(Math.cos(c.spinPhase))));
        ctx.beginPath();
        ctx.roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 10. Minimal, toddler-friendly visual status pill (biome icon + speedometer bar)
    this.drawTopHud(ctx, width, getBiomeForSegment(Math.floor((this.worldX + 50) / SEGMENT_WIDTH)));
  }

  private drawSun(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const pulse = 1 + Math.sin(this.time * 2) * 0.04;
    const glow = ctx.createRadialGradient(cx, cy, 18, cx, cy, 74 * pulse);
    glow.addColorStop(0, 'rgba(255, 244, 150, 0.95)');
    glow.addColorStop(0.5, 'rgba(255, 230, 110, 0.35)');
    glow.addColorStop(1, 'rgba(255, 230, 110, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 74 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawClouds(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scrollX: number
  ): void {
    const spacing = 360;
    const first = Math.floor((scrollX - 180) / spacing);
    const last = Math.floor((scrollX + width + 180) / spacing);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    for (let i = first; i <= last; i++) {
      const r1 = seededRand(i * 3.1);
      const r2 = seededRand(i * 7.7);
      const cx = i * spacing - scrollX + r1 * 110;
      const cy = height * (0.1 + r2 * 0.18);
      const scale = 0.75 + r1 * 0.55;

      ctx.beginPath();
      ctx.arc(cx, cy, 28 * scale, 0, Math.PI * 2);
      ctx.arc(cx + 26 * scale, cy - 10 * scale, 34 * scale, 0, Math.PI * 2);
      ctx.arc(cx + 58 * scale, cy, 26 * scale, 0, Math.PI * 2);
      ctx.arc(cx + 28 * scale, cy + 8 * scale, 28 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFarHills(
    ctx: CanvasRenderingContext2D,
    width: number,
    railY: number,
    scrollX: number,
    color: string
  ): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, railY);
    for (let sx = 0; sx <= width + 24; sx += 24) {
      const wx = sx + scrollX;
      const h =
        Math.sin(wx * 0.0028) * 38 +
        Math.sin(wx * 0.0067 + 1.3) * 20 +
        72;
      ctx.lineTo(sx, railY - h);
    }
    ctx.lineTo(width, railY);
    ctx.closePath();
    ctx.fill();
  }

  private drawBiomeSegment(
    ctx: CanvasRenderingContext2D,
    biome: BiomeType,
    segIndex: number,
    x0: number,
    railY: number
  ): void {
    const baseY = railY - 22;

    if (biome === 'station') {
      // Paved brick platform
      ctx.fillStyle = '#B0BEC5';
      ctx.fillRect(x0 + 140, baseY - 18, 1220, 22);
      ctx.fillStyle = '#78909C';
      ctx.fillRect(x0 + 140, baseY - 22, 1220, 6);
      // Yellow safety line
      ctx.fillStyle = '#FDD835';
      ctx.fillRect(x0 + 140, baseY - 18, 1220, 4);

      // Charming wooden/brick station depot building
      const bx = x0 + 430;
      ctx.fillStyle = '#F5E6CC';
      ctx.fillRect(bx, baseY - 180, 440, 162);
      // Pitched terracotta roof
      ctx.fillStyle = '#C64838';
      ctx.beginPath();
      ctx.moveTo(bx - 36, baseY - 176);
      ctx.lineTo(bx + 220, baseY - 252);
      ctx.lineTo(bx + 476, baseY - 176);
      ctx.closePath();
      ctx.fill();

      // Platform canopy overhang + pillars
      ctx.fillStyle = '#37474F';
      for (const px of [x0 + 220, x0 + 400, x0 + 900, x0 + 1120]) {
        ctx.fillRect(px, baseY - 148, 12, 130);
      }
      ctx.fillStyle = '#455A64';
      ctx.fillRect(x0 + 180, baseY - 158, 1020, 16);

      // Festive triangular bunting flags along station canopy
      for (let fx = 195; fx < 1185; fx += 34) {
        ctx.fillStyle = CONFETTI_COLORS[Math.floor(fx / 34) % CONFETTI_COLORS.length];
        ctx.beginPath();
        ctx.moveTo(x0 + fx, baseY - 142);
        ctx.lineTo(x0 + fx + 15, baseY - 126);
        ctx.lineTo(x0 + fx + 30, baseY - 142);
        ctx.closePath();
        ctx.fill();
      }

      // Arched windows & station door
      ctx.fillStyle = '#FFF59D';
      for (const wx of [bx + 55, bx + 140, bx + 310, bx + 375]) {
        ctx.fillRect(wx, baseY - 120, 44, 62);
      }
      ctx.fillStyle = '#6D4C41';
      ctx.fillRect(bx + 200, baseY - 115, 56, 97);

      // Station clock on gable
      const clockX = bx + 220;
      const clockY = baseY - 204;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(clockX, clockY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#37474F';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(clockX, clockY);
      ctx.lineTo(clockX, clockY - 13);
      ctx.moveTo(clockX, clockY);
      ctx.lineTo(clockX + 10, clockY + 4);
      ctx.stroke();

      // Friendly waving figures on platform (jump for joy during station celebration!)
      this.drawWaitingPassenger(ctx, x0 + 280, baseY - 18, '#42A5F5', 0);
      this.drawWaitingPassenger(ctx, x0 + 960, baseY - 18, '#AB47BC', 1.6);
      this.drawWaitingPassenger(ctx, x0 + 1085, baseY - 18, '#66BB6A', 3.1);
      this.drawTree(ctx, x0 + 70, baseY, 1.0, 'round');
      this.drawTree(ctx, x0 + 1410, baseY, 1.05, 'round');
      return;
    }

    if (biome === 'cityscape') {
      // Sidewalk strip
      ctx.fillStyle = '#90A4AE';
      ctx.fillRect(x0, baseY - 8, SEGMENT_WIDTH, 10);

      const buildingColors = ['#5C6BC0', '#455A64', '#78909C', '#42A5F5', '#8D6E63', '#546E7A', '#7E57C2'];
      let cursor = 45;
      let idx = 0;
      while (cursor < SEGMENT_WIDTH - 130) {
        const seed = segIndex * 31 + idx * 17;
        const bw = 110 + Math.floor(seededRand(seed) * 75);
        const bh = 180 + Math.floor(seededRand(seed + 2) * 175);
        const color = buildingColors[Math.floor(seededRand(seed + 4) * buildingColors.length)];
        const bx = x0 + cursor;

        // Skyscraper body
        ctx.fillStyle = color;
        ctx.fillRect(bx, baseY - bh, bw, bh - 6);

        // Roof detail
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(bx + 14, baseY - bh - 14, bw - 28, 14);

        // Lit & unlit window grid
        const cols = Math.max(2, Math.floor((bw - 24) / 26));
        const rows = Math.max(3, Math.floor((bh - 40) / 30));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const lit = seededRand(seed + r * 11 + c * 7) > 0.32;
            ctx.fillStyle = lit ? '#FFF59D' : 'rgba(255,255,255,0.25)';
            ctx.fillRect(bx + 16 + c * 26, baseY - bh + 20 + r * 28, 15, 18);
          }
        }

        cursor += bw + 28;
        idx++;
      }
      return;
    }

    if (biome === 'suburbscape') {
      const houseColors = ['#FFCC80', '#90CAF9', '#A5D6A7', '#F48FB1', '#FFF59D', '#CE93D8'];
      const roofColors = ['#D84315', '#455A64', '#6D4C41', '#AD1457', '#283593'];

      for (let i = 0; i < 5; i++) {
        const seed = segIndex * 23 + i * 13;
        const hx = x0 + 90 + i * 285;
        const hw = 132;
        const hh = 96 + Math.floor(seededRand(seed) * 24);

        // White picket fence segment
        ctx.fillStyle = '#FAFAFA';
        ctx.fillRect(hx - 28, baseY - 26, hw + 56, 6);
        for (let f = -26; f < hw + 28; f += 14) {
          ctx.fillRect(hx + f, baseY - 34, 7, 34);
        }

        // Cozy house body
        ctx.fillStyle = houseColors[Math.floor(seededRand(seed + 1) * houseColors.length)];
        ctx.fillRect(hx, baseY - hh, hw, hh);

        // Chimney
        ctx.fillStyle = '#8D6E63';
        ctx.fillRect(hx + hw - 32, baseY - hh - 46, 18, 36);

        // Pitched roof
        ctx.fillStyle = roofColors[Math.floor(seededRand(seed + 2) * roofColors.length)];
        ctx.beginPath();
        ctx.moveTo(hx - 16, baseY - hh);
        ctx.lineTo(hx + hw / 2, baseY - hh - 54);
        ctx.lineTo(hx + hw + 16, baseY - hh);
        ctx.closePath();
        ctx.fill();

        // Door & windows
        ctx.fillStyle = '#5D4037';
        ctx.fillRect(hx + hw / 2 - 14, baseY - 52, 28, 52);
        ctx.fillStyle = '#E1F5FE';
        ctx.fillRect(hx + 16, baseY - hh + 24, 28, 28);
        ctx.fillRect(hx + hw - 44, baseY - hh + 24, 28, 28);

        // Yard tree
        this.drawTree(ctx, hx + hw + 62, baseY, 0.88 + seededRand(seed + 5) * 0.25, 'round');
      }
      return;
    }

    if (biome === 'rural') {
      // Classic countryside: Red barn, silo, spinning windmill, hay bales & friendly cows!
      const barnX = x0 + 360;
      // Silo
      ctx.fillStyle = '#CFD8DC';
      ctx.fillRect(barnX + 195, baseY - 190, 58, 190);
      ctx.fillStyle = '#90A4AE';
      ctx.beginPath();
      ctx.arc(barnX + 224, baseY - 190, 29, Math.PI, 0);
      ctx.fill();

      // Red Barn
      ctx.fillStyle = '#D32F2F';
      ctx.fillRect(barnX, baseY - 135, 190, 135);
      // Gambrel barn roof
      ctx.fillStyle = '#8E1D1D';
      ctx.beginPath();
      ctx.moveTo(barnX - 16, baseY - 135);
      ctx.lineTo(barnX + 35, baseY - 182);
      ctx.lineTo(barnX + 95, baseY - 202);
      ctx.lineTo(barnX + 155, baseY - 182);
      ctx.lineTo(barnX + 206, baseY - 135);
      ctx.closePath();
      ctx.fill();

      // White X barn doors
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.strokeRect(barnX + 58, baseY - 82, 74, 80);
      ctx.beginPath();
      ctx.moveTo(barnX + 58, baseY - 82);
      ctx.lineTo(barnX + 132, baseY - 2);
      ctx.moveTo(barnX + 132, baseY - 82);
      ctx.lineTo(barnX + 58, baseY - 2);
      ctx.stroke();

      // Spinning farm windmill
      const wmX = x0 + 1020;
      ctx.strokeStyle = '#78909C';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(wmX - 28, baseY);
      ctx.lineTo(wmX, baseY - 185);
      ctx.lineTo(wmX + 28, baseY);
      ctx.moveTo(wmX - 18, baseY - 65);
      ctx.lineTo(wmX + 18, baseY - 65);
      ctx.moveTo(wmX - 10, baseY - 125);
      ctx.lineTo(wmX + 10, baseY - 125);
      ctx.stroke();

      ctx.save();
      ctx.translate(wmX, baseY - 185);
      ctx.rotate(this.time * 0.9);
      ctx.fillStyle = '#ECEFF1';
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI / 2);
        ctx.fillRect(-5, -58, 10, 52);
      }
      ctx.fillStyle = '#E53935';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Golden hay bales
      for (const hx of [x0 + 150, x0 + 215, x0 + 1240]) {
        ctx.fillStyle = '#FBC02D';
        ctx.beginPath();
        ctx.arc(hx, baseY - 22, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#F57F17';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(hx, baseY - 22, 11, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Grazing spotted cows
      this.drawCow(ctx, x0 + 730, baseY, false);
      this.drawCow(ctx, x0 + 860, baseY, true);
      this.drawTree(ctx, x0 + 75, baseY, 1.1, 'round');
      this.drawTree(ctx, x0 + 1380, baseY, 0.95, 'round');
      return;
    }

    // rural2: Deep nature — snow-capped mountain peaks, sparkling creek, pine forest
    for (const [mx, mw, mh] of [
      [x0 + 180, 420, 270],
      [x0 + 560, 520, 330],
      [x0 + 1020, 430, 250],
    ]) {
      ctx.fillStyle = '#607D8B';
      ctx.beginPath();
      ctx.moveTo(mx, baseY);
      ctx.lineTo(mx + mw / 2, baseY - mh);
      ctx.lineTo(mx + mw, baseY);
      ctx.closePath();
      ctx.fill();

      // Snow cap
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(mx + mw * 0.34, baseY - mh * 0.68);
      ctx.lineTo(mx + mw / 2, baseY - mh);
      ctx.lineTo(mx + mw * 0.66, baseY - mh * 0.68);
      ctx.lineTo(mx + mw * 0.56, baseY - mh * 0.62);
      ctx.lineTo(mx + mw * 0.45, baseY - mh * 0.66);
      ctx.closePath();
      ctx.fill();
    }

    // Sparkling blue river / lake cove
    ctx.fillStyle = '#29B6F6';
    ctx.beginPath();
    ctx.ellipse(x0 + 760, baseY - 4, 210, 20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tall evergreen pine forest
    for (let i = 0; i < 11; i++) {
      const px = x0 + 60 + i * 135;
      if (px > x0 + 570 && px < x0 + 950) continue; // Leave view open over the river
      const scale = 0.85 + seededRand(segIndex * 19 + i * 7) * 0.45;
      this.drawTree(ctx, px, baseY, scale, 'pine');
    }
  }

  private drawTree(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    scale: number,
    style: 'round' | 'pine'
  ): void {
    ctx.fillStyle = '#6D4C41';
    ctx.fillRect(x - 7 * scale, baseY - 46 * scale, 14 * scale, 46 * scale);

    if (style === 'round') {
      ctx.fillStyle = '#43A047';
      ctx.beginPath();
      ctx.arc(x, baseY - 68 * scale, 34 * scale, 0, Math.PI * 2);
      ctx.arc(x - 22 * scale, baseY - 54 * scale, 24 * scale, 0, Math.PI * 2);
      ctx.arc(x + 22 * scale, baseY - 54 * scale, 24 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#2E7D32';
      for (let tier = 0; tier < 3; tier++) {
        const ty = baseY - (36 + tier * 34) * scale;
        const tw = (42 - tier * 8) * scale;
        ctx.beginPath();
        ctx.moveTo(x - tw, ty);
        ctx.lineTo(x, ty - 52 * scale);
        ctx.lineTo(x + tw, ty);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawWaitingPassenger(
    ctx: CanvasRenderingContext2D,
    x: number,
    groundY: number,
    shirtColor: string,
    phaseOffset: number
  ): void {
    const celebrating = this.stationCelebrationTimer > 0;
    const hop = celebrating
      ? -Math.abs(Math.sin(this.time * 9 + phaseOffset)) * 14
      : 0;
    const gy = groundY + hop;

    // Legs
    ctx.strokeStyle = '#37474F';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 5, gy - 22);
    ctx.lineTo(x - 6, gy);
    ctx.moveTo(x + 5, gy - 22);
    ctx.lineTo(x + 6, gy);
    ctx.stroke();

    // Torso
    ctx.fillStyle = shirtColor;
    ctx.beginPath();
    ctx.roundRect(x - 11, gy - 48, 22, 28, 6);
    ctx.fill();

    // Waving arm(s)!
    const waveSpeed = celebrating ? 11 : 5;
    const wave = Math.sin(this.time * waveSpeed + phaseOffset) * 0.5;
    ctx.save();
    ctx.translate(x + 9, gy - 44);
    ctx.rotate(-0.85 + wave);
    ctx.strokeStyle = shirtColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18, -10);
    ctx.stroke();
    ctx.restore();

    if (celebrating) {
      ctx.save();
      ctx.translate(x - 9, gy - 44);
      ctx.rotate(0.85 - wave);
      ctx.strokeStyle = shirtColor;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-18, -10);
      ctx.stroke();
      ctx.restore();
    }

    // Head
    ctx.fillStyle = '#FFCCBC';
    ctx.beginPath();
    ctx.arc(x, gy - 58, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawCow(
    ctx: CanvasRenderingContext2D,
    x: number,
    groundY: number,
    flip: boolean
  ): void {
    ctx.save();
    ctx.translate(x, groundY);
    if (flip) ctx.scale(-1, 1);

    // Legs
    ctx.fillStyle = '#ECEFF1';
    for (const lx of [-20, -10, 10, 20]) {
      ctx.fillRect(lx - 3, -18, 6, 18);
    }
    // Body
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(-26, -42, 52, 28, 10);
    ctx.fill();
    // Spots
    ctx.fillStyle = '#37474F';
    ctx.beginPath();
    ctx.arc(-8, -30, 8, 0, Math.PI * 2);
    ctx.arc(12, -26, 6, 0, Math.PI * 2);
    ctx.fill();
    // Head
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(20, -48, 20, 18, 6);
    ctx.fill();
    ctx.fillStyle = '#F48FB1';
    ctx.beginPath();
    ctx.roundRect(30, -37, 12, 9, 4);
    ctx.fill();

    ctx.restore();
  }

  private drawTracks(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    railY: number,
    cameraLeftWorld: number
  ): void {
    // Gravel ballast bed
    ctx.fillStyle = '#6D6864';
    ctx.fillRect(0, railY - 4, width, 26);
    ctx.fillStyle = '#534E4A';
    ctx.fillRect(0, railY + 20, width, height - (railY + 20));

    // Wooden sleepers / ties scrolling at 1:1 world speed
    const tieSpacing = 44;
    const firstTie = Math.floor((cameraLeftWorld - 40) / tieSpacing);
    const lastTie = Math.floor((cameraLeftWorld + width + 40) / tieSpacing);

    ctx.fillStyle = '#5D4037';
    for (let t = firstTie; t <= lastTie; t++) {
      const tx = t * tieSpacing - cameraLeftWorld;
      ctx.fillRect(tx - 9, railY + 2, 18, 16);
      ctx.fillStyle = '#795548';
      ctx.fillRect(tx - 9, railY + 2, 18, 4);
      ctx.fillStyle = '#5D4037';
    }

    // Steel rail + bright top sheen
    ctx.fillStyle = '#78909C';
    ctx.fillRect(0, railY - 6, width, 9);
    ctx.fillStyle = '#CFD8DC';
    ctx.fillRect(0, railY - 6, width, 3);
  }

  private drawTrain(ctx: CanvasRenderingContext2D, cx: number, railY: number): void {
    const theme = TRAIN_COLORS[this.colorIndex];
    const popScale =
      this.colorPopTimer > 0
        ? 1 + Math.sin((this.colorPopTimer / 0.55) * Math.PI) * 0.05
        : 1;
    const chugHop =
      this.chugHopTimer > 0
        ? -Math.sin((this.chugHopTimer / 0.28) * Math.PI) * 8
        : 0;
    const engineBounce =
      (this.engineRunning
        ? Math.sin(this.time * (Math.abs(this.velocity) > 15 ? 18 : 7)) * 1.4
        : 0) + chugHop;

    ctx.save();
    ctx.translate(cx, railY);
    ctx.scale(popScale, popScale);

    // --- 1. Roomy Trailing Passenger Coach Car (to the left) ---
    const carX = -376;
    const carW = 256;

    // Heavy coupler bar between passenger coach and locomotive
    ctx.fillStyle = '#37474F';
    ctx.fillRect(carX + carW - 6, -34, 34, 10);

    // Coach body & roof
    ctx.save();
    ctx.translate(0, engineBounce * 0.65);

    // Underframe chassis + boarding steps at both ends
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(carX - 4, -44, carW + 8, 12, 4);
    ctx.fill();
    ctx.fillRect(carX + 2, -32, 18, 12);
    ctx.fillRect(carX + carW - 20, -32, 18, 12);

    // Main painted coach body
    ctx.fillStyle = theme.body;
    ctx.beginPath();
    ctx.roundRect(carX, -142, carW, 102, 14);
    ctx.fill();

    // Raised clerestory roof + overhang
    ctx.fillStyle = theme.dark;
    ctx.beginPath();
    ctx.roundRect(carX + 26, -162, carW - 52, 14, 6);
    ctx.roundRect(carX - 10, -152, carW + 20, 14, 7);
    ctx.fill();

    // Gold trim belt-rail & brass grab handles
    ctx.fillStyle = theme.trim;
    ctx.fillRect(carX + 4, -64, carW - 8, 8);
    ctx.fillRect(carX + 6, -108, 4, 58);
    ctx.fillRect(carX + carW - 10, -108, 4, 58);

    // 4 Large Sunny Coach Windows + Smiling Passenger Faces Getting On & Off!
    const winW = 46;
    const winH = 50;
    const winGap = 14;
    const firstWinX = carX + 20;
    const winY = -124;

    for (let w = 0; w < COACH_WINDOW_COUNT; w++) {
      const wx = firstWinX + w * (winW + winGap);

      // Window frame recess
      ctx.fillStyle = theme.dark;
      ctx.beginPath();
      ctx.roundRect(wx - 3, winY - 3, winW + 6, winH + 6, 10);
      ctx.fill();

      // Warm lit interior glass
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(wx, winY, winW, winH, 8);
      ctx.fillStyle = '#FFF9C4';
      ctx.fill();
      ctx.clip();

      // Draw passenger face if seated or currently boarding/alighting!
      const passenger = this.seats[w];
      if (passenger && passenger.presence > 0.01) {
        this.drawWindowPassenger(ctx, wx + winW / 2, winY + winH, passenger);
      }

      // Subtle window glass reflection highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.beginPath();
      ctx.moveTo(wx + 4, winY);
      ctx.lineTo(wx + 16, winY);
      ctx.lineTo(wx + 4, winY + 26);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();

    // Dual-axle railway bogie trucks (4 coach wheels!)
    ctx.fillStyle = '#263238';
    ctx.fillRect(carX + 24, -26, 68, 8);
    ctx.fillRect(carX + carW - 92, -26, 68, 8);
    for (const cwx of [carX + 36, carX + 80, carX + carW - 80, carX + carW - 36]) {
      this.drawWheel(ctx, cwx, -20, 20, this.wheelPhase * 1.6, theme.trim);
    }

    // --- 2. Main Steam / Classic Locomotive ---
    ctx.save();
    ctx.translate(0, engineBounce);

    // Chassis / running board
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(-95, -42, 260, 16, 5);
    ctx.fill();
    ctx.fillStyle = theme.trim;
    ctx.fillRect(-92, -42, 254, 4);

    // Red/gold cowcatcher on front right
    ctx.fillStyle = theme.dark;
    ctx.beginPath();
    ctx.moveTo(156, -40);
    ctx.lineTo(192, -10);
    ctx.lineTo(156, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.trim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(164, -33);
    ctx.lineTo(180, -12);
    ctx.moveTo(158, -24);
    ctx.lineTo(168, -12);
    ctx.stroke();

    // Cylindrical Boiler
    ctx.fillStyle = theme.body;
    ctx.beginPath();
    ctx.roundRect(10, -118, 146, 78, [0, 18, 10, 0]);
    ctx.fill();

    // Dark front smokebox nose
    ctx.fillStyle = '#37474F';
    ctx.beginPath();
    ctx.roundRect(124, -118, 34, 78, [0, 18, 8, 0]);
    ctx.fill();

    // Decorative brass bands on boiler
    ctx.fillStyle = theme.trim;
    ctx.fillRect(48, -118, 7, 78);
    ctx.fillRect(96, -118, 7, 78);

    // Smokestack
    ctx.fillStyle = '#263238';
    ctx.fillRect(106, -162, 24, 46);
    ctx.beginPath();
    ctx.moveTo(98, -162);
    ctx.lineTo(138, -162);
    ctx.lineTo(132, -148);
    ctx.lineTo(104, -148);
    ctx.closePath();
    ctx.fill();

    // Steam dome & Brass Whistle (pops up when horn is pressed!)
    ctx.fillStyle = theme.dark;
    ctx.beginPath();
    ctx.arc(72, -118, 18, Math.PI, 0);
    ctx.fill();

    // Swinging Brass Locomotive Bell (rings & swings every time Green button is pressed!)
    ctx.save();
    ctx.translate(72, -142);
    // Iron bell yoke posts
    ctx.strokeStyle = '#37474F';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-9, 10);
    ctx.lineTo(-9, -2);
    ctx.lineTo(9, -2);
    ctx.lineTo(9, 10);
    ctx.stroke();

    const bellAngle =
      this.bellSwingTimer > 0
        ? Math.sin(this.time * 28) * 0.58 * (this.bellSwingTimer / 0.8)
        : 0;
    ctx.save();
    ctx.rotate(bellAngle);
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.moveTo(-5, -1);
    ctx.lineTo(5, -1);
    ctx.lineTo(9, 11);
    ctx.lineTo(-9, 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#F57F17';
    ctx.beginPath();
    ctx.arc(0, 12, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (this.bellSwingTimer > 0.15) {
      const ringAlpha = Math.min(1, this.bellSwingTimer * 1.4);
      ctx.strokeStyle = `rgba(255, 241, 118, ${ringAlpha.toFixed(2)})`;
      ctx.lineWidth = 2.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * 12, 3, 8, side > 0 ? -0.7 : Math.PI - 0.7, side > 0 ? 0.7 : Math.PI + 0.7);
        ctx.stroke();
      }
    }
    ctx.restore();

    const whistleLift = this.hornActive ? -5 : 0;
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(31, -142 + whistleLift, 10, 24 - whistleLift);
    ctx.fillRect(28, -146 + whistleLift, 16, 6);

    // Engineer Cab
    ctx.fillStyle = theme.cab;
    ctx.beginPath();
    ctx.roundRect(-88, -152, 104, 112, [10, 10, 0, 0]);
    ctx.fill();

    // Cab Roof
    ctx.fillStyle = theme.dark;
    ctx.beginPath();
    ctx.roundRect(-98, -162, 122, 14, 7);
    ctx.fill();

    // Cab Window + Smiling Engineer inside
    ctx.fillStyle = '#E1F5FE';
    ctx.beginPath();
    ctx.roundRect(-66, -136, 60, 48, 8);
    ctx.fill();

    // Engineer face & striped cap
    ctx.fillStyle = '#FFCCBC';
    ctx.beginPath();
    ctx.arc(-36, -106, 13, 0, Math.PI * 2);
    ctx.fill();
    // Cap
    ctx.fillStyle = '#1E88E5';
    ctx.beginPath();
    ctx.arc(-36, -112, 13, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-36, -114, 19, 4);
    // Smile & eye
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(-31, -107, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-32, -103, 5, 0.1, Math.PI * 0.8);
    ctx.stroke();

    // Warm Headlamp + glowing light cone when engine is running!
    ctx.fillStyle = '#263238';
    ctx.fillRect(154, -104, 12, 22);
    ctx.fillStyle = this.engineRunning ? '#FFF176' : '#90A4AE';
    ctx.beginPath();
    ctx.arc(166, -93, 9, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    if (this.engineRunning) {
      const beam = ctx.createLinearGradient(168, -93, 390, -40);
      beam.addColorStop(0, 'rgba(255, 249, 170, 0.52)');
      beam.addColorStop(1, 'rgba(255, 249, 170, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(168, -101);
      ctx.lineTo(395, -145);
      ctx.lineTo(395, -12);
      ctx.lineTo(168, -85);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore(); // end engineBounce

    // Drive Wheels (3 big spoked wheels + animated coupling rod!)
    const driveWheelX = [-56, 18, 92];
    for (const wx of driveWheelX) {
      this.drawWheel(ctx, wx, -32, 32, this.wheelPhase, theme.body);
    }
    // Front pilot wheel
    this.drawWheel(ctx, 142, -18, 18, this.wheelPhase * 1.75, theme.dark);

    // Coupling rod connecting the 3 drive wheels
    const crankR = 15;
    const rodX = Math.cos(this.wheelPhase) * crankR;
    const rodY = Math.sin(this.wheelPhase) * crankR;
    ctx.strokeStyle = '#ECEFF1';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(driveWheelX[0] + rodX, -32 + rodY);
    ctx.lineTo(driveWheelX[2] + rodX, -32 + rodY);
    ctx.stroke();

    for (const wx of driveWheelX) {
      ctx.fillStyle = '#FFD54F';
      ctx.beginPath();
      ctx.arc(wx + rodX, -32 + rodY, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Red brake shoe indicator glow when braking
    if (this.brakingActive) {
      ctx.fillStyle = 'rgba(244, 67, 54, 0.85)';
      for (const wx of driveWheelX) {
        ctx.fillRect(wx - 28, -22, 10, 14);
      }
    }

    ctx.restore();
  }

  private drawWindowPassenger(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    sillY: number,
    p: Passenger
  ): void {
    // Smoothly slide passenger up from below window sill when boarding & down when getting off
    const slideOffset = (1 - p.presence) * 46;
    const rideBob =
      Math.abs(this.velocity) > 15
        ? Math.sin(this.time * 12 + p.bobPhase) * 1.3
        : this.stationCelebrationTimer > 0
          ? -Math.abs(Math.sin(this.time * 8 + p.bobPhase)) * 3.5
          : 0;

    ctx.save();
    ctx.translate(centerX, sillY + slideOffset + rideBob);

    // Shirt / shoulders
    ctx.fillStyle = p.shirtColor;
    ctx.beginPath();
    ctx.roundRect(-15, -14, 30, 18, [10, 10, 0, 0]);
    ctx.fill();

    // Smiling head
    ctx.fillStyle = p.skinColor;
    ctx.beginPath();
    ctx.arc(0, -25, 11.5, 0, Math.PI * 2);
    ctx.fill();

    // Rosy cheeks
    ctx.fillStyle = 'rgba(244, 143, 177, 0.45)';
    ctx.beginPath();
    ctx.arc(-6.5, -23, 2.5, 0, Math.PI * 2);
    ctx.arc(6.5, -23, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Eyes & cheerful smile
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(-4, -26.5, 1.8, 0, Math.PI * 2);
    ctx.arc(4, -26.5, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -23.5, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // Hair / Hat variety so kids notice different passengers!
    if (p.accessory === 'cap') {
      ctx.fillStyle = p.shirtColor;
      ctx.beginPath();
      ctx.arc(0, -29, 11.5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(0, -31, 16, 3.5);
    } else if (p.accessory === 'beanie') {
      ctx.fillStyle = '#EF5350';
      ctx.beginPath();
      ctx.arc(0, -29, 11.8, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#FFF59D';
      ctx.beginPath();
      ctx.arc(0, -42, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.accessory === 'curly') {
      ctx.fillStyle = p.hairColor;
      for (const [hx, hy, hr] of [
        [-9, -32, 5.5],
        [-3, -36, 6],
        [4, -36, 6],
        [9, -32, 5.5],
      ]) {
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = p.hairColor;
      ctx.beginPath();
      ctx.arc(0, -28.5, 11.8, Math.PI * 0.92, Math.PI * 0.08);
      ctx.fill();

      if (p.accessory === 'bow') {
        ctx.fillStyle = '#FF4081';
        ctx.beginPath();
        ctx.arc(-7, -36, 3.8, 0, Math.PI * 2);
        ctx.arc(-1, -36, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawWheel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    angle: number,
    hubColor: string
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Steel rim
    ctx.fillStyle = '#37474F';
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Inner painted wheel & spokes
    ctx.fillStyle = hubColor;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2.5;
    for (let s = 0; s < 6; s++) {
      const a = (Math.PI * s) / 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (radius - 6), Math.sin(a) * (radius - 6));
      ctx.stroke();
    }

    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawTopHud(
    ctx: CanvasRenderingContext2D,
    width: number,
    biome: BiomeType
  ): void {
    const biomeLabels: Record<BiomeType, string> = {
      station: 'Train Station',
      cityscape: 'Big City',
      suburbscape: 'Neighborhood',
      rural: 'Countryside Farm',
      rural2: 'Mountain Forest',
    };

    const pillW = 280;
    const pillH = 48;
    const px = width / 2 - pillW / 2;
    const py = 16;

    ctx.fillStyle = 'rgba(20, 25, 38, 0.58)';
    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, 24);
    ctx.fill();

    // Engine status LED dot
    ctx.fillStyle = this.engineRunning ? '#4CAF50' : '#90A4AE';
    ctx.beginPath();
    ctx.arc(px + 24, py + 24, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(biomeLabels[biome], px + 44, py + 18);

    // Visual speed meter bar
    const speedRatio = Math.min(1, Math.abs(this.velocity) / this.maxForwardSpeed);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.roundRect(px + 44, py + 33, pillW - 64, 7, 4);
    ctx.fill();

    if (speedRatio > 0.01) {
      ctx.fillStyle = this.brakingActive ? '#FF5252' : '#FFD54F';
      ctx.beginPath();
      ctx.roundRect(px + 44, py + 33, (pillW - 64) * speedRatio, 7, 4);
      ctx.fill();
    }
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const trainGameDefinition: ArcadeGameDefinition<TrainAction> = {
  id: 'train',
  title: 'Choo-Choo Train',
  subtitle: 'Drive through stations, cities & farms!',
  accentColor: '#E53935',
  developmental: {
    parentCategory: 'Motion & Space',
    primaryTags: ['A1', 'C1'],
    secondaryTags: ['D1'],
  },
  controls: [
    { action: 'chugBell', button: 'GREEN', label: 'Chug & Bell', icon: 'bubbles' },
    { action: 'horn', button: 'YELLOW', label: 'Whistle', icon: 'horn' },
    { action: 'brake', button: 'RED', label: 'Brakes', icon: 'brake' },
    { action: 'cycleColor', button: 'BLUE', label: 'Paint', icon: 'palette' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    // Sky
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#5CB8FA');
    grad.addColorStop(0.72, '#D4F0FF');
    grad.addColorStop(0.72, '#7CB342');
    grad.addColorStop(1, '#558B2F');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Hills
    ctx.fillStyle = '#8BC34A';
    ctx.beginPath();
    ctx.arc(width * 0.25, height * 0.74, width * 0.32, Math.PI, 0);
    ctx.arc(width * 0.78, height * 0.74, width * 0.36, Math.PI, 0);
    ctx.fill();

    // Tracks
    const ry = height * 0.78;
    ctx.fillStyle = '#5D4037';
    for (let x = 8; x < width; x += 26) {
      ctx.fillRect(x, ry, 12, 10);
    }
    ctx.fillStyle = '#CFD8DC';
    ctx.fillRect(0, ry - 4, width, 5);

    // Animated steam puffs
    const bounce = selected ? Math.sin(timeSec * 8) * 2.5 : 0;
    for (let i = 0; i < 3; i++) {
      const t = (timeSec * 0.9 + i * 0.33) % 1;
      ctx.fillStyle = `rgba(255,255,255,${(1 - t) * 0.85})`;
      ctx.beginPath();
      ctx.arc(
        width * 0.65 - t * 48,
        ry - 96 - t * 46,
        12 + t * 18,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Mini charming red locomotive
    const lx = width * 0.26;
    const ly = ry - 6 + bounce;
    ctx.fillStyle = '#C62828';
    ctx.beginPath();
    ctx.roundRect(lx, ly - 88, 66, 66, 8);
    ctx.fill();
    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.roundRect(lx + 58, ly - 66, 86, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.fillRect(lx + 114, ly - 92, 16, 28);
    ctx.fillStyle = '#E1F5FE';
    ctx.beginPath();
    ctx.roundRect(lx + 14, ly - 76, 36, 28, 6);
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(lx + 4, ly - 24, 142, 6);

    // Cowcatcher
    ctx.fillStyle = '#B71C1C';
    ctx.beginPath();
    ctx.moveTo(lx + 142, ly - 24);
    ctx.lineTo(lx + 162, ly - 4);
    ctx.lineTo(lx + 142, ly - 4);
    ctx.closePath();
    ctx.fill();

    // Wheels
    for (const wx of [lx + 24, lx + 72, lx + 116]) {
      ctx.fillStyle = '#37474F';
      ctx.beginPath();
      ctx.arc(wx, ly - 12, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFD54F';
      ctx.beginPath();
      ctx.arc(wx, ly - 12, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  create(context) {
    return new TrainGame(context);
  },
};
