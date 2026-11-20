import { ArcadeAudio } from './audio';
import { ALL_CABINET_BUTTONS, InputManager } from './input';
import {
  ArcadeGameDefinition,
  ArcadeGameInstance,
  CabinetButton,
  CabinetSnapshot,
  ControlIcon,
  Direction,
  GameControlDescriptor,
} from './types';

interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  onDown: () => void;
  onUp?: () => void;
}

const BUTTON_LED_COLORS: Record<CabinetButton, { face: string; glow: string; dark: string }> = {
  GREEN: { face: '#2ECC71', glow: 'rgba(46, 204, 113, 0.65)', dark: '#1B7943' },
  YELLOW: { face: '#FDD835', glow: 'rgba(253, 216, 53, 0.65)', dark: '#B28900' },
  RED: { face: '#EF5350', glow: 'rgba(239, 83, 80, 0.65)', dark: '#A62825' },
  BLUE: { face: '#29B6F6', glow: 'rgba(41, 182, 246, 0.65)', dark: '#0277BD' },
  OK: { face: '#66BB6A', glow: 'rgba(102, 187, 106, 0.65)', dark: '#2E7D32' },
  ESC: { face: '#ECEFF1', glow: 'rgba(236, 239, 241, 0.55)', dark: '#78909C' },
};

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
  private listeningForButton: CabinetButton | null = null;
  private prevRawPressed: number[] = [];

  private timeSec = 0;
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

      // Check interactive UI hit regions first (buttons, config modal, etc.)
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

      // Allow clicking/tapping game cards in the main menu
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

    // If Builder/Parent USB Encoder remapping modal is open, handle button capture
    if (this.configModalOpen) {
      this.updateConfigModal(snap);
      return;
    }

    // Global ESC soft-reset: always returns to the Main Menu from any game!
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
    let next = this.selectedIndex;

    if (snap.dirJustPressed.RIGHT) {
      next = (this.selectedIndex + 1) % count;
    } else if (snap.dirJustPressed.LEFT) {
      next = (this.selectedIndex - 1 + count) % count;
    } else if (snap.dirJustPressed.DOWN) {
      if (this.selectedIndex + cols < count) {
        next = this.selectedIndex + cols;
      }
    } else if (snap.dirJustPressed.UP) {
      if (this.selectedIndex - cols >= 0) {
        next = this.selectedIndex - cols;
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
    if (count <= 2) return count;
    if (count <= 4) return 2;
    return 3;
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
        (b) => !this.prevRawPressed.includes(b)
      );
      if (newlyPressed !== undefined) {
        const current = this.input.getMapping();
        const updated = {
          ...current,
          buttons: {
            ...current.buttons,
            [this.listeningForButton]: [newlyPressed],
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

    const deckHeight = this.showDeckBar ? Math.min(112, Math.max(88, Math.round(height * 0.14))) : 0;
    const viewportHeight = height - deckHeight;
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

    // 3. Chrome-plated LED Arcade Control Deck Strip along bottom
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
    // Warm night-sky / arcade-playroom gradient background
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#1B2845');
    bg.addColorStop(0.55, '#274060');
    bg.addColorStop(1, '#1D334A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Soft floating background polka-dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let i = 0; i < 14; i++) {
      const rx = ((i * 173) % width);
      const ry = ((i * 119 + this.timeSec * 8) % height);
      ctx.beginPath();
      ctx.arc(rx, ry, 26 + (i % 4) * 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Playful Arcade Marquee Header
    const headerY = Math.max(46, height * 0.1);
    ctx.fillStyle = '#FFD54F';
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TODDLER ARCADE', width / 2, headerY);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('Move the joystick to pick a game, then press OK!', width / 2, headerY + 34);

    // Game Grid Layout
    const count = this.games.length;
    const cols = this.getGridColumns(count);
    const rows = Math.ceil(count / cols);

    const gridTop = headerY + 66;
    const availH = height - gridTop - 28;
    const availW = Math.min(width - 80, 980);

    const gap = 34;
    const cardW = Math.min(390, Math.floor((availW - gap * (cols - 1)) / cols));
    const cardH = Math.min(310, Math.floor((availH - gap * (rows - 1)) / rows));

    const totalGridW = cols * cardW + (cols - 1) * gap;
    const totalGridH = rows * cardH + (rows - 1) * gap;
    const startX = Math.round((width - totalGridW) / 2);
    const startY = Math.round(gridTop + (availH - totalGridH) / 2);

    this.games.forEach((game, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);
      const isSelected = idx === this.selectedIndex;

      this.cardRects.push({ x, y, w: cardW, h: cardH, index: idx });

      const lift = isSelected ? -6 + Math.sin(this.timeSec * 5) * 3 : 0;
      const scale = isSelected ? 1.035 : 0.98;

      ctx.save();
      ctx.translate(x + cardW / 2, y + cardH / 2 + lift);
      ctx.scale(scale, scale);
      ctx.translate(-cardW / 2, -cardH / 2);

      // Outer glow ring when selected
      if (isSelected) {
        ctx.shadowColor = '#FFD54F';
        ctx.shadowBlur = 28;
      }

      // Card base frame
      ctx.fillStyle = isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.88)';
      ctx.beginPath();
      ctx.roundRect(0, 0, cardW, cardH, 24);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Cover art viewport inside card
      const artMargin = 12;
      const artH = cardH - 82;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(artMargin, artMargin, cardW - artMargin * 2, artH, 16);
      ctx.clip();
      game.renderCover(ctx, cardW, artH + artMargin, this.timeSec, isSelected);
      ctx.restore();

      // Title & subtitle footer
      ctx.fillStyle = '#141926';
      ctx.font = '900 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(game.title, cardW / 2, artH + 34);

      ctx.fillStyle = '#546E7A';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(game.subtitle, cardW / 2, artH + 58);

      // Thick golden selection border
      if (isSelected) {
        ctx.strokeStyle = '#FFD54F';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.roundRect(-3, -3, cardW + 6, cardH + 6, 26);
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
    const y = 14;
    let rightX = width - 14;

    // 1. Setup / USB Controller Mapping button (F2)
    const gearW = 40;
    rightX -= gearW;
    const gearX = rightX;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.52)';
    ctx.beginPath();
    ctx.roundRect(gearX, y, gearW, 36, 10);
    ctx.fill();
    ctx.fillStyle = '#CFD8DC';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SET', gearX + gearW / 2, y + 18);
    this.hitRegions.push({
      x: gearX,
      y,
      w: gearW,
      h: 36,
      onDown: () => {
        this.configModalOpen = !this.configModalOpen;
        this.listeningForButton = null;
      },
    });

    // 2. Mute toggle button
    rightX -= 48;
    const muteX = rightX;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.52)';
    ctx.beginPath();
    ctx.roundRect(muteX, y, 40, 36, 10);
    ctx.fill();
    ctx.fillStyle = this.audio.isMuted ? '#EF5350' : '#CFD8DC';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(this.audio.isMuted ? 'OFF' : 'SND', muteX + 20, y + 18);
    this.hitRegions.push({
      x: muteX,
      y,
      w: 40,
      h: 36,
      onDown: () => {
        this.audio.toggleMute();
      },
    });

    // 3. Gamepad connected badge
    const badgeW = snap.gamepadConnected ? 116 : 98;
    rightX -= badgeW + 8;
    ctx.fillStyle = 'rgba(20, 25, 38, 0.52)';
    ctx.beginPath();
    ctx.roundRect(rightX, y, badgeW, 36, 18);
    ctx.fill();

    ctx.fillStyle = snap.gamepadConnected ? '#4CAF50' : '#FFB300';
    ctx.beginPath();
    ctx.arc(rightX + 18, y + 18, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ECEFF1';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(snap.gamepadConnected ? 'USB STICK' : 'KEYS / USB', rightX + 30, y + 19);
  }

  private renderArcadeDeckBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    topY: number,
    barH: number,
    snap: CabinetSnapshot
  ): void {
    // Brushed dark arcade control-panel surface
    const panelGrad = ctx.createLinearGradient(0, topY, 0, topY + barH);
    panelGrad.addColorStop(0, '#222B3A');
    panelGrad.addColorStop(1, '#141926');
    ctx.fillStyle = panelGrad;
    ctx.fillRect(0, topY, width, barH);

    // Chrome trim bezel line
    ctx.fillStyle = '#78909C';
    ctx.fillRect(0, topY, width, 3);

    const centerY = topY + barH / 2 + 2;

    // --- Left: Virtual / Visual 8-Way Ball-Top Joystick ---
    const stickBaseX = Math.max(82, width * 0.1);
    const stickBaseY = centerY - 5;
    ctx.fillStyle = '#10151F';
    ctx.beginPath();
    ctx.ellipse(stickBaseX, stickBaseY + 6, 28, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#607D8B';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Subtle left/right directional arrows beside the joystick dust-washer
    ctx.fillStyle = snap.dirDown.LEFT ? '#FFD54F' : 'rgba(207, 216, 220, 0.45)';
    ctx.beginPath();
    ctx.moveTo(stickBaseX - 42, stickBaseY + 2);
    ctx.lineTo(stickBaseX - 33, stickBaseY - 4);
    ctx.lineTo(stickBaseX - 33, stickBaseY + 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = snap.dirDown.RIGHT ? '#FFD54F' : 'rgba(207, 216, 220, 0.45)';
    ctx.beginPath();
    ctx.moveTo(stickBaseX + 42, stickBaseY + 2);
    ctx.lineTo(stickBaseX + 33, stickBaseY - 4);
    ctx.lineTo(stickBaseX + 33, stickBaseY + 8);
    ctx.closePath();
    ctx.fill();

    // Left / Right / Up / Down touch zones around joystick for desktop/tablet testing
    const dirs: Array<{ dir: Direction; dx: number; dy: number }> = [
      { dir: 'LEFT', dx: -40, dy: 0 },
      { dir: 'RIGHT', dx: 40, dy: 0 },
      { dir: 'UP', dx: 0, dy: -28 },
      { dir: 'DOWN', dx: 0, dy: 28 },
    ];
    for (const d of dirs) {
      this.hitRegions.push({
        x: stickBaseX + d.dx - 22,
        y: stickBaseY + d.dy - 18,
        w: 44,
        h: 36,
        onDown: () => this.input.setVirtualDirection(d.dir, true),
        onUp: () => this.input.setVirtualDirection(d.dir, false),
      });
    }

    // Steel shaft rising out of dust washer + glossy red arcade ball-top!
    const ballX = stickBaseX + snap.axisX * 18;
    const ballY = stickBaseY - 13 + snap.axisY * 9;
    ctx.strokeStyle = '#CFD8DC';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stickBaseX, stickBaseY + 5);
    ctx.lineTo(ballX, ballY + 4);
    ctx.stroke();

    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.arc(ballX, ballY, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.beginPath();
    ctx.arc(ballX - 4, ballY - 4, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ECEFF1';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Joystick', stickBaseX, centerY + 17);

    // --- Center: Active Game's Colored LED Push Buttons (or Main Menu OK) ---
    const descriptors: GameControlDescriptor[] = this.activeGameDef
      ? this.activeGameDef.controls
      : [{ action: 'select', button: 'OK', label: 'Play Game', icon: 'ok' }];

    const btnSpacing = Math.min(148, Math.floor((width - 320) / Math.max(1, descriptors.length)));
    const totalCenterW = (descriptors.length - 1) * btnSpacing;
    const startBtnX = width / 2 - totalCenterW / 2;

    const flashingSet = new Set<CabinetButton>(
      this.activeGame?.getFlashingButtons ? this.activeGame.getFlashingButtons() : []
    );
    const flashPulse = Math.sin(this.timeSec * 18) > 0;

    descriptors.forEach((desc, idx) => {
      const bx = startBtnX + idx * btnSpacing;
      this.drawIlluminatedArcadeButton(
        ctx,
        bx,
        centerY - 7,
        24,
        desc.button,
        desc.label,
        desc.icon,
        snap.buttonDown[desc.button],
        flashingSet.has(desc.button) && flashPulse
      );
    });

    // --- Right: Dedicated ESC / Back to Menu Chrome Button ---
    const escX = Math.min(width - 74, width * 0.9);
    this.drawIlluminatedArcadeButton(
      ctx,
      escX,
      centerY - 7,
      20,
      'ESC',
      'Menu (Esc)',
      'back',
      snap.buttonDown.ESC,
      false
    );
  }

  private drawIlluminatedArcadeButton(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    button: CabinetButton,
    label: string,
    icon: ControlIcon,
    isPressed: boolean,
    isFlashingAlert = false
  ): void {
    const style = BUTTON_LED_COLORS[button];

    // Interactive click/touch target for desktop & touchscreen testing
    this.hitRegions.push({
      x: cx - radius - 14,
      y: cy - radius - 10,
      w: (radius + 14) * 2,
      h: radius * 2 + 34,
      onDown: () => this.input.setVirtualButton(button, true),
      onUp: () => this.input.setVirtualButton(button, false),
    });

    ctx.save();
    if (isPressed || isFlashingAlert) {
      ctx.shadowColor = isFlashingAlert ? '#FFFFFF' : style.glow;
      ctx.shadowBlur = isFlashingAlert ? 28 : 20;
    }

    if (isFlashingAlert) {
      ctx.strokeStyle = style.face;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Chrome-plated outer bezel (matching EG STARTS Chrome LED buttons!)
    ctx.fillStyle = '#B0BEC5';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ECEFF1';
    ctx.beginPath();
    ctx.arc(cx, cy - 1, radius + 3, 0, Math.PI * 2);
    ctx.fill();

    // Illuminated colored plunger cap
    const pressOffset = isPressed ? 2 : 0;
    ctx.fillStyle = isPressed ? '#FFFFFF' : style.face;
    ctx.beginPath();
    ctx.arc(cx, cy + pressOffset, radius - 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = style.face;
    ctx.beginPath();
    ctx.arc(cx, cy + pressOffset, radius - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Simple bold icon on button face (so pre-reading toddlers recognize actions!)
    this.drawButtonIcon(ctx, cx, cy + pressOffset, icon);

    // Label underneath
    ctx.fillStyle = '#ECEFF1';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, cy + radius + 7);
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

    if (icon === 'ok') {
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

  private renderConfigModal(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): void {
    ctx.fillStyle = 'rgba(10, 14, 24, 0.82)';
    ctx.fillRect(0, 0, width, height);

    const mw = Math.min(640, width - 40);
    const mh = Math.min(500, height - 40);
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
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('USB Arcade Encoder Setup (Parent / Builder)', mx + 24, my + 34);

    // Close button
    const closeX = mx + mw - 92;
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(closeX, my + 16, 68, 34, 10);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Close', closeX + 34, my + 33);
    this.hitRegions.push({
      x: closeX,
      y: my + 16,
      w: 68,
      h: 34,
      onDown: () => {
        this.configModalOpen = false;
        this.listeningForButton = null;
      },
    });

    const raw = this.input.getRawGamepadDebug();
    ctx.textAlign = 'left';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = raw.connected ? '#81C784' : '#FFB74D';
    const statusText = raw.connected
      ? `Connected: ${raw.id?.slice(0, 48)}`
      : 'No USB gamepad active yet — press any arcade button/stick to wake it!';
    ctx.fillText(statusText, mx + 24, my + 70);

    if (raw.connected) {
      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(
        `Live Raw Input  |  Axes: [${raw.axes.slice(0, 2).join(', ')}]   Pressed Slots: [${raw.pressedButtons.join(', ') || 'none'}]`,
        mx + 24,
        my + 95
      );
    }

    // Button binding rows
    const mapping = this.input.getMapping();
    let rowY = my + 132;
    for (const btn of ALL_CABINET_BUTTONS) {
      const isListening = this.listeningForButton === btn;
      ctx.fillStyle = isListening ? 'rgba(255, 213, 79, 0.2)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(mx + 24, rowY, mw - 48, 44, 10);
      ctx.fill();

      ctx.fillStyle = BUTTON_LED_COLORS[btn].face;
      ctx.beginPath();
      ctx.arc(mx + 46, rowY + 22, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${btn} Button`, mx + 68, rowY + 22);

      const slots = mapping.buttons[btn]?.map((n) => `B${n}`).join(', ') || 'Unmapped';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.fillText(`USB Slot: ${slots}`, mx + 230, rowY + 22);

      const mapBtnX = mx + mw - 156;
      ctx.fillStyle = isListening ? '#FFB300' : '#334155';
      ctx.beginPath();
      ctx.roundRect(mapBtnX, rowY + 7, 118, 30, 8);
      ctx.fill();
      ctx.fillStyle = isListening ? '#141926' : '#E2E8F0';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isListening ? 'Press Arcade...' : 'Remap USB', mapBtnX + 59, rowY + 22);

      this.hitRegions.push({
        x: mapBtnX,
        y: rowY + 7,
        w: 118,
        h: 30,
        onDown: () => {
          this.listeningForButton = isListening ? null : btn;
        },
      });

      rowY += 50;
    }

    // Footer actions: Invert X & Reset Defaults
    const footerY = my + mh - 46;
    const invXBtn = mx + 24;
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.roundRect(invXBtn, footerY, 175, 32, 8);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Invert Stick X: ${mapping.invertX ? 'ON' : 'OFF'}`,
      invXBtn + 87,
      footerY + 16
    );
    this.hitRegions.push({
      x: invXBtn,
      y: footerY,
      w: 175,
      h: 32,
      onDown: () => {
        this.input.saveMapping({ ...mapping, invertX: !mapping.invertX });
      },
    });

    const resetBtnX = mx + mw - 174;
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(resetBtnX, footerY, 150, 32, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Reset Defaults', resetBtnX + 75, footerY + 16);
    this.hitRegions.push({
      x: resetBtnX,
      y: footerY,
      w: 150,
      h: 32,
      onDown: () => {
        this.input.resetMapping();
        this.listeningForButton = null;
      },
    });
  }
}
