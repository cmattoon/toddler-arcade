/**
 * Contributor Specification (per toddler-arcade-developmental-guide.md):
 *
 * world: shape-spinner
 * activity: single-3d-shape-color-and-spin
 * primary_tags: [A1, C1]
 * secondary_tags: [B2, G1]
 * concept:
 *   - One large, calm 3D geometric block in the center of the screen responds directly to every control without visual clutter.
 *   - Colored buttons choose its color, white shape buttons choose its shape, and the joystick tumbles/spins it in 3D:
 *     UP/DOWN rotates around the horizontal axis (UP = bottom comes up; DOWN = top comes down),
 *     LEFT/RIGHT rotates around the vertical axis, and diagonals smoothly spin on diagonal axes.
 * child_action: "Move the joystick up, down, left, right, or diagonally to spin the 3D shape in three dimensions; press colored buttons to change its color and white buttons to change its shape."
 * complexity_step: "Explore direct 3D spatial cause-and-effect across horizontal, vertical, and diagonal rotation axes along with shape and color choice."
 * not_complexity: "No distractions, background clutter, timers, or wrong buttons."
 * feedback: "The chunky 3D block smoothly accelerates around the exact axis pushed, catches warm 3D light on its beveled sides, coasts with soft wooden spinner ticks, and pops gently when changing shape or color."
 * real_world_extension: "Turn a wooden shape block over in your hands—tipping the bottom up, the top down, and spinning it side to side."
 */

import { CABINET_COLOR_COLUMNS, CABINET_COLOR_PALETTE } from '../../core/shapes';
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

type SpinnerAction = 'colorRed' | 'colorGreen' | 'colorBlue' | 'colorYellow';

interface Vec2 {
  x: number;
  y: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Row-major 3x3 orthonormal rotation matrix */
type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

interface ShapeContour {
  /** Closed clockwise 2D perimeter vertices normalized to ~[-1, 1] */
  verts: Vec2[];
  /** Outward 2D unit normal for edge i -> (i + 1) % N */
  edgeNormals: Vec2[];
}

const COLOR_NOTES: Record<MergedColorButton, number> = {
  RED: 261.63, // C4
  GREEN: 329.63, // E4
  BLUE: 392.0, // G4
  YELLOW: 523.25, // C5
};

/** Warm directional light from upper-left-front (screen space: -X left, -Y up, +Z toward viewer) */
const LIGHT_DIR: Vec3 = (() => {
  const lx = -0.42;
  const ly = -0.54;
  const lz = 0.73;
  const len = Math.hypot(lx, ly, lz);
  return { x: lx / len, y: ly / len, z: lz / len };
})();

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const cl = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * cl);
  const g = Math.round(a[1] + (b[1] - a[1]) * cl);
  const bl = Math.round(a[2] + (b[2] - a[2]) * cl);
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * Builds a subdivided, softly filleted closed polygon from sharp control corners so
 * 3D extruded side walls catch light smoothly around every corner.
 */
function buildFilletedPolygon(
  corners: Vec2[],
  filletDist: number,
  cornerSteps: number,
  edgeSteps: number
): Vec2[] {
  const pts: Vec2[] = [];
  const n = corners.length;

  const cornerTrim = corners.map((curr, i) => {
    const prev = corners[(i - 1 + n) % n];
    const next = corners[(i + 1) % n];
    const dxPrev = prev.x - curr.x;
    const dyPrev = prev.y - curr.y;
    const lenPrev = Math.hypot(dxPrev, dyPrev) || 1;
    const dxNext = next.x - curr.x;
    const dyNext = next.y - curr.y;
    const lenNext = Math.hypot(dxNext, dyNext) || 1;

    const d = Math.min(filletDist, lenPrev * 0.35, lenNext * 0.35);
    return {
      inPt: { x: curr.x + (dxPrev / lenPrev) * d, y: curr.y + (dyPrev / lenPrev) * d },
      ctrl: curr,
      outPt: { x: curr.x + (dxNext / lenNext) * d, y: curr.y + (dyNext / lenNext) * d },
    };
  });

  for (let i = 0; i < n; i++) {
    const { inPt, ctrl, outPt } = cornerTrim[i];
    // Quadratic Bezier round corner
    for (let s = 0; s < cornerSteps; s++) {
      const t = s / cornerSteps;
      const omt = 1 - t;
      pts.push({
        x: omt * omt * inPt.x + 2 * omt * t * ctrl.x + t * t * outPt.x,
        y: omt * omt * inPt.y + 2 * omt * t * ctrl.y + t * t * outPt.y,
      });
    }
    // Subdivided straight edge to next corner's inPt
    const nextIn = cornerTrim[(i + 1) % n].inPt;
    for (let s = 0; s < edgeSteps; s++) {
      const t = s / edgeSteps;
      pts.push({
        x: outPt.x + (nextIn.x - outPt.x) * t,
        y: outPt.y + (nextIn.y - outPt.y) * t,
      });
    }
  }

  return pts;
}

function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}

function buildRawShapeVerts(shape: ShapeKind): Vec2[] {
  if (shape === 'circle') {
    const pts: Vec2[] = [];
    const count = 64;
    const rad = 0.84;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
    }
    return pts;
  }

  if (shape === 'square') {
    const s = 0.78;
    return buildFilletedPolygon(
      [
        { x: -s, y: -s },
        { x: s, y: -s },
        { x: s, y: s },
        { x: -s, y: s },
      ],
      0.11,
      5,
      8
    );
  }

  if (shape === 'triangle') {
    const h = 0.94;
    return buildFilletedPolygon(
      [
        { x: 0, y: -h },
        { x: h * 0.95, y: h * 0.76 },
        { x: -h * 0.95, y: h * 0.76 },
      ],
      0.11,
      6,
      11
    );
  }

  if (shape === 'diamond') {
    const d = 0.95;
    return buildFilletedPolygon(
      [
        { x: 0, y: -d },
        { x: d * 0.86, y: 0 },
        { x: 0, y: d },
        { x: -d * 0.86, y: 0 },
      ],
      0.1,
      5,
      8
    );
  }

  if (shape === 'star') {
    const outer = 0.98;
    const inner = 0.43;
    const corners: Vec2[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      corners.push({
        x: Math.cos(angle) * rad,
        y: Math.sin(angle) * rad + 0.05,
      });
    }
    return buildFilletedPolygon(corners, 0.055, 3, 4);
  }

  // Heart (sampled smoothly along the two symmetric cubic lobes)
  const s = 0.92;
  const bottom: Vec2 = { x: 0, y: s * 0.84 };
  const top: Vec2 = { x: 0, y: -s * 0.32 };
  const pts: Vec2[] = [];
  const halfSteps = 32;
  for (let i = 0; i < halfSteps; i++) {
    const t = i / halfSteps;
    pts.push(
      cubicBezier(
        bottom,
        { x: -s * 1.18, y: s * 0.14 },
        { x: -s * 1.05, y: -s * 0.86 },
        top,
        t
      )
    );
  }
  for (let i = 0; i < halfSteps; i++) {
    const t = i / halfSteps;
    pts.push(
      cubicBezier(
        top,
        { x: s * 1.05, y: -s * 0.86 },
        { x: s * 1.18, y: s * 0.14 },
        bottom,
        t
      )
    );
  }
  return pts;
}

function buildShapeContour(shape: ShapeKind): ShapeContour {
  const verts = buildRawShapeVerts(shape);

  // Ensure clockwise winding in screen coordinates (x right, y down => signed area > 0)
  let area2 = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (area2 < 0) {
    verts.reverse();
  }

  const edgeNormals: Vec2[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Clockwise in (x right, y down) => outward normal is (+dy, -dx)
    edgeNormals.push({ x: dy / len, y: -dx / len });
  }

  return { verts, edgeNormals };
}

const SHAPE_CONTOURS: Record<ShapeKind, ShapeContour> = {
  square: buildShapeContour('square'),
  circle: buildShapeContour('circle'),
  triangle: buildShapeContour('triangle'),
  diamond: buildShapeContour('diamond'),
  star: buildShapeContour('star'),
  heart: buildShapeContour('heart'),
};

function createIdentityMat3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/**
 * Rodrigues' 3D rotation matrix around unit axis (ux, uy, 0) by angle `alpha` radians.
 */
function axisAngleXYMat3(ux: number, uy: number, alpha: number): Mat3 {
  const c = Math.cos(alpha);
  const s = Math.sin(alpha);
  const omc = 1 - c;
  return [
    c + ux * ux * omc, ux * uy * omc, uy * s,
    uy * ux * omc, c + uy * uy * omc, -ux * s,
    -uy * s, ux * s, c,
  ];
}

/** Re-orthonormalizes a 3x3 rotation matrix via Gram-Schmidt so floating-point drift never accumulates */
function orthonormalizeMat3(m: Mat3): Mat3 {
  // Row 0
  let r0x = m[0], r0y = m[1], r0z = m[2];
  const l0 = Math.hypot(r0x, r0y, r0z) || 1;
  r0x /= l0; r0y /= l0; r0z /= l0;

  // Row 1 orthogonal to Row 0
  const dot01 = r0x * m[3] + r0y * m[4] + r0z * m[5];
  let r1x = m[3] - dot01 * r0x;
  let r1y = m[4] - dot01 * r0y;
  let r1z = m[5] - dot01 * r0z;
  const l1 = Math.hypot(r1x, r1y, r1z) || 1;
  r1x /= l1; r1y /= l1; r1z /= l1;

  // Row 2 = Row 0 x Row 1
  const r2x = r0y * r1z - r0z * r1y;
  const r2y = r0z * r1x - r0x * r1z;
  const r2z = r0x * r1y - r0y * r1x;

  return [r0x, r0y, r0z, r1x, r1y, r1z, r2x, r2y, r2z];
}

function transformVec3(m: Mat3, x: number, y: number, z: number): Vec3 {
  return {
    x: m[0] * x + m[1] * y + m[2] * z,
    y: m[3] * x + m[4] * y + m[5] * z,
    z: m[6] * x + m[7] * y + m[8] * z,
  };
}

/**
 * Renders the extruded 3D geometric block with perspective, directional lighting,
 * smooth side facets, and inlaid front & back caps.
 */
function renderExtruded3DShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  shape: ShapeKind,
  color: MergedColorButton,
  rot: Mat3
): void {
  const contour = SHAPE_CONTOURS[shape];
  const verts = contour.verts;
  const n = verts.length;

  const pal = CABINET_COLOR_PALETTE[color];
  const faceRgb = hexToRgb(pal.face);
  const lightRgb = hexToRgb(pal.light);
  const darkRgb = hexToRgb(pal.dark);
  const whiteRgb: [number, number, number] = [255, 255, 255];

  const halfDepth = radius * 0.28;
  const camDist = radius * 4.3;

  const project = (p: Vec3): Vec2 => {
    const scale = camDist / Math.max(radius * 0.8, camDist - p.z);
    return {
      x: cx + p.x * scale,
      y: cy + p.y * scale,
    };
  };

  // Transform front (+halfDepth) and back (-halfDepth) perimeter rings
  const front3D: Vec3[] = new Array(n);
  const back3D: Vec3[] = new Array(n);
  const front2D: Vec2[] = new Array(n);
  const back2D: Vec2[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const vx = verts[i].x * radius;
    const vy = verts[i].y * radius;
    const f3 = transformVec3(rot, vx, vy, halfDepth);
    const b3 = transformVec3(rot, vx, vy, -halfDepth);
    front3D[i] = f3;
    back3D[i] = b3;
    front2D[i] = project(f3);
    back2D[i] = project(b3);
  }

  // Build & depth-sort the N extruded side quads (painter's algorithm back-to-front)
  const quads: Array<{ idx: number; midZ: number }> = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const midZ = (front3D[i].z + front3D[j].z + back3D[j].z + back3D[i].z) * 0.25;
    quads[i] = { idx: i, midZ };
  }
  quads.sort((a, b) => a.midZ - b.midZ);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let q = 0; q < n; q++) {
    const i = quads[q].idx;
    const j = (i + 1) % n;

    const en = contour.edgeNormals[i];
    const wn = transformVec3(rot, en.x, en.y, 0);
    const ndotl = wn.x * LIGHT_DIR.x + wn.y * LIGHT_DIR.y + wn.z * LIGHT_DIR.z;

    // Warm bevel shading across side facets
    let sideColor: string;
    if (ndotl >= 0) {
      sideColor = mixRgb(faceRgb, lightRgb, ndotl * 0.62);
    } else {
      sideColor = mixRgb(faceRgb, darkRgb, Math.min(1, 0.35 + (-ndotl) * 0.65));
    }

    const p0 = front2D[i];
    const p1 = front2D[j];
    const p2 = back2D[j];
    const p3 = back2D[i];

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();

    ctx.fillStyle = sideColor;
    ctx.fill();
    // Hairline seam stroke in identical color prevents subpixel gaps between adjacent facets
    ctx.strokeStyle = sideColor;
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }

  // Check which planar cap (if any) faces the perspective camera at (0, 0, camDist).
  // Because the prism lies strictly in -halfDepth <= z_local <= +halfDepth and camDist > halfDepth,
  // at most ONE cap ever faces the camera, and that visible cap is strictly closer than all side walls!
  const frontNormal = transformVec3(rot, 0, 0, 1);
  const frontCenter = transformVec3(rot, 0, 0, halfDepth);
  const frontFacingDot =
    frontNormal.x * -frontCenter.x +
    frontNormal.y * -frontCenter.y +
    frontNormal.z * (camDist - frontCenter.z);

  const backNormal = { x: -frontNormal.x, y: -frontNormal.y, z: -frontNormal.z };
  const backCenter = { x: -frontCenter.x, y: -frontCenter.y, z: -frontCenter.z };
  const backFacingDot =
    backNormal.x * -backCenter.x +
    backNormal.y * -backCenter.y +
    backNormal.z * (camDist - backCenter.z);

  const drawCap = (isFront: boolean, cap2D: Vec2[], normal: Vec3) => {
    const zSign = isFront ? 1 : -1;
    const zLocal = zSign * halfDepth;
    const ndotl = normal.x * LIGHT_DIR.x + normal.y * LIGHT_DIR.y + normal.z * LIGHT_DIR.z;

    const capFill =
      ndotl >= 0
        ? mixRgb(faceRgb, whiteRgb, ndotl * 0.16)
        : mixRgb(faceRgb, darkRgb, (-ndotl) * 0.35);

    // 1. Main cap polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(cap2D[i].x, cap2D[i].y);
      else ctx.lineTo(cap2D[i].x, cap2D[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = capFill;
    ctx.fill();

    // 2. Perspective-projected concentric inner inlay + orientation pearl
    const inlayScale = 0.55;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p3 = transformVec3(
        rot,
        verts[i].x * radius * inlayScale,
        verts[i].y * radius * inlayScale,
        zLocal
      );
      const p2 = project(p3);
      if (i === 0) ctx.moveTo(p2.x, p2.y);
      else ctx.lineTo(p2.x, p2.y);
    }
    ctx.closePath();
    ctx.fillStyle = isFront ? pal.light : '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = isFront ? '#FFFFFF' : pal.light;
    ctx.lineWidth = Math.max(2.2, radius * 0.032);
    ctx.stroke();

    // Orientation pearl near the top of the face (makes Circle 3D spin & flip crystal clear!)
    const pearlCenter3 = transformVec3(rot, 0, -radius * 0.67, zLocal);
    const pearlRight3 = transformVec3(rot, radius * 0.068, -radius * 0.67, zLocal);
    const pearlUp3 = transformVec3(rot, 0, -radius * (0.67 + 0.068), zLocal);
    const pc = project(pearlCenter3);
    const pr = project(pearlRight3);
    const pu = project(pearlUp3);

    // Draw perspective-foreshortened circular pearl via affine transform on unit circle
    ctx.save();
    ctx.transform(pr.x - pc.x, pr.y - pc.y, pu.x - pc.x, pu.y - pc.y, pc.x, pc.y);
    ctx.fillStyle = isFront ? '#FFFFFF' : pal.face;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. Crisp outer bevel rim around the cap
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(cap2D[i].x, cap2D[i].y);
      else ctx.lineTo(cap2D[i].x, cap2D[i].y);
    }
    ctx.closePath();
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = Math.max(3.5, radius * 0.045);
    ctx.stroke();
  };

  if (frontFacingDot > 0) {
    drawCap(true, front2D, frontNormal);
  } else if (backFacingDot > 0) {
    drawCap(false, back2D, backNormal);
  }

  ctx.restore();
}

class ShapeSpinnerGame implements ArcadeGameInstance<SpinnerAction> {
  private audio: GameContext['audio'];

  private activeColor: MergedColorButton = 'BLUE';
  private activeShapeBtn: ShapeButton = 'X5'; // Star

  /** Orthonormal 3D orientation matrix (initialized with a welcoming slight 3D tilt!) */
  private rot: Mat3 = (() => {
    const tiltYaw = axisAngleXYMat3(0, 1, 0.28);
    const tiltPitch = axisAngleXYMat3(-1, 0, 0.2);
    return orthonormalizeMat3(multiplyMat3(tiltPitch, tiltYaw));
  })();

  /**
   * Viewer-space spin rates (rad/sec):
   * - velX: horizontal-axis spin (+ = DOWN/top comes down, - = UP/bottom comes up)
   * - velY: vertical-axis spin (+ = RIGHT, - = LEFT)
   */
  private velX = 0;
  private velY = 0;
  private lastDirX = 0.85;
  private lastDirY = -0.52;

  /** Accumulates 3D rotation angle for soft wooden spinner ticks */
  private tickAngleAccum = 0;

  /** Subtle pop scale when switching shape or color */
  private popScale = 1;

  constructor(context: GameContext) {
    this.audio = context.audio;
  }

  public getDeckOverride(): DeckVisualOverride {
    return {
      colorMode: 'merged4',
      columnLabels: {
        RED: 'Red',
        GREEN: 'Green',
        BLUE: 'Blue',
        YELLOW: 'Yellow',
      },
      shapesActive: true,
      selectedShape: this.activeShapeBtn,
    };
  }

  public getFlashingButtons(): CabinetButton[] {
    return [];
  }

  public onPointerDown(x: number, y: number, width: number, height: number): void {
    const dx = x - width * 0.5;
    const dy = y - height * 0.5;
    const len = Math.hypot(dx, dy);
    const nx = len > 12 ? dx / len : this.lastDirX;
    const ny = len > 12 ? dy / len : this.lastDirY;

    this.lastDirX = nx;
    this.lastDirY = ny;
    this.velY = Math.max(-8.5, Math.min(8.5, this.velY + nx * 4.2));
    this.velX = Math.max(-8.5, Math.min(8.5, this.velX + ny * 4.2));
    this.popScale = 1.08;
    this.audio.playSpinnerTick(0.7);
  }

  public update(dt: number, input: GameInput<SpinnerAction>): void {
    // 1. 6 White Shape Buttons (X1..X6): directly set the 3D block's shape
    SHAPE_BUTTON_LIST.forEach((sBtn, idx) => {
      if (input.justPressedButton(sBtn)) {
        this.activeShapeBtn = sBtn;
        this.popScale = 1.15;
        this.audio.playShapeSparkle(idx);
      }
    });

    // 2. 4 Colored Buttons (RED, GREEN, BLUE, YELLOW): directly set the 3D block's color
    const colorMap: Array<{ action: SpinnerAction; color: MergedColorButton }> = [
      { action: 'colorRed', color: 'RED' },
      { action: 'colorGreen', color: 'GREEN' },
      { action: 'colorBlue', color: 'BLUE' },
      { action: 'colorYellow', color: 'YELLOW' },
    ];
    for (const item of colorMap) {
      if (input.justPressed(item.action)) {
        this.activeColor = item.color;
        this.popScale = 1.15;
        this.audio.playMusicalBloom(COLOR_NOTES[item.color], 'warm');
      }
    }

    // 3. OK Button: playful 3D tumble boost along the most recent spin direction
    if (input.justPressedButton('OK')) {
      this.velY = Math.max(-8.5, Math.min(8.5, this.velY + this.lastDirX * 4.4));
      this.velX = Math.max(-8.5, Math.min(8.5, this.velX + this.lastDirY * 4.4));
      this.popScale = 1.12;
      this.audio.playSpinnerTick(0.85);
    }

    // 4. Joystick 3D Spin (Up/Down = horizontal axis, Left/Right = vertical axis, Diagonals = diagonal axis!)
    const ax = input.axisX;
    const ay = input.axisY;
    const mag = Math.hypot(ax, ay);

    if (mag > 0.2) {
      const clampedMag = Math.min(1, mag);
      const nx = ax / mag;
      const ny = ay / mag;
      this.lastDirX = nx;
      this.lastDirY = ny;

      const maxRate = 4.9;
      const targetVelY = nx * maxRate * clampedMag;
      const targetVelX = ny * maxRate * clampedMag;
      const accelBlend = Math.min(1, dt * 7.2);
      this.velY += (targetVelY - this.velY) * accelBlend;
      this.velX += (targetVelX - this.velX) * accelBlend;
    } else {
      // Smooth 3D inertia coasting when joystick is released
      const decay = Math.pow(0.28, dt);
      this.velX *= decay;
      this.velY *= decay;
      if (Math.hypot(this.velX, this.velY) < 0.03) {
        this.velX = 0;
        this.velY = 0;
      }
    }

    // Integrate viewer-space 3D rotation around axis u = (-dPitch, dYaw, 0):
    // - UP (ay < 0 => dPitch < 0 => ux > 0): bottom swings forward (+Z) and UP (-Y)
    // - DOWN (ay > 0 => dPitch > 0 => ux < 0): top swings forward (+Z) and DOWN (+Y)
    // - RIGHT (ax > 0 => dYaw > 0 => uy > 0): front sweeps RIGHT (+X) around vertical axis
    // - LEFT (ax < 0 => dYaw < 0 => uy < 0): front sweeps LEFT (-X) around vertical axis
    // - Diagonals: seamlessly combines both into a pure diagonal 3D axis rotation!
    const dPitch = this.velX * dt;
    const dYaw = this.velY * dt;
    const stepAngle = Math.hypot(dPitch, dYaw);

    if (stepAngle > 1e-6) {
      const ux = -dPitch / stepAngle;
      const uy = dYaw / stepAngle;
      const dR = axisAngleXYMat3(ux, uy, stepAngle);
      this.rot = orthonormalizeMat3(multiplyMat3(dR, this.rot));
    }

    const totalSpeed = Math.hypot(this.velX, this.velY);
    if (totalSpeed > 0.65) {
      this.tickAngleAccum += stepAngle;
      const tickSpacing = Math.PI * 0.5;
      if (this.tickAngleAccum >= tickSpacing) {
        this.tickAngleAccum %= tickSpacing;
        this.audio.playSpinnerTick(Math.min(1, totalSpeed / 7.5));
      }
    } else {
      this.tickAngleAccum = 0;
    }

    this.popScale += (1 - this.popScale) * Math.min(1, dt * 11);
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const shape = SHAPE_BUTTON_META[this.activeShapeBtn].shape;

    // Calm, uncluttered warm ivory background
    const bg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      20,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65
    );
    bg.addColorStop(0, '#FFFDF9');
    bg.addColorStop(1, '#EEF2F6');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.48;
    const baseRadius = Math.min(width, height) * 0.3;
    const r = baseRadius * this.popScale;

    // Soft grounded floor shadow beneath the floating 3D shape (subtle width responds to 3D yaw!)
    const frontZ = Math.abs(this.rot[8]); // |cos(tilt from front)|
    const shadowRx = r * (0.52 + 0.38 * Math.max(0.35, Math.hypot(this.rot[0], this.rot[1])));
    const shadowRy = r * (0.14 + 0.05 * frontZ);
    ctx.save();
    ctx.fillStyle = 'rgba(20, 25, 38, 0.10)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 1.12, shadowRx, shadowRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Single centered 3D extruded Shape & Color block
    renderExtruded3DShape(ctx, cx, cy, r, shape, this.activeColor, this.rot);
  }

  public destroy(): void {
    this.audio.stopAllLoops();
  }
}

export const shapeSpinnerGameDefinition: ArcadeGameDefinition<SpinnerAction> = {
  id: 'shape-spinner',
  title: 'Shape Spinner',
  subtitle: 'Pick a shape & color, then spin it in 3D!',
  accentColor: '#42A5F5',
  developmental: {
    parentCategory: '3D Spin & Choice',
    primaryTags: ['A1', 'C1'],
    secondaryTags: ['B2', 'G1'],
  },
  controls: [
    { action: 'colorRed', button: 'RED', label: 'Red', icon: 'palette' },
    { action: 'colorGreen', button: 'GREEN', label: 'Green', icon: 'palette' },
    { action: 'colorBlue', button: 'BLUE', label: 'Blue', icon: 'palette' },
    { action: 'colorYellow', button: 'YELLOW', label: 'Yellow', icon: 'palette' },
  ],
  renderCover(ctx, width, height, timeSec, selected) {
    const bg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      10,
      width * 0.5,
      height * 0.5,
      width * 0.7
    );
    bg.addColorStop(0, '#FFFDF9');
    bg.addColorStop(1, '#E3F2FD');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.49;
    const r = Math.min(width, height) * 0.34;

    const yaw = selected ? timeSec * 1.5 : 0.48;
    const pitch = selected ? Math.sin(timeSec * 1.1) * 0.45 : 0.28;
    const coverRot = orthonormalizeMat3(
      multiplyMat3(
        axisAngleXYMat3(-1, 0, pitch),
        multiplyMat3(axisAngleXYMat3(0, 1, yaw), createIdentityMat3())
      )
    );

    const colIdx = selected ? Math.floor(timeSec * 0.6) % 4 : 2;
    const color = CABINET_COLOR_COLUMNS[colIdx];

    ctx.fillStyle = 'rgba(20, 25, 38, 0.1)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 1.08, r * 0.72, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    renderExtruded3DShape(ctx, cx, cy, r, 'star', color, coverRot);
  },
  create(context) {
    return new ShapeSpinnerGame(context);
  },
};
