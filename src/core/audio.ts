/**
 * Warm, parent-friendly procedural sound synthesis using the Web Audio API.
 * Zero external audio assets needed; works offline on Raspberry Pi.
 *
 * Note on Chromium / Raspberry Pi:
 * Launch Chromium with `--autoplay-policy=no-user-gesture-required` so audio
 * starts immediately on USB arcade joystick/button input without needing a mouse click.
 */
export class ArcadeAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  // Continuous loop nodes (cleaned up automatically on stopAllLoops / game exit)
  private hornNodes: { stop: () => void } | null = null;
  private sprayNodes: {
    stop: () => void;
    setMode: (mode: 'wash' | 'soap' | 'rinse' | 'dry') => void;
  } | null = null;

  constructor() {
    const unlock = () => {
      this.ensureContext();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  public ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.45;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // Will unlock on next user gesture if autoplay policy blocks it
      });
    }
    return this.ctx;
  }

  public get isUnlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Soft pink-ish noise so water, steam, and chugs sound warm instead of harsh
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  public stopAllLoops(): void {
    this.stopTrainHorn();
    this.stopWashStream();
  }

  /** Soft wooden marimba-like menu cursor move */
  public playMenuMove(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** Cheerful two-note chime when selecting a game */
  public playMenuSelect(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.27);
    });
  }

  /** Soft descending two-note chime when returning to main menu */
  public playMenuBack(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [587.33, 392.0].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.07;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  /** Train engine ignition rumble + puff */
  public playEngineStart(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(48, now);
    osc.frequency.exponentialRampToValueAtTime(92, now + 0.28);
    osc.frequency.exponentialRampToValueAtTime(64, now + 0.55);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.62);

    this.playTrainChug(0.7);
  }

  /** Gentle engine shutoff sigh */
  public playEngineStop(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(85, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.35);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  /** Rhythmic steam chug puff synced to wheel rotation */
  public playTrainChug(intensity = 0.5, accent = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const offset = Math.random() * 1.2;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(accent ? 360 : 280, now);
    filter.Q.setValueAtTime(1.8, now);

    const gain = ctx.createGain();
    const peak = Math.min(0.32, 0.12 + intensity * 0.18) * (accent ? 1.2 : 0.9);
    const dur = 0.11;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, offset, dur + 0.02);
  }

  /** Classic warm 3-note steam whistle / train horn while Yellow button is held */
  public startTrainHorn(): void {
    if (this.hornNodes) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.001, now);
    master.gain.linearRampToValueAtTime(0.24, now + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, now);

    // Warm train whistle triad (F4, A4, C5 with slight detune)
    const freqs = [349.23, 440.0, 523.25];
    const oscs = freqs.map((f, idx) => {
      const osc = ctx.createOscillator();
      osc.type = idx === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f * 0.97, now);
      osc.frequency.exponentialRampToValueAtTime(f, now + 0.07);
      const g = ctx.createGain();
      g.gain.value = idx === 0 ? 0.4 : 0.35;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      return osc;
    });

    filter.connect(master);
    master.connect(this.masterGain);

    this.hornNodes = {
      stop: () => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(Math.max(0.001, master.gain.value), t);
        master.gain.exponentialRampToValueAtTime(0.0008, t + 0.14);
        oscs.forEach((o) => {
          try {
            o.stop(t + 0.16);
          } catch {
            // ignore
          }
        });
      },
    };
  }

  public stopTrainHorn(): void {
    if (this.hornNodes) {
      this.hornNodes.stop();
      this.hornNodes = null;
    }
  }

  /** Air-brake hiss when Red brake button is pressed */
  public playBrakeHiss(speedRatio: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1600, now);

    const gain = ctx.createGain();
    const vol = 0.08 + Math.min(1, speedRatio) * 0.16;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now, Math.random() * 0.5, 0.24);
  }

  /** Playful musical pop when cycling train color */
  public playColorCycle(colorIndex: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const scale = [392.0, 440.0, 493.88, 523.25, 587.33, 659.25, 783.99, 880.0];
    const base = scale[colorIndex % scale.length];
    const now = ctx.currentTime;

    [base, base * 1.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  /** Cute two-beep car horn ("beep-beep!") */
  public playCarHorn(pitchFactor = 1.0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    [0, 0.14].forEach((delay) => {
      const t = now + delay;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'triangle';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(420 * pitchFactor, t);
      osc2.frequency.setValueAtTime(530 * pitchFactor, t);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.11);
      osc2.stop(t + 0.11);
    });
  }

  /** Bubbly pop sound during soap scrubbing */
  public playBubblePop(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startFreq = 450 + Math.random() * 450;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 1.9, now + 0.065);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.075);
  }

  /** Continuous water spray / foam / rinse / air blower sound while washing */
  public startWashStream(mode: 'wash' | 'soap' | 'rinse' | 'dry'): void {
    if (this.sprayNodes) {
      this.sprayNodes.setMode(mode);
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);

    // Optional soft hum for the dryer blower
    const blowerOsc = ctx.createOscillator();
    const blowerGain = ctx.createGain();
    blowerOsc.type = 'sine';
    blowerOsc.frequency.setValueAtTime(210, now);
    blowerGain.gain.setValueAtTime(0, now);

    const applyMode = (m: 'wash' | 'soap' | 'rinse' | 'dry') => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (m === 'wash') {
        filter.frequency.setTargetAtTime(1100, t, 0.05);
        filter.Q.setTargetAtTime(0.9, t, 0.05);
        gain.gain.setTargetAtTime(0.22, t, 0.04);
        blowerGain.gain.setTargetAtTime(0, t, 0.04);
      } else if (m === 'soap') {
        filter.frequency.setTargetAtTime(620, t, 0.05);
        filter.Q.setTargetAtTime(1.5, t, 0.05);
        gain.gain.setTargetAtTime(0.16, t, 0.04);
        blowerGain.gain.setTargetAtTime(0, t, 0.04);
      } else if (m === 'rinse') {
        filter.frequency.setTargetAtTime(1450, t, 0.05);
        filter.Q.setTargetAtTime(0.7, t, 0.05);
        gain.gain.setTargetAtTime(0.24, t, 0.04);
        blowerGain.gain.setTargetAtTime(0, t, 0.04);
      } else {
        filter.frequency.setTargetAtTime(420, t, 0.05);
        filter.Q.setTargetAtTime(1.2, t, 0.05);
        gain.gain.setTargetAtTime(0.18, t, 0.04);
        blowerGain.gain.setTargetAtTime(0.09, t, 0.05);
      }
    };

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    blowerOsc.connect(blowerGain);
    blowerGain.connect(this.masterGain);

    src.start(now);
    blowerOsc.start(now);
    applyMode(mode);

    this.sprayNodes = {
      setMode: applyMode,
      stop: () => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        gain.gain.setTargetAtTime(0.0005, t, 0.04);
        blowerGain.gain.setTargetAtTime(0.0005, t, 0.04);
        try {
          src.stop(t + 0.14);
          blowerOsc.stop(t + 0.14);
        } catch {
          // ignore
        }
      },
    };
  }

  public stopWashStream(): void {
    if (this.sprayNodes) {
      this.sprayNodes.stop();
      this.sprayNodes = null;
    }
  }

  /** Ding when a wash stage finishes, or big sparkle arpeggio when car is 100% clean! */
  public playStageComplete(finalCelebration = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const notes = finalCelebration
      ? [523.25, 659.25, 783.99, 1046.5]
      : [587.33, 880.0];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (finalCelebration ? 0.36 : 0.22));
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** Friendly gentle double-boop when pressing Next Car while steps are still needed */
  public playStepsNeededAlert(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [330.0, 261.63].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.24, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  }

  /** Brass station bell ("ding-ding!") + cheerful celebration arpeggio on station stop */
  public playStationCelebration(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Two bright brass station bell rings
    [0, 0.22].forEach((delay) => {
      const t = now + delay;
      [1174.66, 2349.32].forEach((freq, overtone) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(overtone === 0 ? 0.24 : 0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    });

    // Cheerful ascending celebration chime
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const t = now + 0.36 + idx * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.24, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  /** Cute soft pop when a passenger gets on or off the train */
  public playPassengerPop(boarding: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const startF = boarding ? 420 : 620;
    const endF = boarding ? 680 : 390;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(endF, now + 0.085);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  /** Mechanical railroad switch lever clack-chunk + directional confirmation chime */
  public playTrackSwitch(branch: 'left' | 'straight' | 'right'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // 1. Heavy steel lever clack
    if (this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(520, now);
      filter.Q.setValueAtTime(2.6, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.masterGain);
      src.start(now, 0.2, 0.09);
    }

    // 2. Distinct musical confirmation tone (Port = warm C5, Straight = E5, Starboard = bright G5)
    const targetFreq = branch === 'left' ? 440.0 : branch === 'straight' ? 554.37 : 659.25;
    [targetFreq * 0.75, targetFreq].forEach((freq, idx) => {
      const t = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  /** Warm marimba / celesta / bell bloom note for Music & Bubble Garden */
  public playMusicalBloom(freq: number, variant: 'warm' | 'bright' | 'bass' = 'warm'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const mainOsc = ctx.createOscillator();
    const overtoneOsc = ctx.createOscillator();
    const mainGain = ctx.createGain();
    const overtoneGain = ctx.createGain();

    mainOsc.type = variant === 'bass' ? 'triangle' : 'sine';
    overtoneOsc.type = 'triangle';

    mainOsc.frequency.setValueAtTime(freq, now);
    overtoneOsc.frequency.setValueAtTime(freq * (variant === 'bright' ? 2 : 3), now);

    const dur = variant === 'bass' ? 0.55 : 0.48;
    mainGain.gain.setValueAtTime(0.001, now);
    mainGain.gain.linearRampToValueAtTime(0.28, now + 0.014);
    mainGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    overtoneGain.gain.setValueAtTime(0.001, now);
    overtoneGain.gain.linearRampToValueAtTime(variant === 'bright' ? 0.12 : 0.06, now + 0.01);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.55);

    mainOsc.connect(mainGain);
    overtoneOsc.connect(overtoneGain);
    mainGain.connect(this.masterGain);
    overtoneGain.connect(this.masterGain);

    mainOsc.start(now);
    overtoneOsc.start(now);
    mainOsc.stop(now + dur + 0.03);
    overtoneOsc.stop(now + dur + 0.03);
  }

  /** Gentle pentatonic sparkle chime for the 6 White Shape Buttons (X1..X6) */
  public playShapeSparkle(shapeIndex: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const base = pentatonic[((shapeIndex % 6) + 6) % 6];
    const now = ctx.currentTime;

    [base, base * 1.5].forEach((f, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.2 : 0.11, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }

  /** Friendly door knock/open + synthesized animal voice for Peekaboo Doors */
  public playAnimalDoorGreeting(
    animal: 'puppy' | 'frog' | 'duck' | 'kitty',
    alreadyOpen = false
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    let vStart = now;
    if (!alreadyOpen) {
      // Soft wooden door latch pop before the animal greets
      const latchOsc = ctx.createOscillator();
      const latchGain = ctx.createGain();
      latchOsc.type = 'triangle';
      latchOsc.frequency.setValueAtTime(190, now);
      latchOsc.frequency.exponentialRampToValueAtTime(340, now + 0.07);
      latchGain.gain.setValueAtTime(0.18, now);
      latchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      latchOsc.connect(latchGain);
      latchGain.connect(this.masterGain);
      latchOsc.start(now);
      latchOsc.stop(now + 0.09);
      vStart = now + 0.09;
    }

    if (animal === 'puppy') {
      // Cheerful two-syllable "woof-woof!"
      [0, 0.16].forEach((d, idx) => {
        const t = vStart + d;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        const pitch = idx === 0 ? 250 : 290;
        osc.frequency.setValueAtTime(pitch * 0.85, t);
        osc.frequency.exponentialRampToValueAtTime(pitch * 1.25, t + 0.045);
        osc.frequency.exponentialRampToValueAtTime(pitch * 0.72, t + 0.12);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(680, t);
        filter.Q.setValueAtTime(1.8, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        osc.connect(filter);
        filter.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.14);
      });
    } else if (animal === 'frog') {
      // Musical bouncy "rib-bit!"
      [0, 0.13].forEach((d, idx) => {
        const t = vStart + d;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx === 0 ? 185 : 240, t);
        osc.frequency.exponentialRampToValueAtTime(idx === 0 ? 310 : 470, t + 0.09);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.24, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        osc.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } else if (animal === 'duck') {
      // Friendly nasal "quack-quack!"
      [0, 0.15].forEach((d) => {
        const t = vStart + d;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(370, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1150, t);
        filter.Q.setValueAtTime(3.2, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.26, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        osc.connect(filter);
        filter.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } else {
      // Sweet rising-and-falling "me-ow~"
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, vStart);
      osc.frequency.exponentialRampToValueAtTime(760, vStart + 0.11);
      osc.frequency.exponentialRampToValueAtTime(480, vStart + 0.32);
      g.gain.setValueAtTime(0.001, vStart);
      g.gain.linearRampToValueAtTime(0.22, vStart + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, vStart + 0.34);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(vStart);
      osc.stop(vStart + 0.36);
    }
  }

  /** Soft wooden knock when opening an empty peekaboo door (non-punitive!) */
  public playGentleWoodKnock(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    [0, 0.09].forEach((d, idx) => {
      const t = now + d;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 240 : 210, t);
      osc.frequency.exponentialRampToValueAtTime(115, t + 0.055);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.075);
    });
  }

  /** Satisfying wooden toy block clack (rising slightly with stack height, or sliding off on '-') */
  public playWoodBlockClack(stackIndex: number, removing = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
    const freq = scale[Math.max(0, Math.min(scale.length - 1, stackIndex))];
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    if (removing) {
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.11);
    } else {
      osc.frequency.setValueAtTime(freq * 0.78, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.04);
    }
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.26, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  /** Soft wooden latch click when a momentary peekaboo door swings shut */
  public playDoorClose(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.065);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.15, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  /**
   * Playful car launch rev + musical major-chord horn for Stunt Ramp Garage.
   * colorIndex 0..3 tunes the horn to C5 / E5 / G5 / C6 so rapid button mashing always sounds harmonious!
   */
  public playCarLaunch(
    colorIndex: number,
    vehicleStyle: 'dump' | 'buggy' | 'racer' | 'tractor' | 'rescue' | 'icecream' = 'racer'
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // 1. Warm filtered toy-engine rev ("vroooom!")
    const revOsc = ctx.createOscillator();
    const revFilter = ctx.createBiquadFilter();
    const revGain = ctx.createGain();
    revOsc.type = 'sawtooth';
    const baseRev = vehicleStyle === 'tractor' || vehicleStyle === 'dump' ? 68 : 95;
    revOsc.frequency.setValueAtTime(baseRev, now);
    revOsc.frequency.exponentialRampToValueAtTime(baseRev * 2.15, now + 0.19);
    revFilter.type = 'lowpass';
    revFilter.frequency.setValueAtTime(420, now);
    revFilter.frequency.linearRampToValueAtTime(780, now + 0.18);
    revGain.gain.setValueAtTime(0.001, now);
    revGain.gain.linearRampToValueAtTime(0.16, now + 0.025);
    revGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    revOsc.connect(revFilter);
    revFilter.connect(revGain);
    revGain.connect(this.masterGain);
    revOsc.start(now);
    revOsc.stop(now + 0.26);

    // 2. Harmonious C-major horn / siren / jingle accent per vehicle style
    const chord = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const hornFreq = chord[((colorIndex % 4) + 4) % 4];

    if (vehicleStyle === 'rescue') {
      // Friendly two-note "wee-oo!"
      [hornFreq, hornFreq * 0.75].forEach((f, idx) => {
        const t = now + 0.03 + idx * 0.11;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.2, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        osc.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } else if (vehicleStyle === 'icecream') {
      // Sweet 3-note music-box jingle
      [hornFreq, hornFreq * 1.25, hornFreq * 1.5].forEach((f, idx) => {
        const t = now + 0.02 + idx * 0.065;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } else {
      // Classic cheerful double "beep-beep!" (or deep brass toot for dump/tractor)
      const mult = vehicleStyle === 'dump' || vehicleStyle === 'tractor' ? 0.5 : 1.0;
      const offsets = vehicleStyle === 'buggy' ? [0.02, 0.1] : [0.03];
      offsets.forEach((d) => {
        const t = now + d;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(hornFreq * mult, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.21, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        osc.connect(g);
        g.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.13);
      });
    }
  }

  /** Crisp bubbly pop + sparkle chime when a flying car pops a sky balloon */
  public playBalloonPop(pitchIndex = 0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
    const base = pentatonic[((pitchIndex % 6) + 6) % 6];

    const popOsc = ctx.createOscillator();
    const popGain = ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(base * 0.7, now);
    popOsc.frequency.exponentialRampToValueAtTime(base * 1.9, now + 0.055);
    popGain.gain.setValueAtTime(0.24, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    popOsc.connect(popGain);
    popGain.connect(this.masterGain);
    popOsc.start(now);
    popOsc.stop(now + 0.08);
  }

  /** Soft rubbery spring boing when a stunt car lands and bounces on its tires */
  public playTireBounce(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(245, now + 0.075);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.13);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }
}
