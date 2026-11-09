// Sound effects synthesised with WebAudio: no audio files to license, download or cache,
// and every effect starts in under a frame. The context unlocks on the first tap or key
// (browser autoplay rule). Mute is a per-browser convenience in localStorage.
import { JUICE } from "./render/juice";

export type Sfx = "boost" | "repay" | "pop" | "spike" | "coin" | "tick" | "go" | "beat" | "denied" | "press" | "release" | "clink" | "clunk" | "blip";

const KEY = "margin.muted";
let ctx: AudioContext | null = null;
let muted = read();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Create the context on the first user gesture; call once at startup. */
export function unlockAudioOnGesture(): void {
  const go = (): void => {
    ctx ??= new AudioContext();
    void ctx.resume();
    removeEventListener("pointerdown", go);
    removeEventListener("keydown", go);
  };
  addEventListener("pointerdown", go);
  addEventListener("keydown", go);
}

export const isMuted = (): boolean => muted;

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    /* private mode: mute just won't persist */
  }
}

/** Play one effect now. Silent until unlocked or while muted. */
export function play(s: Sfx, pitch = 1): void {
  if (muted || !ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  switch (s) {
    case "boost":
      noise(t, 0.28, 900, 3200, 0.35); // whoosh: filtered noise sweeping up
      tone(t, 220, 440, 0.18, "sawtooth", 0.08);
      break;
    case "repay":
      tone(t, 660, 330, 0.12, "square", 0.08);
      break;
    case "pop":
      noise(t, 0.25, 2000, 300, 0.5);
      tone(t, 140, 40, 0.3, "sine", 0.5);
      break;
    case "spike":
      noise(t, 0.12, 4000, 1500, 0.35);
      break;
    case "clink": // REPAY coin, pitch rises over a run of taps
      tone(t, 1320 * pitch, 1320 * pitch, 0.07, "triangle", 0.12);
      tone(t + 0.04, 1980 * pitch, 1980 * pitch, 0.09, "sine", 0.06);
      break;
    case "coin":
      tone(t, 988, 988, 0.08, "square", 0.07);
      tone(t + 0.08, 1319, 1319, 0.16, "square", 0.07);
      break;
    case "tick":
      tone(t, 880, 880, 0.08, "sine", 0.15);
      break;
    case "go":
      for (const f of [523, 659, 784]) tone(t, f, f, 0.35, "triangle", 0.12);
      break;
    case "press": // whoosh up plus a low thump: the loan kicks in
      noise(t, 0.22, 700, 3000, 0.3);
      tone(t, 90, 45, 0.14, "sine", 0.4);
      break;
    case "release": // falling whoosh
      noise(t, 0.25, 2600, 500, 0.22);
      break;
    case "blip": // a pellet eaten: soft and short
      tone(t, 520 * pitch, 780 * pitch, 0.06, "sine", 0.07);
      break;
    case "clunk": // the tank runs dry: a hollow knock
      tone(t, 180, 70, 0.18, "triangle", 0.25);
      tone(t + 0.05, 95, 60, 0.12, "square", 0.06);
      break;
    case "denied":
      tone(t, 140, 110, 0.12, "square", 0.08);
      break;
    case "beat":
      tone(t, 70, 45, 0.12, "sine", 0.5);
      tone(t + 0.16, 70, 45, 0.1, "sine", 0.35);
      break;
  }
}

let engineNodes: { o: OscillatorNode; g: GainNode } | null = null;

/** The nitro turbine: starts on press, fades on release. Pitch follows the tank via engineFuel. */
export function engine(on: boolean): void {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  if (on && !muted && !engineNodes) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(JUICE.ENGINE_HZ, t);
    f.type = "lowpass";
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(JUICE.ENGINE_GAIN, t + 0.08);
    o.connect(f).connect(g).connect(ctx.destination);
    o.start(t);
    engineNodes = { o, g };
  } else if (!on && engineNodes) {
    const { o, g } = engineNodes;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.stop(t + 0.2);
    engineNodes = null;
  }
}

/** Turbine pitch from the tank: 1.0 when full, ENGINE_PITCH_EMPTY when dry (Mario Kart rev). */
export function engineFuel(fuel: number): void {
  if (!ctx || !engineNodes) return;
  const k = 1 + (JUICE.ENGINE_PITCH_EMPTY - 1) * (1 - Math.max(0, Math.min(1, fuel)));
  engineNodes.o.frequency.setTargetAtTime(JUICE.ENGINE_HZ * k, ctx.currentTime, 0.05);
}

function env(t: number, dur: number, peak: number): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(ctx!.destination);
  return g;
}

function tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.connect(env(t, dur, vol));
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, f0: number, f1: number, vol: number): void {
  const len = Math.ceil(ctx!.sampleRate * dur);
  const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx!.createBufferSource();
  src.buffer = buf;
  const bp = ctx!.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  src.connect(bp).connect(env(t, dur, vol));
  src.start(t);
}
