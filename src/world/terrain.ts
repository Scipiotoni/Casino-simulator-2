import { fbm, hash2, noise2, ridged } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { CITY, CITY_Y, DESERT_TOWN, DOMAIN, LANDMARKS, NORTH_COAST, NORTH_TOWN, OLD_TOWN, allRoads, cityLots, thunderheadProfile, type Lot, type RoadDef } from './layout';

/**
 * The island's height field: natural land (coast, hills, the volcano, the jungle ridge),
 * then levelled ground for the city, the base and Coral Cove, then every road carved in
 * with gentle grades, then every lot flattened. Heights live in one Float32Array on an
 * 8 m grid and are read back with bilinear interpolation, so ground queries are cheap.
 */

export const CELL = 8;
export const SEA_LEVEL = 0;

/** What the ground is made of (drives vertex colours on the terrain mesh). */
export const Surface = { Natural: 0, Pavement: 1, Shoulder: 2, Dirt: 3, Lawn: 4, Tarmac: 5 } as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

export interface RoadProfile {
  road: RoadDef;
  /** Resampled points along the road (every ~10 m) with heights. */
  xs: Float32Array;
  zs: Float32Array;
  ys: Float32Array;
  /** Distance along the road at each point. */
  ss: Float32Array;
  length: number;
}

// ------------------------------------------------------------------ the coast

/** Polynomial smooth minimum: like min(a, b) but rounded where they are within k. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Signed distance to a closed polygon (negative inside). */
function polygonDistance(px: number, pz: number, poly: [number, number][]): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j];
    const [bx, bz] = poly[i];
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const ex = ax + dx * t - px;
    const ez = az + dz * t - pz;
    best = Math.min(best, ex * ex + ez * ez);
    if (az > pz !== bz > pz && px < ax + ((pz - az) / (bz - az)) * dx) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

/** Saguaro County's coast as a distance field on a coarse grid (built on first use). */
const SDF = { x0: -6000, z0: -11200, x1: 5000, z1: 0, step: 25 };
const SDF_NX = (SDF.x1 - SDF.x0) / SDF.step + 1;
const SDF_NZ = (SDF.z1 - SDF.z0) / SDF.step + 1;
let northField: Float32Array | null = null;

function northSdf(x: number, z: number): number {
  if (!northField) {
    northField = new Float32Array(SDF_NX * SDF_NZ);
    for (let j = 0; j < SDF_NZ; j++) {
      for (let i = 0; i < SDF_NX; i++) northField[j * SDF_NX + i] = polygonDistance(SDF.x0 + i * SDF.step, SDF.z0 + j * SDF.step, NORTH_COAST);
    }
  }
  const fx = (x - SDF.x0) / SDF.step;
  const fz = (z - SDF.z0) / SDF.step;
  if (fx < 0 || fz < 0 || fx >= SDF_NX - 1 || fz >= SDF_NZ - 1) return 5000;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * SDF_NX + i;
  const f = northField;
  const a = f[k] + (f[k + 1] - f[k]) * tx;
  const b = f[k + SDF_NX] + (f[k + SDF_NX + 1] - f[k + SDF_NX]) * tx;
  return a + (b - a) * tz;
}

/**
 * Signed "distance" from the coast: < 1 on land, > 1 at sea. The old island is a warped
 * ellipse; Saguaro County (a polygon) is merged onto its north shore with a smooth union.
 */
export function coastD(x: number, z: number): number {
  const wx = x + 380 * fbm(x / 2300 + 3.1, z / 2300 - 1.7, 3);
  const wz = z + 380 * fbm(x / 2300 - 7.3, z / 2300 + 5.2, 3);
  let d = Math.hypot(wx / 4350, wz / 3500);
  // The east coast is pushed out and straightened for the city's beachfront.
  const xc = 3680 + 90 * noise2(z / 650, 4.2);
  const east = 1 + (x - xc) / 420;
  const cityBand = (1 - smoothstep(1900, 2600, Math.abs(z + 100))) * smoothstep(1800, 2800, x);
  d = d * (1 - cityBand) + Math.max(Math.min(d, 0.9), east) * cityBand;
  // Small coves and headlands.
  const coves = 0.035 * noise2(x / 520 + 11, z / 520 - 4);
  d += coves;
  if (z < 0) {
    // Fade the county out well south of its shore so the old island is untouched.
    const north = 1 + northSdf(x + (wx - x) * 0.5, z + (wz - z) * 0.5) / 3400 + coves + 6 * smoothstep(-1400, 0, z);
    d = smin(d, north, 0.06);
  }
  return d;
}

// ------------------------------------------------------------------ Saguaro County

/** The foothill range between the city and the desert (a crest line). */
const RIDGE: [number, number][] = [[-3000, -3950], [-1800, -3800], [-600, -3750], [400, -3800], [1000, -3950]];

function ridgeDistance(x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k < RIDGE.length - 1; k++) {
    const [ax, az] = RIDGE[k];
    const [bx, bz] = RIDGE[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

/** How far into the desert basin a point is (0 at its heart, 1 at its rim). */
export function basinRadius(x: number, z: number): number {
  return Math.hypot((x - 300) / 2700, (z + 5350) / 1400) + 0.12 * noise2(x / 700 + 5, z / 700 - 2);
}

function ellipseDistance(x: number, z: number, cx: number, cz: number, a: number, b: number, rot: number): number {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return (Math.hypot((dx * c + dz * s) / a, (-dx * s + dz * c) / b) - 1) * b;
}

/** Signed distance from the salt lake's shore (negative in the water). */
export function lakeDistance(x: number, z: number): number {
  const L = LANDMARKS.lake;
  const main = ellipseDistance(x, z, L.x, L.z, L.a, L.b, L.rot);
  // A second lobe to the south-east, and a ragged shore of points and inlets.
  const lobe = ellipseDistance(x, z, L.x + 820, L.z + 260, 520, 330, -0.45);
  return smin(main, lobe, 160) + 70 * noise2(x / 520 + 2, z / 520 + 8) + 25 * noise2(x / 160 - 3, z / 160);
}

/** Desert biome weight: 1 in the valley's sand and scrub, 0 in green country. */
export function aridity(x: number, z: number): number {
  if (z > -2200) return 0;
  const core = 1 - smoothstep(0.7, 1.2, basinRadius(x, z));
  const dryHills = 0.45 * smoothstep(-2300, -3400, z);
  return Math.max(core, dryHills) * (1 - forestness(x, z));
}

/** Pine country weight: 1 in the northern forests and on Mount Thunderhead. */
export function forestness(x: number, z: number): number {
  if (z > -4800) return 0;
  const m = LANDMARKS.mountain;
  const mount = 1 - smoothstep(1500, 2300, Math.hypot(x - m.x, z - m.z));
  const north = smoothstep(-6500, -7500, z + 350 * noise2(x / 1300 + 4, z / 1300));
  return Math.max(mount, north) * (1 - farmland(x, z));
}

/** Harvest Valley's fields: 1 inside the farmland. */
export function farmland(x: number, z: number): number {
  const fx = Math.max(1750 - x, 0, x - 3100);
  const fz = Math.max(-7350 - z, 0, z + 5900);
  return 1 - smoothstep(0, 160, Math.hypot(fx, fz) + 60 * noise2(x / 400, z / 400 + 3));
}

/** Which crop a field grows (-1 off the farmland): fields are 120 x 80 m strips. */
export function fieldAt(x: number, z: number): number {
  if (farmland(x, z) < 0.6) return -1;
  const i = Math.floor((x - 1750) / 120);
  const j = Math.floor((z + 7350) / 80);
  // Leave tracks between the fields.
  if ((x - 1750) - i * 120 < 4 || (z + 7350) - j * 80 < 4) return -1;
  return Math.floor(hash2(i, j, 5) * 4);
}

/** Natural ground before any levelling. */
export function naturalHeight(x: number, z: number): number {
  const d = coastD(x, z);
  if (d >= 1) {
    // Sea floor shelving away from the beach.
    return -1.5 - 70 * smoothstep(1, 1.4, d) - 8 * (d - 1);
  }
  const landT = smoothstep(1.0, 0.94, d);
  let h = 0.4 + 2.6 * landT;
  const inland = smoothstep(0.96, 0.62, d);
  const hills = fbm(x / 1500, z / 1500, 4) * 0.5 + 0.5;
  h += inland * (6 + 85 * hills * hills);
  // Mount Fortuna, a big volcano with ridged flanks and a crater.
  const v = LANDMARKS.volcano;
  const rv = Math.hypot(x - v.x, z - v.z);
  const cone = Math.exp(-Math.pow(rv / 1150, 1.7));
  if (cone > 0.01) {
    const c = (cone - 0.01) / 0.99;
    h += 640 * c;
    h += 110 * ridged(x / 520, z / 520, 4) * c * smoothstep(120, 600, rv);
    h -= 150 * Math.exp(-Math.pow(rv / 190, 2));
  }
  // The jungle ridge in the south-west.
  const rx = x + 3000;
  const rz = z - 1250;
  const along = (rx * 0.55 + rz * 0.83) / 1400;
  const across = (rx * 0.83 - rz * 0.55) / 380;
  const ridgeMask = Math.exp(-across * across) * smoothstep(1.4, 0.4, Math.abs(along));
  if (ridgeMask > 0.01) h += ((ridgeMask - 0.01) / 0.99) * (120 + 200 * ridged(x / 420, z / 420, 3)) * inland;
  // Palm Heights: rolling hills north of the city.
  const ph = Math.exp(-Math.pow((x - 2000) / 900, 2) - Math.pow((z + 2350) / 500, 2));
  h += ph * 45 * inland;
  if (z < -2000) h = countyHeight(x, z, h, d, inland);
  return h;
}

/**
 * Saguaro County's relief on top of the rolling hills: the foothill range, Mount Thunderhead,
 * forested hills in the north and sea cliffs, then the desert basin and the farmland levelled
 * out of them, and the salt lake carved last.
 */
function countyHeight(x: number, z: number, h: number, d: number, inland: number): number {
  // The foothill range.
  if (z < -3000 && z > -4700) {
    const r = ridgeDistance(x, z);
    if (r < 1300) h += Math.exp(-Math.pow(r / 420, 2)) * inland * (140 + 170 * ridged(x / 480 + 2, z / 480 - 5, 3));
  }
  // Mount Thunderhead: a broad massif with ridged flanks and a sharp summit.
  const m = LANDMARKS.mountain;
  const rm = Math.hypot(x - m.x, z - m.z);
  const cliffT = smoothstep(1.0, 0.93, d);
  if (rm < 3200) {
    const flank = Math.exp(-Math.pow(rm / 1000, 2));
    h += cliffT * (thunderheadProfile(rm) + 170 * (ridged(x / 520 + 3, z / 520 - 7, 4) - 0.45) * flank * smoothstep(100, 650, rm));
  }
  // Forested hills across the north.
  const nf = smoothstep(-6300, -7400, z);
  if (nf > 0) {
    const f = fbm(x / 1100 + 9, z / 1100 + 4, 4) * 0.5 + 0.5;
    h += nf * inland * 150 * f * f;
  }
  // Sea cliffs along the west and north coasts (not at the beaches by the towns).
  const westOrNorth = Math.max(smoothstep(-2900, -3400, x), smoothstep(-7900, -8400, z));
  const townBeach = (1 - smoothstep(700, 1100, Math.abs(x - LANDMARKS.northTown.x))) * smoothstep(-7900, -8300, z);
  const cliffs = smoothstep(-2800, -3600, z) * westOrNorth * (1 - townBeach);
  if (cliffs > 0) h += cliffs * smoothstep(0.995, 0.97, d) * (30 + 30 * (noise2(x / 400 + 1, z / 400 + 6) * 0.5 + 0.5));
  // The desert basin: a broad, low valley floor with a few flat-topped buttes.
  const e = basinRadius(x, z);
  if (e < 1) {
    const D = 1 - smoothstep(0.62, 1.0, e);
    let floor = 14 + 18 * (fbm(x / 2600 + 1, z / 2600 + 7, 2) * 0.5 + 0.5) + 70 * Math.pow(smoothstep(0.5, 1.0, e), 2);
    const b = noise2(x / 420 + 17, z / 420 - 9);
    if (b > 0.42) floor += 45 * smoothstep(0.42, 0.5, b) * smoothstep(500, 900, lakeDistance(x, z));
    h += (floor - h) * D;
  }
  // Harvest Valley: gentle farmland.
  const fm = farmland(x, z);
  if (fm > 0) h += (24 + 10 * fbm(x / 1800 + 4, z / 1800, 2) - h) * fm * 0.9;
  // Alkali Lake: a shallow salt lake at sea level, ringed by salt flats.
  const sd = lakeDistance(x, z);
  if (sd < 0) h = Math.min(h, -1.2 - 10 * smoothstep(0, 420, -sd));
  else if (sd < 700) {
    const cap = Math.min(h, 0.7 + 21 * Math.pow(smoothstep(0, 700, sd), 1.3));
    h = cap + (h - cap) * smoothstep(450, 700, sd);
  }
  return h;
}

interface FlatZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  blend: number;
  surface: Surface;
}

export function flatZones(): FlatZone[] {
  const b = LANDMARKS.base;
  const { port, marina, airstrip } = LANDMARKS;
  return [
    { x0: CITY.minX, x1: CITY.maxX, z0: CITY.minZ, z1: CITY.maxZ, y: CITY_Y, blend: 260, surface: Surface.Pavement },
    { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y: 14, blend: 220, surface: Surface.Dirt },
    { x0: OLD_TOWN.x0 - 60, x1: OLD_TOWN.x1 + 60, z0: OLD_TOWN.z - 90, z1: OLD_TOWN.z + 80, y: 4.5, blend: 120, surface: Surface.Lawn },
    { x0: port.x0, x1: port.x1, z0: port.z0, z1: port.z1, y: port.y, blend: 140, surface: Surface.Tarmac },
    { x0: marina.x0, x1: marina.x1, z0: marina.z0, z1: marina.z1, y: marina.y, blend: 70, surface: Surface.Pavement },
    { x0: DESERT_TOWN.x0 - 160, x1: DESERT_TOWN.x1 + 160, z0: DESERT_TOWN.z - 130, z1: DESERT_TOWN.z + 110, y: DESERT_TOWN.y, blend: 180, surface: Surface.Natural },
    { x0: airstrip.x0, x1: airstrip.x1, z0: airstrip.z0, z1: airstrip.z1, y: DESERT_TOWN.y + 1, blend: 120, surface: Surface.Dirt },
    { x0: NORTH_TOWN.x0 - 260, x1: NORTH_TOWN.x1 + 260, z0: NORTH_TOWN.z - 110, z1: NORTH_TOWN.z + 110, y: NORTH_TOWN.y, blend: 160, surface: Surface.Natural },
  ];
}

/** Dredged water: the port's berth and the marina's basin (deepened, never raised). */
export function waterZones(): FlatZone[] {
  const { port, marina } = LANDMARKS;
  return [
    { x0: port.x1, x1: port.x1 + 340, z0: port.z0 - 60, z1: port.z1 + 80, y: -port.depth, blend: 220, surface: Surface.Natural },
    { x0: marina.basin.x0, x1: marina.basin.x1, z0: marina.basin.z0, z1: marina.basin.z1, y: -marina.depth, blend: 120, surface: Surface.Natural },
  ];
}

/** Ground height of a lot's district when it's a levelled town (null on the city grid). */
export function townY(l: Lot): number | null {
  if (l.district === 'oldtown') return 4.5;
  if (l.district === 'desert') return DESERT_TOWN.y;
  if (l.district === 'north') return NORTH_TOWN.y;
  return null;
}

export class Terrain {
  readonly nx: number;
  readonly nz: number;
  readonly heights: Float32Array;
  readonly surface: Uint8Array;
  readonly roads: RoadProfile[] = [];
  readonly lots: Lot[];
  /** Height of each lot's levelled ground. */
  readonly lotY = new Map<string, number>();

  constructor() {
    this.nx = Math.floor((DOMAIN.maxX - DOMAIN.minX) / CELL) + 1;
    this.nz = Math.floor((DOMAIN.maxZ - DOMAIN.minZ) / CELL) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    this.surface = new Uint8Array(this.nx * this.nz);
    this.generateNatural();
    this.applyFlatZones();
    this.applyWaterZones();
    for (const r of allRoads()) this.roads.push(this.profile(r));
    this.carveRoads();
    this.lots = cityLots();
    this.flattenLots();
  }

  private generateNatural(): void {
    const { nx, nz, heights } = this;
    for (let j = 0; j < nz; j++) {
      const z = DOMAIN.minZ + j * CELL;
      for (let i = 0; i < nx; i++) {
        const x = DOMAIN.minX + i * CELL;
        heights[j * nx + i] = naturalHeight(x, z);
      }
    }
  }

  private applyFlatZones(): void {
    for (const f of flatZones()) {
      this.forCells(f.x0 - f.blend, f.x1 + f.blend, f.z0 - f.blend, f.z1 + f.blend, (idx, x, z) => {
        const dx = Math.max(f.x0 - x, 0, x - f.x1);
        const dz = Math.max(f.z0 - z, 0, z - f.z1);
        const dd = Math.hypot(dx, dz);
        const w = 1 - smoothstep(0, f.blend, dd);
        if (w <= 0) return;
        const h = this.heights[idx];
        // Only level what is land (keep the sea where the zone runs off the coast).
        if (h < -0.5 && dd > 0) return;
        this.heights[idx] = h + (f.y - h) * w;
        if (w > 0.98) this.surface[idx] = f.surface;
      });
    }
  }

  private applyWaterZones(): void {
    for (const f of waterZones()) {
      this.forCells(f.x0 - f.blend, f.x1 + f.blend, f.z0 - f.blend, f.z1 + f.blend, (idx, x, z) => {
        const dx = Math.max(f.x0 - x, 0, x - f.x1);
        const dz = Math.max(f.z0 - z, 0, z - f.z1);
        const dd = Math.hypot(dx, dz);
        const h = this.heights[idx];
        // Inside: dug out. Around it, only the sea floor slopes down to meet it (quay walls stay).
        if (dd === 0) this.heights[idx] = Math.min(h, f.y);
        else if (h < -0.5) this.heights[idx] = Math.min(h, h + (f.y - h) * (1 - smoothstep(0, f.blend, dd)));
      });
    }
  }

  private forCells(x0: number, x1: number, z0: number, z1: number, fn: (idx: number, x: number, z: number) => void): void {
    const i0 = Math.max(0, Math.floor((x0 - DOMAIN.minX) / CELL));
    const i1 = Math.min(this.nx - 1, Math.ceil((x1 - DOMAIN.minX) / CELL));
    const j0 = Math.max(0, Math.floor((z0 - DOMAIN.minZ) / CELL));
    const j1 = Math.min(this.nz - 1, Math.ceil((z1 - DOMAIN.minZ) / CELL));
    for (let j = j0; j <= j1; j++) {
      const z = DOMAIN.minZ + j * CELL;
      for (let i = i0; i <= i1; i++) fn(j * this.nx + i, DOMAIN.minX + i * CELL, z);
    }
  }

  /** Resample a road every ~10 m and give it a smooth height profile over the land. */
  private profile(road: RoadDef): RoadProfile {
    const pts: [number, number][] = [];
    for (let k = 0; k < road.pts.length - 1; k++) {
      const [ax, az] = road.pts[k];
      const [bx, bz] = road.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 10));
      for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    }
    pts.push(road.pts[road.pts.length - 1]);
    // Round off the corners of highways and roads (Chaikin) so they curve.
    let smooth = pts;
    if (!road.grid) {
      for (let it = 0; it < 3; it++) {
        const out: [number, number][] = [smooth[0]];
        for (let k = 0; k < smooth.length - 1; k++) {
          const [ax, az] = smooth[k];
          const [bx, bz] = smooth[k + 1];
          out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
        }
        out.push(smooth[smooth.length - 1]);
        smooth = out;
      }
      // Re-space evenly.
      const re: [number, number][] = [smooth[0]];
      let acc = 0;
      for (let k = 1; k < smooth.length; k++) {
        acc += Math.hypot(smooth[k][0] - smooth[k - 1][0], smooth[k][1] - smooth[k - 1][1]);
        if (acc >= 9 || k === smooth.length - 1) {
          re.push(smooth[k]);
          acc = 0;
        }
      }
      smooth = re;
    }
    const n = smooth.length;
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    const ys = new Float32Array(n);
    const ss = new Float32Array(n);
    let s = 0;
    for (let k = 0; k < n; k++) {
      xs[k] = smooth[k][0];
      zs[k] = smooth[k][1];
      if (k > 0) s += Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
      ss[k] = s;
      ys[k] = Math.max(2.2, this.rawHeight(xs[k], zs[k]));
    }
    if (road.grid) {
      // Grid streets: flat in the city, a straight grade between corners in the hills.
      for (let k = 0; k < n; k++) ys[k] = this.gridStreetY(xs[k], zs[k]);
    } else {
      // Smooth into gentle grades: several passes of a wide moving average.
      const win = road.kind === 'highway' ? 9 : 6;
      for (let pass = 0; pass < 4; pass++) {
        const src = ys.slice();
        for (let k = 0; k < n; k++) {
          let sum = 0;
          let cnt = 0;
          for (let q = Math.max(0, k - win); q <= Math.min(n - 1, k + win); q++) {
            sum += src[q];
            cnt++;
          }
          ys[k] = sum / cnt;
        }
      }
      // Pin the ends to whatever they join (city grid or another road).
      const y0 = this.joinY(xs[0], zs[0], road);
      const y1 = this.joinY(xs[n - 1], zs[n - 1], road);
      const d0 = y0 === null ? 0 : y0 - ys[0];
      const d1 = y1 === null ? 0 : y1 - ys[n - 1];
      for (let k = 0; k < n; k++) {
        const t = ss[k] / Math.max(1, s);
        ys[k] += d0 * Math.max(0, 1 - t * 6) + d1 * Math.max(0, 1 - (1 - t) * 6);
        ys[k] = Math.max(ys[k], 2.4);
      }
    }
    return { road, xs, zs, ys, ss, length: s };
  }

  /** Height a road end should meet: the city level inside the city, else another road. */
  private joinY(x: number, z: number, road: RoadDef): number | null {
    if (x >= CITY.minX - 100 && x <= CITY.maxX + 120 && z >= CITY.minZ - 500 && z <= CITY.maxZ + 30) return this.gridStreetY(x, z);
    for (const p of this.roads) {
      if (p.road === road) continue;
      for (let k = 0; k < p.xs.length; k++) {
        if (Math.abs(p.xs[k] - x) < 14 && Math.abs(p.zs[k] - z) < 14) return p.ys[k];
      }
    }
    return null;
  }

  /** City streets: flat on the city ground, graded across the Palm Heights hills. */
  gridStreetY(x: number, z: number): number {
    if (z >= CITY.minZ + 40) return CITY_Y;
    // Between Palm Street (-1650) and Hillcrest Road (-2100): straight grades.
    const hz = this.cornerY(x, -2100);
    const t = clamp((z + 1650) / (-2100 + 1650), 0, 1);
    return CITY_Y + (hz - CITY_Y) * t;
  }

  private cornerCache = new Map<number, number>();
  private cornerY(x: number, z: number): number {
    const key = Math.round(x) * 10000 + Math.round(z);
    let y = this.cornerCache.get(key);
    if (y === undefined) {
      // Average the natural ground around the corner, kept within a sensible range.
      let sum = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) sum += this.rawHeight(x + a * 30, z + b * 30);
      y = clamp(sum / 25, CITY_Y, CITY_Y + 40);
      this.cornerCache.set(key, y);
    }
    return y;
  }

  private carveRoads(): void {
    const n = this.nx * this.nz;
    const bestW = new Float32Array(n);
    const target = new Float32Array(n);
    const surf = new Uint8Array(n);
    for (const p of this.roads) {
      const hw = p.road.width / 2;
      const flat = hw + (p.road.grid ? 6 : 4);
      const blend = p.road.grid ? 18 : 34;
      for (let k = 0; k < p.xs.length - 1; k++) {
        const ax = p.xs[k];
        const az = p.zs[k];
        const bx = p.xs[k + 1];
        const bz = p.zs[k + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const L2 = dx * dx + dz * dz || 1;
        const r = flat + blend;
        this.forCells(Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r, (idx, x, z) => {
          let t = ((x - ax) * dx + (z - az) * dz) / L2;
          t = clamp(t, 0, 1);
          const px = ax + dx * t;
          const pz = az + dz * t;
          const dist = Math.hypot(x - px, z - pz);
          const w = dist <= flat ? 1 : 1 - smoothstep(0, blend, dist - flat);
          if (w > bestW[idx]) {
            bestW[idx] = w;
            target[idx] = p.ys[k] + (p.ys[k + 1] - p.ys[k]) * t - (dist <= hw ? 0.05 : 0);
            surf[idx] = dist <= hw + 1 ? (p.road.kind === 'dirt' ? Surface.Dirt : Surface.Shoulder) : Surface.Natural;
          }
        });
      }
    }
    for (let i = 0; i < n; i++) {
      const w = bestW[i];
      if (w > 0) {
        this.heights[i] += (target[i] - this.heights[i]) * w;
        if (surf[i]) this.surface[i] = surf[i];
      }
    }
  }

  private flattenLots(): void {
    for (const l of this.lots) {
      const cx = (l.x0 + l.x1) / 2;
      const cz = (l.z0 + l.z1) / 2;
      const y = townY(l) ?? this.gridStreetY(cx, l.front === 'N' ? l.z0 : l.front === 'S' ? l.z1 : cz);
      const fy = Math.round((y + 0.25) * 10) / 10;
      this.lotY.set(l.id, fy);
      const blend = 14;
      const green = l.district === 'heights' || l.district === 'oldtown' || l.district === 'beach' || l.district === 'north';
      this.forCells(l.x0 - blend, l.x1 + blend, l.z0 - blend, l.z1 + blend, (idx, x, z) => {
        const dx = Math.max(l.x0 - x, 0, x - l.x1);
        const dz = Math.max(l.z0 - z, 0, z - l.z1);
        const dd = Math.hypot(dx, dz);
        const w = 1 - smoothstep(0, blend, dd);
        if (w <= 0) return;
        this.heights[idx] += (fy - this.heights[idx]) * w;
        if (w > 0.99) this.surface[idx] = green ? Surface.Lawn : l.district === 'desert' ? Surface.Dirt : Surface.Pavement;
      });
    }
  }

  /** Height straight from the grid (before levelling is finished, for profiles). */
  private rawHeight(x: number, z: number): number {
    return this.heightAt(x, z);
  }

  /** Ground height anywhere (bilinear). Off the grid it's open sea floor. */
  heightAt(x: number, z: number): number {
    const fx = (x - DOMAIN.minX) / CELL;
    const fz = (z - DOMAIN.minZ) / CELL;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return -60;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * this.nx + i;
    const h = this.heights;
    const a = h[k] + (h[k + 1] - h[k]) * tx;
    const b = h[k + this.nx] + (h[k + this.nx + 1] - h[k + this.nx]) * tx;
    return a + (b - a) * tz;
  }

  /** Ground normal's y component (1 = flat): how steep the slope is. */
  slopeAt(x: number, z: number): number {
    const e = CELL;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return 1 / Math.hypot(dx / (2 * e), 1, dz / (2 * e));
  }

  surfaceAt(x: number, z: number): Surface {
    const i = Math.round((x - DOMAIN.minX) / CELL);
    const j = Math.round((z - DOMAIN.minZ) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return Surface.Natural;
    return this.surface[j * this.nx + i] as Surface;
  }

  isLand(x: number, z: number): boolean {
    return this.heightAt(x, z) > 0.3;
  }

  /** Nearest point on any road: distance and the road's height there. */
  nearestRoad(x: number, z: number, maxDist = 60): { dist: number; y: number; profile: RoadProfile; index: number } | null {
    let best: { dist: number; y: number; profile: RoadProfile; index: number } | null = null;
    for (const p of this.roads) {
      for (let k = 0; k < p.xs.length; k++) {
        const dd = Math.abs(p.xs[k] - x) + Math.abs(p.zs[k] - z);
        if (dd > maxDist * 1.5) continue;
        const d = Math.hypot(p.xs[k] - x, p.zs[k] - z);
        if (d < maxDist && (!best || d < best.dist)) best = { dist: d, y: p.ys[k], profile: p, index: k };
      }
    }
    return best;
  }
}
