import * as THREE from 'three';
import { Kit } from '../render/kit';
import { hash2, mulberry32, noise2 } from '../core/noise';
import { CITY, DOMAIN, GRID_X, GRID_Z, LANDMARKS, OLD_TOWN, cityBlocks } from './layout';
import { Surface, type Terrain } from './terrain';
import type { Collision } from './collision';
import { VCOL, withRim } from '../render/materials';

/**
 * Trees, palms, bushes and rocks. Every plant on the island is a record in a coarse grid;
 * two instanced meshes per kind draw them: a detailed one for the plants near you and a
 * very low-poly one out to the haze. The instance lists are refilled as you move, so the
 * whole island's greenery costs about ten draw calls.
 */

export const TreeKind = { Palm: 0, Broadleaf: 1, Bush: 2, Rock: 3, Pine: 4, Flower: 5 } as const;
export type TreeKind = (typeof TreeKind)[keyof typeof TreeKind];
const KINDS = 6;

interface Plant {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  tint: number;
}

const GRID = 100;

function palmGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  const trunkCol = 0x9a6b42;
  const h = 9;
  const segs = lod ? 2 : 7;
  // A gently curved trunk, built from tapered rings.
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const bend = (t: number) => t * t * 1.4;
    const x0 = bend(t0);
    const x1 = bend(t1);
    const len = Math.hypot(x1 - x0, (t1 - t0) * h);
    const ang = Math.atan2(x1 - x0, (t1 - t0) * h);
    k.cyl(0.28 - t1 * 0.12, 0.3 - t0 * 0.12, len, i % 2 ? trunkCol : 0x8a5d38, { x: (x0 + x1) / 2, y: ((t0 + t1) / 2) * h, rz: -ang }, 'matte', lod ? 5 : 8);
  }
  const top = { x: 1.4, y: h };
  // Fronds: arched, tapered leaves with a crease.
  const fronds = lod ? 5 : 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.2;
    const leaf = new THREE.BufferGeometry();
    const pts: number[] = [];
    const n = lod ? 2 : 5;
    const L = 4.2;
    const prev: number[][] = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const w = Math.sin(t * Math.PI) * 0.75 + 0.05;
      const droop = -t * t * 2.4 + t * 0.9;
      prev.push([t * L, droop, w, 0.18 * (1 - t)]);
    }
    for (let s = 0; s < n; s++) {
      const [x0, y0, w0, c0] = prev[s];
      const [x1, y1, w1, c1] = prev[s + 1];
      // Two halves meeting at a raised spine.
      pts.push(x0, y0 + c0, 0, x1, y1 + c1, 0, x1, y1, w1);
      pts.push(x0, y0 + c0, 0, x1, y1, w1, x0, y0, w0);
      pts.push(x0, y0 + c0, 0, x1, y1, -w1, x1, y1 + c1, 0);
      pts.push(x0, y0 + c0, 0, x0, y0, -w0, x1, y1, -w1);
    }
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    leaf.computeVertexNormals();
    k.add(leaf, i % 2 ? 0x3fae3a : 0x58c447, { x: top.x, y: top.y, ry: a, rz: 0.12 });
  }
  if (!lod) for (let i = 0; i < 3; i++) k.sphere(0.22, 0x6b4a2a, { x: top.x + Math.cos(i * 2.1) * 0.3, y: top.y - 0.25, z: Math.sin(i * 2.1) * 0.3 }, 'matte', 6, 4);
  return mergeSlots(k);
}

function broadleafGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.32, 0.5, 4.2, 0x7a5232, { y: 2.1 }, 'matte', lod ? 5 : 8);
  if (!lod) {
    k.cyl(0.14, 0.2, 2.2, 0x7a5232, { x: 0.7, y: 4.0, rz: -0.7 }, 'matte', 6);
    k.cyl(0.14, 0.2, 2.2, 0x7a5232, { x: -0.6, y: 4.0, z: 0.3, rz: 0.7 }, 'matte', 6);
  }
  const blob = (r: number, x: number, y: number, z: number, c: number) => {
    const g = new THREE.IcosahedronGeometry(r, lod ? 0 : 1);
    // Lumpy: push vertices in and out a little.
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i);
      const vy = p.getY(i);
      const vz = p.getZ(i);
      const n = 1 + 0.12 * Math.sin(vx * 3.1 + vy * 2.3) * Math.cos(vz * 2.7);
      p.setXYZ(i, vx * n, vy * n * 0.85, vz * n);
    }
    k.add(g, c, { x, y, z });
  };
  blob(2.6, 0, 6.2, 0, 0x4caa3e);
  blob(2.0, 1.6, 5.4, 0.6, 0x5cba44);
  blob(1.9, -1.5, 5.6, -0.4, 0x429a38);
  if (!lod) blob(1.6, 0.2, 7.6, -0.8, 0x6cc84e);
  return mergeSlots(k);
}

function bushGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  const g1 = new THREE.IcosahedronGeometry(1, lod ? 0 : 1);
  k.add(g1, 0x4fa83c, { y: 0.6, sx: 1.2, sy: 0.8, sz: 1.1 });
  if (!lod) {
    k.add(new THREE.IcosahedronGeometry(0.75, 1), 0x63bd48, { x: 0.8, y: 0.5, z: 0.2 });
    k.add(new THREE.IcosahedronGeometry(0.6, 0), 0x3f9a34, { x: -0.7, y: 0.45, z: -0.3 });
  }
  return mergeSlots(k);
}

function rockGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const n = 0.8 + 0.4 * Math.abs(Math.sin(p.getX(i) * 4 + p.getZ(i) * 3));
    p.setXYZ(i, p.getX(i) * n * 1.3, p.getY(i) * n * 0.75, p.getZ(i) * n);
  }
  k.add(g, 0x8f857a, { y: 0.3 });
  if (!lod) k.add(new THREE.DodecahedronGeometry(0.5, 0), 0x7a7067, { x: 0.9, y: 0.15, z: 0.4 });
  return mergeSlots(k, true);
}

function pineGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.2, 0.32, 3, 0x6a4a30, { y: 1.5 }, 'matte', 6);
  const tiers = lod ? 2 : 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    k.cone(2.4 - t * 1.6, 3.2, i % 2 ? 0x2f7a3a : 0x3a8a44, { y: 3 + t * 5.5 + 1.2 }, 'matte', lod ? 6 : 9);
  }
  return mergeSlots(k);
}

function flowerGeometry(lod: number): THREE.BufferGeometry {
  const k = new Kit();
  k.add(new THREE.IcosahedronGeometry(0.55, 0), 0x4fa83c, { y: 0.35, sy: 0.6 });
  if (!lod) {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26;
      k.sphere(0.14, [0xff5a8a, 0xffd23d, 0xff8a3d, 0xffffff, 0xc86bff][i], { x: Math.cos(a) * 0.35, y: 0.62, z: Math.sin(a) * 0.35 }, 'matte', 5, 4);
    }
  }
  return mergeSlots(k);
}

function mergeSlots(k: Kit, flat = false): THREE.BufferGeometry {
  const g = k.bakeGeometries();
  const geo = g.matte!;
  if (flat) {
    geo.computeVertexNormals();
  }
  return geo;
}

const BUILDERS: ((lod: number) => THREE.BufferGeometry)[] = [palmGeometry, broadleafGeometry, bushGeometry, rockGeometry, pineGeometry, flowerGeometry];

export class Vegetation {
  readonly group = new THREE.Group();
  private grid = new Map<number, Plant[]>();
  private near: THREE.InstancedMesh[] = [];
  private far: THREE.InstancedMesh[] = [];
  private lastNear = new THREE.Vector2(1e9, 1e9);
  private lastFar = new THREE.Vector2(1e9, 1e9);
  nearRadius = 260;
  farRadius = 1500;
  count = 0;

  constructor(private terrain: Terrain, private collision: Collision, private density = 1) {
    this.scatter();
    this.cityTrees();
    const mat = withRim(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.7);
    for (let kind = 0; kind < KINDS; kind++) {
      const nearCap = [2500, 4000, 3000, 1500, 1500, 1500][kind];
      const farCap = [12000, 22000, 9000, 4000, 6000, 1][kind];
      const hi = new THREE.InstancedMesh(BUILDERS[kind](0), kind === 3 ? VCOL : mat, nearCap);
      const lo = new THREE.InstancedMesh(BUILDERS[kind](1), kind === 3 ? VCOL : mat, farCap);
      for (const m of [hi, lo]) {
        m.count = 0;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
        this.group.add(m);
      }
      hi.castShadow = true;
      hi.receiveShadow = true;
      this.near.push(hi);
      this.far.push(lo);
    }
  }

  private add(p: Plant): void {
    const k = Math.floor((p.x - DOMAIN.minX) / GRID) * 1000 + Math.floor((p.z - DOMAIN.minZ) / GRID);
    let arr = this.grid.get(k);
    if (!arr) this.grid.set(k, (arr = []));
    arr.push(p);
    this.count++;
    if (p.kind === TreeKind.Palm || p.kind === TreeKind.Broadleaf || p.kind === TreeKind.Pine) {
      this.collision.addCircle({ x: p.x, z: p.z, r: 0.45 * p.s, minY: p.y - 1, maxY: p.y + 8 * p.s, tag: 'tree' });
    } else if (p.kind === TreeKind.Rock && p.s > 1.2) {
      this.collision.addCircle({ x: p.x, z: p.z, r: 1.1 * p.s, minY: p.y - 1, maxY: p.y + 1.2 * p.s, tag: 'rock' });
    }
  }

  private inCleared(x: number, z: number): boolean {
    const b = LANDMARKS.base;
    if (x > CITY.minX - 30 && x < CITY.maxX + 10 && z > CITY.minZ - 420 && z < CITY.maxZ + 30) return true;
    if (Math.abs(x - b.x) < b.w / 2 + 40 && Math.abs(z - b.z) < b.d / 2 + 40) return true;
    if (x > OLD_TOWN.x0 - 70 && x < OLD_TOWN.x1 + 70 && Math.abs(z - OLD_TOWN.z) < 95) return true;
    const v = LANDMARKS.volcano;
    if (Math.hypot(x - v.x, z - v.z) < 260) return true;
    const lh = LANDMARKS.lighthouse;
    if (Math.hypot(x - lh.x, z - lh.z) < 60) return true;
    return false;
  }

  private scatter(): void {
    const t = this.terrain;
    const r = mulberry32(4242);
    const step = 11 / Math.sqrt(Math.max(0.2, this.density));
    for (let z = DOMAIN.minZ; z < DOMAIN.maxZ; z += step) {
      for (let x = DOMAIN.minX; x < DOMAIN.maxX; x += step) {
        const px = x + (r() - 0.5) * step;
        const pz = z + (r() - 0.5) * step;
        const h = t.heightAt(px, pz);
        if (h < 1.4) continue;
        const surf = t.surfaceAt(px, pz);
        if (surf !== Surface.Natural) continue;
        if (this.inCleared(px, pz)) continue;
        const slope = t.slopeAt(px, pz);
        if (slope < 0.62) {
          if (r() < 0.04) this.add({ kind: TreeKind.Rock, x: px, y: h, z: pz, rot: r() * 6.28, s: 1 + r() * 2.5, tint: r() });
          continue;
        }
        const forest = noise2(px / 420, pz / 420) * 0.5 + 0.5;
        const roll = r();
        let kind: TreeKind | -1 = -1;
        if (h < 9) {
          // Beach: palms in groves, a few bushes.
          if (roll < 0.06 + forest * 0.1) kind = TreeKind.Palm;
          else if (roll < 0.09 + forest * 0.1) kind = TreeKind.Bush;
        } else if (h < 260) {
          // Lowland to jungle: denser with height and in "forest" patches.
          const dens = 0.03 + Math.max(0, forest - 0.35) * 0.55 + Math.min(0.2, (h - 9) / 600);
          if (roll < dens * 0.7) kind = h > 60 && r() < 0.15 ? TreeKind.Palm : TreeKind.Broadleaf;
          else if (roll < dens * 0.7 + 0.025) kind = TreeKind.Bush;
          else if (roll < dens * 0.7 + 0.03) kind = h < 80 ? TreeKind.Flower : TreeKind.Rock;
          else if (roll < dens * 0.7 + 0.036 && h < 60) kind = TreeKind.Palm;
        } else if (h < 430) {
          if (roll < 0.06 + forest * 0.06) kind = TreeKind.Pine;
          else if (roll < 0.1) kind = TreeKind.Rock;
        } else if (roll < 0.03) kind = TreeKind.Rock;
        if (kind === -1) continue;
        const s = kind === TreeKind.Rock ? 0.6 + r() * 1.8 : 0.75 + r() * 0.6;
        this.add({ kind, x: px, y: h - 0.1, z: pz, rot: r() * 6.28, s, tint: r() });
      }
    }
  }

  /** Palms down the Strip's median and along the boulevards; trees on residential streets. */
  private cityTrees(): void {
    const t = this.terrain;
    const r = mulberry32(99);
    // The Strip median (x = 2600) and Interstate 15 boulevard median (z = -300).
    for (let z = GRID_Z[0]; z <= GRID_Z[GRID_Z.length - 1]; z += 22) {
      if (GRID_Z.some((gz) => Math.abs(gz - z) < 16)) continue;
      this.add({ kind: TreeKind.Palm, x: 2600, y: t.gridStreetY(2600, z) + 0.2, z, rot: r() * 6.28, s: 1.05 + r() * 0.25, tint: r() });
    }
    for (let x = GRID_X[0]; x <= 3450; x += 22) {
      if (GRID_X.some((gx) => Math.abs(gx - x) < 16)) continue;
      this.add({ kind: TreeKind.Palm, x, y: t.gridStreetY(x, -300) + 0.2, z: -300, rot: r() * 6.28, s: 1.05 + r() * 0.25, tint: r() });
    }
    // Sidewalk trees round each block (palms near the beach and the Strip, leafy trees elsewhere).
    for (const b of cityBlocks()) {
      const palm = b.district === 'strip' || b.district === 'beach';
      const spacing = palm ? 26 : 30;
      const kind = palm ? TreeKind.Palm : b.district === 'harbor' ? -1 : TreeKind.Broadleaf;
      if (kind === -1) continue;
      const inset = 1.6;
      const edges: [number, number, number, number][] = [
        [b.x0 + 8, b.z0 + inset, b.x1 - 8, b.z0 + inset],
        [b.x0 + 8, b.z1 - inset, b.x1 - 8, b.z1 - inset],
        [b.x0 + inset, b.z0 + 8, b.x0 + inset, b.z1 - 8],
        [b.x1 - inset, b.z0 + 8, b.x1 - inset, b.z1 - 8],
      ];
      for (const [ax, az, bx, bz] of edges) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.floor(len / spacing);
        for (let i = 0; i <= n; i++) {
          const f = n ? i / n : 0.5;
          const x = ax + (bx - ax) * f;
          const z = az + (bz - az) * f;
          if (hash2(Math.round(x), Math.round(z), 3) < 0.25) continue;
          this.add({ kind, x, y: t.gridStreetY(x, z) + 0.22, z, rot: r() * 6.28, s: palm ? 0.95 + r() * 0.3 : 0.6 + r() * 0.2, tint: r() });
        }
      }
    }
  }

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _c = new THREE.Color();
  private _up = new THREE.Vector3(0, 1, 0);

  private fill(meshes: THREE.InstancedMesh[], cx: number, cz: number, r0: number, r1: number): void {
    const counts = new Array(KINDS).fill(0);
    const gi0 = Math.floor((cx - r1 - DOMAIN.minX) / GRID);
    const gi1 = Math.floor((cx + r1 - DOMAIN.minX) / GRID);
    const gj0 = Math.floor((cz - r1 - DOMAIN.minZ) / GRID);
    const gj1 = Math.floor((cz + r1 - DOMAIN.minZ) / GRID);
    const r02 = r0 * r0;
    const r12 = r1 * r1;
    for (let gi = gi0; gi <= gi1; gi++) {
      for (let gj = gj0; gj <= gj1; gj++) {
        const arr = this.grid.get(gi * 1000 + gj);
        if (!arr) continue;
        for (const p of arr) {
          const dx = p.x - cx;
          const dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r02 || d2 > r12) continue;
          // Small things aren't worth drawing far away.
          if (r0 > 0 && (p.kind === TreeKind.Flower || (p.kind === TreeKind.Bush && d2 > 700 * 700) || (p.kind === TreeKind.Rock && p.s < 1.2))) continue;
          const m = meshes[p.kind];
          const i = counts[p.kind];
          if (i >= m.instanceMatrix.count) continue;
          this._q.setFromAxisAngle(this._up, p.rot);
          this._p.set(p.x, p.y, p.z);
          this._s.setScalar(p.s);
          this._m.compose(this._p, this._q, this._s);
          m.setMatrixAt(i, this._m);
          const v = 0.82 + p.tint * 0.32;
          this._c.setRGB(v * (0.95 + p.tint * 0.1), v, v * (1.05 - p.tint * 0.15));
          m.setColorAt(i, this._c);
          counts[p.kind] = i + 1;
        }
      }
    }
    for (let k = 0; k < KINDS; k++) {
      meshes[k].count = counts[k];
      meshes[k].instanceMatrix.needsUpdate = true;
      if (meshes[k].instanceColor) meshes[k].instanceColor!.needsUpdate = true;
    }
  }

  update(camX: number, camZ: number, farRadius: number): void {
    this.farRadius = farRadius;
    if (Math.hypot(camX - this.lastNear.x, camZ - this.lastNear.y) > 30) {
      this.lastNear.set(camX, camZ);
      this.fill(this.near, camX, camZ, 0, this.nearRadius);
    }
    if (Math.hypot(camX - this.lastFar.x, camZ - this.lastFar.y) > 30 || this.lastFar.x > 1e8) {
      // The far ring starts where the near one ends, measured from the same centre.
      this.lastFar.set(this.lastNear.x, this.lastNear.y);
      this.fill(this.far, this.lastNear.x, this.lastNear.y, this.nearRadius, this.farRadius);
    }
  }
}
