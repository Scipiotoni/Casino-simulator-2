/**
 * Deterministic randomness for building the world: a seeded PRNG and fast 2D gradient
 * noise. Every player who loads the game gets the same island from the same seed.
 */

/** Mulberry32: a tiny, fast, well-mixed 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable hash of two integers to [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Hash a string to a 32-bit seed. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GRAD = new Float32Array(512 * 2);
const PERM = new Uint16Array(1024);

function initNoise(seed: number): void {
  const r = mulberry32(seed);
  const p: number[] = [];
  for (let i = 0; i < 512; i++) p.push(i);
  for (let i = 511; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 1024; i++) PERM[i] = p[i & 511];
  for (let i = 0; i < 512; i++) {
    const a = r() * Math.PI * 2;
    GRAD[i * 2] = Math.cos(a);
    GRAD[i * 2 + 1] = Math.sin(a);
  }
}
initNoise(1337);

/** 2D gradient noise in roughly [-1, 1], continuous with continuous first derivative. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 511;
  const Y = yi & 511;
  const g00 = PERM[X + PERM[Y]] * 2;
  const g10 = PERM[X + 1 + PERM[Y]] * 2;
  const g01 = PERM[X + PERM[Y + 1]] * 2;
  const g11 = PERM[X + 1 + PERM[Y + 1]] * 2;
  const n00 = GRAD[g00] * xf + GRAD[g00 + 1] * yf;
  const n10 = GRAD[g10] * (xf - 1) + GRAD[g10 + 1] * yf;
  const n01 = GRAD[g01] * xf + GRAD[g01 + 1] * (yf - 1);
  const n11 = GRAD[g11] * (xf - 1) + GRAD[g11 + 1] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.414;
}

/** Fractal noise: `octaves` layers, each twice the frequency and `gain` the amplitude. */
export function fbm(x: number, y: number, octaves = 4, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    amp *= gain;
    x = x * lacunarity + 17.3;
    y = y * lacunarity - 9.1;
  }
  return sum / norm;
}

/** Ridged noise for mountain crests: sharp ridges in [0, 1]. */
export function ridged(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let w = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x, y));
    n *= n;
    n *= w;
    w = Math.min(1, Math.max(0, n * 1.6));
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 5.2;
    y = y * 2.03 - 3.7;
  }
  return sum / norm;
}
