import * as THREE from 'three';
import { CELL, Surface, type Terrain } from './terrain';
import { DOMAIN } from './layout';
import { noise2 } from '../core/noise';
import { withRim } from '../render/materials';

/**
 * Draws the height field as 400 m chunks whose detail drops with distance (8 m cells near
 * you, up to 80 m far away). Skirts hang off every chunk's edges so neighbouring detail
 * levels never show cracks. Colours are baked per vertex (sand, grass, jungle, rock, ash)
 * and a tiling detail texture keeps close ground from looking flat.
 */

const CHUNK_CELLS = 50;
const CHUNK = CHUNK_CELLS * CELL;
const STEPS = [1, 2, 5, 10];

function detailTexture(): THREE.DataTexture {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Tileable: sample noise on a torus.
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      let v = 0;
      v += noise2(Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2) * 0.5;
      v += noise2(Math.cos(a) * 6 + 30, Math.sin(b) * 6 + Math.sin(a) * 3) * 0.3;
      v += (Math.random() - 0.5) * 0.25;
      const c = Math.max(0, Math.min(255, 228 + v * 40));
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const C = {
  sand: new THREE.Color(0xecd9a2),
  wetSand: new THREE.Color(0xc7ae78),
  seabed: new THREE.Color(0xd9cc94),
  grass: new THREE.Color(0x76c94a),
  grass2: new THREE.Color(0xa6d957),
  jungle: new THREE.Color(0x47a043),
  dirt: new THREE.Color(0xa77a4f),
  rock: new THREE.Color(0x8c7f74),
  darkRock: new THREE.Color(0x544843),
  ash: new THREE.Color(0x6e6560),
  lawn: new THREE.Color(0x77c35c),
  shoulder: new THREE.Color(0x9a958a),
  tarmac: new THREE.Color(0x45464c),
  pavement: new THREE.Color(0xc9c5bb),
  pavement2: new THREE.Color(0xb3afa5),
};

interface Chunk {
  ci: number;
  cj: number;
  cx: number;
  cz: number;
  minY: number;
  maxY: number;
  mesh: THREE.Mesh | null;
  lod: number;
  geos: (THREE.BufferGeometry | null)[];
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private chunks: Chunk[] = [];
  private detailScale = 1;
  shadows = false;

  constructor(private t: Terrain) {
    this.material = withRim(new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }), 0.25);
    const ncx = Math.floor((t.nx - 1) / CHUNK_CELLS);
    const ncz = Math.floor((t.nz - 1) / CHUNK_CELLS);
    for (let cj = 0; cj < ncz; cj++) {
      for (let ci = 0; ci < ncx; ci++) {
        let minY = Infinity;
        let maxY = -Infinity;
        for (let j = 0; j <= CHUNK_CELLS; j += 2) {
          for (let i = 0; i <= CHUNK_CELLS; i += 2) {
            const h = t.heights[(cj * CHUNK_CELLS + j) * t.nx + ci * CHUNK_CELLS + i];
            minY = Math.min(minY, h);
            maxY = Math.max(maxY, h);
          }
        }
        // Deep sea floor is never seen through the water: skip those chunks.
        if (maxY < -9) continue;
        this.chunks.push({
          ci, cj,
          cx: DOMAIN.minX + (ci + 0.5) * CHUNK,
          cz: DOMAIN.minZ + (cj + 0.5) * CHUNK,
          minY, maxY, mesh: null, lod: -1, geos: [null, null, null, null],
        });
      }
    }
  }

  /** 1 = full detail; lower values push the coarse levels closer (slow machines). */
  setDetail(d: number): void {
    this.detailScale = d;
  }

  private lodFor(dist: number): number {
    const s = this.detailScale;
    if (dist < 560 * s) return 0;
    if (dist < 1300 * s) return 1;
    if (dist < 2600 * s) return 2;
    return 3;
  }

  update(camX: number, camZ: number, budget = 3): void {
    // Nearest chunks first, so what you're standing on is always there.
    let built = 0;
    const order = this.chunks
      .map((c) => ({ c, d: Math.max(0, Math.hypot(c.cx - camX, c.cz - camZ) - CHUNK * 0.5) }))
      .sort((a, b) => a.d - b.d);
    for (const { c, d } of order) {
      let lod = this.lodFor(d);
      if (!c.geos[lod]) {
        if (built < budget || !c.mesh) {
          c.geos[lod] = this.buildGeometry(c, STEPS[lod]);
          built++;
        } else {
          // Keep the old detail level until the new one is ready.
          lod = c.lod;
        }
      }
      if (lod !== c.lod && c.geos[lod]) {
        if (!c.mesh) {
          c.mesh = new THREE.Mesh(c.geos[lod]!, this.material);
          c.mesh.matrixAutoUpdate = false;
          this.group.add(c.mesh);
        } else c.mesh.geometry = c.geos[lod]!;
        c.lod = lod;
      }
      if (c.mesh) {
        c.mesh.receiveShadow = this.shadows && lod <= 1;
      }
      // Free detailed geometry we're far from.
      for (let k = 0; k < 2; k++) {
        if (k < lod - 1 && c.geos[k]) {
          c.geos[k]!.dispose();
          c.geos[k] = null;
        }
      }
    }
  }

  private colorAt(x: number, z: number, h: number, slopeY: number, surf: number, out: THREE.Color): void {
    const n = noise2(x / 90, z / 90) * 0.5 + noise2(x / 23, z / 23) * 0.25;
    if (surf === Surface.Shoulder) {
      out.copy(C.shoulder);
      return;
    }
    if (surf === Surface.Dirt) {
      out.copy(C.dirt).lerp(C.sand, 0.15 + n * 0.1);
      return;
    }
    if (surf === Surface.Pavement) {
      out.copy(C.pavement).lerp(C.pavement2, 0.5 + n * 0.6);
      return;
    }
    if (surf === Surface.Lawn) {
      out.copy(C.lawn).lerp(C.grass2, 0.3 + n * 0.3);
      return;
    }
    if (h < -0.6) {
      out.copy(C.seabed).lerp(C.wetSand, Math.min(1, -h / 20));
      return;
    }
    if (h < 3.2) {
      out.copy(h < 0.9 ? C.wetSand : C.sand).lerp(C.sand, Math.min(1, (h - 0.2) / 1.5) * 0.6);
      return;
    }
    // Grass to jungle to rock to ash with height; steep ground is bare rock.
    out.copy(C.grass).lerp(C.grass2, Math.max(0, Math.min(1, 0.35 + n * 1.1)));
    // Sun-bleached and lush patches.
    const patch = noise2(x / 260 + 7, z / 260 - 3);
    if (patch > 0.25) out.lerp(C.grass2, Math.min(0.6, (patch - 0.25) * 2));
    const jungle = Math.max(0, Math.min(1, (h - 40) / 120 + n * 0.4));
    out.lerp(C.jungle, jungle * 0.75);
    if (h < 6) out.lerp(C.sand, (6 - h) / 3.2 * 0.6);
    const rock = Math.max(0, Math.min(1, (0.82 - slopeY) * 5)) + Math.max(0, Math.min(1, (h - 300) / 120));
    if (rock > 0) out.lerp(h > 330 ? C.darkRock : C.rock, Math.min(1, rock));
    if (h > 470) out.lerp(C.ash, Math.min(1, (h - 470) / 80));
  }

  private buildGeometry(c: Chunk, step: number): THREE.BufferGeometry {
    const t = this.t;
    const n = CHUNK_CELLS / step;
    const vertsPerRow = n + 1;
    const mainCount = vertsPerRow * vertsPerRow;
    const skirtCount = n * 4 + 4;
    const total = mainCount + skirtCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const i0 = c.ci * CHUNK_CELLS;
    const j0 = c.cj * CHUNK_CELLS;
    const col3 = new THREE.Color();
    const H = (i: number, j: number) => {
      const ii = Math.max(0, Math.min(t.nx - 1, i));
      const jj = Math.max(0, Math.min(t.nz - 1, j));
      return t.heights[jj * t.nx + ii];
    };
    const setVert = (k: number, i: number, j: number, drop: number) => {
      const x = DOMAIN.minX + i * CELL;
      const z = DOMAIN.minZ + j * CELL;
      const h = H(i, j);
      pos[k * 3] = x;
      pos[k * 3 + 1] = h - drop;
      pos[k * 3 + 2] = z;
      const dx = (H(i + step, j) - H(i - step, j)) / (2 * step * CELL);
      const dz = (H(i, j + step) - H(i, j - step)) / (2 * step * CELL);
      const il = 1 / Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx * il;
      nor[k * 3 + 1] = il;
      nor[k * 3 + 2] = -dz * il;
      this.colorAt(x, z, h, il, t.surface[Math.max(0, Math.min(t.nz - 1, j)) * t.nx + Math.max(0, Math.min(t.nx - 1, i))], col3);
      col[k * 3] = col3.r;
      col[k * 3 + 1] = col3.g;
      col[k * 3 + 2] = col3.b;
      uv[k * 2] = x / 9;
      uv[k * 2 + 1] = z / 9;
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) setVert(j * vertsPerRow + i, i0 + i * step, j0 + j * step, 0);
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * vertsPerRow + i;
        const b = a + 1;
        const d = a + vertsPerRow;
        const e = d + 1;
        // Alternate the diagonal so slopes don't streak in one direction.
        if ((i + j) & 1) idx.push(a, d, b, b, d, e);
        else idx.push(a, d, e, a, e, b);
      }
    }
    // Skirts: a strip hanging down along each edge.
    const drop = 4 + step * 3;
    let k = mainCount;
    const edges: [number, number][][] = [[], [], [], []];
    for (let i = 0; i <= n; i++) {
      edges[0].push([i, 0]);
      edges[1].push([n, i]);
      edges[2].push([n - i, n]);
      edges[3].push([0, n - i]);
    }
    for (const edge of edges) {
      const start = k;
      for (let q = 0; q < edge.length; q++) {
        if (k >= total) break;
        const [i, j] = edge[q];
        setVert(k, i0 + i * step, j0 + j * step, drop);
        k++;
      }
      for (let q = 0; q < edge.length - 1 && start + q + 1 < k; q++) {
        const [i, j] = edge[q];
        const [i2, j2] = edge[q + 1];
        const top1 = j * vertsPerRow + i;
        const top2 = j2 * vertsPerRow + i2;
        const bot1 = start + q;
        const bot2 = start + q + 1;
        idx.push(top1, top2, bot1, top2, bot2, bot1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, k * 2), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  /** A small texture of how deep the sea is, for the water shader. */
  depthTexture(res = 512): { tex: THREE.DataTexture; bounds: { minX: number; minZ: number; sizeX: number; sizeZ: number } } {
    const t = this.t;
    const sizeX = DOMAIN.maxX - DOMAIN.minX;
    const sizeZ = DOMAIN.maxZ - DOMAIN.minZ;
    const rz = Math.round((res * sizeZ) / sizeX);
    const data = new Uint8Array(res * rz);
    for (let j = 0; j < rz; j++) {
      for (let i = 0; i < res; i++) {
        const x = DOMAIN.minX + ((i + 0.5) / res) * sizeX;
        const z = DOMAIN.minZ + ((j + 0.5) / rz) * sizeZ;
        const h = t.heightAt(x, z);
        data[j * res + i] = Math.max(0, Math.min(255, Math.round((-h / 26) * 255)));
      }
    }
    const tex = new THREE.DataTexture(data, res, rz, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return { tex, bounds: { minX: DOMAIN.minX, minZ: DOMAIN.minZ, sizeX, sizeZ } };
  }
}
