import * as THREE from 'three';
import { GRID_X, GRID_Z, ROAD_WIDTH, SIDEWALK, cityBlocks, type RoadKind } from './layout';
import type { RoadProfile, Terrain } from './terrain';

/**
 * Road surfaces: ribbons draped along every road profile, cut into short pieces so the
 * far ones can be culled, all sharing one texture atlas (lane markings for each road
 * type, plain asphalt for junctions, zebra crossings and sidewalk paving). One material,
 * a handful of draw calls.
 */

// Atlas columns (u ranges). v repeats every ATLAS_V metres along the road.
const STRIPS: Record<RoadKind | 'plain' | 'zebra' | 'paving', [number, number]> = {
  highway: [0.0, 0.18],
  boulevard: [0.2, 0.42],
  street: [0.44, 0.56],
  road: [0.58, 0.68],
  dirt: [0.7, 0.76],
  plain: [0.78, 0.84],
  zebra: [0.86, 0.92],
  paving: [0.94, 1.0],
};
const ATLAS_V = 24;

function atlasTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const asphalt = (x0: number, x1: number, base = '#4a4b50') => {
    g.fillStyle = base;
    g.fillRect(x0, 0, x1 - x0, H);
    // Speckle so it reads as tarmac up close.
    for (let i = 0; i < (x1 - x0) * 10; i++) {
      const v = 60 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
      g.fillRect(x0 + Math.random() * (x1 - x0), Math.random() * H, 1.5, 1.5);
    }
  };
  const px = (u: number) => Math.round(u * W);
  const line = (u: number, width: number, color: string, dash = 0) => {
    g.fillStyle = color;
    const x = px(u) - width / 2;
    if (!dash) g.fillRect(x, 0, width, H);
    else for (let y = 0; y < H; y += dash * 2) g.fillRect(x, y, width, dash);
  };
  // Highway: 4 lanes, solid edges, dashed lane lines, double yellow middle.
  let [a, b] = STRIPS.highway;
  asphalt(px(a), px(b));
  const hw = (t: number) => a + (b - a) * t;
  line(hw(0.04), 3, '#f2f2f2');
  line(hw(0.96), 3, '#f2f2f2');
  line(hw(0.27), 2.5, '#e8e8e8', 32);
  line(hw(0.73), 2.5, '#e8e8e8', 32);
  line(hw(0.485), 2.5, '#f5c518');
  line(hw(0.515), 2.5, '#f5c518');
  // Boulevard (the Strip): 3 lanes each way and a central median edge.
  [a, b] = STRIPS.boulevard;
  asphalt(px(a), px(b), '#45464b');
  const bl = (t: number) => a + (b - a) * t;
  line(bl(0.03), 3, '#f2f2f2');
  line(bl(0.97), 3, '#f2f2f2');
  for (const t of [0.16, 0.3, 0.7, 0.84]) line(bl(t), 2.5, '#e8e8e8', 24);
  line(bl(0.43), 3, '#f5c518');
  line(bl(0.57), 3, '#f5c518');
  g.fillStyle = '#c9c4b8';
  g.fillRect(px(bl(0.44)), 0, px(bl(0.56)) - px(bl(0.44)), H);
  // Street: two lanes and parking strips.
  [a, b] = STRIPS.street;
  asphalt(px(a), px(b));
  const st = (t: number) => a + (b - a) * t;
  line(st(0.5), 2.5, '#f5c518', 20);
  line(st(0.2), 2, '#e8e8e8');
  line(st(0.8), 2, '#e8e8e8');
  // Country road.
  [a, b] = STRIPS.road;
  asphalt(px(a), px(b), '#55565a');
  const rd = (t: number) => a + (b - a) * t;
  line(rd(0.5), 2.5, '#f5c518', 26);
  line(rd(0.06), 2, '#dcdcdc');
  line(rd(0.94), 2, '#dcdcdc');
  // Dirt track.
  [a, b] = STRIPS.dirt;
  g.fillStyle = '#a27a52';
  g.fillRect(px(a), 0, px(b) - px(a), H);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(80,55,30,0.35)' : 'rgba(210,180,130,0.35)';
    g.fillRect(px(a) + Math.random() * (px(b) - px(a)), Math.random() * H, 2, 2);
  }
  // Plain asphalt for junctions.
  [a, b] = STRIPS.plain;
  asphalt(px(a), px(b));
  // Zebra crossing.
  [a, b] = STRIPS.zebra;
  asphalt(px(a), px(b));
  g.fillStyle = '#f0f0f0';
  for (let y = 0; y < H; y += 32) g.fillRect(px(a) + 4, y + 4, px(b) - px(a) - 8, 16);
  // Sidewalk paving: square slabs.
  [a, b] = STRIPS.paving;
  g.fillStyle = '#c8c3b8';
  g.fillRect(px(a), 0, px(b) - px(a), H);
  g.strokeStyle = 'rgba(90,85,80,0.35)';
  g.lineWidth = 1.5;
  for (let y = 0; y < H; y += 21) {
    g.beginPath();
    g.moveTo(px(a), y);
    g.lineTo(px(b), y);
    g.stroke();
  }
  g.beginPath();
  g.moveTo((px(a) + px(b)) / 2, 0);
  g.lineTo((px(a) + px(b)) / 2, H);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, u: number, vv: number, nx = 0, ny = 1, nz = 0, c = 1): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, vv);
    this.col.push(c, c, c);
    return this.count - 1;
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export class RoadMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private pieces: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];

  constructor(private t: Terrain) {
    this.material = new THREE.MeshLambertMaterial({
      map: atlasTexture(),
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    for (const p of t.roads) {
      if (p.road.grid) continue;
      this.ribbon(p);
    }
    this.cityGrid();
  }

  private addPiece(b: GeoBuilder): void {
    const g = b.build();
    if (!g) return;
    const m = new THREE.Mesh(g, this.material);
    m.matrixAutoUpdate = false;
    m.receiveShadow = true;
    const s = g.boundingSphere!;
    this.group.add(m);
    this.pieces.push({ mesh: m, x: s.center.x, z: s.center.z, r: s.radius });
  }

  /** A highway or road: ribbon along the profile, in pieces of ~300 m. */
  private ribbon(p: RoadProfile): void {
    const kind = p.road.kind;
    const [u0, u1] = STRIPS[kind];
    const hw = p.road.width / 2;
    const n = p.xs.length;
    let b = new GeoBuilder();
    let prevL = -1;
    let prevR = -1;
    const pad = 0.004;
    for (let k = 0; k < n; k++) {
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(n - 1, k + 1);
      let tx = p.xs[k1] - p.xs[k0];
      let tz = p.zs[k1] - p.zs[k0];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Left of travel direction.
      const lx = tz;
      const lz = -tx;
      const y = p.ys[k] + 0.12;
      const v = p.ss[k] / ATLAS_V;
      const L = b.v(p.xs[k] + lx * hw, y, p.zs[k] + lz * hw, u0 + pad, v);
      const R = b.v(p.xs[k] - lx * hw, y, p.zs[k] - lz * hw, u1 - pad, v);
      if (prevL >= 0) b.quad(prevL, prevR, R, L);
      prevL = L;
      prevR = R;
      if (b.count > 120 && k < n - 1) {
        this.addPiece(b);
        b = new GeoBuilder();
        prevL = b.v(p.xs[k] + lx * hw, y, p.zs[k] + lz * hw, u0 + pad, v);
        prevR = b.v(p.xs[k] - lx * hw, y, p.zs[k] - lz * hw, u1 - pad, v);
      }
    }
    this.addPiece(b);
  }

  /** City streets between junctions, junction squares, zebra crossings and sidewalks. */
  private cityGrid(): void {
    const t = this.t;
    const pad = 0.004;
    // Group the city by quarter so each quarter is one mesh.
    const builders = new Map<string, GeoBuilder>();
    const get = (x: number, z: number) => {
      const key = `${Math.floor(x / 600)}:${Math.floor(z / 600)}`;
      let b = builders.get(key);
      if (!b) builders.set(key, (b = new GeoBuilder()));
      return b;
    };
    const wX = (x: number) => (x === 2600 ? ROAD_WIDTH.boulevard : ROAD_WIDTH.street);
    const wZ = (z: number) => (z === -300 ? ROAD_WIDTH.boulevard : ROAD_WIDTH.street);
    const y = (x: number, z: number) => t.gridStreetY(x, z) + 0.06;
    const flatStrip = (b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, strip: [number, number], alongZ: boolean, lift = 0) => {
      // A straight strip from (x0,z0) to (x1,z1) (axis aligned), sampled every 20 m so it
      // follows the grade in the hills.
      const len = alongZ ? z1 - z0 : x1 - x0;
      const n = Math.max(1, Math.ceil(len / 20));
      let pL = -1;
      let pR = -1;
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        if (alongZ) {
          const z = z0 + len * f;
          const yy = y((x0 + x1) / 2, z) + lift;
          const L = b.v(x0, yy, z, strip[0] + pad, z / ATLAS_V);
          const R = b.v(x1, yy, z, strip[1] - pad, z / ATLAS_V);
          if (pL >= 0) b.quad(pL, L, R, pR);
          pL = L;
          pR = R;
        } else {
          const x = x0 + len * f;
          const yy = y(x, (z0 + z1) / 2) + lift;
          const L = b.v(x, yy, z0, strip[1] - pad, x / ATLAS_V);
          const R = b.v(x, yy, z1, strip[0] + pad, x / ATLAS_V);
          if (pL >= 0) b.quad(pL, pR, R, L);
          pL = L;
          pR = R;
        }
      }
    };
    const zMax = GRID_Z[GRID_Z.length - 1];
    for (const x of GRID_X) {
      const hw = wX(x) / 2;
      const zs = GRID_Z.filter((z) => z >= (x === 3450 ? -1650 : GRID_Z[0]) && z <= zMax);
      for (let i = 0; i < zs.length - 1; i++) {
        const za = zs[i] + wZ(zs[i]) / 2;
        const zb = zs[i + 1] - wZ(zs[i + 1]) / 2;
        const kind: RoadKind = x === 2600 ? 'boulevard' : 'street';
        const b = get(x, (za + zb) / 2);
        // Zebra crossings at both ends, lane markings between.
        flatStrip(b, x - hw, za, x + hw, za + 4, STRIPS.zebra, true);
        flatStrip(b, x - hw, za + 4, x + hw, zb - 4, STRIPS[kind], true);
        flatStrip(b, x - hw, zb - 4, x + hw, zb, STRIPS.zebra, true);
      }
    }
    for (const z of GRID_Z) {
      const hw = wZ(z) / 2;
      const xs = GRID_X.filter((x) => x <= (z === -2100 ? 3050 : 3450));
      for (let i = 0; i < xs.length - 1; i++) {
        const xa = xs[i] + wX(xs[i]) / 2;
        const xb = xs[i + 1] - wX(xs[i + 1]) / 2;
        const kind: RoadKind = z === -300 ? 'boulevard' : 'street';
        const b = get((xa + xb) / 2, z);
        flatStrip(b, xa, z - hw, xa + 4, z + hw, STRIPS.zebra, false);
        flatStrip(b, xa + 4, z - hw, xb - 4, z + hw, STRIPS[kind], false);
        flatStrip(b, xb - 4, z - hw, xb, z + hw, STRIPS.zebra, false);
      }
      // Junction squares.
      for (const x of xs) {
        if (x === 3450 && z === -2100) continue;
        const b = get(x, z);
        const hx = wX(x) / 2;
        flatStrip(b, x - hx, z - hw, x + hx, z + hw, STRIPS.plain, true, 0.005);
      }
    }
    // Sidewalks round every block: a raised paved ring with a curb face.
    for (const blk of cityBlocks()) {
      const b = get((blk.x0 + blk.x1) / 2, (blk.z0 + blk.z1) / 2);
      const s = SIDEWALK;
      const lift = 0.16;
      this.sidewalkEdge(b, blk.x0, blk.z0, blk.x1, blk.z0 + s, true, lift);
      this.sidewalkEdge(b, blk.x0, blk.z1 - s, blk.x1, blk.z1, true, lift);
      this.sidewalkEdge(b, blk.x0, blk.z0 + s, blk.x0 + s, blk.z1 - s, false, lift);
      this.sidewalkEdge(b, blk.x1 - s, blk.z0 + s, blk.x1, blk.z1 - s, false, lift);
    }
    for (const b of builders.values()) this.addPiece(b);
  }

  private sidewalkEdge(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, alongX: boolean, lift: number): void {
    const t = this.t;
    const [u0, u1] = STRIPS.paving;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.ceil(len / 20));
    let p: number[] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = alongX ? x0 + len * f : (x0 + x1) / 2;
      const z = alongX ? (z0 + z1) / 2 : z0 + len * f;
      const yy = t.gridStreetY(x, z) + 0.06 + lift;
      const along = (alongX ? x : z) / ATLAS_V;
      let q: number[];
      if (alongX) {
        q = [b.v(x, yy, z0, u0, along), b.v(x, yy, z1, u1, along)];
        // Curb faces on both long sides.
        const c1 = b.v(x, yy, z0, u0, along, 0, 0, -1, 0.85);
        const c2 = b.v(x, yy - lift - 0.1, z0, u0, along, 0, 0, -1, 0.7);
        const c3 = b.v(x, yy, z1, u1, along, 0, 0, 1, 0.85);
        const c4 = b.v(x, yy - lift - 0.1, z1, u1, along, 0, 0, 1, 0.7);
        q.push(c1, c2, c3, c4);
      } else {
        q = [b.v(x1, yy, z, u1, along), b.v(x0, yy, z, u0, along)];
        const c1 = b.v(x1, yy, z, u1, along, 1, 0, 0, 0.85);
        const c2 = b.v(x1, yy - lift - 0.1, z, u1, along, 1, 0, 0, 0.7);
        const c3 = b.v(x0, yy, z, u0, along, -1, 0, 0, 0.85);
        const c4 = b.v(x0, yy - lift - 0.1, z, u0, along, -1, 0, 0, 0.7);
        q.push(c1, c2, c3, c4);
      }
      if (p.length) {
        b.quad(p[0], p[1], q[1], q[0]);
        b.quad(p[2], q[2], q[3], p[3]);
        b.quad(p[4], p[5], q[5], q[4]);
      }
      p = q;
    }
  }

  /** Hide pieces beyond the draw distance. */
  update(camX: number, camZ: number, maxDist: number): void {
    for (const p of this.pieces) {
      const d = Math.hypot(p.x - camX, p.z - camZ) - p.r;
      p.mesh.visible = d < maxDist;
    }
  }
}
