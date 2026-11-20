import { ArcadeAudio } from './core/audio';
import { InputManager } from './core/input';
import { ArcadeShell } from './core/shell';
import { GAME_REGISTRY } from './games/registry';

function bootstrap(): void {
  const canvas = document.getElementById('arcade-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #arcade-canvas element');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }

  const audio = new ArcadeAudio();
  const input = new InputManager();
  const shell = new ArcadeShell(canvas, GAME_REGISTRY, input, audio);

  let cssWidth = window.innerWidth;
  let cssHeight = window.innerHeight;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth;
    cssHeight = window.innerHeight;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  window.addEventListener('resize', resize);
  resize();

  let lastTime = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    shell.update(dt);
    shell.render(ctx, cssWidth, cssHeight);

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

bootstrap();
