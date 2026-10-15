import {
  MAJOR, MAJOR_PENT, MINOR, MINOR_PENT, SECTION_BARS, beat, note, place, voicing,
  type BarInfo, type Chord, type Note, type StationDef,
} from './music';

/**
 * The stations on the dial. Each is a style (tempo, swing, keys, progressions, a kit of
 * instruments) and an arranger, `bar()`, that turns any bar of a song (its section, chord and
 * share of the tune) into notes. Songs are intro, verse, chorus, verse, break, chorus, verse,
 * outro; the arrangers thin out the intro and the break and build up the chorus.
 */

// ---------------------------------------------------------------- helpers

/** The bar's share of the tune, on `inst`, `shift` semitones up and `vel` times as loud. */
function tuneOn(b: BarInfo, inst: string, shift = 0, vel = 1): Note[] {
  return b.melody.map((n) => ({ ...n, inst, midi: n.midi + shift, vel: n.vel * vel }));
}

/** A chord: every note at once, or strummed (`spread` steps between strings, upwards or down). */
function hit(inst: string, at: number, len: number, midis: number[], vel: number, spread = 0, up = false): Note[] {
  const order = up ? [...midis].reverse() : midis;
  return order.map((m, i) => note(inst, at + i * spread, m, Math.max(0.5, len - i * spread), vel * (1 - i * 0.05)));
}

/** Pitch classes of the chord's third and fifth. */
const third = (c: Chord) => c.root + c.tones[1];
const fifth = (c: Chord) => c.root + c.tones[2];

/** The pitch of pitch class `pc` nearest `to`. */
const near = (pc: number, to: number) => place(pc, to - 6);

/** A note a semitone above or below `target`, from the side `from` is on. */
const approach = (target: number, from: number) => (from > target ? target + 1 : target - 1);

/** Steps 0..15 of a pattern string that are hits (`x`), for pitched parts. */
function steps(pattern: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < pattern.length && i < 16; i++) if (pattern[i] !== '.') out.push(i);
  return out;
}

/** A guitar voicing: root low, fifth, octave, then the third and fifth on top (and the seventh). */
function guitar(c: Chord, lo: number): number[] {
  const r = place(c.root, lo);
  const set = new Set([r, r + c.tones[2], r + 12, r + 12 + c.tones[1], r + 12 + c.tones[2]]);
  if (c.tones.length > 3 && c.tones[3] < 12) set.add(r + c.tones[3] + (r + c.tones[3] < r + 12 ? 12 : 0));
  return [...set].sort((a, b) => a - b);
}

/** Up, up and down, or leaping through `tones`: which one plays on step `i`. */
function arpIndex(shape: number, i: number, n: number): number {
  if (shape < 0.34) return i % n;
  if (shape < 0.67) {
    const cyc = Math.max(1, 2 * n - 2);
    const k = i % cyc;
    return k < n ? k : cyc - k;
  }
  return [0, 2, 1, 3, 2, 4, 3, 1][i % 8] % n;
}

const isSong = (b: BarInfo) => b.kind === 'A' || b.kind === 'B';
const fillBar = (b: BarInfo) => b.n === SECTION_BARS - 1;

// ---------------------------------------------------------------- Jackpot FM

/** Walking bass: four to the bar through the chord, stepping into the next one (or two to the bar). */
function walkingBass(b: BarInfo, inst: string, twoFeel: boolean, lo = 31): Note[] {
  const r = b.rng;
  const c = b.chord;
  const R = place(c.root, lo);
  const nextR = place(b.next.root, lo);
  if (twoFeel) return [note(inst, 0, R, 7, 0.92), note(inst, 8, r() < 0.6 ? R + c.tones[2] : R + c.tones[1], 7, 0.8)];
  const shapes = [
    [0, c.tones[1], c.tones[2]],
    [0, 2, c.tones[1]],
    [0, c.tones[2], 12],
    [0, 12, c.tones[2]],
  ];
  const sh = shapes[Math.floor(r() * shapes.length)];
  const line = sh.map((x) => R + x);
  const last = r() < 0.25 ? nextR + 7 : approach(nextR, line[2]);
  return [...line, last].map((m, i) => note(inst, i * 4, m, 3.4, i === 0 ? 0.95 : 0.78 + r() * 0.08));
}

/** Piano comping: short chords in the gaps, the odd one pushed ahead into the next bar's chord. */
function comp(b: BarInfo, inst: string, lo: number): Note[] {
  const r = b.rng;
  const v = voicing(b.chord, lo, true);
  const vn = voicing(b.next, lo, true);
  if (b.kind === 'intro' || b.kind === 'break') return hit(inst, 0, 10, v, 0.62, 0.1);
  const pats: [number, number, boolean][][] = [
    [[0, 3, false], [6, 2, false]],
    [[0, 2, false], [6, 2, false], [12, 2, false]],
    [[2, 2, false], [8, 3, false], [14, 2, true]],
    [[0, 6, false], [10, 2, false]],
    [[6, 2, false], [14, 2, true]],
  ];
  const out: Note[] = [];
  for (const [at, len, push] of pats[Math.floor(r() * pats.length)]) out.push(...hit(inst, at, len, push ? vn : v, 0.52 + r() * 0.16, 0.06));
  return out;
}

const jackpot: StationDef = {
  id: 'jackpot',
  name: 'Jackpot FM',
  freq: 'FM 101.7',
  genre: 'Casino lounge · swing',
  color: '#ffd23d',
  bpm: 112,
  swing: 0.64,
  swing16: 0.5,
  seed: 1017,
  key: 0,
  scale: MAJOR,
  keys: [0, 5, 10, 3, 7],
  progA: [
    'Cmaj7 Am7 Dm7 G7 Cmaj7 Am7 Dm7 G7',
    'Cmaj9 A7 Dm9 G9 Em7 A7 Dm9 G9',
    'Cmaj7 Ebdim7 Dm7 G7 Em7 A7 Dm7 G7',
  ],
  progB: [
    'Fmaj7 Fm6 Em7 A7 Dm9 G9 C6 G7',
    'Am7 D7 Dm7 G7 Em7 A7 Dm7 G7',
    'Fmaj7 Bb7 Cmaj7 Am7 Dm7 G7 Cmaj7 G7',
  ],
  melody: {
    lo: 67, hi: 86,
    cells: [[[0, 2], [2, 2]], [[0, 4]], [[2, 2]], [[0, 3], [3, 1]], [[0, 2], [2, 1], [3, 1]]],
    weights: [4, 2, 1.5, 1, 0.6],
    rest: 0.22, leap: 0.22, hold: 6,
  },
  echo: [8, 0.18],
  level: 1,
  kit: {
    kick: { kind: 'kick', gain: 0.34, f0: 105, f1: 46, d: 0.15 },
    ride: { kind: 'noise', gain: 0.17, pan: 0.3, filter: { type: 'highpass', freq: 6200 }, a: 0.001, d: 0.28, verb: 0.15 },
    pedal: { kind: 'noise', gain: 0.2, pan: -0.25, filter: { type: 'highpass', freq: 8000 }, d: 0.03 },
    brush: { kind: 'noise', gain: 0.3, pan: -0.1, filter: { type: 'bandpass', freq: 2400, q: 0.6 }, a: 0.012, d: 0.12, verb: 0.2 },
    crash: { kind: 'noise', gain: 0.08, pan: 0.35, filter: { type: 'highpass', freq: 4500 }, d: 1.1, verb: 0.3 },
    bass: { kind: 'tone', wave: 'triangle', gain: 0.24, filter: { type: 'lowpass', freq: 800 }, a: 0.004, d: 0.25, s: 0.4, r: 0.07 },
    ep: { kind: 'fm', gain: 0.24, pan: -0.15, ratio: 1, index: 1.4, a: 0.003, d: 1.1, s: 0.35, r: 0.25, verb: 0.25, trem: [4.5, 0.16] },
    vibes: { kind: 'mallet', gain: 0.28, pan: 0.2, partials: [[4, 0.22, 0.28], [10, 0.04, 0.12]], d: 1.2, r: 0.35, verb: 0.35, echo: 0.08, trem: [5.5, 0.35] },
    horn: { kind: 'tone', wave: 'sawtooth', gain: 0.2, pan: 0.15, filter: { type: 'lowpass', freq: 1600, q: 0.7 }, a: 0.04, d: 0.3, s: 0.75, r: 0.12, wobble: [5.2, 14], verb: 0.3 },
  },
  bar(b) {
    const out: Note[] = [];
    const { chord: c, kind, n, rng } = b;
    if (b.last) {
      out.push(...hit('ep', 0, 16, voicing(c, 52, true), 0.7, 0.12));
      out.push(note('bass', 0, place(c.root, 31), 14, 0.9));
      out.push(...hit('vibes', 0.5, 16, voicing(c, 67), 0.5, 0.25));
      out.push(note('crash', 0, 0, 1, 0.6), note('kick', 0, 0, 1, 0.6));
      return out;
    }
    const full = isSong(b) || kind === 'outro';
    out.push(...beat(kind === 'intro' && n < 4 ? 'o...o...o...o...' : 'x...x.o.x...x.o.', 'ride'));
    if (full || (kind === 'intro' && n >= 4)) {
      out.push(...beat('....x.......x...', 'pedal'));
      out.push(...beat('....o.......o...', 'brush'));
      for (const s of [2, 6, 10, 14]) if (rng() < 0.25) out.push(note('brush', s, 0, 1, 0.22));
      out.push(...beat(full ? 'o.......o.......' : 'o...............', 'kick'));
    }
    if (full && fillBar(b) && rng() < 0.7) out.push(...beat('........g.g.o.ox', 'brush'));
    if (n === 0 && isSong(b)) out.push(note('crash', 0, 0, 1, 0.5));
    out.push(...walkingBass(b, 'bass', kind === 'intro' || kind === 'break'));
    out.push(...comp(b, 'ep', 52));
    if (kind === 'B') out.push(...tuneOn(b, 'horn', -12));
    else out.push(...tuneOn(b, 'vibes'));
    return out;
  },
};

// ---------------------------------------------------------------- Neon 88

const neon: StationDef = {
  id: 'neon',
  name: 'Neon 88',
  freq: 'FM 88.8',
  genre: 'Synthwave · night drive',
  color: '#ff4fd8',
  bpm: 98,
  swing: 0.5,
  swing16: 0.5,
  seed: 888,
  key: 9,
  scale: MINOR,
  keys: [0, 2, 3, 5, 7, 10],
  progA: ['Am Am F F C C G G', 'Am F C G Am F C G', 'Am Am Fmaj7 Fmaj7 Dm Dm Em Em'],
  progB: ['F G Am Am F G C C', 'F G Em Am F G Am Am', 'C G Am F C G F G'],
  melody: {
    lo: 64, hi: 81,
    cells: [[[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]], [[2, 2]]],
    weights: [3, 3, 1.5, 1],
    rest: 0.2, leap: 0.25, hold: 8,
  },
  echo: [3, 0.36],
  level: 1,
  kit: {
    kick: { kind: 'kick', gain: 0.28, f0: 150, f1: 44, d: 0.2 },
    snare: { kind: 'snare', gain: 0.55, f0: 185, d: 0.2, filter: { type: 'highpass', freq: 900 }, verb: 0.65 },
    hat: { kind: 'noise', gain: 0.2, pan: -0.2, filter: { type: 'highpass', freq: 8000 }, d: 0.04 },
    open: { kind: 'noise', gain: 0.09, pan: 0.2, filter: { type: 'highpass', freq: 7000 }, d: 0.2 },
    tom: { kind: 'tom', gain: 0.35, d: 0.22, verb: 0.4 },
    crash: { kind: 'noise', gain: 0.09, filter: { type: 'highpass', freq: 4000 }, d: 1.3, verb: 0.3 },
    bass: { kind: 'tone', wave: 'sawtooth', gain: 0.25, filter: { type: 'lowpass', freq: 650, q: 3 }, a: 0.004, d: 0.18, s: 0.45, r: 0.05 },
    arp: { kind: 'tone', wave: 'square', gain: 0.18, pan: 0.25, filter: { type: 'lowpass', freq: 2200, q: 2 }, a: 0.002, d: 0.14, s: 0, r: 0.05, echo: 0.4, verb: 0.2 },
    pad: { kind: 'tone', wave: 'sawtooth', unison: 10, gain: 0.09, filter: { type: 'lowpass', freq: 1300, q: 0.5 }, a: 0.5, d: 1, s: 0.8, r: 0.9, verb: 0.5, wobble: [0.3, 6] },
    lead: { kind: 'tone', wave: 'square', unison: 5, gain: 0.17, pan: -0.05, filter: { type: 'lowpass', freq: 2800 }, a: 0.015, d: 0.3, s: 0.75, r: 0.18, wobble: [5.5, 12], echo: 0.3, verb: 0.35 },
  },
  bar(b) {
    const out: Note[] = [];
    const { chord: c, kind, n, rng, song } = b;
    const R = place(c.root, 33);
    const pad = voicing(c, 57);
    if (b.last) {
      out.push(...hit('pad', 0, 16, pad, 0.8));
      out.push(note('bass', 0, R, 12, 0.9), note('crash', 0, 0, 1, 0.7), note('kick', 0, 0, 1, 0.9));
      return out;
    }
    // Pads all the way through; a gated pad in some choruses.
    if (kind === 'B' && song.v[1] < 0.5) for (const m of pad) out.push({ ...note('pad', 0, m, 16, 0.75), gate: 'xx.xxx.xxx.xxx.x' });
    else out.push(...hit('pad', 0, 16, pad, 0.7));
    // Bass: octaves on the eighths, or a gallop.
    if (kind !== 'break' && !(kind === 'intro' && n < 2)) {
      if (song.v[0] < 0.5) for (let i = 0; i < 16; i += 2) out.push(note('bass', i, i % 4 === 2 ? R + 12 : R, 1.6, i % 4 === 0 ? 0.9 : 0.7));
      else for (const i of steps('x.xxx.xxx.xxx.xx')) out.push(note('bass', i, R, 0.9, i % 4 === 0 ? 0.9 : 0.62));
    }
    // Arpeggio over the chord (the intro, the choruses and the break).
    if (kind === 'B' || kind === 'break' || kind === 'intro') {
      const tones = [...voicing(c, 60), ...voicing(c, 72)];
      for (let i = 0; i < 16; i++) out.push(note('arp', i, tones[arpIndex(song.v[2], i, tones.length)], 1, i % 4 === 0 ? 0.85 : 0.58));
    }
    const drums = isSong(b) || (kind === 'intro' && n >= 4) || (kind === 'outro' && n < 6) || (kind === 'break' && n >= 6);
    if (drums) {
      out.push(...beat(kind === 'B' ? 'x...x...x...x...' : 'x.......x.x.....', 'kick'));
      const fill = fillBar(b) && isSong(b) && rng() < 0.75;
      out.push(...beat(fill ? '....x...........' : '....x.......x...', 'snare'));
      if (fill) [57, 54, 50, 45].forEach((m, i) => out.push(note('tom', 12 + i, m, 1, 0.85 - i * 0.05)));
      out.push(...beat(kind === 'B' ? 'xoxoxoxoxoxoxoxo' : 'x.o.x.o.x.o.x.o.', 'hat'));
      if (kind === 'B') out.push(...beat('..x...x...x...x.', 'open'));
      if (n === 0 && isSong(b)) out.push(note('crash', 0, 0, 1, 0.65));
    }
    if (kind !== 'intro') out.push(...tuneOn(b, 'lead'));
    return out;
  },
};

// ---------------------------------------------------------------- Island Breeze

const island: StationDef = {
  id: 'island',
  name: 'Island Breeze',
  freq: 'FM 94.3',
  genre: 'Tropical · steel drums',
  color: '#3ddcc8',
  bpm: 106,
  swing: 0.5,
  swing16: 0.54,
  seed: 943,
  key: 0,
  scale: MAJOR,
  keys: [0, 2, 5, 7, 9],
  progA: ['C F G C C F G C', 'C Am F G C Am F G', 'F G C Am F G C C'],
  progB: ['F G Em Am F G C C', 'F C G C F C G G', 'Am F C G Am F G G'],
  melody: {
    lo: 67, hi: 88,
    cells: [[[0, 2], [2, 2]], [[0, 4]], [[0, 3], [3, 1]], [[2, 2]], [[0, 1], [1, 1], [2, 2]]],
    weights: [4, 1.5, 2, 1, 0.8],
    rest: 0.18, leap: 0.3, hold: 4,
  },
  echo: [3, 0.2],
  level: 1,
  kit: {
    kick: { kind: 'kick', gain: 0.24, f0: 120, f1: 50, d: 0.15 },
    clave: { kind: 'wood', gain: 0.28, pan: 0.35, f0: 2300, d: 0.04, verb: 0.25 },
    shaker: { kind: 'noise', gain: 0.2, pan: -0.3, filter: { type: 'bandpass', freq: 7000, q: 0.9 }, a: 0.006, d: 0.045 },
    conga: { kind: 'tom', gain: 0.2, pan: -0.2, d: 0.16, verb: 0.15 },
    bass: { kind: 'tone', wave: 'triangle', gain: 0.22, filter: { type: 'lowpass', freq: 650 }, a: 0.005, d: 0.2, s: 0.5, r: 0.06 },
    steel: { kind: 'mallet', gain: 0.34, pan: 0.1, partials: [[2, 0.4, 0.55], [3, 0.14, 0.35], [4.1, 0.06, 0.2]], d: 0.9, r: 0.25, verb: 0.3, echo: 0.12 },
    uke: { kind: 'pluck', gain: 0.45, pan: 0.3, bright: 0.55, d: 1.2, r: 0.08, verb: 0.15 },
    marimba: { kind: 'mallet', gain: 0.26, pan: -0.25, partials: [[4, 0.18, 0.18], [9.9, 0.04, 0.08]], d: 0.45, r: 0.2, verb: 0.2 },
  },
  bar(b) {
    const out: Note[] = [];
    const { chord: c, kind, n, rng, song } = b;
    const R = place(c.root, 33);
    const uke = voicing(c, 60);
    if (b.last) {
      out.push(...hit('uke', 0, 16, uke, 0.7, 0.12));
      out.push(...hit('steel', 0.5, 16, voicing(c, 72), 0.55, 0.3));
      out.push(note('bass', 0, R, 12, 0.9), note('kick', 0, 0, 1, 0.8));
      return out;
    }
    const full = isSong(b) || (kind === 'outro' && n < 6);
    // Percussion: shaker and clave nearly always, the kick and congas once it gets going.
    if (kind !== 'intro' || n >= 2) out.push(...beat('x.o.x.ogx.o.x.og', 'shaker'));
    out.push(...beat(n % 2 === 0 ? 'x.....x.....x...' : '....x...x.......', 'clave'));
    if (full) out.push(...beat(kind === 'B' ? 'x...x...x...x...' : 'x.......x.....x.', 'kick'));
    if (kind === 'B' || kind === 'break') {
      for (const [s, m, v] of [[3, 69, 0.5], [6, 62, 0.85], [7, 62, 0.6], [11, 69, 0.5], [14, 62, 0.85], [15, 64, 0.6]]) out.push(note('conga', s, m, 1, v));
    }
    // Bass: a bouncing calypso line, or a laid-back one.
    if (full || (kind === 'intro' && n >= 4)) {
      const nextR = place(b.next.root, 33);
      if (song.v[0] < 0.5) {
        out.push(note('bass', 0, R, 2.6, 0.95), note('bass', 3, R, 2, 0.7), note('bass', 6, R + c.tones[2], 1.8, 0.8));
        out.push(note('bass', 8, R, 2.6, 0.9), note('bass', 11, R + 12, 1.8, 0.7), note('bass', 14, approach(nextR, R + 7), 1.8, 0.75));
      } else {
        out.push(note('bass', 0, R, 5.5, 0.95), note('bass', 6, R + c.tones[2], 1.8, 0.75), note('bass', 8, R + 12, 3.5, 0.85));
        out.push(note('bass', 12, R + c.tones[1], 1.8, 0.7), note('bass', 14, R + c.tones[2], 1.8, 0.75));
      }
    } else if (kind === 'break') out.push(note('bass', 0, R, 7, 0.85), note('bass', 8, R + c.tones[2], 7, 0.75));
    // Ukulele: off-beat strums (busier in the chorus), rung out in the intro and the break.
    if (kind === 'intro' || kind === 'break') {
      out.push(...hit('uke', 0, 8, uke, 0.6, 0.1), ...hit('uke', 10, 6, uke, 0.45, 0.08, true));
      // A marimba walking up and down the chord.
      const tones = [...voicing(c, 60), ...voicing(c, 72)];
      for (let i = 0; i < 16; i += 2) out.push(note('marimba', i, tones[arpIndex(song.v[2], i / 2, tones.length)], 2, i % 4 === 0 ? 0.7 : 0.5));
    } else {
      const pat = kind === 'B' ? '..x.x.x...x.x.x.' : '..x...x...x...x.';
      for (const s of steps(pat)) out.push(...hit('uke', s, 1.5, uke, s % 4 === 2 ? 0.6 : 0.45, 0.07, s % 4 !== 2));
    }
    if (kind !== 'intro') out.push(...tuneOn(b, 'steel', 0, kind === 'break' ? 0.85 : 1));
    if (fillBar(b) && full && rng() < 0.6) for (const [s, m] of [[12, 69], [13, 67], [14, 64], [15, 62]]) out.push(note('conga', s, m, 1, 0.7));
    return out;
  },
};

// ---------------------------------------------------------------- Desert Highway

const desert: StationDef = {
  id: 'desert',
  name: 'Desert Highway',
  freq: 'FM 97.1',
  genre: 'Desert twang · slow roll',
  color: '#ff8a3d',
  bpm: 82,
  swing: 0.6,
  swing16: 0.5,
  seed: 971,
  key: 4,
  scale: MINOR_PENT,
  keys: [0, 5, 7, 10, 3],
  progA: ['Em Em D D C C Em Em', 'Em D C D Em D C B7', 'Em G D Am Em G D Em'],
  progB: ['Am Am Em Em C D Em Em', 'C G D Em C G D D', 'G D Em C G D C B7'],
  melody: {
    lo: 52, hi: 74,
    cells: [[[0, 4]], [[0, 2], [2, 2]], [[0, 3], [3, 1]], [[2, 2]], [[0, 1], [1, 1], [2, 2]]],
    weights: [2.5, 2.5, 1.5, 1, 0.5],
    rest: 0.3, leap: 0.25, hold: 8,
  },
  echo: [3, 0.3],
  level: 0.85,
  kit: {
    kick: { kind: 'kick', gain: 0.27, f0: 95, f1: 44, d: 0.2 },
    snare: { kind: 'snare', gain: 0.5, f0: 175, d: 0.14, filter: { type: 'bandpass', freq: 2000, q: 0.5 }, verb: 0.45 },
    rim: { kind: 'wood', gain: 0.3, f0: 1500, d: 0.03, verb: 0.3 },
    shaker: { kind: 'noise', gain: 0.2, pan: 0.3, filter: { type: 'highpass', freq: 5500 }, a: 0.01, d: 0.06 },
    bass: { kind: 'tone', wave: 'triangle', gain: 0.26, filter: { type: 'lowpass', freq: 520 }, a: 0.008, d: 0.5, s: 0.35, r: 0.1 },
    twang: { kind: 'pluck', gain: 1.2, pan: -0.1, bright: 0.9, bend: 2, d: 1.6, r: 0.15, echo: 0.3, verb: 0.4, filter: { type: 'highpass', freq: 120 } },
    strum: { kind: 'pluck', gain: 0.5, pan: 0.35, bright: 0.45, d: 2.4, r: 0.12, verb: 0.3 },
    organ: { kind: 'tone', wave: 'triangle', gain: 0.11, pan: -0.3, filter: { type: 'lowpass', freq: 1500 }, a: 0.3, d: 0.5, s: 0.85, r: 0.6, trem: [5, 0.5], verb: 0.5 },
  },
  bar(b) {
    const out: Note[] = [];
    const { chord: c, kind, n, rng } = b;
    const R = place(c.root, 33);
    const gtr = guitar(c, 40);
    if (b.last) {
      out.push(...hit('strum', 0, 16, gtr, 0.75, 0.16));
      out.push(note('bass', 0, R, 12, 0.9), note('kick', 0, 0, 1, 0.8));
      out.push(...hit('organ', 0, 16, voicing(c, 52), 0.6));
      return out;
    }
    const full = isSong(b) || (kind === 'outro' && n < 6);
    // Guitar: a ringing strum in the quiet parts, a lazy down-down-up-down otherwise.
    if (kind === 'intro' || kind === 'break') out.push(...hit('strum', 0, 8, gtr, 0.65, 0.16), ...hit('strum', 8, 8, gtr.slice(1), 0.5, 0.14));
    else {
      out.push(...hit('strum', 0, 6, gtr, 0.62, 0.14));
      out.push(...hit('strum', 8, 2, gtr.slice(1), 0.48, 0.1));
      out.push(...hit('strum', 10, 2, gtr.slice(2), 0.38, 0.08, true));
      out.push(...hit('strum', 12, 4, gtr, 0.52, 0.12));
    }
    // Bass: root and fifth, two to the bar, walking into the next chord in the chorus.
    if (full || (kind === 'intro' && n >= 4)) {
      const low5 = R + c.tones[2] - 12 >= 28 ? R + c.tones[2] - 12 : R + c.tones[2];
      out.push(note('bass', 0, R, 6, 0.95), note('bass', 8, low5, kind === 'B' ? 4 : 6, 0.8));
      if (kind === 'B') out.push(note('bass', 14, approach(place(b.next.root, 33), low5), 1.8, 0.7));
    } else if (kind === 'break') out.push(note('bass', 0, R, 14, 0.8));
    if (full) {
      out.push(...beat(kind === 'B' ? 'x.......x.....x.' : 'x.......x.......', 'kick'));
      out.push(...beat('....x.......x...', kind === 'B' ? 'snare' : 'rim'));
      out.push(...beat('x.o.x.o.x.o.x.o.', 'shaker'));
      if (fillBar(b) && rng() < 0.6) out.push(...beat('............o.ox', 'snare'));
    } else if (kind === 'intro' && n >= 4) out.push(...beat('....x.......x...', 'rim'), ...beat('x.o.x.o.x.o.x.o.', 'shaker'));
    else if (kind === 'break') out.push(...beat('x...............', 'kick'));
    if (kind === 'B' || kind === 'break' || kind === 'intro') out.push(...hit('organ', 0, 16, voicing(c, 52), 0.55));
    if (kind !== 'intro') out.push(...tuneOn(b, 'twang'));
    return out;
  },
};

// ---------------------------------------------------------------- Lo-fi Lounge

const lofi: StationDef = {
  id: 'lofi',
  name: 'Lo-fi Lounge',
  freq: 'FM 104.5',
  genre: 'Lo-fi beats · late night',
  color: '#a99bff',
  bpm: 78,
  swing: 0.5,
  swing16: 0.6,
  seed: 1045,
  key: 0,
  scale: MAJOR_PENT,
  keys: [0, 5, 2, 9, 3],
  progA: [
    'Dm9 G9 Cmaj9 Am9 Dm9 G9 Cmaj9 Am9',
    'Fmaj9 Em7 Dm9 Cmaj9 Fmaj9 Em7 Dm9 G9',
    'Cmaj9 Em7 Fmaj9 Fm6 Cmaj9 Em7 Fmaj9 G7sus4',
  ],
  progB: [
    'Am9 Am9 Dm9 Dm9 Fmaj9 Em7 Dm9 G9',
    'Fmaj9 Fm6 Em7 Am9 Dm9 G9 Cmaj9 Cmaj9',
    'Em7 Am9 Dm9 G9 Em7 Am9 Fmaj9 G7sus4',
  ],
  melody: {
    lo: 67, hi: 84,
    cells: [[[0, 4]], [[0, 2], [2, 2]], [[2, 2]], [[0, 3], [3, 1]], [[1, 1], [2, 2]]],
    weights: [2, 2, 1.5, 1, 0.5],
    rest: 0.42, leap: 0.3, hold: 8,
  },
  echo: [3, 0.3],
  tone: 4200,
  level: 1,
  kit: {
    kick: { kind: 'kick', gain: 0.23, f0: 85, f1: 42, d: 0.2 },
    snare: { kind: 'snare', gain: 0.66, f0: 210, d: 0.1, filter: { type: 'bandpass', freq: 1800, q: 0.6 }, verb: 0.25 },
    hat: { kind: 'noise', gain: 0.2, pan: 0.2, filter: { type: 'bandpass', freq: 5000, q: 0.8 }, d: 0.035 },
    keys: { kind: 'fm', gain: 0.19, pan: -0.1, ratio: 1, index: 1.1, a: 0.006, d: 1.8, s: 0.35, r: 0.5, wobble: [0.55, 10], verb: 0.3 },
    bass: { kind: 'tone', wave: 'sine', gain: 0.2, filter: { type: 'lowpass', freq: 420 }, a: 0.01, d: 0.35, s: 0.6, r: 0.12 },
    bell: { kind: 'mallet', gain: 0.3, pan: 0.15, partials: [[4, 0.12, 0.25]], d: 1.1, r: 0.4, wobble: [0.55, 10], echo: 0.3, verb: 0.4 },
    flute: { kind: 'tone', wave: 'triangle', gain: 0.16, pan: 0.1, filter: { type: 'lowpass', freq: 2200 }, a: 0.05, d: 0.2, s: 0.8, r: 0.25, wobble: [4.8, 10], echo: 0.25, verb: 0.4 },
    vinyl: { kind: 'hiss', gain: 0.04 },
  },
  bar(b) {
    const out: Note[] = [];
    const { chord: c, kind, n, rng, song } = b;
    const R = place(c.root, 33);
    const keys = voicing(c, 53, true);
    if (b.last) {
      out.push(...hit('keys', 0, 16, keys, 0.7, 0.2), note('bass', 0, R, 12, 0.85));
      return out;
    }
    // Keys: lazy rolled chords.
    const pats = [[[0, 14]], [[0, 6], [8, 6]], [[0, 3], [3, 4], [10, 5]], [[0, 7], [10, 5]]];
    const pat = kind === 'intro' || kind === 'break' ? [[0, 15]] : pats[Math.floor(rng() * pats.length)];
    for (const [at, len] of pat) out.push(...hit('keys', at, len, keys, 0.55 + rng() * 0.15, 0.2));
    // Bass.
    if (kind !== 'intro' || n >= 4) {
      out.push(note('bass', 0, R, 5.5, 0.9));
      if (rng() < 0.6) out.push(note('bass', 7, near(fifth(c), R + 5), 2.5, 0.65));
      out.push(note('bass', 10, R, 3.5, 0.75));
      if (rng() < 0.5) out.push(note('bass', 14, approach(place(b.next.root, 33), R), 1.8, 0.6));
    }
    // Drums: boom-bap with lazy sixteenths.
    const drums = isSong(b) || (kind === 'outro' && n < 6) || (kind === 'intro' && n >= 4);
    if (drums) {
      const kp = ['x.........x.....', 'x......x..x.....', 'x.....x...x..x..'][Math.floor(song.v[0] * 3) % 3];
      out.push(...beat(kp, 'kick'));
      out.push(...beat('....x.......x...', 'snare'));
      for (const s of [7, 15]) if (rng() < 0.3) out.push(note('snare', s, 0, 1, 0.2));
      out.push(...beat('x.o.x.o.x.o.x.o.', 'hat'));
      for (const s of [3, 11]) if (rng() < 0.3) out.push(note('hat', s, 0, 1, 0.25));
    } else if (kind === 'intro' && n >= 2) out.push(...beat('x.o.x.o.x.o.x.o.', 'hat', 0.7));
    if (kind === 'B') out.push(...tuneOn(b, 'flute', -12));
    else out.push(...tuneOn(b, 'bell', 0, kind === 'break' ? 0.8 : 1));
    // A third and fifth to colour the chord now and then.
    if (rng() < 0.15) out.push(note('bell', 12, near(third(c), 76), 3, 0.35));
    return out;
  },
};

/** The dial, in order: N steps through these, then Off. */
export const STATIONS: readonly StationDef[] = [jackpot, neon, island, desert, lofi];
