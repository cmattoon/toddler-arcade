import { ArcadeAudio } from './audio';
import { ALL_PHYSICAL_BUTTONS, InputManager, PressedPadButton } from './input';
import { CABINET_COLOR_COLUMNS, CABINET_COLOR_PALETTE, drawCabinetShape } from './shapes';
import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  CabinetButton,
  CabinetSnapshot,
  ControlIcon,
  DeckVisualOverride,
  Direction,
  GamepadButtonSlot,
  MergedColorButton,
  PhysicalButton,
  SHAPE_BUTTON_LIST,
  SHAPE_BUTTON_META,
  SplitColorButton,
} from './types';

interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  onDown: () => void;
  onUp?: () => void;
}

const COLOR_PAIR_BUTTONS: Record<
  MergedColorButton,
  { top: SplitColorButton; bottom: SplitColorButton }
> = {
  RED: { top: 'R1', bottom: 'R2' },
  GREEN: { top: 'G1', bottom: 'G2' },
  BLUE: { top: 'B1', bottom: 'B2' },
  YELLOW: { top: 'Y1', bottom: 'Y2' },
};

function formatSlot(slot: GamepadButtonSlot): string {
  if (typeof slot === 'number') return `B${slot}`;
  return `P${slot.pad}:B${slot.button}`;
}

export class ArcadeShell {
  private games: ArcadeGameDefinition[];
  private input: InputManager;
  private audio: ArcadeAudio;
  private canvas: HTMLCanvasElement;

  private selectedIndex = 0;
  private activeGameDef: ArcadeGameDefinition | null = null;
  private activeGame: ArcadeGameInstance | null = null;

  private showDeckBar = true;
  private configModalOpen = false;
  private listeningForButton: PhysicalButton | null = null;
  private prevRawPressed: PressedPadButton[] = [];

  private timeSec = 0;
  private lastViewportW = 1280;
  private lastViewportH = 600;
  private hitRegions: HitRegion[] = [];
  private activePointerUps = new Map<number, () => void>();
  private cardRects: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];

  constructor(
    canvas: HTMLCanvasElement,
    games: ArcadeGameDefinition[],
    input: InputManager,
    audio: ArcadeAudio
  ) {
    this.canvas = canvas;
    this.games = games;
    this.input = input;
    this.audio = audio;

    this.bindPointerAndUtilityKeys();
  }

  private bindPointerAndUtilityKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F2') {
        this.configModalOpen = !this.configModalOpen;
        this.listeningForButton = null;
      } else if (e.code === 'Tab') {
        this.showDeckBar = !this.showDeckBar;
      }
    });

    const getCanvasCoords = (e: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.ensureContext();
      const { x, y } = getCanvasCoords(e);

      // 1. Check shell hit regions first (deck buttons, top-right utilities, config modal)
      for (let i = this.hitRegions.length - 1; i >= 0; i--) {
        const reg = this.hitRegions[i];
        if (x >= reg.x && x <= reg.x + reg.w && y >= reg.y && y <= reg.y + reg.h) {
          reg.onDown();
          if (reg.onUp) {
            this.activePointerUps.set(e.pointerId, reg.onUp);
            try {
              this.canvas.setPointerCapture(e.pointerId);
            } catch {
              // Synthetic or unsupported pointer capture
            }
          }
          return;
        }
      }

      // 2. Forward viewport taps to active game when no modal overlay is open
      if (this.activeGame && !this.configModalOpen && y < this.lastViewportH) {
        this.activeGame.onPointerDown?.(x, y, this.lastViewportW, this.lastViewportH);
        return;
      }

      // 3. Allow clicking/tapping game cards in the main menu
      if (!this.activeGame && !this.configModalOpen) {
        for (const card of this.cardRects) {
          if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
            if (this.selectedIndex !== card.index) {
              this.selectedIndex = card.index;
              this.audio.playMenuMove();
            } else {
              this.launchSelectedGame();
            }
            return;
          }
        }
      }
    });

    const handleUp = (e: PointerEvent) => {
      const cb = this.activePointerUps.get(e.pointerId);
      if (cb) {
        cb();
        this.activePointerUps.delete(e.pointerId);
      }
    };

    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    this.canvas.addEventListener('lostpointercapture', handleUp);
    window.addEventListener('blur', () => {
      for (const cb of this.activePointerUps.values()) {
        cb();
      }
      this.activePointerUps.clear();
    });
  }

  public update(dt: number): void {
    this.timeSec += dt;
    const snap = this.input.poll();

    if (this.configModalOpen) {
      this.updateConfigModal(snap);
      return;
    }

    // Global ESC soft-reset: always returns directly to the Main Menu from any game
    if (snap.buttonJustPressed.ESC) {
      if (this.activeGame) {
        this.returnToMainMenu();
        return;
      }
    }

    if (this.activeGame && this.activeGameDef) {
      const gameInput = this.input.createGameInput(snap, this.activeGameDef.controls);
      this.activeGame.update(dt, gameInput);
    } else {
      this.updateMainMenu(snap);
    }
  }

  private updateMainMenu(snap: CabinetSnapshot): void {
    const count = this.games.length;
    if (count === 0) return;

    const cols = this.getGridColumns(count);
    const rows = Math.ceil(count / cols);
    let next = this.selectedIndex;

    if (snap.dirJustPressed.RIGHT) {
      next = (this.selectedIndex + 1) % count;
    } else if (snap.dirJustPressed.LEFT) {
      next = (this.selectedIndex - 1 + count) % count;
    } else if (snap.dirJustPressed.DOWN) {
      const curRow = Math.floor(this.selectedIndex / cols);
      const curCol = this.selectedIndex % cols;
      if (curRow + 1 < rows) {
        const nextRowStart = (curRow + 1) * cols;
        const nextRowCount = Math.min(cols, count - nextRowStart);
        // Map horizontally into centered partial bottom row (e.g. 4 top cards -> 3 bottom cards)
        const mappedCol =
          nextRowCount < cols
            ? Math.min(nextRowCount - 1, Math.max(0, Math.round((curCol / (cols - 1)) * (nextRowCount - 1))))
            : curCol;
        next = nextRowStart + mappedCol;
      }
    } else if (snap.dirJustPressed.UP) {
      const curRow = Math.floor(this.selectedIndex / cols);
      const curCol = this.selectedIndex % cols;
      if (curRow - 1 >= 0) {
        const curRowStart = curRow * cols;
        const curRowCount = Math.min(cols, count - curRowStart);
        const prevRowStart = (curRow - 1) * cols;
        const mappedCol =
          curRowCount < cols && curRowCount > 1
            ? Math.round((curCol / (curRowCount - 1)) * (cols - 1))
            : curCol;
        next = prevRowStart + Math.min(cols - 1, mappedCol);
      }
    }

    if (next !== this.selectedIndex) {
      this.selectedIndex = next;
      this.audio.playMenuMove();
    }

    if (snap.buttonJustPressed.OK) {
      this.launchSelectedGame();
    }
  }

  private getGridColumns(count: number): number {
    if (count <= 3) return count;
    if (count === 4) return 2;
    if (count <= 6) return 3;
    return 4;
  }

  private launchSelectedGame(): void {
    const def = this.games[this.selectedIndex];
    if (!def) return;
    this.audio.playMenuSelect();
    this.activeGameDef = def;
    this.activeGame = def.create({ audio: this.audio });
  }

  private returnToMainMenu(): void {
    if (this.activeGame) {
      this.activeGame.destroy();
      this.activeGame = null;
      this.activeGameDef = null;
    }
    this.audio.stopAllLoops();
    this.audio.playMenuBack();
  }

  private updateConfigModal(snap: CabinetSnapshot): void {
    const raw = this.input.getRawGamepadDebug();
    if (this.listeningForButton && raw.connected) {
      const newlyPressed = raw.pressedButtons.find(
        (p) => !this.prevRawPressed.some((prev) => prev.pad === p.pad && prev.button === p.button)
      );
      if (newlyPressed !== undefined) {
        const current = this.input.getMapping();
        const updated = {
          ...current,
          buttons: {
            ...current.buttons,
            [this.listeningForButton]: [{ pad: newlyPressed.pad, button: newlyPressed.button }],
          },
        };
        this.input.saveMapping(updated);
        this.listeningForButton = null;
        this.audio.playMenuSelect();
      }
    }
    this.prevRawPressed = [...raw.pressedButtons];

    if (snap.buttonJustPressed.ESC && !this.listeningForButton) {
      this.configModalOpen = false;
    }
  }

  public render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.hitRegions = [];
    this.cardRects = [];

    const deckHeight = this.showDeckBar
      ? Math.min(126, Math.max(102, Math.round(height * 0.165)))
      : 0;
    const viewportHeight = height - deckHeight;
    this.lastViewportW = width;
    this.lastViewportH = viewportHeight;
    const snap = this.input.getLastSnapshot();

    // 1. Render either Active Game or Main Menu Grid inside viewport
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, viewportHeight);
    ctx.clip();

    if (this.activeGame) {
      this.activeGame.render(ctx, width, viewportHeight);
    } else {
      this.renderMainMenu(ctx, width, viewportHeight);
    }
    ctx.restore();

    // 2. Subtle top-right parent utility controls (Gamepad indicator, Mute, Setup F2)
    this.renderTopCornerUtilities(ctx, width, snap);

    // 3. Physical Schematic 3-Cluster Control Deck along bottom
    if (this.showDeckBar) {
      this.renderArcadeDeckBar(ctx, width, viewportHeight, deckHeight, snap);
    }

    // 4. Optional USB Encoder / Controller Setup Modal (Parent/Builder tool)
    if (this.configModalOpen) {
      this.renderConfigModal(ctx, width, height);
    }
  }

  private renderMainMenu(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#1B2845');
    bg.addColorStop(0.55, '#274060');
    bg.addColorStop(1, '#1D334A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let i = 0; i < 14; i++) {
      const rx = (i * 173) % width;
      const ry = (i * 119 + this.timeSec * 8) % height;
      ctx.beginPath();
      ctx.arc(rx, ry, 26 + (i % 4) * 14, 0, Math.PI * 2);
      ctx.fill();
    }

    const count = this.games.length;
    const cols = this.getGridColumns(count);
    const rows = Math.ceil(count / cols);
    const compact = rows >= 2;

    const headerY = compact ? Math.max(30, height * 0.062) : Math.max(46, height * 0.1);
    ctx.fillStyle = '#FFD54F';
    ctx.font = compact ? '900 32px system-ui, sans-serif' : '900 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TODDLER ARCADE', width / 2, headerY);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.font = compact ? '600 15px system-ui, sans-serif' : '600 18px system-ui, sans-serif';
    ctx.fillText(
      'Move the joystick (or tap a card) to pick an activity, then press OK!',
      width / 2,
      headerY + (compact ? 26 : 34)
    );

    const gridTop = headerY + (compact ? 48 : 66);
    const availH = height - gridTop - (compact ? 16 : 28);
    const availW = Math.min(width - 48, 1210);

    const gapX = cols >= 4 ? 18 : 24;
    const gapY = compact ? 18 : 26;
    const cardW = Math.min(366, Math.floor((availW - gapX * (cols - 1)) / cols));
    const cardH = Math.min(compact ? 236 : 305, Math.floor((availH - gapY * (rows - 1)) / rows));

    const totalGridH = rows * cardH + (rows - 1) * gapY;
    const startY = Math.round(gridTop + (availH - totalGridH) / 2);

    this.games.forEach((game, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const rowItemCount = Math.min(cols, count - row * cols);
      const rowGridW = rowItemCount * cardW + (rowItemCount - 1) * gapX;
      const rowStartX = Math.round((width - rowGridW) / 2);
      const x = rowStartX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      const isSelected = idx === this.selectedIndex;

      this.cardRects.push({ x, y, w: cardW, h: cardH, index: idx });

      const lift = isSelected ? -4 + Math.sin(this.timeSec * 5) * 2.5 : 0;
      const scale = isSelected ? 1.028 : 0.985;

      ctx.save();
      ctx.translate(x + cardW / 2, y + cardH / 2 + lift);
      ctx.scale(scale, scale);
      ctx.translate(-cardW / 2, -cardH / 2);

      if (isSelected) {
        ctx.shadowColor = '#FFD54F';
        ctx.shadowBlur = 24;
      }

      ctx.fillStyle = isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.roundRect(0, 0, cardW, cardH, 22);
      ctx.fill();
      ctx.shadowBlur = 0;

      const footerH = compact ? 68 : 80;
      const artMargin = 10;
      const artH = cardH - footerH - artMargin;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(artMargin, artMargin, cardW - artMargin * 2, artH, 14);
      ctx.clip();
      game.renderCover(ctx, cardW, artH + artMargin, this.timeSec, isSelected);
      ctx.restore();

      // Optional subtle parent developmental category pill at top-left of card art
      if (game.developmental) {
        const tagText = game.developmental.parentCategory;
        ctx.save();
        ctx.font = '700 11px system-ui, sans-serif';
        const tw = ctx.measureText(tagText).width + 16;
        ctx.fillStyle = 'rgba(20, 25, 38, 0.72)';
        ctx.beginPath();
        ctx.roundRect(artMargin + 8, artMargin + 8, tw, 20, 10);
        ctx.fill();
        ctx.fillStyle = '#FFE082';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, artMargin + 16, artMargin + 18);
        ctx.restore();
      }

      ctx.fillStyle = '#141926';
      ctx.font =
        cols >= 4
          ? '900 18.5px system-ui, sans-serif'
          : compact
            ? '900 20px system-ui, sans-serif'
            : '900 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(game.title, cardW / 2, artH + artMargin + (compact ? 22 : 28));

      ctx.fillStyle = '#546E7A';
      ctx.font =
        cols >= 4
          ? '600 12px system-ui, sans-serif'
          : compact
            ? '600 13px system-ui, sans-serif'
            : '600 14px system-ui, sans-serif';
      ctx.fillText(game.subtitle, cardW / 2, artH + artMargin + (compact ? 45 : 52));

      if (isSelected) {
        ctx.strokeStyle = '#FFD54F';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.roundRect(-2.5, -2.5, cardW + 5, cardH + 5, 24);
        ctx.stroke();
      }

      ctx.restore();
    });
  }

  private renderTopCornerUtilities(
    ctx: CanvasRenderingContext2D,
    width: number,
    snap: CabinetSnapshot
  ): void {
    const y = 12;
    let rightX = width - 14;

    const gearW = 40;
    rightX -= gearW;
    const gearX = rightX;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.56)';
    ctx.beginPath();
    ctx.roundRect(gearX, y, gearW, 34, 10);
    ctx.fill();
    ctx.fillStyle = '#CFD8DC';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SET', gearX + gearW / 2, y + 17);
    this.hitRegions.push({
      x: gearX,
      y,
      w: gearW,
      h: 34,
      onDown: () => {
        this.configModalOpen = !this.configModalOpen;
        this.listeningForButton = null;
      },
    });

    rightX -= 46;
    const muteX = rightX;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.56)';
    ctx.beginPath();
    ctx.roundRect(muteX, y, 40, 34, 10);
    ctx.fill();
    ctx.fillStyle = this.audio.isMuted ? '#EF5350' : '#CFD8DC';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(this.audio.isMuted ? 'OFF' : 'SND', muteX + 20, y + 17);
    this.hitRegions.push({
      x: muteX,
      y,
      w: 40,
      h: 34,
      onDown: () => {
        this.audio.toggleMute();
      },
    });

    const badgeW = snap.gamepadConnected ? 116 : 98;
    rightX -= badgeW + 6;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.56)';
    ctx.beginPath();
    ctx.roundRect(rightX, y, badgeW, 34, 17);
    ctx.fill();

    ctx.fillStyle = snap.gamepadConnected ? '#4CAF50' : '#FFB300';
    ctx.beginPath();
    ctx.arc(rightX + 17, y + 17, 5.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ECEFF1';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      snap.gamepadConnected
        ? snap.gamepadCount > 1
          ? `${snap.gamepadCount} USB PADS`
          : 'USB STICK'
        : 'KEYS / USB',
      rightX + 28,
      y + 18
    );
  }

  /**
   * Renders the physical 3-Cluster Control Deck layout:
   * - Left:   2x3 White Shape Buttons (Square, Circle, Triangle / Diamond, Star, Heart)
   * - Center: Grey ESC & OK system buttons + Purple 4-way Joystick
   * - Right:  2x4 Colored Buttons (Red, Green, Blue, Yellow columns — merged as 4 in simple mode, or split top/bottom in +/- mode!)
   */
  private renderArcadeDeckBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    topY: number,
    barH: number,
    snap: CabinetSnapshot
  ): void {
    const panelGrad = ctx.createLinearGradient(0, topY, 0, topY + barH);
    panelGrad.addColorStop(0, '#222B3A');
    panelGrad.addColorStop(1, '#141926');
    ctx.fillStyle = panelGrad;
    ctx.fillRect(0, topY, width, barH);

    ctx.fillStyle = '#78909C';
    ctx.fillRect(0, topY, width, 3);

    const override: DeckVisualOverride = this.activeGame?.getDeckOverride?.() ?? {
      colorMode: 'merged4',
      shapesActive: false,
      selectedShape: null,
    };

    const flashingSet = new Set<CabinetButton>(
      this.activeGame?.getFlashingButtons ? this.activeGame.getFlashingButtons() : []
    );
    const flashPulse = Math.sin(this.timeSec * 18) > 0;

    // =========================================================================
    // 1. LEFT CLUSTER: 2x3 White Shape Buttons (X1..X6)
    // =========================================================================
    const shapeColSpacing = Math.min(54, Math.max(40, width * 0.042));
    const shapeStartX = Math.max(54, width * 0.13) - shapeColSpacing;
    const shapeRow0Y = topY + Math.round(barH * 0.31);
    const shapeRow1Y = topY + Math.round(barH * 0.72);
    const shapeR = Math.min(17, Math.round(barH * 0.148));

    const shapesEnabled = override.shapesActive || !this.activeGame;
    for (const sBtn of SHAPE_BUTTON_LIST) {
      const meta = SHAPE_BUTTON_META[sBtn];
      const cx = shapeStartX + meta.col * shapeColSpacing;
      const cy = meta.row === 0 ? shapeRow0Y : shapeRow1Y;
      const isDown = snap.buttonDown[sBtn];
      const isSelected = override.selectedShape === sBtn;

      this.hitRegions.push({
        x: cx - shapeR - 6,
        y: cy - shapeR - 5,
        w: (shapeR + 6) * 2,
        h: (shapeR + 5) * 2,
        onDown: () => this.input.setVirtualButton(sBtn, true),
        onUp: () => this.input.setVirtualButton(sBtn, false),
      });

      ctx.save();
      ctx.globalAlpha = shapesEnabled || isDown ? 1 : 0.44;
      if (isDown || isSelected) {
        ctx.shadowColor = isSelected ? '#FFD54F' : '#FFFFFF';
        ctx.shadowBlur = 14;
      }

      // Outer bezel / highlight ring
      ctx.fillStyle = isSelected ? '#FFD54F' : '#CFD8DC';
      ctx.beginPath();
      ctx.arc(cx, cy, shapeR + 2.5, 0, Math.PI * 2);
      ctx.fill();

      // White plunger cap
      const pressOff = isDown ? 1.5 : 0;
      ctx.fillStyle = isDown ? '#FFF9C4' : '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, cy + pressOff, shapeR, 0, Math.PI * 2);
      ctx.fill();

      // Crisp black geometric shape icon inside
      drawCabinetShape(ctx, cx, cy + pressOff, shapeR * 0.64, meta.shape, {
        stroke: '#141926',
        lineWidth: 2.5,
        fill: isSelected ? 'rgba(255, 213, 79, 0.35)' : undefined,
      });
      ctx.restore();
    }

    // =========================================================================
    // 2. CENTER CLUSTER: ESC & OK Grey Buttons (Top) + Purple Joystick (Bottom)
    // =========================================================================
    const centerClusterX = Math.round(width * 0.415);
    const sysY = topY + Math.round(barH * 0.25);
    const sysR = Math.min(16, Math.round(barH * 0.135));
    const sysButtons: Array<{ btn: 'ESC' | 'OK'; dx: number; text: string }> = [
      { btn: 'ESC', dx: -30, text: 'ESC' },
      { btn: 'OK', dx: 30, text: 'OK' },
    ];

    for (const s of sysButtons) {
      const bx = centerClusterX + s.dx;
      const isDown = snap.buttonDown[s.btn];
      this.hitRegions.push({
        x: bx - sysR - 8,
        y: sysY - sysR - 6,
        w: (sysR + 8) * 2,
        h: (sysR + 6) * 2,
        onDown: () => this.input.setVirtualButton(s.btn, true),
        onUp: () => this.input.setVirtualButton(s.btn, false),
      });

      ctx.save();
      if (isDown) {
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = isDown ? '#CFD8DC' : '#90A4AE';
      ctx.beginPath();
      ctx.arc(bx, sysY + (isDown ? 1.5 : 0), sysR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#455A64';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#141926';
      ctx.font = '800 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, bx, sysY + (isDown ? 1.5 : 0) + 0.5);
      ctx.restore();
    }

    // Purple 4-Way Joystick Circle underneath ESC / OK
    const joyY = topY + Math.round(barH * 0.72);
    const joyR = Math.min(24, Math.round(barH * 0.2));
    ctx.save();
    ctx.fillStyle = '#8B5CF6';
    ctx.beginPath();
    ctx.arc(centerClusterX, joyY, joyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#C4B5FD';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4-way D-pad cross & triangles inside the purple circle
    const nubX = centerClusterX + snap.axisX * 4;
    const nubY = joyY + snap.axisY * 4;
    ctx.fillStyle = '#141926';
    ctx.beginPath();
    ctx.roundRect(nubX - 5, nubY - 15, 10, 30, 3);
    ctx.roundRect(nubX - 15, nubY - 5, 30, 10, 3);
    ctx.fill();

    // Highlight active direction triangles
    const arrowDist = 10.5;
    const drawTinyArrow = (dx: number, dy: number, active: boolean) => {
      ctx.fillStyle = active ? '#FFD54F' : '#EDE9FE';
      ctx.beginPath();
      if (dx < 0) {
        ctx.moveTo(nubX - arrowDist - 2, nubY);
        ctx.lineTo(nubX - arrowDist + 3, nubY - 3.2);
        ctx.lineTo(nubX - arrowDist + 3, nubY + 3.2);
      } else if (dx > 0) {
        ctx.moveTo(nubX + arrowDist + 2, nubY);
        ctx.lineTo(nubX + arrowDist - 3, nubY - 3.2);
        ctx.lineTo(nubX + arrowDist - 3, nubY + 3.2);
      } else if (dy < 0) {
        ctx.moveTo(nubX, nubY - arrowDist - 2);
        ctx.lineTo(nubX - 3.2, nubY - arrowDist + 3);
        ctx.lineTo(nubX + 3.2, nubY - arrowDist + 3);
      } else {
        ctx.moveTo(nubX, nubY + arrowDist + 2);
        ctx.lineTo(nubX - 3.2, nubY + arrowDist - 3);
        ctx.lineTo(nubX + 3.2, nubY + arrowDist - 3);
      }
      ctx.closePath();
      ctx.fill();
    };
    drawTinyArrow(-1, 0, snap.dirDown.LEFT);
    drawTinyArrow(1, 0, snap.dirDown.RIGHT);
    drawTinyArrow(0, -1, snap.dirDown.UP);
    drawTinyArrow(0, 1, snap.dirDown.DOWN);
    ctx.restore();

    const dirs: Array<{ dir: Direction; dx: number; dy: number }> = [
      { dir: 'LEFT', dx: -24, dy: 0 },
      { dir: 'RIGHT', dx: 24, dy: 0 },
      { dir: 'UP', dx: 0, dy: -20 },
      { dir: 'DOWN', dx: 0, dy: 20 },
    ];
    for (const d of dirs) {
      this.hitRegions.push({
        x: centerClusterX + d.dx - 16,
        y: joyY + d.dy - 14,
        w: 32,
        h: 28,
        onDown: () => this.input.setVirtualDirection(d.dir, true),
        onUp: () => this.input.setVirtualDirection(d.dir, false),
      });
    }

    // =========================================================================
    // 3. RIGHT CLUSTER: 2x4 Colored Primary Interaction Buttons (R, G, B, Y)
    // =========================================================================
    const colSpacing = Math.min(82, Math.max(58, width * 0.064));
    const rightStartX = Math.min(width - 54 - colSpacing * 3, Math.round(width * 0.61));
    const row0Y = topY + Math.round(barH * 0.27);
    const row1Y = topY + Math.round(barH * 0.63);
    const colorR = Math.min(16, Math.round(barH * 0.138));
    const isMerged = override.colorMode === 'merged4';

    // Map activeGameDef controls onto the 4 columns if available
    const defByColor = new Map<MergedColorButton, { label: string; icon: ControlIcon }>();
    if (this.activeGameDef) {
      for (const c of this.activeGameDef.controls) {
        if (c.button === 'RED' || c.button === 'GREEN' || c.button === 'BLUE' || c.button === 'YELLOW') {
          defByColor.set(c.button, { label: c.label, icon: c.icon });
        }
      }
    }

    CABINET_COLOR_COLUMNS.forEach((mergedCol, colIdx) => {
      const cx = rightStartX + colIdx * colSpacing;
      const pair = COLOR_PAIR_BUTTONS[mergedCol];
      const pal = CABINET_COLOR_PALETTE[mergedCol];
      const defInfo = defByColor.get(mergedCol);
      const colLabel =
        override.columnLabels?.[mergedCol] ??
        defInfo?.label ??
        (this.activeGame ? pal.name : '');

      const isPairFlashing =
        (flashingSet.has(mergedCol) || flashingSet.has(pair.top) || flashingSet.has(pair.bottom)) &&
        flashPulse;
      const isPairDown = snap.buttonDown[mergedCol];

      // In Simple Mode ('merged4'), draw a soft linking capsule around the vertical pair
      // so it's clear that both buttons in that column act together!
      if (isMerged) {
        ctx.save();
        ctx.fillStyle = isPairDown
          ? 'rgba(255, 255, 255, 0.22)'
          : 'rgba(255, 255, 255, 0.07)';
        ctx.strokeStyle = isPairFlashing
          ? '#FFFFFF'
          : isPairDown
            ? pal.face
            : 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = isPairFlashing ? 3 : 1.5;
        const capW = (colorR + 6) * 2;
        const capTop = row0Y - colorR - 5;
        const capH = row1Y - row0Y + (colorR + 5) * 2;
        ctx.beginPath();
        ctx.roundRect(cx - capW / 2, capTop, capW, capH, capW / 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      const subButtons: Array<{ btn: SplitColorButton; cy: number }> = [
        { btn: pair.top, cy: row0Y },
        { btn: pair.bottom, cy: row1Y },
      ];

      for (const sub of subButtons) {
        const btnDown = isMerged ? isPairDown : snap.buttonDown[sub.btn];
        const btnFlash =
          (isMerged ? isPairFlashing : flashingSet.has(sub.btn) && flashPulse);

        this.hitRegions.push({
          x: cx - colorR - 8,
          y: sub.cy - colorR - 4,
          w: (colorR + 8) * 2,
          h: (colorR + 4) * 2,
          onDown: () => this.input.setVirtualButton(sub.btn, true),
          onUp: () => this.input.setVirtualButton(sub.btn, false),
        });

        ctx.save();
        if (btnDown || btnFlash) {
          ctx.shadowColor = btnFlash ? '#FFFFFF' : pal.glow;
          ctx.shadowBlur = btnFlash ? 20 : 14;
        }

        ctx.fillStyle = '#ECEFF1';
        ctx.beginPath();
        ctx.arc(cx, sub.cy, colorR + 2.2, 0, Math.PI * 2);
        ctx.fill();

        const pressOff = btnDown ? 1.5 : 0;
        ctx.fillStyle = btnDown ? pal.light : pal.face;
        ctx.beginPath();
        ctx.arc(cx, sub.cy + pressOff, colorR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        const iconToDraw: ControlIcon | undefined = !isMerged
          ? override.splitIcons?.[sub.btn]
          : defInfo?.icon;
        if (iconToDraw) {
          ctx.save();
          ctx.translate(cx, sub.cy + pressOff);
          ctx.scale(0.72, 0.72);
          this.drawButtonIcon(ctx, 0, 0, iconToDraw);
          ctx.restore();
        }
      }

      if (colLabel) {
        ctx.fillStyle = '#ECEFF1';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(colLabel, cx, row1Y + colorR + 6);
      }
    });
  }

  private drawButtonIcon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    icon: ControlIcon
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#141926';
    ctx.fillStyle = '#141926';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (icon === 'plus') {
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
    } else if (icon === 'minus') {
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.stroke();
    } else if (icon === 'music') {
      ctx.beginPath();
      ctx.arc(-3, 5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.5, 5);
      ctx.lineTo(0.5, -7);
      ctx.lineTo(7, -5);
      ctx.stroke();
    } else if (icon === 'paw') {
      ctx.beginPath();
      ctx.arc(0, 3, 4.5, 0, Math.PI * 2);
      ctx.arc(-5.5, -3, 2.2, 0, Math.PI * 2);
      ctx.arc(0, -5.5, 2.2, 0, Math.PI * 2);
      ctx.arc(5.5, -3, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === 'block') {
      ctx.strokeRect(-6.5, -5.5, 13, 11);
      ctx.beginPath();
      ctx.moveTo(-3.5, -5.5);
      ctx.lineTo(-3.5, -8.5);
      ctx.lineTo(3.5, -8.5);
      ctx.lineTo(3.5, -5.5);
      ctx.stroke();
    } else if (
      icon === 'square' ||
      icon === 'circle' ||
      icon === 'triangle' ||
      icon === 'diamond' ||
      icon === 'star' ||
      icon === 'heart'
    ) {
      drawCabinetShape(ctx, 0, 0, 8, icon, { stroke: '#141926', lineWidth: 2.5 });
    } else if (icon === 'ok') {
      ctx.beginPath();
      ctx.moveTo(-5, -8);
      ctx.lineTo(8, 0);
      ctx.lineTo(-5, 8);
      ctx.closePath();
      ctx.fill();
    } else if (icon === 'back') {
      ctx.beginPath();
      ctx.moveTo(6, -6);
      ctx.lineTo(-5, 0);
      ctx.lineTo(6, 6);
      ctx.stroke();
    } else if (icon === 'engine') {
      ctx.beginPath();
      ctx.arc(0, 1, 8, Math.PI * 0.8, Math.PI * 0.2, false);
      ctx.moveTo(0, -9);
      ctx.lineTo(0, 0);
      ctx.stroke();
    } else if (icon === 'horn') {
      ctx.beginPath();
      ctx.moveTo(-8, -3);
      ctx.lineTo(-3, -3);
      ctx.lineTo(4, -8);
      ctx.lineTo(4, 8);
      ctx.lineTo(-3, 3);
      ctx.lineTo(-8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(6, 0, 5, -0.7, 0.7);
      ctx.stroke();
    } else if (icon === 'brake') {
      ctx.beginPath();
      ctx.rect(-7, -7, 14, 14);
      ctx.fill();
    } else if (icon === 'palette') {
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-3, -3, 2, 0, Math.PI * 2);
      ctx.arc(3, -2, 2, 0, Math.PI * 2);
      ctx.arc(0, 4, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === 'car') {
      ctx.beginPath();
      ctx.roundRect(-10, -2, 20, 7, 3);
      ctx.roundRect(-6, -8, 12, 7, 2);
      ctx.fill();
    } else if (icon === 'spray') {
      ctx.beginPath();
      ctx.arc(0, 3, 6, 0, Math.PI);
      ctx.moveTo(0, -9);
      ctx.lineTo(-6, 3);
      ctx.lineTo(6, 3);
      ctx.closePath();
      ctx.fill();
    } else if (icon === 'bubbles') {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(-4, 3, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(5, -3, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(3, 6, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (icon === 'wind') {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-9, -5);
      ctx.lineTo(5, -5);
      ctx.arc(5, -7.5, 2.5, Math.PI * 0.5, Math.PI * 1.8, true);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, 1);
      ctx.lineTo(8, 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.lineTo(4, 6);
      ctx.arc(4, 8.5, 2.5, -Math.PI * 0.5, Math.PI * 0.8, false);
      ctx.stroke();
    } else if (icon === 'forkLeft') {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(2, 9);
      ctx.quadraticCurveTo(2, 0, -7, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-8, -7);
      ctx.lineTo(-1, -8);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
    } else if (icon === 'forkStraight') {
      ctx.lineWidth = 3;
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
    } else if (icon === 'forkRight') {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-2, 9);
      ctx.quadraticCurveTo(-2, 0, 7, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, -7);
      ctx.lineTo(1, -8);
      ctx.lineTo(6, 0);
      ctx.closePath();
      ctx.fill();
    } else if (icon === 'skip') {
      ctx.beginPath();
      ctx.moveTo(-7, -6);
      ctx.lineTo(2, 0);
      ctx.lineTo(-7, 6);
      ctx.moveTo(2, -6);
      ctx.lineTo(9, 0);
      ctx.lineTo(2, 6);
      ctx.stroke();
    }

    ctx.restore();
  }

  private getPhysicalButtonBadgeColor(btn: PhysicalButton): string {
    if (btn === 'R1' || btn === 'R2') return '#EF5350';
    if (btn === 'G1' || btn === 'G2') return '#66BB6A';
    if (btn === 'B1' || btn === 'B2') return '#42A5F5';
    if (btn === 'Y1' || btn === 'Y2') return '#FDD835';
    if (btn === 'OK' || btn === 'ESC') return '#90A4AE';
    return '#FFFFFF';
  }

  private getPhysicalButtonTitle(btn: PhysicalButton): string {
    if (btn in SHAPE_BUTTON_META) {
      const m = SHAPE_BUTTON_META[btn as keyof typeof SHAPE_BUTTON_META];
      return `${btn} (${m.label})`;
    }
    return btn;
  }

  private renderConfigModal(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    ctx.fillStyle = 'rgba(10, 14, 24, 0.85)';
    ctx.fillRect(0, 0, width, height);

    const mw = Math.min(780, width - 36);
    const mh = Math.min(580, height - 28);
    const mx = (width - mw) / 2;
    const my = (height - mh) / 2;

    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(mx, my, mw, mh, 20);
    ctx.fill();
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#FFD54F';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('16-Button Arcade Control Deck Setup (Parent / Builder)', mx + 24, my + 30);

    const closeX = mx + mw - 92;
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(closeX, my + 13, 68, 32, 10);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Close', closeX + 34, my + 29);
    this.hitRegions.push({
      x: closeX,
      y: my + 13,
      w: 68,
      h: 32,
      onDown: () => {
        this.configModalOpen = false;
        this.listeningForButton = null;
      },
    });

    const raw = this.input.getRawGamepadDebug();
    ctx.textAlign = 'left';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = raw.connected ? '#81C784' : '#FFB74D';
    const statusText = raw.connected
      ? `Connected (${raw.count} USB encoder${raw.count > 1 ? 's' : ''}): ${raw.id?.slice(0, 62)}`
      : 'No USB encoder active yet — press any arcade button! (Keys: QWE/ASD shapes, 1234/ZXCV colors)';
    ctx.fillText(statusText, mx + 24, my + 62);

    if (raw.connected) {
      const pressedStr =
        raw.pressedButtons.map((p) => `P${p.pad}:B${p.button}`).join(', ') || 'none';
      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(
        `Live Input  |  Stick Axes: [${raw.axes.slice(0, 2).join(', ')}]   Pressed: [${pressedStr}]`,
        mx + 24,
        my + 84
      );
    }

    // 2-Column grid for all 16 physical buttons!
    const mapping = this.input.getMapping();
    const gridStartY = my + 108;
    const colW = Math.floor((mw - 60) / 2);
    const rowH = 44;

    ALL_PHYSICAL_BUTTONS.forEach((btn, idx) => {
      const col = idx < 8 ? 0 : 1;
      const row = idx % 8;
      const rx = mx + 24 + col * (colW + 12);
      const ry = gridStartY + row * (rowH + 6);
      const isListening = this.listeningForButton === btn;

      ctx.fillStyle = isListening ? 'rgba(255, 213, 79, 0.22)' : 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.roundRect(rx, ry, colW, rowH, 9);
      ctx.fill();

      ctx.fillStyle = this.getPhysicalButtonBadgeColor(btn);
      ctx.beginPath();
      ctx.arc(rx + 18, ry + rowH / 2, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(this.getPhysicalButtonTitle(btn), rx + 34, ry + rowH / 2);

      const slots = (mapping.buttons[btn] ?? []).map(formatSlot).join(', ') || 'Unmapped';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillText(slots, rx + 142, ry + rowH / 2);

      const mapBtnW = 92;
      const mapBtnX = rx + colW - mapBtnW - 8;
      ctx.fillStyle = isListening ? '#FFB300' : '#334155';
      ctx.beginPath();
      ctx.roundRect(mapBtnX, ry + 7, mapBtnW, 30, 7);
      ctx.fill();
      ctx.fillStyle = isListening ? '#141926' : '#E2E8F0';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isListening ? 'Press...' : 'Remap', mapBtnX + mapBtnW / 2, ry + 22);

      this.hitRegions.push({
        x: mapBtnX,
        y: ry + 7,
        w: mapBtnW,
        h: 30,
        onDown: () => {
          this.listeningForButton = isListening ? null : btn;
        },
      });
    });

    const footerY = my + mh - 42;
    const invXBtn = mx + 24;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(invXBtn, footerY, 168, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Invert Stick X: ${mapping.invertX ? 'ON' : 'OFF'}`,
      invXBtn + 84,
      footerY + 15
    );
    this.hitRegions.push({
      x: invXBtn,
      y: footerY,
      w: 168,
      h: 30,
      onDown: () => {
        this.input.saveMapping({ ...mapping, invertX: !mapping.invertX });
      },
    });

    const invYBtn = mx + 204;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(invYBtn, footerY, 168, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(
      `Invert Stick Y: ${mapping.invertY ? 'ON' : 'OFF'}`,
      invYBtn + 84,
      footerY + 15
    );
    this.hitRegions.push({
      x: invYBtn,
      y: footerY,
      w: 168,
      h: 30,
      onDown: () => {
        this.input.saveMapping({ ...mapping, invertY: !mapping.invertY });
      },
    });

    const resetBtnX = mx + mw - 164;
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(resetBtnX, footerY, 140, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Reset Defaults', resetBtnX + 70, footerY + 15);
    this.hitRegions.push({
      x: resetBtnX,
      y: footerY,
      w: 140,
      h: 30,
      onDown: () => {
        this.input.resetMapping();
        this.listeningForButton = null;
      },
    });
  }
}
