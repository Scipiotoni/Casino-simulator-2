/**
 * Slot machine maths, the way a real three-reel machine works: every reel has its own
 * strip of 22 stops, each spin picks a random stop per reel, and wins are read off the
 * symbols that land on the paylines. Nothing is decided first and dressed up afterwards,
 * so near misses above and below the line are real. The return to player is fixed by the
 * strips and the paytable (computed exactly in slotRtp()).
 */

export const SYM = { SEVEN: 0, CHERRY: 1, BAR: 2, LEMON: 3, BELL: 4, GRAPE: 5, DIAMOND: 6, STAR: 7, BLANK: 8 } as const;
export const SYMBOL_NAMES = ['Seven', 'Cherry', 'BAR', 'Lemon', 'Bell', 'Grapes', 'Diamond', 'Star', 'Blank'];

/** Reel strips (symbol per stop, 8 = blank). Symbols alternate with blanks like a real reel. */
export const STRIPS: number[][] = [
  [7, 8, 0, 8, 3, 8, 1, 8, 5, 8, 1, 8, 2, 8, 5, 8, 3, 8, 6, 8, 4, 8],
  [5, 8, 3, 8, 2, 8, 1, 8, 3, 8, 0, 8, 5, 8, 4, 8, 4, 8, 3, 8, 7, 8],
  [4, 8, 5, 8, 3, 8, 2, 8, 7, 8, 0, 8, 2, 8, 3, 8, 4, 8, 5, 8, 6, 8],
];

/** Paylines as row index per reel (0 top, 1 middle, 2 bottom). */
export const LINES: number[][] = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

/** Three of a kind pays (times the line bet). Diamonds are wild and double what they help make. */
export const THREE_PAYS: Record<number, number> = {
  [SYM.DIAMOND]: 1000,
  [SYM.SEVEN]: 350,
  [SYM.STAR]: 115,
  [SYM.BAR]: 70,
  [SYM.BELL]: 45,
  [SYM.GRAPE]: 27,
  [SYM.CHERRY]: 22,
  [SYM.LEMON]: 18,
};
export const TWO_CHERRIES = 6;
export const ONE_CHERRY = 2;

/** The 3x3 window for stops (the stop is the middle row). */
export function windowFor(stops: number[]): number[][] {
  return STRIPS.map((strip, r) => {
    const L = strip.length;
    const s = stops[r];
    return [strip[(s - 1 + L) % L], strip[s], strip[(s + 1) % L]];
  });
}

export interface LineWin {
  line: number;
  pays: number;
  label: string;
}

/** What one payline pays (times the line bet). */
export function evalLine(syms: number[]): { pays: number; label: string } {
  const D = SYM.DIAMOND;
  const diamonds = syms.filter((s) => s === D).length;
  if (diamonds === 3) return { pays: THREE_PAYS[D], label: 'Triple diamonds' };
  // Three of a kind with diamonds standing in (each one doubles it).
  const others = syms.filter((s) => s !== D);
  if (others.every((s) => s === others[0])) {
    const base = THREE_PAYS[others[0]];
    if (base) return { pays: base * Math.pow(2, diamonds), label: `Three ${SYMBOL_NAMES[others[0]]}${diamonds ? ` (x${Math.pow(2, diamonds)} wild)` : ''}` };
  }
  // Cherries on the left.
  const c = (s: number) => s === SYM.CHERRY || s === D;
  if (c(syms[0]) && c(syms[1]) && syms[0] !== D) return { pays: TWO_CHERRIES * (syms[1] === D ? 2 : 1), label: 'Two cherries' };
  if (syms[0] === SYM.CHERRY) return { pays: ONE_CHERRY, label: 'Cherry' };
  return { pays: 0, label: '' };
}

/** Every winning line for these stops, with `lines` paylines played. */
export function evaluate(stops: number[], lines: number): LineWin[] {
  const w = windowFor(stops);
  const out: LineWin[] = [];
  for (let l = 0; l < lines; l++) {
    const syms = LINES[l].map((row, reel) => w[reel][row]);
    const r = evalLine(syms);
    if (r.pays > 0) out.push({ line: l, pays: r.pays, label: r.label });
  }
  return out;
}

export function spin(rng: () => number): number[] {
  return STRIPS.map((s) => Math.floor(rng() * s.length));
}

/** Exact return to player for a given number of lines (all stop combinations). */
export function slotRtp(lines: number): { rtp: number; hitRate: number } {
  let total = 0;
  let hits = 0;
  let n = 0;
  const [a, b, c] = STRIPS.map((s) => s.length);
  for (let i = 0; i < a; i++) {
    for (let j = 0; j < b; j++) {
      for (let k = 0; k < c; k++) {
        const wins = evaluate([i, j, k], lines);
        const pay = wins.reduce((x, y) => x + y.pays, 0);
        total += pay;
        if (pay > 0) hits++;
        n++;
      }
    }
  }
  return { rtp: total / n / lines, hitRate: hits / n };
}
