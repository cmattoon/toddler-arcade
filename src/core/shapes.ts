import { MergedColorButton, ShapeKind } from './types';

export const CABINET_COLOR_COLUMNS: MergedColorButton[] = [
  'RED',
  'GREEN',
  'BLUE',
  'YELLOW',
];

export const CABINET_COLOR_PALETTE: Record<
  MergedColorButton,
  {
    name: string;
    face: string;
    light: string;
    dark: string;
    glow: string;
  }
> = {
  RED: {
    name: 'Red',
    face: '#EF5350',
    light: '#FFCDD2',
    dark: '#B71C1C',
    glow: 'rgba(239, 83, 80, 0.55)',
  },
  GREEN: {
    name: 'Green',
    face: '#66BB6A',
    light: '#C8E6C9',
    dark: '#2E7D32',
    glow: 'rgba(102, 187, 106, 0.55)',
  },
  BLUE: {
    name: 'Blue',
    face: '#42A5F5',
    light: '#BBDEFB',
    dark: '#1565C0',
    glow: 'rgba(66, 165, 245, 0.55)',
  },
  YELLOW: {
    name: 'Yellow',
    face: '#FDD835',
    light: '#FFF9C4',
    dark: '#F57F17',
    glow: 'rgba(253, 216, 53, 0.55)',
  },
};

/**
 * Draws one of the 6 basic cabinet shapes (`square`, `circle`, `triangle`, `diamond`, `star`, `heart`)
 * centered at `(cx, cy)` with radius `r`.
 */
export function traceCabinetShapePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  shape: ShapeKind
): void {
  ctx.beginPath();
  if (shape === 'square') {
    const s = r * 0.78;
    ctx.rect(cx - s, cy - s, s * 2, s * 2);
  } else if (shape === 'circle') {
    ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    const h = r * 0.92;
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h * 0.95, cy + h * 0.76);
    ctx.lineTo(cx - h * 0.95, cy + h * 0.76);
    ctx.closePath();
  } else if (shape === 'diamond') {
    const d = r * 0.94;
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d * 0.88, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d * 0.88, cy);
    ctx.closePath();
  } else if (shape === 'star') {
    const outer = r * 0.98;
    const inner = r * 0.42;
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      const px = cx + Math.cos(angle) * rad;
      const py = cy + Math.sin(angle) * rad + r * 0.06;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    // heart
    const s = r * 0.92;
    const topY = cy - s * 0.32;
    ctx.moveTo(cx, cy + s * 0.84);
    ctx.bezierCurveTo(
      cx - s * 1.18,
      cy + s * 0.14,
      cx - s * 1.05,
      cy - s * 0.86,
      cx,
      topY
    );
    ctx.bezierCurveTo(
      cx + s * 1.05,
      cy - s * 0.86,
      cx + s * 1.18,
      cy + s * 0.14,
      cx,
      cy + s * 0.84
    );
    ctx.closePath();
  }
}

export function drawCabinetShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  shape: ShapeKind,
  options: {
    fill?: string;
    stroke?: string;
    lineWidth?: number;
  }
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  traceCabinetShapePath(ctx, cx, cy, r, shape);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.lineWidth ?? Math.max(2, r * 0.24);
    ctx.stroke();
  }
  ctx.restore();
}
