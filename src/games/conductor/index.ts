import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  CabinetButton,
  ControlIcon,
  GameContext,
  GameInput,
} from '../../core/types';

export type ConductorAction =
  | 'switchPort'
  | 'switchStraight'
  | 'switchStarboard'
  | 'horn';

type BranchDir = 'left' | 'straight' | 'right';
type SceneryZone = 'farm' | 'desert' | 'snow' | 'bridge' | 'forest';

interface ZonePalette {
  name: string;
  shortTag: string;
  skyTop: [number, number, number];
  skyBottom: [number, number, number];
  mountain: [number, number, number];
  groundNear: [number, number, number];
  groundFar: [number, number, number];
  patchColor: string;
}

const ZONE_PALETTES: Record<SceneryZone, ZonePalette> = {
  farm: {
    name: 'Red Barn Farm',
    shortTag: 'FARM',
    skyTop: [92, 178, 248],
    skyBottom: [206, 238, 255],
    mountain: [132, 188, 142],
    groundNear: [108, 178, 86],
    groundFar: [144, 204, 122],
    patchColor: '#7CB342',
  },
  desert: {
    name: 'Desert Canyon',
    shortTag: 'DESERT',
    skyTop: [86, 166, 244],
    skyBottom: [255, 224, 182],
    mountain: [198, 106, 74],
    groundNear: [218, 152, 94],
    groundFar: [238, 188, 128],
    patchColor: '#E6A15C',
  },
  snow: {
    name: 'Snowy Peaks',
    shortTag: 'SNOW',
    skyTop: [98, 162, 230],
    skyBottom: [228, 242, 255],
    mountain: [154, 184, 214],
    groundNear: [220, 236, 248],
    groundFar: [242, 248, 255],
    patchColor: '#E3F2FD',
  },
  bridge: {
    name: 'Lake Bridge',
    shortTag: 'BRIDGE',
    skyTop: [78, 172, 246],
    skyBottom: [204, 240, 252],
    mountain: [108, 172, 168],
    groundNear: [52, 164, 214],
    groundFar: [108, 198, 236],
    patchColor: '#29B6F6',
  },
  forest: {
    name: 'Pine Tunnel',
    shortTag: 'TUNNEL',
    skyTop: [76, 156, 228],
    skyBottom: [194, 226, 242],
    mountain: [92, 138, 132],
    groundNear: [74, 142, 84],
    groundFar: [108, 168, 114],
    patchColor: '#43A047',
  },
};

const ALL_ZONES: SceneryZone[] = ['farm', 'desert', 'snow', 'bridge', 'forest'];

interface TrackFork {
  index: number;
  worldZ: number;
  /** Continuous world X where this fork's trunk begins (matches end of previous fork's chosen branch!) */
  baseWorldX: number;
  hasStraight: boolean;
  selectedBranch: BranchDir;
  branchZones: Record<BranchDir, SceneryZone>;
  zoneBeforeFork: SceneryZone;
}

interface CabSmokePuff {
  worldX: number;
  y: number;
  worldZ: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
  maxAge: number;
}

interface FireEmber {
  nx: number;
  ny: number;
  vy: number;
  size: number;
  age: number;
  maxAge: number;
}

const FIRST_FORK_Z = 920;
const FORK_SPACING = 2150; // ~7 seconds apart at cruising speed
const TURN_LEN = 840; // Smooth S-curve turnout length past the switch frog
const LANE_SPREAD = 840; // World-space lateral separation between adjacent branches
const Z_FAR = 1760;
const FOCAL = 210;

function seededRand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function smoothstepDeriv(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return 6 * t * (1 - t);
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

function branchDirSign(b: BranchDir): number {
  return b === 'left' ? -1 : b === 'right' ? 1 : 0;
}

class ConductorCabGame implements ArcadeGameInstance<ConductorAction> {
  private audio: GameContext['audio'];

  // Physics (same coasting inertia feel as Choo-Choo Train)
  private trackDist = 0;
  private velocity = 0;
  private readonly maxForwardSpeed = 300;
  private readonly maxReverseSpeed = 150;
  private readonly thrustAccel = 175;
  private readonly coastDrag = 24;

  // Continuous railroad network state
  private forks = new Map<number, TrackFork>();

  // Conductor character mirror-action state
  private conductorSignal: BranchDir = 'right';
  private signalWaveTimer = 0;
  private hornActive = false;
  private whistleCordPull = 0;
  private lastCrossedForkIdx = -1;

  // Instruments & firebox state
  private throttleLeverSmoothed = 0;
  private fireIntensity = 0.35;
  private steamPressure = 0.72;
  private embers: FireEmber[] = [];

  // Smoke & chug timing
  private time = 0;
  private chugAccum = 0;
  private chugStep = 0;
  private idleSmokeTimer = 0;
  private whistlePuffTimer = 0;
  private smokePuffs: CabSmokePuff[] = [];

  constructor(context: GameContext) {
    this.audio = context.audio;
    const f0 = this.getOrCreateFork(0);
    this.conductorSignal = f0.selectedBranch;
  }

  /**
   * Builds fork `index` deterministically, chaining its trunk `baseWorldX` and starting scenery
   * from the chosen branch of fork `index - 1` so the entire infinite track is C1-continuous!
   */
  private getOrCreateFork(index: number): TrackFork {
    const existing = this.forks.get(index);
    if (existing) return existing;

    let baseWorldX = 0;
    let zoneBeforeFork: SceneryZone = 'farm';

    if (index > 0) {
      const prev = this.getOrCreateFork(index - 1);
      baseWorldX = this.evalForkBranchX(prev, prev.selectedBranch, prev.worldZ + TURN_LEN);
      zoneBeforeFork = prev.branchZones[prev.selectedBranch];
    }

    const worldZ = FIRST_FORK_Z + index * FORK_SPACING;
    // Alternate 3-way (Port / Ahead / Starboard) and 2-way (Port / Starboard) forks!
    const hasStraight = index % 2 === 0;
    const defaultBranch: BranchDir = hasStraight
      ? index % 4 === 0
        ? 'right'
        : 'straight'
      : index % 3 === 0
        ? 'left'
        : 'right';

    // Pick 3 distinct destination zones (preferring zones different from current zoneBeforeFork!)
    const candidates = ALL_ZONES.filter((z) => z !== zoneBeforeFork);
    const rot = (index * 2) % candidates.length;
    const zLeft = candidates[rot % candidates.length];
    const zRight = candidates[(rot + 1) % candidates.length];
    const zStraight = candidates[(rot + 2) % candidates.length];

    const created: TrackFork = {
      index,
      worldZ,
      baseWorldX,
      hasStraight,
      selectedBranch: defaultBranch,
      branchZones: {
        left: zLeft,
        straight: zStraight,
        right: zRight,
      },
      zoneBeforeFork,
    };
    this.forks.set(index, created);
    return created;
  }

  /** Recomputes downstream forks if a fork's selectedBranch changes before we pass it */
  private invalidateDownstreamForks(fromIndex: number): void {
    for (const key of [...this.forks.keys()]) {
      if (key > fromIndex) {
        this.forks.delete(key);
      }
    }
  }

  /** World lateral X of `branch` on `fork` at absolute `worldZ` */
  private evalForkBranchX(fork: TrackFork, branch: BranchDir, worldZ: number): number {
    if (worldZ <= fork.worldZ) return fork.baseWorldX;
    const u = worldZ - fork.worldZ;
    const t = clamp01(u / TURN_LEN);
    return fork.baseWorldX + branchDirSign(branch) * LANE_SPREAD * smoothstep(t);
  }

  /** Slope dx/dz of `branch` on `fork` at absolute `worldZ` */
  private evalForkBranchSlope(fork: TrackFork, branch: BranchDir, worldZ: number): number {
    if (worldZ <= fork.worldZ || worldZ >= fork.worldZ + TURN_LEN) return 0;
    const t = (worldZ - fork.worldZ) / TURN_LEN;
    return (branchDirSign(branch) * LANE_SPREAD * smoothstepDeriv(t)) / TURN_LEN;
  }

  /** Evaluates the active chosen track's world X and heading slope at any `worldZ` */
  private evalActiveTrackPose(worldZ: number): { x: number; slope: number } {
    if (worldZ <= FIRST_FORK_Z) {
      return { x: 0, slope: 0 };
    }
    const idx = Math.max(0, Math.floor((worldZ - FIRST_FORK_Z) / FORK_SPACING));
    const fork = this.getOrCreateFork(idx);
    return {
      x: this.evalForkBranchX(fork, fork.selectedBranch, worldZ),
      slope: this.evalForkBranchSlope(fork, fork.selectedBranch, worldZ),
    };
  }

  /** Returns the next fork ahead of the cab (where switch buttons still apply!) */
  private getUpcomingSwitchableFork(): TrackFork {
    // Allow switching right up until the locomotive nose reaches the switch frog
    const idx = Math.max(0, Math.ceil((this.trackDist - FIRST_FORK_Z) / FORK_SPACING));
    const f = this.getOrCreateFork(idx);
    if (f.worldZ < this.trackDist) {
      return this.getOrCreateFork(idx + 1);
    }
    return f;
  }

  /** Computes current ambient scenery blend based on exact position through the latest fork */
  private getCurrentSceneryBlend(): {
    fromZone: SceneryZone;
    toZone: SceneryZone;
    blend: number;
  } {
    if (this.trackDist < FIRST_FORK_Z) {
      return { fromZone: 'farm', toZone: 'farm', blend: 1 };
    }
    const idx = Math.max(0, Math.floor((this.trackDist - FIRST_FORK_Z) / FORK_SPACING));
    const fork = this.getOrCreateFork(idx);
    const chosenZone = fork.branchZones[fork.selectedBranch];
    // Smoothly blend scenery over u = [0 .. TURN_LEN] as the train curves onto the branch!
    const blend = smoothstep((this.trackDist - fork.worldZ) / TURN_LEN);
    return {
      fromZone: fork.zoneBeforeFork,
      toZone: chosenZone,
      blend,
    };
  }

  public update(dt: number, input: GameInput<ConductorAction>): void {
    this.time += dt;
    if (this.signalWaveTimer > 0) {
      this.signalWaveTimer = Math.max(0, this.signalWaveTimer - dt);
    }

    const upcomingFork = this.getUpcomingSwitchableFork();

    // 1. Track Switch Buttons: Red = Port (Left), Blue = Straight Ahead, Green = Starboard (Right)
    if (input.justPressed('switchPort')) {
      this.setSwitchSelection(upcomingFork, 'left');
    } else if (input.justPressed('switchStarboard')) {
      this.setSwitchSelection(upcomingFork, 'right');
    } else if (input.justPressed('switchStraight')) {
      if (upcomingFork.hasStraight) {
        this.setSwitchSelection(upcomingFork, 'straight');
      } else {
        this.conductorSignal = 'straight';
        this.signalWaveTimer = 1.4;
        this.audio.playMenuMove();
      }
    }

    // 2. Yellow Button: Steam Whistle + Overhead Pull-Cord!
    if (input.isDown('horn')) {
      if (!this.hornActive) {
        this.hornActive = true;
        this.audio.startTrainHorn();
      }
      this.whistleCordPull = lerp(this.whistleCordPull, 1, Math.min(1, dt * 16));
      this.steamPressure = Math.max(0.52, this.steamPressure - dt * 0.08);
      this.whistlePuffTimer -= dt;
      if (this.whistlePuffTimer <= 0) {
        this.whistlePuffTimer = 0.08;
        this.emitBoilerSmoke(true);
      }
    } else {
      if (this.hornActive) {
        this.hornActive = false;
        this.audio.stopTrainHorn();
      }
      this.whistleCordPull = lerp(this.whistleCordPull, 0, Math.min(1, dt * 12));
    }

    // 3. Joystick Up = Forward (axisY < 0), Joystick Down/Back = Reverse (axisY > 0)
    const throttle = -input.axisY;
    this.throttleLeverSmoothed = lerp(
      this.throttleLeverSmoothed,
      Math.abs(throttle) > 0.1 ? throttle : (this.velocity / this.maxForwardSpeed) * 0.45,
      Math.min(1, dt * 10)
    );

    if (Math.abs(throttle) > 0.12) {
      this.velocity += throttle * this.thrustAccel * dt;
      this.velocity = Math.max(
        -this.maxReverseSpeed,
        Math.min(this.maxForwardSpeed, this.velocity)
      );
    } else if (Math.abs(this.velocity) > 0) {
      const sign = Math.sign(this.velocity);
      const nextVel = this.velocity - sign * this.coastDrag * dt;
      this.velocity = Math.sign(nextVel) !== sign ? 0 : nextVel;
    }

    const prevDist = this.trackDist;
    this.trackDist = Math.max(0, this.trackDist + this.velocity * dt);
    const deltaDist = this.trackDist - prevDist;

    // Play a pleasant switch-points chime as we cross onto the chosen branch
    const currentForkIdx =
      this.trackDist >= FIRST_FORK_Z
        ? Math.floor((this.trackDist - FIRST_FORK_Z) / FORK_SPACING)
        : -1;
    if (currentForkIdx > this.lastCrossedForkIdx && this.velocity > 0) {
      this.lastCrossedForkIdx = currentForkIdx;
      const crossed = this.getOrCreateFork(currentForkIdx);
      this.conductorSignal = crossed.selectedBranch;
      this.signalWaveTimer = 1.8;
      this.audio.playStageComplete(false);
    } else if (currentForkIdx < this.lastCrossedForkIdx) {
      this.lastCrossedForkIdx = currentForkIdx;
    }

    // Keep Conductor's flag synced to the upcoming visible fork once past any previous turn!
    const nextFork = this.getUpcomingSwitchableFork();
    const distToNext = nextFork.worldZ - this.trackDist;
    if (distToNext > 0 && distToNext < Z_FAR && this.signalWaveTimer <= 0) {
      this.conductorSignal = nextFork.selectedBranch;
    }

    // Firebox intensity & embers scale with speed + throttle!
    const speedRatio = Math.abs(this.velocity) / this.maxForwardSpeed;
    const targetFire =
      0.28 + speedRatio * 0.52 + (throttle > 0.1 ? throttle * 0.25 : 0);
    this.fireIntensity = lerp(this.fireIntensity, Math.min(1, targetFire), Math.min(1, dt * 4));
    this.steamPressure = lerp(
      this.steamPressure,
      0.65 + this.fireIntensity * 0.28,
      Math.min(1, dt * 2)
    );

    if (Math.random() < dt * (8 + this.fireIntensity * 26)) {
      this.embers.push({
        nx: (Math.random() - 0.5) * 1.5,
        ny: 0.05,
        vy: 0.55 + Math.random() * 0.9 * (0.5 + this.fireIntensity),
        size: 2 + Math.random() * 3.5,
        age: 0,
        maxAge: 0.55 + Math.random() * 0.45,
      });
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const em = this.embers[i];
      em.age += dt;
      em.ny += em.vy * dt;
      em.nx += Math.sin(this.time * 9 + i) * 0.35 * dt;
      if (em.age >= em.maxAge || em.ny >= 0.98) {
        this.embers.splice(i, 1);
      }
    }

    // Rhythmic chugs & 3D boiler smoke puffs in world coordinates
    this.chugAccum += Math.abs(deltaDist);
    if (this.chugAccum >= 62) {
      this.chugAccum %= 62;
      this.chugStep = (this.chugStep + 1) % 4;
      this.audio.playTrainChug(speedRatio, this.chugStep === 0);
      this.emitBoilerSmoke(false);
    }

    if (Math.abs(this.velocity) < 12) {
      this.idleSmokeTimer -= dt;
      if (this.idleSmokeTimer <= 0) {
        this.idleSmokeTimer = 0.95;
        this.emitBoilerSmoke(false);
      }
    }

    for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
      const p = this.smokePuffs[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.smokePuffs.splice(i, 1);
        continue;
      }
      p.worldX += p.vx * dt;
      p.y += p.vy * dt;
      p.radius += 18 * dt;
    }
  }

  private setSwitchSelection(fork: TrackFork, branch: BranchDir): void {
    fork.selectedBranch = branch;
    this.invalidateDownstreamForks(fork.index);
    this.conductorSignal = branch;
    this.signalWaveTimer = 2.2;
    this.audio.playTrackSwitch(branch);
  }

  private emitBoilerSmoke(isWhistle: boolean): void {
    const forwardZ = this.trackDist + (isWhistle ? 105 : 210);
    const pose = this.evalActiveTrackPose(forwardZ);
    this.smokePuffs.push({
      worldX: pose.x + (Math.random() - 0.5) * 12,
      y: isWhistle ? 24 : 52,
      worldZ: forwardZ,
      vx: (Math.random() - 0.5) * 22,
      vy: isWhistle ? 95 + Math.random() * 35 : 52 + Math.random() * 26,
      radius: isWhistle ? 8 : 13,
      age: 0,
      maxAge: isWhistle ? 0.65 : 1.55,
    });
  }

  /**
   * Projects any world point `(worldX, worldZ)` into cab windshield coordinates,
   * anchored continuously to the locomotive's exact `(trainX, trackDist)` and `trainSlope`!
   */
  private projectWorld(
    worldX: number,
    worldZ: number,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): { sx: number; sy: number; scale: number; z: number } {
    const z = worldZ - this.trackDist;
    const scale = FOCAL / (FOCAL + Math.max(1, z));
    const relX = (worldX - trainPose.x) - trainPose.slope * z;
    const sx = centerX + relX * scale;
    const sy = horizonY + (trackBaseY - horizonY) * scale;
    return { sx, sy, scale, z };
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const horizonY = Math.round(height * 0.29);
    const dashTopY = Math.round(height * 0.63);
    const trackBaseY = Math.round(height * 0.66);
    const centerX = width * 0.5;

    const trainPose = this.evalActiveTrackPose(this.trackDist);
    const { fromZone, toZone, blend } = this.getCurrentSceneryBlend();
    const palA = ZONE_PALETTES[fromZone];
    const palB = ZONE_PALETTES[toZone];

    // 1. Exterior Sky, Sun, Clouds & Horizon Mountains (panning smoothly with locomotive heading!)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, lerpRgb(palA.skyTop, palB.skyTop, blend));
    skyGrad.addColorStop(1, lerpRgb(palA.skyBottom, palB.skyBottom, blend));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, horizonY + 2);

    // Vanishing point shifts horizontally by -trainPose.slope * FOCAL as train turns!
    const horizonPanPx = trainPose.x * 0.28 + trainPose.slope * FOCAL;
    this.drawExteriorHorizon(
      ctx,
      width,
      horizonY,
      horizonPanPx,
      lerpRgb(palA.mountain, palB.mountain, blend)
    );

    // 2. Base Perspective Ground Plane
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, dashTopY);
    groundGrad.addColorStop(0, lerpRgb(palA.groundFar, palB.groundFar, blend));
    groundGrad.addColorStop(1, lerpRgb(palA.groundNear, palB.groundNear, blend));
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, width, dashTopY - horizonY + 12);

    // Gather all forks whose trunk/branches overlap [trackDist - TURN_LEN, trackDist + Z_FAR]
    const visibleForks: TrackFork[] = [];
    const minForkIdx = Math.max(
      0,
      Math.floor((this.trackDist - TURN_LEN - FIRST_FORK_Z) / FORK_SPACING)
    );
    const maxForkIdx = Math.max(
      0,
      Math.floor((this.trackDist + Z_FAR - FIRST_FORK_Z) / FORK_SPACING)
    );
    for (let idx = minForkIdx; idx <= maxForkIdx; idx++) {
      visibleForks.push(this.getOrCreateFork(idx));
    }

    // 3. Destination Scenery Ground Carpets under each fork branch (so desert/snow/lake shows ahead!)
    for (const fk of visibleForks) {
      this.drawBranchDestinationPatches(
        ctx,
        fk,
        trainPose,
        centerX,
        horizonY,
        trackBaseY
      );
    }

    // 4. Continuous Track Network (including unchosen branches peeling away in our periphery!)
    this.drawContinuousTracks(
      ctx,
      visibleForks,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );

    // 5. Roadside Scenery Props & Big Destination Landmarks on Every Branch (sorted back-to-front!)
    this.drawSceneryAndBranchLandmarks(
      ctx,
      visibleForks,
      blend > 0.5 ? toZone : fromZone,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );

    // 6. Foreshortened Boiler Nose & 3D Smoke Puffs
    this.drawBoilerNoseAndSmoke(
      ctx,
      trainPose,
      centerX,
      horizonY,
      trackBaseY,
      dashTopY
    );

    // 7. Floating Switch Control Button Badges + Destination Names Ahead of Upcoming Fork!
    // Hide the next fork's floating badges while driving underground inside a tunnel.
    const inTunnel = visibleForks.some(
      (fk) =>
        fk.branchZones[fk.selectedBranch] === 'forest' &&
        this.trackDist > fk.worldZ + 480 &&
        this.trackDist < fk.worldZ + 1380
    );
    const upcomingFork = this.getUpcomingSwitchableFork();
    const forkRelZ = upcomingFork.worldZ - this.trackDist;
    if (!inTunnel && forkRelZ > 30 && forkRelZ < 1040) {
      this.drawForkSwitchSigns(
        ctx,
        width,
        centerX,
        horizonY,
        trackBaseY,
        trainPose,
        upcomingFork,
        forkRelZ
      );
    }

    // 8. Cab Frame, Whistle Cord, Dashboard, Firebox, Gauges & Conductor Mirror Character!
    this.drawCabInterior(
      ctx,
      width,
      height,
      dashTopY,
      blend > 0.5 ? toZone : fromZone,
      upcomingFork,
      forkRelZ
    );
  }

  private drawExteriorHorizon(
    ctx: CanvasRenderingContext2D,
    width: number,
    horizonY: number,
    horizonPanPx: number,
    mountainColor: string
  ): void {
    const span = width + 280;
    const sunX =
      ((((width * 0.76 - horizonPanPx * 0.55) % span) + span) % span) - 140;
    const sunY = horizonY * 0.36;
    ctx.fillStyle = 'rgba(255, 244, 160, 0.35)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    const cloudSpan = width + 320;
    for (let i = 0; i < 5; i++) {
      const rawX = i * 320 + this.time * 8 - horizonPanPx * 0.7;
      const cx = (((rawX % cloudSpan) + cloudSpan) % cloudSpan) - 160;
      const cy = horizonY * (0.24 + (i % 3) * 0.16);
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.arc(cx + 20, cy - 7, 25, 0, Math.PI * 2);
      ctx.arc(cx + 42, cy, 19, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = mountainColor;
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 2);
    for (let sx = 0; sx <= width + 20; sx += 20) {
      const wx = sx + horizonPanPx;
      const h =
        Math.sin(wx * 0.0045) * 26 +
        Math.sin(wx * 0.011 + 1.7) * 14 +
        38;
      ctx.lineTo(sx, horizonY - h);
    }
    ctx.lineTo(width, horizonY + 2);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Paints distinct biome ground patches along each diverging branch (golden desert sand,
   * crisp white snow, sparkling blue lake water, green farm pasture, etc.) so the child
   * clearly sees each branch's scenery ahead before choosing!
   */
  private drawBranchDestinationPatches(
    ctx: CanvasRenderingContext2D,
    fork: TrackFork,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    const rawBranches: BranchDir[] = fork.hasStraight
      ? ['left', 'straight', 'right']
      : ['left', 'right'];
    // Draw unchosen branches first and the selected branch last so its carpet is never clipped!
    const branches: BranchDir[] = [
      ...rawBranches.filter((b) => b !== fork.selectedBranch),
      ...rawBranches.filter((b) => b === fork.selectedBranch),
    ];

    const patchStartWorldZ = Math.max(this.trackDist + 8, fork.worldZ + 90);
    const patchEndWorldZ = Math.min(this.trackDist + Z_FAR, fork.worldZ + TURN_LEN + 560);
    if (patchEndWorldZ <= patchStartWorldZ + 20) return;

    const steps = 14;
    const dz = (patchEndWorldZ - patchStartWorldZ) / steps;

    const branchEdges = (br: BranchDir, wz: number): [number, number] => {
      const taper = smoothstep((wz - (fork.worldZ + 80)) / 210);
      const u = clamp01((wz - fork.worldZ) / TURN_LEN);
      // Adjacent branch center separation at wz (for 3-way = 1*LANE_SPREAD, for 2-way = 2*LANE_SPREAD)
      const neighborSep =
        (fork.hasStraight ? 1 : 2) * LANE_SPREAD * smoothstep(u);
      const innerHalf = Math.min(390, Math.max(155 * taper, neighborSep * 0.49));
      const outerHalf = 520 * taper;
      const cxWorld = this.evalForkBranchX(fork, br, wz);
      if (br === 'left') return [cxWorld - outerHalf, cxWorld + innerHalf];
      if (br === 'right') return [cxWorld - innerHalf, cxWorld + outerHalf];
      return [cxWorld - innerHalf, cxWorld + innerHalf];
    };

    for (const br of branches) {
      const zone = fork.branchZones[br];
      const color = ZONE_PALETTES[zone].patchColor;

      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = br === fork.selectedBranch ? 0.94 : 0.84;
      ctx.beginPath();

      for (let i = 0; i <= steps; i++) {
        const wz = patchStartWorldZ + i * dz;
        const [leftW] = branchEdges(br, wz);
        const pt = this.projectWorld(
          leftW,
          wz,
          trainPose,
          centerX,
          horizonY,
          trackBaseY
        );
        if (i === 0) ctx.moveTo(pt.sx, pt.sy);
        else ctx.lineTo(pt.sx, pt.sy);
      }

      for (let i = steps; i >= 0; i--) {
        const wz = patchStartWorldZ + i * dz;
        const [, rightW] = branchEdges(br, wz);
        const pt = this.projectWorld(
          rightW,
          wz,
          trainPose,
          centerX,
          horizonY,
          trackBaseY
        );
        ctx.lineTo(pt.sx, pt.sy);
      }

      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Draws the continuous track network — keeping unchosen branches visible in the periphery
   * right as the locomotive crosses over the switch points and curves away!
   */
  private drawContinuousTracks(
    ctx: CanvasRenderingContext2D,
    visibleForks: TrackFork[],
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    const zMinWorld = this.trackDist + 8;
    const zMaxWorld = this.trackDist + Z_FAR;

    const drawWorldSpan = (
      wStart: number,
      wEnd: number,
      worldXFn: (wz: number) => number,
      highlightSelected: boolean,
      dimmed: boolean
    ) => {
      const a = Math.max(zMinWorld, wStart);
      const b = Math.min(zMaxWorld, wEnd);
      if (b <= a + 4) return;

      const steps = Math.max(4, Math.ceil((b - a) / 28));
      const dw = (b - a) / steps;
      const halfBallast = 235;
      const halfTie = 192;
      const halfGauge = 140;

      // 1. Ballast bed
      for (let i = steps - 1; i >= 0; i--) {
        const wz1 = a + i * dw;
        const wz2 = wz1 + dw + 1;
        const wx1 = worldXFn(wz1);
        const wx2 = worldXFn(wz2);
        const p1L = this.projectWorld(wx1 - halfBallast, wz1, trainPose, centerX, horizonY, trackBaseY);
        const p1R = this.projectWorld(wx1 + halfBallast, wz1, trainPose, centerX, horizonY, trackBaseY);
        const p2L = this.projectWorld(wx2 - halfBallast, wz2, trainPose, centerX, horizonY, trackBaseY);
        const p2R = this.projectWorld(wx2 + halfBallast, wz2, trainPose, centerX, horizonY, trackBaseY);

        ctx.fillStyle = dimmed ? '#6E6A66' : '#5A5551';
        ctx.beginPath();
        ctx.moveTo(p2L.sx, p2L.sy);
        ctx.lineTo(p2R.sx, p2R.sy);
        ctx.lineTo(p1R.sx, p1R.sy);
        ctx.lineTo(p1L.sx, p1L.sy);
        ctx.closePath();
        ctx.fill();
      }

      // 2. Wooden sleepers
      const tieSpacing = 46;
      const firstTie = Math.ceil(a / tieSpacing);
      const lastTie = Math.floor(b / tieSpacing);
      for (let t = lastTie; t >= firstTie; t--) {
        const wz = t * tieSpacing;
        const wx = worldXFn(wz);
        const pL = this.projectWorld(wx - halfTie, wz, trainPose, centerX, horizonY, trackBaseY);
        const pR = this.projectWorld(wx + halfTie, wz, trainPose, centerX, horizonY, trackBaseY);

        ctx.strokeStyle = dimmed ? '#6D544B' : '#4E342E';
        ctx.lineWidth = Math.max(1.5, 9 * pL.scale);
        ctx.beginPath();
        ctx.moveTo(pL.sx, pL.sy);
        ctx.lineTo(pR.sx, pR.sy);
        ctx.stroke();
      }

      // 3. Twin Steel Rails
      for (const railSide of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const wz = a + i * dw;
          const wx = worldXFn(wz) + railSide * halfGauge;
          const pt = this.projectWorld(wx, wz, trainPose, centerX, horizonY, trackBaseY);
          if (i === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
        }
        ctx.strokeStyle = highlightSelected
          ? '#FFF59D'
          : dimmed
            ? '#B0BEC5'
            : '#ECEFF1';
        ctx.lineWidth = highlightSelected ? 5.5 : dimmed ? 3.5 : 4.5;
        ctx.stroke();
      }
    };

    // 1. First draw any unchosen fork branches in the periphery (back-to-front so active rails sit cleanly on top!)
    for (let i = visibleForks.length - 1; i >= 0; i--) {
      const fk = visibleForks[i];
      const branches: BranchDir[] = fk.hasStraight
        ? ['left', 'straight', 'right']
        : ['left', 'right'];

      for (const br of branches) {
        if (br === fk.selectedBranch) continue;
        // Keep unchosen branches extending well past TURN_LEN so they stay clearly visible in the periphery!
        drawWorldSpan(
          fk.worldZ,
          fk.worldZ + TURN_LEN + 540,
          (wz) => this.evalForkBranchX(fk, br, wz),
          false,
          true
        );
      }
    }

    // 2. Now draw the continuous chosen mainline from far horizon all the way to the cab nose!
    // Keep the golden highlight active both as we approach AND while crossing through the turnout!
    const activeTurnoutFork =
      visibleForks.find(
        (fk) =>
          fk.worldZ + TURN_LEN * 0.85 > this.trackDist &&
          fk.worldZ < this.trackDist + Z_FAR
      ) ?? this.getUpcomingSwitchableFork();
    const highlightStart = activeTurnoutFork.worldZ;
    const highlightEnd = activeTurnoutFork.worldZ + TURN_LEN;

    if (zMaxWorld > highlightEnd) {
      drawWorldSpan(highlightEnd, zMaxWorld, (wz) => this.evalActiveTrackPose(wz).x, false, false);
    }
    if (zMaxWorld > highlightStart && zMinWorld < highlightEnd) {
      drawWorldSpan(
        highlightStart,
        highlightEnd,
        (wz) => this.evalActiveTrackPose(wz).x,
        true,
        false
      );
    }
    if (zMinWorld < highlightStart) {
      drawWorldSpan(zMinWorld, highlightStart, (wz) => this.evalActiveTrackPose(wz).x, false, false);
    }
  }

  /**
   * Renders roadside trees/props AND the big iconic Destination Landmarks on EVERY branch
   * of upcoming/passing forks, sorted strictly back-to-front by worldZ!
   */
  private drawSceneryAndBranchLandmarks(
    ctx: CanvasRenderingContext2D,
    visibleForks: TrackFork[],
    ambientZone: SceneryZone,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    interface RenderItem {
      worldZ: number;
      draw: () => void;
    }
    const items: RenderItem[] = [];

    // 1. Collect iconic Destination Landmarks on ALL branches of visible forks!
    for (const fk of visibleForks) {
      const branches: BranchDir[] = fk.hasStraight
        ? ['left', 'straight', 'right']
        : ['left', 'right'];

      for (const br of branches) {
        const zone = fk.branchZones[br];
        if (zone === 'forest') {
          // 3D Mountain Tunnel spans from +540 to +1460 along the branch so from outside it is a
          // deep pitch-dark cave mouth bored into a massive rocky/pine mountain, and once inside
          // you ride past vaulted stone ribs & glowing lanterns out the daylight exit!
          const zFront = fk.worldZ + 540;
          const zBack = fk.worldZ + 1460;
          const minVisibleZ =
            br === fk.selectedBranch ? this.trackDist - 155 : this.trackDist - 35;
          if (zBack > this.trackDist + 25 && zFront < this.trackDist + Z_FAR && (br === fk.selectedBranch || zFront > minVisibleZ)) {
            const sortZ = Math.max(this.trackDist + 24, zFront);
            items.push({
              worldZ: sortZ,
              draw: () =>
                this.drawMountainTunnel3D(
                  ctx,
                  fk,
                  br,
                  zFront,
                  zBack,
                  trainPose,
                  centerX,
                  horizonY,
                  trackBaseY
                ),
            });
          }

          // Flanking forest pines before the tunnel entrance and beyond the tunnel exit!
          for (const offsetZ of [340, 1540, 1700]) {
            const pz = fk.worldZ + offsetZ;
            if (pz <= this.trackDist + 22 || pz >= this.trackDist + Z_FAR) continue;
            const bx = this.evalForkBranchX(fk, br, pz);
            items.push({
              worldZ: pz,
              draw: () => {
                if (br !== 'right') {
                  this.drawZoneSideProp(ctx, zone, bx - 235, pz, trainPose, centerX, horizonY, trackBaseY);
                }
                if (br !== 'left') {
                  this.drawZoneSideProp(ctx, zone, bx + 235, pz, trainPose, centerX, horizonY, trackBaseY);
                }
              },
            });
          }
          continue;
        }

        // Place the giant signature landmark at +680 past the switch frog, where adjacent branches
        // are already ~760 world units apart — zero overlap between branches AND stays ahead while crossing!
        const landmarkZ = fk.worldZ + 680;
        if (landmarkZ > this.trackDist + 18 && landmarkZ < this.trackDist + Z_FAR) {
          const lx = this.evalForkBranchX(fk, br, landmarkZ);
          items.push({
            worldZ: landmarkZ,
            draw: () =>
              this.drawBranchSignatureLandmark(
                ctx,
                zone,
                br,
                lx,
                landmarkZ,
                trainPose,
                centerX,
                horizonY,
                trackBaseY
              ),
          });
        }

        // Flanking preview props along each branch (+380, +960, +1220) tucked close to each branch's rails
        for (const offsetZ of [380, 960, 1220]) {
          const pz = fk.worldZ + offsetZ;
          if (pz <= this.trackDist + 22 || pz >= this.trackDist + Z_FAR) continue;
          const bx = this.evalForkBranchX(fk, br, pz);
          items.push({
            worldZ: pz,
            draw: () => {
              if (br !== 'right') {
                this.drawZoneSideProp(ctx, zone, bx - 225, pz, trainPose, centerX, horizonY, trackBaseY);
              }
              if (br !== 'left') {
                this.drawZoneSideProp(ctx, zone, bx + 225, pz, trainPose, centerX, horizonY, trackBaseY);
              }
            },
          });
        }
      }
    }

    // 2. Collect regular roadside props along straight sections (skipping fork turnout zones so nothing blocks branches!)
    const spacing = 150;
    const minSlot = Math.floor((this.trackDist + 30) / spacing);
    const maxSlot = Math.floor((this.trackDist + Z_FAR) / spacing);

    for (let slot = minSlot; slot <= maxSlot; slot++) {
      const wz = slot * spacing;
      const nearAnyFork = visibleForks.some(
        (fk) => wz > fk.worldZ - 80 && wz < fk.worldZ + TURN_LEN + 680
      );
      if (nearAnyFork) continue;

      const trackX = this.evalActiveTrackPose(wz).x;
      items.push({
        worldZ: wz,
        draw: () => {
          for (const side of [-1, 1]) {
            const r = seededRand(slot * 19.3 + (side > 0 ? 7.1 : 2.3));
            if (r < 0.28) continue;
            const wx = trackX + side * (360 + r * 380);
            this.drawZoneSideProp(
              ctx,
              ambientZone,
              wx,
              wz,
              trainPose,
              centerX,
              horizonY,
              trackBaseY
            );
          }
        },
      });
    }

    // Painter's algorithm: farthest worldZ drawn first, closest drawn last!
    items.sort((a, b) => b.worldZ - a.worldZ);
    for (const item of items) {
      item.draw();
    }
  }

  /**
   * Renders a full 3D Mountain Railroad Tunnel from `zFront` to `zBack`:
   * - Broad 3D forested mountain massif + pine trees + battered cut-stone portal headwall
   * - Deep 3D vaulted tunnel tube with longitudinal masonry seams, transverse stone ribs,
   *   warm glowing wall lanterns, shaded track floor, and an open daylight exit arch at `zBack`
   * - Smoothly wraps over the cab windshield as the locomotive drives inside and through the tunnel!
   */
  private drawMountainTunnel3D(
    ctx: CanvasRenderingContext2D,
    fork: TrackFork,
    branch: BranchDir,
    zFront: number,
    zBack: number,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    const isChosenBranch = branch === fork.selectedBranch;
    const zNear = isChosenBranch
      ? Math.max(this.trackDist - 155, zFront)
      : Math.max(this.trackDist - 35, zFront);
    if (zNear >= zBack - 24) return;

    const camEyeH = Math.max(120, trackBaseY - horizonY);
    const halfBoreW = 240;
    const wallH = camEyeH * 0.56;
    const crownH = camEyeH * 1.38;
    const outerSign = branch === 'left' ? -1 : 1;

    interface Pt3 {
      sx: number;
      sy: number;
      scale: number;
    }

    const proj3D = (wx: number, hAboveTrack: number, wz: number): Pt3 => {
      const z = wz - this.trackDist;
      const scale = FOCAL / Math.max(36, FOCAL + z);
      const relX = (wx - trainPose.x) - trainPose.slope * z;
      return {
        sx: centerX + relX * scale,
        sy: horizonY + (camEyeH - hAboveTrack) * scale,
        scale,
      };
    };

    // 13-point horseshoe/Roman arch cross-section (0 = bottom-left .. 6 = crown .. 12 = bottom-right)
    const buildBoreRing = (wz: number): Pt3[] => {
      const cx = this.evalForkBranchX(fork, branch, wz);
      const pts: Pt3[] = [proj3D(cx - halfBoreW, 0, wz)];
      const arcSteps = 10;
      for (let j = 0; j <= arcSteps; j++) {
        const theta = (j / arcSteps) * Math.PI;
        const xOff = -Math.cos(theta) * halfBoreW;
        const h = wallH + Math.sin(theta) * (crownH - wallH);
        pts.push(proj3D(cx + xOff, h, wz));
      }
      pts.push(proj3D(cx + halfBoreW, 0, wz));
      return pts;
    };

    const traceClosedRing = (ring: Pt3[]) => {
      ctx.moveTo(ring[0].sx, ring[0].sy);
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(ring[i].sx, ring[i].sy);
      }
      ctx.closePath();
    };

    const ringNear = buildBoreRing(zNear);
    const ringBack = buildBoreRing(zBack);
    const showPortalExterior = zNear === zFront;
    // From outside approaching the mountain, the tunnel bore is pitch-dark all the way in so NO
    // background snow/sky bleeds through like a flat arch; once entering the tunnel, the far
    // daylight exit smoothly opens up ahead!
    const exitOpenFactor = isChosenBranch
      ? smoothstep((this.trackDist - (zFront - 90)) / 360)
      : 0;

    // 1. EXTERIOR MASSIVE ROCKY & FORESTED MOUNTAIN + CUT-STONE PORTAL HEADWALL
    if (showPortalExterior) {
      const cxFront = this.evalForkBranchX(fork, branch, zFront);
      const cxMid = this.evalForkBranchX(fork, branch, zFront + 320);
      const innerClearSpan = fork.hasStraight ? 495 : 880;
      const leftSpan =
        branch === 'left' ? 1650 : branch === 'right' ? innerClearSpan : 520;
      const rightSpan =
        branch === 'right' ? 1650 : branch === 'left' ? innerClearSpan : 520;

      ctx.save();
      ctx.beginPath();
      ctx.rect(-2000, -2000, 6000, 6000);
      traceClosedRing(ringNear);
      ctx.clip('evenodd');

      // 1a. Towering Rear Craggy Granite & Alpine Ridge (+320 behind portal for huge mountain scale!)
      const cragPts: Array<[number, number]> = [
        [-leftSpan * 1.12, 0],
        [-leftSpan * 0.78, camEyeH * 1.65],
        [-leftSpan * 0.42, camEyeH * 2.85],
        [-leftSpan * 0.14, camEyeH * 2.38],
        [outerSign * 140, camEyeH * 3.45],
        [rightSpan * 0.34, camEyeH * 2.65],
        [rightSpan * 0.72, camEyeH * 1.82],
        [rightSpan * 1.12, 0],
      ];
      ctx.fillStyle = '#37474F';
      ctx.beginPath();
      for (let i = 0; i < cragPts.length; i++) {
        const pt = proj3D(cxMid + cragPts[i][0], cragPts[i][1], zFront + 320);
        if (i === 0) ctx.moveTo(pt.sx, pt.sy + 4);
        else ctx.lineTo(pt.sx, pt.sy);
      }
      ctx.closePath();
      ctx.fill();

      // Sunlit high granite/snow ridge cap on the tallest crag
      const capLeft = proj3D(cxMid + outerSign * 140 - 150, camEyeH * 2.75, zFront + 320);
      const capTop = proj3D(cxMid + outerSign * 140, camEyeH * 3.45, zFront + 320);
      const capRight = proj3D(cxMid + outerSign * 140 + 165, camEyeH * 2.72, zFront + 320);
      const capMid = proj3D(cxMid + outerSign * 140 + 25, camEyeH * 2.55, zFront + 320);
      ctx.fillStyle = '#CFD8DC';
      ctx.beginPath();
      ctx.moveTo(capLeft.sx, capLeft.sy);
      ctx.lineTo(capTop.sx, capTop.sy);
      ctx.lineTo(capRight.sx, capRight.sy);
      ctx.lineTo(capMid.sx, capMid.sy);
      ctx.closePath();
      ctx.fill();

      // 1b. Broad Forested Mountain Massif rising high above the stone tunnel portal
      const mBaseL = proj3D(cxFront - leftSpan, 0, zFront);
      const mCtrlL1 = proj3D(cxFront - leftSpan * 0.68, camEyeH * 1.45, zFront);
      const mCtrlL2 = proj3D(cxFront - leftSpan * 0.24, camEyeH * 2.65, zFront);
      const mPeak = proj3D(cxFront + outerSign * 85, camEyeH * 2.72, zFront);
      const mCtrlR1 = proj3D(cxFront + rightSpan * 0.24, camEyeH * 2.6, zFront);
      const mCtrlR2 = proj3D(cxFront + rightSpan * 0.68, camEyeH * 1.42, zFront);
      const mBaseR = proj3D(cxFront + rightSpan, 0, zFront);

      const mtnGrad = ctx.createLinearGradient(0, mPeak.sy, 0, mBaseL.sy);
      mtnGrad.addColorStop(0, '#1B5E20');
      mtnGrad.addColorStop(0.55, '#2E7D32');
      mtnGrad.addColorStop(1, '#388E3C');
      ctx.fillStyle = mtnGrad;
      ctx.beginPath();
      ctx.moveTo(mBaseL.sx, mBaseL.sy + 4);
      ctx.bezierCurveTo(mCtrlL1.sx, mCtrlL1.sy, mCtrlL2.sx, mCtrlL2.sy, mPeak.sx, mPeak.sy);
      ctx.bezierCurveTo(mCtrlR1.sx, mCtrlR1.sy, mCtrlR2.sx, mCtrlR2.sy, mBaseR.sx, mBaseR.sy + 4);
      ctx.closePath();
      ctx.fill();

      // blasted dark rock cliff cut directly framing the stone portal headwall
      const cliffBotL = proj3D(cxFront - 430, 0, zFront);
      const cliffMidL = proj3D(cxFront - 395, camEyeH * 1.48, zFront);
      const cliffTop = proj3D(cxFront, camEyeH * 2.02, zFront);
      const cliffMidR = proj3D(cxFront + 395, camEyeH * 1.48, zFront);
      const cliffBotR = proj3D(cxFront + 430, 0, zFront);
      ctx.fillStyle = '#3E4C54';
      ctx.beginPath();
      ctx.moveTo(cliffBotL.sx, cliffBotL.sy + 2);
      ctx.lineTo(cliffMidL.sx, cliffMidL.sy);
      ctx.lineTo(cliffTop.sx, cliffTop.sy);
      ctx.lineTo(cliffMidR.sx, cliffMidR.sy);
      ctx.lineTo(cliffBotR.sx, cliffBotR.sy + 2);
      ctx.closePath();
      ctx.fill();

      // Dense cluster of evergreen pine trees along the mountain slopes & ridges!
      const slopeTrees: Array<[number, number]> = [
        [-780, camEyeH * 0.45],
        [-580, camEyeH * 0.85],
        [-435, camEyeH * 0.32],
        [-345, camEyeH * 1.42],
        [345, camEyeH * 1.38],
        [435, camEyeH * 0.32],
        [590, camEyeH * 0.88],
        [810, camEyeH * 0.48],
      ];
      for (const [xOff, baseH] of slopeTrees) {
        if (xOff < -(leftSpan - 70) || xOff > rightSpan - 70) continue;
        const tp = proj3D(cxFront + xOff, baseH, zFront - 4);
        const ts = tp.scale * 1.45;
        ctx.fillStyle = '#4E342E';
        ctx.fillRect(tp.sx - 4 * ts, tp.sy - 26 * ts, 8 * ts, 26 * ts);
        ctx.fillStyle = '#144D18';
        for (let tier = 0; tier < 3; tier++) {
          const ty = tp.sy - (18 + tier * 22) * ts;
          const tw = (29 - tier * 5) * ts;
          ctx.beginPath();
          ctx.moveTo(tp.sx - tw, ty);
          ctx.lineTo(tp.sx, ty - 36 * ts);
          ctx.lineTo(tp.sx + tw, ty);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 1c. Heavy Battered Cut-Stone Tunnel Portal Headwall & Stepped Wing-Walls
      const parapetH = crownH + camEyeH * 0.26;
      const hwBotL = proj3D(cxFront - 365, 0, zFront);
      const hwTopL = proj3D(cxFront - 320, parapetH, zFront);
      const hwTopR = proj3D(cxFront + 320, parapetH, zFront);
      const hwBotR = proj3D(cxFront + 365, 0, zFront);

      ctx.fillStyle = '#546E7A';
      ctx.beginPath();
      ctx.moveTo(hwBotL.sx, hwBotL.sy + 2);
      ctx.lineTo(hwTopL.sx, hwTopL.sy);
      ctx.lineTo(hwTopR.sx, hwTopR.sy);
      ctx.lineTo(hwBotR.sx, hwBotR.sy + 2);
      ctx.closePath();
      ctx.fill();

      // Horizontal ashlar stone block courses across the headwall
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = Math.max(1, 2.4 * hwBotL.scale);
      for (let row = 1; row <= 5; row++) {
        const frac = row / 6;
        const ly = lerp(hwBotL.sy, hwTopL.sy, frac);
        const lx = lerp(hwBotL.sx, hwTopL.sx, frac);
        const rx = lerp(hwBotR.sx, hwTopR.sx, frac);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ly);
        ctx.stroke();
      }

      // Projecting light-stone parapet cap ledge along top of headwall
      const capBotL = proj3D(cxFront - 338, parapetH - camEyeH * 0.04, zFront);
      const capTopL = proj3D(cxFront - 338, parapetH + camEyeH * 0.07, zFront);
      const capTopR = proj3D(cxFront + 338, parapetH + camEyeH * 0.07, zFront);
      const capBotR = proj3D(cxFront + 338, parapetH - camEyeH * 0.04, zFront);
      ctx.fillStyle = '#90A4AE';
      ctx.beginPath();
      ctx.moveTo(capBotL.sx, capBotL.sy);
      ctx.lineTo(capTopL.sx, capTopL.sy);
      ctx.lineTo(capTopR.sx, capTopR.sy);
      ctx.lineTo(capBotR.sx, capBotR.sy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = Math.max(1, 2.2 * capTopL.scale);
      ctx.stroke();

      ctx.restore();
    }

    // 2. 3D VAULTED TUNNEL BARREL INTERIOR
    ctx.save();
    if (showPortalExterior) {
      ctx.beginPath();
      traceClosedRing(ringNear);
      ctx.clip();
    } else {
      // Cab is underground inside the tunnel: seal everything outside ringNear with solid dark rock!
      ctx.fillStyle = '#090D13';
      ctx.beginPath();
      ctx.rect(-2000, -2000, 6000, 6000);
      traceClosedRing(ringNear);
      ctx.fill('evenodd');
    }

    // 2a. Deep pitch-dark back veil at ringBack when viewed from outside (fades open once inside!)
    if (exitOpenFactor < 0.99) {
      ctx.fillStyle = `rgba(6, 9, 14, ${(1 - exitOpenFactor).toFixed(3)})`;
      ctx.beginPath();
      traceClosedRing(ringBack);
      ctx.fill();
    }

    // Build fixed world-space rib slices so ribs & lanterns physically rush past the cab!
    const ribStep = 95;
    const sliceZs: number[] = [zNear];
    const firstRib = Math.ceil((zNear + 16) / ribStep) * ribStep;
    for (let wz = firstRib; wz < zBack - 16; wz += ribStep) {
      sliceZs.push(wz);
    }
    sliceZs.push(zBack);

    const sliceRings = sliceZs.map((wz) => buildBoreRing(wz));

    // Draw barrel slices back-to-front
    for (let sIdx = sliceRings.length - 2; sIdx >= 0; sIdx--) {
      const rNear = sliceRings[sIdx];
      const rFar = sliceRings[sIdx + 1];
      const wzMid = 0.5 * (sliceZs[sIdx] + sliceZs[sIdx + 1]);
      const depthFrac = clamp01((wzMid - zFront) / Math.max(1, zBack - zFront));
      // Fade tunnel walls & track floor steadily into pitch darkness deeper inside when viewed from outside!
      const entranceGlow = Math.pow(1 - depthFrac, 1.5);
      const exitGlow = exitOpenFactor * Math.pow(depthFrac, 2.2);
      const lightLevel = Math.min(1, entranceGlow * 0.85 + exitGlow);

      // Shaded ballast floor (gradually swallows the rails into darkness deep inside the mountain!)
      const floorDarkAlpha = lerp(0.95 - exitOpenFactor * 0.42, 0.34, entranceGlow);
      ctx.fillStyle = `rgba(6, 9, 14, ${floorDarkAlpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(rFar[0].sx, rFar[0].sy);
      ctx.lineTo(rFar[12].sx, rFar[12].sy);
      ctx.lineTo(rNear[12].sx, rNear[12].sy);
      ctx.lineTo(rNear[0].sx, rNear[0].sy);
      ctx.closePath();
      ctx.fill();

      // When underground inside the tunnel, seal outer stone floor shoulders beside curved track!
      if (!showPortalExterior) {
        ctx.fillStyle = '#0B1017';
        ctx.beginPath();
        ctx.moveTo(rFar[0].sx, rFar[0].sy);
        ctx.lineTo(rFar[0].sx - 1200, rFar[0].sy + 260);
        ctx.lineTo(rNear[0].sx - 1200, rNear[0].sy + 260);
        ctx.lineTo(rNear[0].sx, rNear[0].sy);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(rFar[12].sx, rFar[12].sy);
        ctx.lineTo(rFar[12].sx + 1200, rFar[12].sy + 260);
        ctx.lineTo(rNear[12].sx + 1200, rNear[12].sy + 260);
        ctx.lineTo(rNear[12].sx, rNear[12].sy);
        ctx.closePath();
        ctx.fill();
      }

      // Solid 3D vaulted tunnel wall & ceiling panels
      for (let k = 0; k < 12; k++) {
        const crownDist = Math.abs(k - 5.5) / 5.5;
        const baseLum = 7 + lightLevel * lerp(14, 34, crownDist);
        const rCol = Math.round(baseLum * 0.84);
        const gCol = Math.round(baseLum * 1.0);
        const bCol = Math.round(baseLum * 1.22);

        ctx.fillStyle = `rgb(${rCol}, ${gCol}, ${bCol})`;
        ctx.strokeStyle = '#06090E';
        ctx.lineWidth = Math.max(1, 1.8 * rNear[6].scale);
        ctx.beginPath();
        ctx.moveTo(rFar[k].sx, rFar[k].sy);
        ctx.lineTo(rFar[k + 1].sx, rFar[k + 1].sy);
        ctx.lineTo(rNear[k + 1].sx, rNear[k + 1].sy);
        ctx.lineTo(rNear[k].sx, rNear[k].sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Transverse arched stone support rib at sliceZs[sIdx]
      const wzRib = sliceZs[sIdx];
      if (wzRib > zFront + 24 && wzRib < zBack - 24) {
        const ribLum = Math.round(18 + lightLevel * 38);
        ctx.strokeStyle = `rgb(${ribLum}, ${Math.round(ribLum * 1.15)}, ${Math.round(ribLum * 1.28)})`;
        ctx.lineWidth = Math.max(1.8, 8.5 * rNear[6].scale);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(rNear[0].sx, rNear[0].sy);
        for (let k = 1; k <= 12; k++) {
          ctx.lineTo(rNear[k].sx, rNear[k].sy);
        }
        ctx.stroke();
      }
    }

    // Sunlit masonry rim around the far daylight exit arch once exit opens up inside!
    if (exitOpenFactor > 0.08) {
      ctx.strokeStyle = `rgba(176, 190, 197, ${exitOpenFactor.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, 7 * ringBack[6].scale);
      ctx.beginPath();
      ctx.moveTo(ringBack[0].sx, ringBack[0].sy);
      for (let k = 1; k <= 12; k++) {
        ctx.lineTo(ringBack[k].sx, ringBack[k].sy);
      }
      ctx.stroke();
    }

    // Warm glowing amber tunnel wall lanterns along both walls!
    for (const lampOffset of [130, 320, 510, 700]) {
      const lampZ = zFront + lampOffset;
      if (lampZ <= zNear + 8 || lampZ >= zBack - 40) continue;
      const lampRing = buildBoreRing(lampZ);
      for (const wallIdx of [1, 11]) {
        const lp = lampRing[wallIdx];
        const glowR = Math.max(3.5, 25 * lp.scale);
        const glow = ctx.createRadialGradient(lp.sx, lp.sy, 1, lp.sx, lp.sy, glowR);
        glow.addColorStop(0, 'rgba(255, 238, 130, 0.95)');
        glow.addColorStop(0.35, 'rgba(255, 179, 0, 0.45)');
        glow.addColorStop(1, 'rgba(255, 160, 0, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, glowR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFF59D';
        ctx.beginPath();
        ctx.arc(lp.sx, lp.sy, Math.max(1.8, 5 * lp.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // 3. DRESSED STONE ARCH RING & KEYSTONE AT THE ENTRANCE PORTAL
    if (showPortalExterior) {
      const sFront = ringNear[6].scale;
      ctx.save();
      ctx.strokeStyle = '#B0BEC5';
      ctx.lineWidth = Math.max(4, 18 * sFront);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ringNear[0].sx, ringNear[0].sy);
      for (let k = 1; k <= 12; k++) {
        ctx.lineTo(ringNear[k].sx, ringNear[k].sy);
      }
      ctx.stroke();

      ctx.strokeStyle = '#455A64';
      ctx.lineWidth = Math.max(1.5, 3 * sFront);
      ctx.stroke();

      // Trapezoidal Keystone at top center of the portal arch
      const ks = ringNear[6];
      const kwTop = 22 * sFront;
      const kwBot = 14 * sFront;
      const kh = 26 * sFront;
      ctx.fillStyle = '#ECEFF1';
      ctx.strokeStyle = '#37474F';
      ctx.lineWidth = Math.max(1.2, 2.5 * sFront);
      ctx.beginPath();
      ctx.moveTo(ks.sx - kwTop, ks.sy - kh * 0.55);
      ctx.lineTo(ks.sx + kwTop, ks.sy - kh * 0.55);
      ctx.lineTo(ks.sx + kwBot, ks.sy + kh * 0.45);
      ctx.lineTo(ks.sx - kwBot, ks.sy + kh * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Draws an unmistakable, toddler-friendly giant Destination Landmark on a fork branch:
   * - `desert`: Red-rock Canyon Arch + Mesa Butte + Giant Saguaro Cactus
   * - `snow`: Giant Smiling Snowman (top hat + scarf) + Frosted Glacier Peak
   * - `farm`: Classic Red Barn + Spinning Silver Windmill
   * - `bridge`: Iconic Golden-Gate Red Suspension Bridge Towers + Cables straddling the rails
   * - `forest`: Heavy Stone Mountain Tunnel Archway straddling the rails
   */
  private drawBranchSignatureLandmark(
    ctx: CanvasRenderingContext2D,
    zone: SceneryZone,
    branch: BranchDir,
    branchWorldX: number,
    worldZ: number,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    const pCenter = this.projectWorld(
      branchWorldX,
      worldZ,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );
    const s = pCenter.scale * 2.35;
    if (s < 0.05) return;

    const pLeft = this.projectWorld(
      branchWorldX - 205,
      worldZ,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );
    const pRight = this.projectWorld(
      branchWorldX + 205,
      worldZ,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );
    const outerSign = branch === 'left' ? -1 : 1;

    if (zone === 'bridge') {
      // Tall Golden-Gate Red Suspension Bridge Portal + Suspension Cables straddling the rails!
      const towerH = 210 * s;
      const towerW = 26 * s;

      // Sweeping side suspension cables (compact so they stay inside the bridge's own lane!)
      ctx.strokeStyle = '#B71C1C';
      ctx.lineWidth = Math.max(2, 4.5 * s);
      ctx.beginPath();
      ctx.moveTo(pLeft.sx - 55 * s, pLeft.sy - 18 * s);
      ctx.quadraticCurveTo(pLeft.sx - 22 * s, pLeft.sy - towerH * 0.45, pLeft.sx, pLeft.sy - towerH + 8 * s);
      ctx.moveTo(pRight.sx + 55 * s, pRight.sy - 18 * s);
      ctx.quadraticCurveTo(pRight.sx + 22 * s, pRight.sy - towerH * 0.45, pRight.sx, pRight.sy - towerH + 8 * s);
      ctx.stroke();

      // Main twin red towers
      ctx.fillStyle = '#E53935';
      ctx.strokeStyle = '#8E0000';
      ctx.lineWidth = Math.max(1.5, 3 * s);
      for (const tx of [pLeft.sx, pRight.sx]) {
        ctx.fillRect(tx - towerW / 2, pLeft.sy - towerH, towerW, towerH);
        ctx.strokeRect(tx - towerW / 2, pLeft.sy - towerH, towerW, towerH);
      }

      // Cross-girders overhead (high enough for locomotive to pass cleanly underneath!)
      ctx.fillStyle = '#C62828';
      ctx.fillRect(
        pLeft.sx - towerW * 0.7,
        pLeft.sy - towerH + 14 * s,
        pRight.sx - pLeft.sx + towerW * 1.4,
        20 * s
      );
      ctx.fillRect(
        pLeft.sx - towerW * 0.5,
        pLeft.sy - towerH * 0.66,
        pRight.sx - pLeft.sx + towerW,
        14 * s
      );

      // Steel X-bracing between girders
      ctx.strokeStyle = '#FFCDD2';
      ctx.lineWidth = Math.max(1.5, 3.5 * s);
      ctx.beginPath();
      ctx.moveTo(pLeft.sx, pLeft.sy - towerH + 18 * s);
      ctx.lineTo(pRight.sx, pRight.sy - towerH * 0.66);
      ctx.moveTo(pRight.sx, pRight.sy - towerH + 18 * s);
      ctx.lineTo(pLeft.sx, pLeft.sy - towerH * 0.66);
      ctx.stroke();
      return;
    }

    if (zone === 'forest') {
      // Handled by drawMountainTunnel3D in drawSceneryAndBranchLandmarks
      return;
    }

    if (zone === 'desert') {
      // Towering Red-Rock Natural Sandstone Arch + Stepped Mesa Butte + Giant Saguaro Cactus!
      const spanW = pRight.sx - pLeft.sx;
      const archH = 185 * s;
      const cx = (pLeft.sx + pRight.sx) * 0.5;
      const baseY = pCenter.sy;

      // Stepped Red-Rock Mesa Butte on the outer flank so it never crowds neighboring branches!
      const mesaAnchorX = outerSign < 0 ? pLeft.sx - 64 * s : pRight.sx + 64 * s;
      ctx.fillStyle = '#BF360C';
      ctx.beginPath();
      ctx.moveTo(mesaAnchorX - 58 * s, baseY);
      ctx.lineTo(mesaAnchorX - 42 * s, baseY - 78 * s);
      ctx.lineTo(mesaAnchorX - 24 * s, baseY - 78 * s);
      ctx.lineTo(mesaAnchorX - 15 * s, baseY - 122 * s);
      ctx.lineTo(mesaAnchorX + 22 * s, baseY - 122 * s);
      ctx.lineTo(mesaAnchorX + 34 * s, baseY - 74 * s);
      ctx.lineTo(mesaAnchorX + 52 * s, baseY);
      ctx.closePath();
      ctx.fill();

      // Sandstone Arch spanning over the branch
      ctx.strokeStyle = '#D84315';
      ctx.lineWidth = Math.max(5, 28 * s);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - spanW * 0.52, baseY);
      ctx.quadraticCurveTo(cx - spanW * 0.48, baseY - archH, cx, baseY - archH);
      ctx.quadraticCurveTo(cx + spanW * 0.48, baseY - archH, cx + spanW * 0.52, baseY);
      ctx.stroke();

      ctx.strokeStyle = '#FFAB91';
      ctx.lineWidth = Math.max(2, 9 * s);
      ctx.stroke();

      // Big friendly Saguaro cactus tucked snugly beside inner pillar
      const cax = outerSign < 0 ? pRight.sx + 30 * s : pLeft.sx - 30 * s;
      ctx.fillStyle = '#2E7D32';
      ctx.strokeStyle = '#1B5E20';
      ctx.lineWidth = Math.max(1, 2.5 * s);
      ctx.beginPath();
      ctx.roundRect(cax - 9 * s, baseY - 102 * s, 18 * s, 102 * s, 8 * s);
      ctx.roundRect(cax - 31 * s, baseY - 70 * s, 24 * s, 13 * s, 6 * s);
      ctx.roundRect(cax - 31 * s, baseY - 92 * s, 13 * s, 32 * s, 6 * s);
      ctx.roundRect(cax + 7 * s, baseY - 60 * s, 24 * s, 13 * s, 6 * s);
      ctx.roundRect(cax + 18 * s, baseY - 84 * s, 13 * s, 34 * s, 6 * s);
      ctx.fill();
      ctx.stroke();
      return;
    }

    if (zone === 'snow') {
      // Giant Cheerful Smiling Snowman + Frosted Glacier Peak (wide peak placed on outer flank!)
      const baseY = pCenter.sy;
      const pkX = outerSign < 0 ? pLeft.sx - 52 * s : pRight.sx + 58 * s;
      const smX = outerSign < 0 ? pRight.sx + 24 * s : pLeft.sx - 24 * s;

      // Frosted Ice Peak on outer side of branch
      ctx.fillStyle = '#64B5F6';
      ctx.beginPath();
      ctx.moveTo(pkX - 64 * s, baseY);
      ctx.lineTo(pkX, baseY - 175 * s);
      ctx.lineTo(pkX + 64 * s, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(pkX - 28 * s, baseY - 100 * s);
      ctx.lineTo(pkX, baseY - 175 * s);
      ctx.lineTo(pkX + 28 * s, baseY - 100 * s);
      ctx.lineTo(pkX + 9 * s, baseY - 88 * s);
      ctx.lineTo(pkX - 7 * s, baseY - 96 * s);
      ctx.closePath();
      ctx.fill();

      // Snowman 3 giant snowballs
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#29B6F6';
      ctx.lineWidth = Math.max(2, 3.5 * s);
      for (const [dy, rad] of [
        [-34, 35],
        [-86, 26],
        [-128, 19],
      ]) {
        ctx.beginPath();
        ctx.arc(smX, baseY + dy * s, rad * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Red scarf & top hat & carrot nose!
      ctx.fillStyle = '#E53935';
      ctx.fillRect(smX - 18 * s, baseY - 110 * s, 36 * s, 9 * s);
      ctx.fillRect(smX + 5 * s, baseY - 108 * s, 9 * s, 24 * s);

      ctx.fillStyle = '#263238';
      ctx.fillRect(smX - 22 * s, baseY - 147 * s, 44 * s, 6 * s);
      ctx.fillRect(smX - 15 * s, baseY - 175 * s, 30 * s, 29 * s);

      ctx.fillStyle = '#FF6D00';
      ctx.beginPath();
      ctx.moveTo(smX, baseY - 128 * s);
      ctx.lineTo(smX + 18 * s, baseY - 124 * s);
      ctx.lineTo(smX, baseY - 120 * s);
      ctx.closePath();
      ctx.fill();
      return;
    }

    // `farm`: Big Classic Red Barn (on outer flank) + Spinning Windmill (on inner flank)!
    const barnX = outerSign < 0 ? pLeft.sx - 58 * s : pRight.sx + 58 * s;
    const wmX = outerSign < 0 ? pRight.sx + 26 * s : pLeft.sx - 26 * s;
    const baseY = pCenter.sy;
    const bw = 112 * s;
    const bh = 92 * s;

    ctx.fillStyle = '#D32F2F';
    ctx.fillRect(barnX - bw / 2, baseY - bh, bw, bh);
    ctx.fillStyle = '#8E1D1D';
    ctx.beginPath();
    ctx.moveTo(barnX - bw * 0.58, baseY - bh);
    ctx.lineTo(barnX - bw * 0.28, baseY - bh * 1.38);
    ctx.lineTo(barnX, baseY - bh * 1.54);
    ctx.lineTo(barnX + bw * 0.28, baseY - bh * 1.38);
    ctx.lineTo(barnX + bw * 0.58, baseY - bh);
    ctx.closePath();
    ctx.fill();

    // White X barn doors & roof trim
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, 4.5 * s);
    ctx.strokeRect(barnX - 24 * s, baseY - 56 * s, 48 * s, 54 * s);
    ctx.beginPath();
    ctx.moveTo(barnX - 24 * s, baseY - 56 * s);
    ctx.lineTo(barnX + 24 * s, baseY - 2 * s);
    ctx.moveTo(barnX + 24 * s, baseY - 56 * s);
    ctx.lineTo(barnX - 24 * s, baseY - 2 * s);
    ctx.stroke();

    // Spinning windmill
    ctx.strokeStyle = '#546E7A';
    ctx.lineWidth = Math.max(2, 5 * s);
    ctx.beginPath();
    ctx.moveTo(wmX - 20 * s, baseY);
    ctx.lineTo(wmX, baseY - 146 * s);
    ctx.lineTo(wmX + 20 * s, baseY);
    ctx.stroke();

    ctx.save();
    ctx.translate(wmX, baseY - 146 * s);
    ctx.rotate(this.time * 1.4);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#455A64';
    ctx.lineWidth = Math.max(1, 2 * s);
    for (let b = 0; b < 4; b++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillRect(-5 * s, -44 * s, 10 * s, 40 * s);
      ctx.strokeRect(-5 * s, -44 * s, 10 * s, 40 * s);
    }
    ctx.restore();
  }

  private drawZoneSideProp(
    ctx: CanvasRenderingContext2D,
    zone: SceneryZone,
    worldX: number,
    worldZ: number,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number
  ): void {
    const { sx, sy, scale } = this.projectWorld(
      worldX,
      worldZ,
      trainPose,
      centerX,
      horizonY,
      trackBaseY
    );
    const s = scale * 1.45;
    if (s < 0.05) return;

    if (zone === 'farm') {
      ctx.fillStyle = '#6D4C41';
      ctx.fillRect(sx - 6 * s, sy - 42 * s, 12 * s, 42 * s);
      ctx.fillStyle = '#43A047';
      ctx.beginPath();
      ctx.arc(sx, sy - 60 * s, 28 * s, 0, Math.PI * 2);
      ctx.arc(sx - 18 * s, sy - 48 * s, 20 * s, 0, Math.PI * 2);
      ctx.arc(sx + 18 * s, sy - 48 * s, 20 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (zone === 'forest' || zone === 'snow') {
      ctx.fillStyle = '#5D4037';
      ctx.fillRect(sx - 5 * s, sy - 34 * s, 10 * s, 34 * s);
      ctx.fillStyle = zone === 'snow' ? '#455A64' : '#2E7D32';
      for (let t = 0; t < 3; t++) {
        const ty = sy - (26 + t * 26) * s;
        const tw = (34 - t * 6) * s;
        ctx.beginPath();
        ctx.moveTo(sx - tw, ty);
        ctx.lineTo(sx, ty - 42 * s);
        ctx.lineTo(sx + tw, ty);
        ctx.closePath();
        ctx.fill();
      }
      if (zone === 'snow') {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(sx - 14 * s, sy - 92 * s);
        ctx.lineTo(sx, sy - 120 * s);
        ctx.lineTo(sx + 14 * s, sy - 92 * s);
        ctx.closePath();
        ctx.fill();
      }
    } else if (zone === 'desert') {
      ctx.fillStyle = '#558B2F';
      ctx.beginPath();
      ctx.roundRect(sx - 7 * s, sy - 66 * s, 14 * s, 66 * s, 6 * s);
      ctx.roundRect(sx - 23 * s, sy - 46 * s, 17 * s, 9 * s, 4 * s);
      ctx.roundRect(sx - 23 * s, sy - 60 * s, 9 * s, 22 * s, 4 * s);
      ctx.roundRect(sx + 6 * s, sy - 38 * s, 17 * s, 9 * s, 4 * s);
      ctx.roundRect(sx + 14 * s, sy - 54 * s, 9 * s, 24 * s, 4 * s);
      ctx.fill();
    } else {
      // bridge / lake: little white sailboat or reeds on the water!
      ctx.fillStyle = '#8D6E63';
      ctx.beginPath();
      ctx.moveTo(sx - 22 * s, sy - 8 * s);
      ctx.lineTo(sx + 22 * s, sy - 8 * s);
      ctx.lineTo(sx + 14 * s, sy);
      ctx.lineTo(sx - 14 * s, sy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 46 * s);
      ctx.lineTo(sx + 18 * s, sy - 12 * s);
      ctx.lineTo(sx, sy - 12 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawForkSwitchSigns(
    ctx: CanvasRenderingContext2D,
    width: number,
    centerX: number,
    horizonY: number,
    trackBaseY: number,
    trainPose: { x: number; slope: number },
    fork: TrackFork,
    forkRelZ: number
  ): void {
    const nearFade = forkRelZ < 115 ? clamp01((forkRelZ - 30) / 85) : 1;
    const farFade = forkRelZ > 900 ? clamp01((1040 - forkRelZ) / 140) : 1;
    const fadeAlpha = nearFade * farFade;
    if (fadeAlpha <= 0.01) return;

    const branches: Array<{
      dir: BranchDir;
      button: CabinetButton;
      hex: string;
      icon: ControlIcon;
    }> = [
      { dir: 'left', button: 'RED', hex: '#EF5350', icon: 'forkLeft' },
      ...(fork.hasStraight
        ? [{ dir: 'straight' as const, button: 'BLUE' as const, hex: '#29B6F6', icon: 'forkStraight' as const }]
        : []),
      { dir: 'right', button: 'GREEN', hex: '#2ECC71', icon: 'forkRight' },
    ];

    const anchorWorldZ = Math.min(this.trackDist + Z_FAR - 40, fork.worldZ + 680);

    ctx.save();
    ctx.globalAlpha = fadeAlpha;

    for (const b of branches) {
      const targetWorldX = this.evalForkBranchX(fork, b.dir, anchorWorldZ);
      const trackPt = this.projectWorld(
        targetWorldX,
        anchorWorldZ,
        trainPose,
        centerX,
        horizonY,
        trackBaseY
      );

      const minSpread = b.dir === 'left' ? -168 : b.dir === 'right' ? 168 : 0;
      const bx = Math.max(
        96,
        Math.min(width - 96, lerp(centerX + minSpread, trackPt.sx, 0.65))
      );
      const isSelected = fork.selectedBranch === b.dir;
      const r = isSelected ? 27 : 22;
      const bounce = isSelected ? Math.sin(this.time * 7) * 5 : 0;
      const branchZone = fork.branchZones[b.dir];
      const topHeightFactor = branchZone === 'forest' ? 560 : 410;
      const landmarkTopY = trackPt.sy - topHeightFactor * trackPt.scale;
      const baseBadgeY = Math.max(66, Math.min(horizonY - 26, landmarkTopY - 46));
      const by = baseBadgeY + bounce - (b.dir === 'straight' ? 18 : 0);

      // Dashed pointer line from underneath the destination pill down toward the branch landmark!
      const pillBottomY = by + r + 28;
      const lineEndY = Math.max(pillBottomY + 12, landmarkTopY + 18);
      ctx.save();
      ctx.strokeStyle = isSelected ? '#FFF59D' : 'rgba(255,255,255,0.65)';
      ctx.lineWidth = isSelected ? 3.5 : 2.2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(bx, pillBottomY);
      ctx.lineTo(trackPt.sx, lineEndY);
      ctx.stroke();
      ctx.restore();

      // Chrome-bezel Colored Arcade Button Badge
      ctx.save();
      if (isSelected) {
        ctx.shadowColor = b.hex;
        ctx.shadowBlur = 24;
        ctx.strokeStyle = '#FFF59D';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(bx, by, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = '#ECEFF1';
      ctx.beginPath();
      ctx.arc(bx, by, r + 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = b.hex;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      this.drawSwitchArrowIcon(ctx, bx, by, b.dir, isSelected ? 1.15 : 0.95);

      // Clear Destination Scenery Label underneath (`DESERT`, `SNOW`, `FARM`, `BRIDGE`, `TUNNEL`)!
      const destTag = ZONE_PALETTES[fork.branchZones[b.dir]].shortTag;
      const pillW = 94;
      ctx.fillStyle = isSelected ? '#141926' : 'rgba(20, 25, 38, 0.85)';
      ctx.beginPath();
      ctx.roundRect(bx - pillW / 2, by + r + 6, pillW, 22, 11);
      ctx.fill();
      ctx.strokeStyle = b.hex;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#FFD54F' : '#FFFFFF';
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(destTag, bx, by + r + 17);
    }

    ctx.restore();
  }

  private drawSwitchArrowIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    dir: BranchDir,
    scale: number
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#141926';
    ctx.fillStyle = '#141926';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';

    if (dir === 'left') {
      ctx.beginPath();
      ctx.moveTo(3, 9);
      ctx.quadraticCurveTo(3, 0, -7, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, -8);
      ctx.lineTo(-1, -8);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
    } else if (dir === 'right') {
      ctx.beginPath();
      ctx.moveTo(-3, 9);
      ctx.quadraticCurveTo(-3, 0, 7, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(9, -8);
      ctx.lineTo(1, -8);
      ctx.lineTo(6, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.lineTo(0, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-6, -2);
      ctx.lineTo(6, -2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBoilerNoseAndSmoke(
    ctx: CanvasRenderingContext2D,
    trainPose: { x: number; slope: number },
    centerX: number,
    horizonY: number,
    trackBaseY: number,
    dashTopY: number
  ): void {
    const noseShift = clamp01(Math.abs(trainPose.slope)) * Math.sign(trainPose.slope) * 18;
    const bx = centerX + noseShift;
    const boilerTopFront = dashTopY - 98;
    const stackTopY = boilerTopFront - 36;

    // 3D Smoke puffs in world space
    for (const p of this.smokePuffs) {
      const pt = this.projectWorld(
        p.worldX,
        p.worldZ,
        trainPose,
        centerX,
        horizonY,
        trackBaseY
      );
      if (pt.z < 12) continue;
      const sy = pt.sy - (90 + p.y) * pt.scale;
      const rad = Math.max(4, p.radius * pt.scale * 1.9);
      const alpha = Math.max(0, 1 - p.age / p.maxAge) * 0.78;
      ctx.fillStyle = `rgba(242, 246, 252, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(pt.sx, sy, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#1C252C';
    ctx.beginPath();
    ctx.moveTo(bx - 14, boilerTopFront + 8);
    ctx.lineTo(bx - 18, stackTopY);
    ctx.lineTo(bx + 18, stackTopY);
    ctx.lineTo(bx + 14, boilerTopFront + 8);
    ctx.closePath();
    ctx.fill();

    const lift = this.hornActive ? -5 : 0;
    ctx.fillStyle = '#FFD54F';
    ctx.fillRect(bx - 36, boilerTopFront + 10 + lift, 9, 18 - lift);

    const boilerGrad = ctx.createLinearGradient(bx - 88, 0, bx + 88, 0);
    boilerGrad.addColorStop(0, '#1B232B');
    boilerGrad.addColorStop(0.5, '#37474F');
    boilerGrad.addColorStop(1, '#1B232B');
    ctx.fillStyle = boilerGrad;
    ctx.beginPath();
    ctx.moveTo(bx - 96, dashTopY + 8);
    ctx.quadraticCurveTo(bx - 68, boilerTopFront + 16, bx - 44, boilerTopFront + 4);
    ctx.quadraticCurveTo(bx, boilerTopFront - 8, bx + 44, boilerTopFront + 4);
    ctx.quadraticCurveTo(bx + 68, boilerTopFront + 16, bx + 96, dashTopY + 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx - 74, dashTopY - 34);
    ctx.quadraticCurveTo(bx, boilerTopFront + 18, bx + 74, dashTopY - 34);
    ctx.stroke();
  }

  private drawCabInterior(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    dashTopY: number,
    currentZone: SceneryZone,
    upcomingFork: TrackFork,
    forkRelZ: number
  ): void {
    const cabSwayX =
      Math.abs(this.velocity) > 8
        ? Math.sin(this.time * 7.5) * (1.8 * (Math.abs(this.velocity) / this.maxForwardSpeed))
        : 0;
    const cabSwayY =
      Math.abs(this.velocity) > 8
        ? Math.abs(Math.cos(this.time * 15)) * 1.6
        : 0;

    ctx.save();
    ctx.translate(cabSwayX, cabSwayY);

    // Cab Window Pillars & Roof Arch
    ctx.fillStyle = '#263238';
    ctx.fillRect(-10, -10, 38, dashTopY + 20);
    ctx.fillRect(width - 28, -10, 38, dashTopY + 20);
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(width + 10, -10);
    ctx.lineTo(width + 10, 48);
    ctx.quadraticCurveTo(width * 0.5, 16, -10, 48);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#6D4C41';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(26, 44);
    ctx.quadraticCurveTo(width * 0.5, 14, width - 26, 44);
    ctx.stroke();

    // Overhead Yellow Brass Whistle Pull-Cord
    const cordX = Math.max(96, width * 0.14);
    const pullPx = this.whistleCordPull * 24;
    ctx.strokeStyle = '#FDD835';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cordX, 26);
    ctx.lineTo(cordX, 98 + pullPx);
    ctx.stroke();

    ctx.fillStyle = this.hornActive ? '#FFF176' : '#FFB300';
    ctx.beginPath();
    ctx.roundRect(cordX - 16, 96 + pullPx, 32, 14, 7);
    ctx.fill();
    ctx.strokeStyle = '#5D4037';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Lower Cab Console
    const dashGrad = ctx.createLinearGradient(0, dashTopY, 0, height);
    dashGrad.addColorStop(0, '#2C3842');
    dashGrad.addColorStop(0.18, '#1E272E');
    dashGrad.addColorStop(1, '#13191E');
    ctx.fillStyle = dashGrad;
    ctx.fillRect(-10, dashTopY, width + 20, height - dashTopY + 12);

    const fireGlow = ctx.createRadialGradient(
      width * 0.46,
      height - 18,
      20,
      width * 0.46,
      height - 28,
      250
    );
    fireGlow.addColorStop(0, `rgba(255, 112, 34, ${(0.28 * this.fireIntensity).toFixed(2)})`);
    fireGlow.addColorStop(1, 'rgba(255, 112, 34, 0)');
    ctx.fillStyle = fireGlow;
    ctx.fillRect(0, dashTopY, width, height - dashTopY);

    ctx.fillStyle = '#5D4037';
    ctx.fillRect(-10, dashTopY - 6, width + 20, 12);
    ctx.fillStyle = '#90A4AE';
    for (let rx = 36; rx < width - 30; rx += 54) {
      ctx.beginPath();
      ctx.arc(rx, dashTopY + 14, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const dashH = height - dashTopY;

    this.drawThrottleAndSwitchPanel(
      ctx,
      Math.round(width * 0.17),
      dashTopY + dashH * 0.54,
      currentZone,
      upcomingFork,
      forkRelZ
    );

    this.drawFirebox(ctx, Math.round(width * 0.43), height + 2, Math.min(185, dashH * 0.84));

    this.drawSpeedAndSteamGauges(
      ctx,
      Math.round(width * 0.63),
      dashTopY + dashH * 0.48,
      Math.min(62, dashH * 0.34)
    );

    this.drawConductorCharacter(
      ctx,
      Math.round(width * 0.84),
      dashTopY + 18,
      dashH
    );

    ctx.restore();
  }

  private drawThrottleAndSwitchPanel(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    currentZone: SceneryZone,
    fork: TrackFork,
    forkRelZ: number
  ): void {
    ctx.fillStyle = '#182026';
    ctx.beginPath();
    ctx.roundRect(cx - 115, cy - 68, 230, 126, 14);
    ctx.fill();
    ctx.strokeStyle = '#607D8B';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const slotX = cx - 58;
    ctx.fillStyle = '#0D1216';
    ctx.beginPath();
    ctx.roundRect(slotX - 10, cy - 46, 20, 88, 10);
    ctx.fill();
    ctx.strokeStyle = '#90A4AE';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#A5D6A7';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FWD ▲', slotX, cy - 53);
    ctx.fillStyle = '#FFAB91';
    ctx.fillText('REV ▼', slotX, cy + 53);

    const knobY = cy - this.throttleLeverSmoothed * 34;
    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(slotX, cy + 28);
    ctx.lineTo(slotX, knobY);
    ctx.stroke();

    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.roundRect(slotX - 22, knobY - 10, 44, 20, 8);
    ctx.fill();
    ctx.strokeStyle = '#FFD54F';
    ctx.lineWidth = 2;
    ctx.stroke();

    const lampCenterX = cx + 44;
    ctx.fillStyle = '#CFD8DC';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SWITCH SIGNAL', lampCenterX, cy - 48);

    const activeBranch =
      forkRelZ > 0 && forkRelZ < Z_FAR ? fork.selectedBranch : this.conductorSignal;

    const lamps: Array<{ dir: BranchDir; lx: number; ly: number; color: string; enabled: boolean }> = [
      { dir: 'left', lx: lampCenterX - 38, ly: cy - 4, color: '#EF5350', enabled: true },
      {
        dir: 'straight',
        lx: lampCenterX,
        ly: cy - 18,
        color: '#29B6F6',
        enabled: forkRelZ <= 0 || forkRelZ >= Z_FAR || fork.hasStraight,
      },
      { dir: 'right', lx: lampCenterX + 38, ly: cy - 4, color: '#2ECC71', enabled: true },
    ];

    for (const l of lamps) {
      const lit = activeBranch === l.dir && l.enabled;
      ctx.save();
      if (lit) {
        ctx.shadowColor = l.color;
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = '#90A4AE';
      ctx.beginPath();
      ctx.arc(l.lx, l.ly, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = l.enabled ? (lit ? 1 : 0.35) : 0.14;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(l.lx, l.ly, 13, 0, Math.PI * 2);
      ctx.fill();
      this.drawSwitchArrowIcon(ctx, l.lx, l.ly, l.dir, 0.72);
      ctx.restore();
    }

    const targetZone =
      forkRelZ > 0 && forkRelZ < 1150
        ? fork.branchZones[fork.selectedBranch]
        : currentZone;
    const panelText =
      forkRelZ > 0 && forkRelZ < 1150
        ? `→ ${ZONE_PALETTES[targetZone].name}`
        : ZONE_PALETTES[currentZone].name;
    ctx.fillStyle = '#FFD54F';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(panelText, lampCenterX, cy + 36);
  }

  private drawFirebox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bottomY: number,
    boxH: number
  ): void {
    const boxW = 176;
    const archTopY = bottomY - boxH;

    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.moveTo(cx - boxW / 2 - 14, bottomY);
    ctx.lineTo(cx - boxW / 2 - 14, archTopY + 52);
    ctx.quadraticCurveTo(cx, archTopY - 22, cx + boxW / 2 + 14, archTopY + 52);
    ctx.lineTo(cx + boxW / 2 + 14, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#546E7A';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#FFB300';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FIREBOX', cx, archTopY + 8);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - boxW / 2, bottomY);
    ctx.lineTo(cx - boxW / 2, archTopY + 56);
    ctx.quadraticCurveTo(cx, archTopY, cx + boxW / 2, archTopY + 56);
    ctx.lineTo(cx + boxW / 2, bottomY);
    ctx.closePath();
    ctx.fillStyle = '#1A0905';
    ctx.fill();
    ctx.clip();

    const innerGlow = ctx.createRadialGradient(
      cx,
      bottomY - 12,
      10,
      cx,
      bottomY - 30,
      boxW * (0.55 + this.fireIntensity * 0.4)
    );
    innerGlow.addColorStop(0, '#FFF176');
    innerGlow.addColorStop(0.45, '#FF6D00');
    innerGlow.addColorStop(1, 'rgba(183, 28, 28, 0.15)');
    ctx.fillStyle = innerGlow;
    ctx.fillRect(cx - boxW, archTopY, boxW * 2, boxH);

    const flameCount = 7;
    for (let f = 0; f < flameCount; f++) {
      const fx = cx - boxW * 0.38 + (f / (flameCount - 1)) * boxW * 0.76;
      const flicker =
        Math.sin(this.time * (8 + f * 1.7) + f) * 12 +
        Math.cos(this.time * 13 - f * 2.1) * 7;
      const fh = (34 + this.fireIntensity * 88) * (0.75 + Math.sin(f * 1.4) * 0.25) + flicker;

      ctx.fillStyle = f % 2 === 0 ? '#FF9100' : '#FF3D00';
      ctx.beginPath();
      ctx.moveTo(fx - 22, bottomY - 10);
      ctx.quadraticCurveTo(fx - 8, bottomY - fh * 0.65, fx + flicker * 0.35, bottomY - fh);
      ctx.quadraticCurveTo(fx + 8, bottomY - fh * 0.65, fx + 22, bottomY - 10);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FFF59D';
      ctx.beginPath();
      ctx.moveTo(fx - 11, bottomY - 8);
      ctx.quadraticCurveTo(fx, bottomY - fh * 0.62, fx + 11, bottomY - 8);
      ctx.closePath();
      ctx.fill();
    }

    const coalColors = ['#D50000', '#FF6D00', '#FFAB00'];
    for (let c = 0; c < 11; c++) {
      const coalX = cx - boxW * 0.44 + c * (boxW * 0.088);
      ctx.fillStyle = coalColors[c % coalColors.length];
      ctx.beginPath();
      ctx.arc(coalX, bottomY - 8 - (c % 2) * 5, 13, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const em of this.embers) {
      const ex = cx + em.nx * (boxW * 0.42);
      const ey = bottomY - 16 - em.ny * (boxH - 28);
      ctx.fillStyle = '#FFE082';
      ctx.beginPath();
      ctx.arc(ex, ey, em.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(26, 15, 12, 0.72)';
    ctx.lineWidth = 5;
    for (let gx = -boxW * 0.38; gx <= boxW * 0.38; gx += 26) {
      ctx.beginPath();
      ctx.moveTo(cx + gx, bottomY);
      ctx.lineTo(cx + gx, bottomY - 32);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawSpeedAndSteamGauges(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    speedRadius: number
  ): void {
    const r = Math.max(48, speedRadius);
    const dialX = cx - 26;

    ctx.fillStyle = '#D4A017';
    ctx.beginPath();
    ctx.arc(dialX, cy, r + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(dialX, cy - 1, r + 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFDE7';
    ctx.beginPath();
    ctx.arc(dialX, cy, r, 0, Math.PI * 2);
    ctx.fill();

    const startAngle = Math.PI * 0.75;
    const sweepAngle = Math.PI * 1.5;
    const arcSegments: Array<[number, number, string]> = [
      [0, 0.5, '#66BB6A'],
      [0.5, 0.8, '#FFA726'],
      [0.8, 1.0, '#EF5350'],
    ];
    ctx.lineWidth = 7;
    for (const [f0, f1, col] of arcSegments) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(
        dialX,
        cy,
        r - 9,
        startAngle + sweepAngle * f0,
        startAngle + sweepAngle * f1
      );
      ctx.stroke();
    }

    ctx.strokeStyle = '#37474F';
    ctx.lineWidth = 2;
    for (let t = 0; t <= 8; t++) {
      const a = startAngle + (sweepAngle * t) / 8;
      ctx.beginPath();
      ctx.moveTo(dialX + Math.cos(a) * (r - 15), cy + Math.sin(a) * (r - 15));
      ctx.lineTo(dialX + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
    }

    ctx.fillStyle = '#263238';
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPEED', dialX, cy - r * 0.34);

    const dirText =
      this.velocity > 6 ? 'FWD ▲' : this.velocity < -6 ? 'REV ▼' : 'STOP';
    ctx.fillStyle =
      this.velocity > 6 ? '#2E7D32' : this.velocity < -6 ? '#D84315' : '#546E7A';
    ctx.font = '900 11px system-ui, sans-serif';
    ctx.fillText(dirText, dialX, cy + r * 0.52);

    const speedRatio = Math.min(1, Math.abs(this.velocity) / this.maxForwardSpeed);
    const needleAngle = startAngle + sweepAngle * speedRatio;
    ctx.save();
    ctx.translate(dialX, cy);
    ctx.rotate(needleAngle);
    ctx.strokeStyle = '#D32F2F';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(r - 12, 0);
    ctx.stroke();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Steam Pressure Gauge
    const steamX = cx + r + 28;
    const steamY = cy - 8;
    const sr = Math.round(r * 0.54);

    ctx.fillStyle = '#D4A017';
    ctx.beginPath();
    ctx.arc(steamX, steamY, sr + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFDE7';
    ctx.beginPath();
    ctx.arc(steamX, steamY, sr, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#37474F';
    ctx.font = '800 9px system-ui, sans-serif';
    ctx.fillText('STEAM', steamX, steamY + sr * 0.45);

    const quiver = Math.sin(this.time * 18) * 0.03 * this.fireIntensity;
    const steamAngle =
      Math.PI * 0.8 + Math.PI * 1.4 * Math.min(1, this.steamPressure + quiver);
    ctx.save();
    ctx.translate(steamX, steamY);
    ctx.rotate(steamAngle);
    ctx.strokeStyle = '#1E88E5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(sr - 6, 0);
    ctx.stroke();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawConductorCharacter(
    ctx: CanvasRenderingContext2D,
    cx: number,
    seatTopY: number,
    dashH: number
  ): void {
    const signal = this.conductorSignal;
    const isActivelyWaving = this.signalWaveTimer > 0;
    const waveWiggle =
      Math.sin(this.time * (isActivelyWaving ? 13 : 5.5)) *
      (isActivelyWaving ? 0.22 : 0.08);
    const lean = signal === 'left' ? -8 : signal === 'right' ? 8 : 0;

    const torsoY = seatTopY + Math.min(62, dashH * 0.32);

    ctx.save();
    ctx.translate(cx + lean, torsoY);

    if (signal === 'left') {
      this.drawFlagArm(ctx, -26, -6, Math.PI + waveWiggle, '#EF5350');
      this.drawRestingArm(ctx, 26, -2, 1);
    } else if (signal === 'right') {
      this.drawRestingArm(ctx, -26, -2, -1);
      this.drawFlagArm(ctx, 26, -6, waveWiggle, '#2ECC71');
    } else {
      this.drawFlagArm(ctx, 18, -14, -Math.PI * 0.5 + waveWiggle, '#29B6F6');
      ctx.strokeStyle = '#1565C0';
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-22, -8);
      ctx.lineTo(-34, -42);
      ctx.stroke();
      ctx.fillStyle = '#FFCCBC';
      ctx.beginPath();
      ctx.arc(-35, -45, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#1976D2';
    ctx.beginPath();
    ctx.roundRect(-30, -18, 60, 74, [16, 16, 4, 4]);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2.5;
    for (let sx = -20; sx <= 20; sx += 10) {
      ctx.beginPath();
      ctx.moveTo(sx, -14);
      ctx.lineTo(sx, 52);
      ctx.stroke();
    }

    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(-14, 0, 4, 0, Math.PI * 2);
    ctx.arc(14, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.moveTo(-18, -18);
    ctx.lineTo(18, -18);
    ctx.lineTo(0, 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FFCCBC';
    ctx.beginPath();
    ctx.arc(0, -40, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(244, 143, 177, 0.45)';
    ctx.beginPath();
    ctx.arc(-12, -36, 4, 0, Math.PI * 2);
    ctx.arc(12, -36, 4, 0, Math.PI * 2);
    ctx.fill();

    const eyeShift = signal === 'left' ? -3 : signal === 'right' ? 3 : 0;
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.arc(-7 + eyeShift, -43, 2.8, 0, Math.PI * 2);
    ctx.arc(7 + eyeShift, -43, 2.8, 0, Math.PI * 2);
    ctx.fill();

    if (this.hornActive) {
      ctx.fillStyle = '#BF360C';
      ctx.beginPath();
      ctx.arc(eyeShift, -32, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, -37, 8, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    ctx.fillStyle = '#1565C0';
    ctx.beginPath();
    ctx.arc(0, -49, 22, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#0D47A1';
    ctx.beginPath();
    ctx.roundRect(-24, -53, 48, 7, 3);
    ctx.fill();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.ellipse(0, -46, 22, 4.5, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(0, -58, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawFlagArm(
    ctx: CanvasRenderingContext2D,
    shoulderX: number,
    shoulderY: number,
    angle: number,
    flagColor: string
  ): void {
    ctx.save();
    ctx.translate(shoulderX, shoulderY);
    ctx.rotate(angle);

    ctx.strokeStyle = '#1565C0';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(38, 0);
    ctx.stroke();

    ctx.fillStyle = '#FFCCBC';
    ctx.beginPath();
    ctx.arc(41, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#8D6E63';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(41, 8);
    ctx.lineTo(41, -44);
    ctx.stroke();

    const flutter = Math.sin(this.time * 14) * 4;
    ctx.fillStyle = flagColor;
    ctx.beginPath();
    ctx.moveTo(41, -43);
    ctx.quadraticCurveTo(58, -38 + flutter, 74, -31);
    ctx.lineTo(41, -18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.restore();
  }

  private drawRestingArm(
    ctx: CanvasRenderingContext2D,
    shoulderX: number,
    shoulderY: number,
    side: -1 | 1
  ): void {
    ctx.strokeStyle = '#1565C0';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(shoulderX + side * 12, shoulderY + 28);
    ctx.stroke();

    ctx.fillStyle = '#FFCCBC';
    ctx.beginPath();
    ctx.arc(shoulderX + side * 12, shoulderY + 31, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const conductorGameDefinition: ArcadeGameDefinition<ConductorAction> = {
  id: 'conductor-pov',
  title: 'Cab Conductor',
  subtitle: 'Steer track switches from the cab!',
  accentColor: '#FFB300',
  developmental: {
    parentCategory: 'Paths & Choices',
    primaryTags: ['C1', 'C3'],
    secondaryTags: ['A2', 'G1'],
  },
  controls: [
    { action: 'switchPort', button: 'RED', label: 'Port (Left)', icon: 'forkLeft' },
    { action: 'switchStraight', button: 'BLUE', label: 'Ahead', icon: 'forkStraight' },
    { action: 'switchStarboard', button: 'GREEN', label: 'Starboard', icon: 'forkRight' },
    { action: 'horn', button: 'YELLOW', label: 'Whistle', icon: 'horn' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const horizonY = height * 0.38;
    const dashY = height * 0.72;
    const cx = width * 0.5;

    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, '#42A5F5');
    sky.addColorStop(1, '#E1F5FE');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY);

    ctx.fillStyle = '#7CB342';
    ctx.fillRect(0, horizonY, width, dashY - horizonY);

    ctx.strokeStyle = '#4E342E';
    ctx.lineWidth = 4;
    for (let y = horizonY + 12; y < dashY; y += 12) {
      const t = (y - horizonY) / (dashY - horizonY);
      const w = 14 + t * 72;
      ctx.beginPath();
      ctx.moveTo(cx - w, y);
      ctx.lineTo(cx + w, y);
      ctx.stroke();
    }

    const branchSpecs: Array<[number, string]> = [
      [-56, '#EF5350'],
      [0, '#29B6F6'],
      [56, '#2ECC71'],
    ];
    for (const [targetOff, col] of branchSpecs) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - 18, dashY);
      ctx.quadraticCurveTo(cx, (horizonY + dashY) * 0.52, cx + targetOff - 5, horizonY + 8);
      ctx.moveTo(cx + 18, dashY);
      ctx.quadraticCurveTo(cx, (horizonY + dashY) * 0.52, cx + targetOff + 5, horizonY + 8);
      ctx.stroke();

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + targetOff, horizonY - 4, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#1E272E';
    ctx.fillRect(0, dashY, width, height - dashY);
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(0, dashY - 4, width, 6);

    const flicker = selected ? Math.sin(timeSec * 12) * 3 : 0;
    ctx.fillStyle = '#FF6D00';
    ctx.beginPath();
    ctx.arc(cx - 28, height - 10, 22 + flicker * 0.4, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#FFF176';
    ctx.beginPath();
    ctx.arc(cx - 28, height - 10, 12, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(cx + 34, dashY + 26, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFDE7';
    ctx.beginPath();
    ctx.arc(cx + 34, dashY + 26, 14, 0, Math.PI * 2);
    ctx.fill();
    const needleA = -0.8 + (selected ? Math.sin(timeSec * 3) * 0.7 : 0.3);
    ctx.strokeStyle = '#D32F2F';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + 34, dashY + 26);
    ctx.lineTo(cx + 34 + Math.cos(needleA) * 11, dashY + 26 + Math.sin(needleA) * 11);
    ctx.stroke();
  },
  create(context) {
    return new ConductorCabGame(context);
  },
};
