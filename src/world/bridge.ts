import * as THREE from 'three';
import { Kit } from '../render/kit';
import { LANDMARKS } from './layout';
import type { Collision } from './collision';
import { mulberry32, noise2, fbm } from '../core/noise';
import { labelTexture } from '../render/signs';

/**
 * Interstate 15: the bridge that brings you to Jackpot Island from the mainland. A long
 * cable-stayed bridge with two big pylons, approach spans on concrete piers, guard rails,
 * lamps, and the mainland shore at its far end (desert, the highway running off into the
 * haze). Its deck is a walkable, drivable floor.
 */

export const BRIDGE = {
  x0: LANDMARKS.bridgeWest.x,
  x1: LANDMARKS.bridgeEast.x,
  z: LANDMARKS.bridgeWest.z,
  width: 22,
  pylons: [4620, 5380],
  /** Where the mainland's shore is. */
  mainland: 6280,
};

// Deck height control points (x, y).
const PROFILE: [number, number][] = [
  [BRIDGE.x0 - 60, 6.2],
  [BRIDGE.x0, 6.6],
  [3980, 26],
  [4300, 36],
  [5000, 41],
  [5700, 36],
  [6020, 24],
  [BRIDGE.x1, 9.4],
  [BRIDGE.x1 + 80, 9],
];

/** Deck surface height at x (smooth, piecewise cosine). */
export function deckY(x: number): number {
  if (x <= PROFILE[0][0]) return PROFILE[0][1];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [ax, ay] = PROFILE[i];
    const [bx, by] = PROFILE[i + 1];
    if (x <= bx) {
      const t = (x - ax) / (bx - ax);
      const s = (1 - Math.cos(t * Math.PI)) / 2;
      return ay + (by - ay) * s;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/** Mainland ground (east of the bridge): flat by the road, dunes and mesas beyond. */
export function mainlandY(x: number, z: number): number {
  const shore = BRIDGE.mainland + 60 * noise2(z / 500, 3.3);
  const t = (x - shore) / 160;
  if (t < 0) return -2 - Math.min(40, -t * 12);
  const base = 9 + 6 * fbm(x / 900, z / 900, 3);
  const roadFlat = Math.exp(-Math.pow((z - BRIDGE.z) / 70, 2));
  const mesa = Math.max(0, fbm(x / 1600 + 4, z / 1600, 3)) * 180;
  const mesaShape = Math.min(1, Math.max(0, (mesa - 30) / 10)) * mesa;
  const h = base + mesaShape * (1 - roadFlat);
  return Math.min(1, t) * (h * (1 - roadFlat) + 9 * roadFlat) + (1 - Math.min(1, t)) * -2;
}

export class Bridge {
  readonly group = new THREE.Group();
  private lamps: THREE.Mesh | null = null;
  private barrier: THREE.Group | null = null;
  private barrierBoxes: ReturnType<Collision['addBox']>[] = [];

  constructor(private collision: Collision, roadMaterial: THREE.Material) {
    this.buildDeck(roadMaterial);
    this.buildStructure();
    this.buildMainland(roadMaterial);
    this.buildSigns();
    // The deck is a floor; guard rails keep you on it.
    const hw = BRIDGE.width / 2;
    collision.addFloor({ minX: BRIDGE.x0 - 60, maxX: BRIDGE.x1 + 80, minZ: BRIDGE.z - hw, maxZ: BRIDGE.z + hw, y: (x) => deckY(x), tag: 'bridge' });
    for (let x = BRIDGE.x0 + 40; x < BRIDGE.x1 - 20; x += 40) {
      const y = Math.min(deckY(x), deckY(x + 40));
      for (const s of [-1, 1]) {
        collision.addBox({ minX: x, maxX: x + 40, minZ: BRIDGE.z + s * hw - (s < 0 ? 1 : 0), maxZ: BRIDGE.z + s * hw + (s > 0 ? 1 : 0), minY: y - 30, maxY: y + 1.2 + 6, tag: 'bridgeRail', cam: false });
      }
    }
  }

  private buildDeck(mat: THREE.Material): void {
    // Road surface: a ribbon with the highway lane markings from the road atlas.
    const pos: number[] = [];
    const uv: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const hw = BRIDGE.width / 2 - 1.2;
    const xs: number[] = [];
    for (let x = BRIDGE.x0 - 60; x <= BRIDGE.x1 + 80; x += 10) xs.push(x);
    xs.forEach((x, i) => {
      const y = deckY(x) + 0.05;
      pos.push(x, y, BRIDGE.z - hw, x, y, BRIDGE.z + hw);
      uv.push(0.18 - 0.004, x / 24, 0.004, x / 24);
      nor.push(0, 1, 0, 0, 1, 0);
      col.push(1, 1, 1, 1, 1, 1);
      if (i > 0) {
        const b = i * 2;
        idx.push(b - 2, b - 1, b + 1, b - 2, b + 1, b);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildStructure(): void {
    const k = new Kit();
    const glow = new Kit();
    const z = BRIDGE.z;
    const hw = BRIDGE.width / 2;
    const concrete = 0xd9d4ca;
    const steel = 0x8fa3b8;
    const red = 0xd8452f;
    // Deck girder, kerbs, rails, lamp posts, in 20 m slices.
    for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 20) {
      const xa = x;
      const xb = Math.min(BRIDGE.x1, x + 20);
      const ya = deckY(xa);
      const yb = deckY(xb);
      const mid = (xa + xb) / 2;
      const ym = (ya + yb) / 2;
      const len = Math.hypot(xb - xa, yb - ya);
      const pitch = Math.atan2(yb - ya, xb - xa);
      k.box(len, 2.2, BRIDGE.width + 1, 0xb9b4aa, { x: mid, y: ym - 1.2, z, rz: pitch });
      k.box(len, 0.5, 1.2, concrete, { x: mid, y: ym + 0.2, z: z - hw + 0.6, rz: pitch });
      k.box(len, 0.5, 1.2, concrete, { x: mid, y: ym + 0.2, z: z + hw - 0.6, rz: pitch });
      // Guard rails: two steel bands on posts.
      for (const s of [-1, 1]) {
        k.box(len, 0.22, 0.12, steel, { x: mid, y: ym + 0.95, z: z + s * (hw - 0.1), rz: pitch }, 'shiny');
        k.box(len, 0.22, 0.12, steel, { x: mid, y: ym + 0.55, z: z + s * (hw - 0.1), rz: pitch }, 'shiny');
        k.box(0.15, 1.1, 0.15, steel, { x: xa, y: ya + 0.55, z: z + s * (hw - 0.1) }, 'shiny');
      }
      // Lamp posts every 60 m, alternating sides.
      if (Math.round((x - BRIDGE.x0) / 20) % 3 === 0) {
        const s = Math.round((x - BRIDGE.x0) / 60) % 2 ? 1 : -1;
        const lz = z + s * (hw - 0.4);
        k.cyl(0.12, 0.18, 9, 0x5a6470, { x: xa, y: ya + 4.5, z: lz }, 'shiny', 8);
        k.box(0.15, 0.15, 2.4, 0x5a6470, { x: xa, y: ya + 9, z: lz - s * 1.1 }, 'shiny');
        glow.box(0.6, 0.18, 0.9, 0xfff1c8, { x: xa, y: ya + 8.85, z: lz - s * 2.1 }, 'glow');
      }
    }
    // Piers on the approach spans; the main span hangs from the pylons.
    const r = mulberry32(15);
    for (let x = BRIDGE.x0 + 120; x < BRIDGE.x1 - 40; x += 110) {
      if (x > BRIDGE.pylons[0] + 60 && x < BRIDGE.pylons[1] - 60) continue;
      const y = deckY(x) - 2.3;
      for (const s of [-1, 1]) k.cyl(1.6, 2.0, y + 40, concrete, { x, y: (y - 40) / 2, z: z + s * 6 }, 'matte', 12);
      k.box(4, 2.5, BRIDGE.width + 3, concrete, { x, y: y - 1.2, z });
      void r;
    }
    // Pylons: tall A-frames with a crossbeam, and fans of stay cables.
    for (const px of BRIDGE.pylons) {
      const top = 165;
      const dy = deckY(px);
      for (const s of [-1, 1]) {
        // Legs lean in towards the top.
        const baseZ = z + s * 17;
        const topZ = z + s * 4;
        const len = Math.hypot(top + 30, baseZ - topZ);
        const rx = Math.atan2(topZ - baseZ, top + 30);
        k.box(5, len, 6, 0xeeeae2, { x: px, y: (top - 30) / 2, z: (baseZ + topZ) / 2, rx });
        glow.sphere(0.7, 0xff2a2a, { x: px, y: top + 1, z: topZ }, 'glow', 8, 6);
      }
      k.box(7, 5, 12, 0xeeeae2, { x: px, y: top - 8, z });
      k.box(7, 4, 30, 0xeeeae2, { x: px, y: dy - 3, z });
      k.box(14, 6, 38, 0xd0cbc0, { x: px, y: -2, z });
      // Cables: each a thin box from the pylon head to the deck edge.
      for (const dir of [-1, 1]) {
        for (let i = 1; i <= 14; i++) {
          const dx = dir * i * 26;
          const ax = px;
          const ay = top - 12 - i * 3.2;
          const bx = px + dx;
          const by = deckY(bx) + 0.8;
          for (const s of [-1, 1]) {
            const az = z + s * 4.5;
            const bz = z + s * (hw - 0.6);
            const v = new THREE.Vector3(bx - ax, by - ay, bz - az);
            const len = v.length();
            const g = new THREE.CylinderGeometry(0.12, 0.12, len, 4, 1);
            g.translate(0, len / 2, 0);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
            g.applyQuaternion(q);
            g.translate(ax, ay, az);
            k.add(g, 0xf4f4f4, {}, 'shiny');
          }
        }
      }
      // Aircraft warning beacons along the head, plus red trim.
      k.box(7.4, 1.2, 12.4, red, { x: px, y: top - 4, z });
    }
    const main = k.bake({ shadows: true });
    this.group.add(main);
    const gl = glow.bake();
    this.lamps = gl.children[0] as THREE.Mesh;
    this.group.add(gl);
  }

  private buildMainland(roadMat: THREE.Material): void {
    // A coarse grid of desert east of the bridge, out past the haze.
    const W = 7000;
    const D = 16000;
    const step = 80;
    const nx = Math.round(W / step);
    const nz = Math.round(D / step);
    const x0 = BRIDGE.mainland - 300;
    const z0 = BRIDGE.z - D / 2;
    const geo = new THREE.PlaneGeometry(W, D, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x0 + W / 2, 0, z0 + D / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const sand = new THREE.Color(0xe2b97f);
    const rock = new THREE.Color(0xc0673d);
    const scrub = new THREE.Color(0x9aa158);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const zz = pos.getZ(i);
      const y = mainlandY(x, zz);
      pos.setY(i, y);
      c.copy(sand).lerp(scrub, Math.max(0, noise2(x / 300, zz / 300)) * 0.6);
      if (y > 30) c.lerp(rock, Math.min(1, (y - 30) / 25));
      if (y < 1) c.setHex(0xcdb98e);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.group.add(land);
    // The interstate runs on into the desert.
    const pos2: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const hw = 9;
    let i = 0;
    for (let x = BRIDGE.x1 + 80; x <= BRIDGE.mainland + 6500; x += 40, i++) {
      const y = 9.1;
      pos2.push(x, y, BRIDGE.z - hw, x, y, BRIDGE.z + hw);
      uv.push(0.18 - 0.004, x / 24, 0.004, x / 24);
      if (i > 0) {
        const b = i * 2;
        idx.push(b - 2, b - 1, b + 1, b - 2, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array((pos2.length / 3) * 3).fill(1), 3));
    g.computeVertexNormals();
    g.setIndex(idx);
    g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, roadMat));
  }

  private buildSigns(): void {
    // "Welcome to Jackpot Island" arch over the island end of the bridge.
    const k = new Kit();
    const x = BRIDGE.x0 + 150;
    const y = deckY(x);
    const hw = BRIDGE.width / 2;
    for (const s of [-1, 1]) k.rbox(1.4, 12, 1.4, 0.3, 0xffd23d, { x, y: y + 6, z: BRIDGE.z + s * (hw + 1) }, 'shiny');
    k.rbox(1.2, 3.6, BRIDGE.width + 4, 0.3, 0x1e6bff, { x, y: y + 11.5, z: BRIDGE.z });
    this.group.add(k.bake({ shadows: true }));
    const signTex = labelTexture('WELCOME TO JACKPOT ISLAND', { width: 1024, height: 160, font: 'Lilita One', color: '#ffffff', stroke: '#0b1a45', bg: '#1e6bff', size: 92 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(BRIDGE.width + 2, 3.2), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
    for (const s of [-1, 1]) {
      const m = sign.clone();
      m.position.set(x + s * 0.62, y + 11.5, BRIDGE.z);
      m.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(m);
    }
    // Interstate shield on a post at the island end.
    const shield = labelTexture('I-15', { width: 256, height: 256, font: 'Lilita One', color: '#ffffff', bg: '#1d3f9e', stroke: '#c8202f', size: 120, shield: true });
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: shield, transparent: true, toneMapped: false }));
    sh.position.set(BRIDGE.x0 + 60, deckY(BRIDGE.x0 + 60) + 5.5, BRIDGE.z + BRIDGE.width / 2 + 2.5);
    sh.rotation.y = Math.PI / 2;
    this.group.add(sh);
    const post = new Kit().cyl(0.15, 0.15, 5, 0x8a8f96, { x: sh.position.x - 0.1, y: sh.position.y - 3, z: sh.position.z }, 'shiny').bake();
    this.group.add(post);
  }

  /** Close the bridge behind you after the intro (repairs: nobody leaves the island yet). */
  setClosed(closed: boolean): void {
    if (closed && !this.barrier) {
      const k = new Kit();
      const x = BRIDGE.x1 - 260;
      const y = deckY(x);
      for (let zz = -9; zz <= 9; zz += 3) {
        k.add(new THREE.BoxGeometry(1.2, 1.1, 2.8), 0xe8e4dc, { x, y: y + 0.55, z: BRIDGE.z + zz });
        k.box(1.25, 0.25, 2.85, 0xff3b30, { x, y: y + 0.85, z: BRIDGE.z + zz });
      }
      for (const s of [-1, 1]) k.cone(0.35, 0.9, 0xff7a1a, { x: x - 6, y: y + 0.45, z: BRIDGE.z + s * 4 });
      const g = k.bake();
      const tex = labelTexture('BRIDGE CLOSED FOR REPAIRS', { width: 1024, height: 128, font: 'Lilita One', color: '#111', bg: '#ffb020', size: 72 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
      sign.position.set(x - 0.7, y + 2.6, BRIDGE.z);
      sign.rotation.y = -Math.PI / 2;
      g.add(sign);
      this.barrier = g;
      this.group.add(g);
      this.barrierBoxes.push(this.collision.addBox({ minX: x - 0.7, maxX: x + 0.7, minZ: BRIDGE.z - 12, maxZ: BRIDGE.z + 12, minY: y - 2, maxY: y + 3, tag: 'barrier' }));
    } else if (!closed && this.barrier) {
      this.group.remove(this.barrier);
      this.barrier = null;
      for (const b of this.barrierBoxes) this.collision.removeBox(b);
      this.barrierBoxes = [];
    }
  }

  update(night: number): void {
    if (this.lamps) this.lamps.visible = night > 0.2;
  }
}
