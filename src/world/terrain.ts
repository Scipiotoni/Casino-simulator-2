import { fbm, noise2, ridged } from '../core/noise';
import { clamp, smoothstep } from '../core/math';
import { CITY, CITY_Y, DOMAIN, LANDMARKS, OLD_TOWN, allRoads, cityLots, type Lot, type RoadDef } from './layout';

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

/** Signed "distance" from the coast: < 1 on land, > 1 at sea (a warped ellipse). */
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
  d += 0.035 * noise2(x / 520 + 11, z / 520 - 4);
  return d;
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
  return [
    { x0: CITY.minX, x1: CITY.maxX, z0: CITY.minZ, z1: CITY.maxZ, y: CITY_Y, blend: 260, surface: Surface.Pavement },
    { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y: 14, blend: 220, surface: Surface.Dirt },
    { x0: OLD_TOWN.x0 - 60, x1: OLD_TOWN.x1 + 60, z0: OLD_TOWN.z - 90, z1: OLD_TOWN.z + 80, y: 4.5, blend: 120, surface: Surface.Lawn },
  ];
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
      const y = l.district === 'oldtown' ? 4.5 : this.gridStreetY(cx, l.front === 'N' ? l.z0 : l.front === 'S' ? l.z1 : cz);
      const fy = Math.round((y + 0.25) * 10) / 10;
      this.lotY.set(l.id, fy);
      const blend = 14;
      const green = l.district === 'heights' || l.district === 'oldtown' || l.district === 'beach';
      this.forCells(l.x0 - blend, l.x1 + blend, l.z0 - blend, l.z1 + blend, (idx, x, z) => {
        const dx = Math.max(l.x0 - x, 0, x - l.x1);
        const dz = Math.max(l.z0 - z, 0, z - l.z1);
        const dd = Math.hypot(dx, dz);
        const w = 1 - smoothstep(0, blend, dd);
        if (w <= 0) return;
        this.heights[idx] += (fy - this.heights[idx]) * w;
        if (w > 0.99) this.surface[idx] = green ? Surface.Lawn : Surface.Pavement;
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
