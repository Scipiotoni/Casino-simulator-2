import { mulberry32 } from '../../core/noise';

/**
 * The radio's music as plain data: chords, scales, drum patterns and a small composer that
 * turns a station's style into the notes of any bar of its endless playlist. Everything is
 * seeded, so bar 1234 of a station is always the same bar; synth.ts plays the notes.
 *
 * A station plays songs of FORM (eight sections of eight bars: intro, verse, chorus, break,
 * outro). Each song picks its key, its two progressions, its grooves and its tunes from the
 * station's seed, and the verse and chorus tunes come back every time their section does.
 */

/** Sixteenth notes in a bar of 4/4. */
export const STEPS = 16;
/** Bars in a section. */
export const SECTION_BARS = 8;

export type SectionKind = 'intro' | 'A' | 'B' | 'break' | 'outro';

/** The shape of every song. */
export const FORM: readonly SectionKind[] = ['intro', 'A', 'B', 'A', 'break', 'B', 'A', 'outro'];
export const SONG_BARS = FORM.length * SECTION_BARS;

/** One note or drum hit. `at` and `len` are in sixteenth-note steps from the start of its bar. */
export interface Note {
  inst: string;
  at: number;
  midi: number;
  len: number;
  vel: number;
  /** Gated pads: which sixteenths of the note sound ('x' on, anything else off). */
  gate?: string;
}

export interface Chord {
  name: string;
  /** Pitch class of the root (0 = C). */
  root: number;
  /** Intervals above the root (past the octave for extensions: 14 is the ninth). */
  tones: number[];
}

// ---------------------------------------------------------------- instruments

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/**
 * How an instrument is synthesized (see synth.ts). Times are in seconds; `gain` is the
 * channel's level, `verb` and `echo` its sends to the room and the tempo delay.
 */
export interface Inst {
  kind: 'kick' | 'snare' | 'noise' | 'tom' | 'wood' | 'tone' | 'fm' | 'mallet' | 'pluck' | 'hiss';
  gain: number;
  pan?: number;
  verb?: number;
  echo?: number;
  /** Drums: shapes the noise of the hit. Everything else: a filter on the channel. */
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; q?: number };
  /** Envelope: attack, decay, sustain level (0 = percussive), release. */
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  wave?: Wave;
  /** A second oscillator this many cents sharp (and the first as many flat). */
  unison?: number;
  /** Kick: start and end pitch (Hz). Snare: body pitch (Hz) in `f0`. */
  f0?: number;
  f1?: number;
  /** FM: modulator ratio and brightness of the attack. */
  ratio?: number;
  index?: number;
  /** Mallets: extra partials as [ratio, level, decay multiplier]. */
  partials?: [number, number, number][];
  /** Slow pitch drift or vibrato: [rate Hz, depth cents]. */
  wobble?: [number, number];
  /** Tremolo (a vibraphone's motor, a tremolo amp): [rate Hz, depth 0..1]. */
  trem?: [number, number];
  /** Plucked strings: brightness 0..1, and how far long notes slide up into pitch (semitones). */
  bright?: number;
  bend?: number;
}

// ---------------------------------------------------------------- stations

export interface MelodyStyle {
  /** Range (MIDI notes). */
  lo: number;
  hi: number;
  /** One-beat rhythm cells as [offset, length] in steps, and how often each is picked. */
  cells: [number, number][][];
  weights: number[];
  /** Chance a beat rests. */
  rest: number;
  /** Chance of a leap instead of a step. */
  leap: number;
  /** Longest a note may ring on into the rest after it (steps). */
  hold: number;
}

/** Everything about a bar a station needs to play it. */
export interface BarInfo {
  /** Bar number in the station's endless playlist. */
  index: number;
  song: Song;
  kind: SectionKind;
  /** Section number in the song (0..7) and bar in the section (0..7). */
  section: number;
  n: number;
  chord: Chord;
  /** The chord of the next bar (for anticipations and walking bass). */
  next: Chord;
  /** This bar's share of the section's tune (inst is left blank for the station to fill in). */
  melody: Note[];
  /** Seeded for this bar. */
  rng: () => number;
  /** The first bar of a song, and the last (the song's final chord). */
  first: boolean;
  last: boolean;
}

export interface Song {
  index: number;
  /** Transposition from the written key (semitones). */
  tr: number;
  progA: Chord[];
  progB: Chord[];
  /** Pitch classes of the tune's scale (transposed). */
  scale: number[];
  /** Per-song dice (0..1) for the station's own choices: grooves, patterns, voicings. */
  v: number[];
}

export interface StationDef {
  id: string;
  name: string;
  /** Dial position, e.g. "FM 101.7". */
  freq: string;
  genre: string;
  /** Accent colour of the station card. */
  color: string;
  bpm: number;
  /** Where the off-beat eighth falls in the beat (0.5 straight, 0.67 triplet swing), and the same for sixteenths. */
  swing: number;
  swing16: number;
  seed: number;
  /** Tonic of the progressions as written (pitch class), the tune's scale above it, and the keys songs may move to. */
  key: number;
  scale: number[];
  keys: number[];
  /** Eight-bar progressions (chord symbols, one per bar) for verses and choruses. */
  progA: string[];
  progB: string[];
  melody: MelodyStyle;
  /** Echo time in steps and its feedback. */
  echo: [number, number];
  /** Output lowpass (Hz), for dusty stations. */
  tone?: number;
  /** Output trim, so every station is about as loud as the others. */
  level?: number;
  kit: Record<string, Inst>;
  bar(b: BarInfo): Note[];
}

// ---------------------------------------------------------------- theory

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
};
const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const MAJOR_PENT = [0, 2, 4, 7, 9];
export const MINOR_PENT = [0, 3, 5, 7, 10];

/** "Bbmaj7" → root 10, tones [0, 4, 7, 11]. Throws on a symbol it doesn't know. */
export function parseChord(name: string): Chord {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  const tones = m ? QUALITY[m[3]] : undefined;
  if (!m || !tones) throw new Error(`Unknown chord ${name}`);
  const root = (LETTERS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { name, root, tones };
}

export function parseProgression(s: string): Chord[] {
  return s.trim().split(/\s+/).map(parseChord);
}

export function transpose(c: Chord, tr: number): Chord {
  return { name: c.name, root: (((c.root + tr) % 12) + 12) % 12, tones: c.tones };
}

/** The MIDI note of pitch class `pc` in the octave starting at `lo`. */
export function place(pc: number, lo: number): number {
  return lo + ((((pc - lo) % 12) + 12) % 12);
}

/** Pitch classes of the chord. `core` keeps only the triad and seventh. */
export function chordPcs(c: Chord, core = false): number[] {
  const t = core ? c.tones.filter((x) => x < 12) : c.tones;
  return t.map((x) => (c.root + x) % 12);
}

/** A close voicing in the octave from `lo`; `rootless` leaves the root to the bass on rich chords. */
export function voicing(c: Chord, lo: number, rootless = false): number[] {
  const tones = rootless && c.tones.length >= 4 ? c.tones.slice(1) : c.tones;
  return [...new Set(tones.map((t) => place(c.root + t, lo)))].sort((a, b) => a - b);
}

/** A seeded generator from a few integers. */
export function seeded(...parts: number[]): () => number {
  let h = 0x2545f491;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return mulberry32(h >>> 0);
}

export function pickR<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function weighted<T>(rng: () => number, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (let i = 0; i < items.length; i++) total += weights[i] ?? 1;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 1;
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

const VEL: Record<string, number> = { X: 1, x: 0.72, o: 0.48, g: 0.26 };

/** Hits from a drum pattern: X accent, x normal, o soft, g ghost, anything else a rest. */
export function beat(pattern: string, inst: string, vel = 1, midi = 0, len = 1): Note[] {
  const out: Note[] = [];
  for (let i = 0; i < pattern.length && i < STEPS; i++) {
    const v = VEL[pattern[i]];
    if (v) out.push({ inst, at: i, midi, len, vel: v * vel });
  }
  return out;
}

export function note(inst: string, at: number, midi: number, len: number, vel: number): Note {
  return { inst, at, midi, len, vel };
}

/**
 * Swing: moves the off-beat eighth to `s8` of the beat and each off-beat sixteenth to `s16`
 * of its eighth (0.5 = straight). Works on fractional steps too.
 */
export function swingTime(at: number, s8: number, s16: number): number {
  const b = Math.floor(at / 4);
  const x = at - b * 4;
  const mid = 4 * s8;
  const half = (u: number) => (u < 0.5 ? (u / 0.5) * s16 : s16 + ((u - 0.5) / 0.5) * (1 - s16));
  const y = x < 2 ? half(x / 2) * mid : mid + half((x - 2) / 2) * (4 - mid);
  return b * 4 + y;
}

// ---------------------------------------------------------------- tunes

interface Hit {
  at: number;
  len: number;
}

/** The rhythm of a two-bar phrase (32 steps). An ending phrase lands on a long note at the top of its second bar. */
function phraseRhythm(rng: () => number, st: MelodyStyle, ending: boolean): Hit[] {
  const out: Hit[] = [];
  const beats = ending ? 4 : 7;
  for (let b = 0; b < beats; b++) {
    if (b > 0 && rng() < st.rest) continue;
    for (const [o, l] of weighted(rng, st.cells, st.weights)) out.push({ at: b * 4 + o, len: l });
  }
  if (ending) out.push({ at: 16, len: 12 });
  if (!out.length) out.push({ at: 0, len: 4 });
  // Legato: let notes ring on into short rests.
  for (let i = 0; i < out.length; i++) {
    const gap = (i + 1 < out.length ? out[i + 1].at : ending ? 32 : 30) - out[i].at;
    out[i].len = Math.max(out[i].len, Math.min(gap, st.hold));
  }
  return out;
}

function nearestIndex(pool: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - target) < Math.abs(pool[best] - target)) best = i;
  return best;
}

/** Move to the nearest note of the pool whose pitch class is in `pcs`. */
function snap(pool: number[], i: number, pcs: number[]): number {
  for (let d = 0; d < pool.length; d++) {
    for (const j of [i - d, i + d]) if (j >= 0 && j < pool.length && pcs.includes(pool[j] % 12)) return j;
  }
  return i;
}

/** Pitches for a phrase: mostly steps, the odd leap, chord tones on the strong beats. */
function walk(rng: () => number, rh: Hit[], pool: number[], chordAt: (at: number) => Chord, start: number, st: MelodyStyle, cadence: boolean): number[] {
  let i = start;
  let dir = rng() < 0.5 ? -1 : 1;
  const out: number[] = [];
  rh.forEach((h, k) => {
    if (k > 0) {
      i += dir * (rng() < st.leap ? 2 + Math.floor(rng() * 2) : rng() < 0.85 ? 1 : 0);
      if (rng() < 0.3) dir = -dir;
    }
    if (i < 1) {
      i = 1;
      dir = 1;
    } else if (i > pool.length - 2) {
      i = pool.length - 2;
      dir = -1;
    }
    const strong = k === 0 || h.at % 8 === 0 || h.len >= 6;
    if (strong) i = snap(pool, i, chordPcs(chordAt(h.at), true));
    if (cadence && k === rh.length - 1) {
      const c = chordAt(h.at);
      i = snap(pool, i, [c.root, (c.root + c.tones[1]) % 12]);
    }
    out.push(pool[i]);
  });
  return out;
}

/** Re-fit a phrase's pitches to new chords: strong-beat notes move to the nearest chord tone. */
function refit(pitches: number[], rh: Hit[], pool: number[], chordAt: (at: number) => Chord, shift: number): number[] {
  return pitches.map((p, k) => {
    let i = Math.min(pool.length - 1, Math.max(0, nearestIndex(pool, p) + shift));
    const h = rh[k];
    if (k === 0 || h.at % 8 === 0 || h.len >= 6) i = snap(pool, i, chordPcs(chordAt(h.at), true));
    return pool[i];
  });
}

/**
 * Over a chord from outside the key, a scale note a semitone from one of the chord's own notes
 * takes that note instead (C over A7 becomes C#, A over Fm6 becomes Ab).
 */
export function fitToChord(midi: number, c: Chord, scale: number[]): number {
  const pcs = chordPcs(c);
  const pc = ((midi % 12) + 12) % 12;
  if (pcs.includes(pc)) return midi;
  for (const d of [1, -1]) {
    const q = (pc + d + 12) % 12;
    if (pcs.includes(q) && !scale.includes(q)) return midi + d;
  }
  return midi;
}

/**
 * Eight bars of tune over `chords`: a two-bar idea, the idea again a step away, the idea once
 * more, and an answer that comes to rest. Returns the notes of each bar.
 */
export function melodySection(rng: () => number, chords: Chord[], scale: number[], st: MelodyStyle, sparse = 0): Note[][] {
  const style = sparse ? { ...st, rest: Math.min(0.85, st.rest + sparse) } : st;
  const pool: number[] = [];
  for (let m = st.lo; m <= st.hi; m++) if (scale.includes(m % 12)) pool.push(m);
  const bars: Note[][] = chords.map(() => []);
  if (pool.length < 4) return bars;
  const a = phraseRhythm(rng, style, false);
  const b = phraseRhythm(rng, style, true);
  const at = (bar: number) => (step: number) => chords[Math.min(chords.length - 1, bar + (step >= 16 ? 1 : 0))];
  const start = nearestIndex(pool, (st.lo + st.hi) / 2 + (rng() - 0.5) * 6);
  const p0 = walk(rng, a, pool, at(0), start, style, false);
  const p1 = rng() < 0.5 ? refit(p0, a, pool, at(2), rng() < 0.5 ? 1 : -1) : walk(rng, a, pool, at(2), nearestIndex(pool, p0[p0.length - 1]), style, false);
  const p2 = refit(p0, a, pool, at(4), 0);
  const p3 = walk(rng, b, pool, at(6), nearestIndex(pool, p2[p2.length - 1]), style, true);
  const lay = (rh: Hit[], pitches: number[], bar: number) => {
    rh.forEach((h, k) => {
      const into = h.at >= 16 ? 1 : 0;
      const strong = h.at % 8 === 0;
      const vel = (strong ? 0.86 : 0.7) + rng() * 0.12;
      const midi = fitToChord(pitches[k], at(bar)(h.at), scale);
      bars[bar + into]?.push({ inst: '', at: h.at - into * 16, midi, len: h.len, vel });
    });
  };
  lay(a, p0, 0);
  lay(a, p1, 2);
  lay(a, p2, 4);
  lay(b, p3, 6);
  return bars;
}

// ---------------------------------------------------------------- composing

const songCache = new Map<string, Song>();
const tuneCache = new Map<string, Note[][]>();

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) {
    if (cache.size > 48) cache.clear();
    v = make();
    cache.set(key, v);
  }
  return v;
}

/** A station's song number `index`: its key, progressions and dice. */
export function songPlan(st: StationDef, index: number): Song {
  return remember(songCache, `${st.id}:${index}`, () => {
    const r = seeded(st.seed, index, 1);
    const tr = pickR(r, st.keys);
    const progA = parseProgression(pickR(r, st.progA)).map((c) => transpose(c, tr));
    const progB = parseProgression(pickR(r, st.progB)).map((c) => transpose(c, tr));
    const scale = st.scale.map((s) => (s + st.key + tr) % 12);
    const v = Array.from({ length: 8 }, () => r());
    return { index, tr, progA, progB, scale, v };
  });
}

function progFor(song: Song, kind: SectionKind): Chord[] {
  return kind === 'B' ? song.progB : song.progA;
}

/** The tune of a kind of section (each verse of a song sings the same one). */
function tune(st: StationDef, song: Song, kind: SectionKind): Note[][] {
  if (kind === 'intro') return [];
  return remember(tuneCache, `${st.id}:${song.index}:${kind}`, () => {
    if (kind === 'outro') return tune(st, song, 'A').map((bar, i) => (i < 6 ? bar : []));
    const r = seeded(st.seed, song.index, kind === 'A' ? 11 : kind === 'B' ? 12 : 13);
    return melodySection(r, progFor(song, kind), song.scale, st.melody, kind === 'break' ? 0.35 : 0);
  });
}

/** Everything about bar `index` of a station. */
export function barInfo(st: StationDef, index: number): BarInfo {
  const songIndex = Math.floor(index / SONG_BARS);
  const inSong = index - songIndex * SONG_BARS;
  const section = Math.floor(inSong / SECTION_BARS);
  const n = inSong % SECTION_BARS;
  const kind = FORM[section];
  const song = songPlan(st, songIndex);
  const last = inSong === SONG_BARS - 1;
  const prog = progFor(song, kind);
  // A song ends at home, on the chord it started with.
  const chord = last ? song.progA[0] : prog[n];
  const next =
    inSong === SONG_BARS - 2 ? song.progA[0]
    : n < SECTION_BARS - 1 ? prog[n + 1]
    : section < FORM.length - 1 ? progFor(song, FORM[section + 1])[0]
    : songPlan(st, songIndex + 1).progA[0];
  const melody = last ? [] : (tune(st, song, kind)[n] ?? []);
  return { index, song, kind, section, n, chord, next, melody, rng: seeded(st.seed, index, 7), first: inSong === 0, last };
}

/** The notes of bar `index` of a station, swung and sorted by time. */
export function composeBar(st: StationDef, index: number): Note[] {
  const notes = st.bar(barInfo(st, index));
  if (st.swing !== 0.5 || st.swing16 !== 0.5) for (const nt of notes) nt.at = swingTime(nt.at, st.swing, st.swing16);
  return notes.sort((a, b) => a.at - b.at);
}

/** Seconds per sixteenth note. */
export function stepTime(st: StationDef): number {
  return 60 / st.bpm / 4;
}

// ---------------------------------------------------------------- the dial

/** The next position of the dial: each station in turn, then off (-1), then round again. */
export function nextStation(i: number, count: number): number {
  if (count <= 0) return -1;
  if (i < 0 || i >= count) return i < 0 ? 0 : -1;
  return i + 1 < count ? i + 1 : -1;
}

/** The station a save remembers (an index, or -1 for off), or null if the save has nothing usable. */
export function stationFromSave(data: unknown, ids: readonly string[]): number | null {
  if (!data || typeof data !== 'object') return null;
  const s = (data as { station?: unknown }).station;
  if (typeof s !== 'string') return null;
  if (s === 'off') return -1;
  const i = ids.indexOf(s);
  return i >= 0 ? i : null;
}
