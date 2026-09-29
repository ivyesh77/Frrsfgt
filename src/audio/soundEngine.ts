/**
 * Small Web Audio based sound engine. All effects are synthesized procedurally
 * (oscillators + gain envelopes) so the game never depends on external audio
 * files that could be missing, slow to load, or licensing-encumbered.
 *
 * The underlying AudioContext is only created/resumed after `unlock()` is
 * called from a real user gesture, respecting browser autoplay restrictions.
 */

type OscType = OscillatorType;

interface Tone {
  freq: number;
  type?: OscType;
  start: number;
  duration: number;
  peakGain?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private musicPlaying = false;
  private muted = false;
  private musicEnabled = false;

  /** Must be called from within a user-gesture handler (e.g. a click). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.7;
      this.masterGain.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.masterGain);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) this.startMusic();
    else this.stopMusic();
  }

  private playTones(tones: Tone[]): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    for (const tone of tones) {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type ?? 'sine';
        osc.frequency.value = tone.freq;
        const peak = tone.peakGain ?? 0.35;
        const t0 = now + tone.start;
        const t1 = t0 + tone.duration;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.02, tone.duration / 4));
        gain.gain.exponentialRampToValueAtTime(0.0001, t1);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0);
        osc.stop(t1 + 0.02);
      } catch {
        // Ignore individual tone failures — better silent than a crash.
      }
    }
  }

  playClick(): void {
    this.playTones([{ freq: 640, type: 'triangle', start: 0, duration: 0.06, peakGain: 0.25 }]);
  }

  playReveal(): void {
    this.playTones([
      { freq: 520, type: 'sine', start: 0, duration: 0.16, peakGain: 0.3 },
      { freq: 780, type: 'sine', start: 0.05, duration: 0.16, peakGain: 0.22 },
    ]);
  }

  playRoundStart(): void {
    this.playTones([{ freq: 440, type: 'sine', start: 0, duration: 0.12, peakGain: 0.22 }]);
  }

  playCorrect(): void {
    this.playTones([
      { freq: 523.25, type: 'sine', start: 0, duration: 0.14, peakGain: 0.32 },
      { freq: 659.25, type: 'sine', start: 0.08, duration: 0.14, peakGain: 0.3 },
      { freq: 783.99, type: 'sine', start: 0.16, duration: 0.22, peakGain: 0.3 },
    ]);
  }

  playWrong(): void {
    this.playTones([
      { freq: 220, type: 'sawtooth', start: 0, duration: 0.18, peakGain: 0.22 },
      { freq: 164.81, type: 'sawtooth', start: 0.1, duration: 0.22, peakGain: 0.2 },
    ]);
  }

  playTimeout(): void {
    this.playTones([
      { freq: 300, type: 'square', start: 0, duration: 0.1, peakGain: 0.15 },
      { freq: 220, type: 'square', start: 0.12, duration: 0.16, peakGain: 0.15 },
    ]);
  }

  playStreak(): void {
    this.playTones([
      { freq: 660, type: 'sine', start: 0, duration: 0.1, peakGain: 0.25 },
      { freq: 880, type: 'sine', start: 0.06, duration: 0.1, peakGain: 0.25 },
      { freq: 1108.73, type: 'sine', start: 0.12, duration: 0.16, peakGain: 0.25 },
    ]);
  }

  playComplete(): void {
    this.playTones([
      { freq: 523.25, type: 'sine', start: 0, duration: 0.18, peakGain: 0.3 },
      { freq: 659.25, type: 'sine', start: 0.14, duration: 0.18, peakGain: 0.3 },
      { freq: 783.99, type: 'sine', start: 0.28, duration: 0.18, peakGain: 0.3 },
      { freq: 1046.5, type: 'sine', start: 0.42, duration: 0.32, peakGain: 0.32 },
    ]);
  }

  playHighScore(): void {
    this.playTones([
      { freq: 659.25, type: 'sine', start: 0, duration: 0.14, peakGain: 0.3 },
      { freq: 830.61, type: 'sine', start: 0.1, duration: 0.14, peakGain: 0.3 },
      { freq: 1046.5, type: 'sine', start: 0.2, duration: 0.14, peakGain: 0.32 },
      { freq: 1318.51, type: 'sine', start: 0.3, duration: 0.4, peakGain: 0.34 },
    ]);
  }

  private startMusic(): void {
    const ctx = this.ctx;
    const musicGain = this.musicGain;
    if (!ctx || !musicGain || this.musicPlaying) return;
    this.musicPlaying = true;

    const notes = [220, 277.18, 329.63, 415.3];
    musicGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1);

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.18 / (i + 1);
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start();
      this.musicNodes.push({ osc, gain });
    });
  }

  private stopMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicPlaying) return;
    this.musicGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const nodes = this.musicNodes;
    this.musicNodes = [];
    this.musicPlaying = false;
    setTimeout(() => {
      nodes.forEach(({ osc }) => {
        try {
          osc.stop();
        } catch {
          // already stopped
        }
      });
    }, 500);
  }

  get isMusicEnabled(): boolean {
    return this.musicEnabled;
  }
}

export const soundEngine = new SoundEngine();
