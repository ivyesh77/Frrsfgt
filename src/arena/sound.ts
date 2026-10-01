/**
 * Tiny sound-effect system built entirely from the Web Audio API's oscillator/gain nodes —
 * no external audio files/assets are fetched or bundled. Every cue is a short synthesized
 * tone (or a couple of tones in sequence), which is enough to give real audible feedback
 * for key events without taking on an asset-loading dependency. Respects the user's own
 * Settings toggle (see prefs.ts) and never plays anything if sound/music is turned off, and
 * degrades silently (never throws) in a browser/tab where AudioContext can't start yet
 * (e.g. before the first user gesture — a hard browser autoplay restriction, not a bug).
 */
import { getPrefs } from './prefs';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

interface Tone {
  freq: number;
  startOffset: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

function playTones(tones: Tone[]): void {
  if (!getPrefs().soundEnabled) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    for (const tone of tones) {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.type = tone.type ?? 'sine';
      osc.frequency.setValueAtTime(tone.freq, now + tone.startOffset);
      const peak = tone.gain ?? 0.12;
      const start = now + tone.startOffset;
      const end = start + tone.duration;
      gainNode.gain.setValueAtTime(0, start);
      gainNode.gain.linearRampToValueAtTime(peak, start + Math.min(0.015, tone.duration / 4));
      gainNode.gain.linearRampToValueAtTime(0, end);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // Never let a sound-effect failure break the actual game action it's attached to.
  }
}

// ---------------------------------------------------------------------------
// Background music — a small procedurally-generated ambient pad (a handful of soft,
// slowly-detuned sine oscillators through a low-pass filter), not a bundled audio file.
// This is deliberately minimal: it exists so the Settings "Background music" toggle is a
// genuinely functional control rather than a dead switch, not a full soundtrack. It only
// ever plays while browsing the app (see ArenaApp.tsx), never during live gameplay where
// it could mask the UI's own correct/wrong/countdown cues.
// ---------------------------------------------------------------------------
let musicNodes: { oscillators: OscillatorNode[]; masterGain: GainNode } | null = null;

const MUSIC_NOTE_FREQS = [196, 246.94, 293.66, 392]; // G3, B3, D4, G4 — a calm, consonant pad

export function startMusic(): void {
  if (musicNodes) return; // already playing
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.045, audioCtx.currentTime + 2);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    masterGain.connect(filter);
    filter.connect(audioCtx.destination);

    const oscillators = MUSIC_NOTE_FREQS.map((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i % 2 === 0 ? 1 : -1) * 4; // gentle chorus-like detune
      const voiceGain = audioCtx.createGain();
      voiceGain.gain.value = 1 / MUSIC_NOTE_FREQS.length;
      // Slow independent tremolo per voice so the pad breathes instead of droning flatly.
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.07 + i * 0.015;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 0.35 / MUSIC_NOTE_FREQS.length;
      lfo.connect(lfoGain);
      lfoGain.connect(voiceGain.gain);
      lfo.start();
      osc.connect(voiceGain);
      voiceGain.connect(masterGain);
      osc.start();
      return osc;
    });

    musicNodes = { oscillators, masterGain };
  } catch {
    musicNodes = null;
  }
}

export function stopMusic(): void {
  if (!musicNodes || !ctx) return;
  try {
    const { oscillators, masterGain } = musicNodes;
    const now = ctx.currentTime;
    masterGain.gain.linearRampToValueAtTime(0, now + 0.6);
    oscillators.forEach((osc) => osc.stop(now + 0.7));
  } catch {
    // Already stopped/torn down — nothing to clean up.
  }
  musicNodes = null;
}

export const sounds = {
  /** Soft tap — nav clicks, option taps, generic UI button presses. */
  click: () => playTones([{ freq: 520, startOffset: 0, duration: 0.05, gain: 0.07 }]),
  /** A genuinely correct answer — ascending two-note chime. */
  correct: () => playTones([
    { freq: 660, startOffset: 0, duration: 0.09, gain: 0.14 },
    { freq: 880, startOffset: 0.08, duration: 0.12, gain: 0.14 },
  ]),
  /** A genuinely wrong answer or timeout — short descending buzz. */
  wrong: () => playTones([
    { freq: 220, startOffset: 0, duration: 0.14, type: 'sawtooth', gain: 0.09 },
    { freq: 160, startOffset: 0.1, duration: 0.14, type: 'sawtooth', gain: 0.09 },
  ]),
  /** A real opponent has filled the room — bright chime. */
  matchFound: () => playTones([
    { freq: 523, startOffset: 0, duration: 0.1, gain: 0.12 },
    { freq: 659, startOffset: 0.09, duration: 0.1, gain: 0.12 },
    { freq: 784, startOffset: 0.18, duration: 0.16, gain: 0.14 },
  ]),
  /** One 3-2-1 countdown tick. */
  countdownTick: () => playTones([{ freq: 440, startOffset: 0, duration: 0.08, gain: 0.1 }]),
  /** The GO! moment. */
  countdownGo: () => playTones([
    { freq: 523, startOffset: 0, duration: 0.07, gain: 0.14 },
    { freq: 784, startOffset: 0.06, duration: 0.18, gain: 0.16 },
  ]),
  /** The real server-reported match result: win. */
  win: () => playTones([
    { freq: 523, startOffset: 0, duration: 0.12, gain: 0.14 },
    { freq: 659, startOffset: 0.1, duration: 0.12, gain: 0.14 },
    { freq: 784, startOffset: 0.2, duration: 0.12, gain: 0.14 },
    { freq: 1047, startOffset: 0.3, duration: 0.22, gain: 0.16 },
  ]),
  /** The real server-reported match result: loss. */
  lose: () => playTones([
    { freq: 392, startOffset: 0, duration: 0.16, type: 'triangle', gain: 0.1 },
    { freq: 294, startOffset: 0.14, duration: 0.22, type: 'triangle', gain: 0.1 },
  ]),
  /** A draw/void match result. */
  neutral: () => playTones([{ freq: 440, startOffset: 0, duration: 0.18, type: 'triangle', gain: 0.1 }]),
  /** A real new notification arriving live over the socket. */
  notification: () => playTones([
    { freq: 784, startOffset: 0, duration: 0.07, gain: 0.1 },
    { freq: 988, startOffset: 0.07, duration: 0.09, gain: 0.1 },
  ]),
  /** A real wallet credit/debit completing (deposit/withdrawal/payout confirmed by the server). */
  walletSuccess: () => playTones([
    { freq: 587, startOffset: 0, duration: 0.08, gain: 0.12 },
    { freq: 880, startOffset: 0.07, duration: 0.14, gain: 0.14 },
  ]),
  /** A request the server rejected (validation error, insufficient funds, etc). */
  error: () => playTones([{ freq: 180, startOffset: 0, duration: 0.18, type: 'square', gain: 0.07 }]),
};
