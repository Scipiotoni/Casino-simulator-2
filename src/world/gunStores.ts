import * as THREE from 'three';
import { Kit } from '../render/kit';
import { labelTexture } from '../render/signs';
import { markStatic, mergeStatic } from '../render/mergeStatic';
import { lotFrontPoint, type Lot } from './layout';
import type { Game } from '../game/game';
import type { Hittable } from '../combat/combat';
import { CharacterModel } from '../chars/model';
import { Animator } from '../chars/anim';
import { randomAppearance } from '../chars/skins';
import { mulberry32 } from '../core/noise';
import { audio } from '../core/audio';
import { GUN_STORES, storeStock, type GunStore } from '../weapons/stores';
import { DEFAULT_LOADOUT } from '../weapons/loadout';
import { buildWeapon } from '../weapons/standin';

/**
 * The gun stores: four buildings round the island you walk into (src/weapons/stores.ts has
 * who sells what). Each has an open door, a glass counter of handguns with a clerk behind
 * it, a back wall of long guns, a pegboard of pistols and SMGs, ammo shelves, a featured
 * piece on a plinth, a gunsmith's workbench (vice, tools, a lamp, a weapon in pieces) and a
 * short indoor range behind glass with paper targets. Guns are holstered inside, except on
 * the range lane. Interiors are hidden beyond 60 m, the displays and the clerk beyond 30 m.
 *
 * Local frame (like the flat): x across the front, −z into the lot, the front wall at z = 0.
 */

const W = 22;
const D = 14;
/** Outside wall height, and the ceiling inside. */
const H = 4.9;
const CEIL = 4.2;
const DOOR = { x0: -2.5, x1: -0.5, h: 2.7 };
const WIN = [[-10.2, -3.2], [0.2, 4.6]] as const;
/** The range: x from the glass to the right wall; you stand between the front and the bench. */
const RANGE = { x0: 5, x1: W / 2 - 0.15, bench: -4.6, targets: -12.4 };
const COUNTER = { x0: -7.5, x1: 0.5, z: -8.8 };
const BENCH = { x0: 0.9, x1: 4.5, z: -13.3 };

export interface GunStoreSite {
  key: string;
  store: GunStore;
  /** On the pavement outside the door, and the way the store faces. */
  door: THREE.Vector3;
  yaw: number;
  lot: Lot;
}

class Target implements Hittable {
  pos = new THREE.Vector3();
  radius = 0.32;
  height = 0.95;
  alive = true;
  swing = 0;
  constructor(readonly pivot: THREE.Object3D) {}
  hit(): void {
    this.swing = 1;
    audio.playAt('click', this.pos.x, this.pos.z, 0.4);
  }
}

export class GunStoreBuilding {
  readonly group = new THREE.Group();
  readonly site: GunStoreSite;
  readonly floorY: number;
  private interior = new THREE.Group();
  private detail = new THREE.Group();
  private far = new THREE.Group();
  private clerk: { model: CharacterModel; anim: Animator } | null = null;
  private targets: Target[] = [];
  private bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };


  constructor(private g: Game, readonly store: GunStore, lot: Lot) {
    const y = g.world.terrain.lotY.get(lot.id) ?? 6;
    this.floorY = y + 0.15;
    const fp = lotFrontPoint(lot);

    const setback = 6;
    this.group.position.set(fp.x - Math.sin(fp.yaw) * setback, 0, fp.z - Math.cos(fp.yaw) * setback);
    this.group.rotation.y = fp.yaw;
    this.group.add(this.interior, this.far);
    this.interior.add(this.detail);
    this.group.updateMatrixWorld(true);
    this.buildShell(y);
    this.buildInterior();
    this.buildDisplays();
    this.buildClerk();
    this.buildRange();
    g.renderer.scene.add(this.group);
    this.group.updateMatrixWorld(true);
    this.collide(y);
    const door = this.toWorld((DOOR.x0 + DOOR.x1) / 2, 2.2, y);
    this.site = { key: store.key, store, door, yaw: fp.yaw, lot };
    this.interactions();
    const c = [this.toWorld(-W / 2, 0), this.toWorld(W / 2, -D)];
    this.bounds = { minX: Math.min(c[0].x, c[1].x), maxX: Math.max(c[0].x, c[1].x), minZ: Math.min(c[0].z, c[1].z), maxZ: Math.max(c[0].z, c[1].z) };
  }

  toWorld(x: number, z: number, y = this.floorY): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(x, y, z));
  }

  private local(x: number, z: number): THREE.Vector3 {
    return this.group.worldToLocal(new THREE.Vector3(x, 0, z));
  }

  /** Inside the walls? */
  inside(x: number, z: number): boolean {
    const p = this.local(x, z);
    return p.x > -W / 2 && p.x < W / 2 && p.z < 0 && p.z > -D;
  }

  /** On the range lane (the one place indoors where guns come out)? */
  onRange(x: number, z: number): boolean {
    const p = this.local(x, z);
    return p.x > RANGE.x0 && p.x < W / 2 && p.z < 0 && p.z > -D;
  }

  // ---------------------------------------------------------------- the building

  private buildShell(y: number): void {
    const s = this.store.look;
    const k = new Kit();
    const glow = new Kit();
    const wall = s.wall;
    const t = 0.3;
    // Slab under the floor (the lot may slope a little).
    k.box(W + 0.4, this.floorY - y + 0.6, D + 0.4, 0x8a8a8a, { y: (this.floorY + y - 0.6) / 2, z: -D / 2 });
    // Back and side walls, the roof.
    k.box(W, H, t, wall, { y: y + H / 2, z: -D + t / 2 });
    for (const sx of [-1, 1]) k.box(t, H, D, wall, { x: sx * (W / 2 - t / 2), y: y + H / 2, z: -D / 2 });
    k.box(W + 0.6, 0.35, D + 0.6, 0x4a4a4e, { y: y + H + 0.17, z: -D / 2 });
    // Front: piers, the band under the windows, above them, over the door.
    const fy = this.floorY;
    const piers: [number, number][] = [[-W / 2, WIN[0][0]], [WIN[0][1], DOOR.x0], [DOOR.x1, WIN[1][0]], [WIN[1][1], W / 2]];
    for (const [a, b] of piers) k.box(b - a, H, t, wall, { x: (a + b) / 2, y: y + H / 2, z: -t / 2 });
    for (const [a, b] of WIN) {
      k.box(b - a, fy - y + 0.9, t, wall, { x: (a + b) / 2, y: (y + fy + 0.9) / 2, z: -t / 2 });
      k.box(b - a, y + H - (fy + 3.2), t, wall, { x: (a + b) / 2, y: (fy + 3.2 + y + H) / 2, z: -t / 2 });
      k.box(b - a - 0.1, 2.3, 0.06, 0x8ac4e0, { x: (a + b) / 2, y: fy + 2.05, z: -0.05 }, 'glass');
      k.box(b - a, 0.12, 0.45, s.trim, { x: (a + b) / 2, y: fy + 0.86, z: 0.05 }, 'shiny');
      for (let x = a + (b - a) / 3; x < b - 0.1; x += (b - a) / 3) k.box(0.08, 2.3, 0.12, s.trim, { x, y: fy + 2.05, z: -0.02 }, 'shiny');
    }
    k.box(DOOR.x1 - DOOR.x0, y + H - (fy + DOOR.h), t, wall, { x: (DOOR.x0 + DOOR.x1) / 2, y: (fy + DOOR.h + y + H) / 2, z: -t / 2 });
    // Door frame and the door, standing open outwards against the wall.
    k.box(DOOR.x1 - DOOR.x0 + 0.24, 0.14, 0.4, s.trim, { x: (DOOR.x0 + DOOR.x1) / 2, y: fy + DOOR.h + 0.07, z: 0 }, 'shiny');
    for (const x of [DOOR.x0, DOOR.x1]) k.box(0.12, DOOR.h, 0.4, s.trim, { x, y: fy + DOOR.h / 2, z: 0 }, 'shiny');
    k.box(0.06, DOOR.h - 0.1, DOOR.x1 - DOOR.x0 - 0.1, s.trim, { x: DOOR.x0 - 0.06, y: fy + DOOR.h / 2, z: (DOOR.x1 - DOOR.x0) / 2 + 0.1 }, 'shiny');
    k.box(0.07, 1.6, 1.4, 0x8ac4e0, { x: DOOR.x0 - 0.06, y: fy + 1.5, z: (DOOR.x1 - DOOR.x0) / 2 + 0.1 }, 'glass');
    k.box(0.04, 0.04, 0.5, 0xd8d8d8, { x: DOOR.x0, y: fy + 1.05, z: 1.6 }, 'shiny');
    // Step and a mat.
    k.box(DOOR.x1 - DOOR.x0 + 1, fy - y, 1.2, 0x9a9a9a, { x: (DOOR.x0 + DOOR.x1) / 2, y: (fy + y) / 2, z: 0.6 });
    k.box(1.6, 0.02, 0.9, 0x2a2a2e, { x: (DOOR.x0 + DOOR.x1) / 2, y: fy + 0.01, z: 0.6 });
    // Awning.
    k.box(15.6, 0.16, 1.8, s.awning, { x: -2.9, y: fy + 3.55, z: 0.9, rx: 0.16 }, 'shiny');
    glow.box(15.6, 0.06, 0.06, new THREE.Color(s.neon).getHex(), { x: -2.9, y: fy + 3.42, z: 1.8 }, 'glow');
    // The range part of the front: solid, with a small sign.
    this.styleExtras(k, glow, y);
    this.group.add(k.bake({ shadows: true }), glow.bake());
    // Signs.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.5), new THREE.MeshBasicMaterial({ map: labelTexture(this.store.sign, { width: 1024, height: 140, color: '#ffffff', glow: s.neon, stroke: s.neon, strokeWidth: 5, size: 104, font: 'Bungee' }), transparent: true, toneMapped: false }));
    sign.position.set(-2.9, fy + 4.15, 0.2);
    this.group.add(sign);
    const rng = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.8), new THREE.MeshBasicMaterial({ map: labelTexture('INDOOR RANGE', { width: 512, height: 90, color: '#ffffff', bg: '#1a1a1e', size: 64, font: 'Bungee' }), toneMapped: false }));
    rng.position.set(7.9, fy + 2.4, 0.17);
    this.group.add(rng);
    // From far away the windows glow (the interior is hidden).
    const fk = new Kit();
    for (const [a, b] of WIN) fk.box(b - a - 0.2, 2.2, 0.04, 0xfff0d0, { x: (a + b) / 2, y: fy + 2.05, z: -0.4 }, 'glow');
    fk.box(DOOR.x1 - DOOR.x0 - 0.2, DOOR.h - 0.1, 0.04, 0xfff0d0, { x: (DOOR.x0 + DOOR.x1) / 2, y: fy + DOOR.h / 2, z: -0.4 }, 'glow');
    this.far.add(fk.bake());
  }

  /** Each store's own look on the outside. */
  private styleExtras(k: Kit, glow: Kit, y: number): void {
    const s = this.store.look;
    const fy = this.floorY;
    const rng = mulberry32(this.store.key.length * 31);
    switch (s.style) {
      case 'brick': {
        // Mortar lines, a parapet, a bullseye on the corner.
        for (let h = y + 0.3; h < y + H; h += 0.32) {
          for (const sx of [-1, 1]) k.box(0.02, 0.025, D, 0xc8b8a8, { x: sx * (W / 2 + 0.005), y: h, z: -D / 2 });
          k.box(W - 1, 0.025, 0.02, 0xc8b8a8, { x: 0, y: h, z: -D - 0.005 });
        }
        k.box(W + 0.6, 0.8, 0.3, 0x5a2218, { y: y + H + 0.5, z: 0.1 });
        for (let i = 0; i < 4; i++) glow.cyl(1.0 - i * 0.24, 1.0 - i * 0.24, 0.04 + i * 0.01, i % 2 ? 0xffffff : 0xff3a4a, { x: 7.9, y: fy + 3.7, z: 0.2 + i * 0.01, rx: Math.PI / 2 }, 'glow', 24);
        break;
      }
      case 'boutique': {
        // Gold pilasters and trim on black, a red carpet, potted topiary.
        for (const x of [-W / 2, WIN[0][1] + 0.1, DOOR.x1 + 0.3, WIN[1][1] + 0.2, W / 2]) k.box(0.5, H, 0.2, s.trim, { x: Math.max(-W / 2 + 0.25, Math.min(W / 2 - 0.25, x)), y: y + H / 2, z: 0.08 }, 'shiny');
        k.box(W + 0.6, 0.18, 0.4, s.trim, { y: y + H - 0.1, z: 0.1 }, 'shiny');
        k.box(W + 0.6, 0.9, 0.3, 0x0e0e12, { y: y + H + 0.6, z: 0.1 }, 'shiny');
        k.box(1.8, 0.03, 4, 0xa01020, { x: (DOOR.x0 + DOOR.x1) / 2, y: fy + 0.02, z: 2.4 });
        for (const x of [DOOR.x0 - 0.9, DOOR.x1 + 0.9]) {
          k.cyl(0.35, 0.28, 0.7, 0x16161c, { x, y: fy + 0.35, z: 1.2 }, 'shiny', 12);
          k.sphere(0.55, 0x2a6a2a, { x, y: fy + 1.2, z: 1.2 });
          k.sphere(0.4, 0x2a6a2a, { x, y: fy + 1.9, z: 1.2 });
        }
        glow.box(0.6, 0.6, 0.05, 0xffd23d, { x: 7.9, y: fy + 3.6, z: 0.2, rz: Math.PI / 4 }, 'glow');
        break;
      }
      case 'shed': {
        // Corrugated metal, sandbags, crates and a drum, a painted sign on the roof.
        for (let x = -W / 2; x <= W / 2; x += 0.3) {
          if (x > DOOR.x0 - 0.1 && x < DOOR.x1 + 0.1) continue;
          const inWin = WIN.some(([a, b]) => x > a && x < b);
          if (!inWin) k.box(0.05, H, 0.05, 0x9a7a4a, { x, y: y + H / 2, z: 0.02 });
          else {
            k.box(0.05, fy + 0.9 - y, 0.05, 0x9a7a4a, { x, y: (y + fy + 0.9) / 2, z: 0.02 });
            k.box(0.05, y + H - fy - 3.2, 0.05, 0x9a7a4a, { x, y: (fy + 3.2 + y + H) / 2, z: 0.02 });
          }
        }
        for (let z = -D + 0.2; z < 0; z += 0.3) for (const sx of [-1, 1]) k.box(0.05, H, 0.05, 0x9a7a4a, { x: sx * (W / 2 + 0.02), y: y + H / 2, z });
        for (let i = 0; i < 7; i++) k.rbox(0.7, 0.28, 0.4, 0.1, 0xc8b080, { x: DOOR.x1 + 0.9 + (i % 4) * 0.72 - (i >= 4 ? -0.36 : 0), y: fy + 0.14 + (i >= 4 ? 0.28 : 0), z: 1.4 });
        k.box(1.0, 0.8, 0.8, 0x6a5a3a, { x: -9.5, y: fy + 0.4, z: 1.2, ry: 0.2 });
        k.box(0.8, 0.6, 0.6, 0x6a5a3a, { x: -9.4, y: fy + 1.1, z: 1.2, ry: -0.1 });
        k.cyl(0.3, 0.3, 0.9, 0x3a4a2a, { x: -8.2, y: fy + 0.45, z: 1.3 }, 'shiny', 12);
        k.box(0.08, 2.2, 0.08, 0x3a3a3a, { x: -6, y: y + H + 1.1, z: -0.5 });
        k.box(0.08, 2.2, 0.08, 0x3a3a3a, { x: 0.2, y: y + H + 1.1, z: -0.5 });
        const paint = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 1.2), new THREE.MeshBasicMaterial({ map: labelTexture('GUNS · AMMO · ROCKETS', { width: 1024, height: 166, color: '#2a1a0a', bg: '#e8c88a', size: 92, font: 'Bungee' }), toneMapped: false }));
        paint.position.set(-2.9, y + H + 1.6, -0.42);
        this.group.add(paint);
        break;
      }
      case 'cabin': {
        // Clapboard, a pitched roof, antlers over the door, a bench and barrels.
        for (let h = y + 0.25; h < y + H; h += 0.28) {
          const c = new THREE.Color(s.wall).offsetHSL(0, 0, (rng() - 0.5) * 0.04).getHex();
          for (const [a, b] of [[-W / 2, WIN[0][0]], [WIN[1][1], W / 2]] as const) k.box(b - a, 0.06, 0.05, c, { x: (a + b) / 2, y: h, z: 0.02 });
          if (h > fy + 3.2 || h < fy + 0.9) k.box(W, 0.06, 0.05, c, { x: 0, y: h, z: 0.03 });
        }
        for (const sx of [-1, 1]) k.box(W / 2 + 0.6, 0.2, D + 1.2, 0x3a2a1a, { x: sx * W / 4, y: y + H + 1.2, z: -D / 2, rz: -sx * 0.22 });
        k.box(W, 2.4, 0.2, s.wall, { y: y + H + 0.6, z: -0.05, sx: 1 });
        k.box(W, 2.4, 0.2, s.wall, { y: y + H + 0.6, z: -D + 0.1 });
        for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) k.cone(0.04, 0.5, 0xe8dcc0, { x: (DOOR.x0 + DOOR.x1) / 2 + sx * (0.2 + i * 0.12), y: fy + DOOR.h + 0.6 + i * 0.12, z: 0.25, rz: -sx * (0.6 + i * 0.25) }, 'matte', 5);
        k.box(1.8, 0.08, 0.5, 0x6a4a2a, { x: -7, y: fy + 0.5, z: 1.0 });
        for (const x of [-7.7, -6.3]) k.box(0.08, 0.5, 0.4, 0x5a3a1a, { x, y: fy + 0.25, z: 1.0 });
        for (const x of [5.6, 6.4]) k.cyl(0.32, 0.32, 0.9, 0x7a5a32, { x, y: fy + 0.45, z: 1.2 }, 'matte', 12);
        break;
      }
    }
  }

  private buildInterior(): void {
    const s = this.store.look;
    const k = new Kit();
    const glow = new Kit();
    const fy = this.floorY;
    const ix0 = -W / 2 + 0.3;
    const ix1 = W / 2 - 0.3;
    const iz0 = -0.3;
    const iz1 = -D + 0.3;
    const iw = ix1 - ix0;
    const id = iz0 - iz1;
    // Floor: tiles, marble, concrete or planks.
    const tile = s.style === 'cabin' ? [0.3, 0] : s.style === 'shed' ? [2, 2] : [1, 1];
    const fc = new THREE.Color(s.floor);
    for (let x = ix0; x < RANGE.x0 - 0.01; x += tile[0]) {
      for (let z = iz0; z > iz1 + 0.01; z -= tile[1] || id) {
        const w = Math.min(tile[0], RANGE.x0 - x);
        const d = Math.min(tile[1] || id, z - iz1);
        const odd = (Math.round(x / tile[0]) + Math.round(z / (tile[1] || id))) % 2;
        const c = fc.clone().offsetHSL(0, 0, s.style === 'boutique' ? (odd ? -0.25 : 0) : odd ? -0.03 : 0.02).getHex();
        k.box(w - 0.01, 0.04, d - 0.01, c, { x: x + w / 2, y: fy - 0.02, z: z - d / 2 }, s.style === 'boutique' ? 'shiny' : 'matte');
      }
    }
    k.box(ix1 - RANGE.x0, 0.04, id, 0x5a5a5e, { x: (RANGE.x0 + ix1) / 2, y: fy - 0.02, z: (iz0 + iz1) / 2 });
    // Walls inside, a darker band low down, the ceiling.
    const inner = s.inner;
    const low = new THREE.Color(inner).offsetHSL(0, 0, -0.18).getHex();
    k.box(iw, CEIL, 0.05, inner, { x: 0, y: fy + CEIL / 2, z: iz1 });
    k.box(0.05, CEIL, id, inner, { x: ix0, y: fy + CEIL / 2, z: (iz0 + iz1) / 2 });
    k.box(0.05, CEIL, id, 0x6a6a6e, { x: ix1, y: fy + CEIL / 2, z: (iz0 + iz1) / 2 });
    k.box(iw, 1.0, 0.06, low, { x: 0, y: fy + 0.5, z: iz1 + 0.01 });
    k.box(0.06, 1.0, id, low, { x: ix0 + 0.01, y: fy + 0.5, z: (iz0 + iz1) / 2 });
    k.box(iw, 0.06, id, 0xe8e8e8, { x: 0, y: fy + CEIL, z: (iz0 + iz1) / 2 });
    // The inside of the front wall (the range part is solid).
    k.box(ix1 - WIN[1][1], CEIL, 0.05, 0x6a6a6e, { x: (WIN[1][1] + ix1) / 2, y: fy + CEIL / 2, z: iz0 });
    // Ceiling lights.
    for (const x of [-7.5, -3, 1.5]) for (const z of [-3, -7.5, -11.5]) glow.box(2.2, 0.04, 0.5, 0xfff4e0, { x, y: fy + CEIL - 0.03, z }, 'glow');
    for (const z of [-3, -7, -11]) glow.box(0.5, 0.04, 1.6, 0xe8f0ff, { x: 7.9, y: fy + CEIL - 0.03, z }, 'glow');
    // Glass counter cases with handguns (the pistols go in later).
    const counterCase = (x0: number, x1: number, z: number) => {
      const cx = (x0 + x1) / 2;
      const w = x1 - x0;
      k.box(w, 0.75, 0.8, s.counter, { x: cx, y: fy + 0.375, z }, 'shiny');
      k.box(w, 0.04, 0.82, s.trim, { x: cx, y: fy + 0.77, z }, 'shiny');
      k.box(w - 0.04, 0.02, 0.74, 0x5a0a14, { x: cx, y: fy + 0.79, z });
      k.box(w, 0.3, 0.8, 0xbfe0f0, { x: cx, y: fy + 0.95, z }, 'glass');
      for (const x of [x0, x1]) k.box(0.03, 0.32, 0.82, s.trim, { x, y: fy + 0.95, z }, 'shiny');
      k.box(w, 0.03, 0.82, s.trim, { x: cx, y: fy + 1.11, z }, 'shiny');
      glow.box(w - 0.1, 0.02, 0.04, 0xfff4e0, { x: cx, y: fy + 1.08, z: z - 0.36 }, 'glow');
    };
    for (let x = COUNTER.x0; x < COUNTER.x1 - 0.1; x += 2) counterCase(x, x + 2, COUNTER.z);
    counterCase(-6.2, -3.2, -4.5);
    // A till and a mat on the counter.
    k.box(0.4, 0.2, 0.35, 0x2a2a2e, { x: -1.0, y: fy + 1.23, z: COUNTER.z - 0.1 }, 'shiny');
    glow.box(0.3, 0.12, 0.01, 0x7fd8ff, { x: -1.0, y: fy + 1.3, z: COUNTER.z + 0.08, rx: -0.3 }, 'glow');
    k.box(0.6, 0.01, 0.4, 0x2a5a3a, { x: -3.6, y: fy + 1.13, z: COUNTER.z + 0.05 });
    // Back wall: slatwall for long guns.
    k.box(10.6, 2.9, 0.05, 0xb0a48c, { x: -5.3, y: fy + 2.05, z: iz1 + 0.04 });
    for (let h = 0.75; h < 3.5; h += 0.15) k.box(10.6, 0.012, 0.02, 0x7a705c, { x: -5.3, y: fy + h, z: iz1 + 0.07 });
    // Left wall: pegboard for handguns and SMGs, ammo shelves by the front.
    const peg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.2), new THREE.MeshLambertMaterial({ map: pegboardTexture(s.style === 'boutique' ? '#2a2630' : '#b89a6a') }));
    peg.position.set(ix0 + 0.04, fy + 2.0, -9.8);
    peg.rotation.y = Math.PI / 2;
    this.interior.add(peg);
    const rng = mulberry32(this.store.key.charCodeAt(3) * 13);
    const boxCols = [0x2a7a3a, 0xc8202f, 0xf2c230, 0x2a5ab8, 0xe8e0d0, 0x3a3a3e];
    k.box(0.5, 2.3, 4.8, 0x5a5a60, { x: ix0 + 0.25, y: fy + 1.15, z: -3.8 }, 'shiny');
    for (let sh = 0; sh < 5; sh++) {
      const sy = fy + 0.15 + sh * 0.45;
      k.box(0.52, 0.03, 4.8, 0x8a8a90, { x: ix0 + 0.26, y: sy, z: -3.8 }, 'shiny');
      for (let z = -1.5; z > -6.1; z -= 0.2 + rng() * 0.08) {
        if (rng() < 0.12) continue;
        const can = rng() < 0.2;
        const c = can ? 0x4a5a2a : boxCols[Math.floor(rng() * boxCols.length)];
        if (can) k.box(0.3, 0.2, 0.16, c, { x: ix0 + 0.3, y: sy + 0.115, z }, 'shiny');
        else k.box(0.22, 0.1 + rng() * 0.12, 0.14, c, { x: ix0 + 0.3, y: sy + 0.11, z }, 'matte');
      }
    }
    // Workbench: thick top, legs, shelf, vice, tools on a board, a lamp, a mat.
    const bx = (BENCH.x0 + BENCH.x1) / 2;
    const bw = BENCH.x1 - BENCH.x0;
    k.box(bw, 0.08, 0.9, 0x8a6a40, { x: bx, y: fy + 0.9, z: BENCH.z }, 'shiny');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.08, 0.86, 0.08, 0x3a3a3e, { x: bx + sx * (bw / 2 - 0.1), y: fy + 0.43, z: BENCH.z + sz * 0.35 });
    k.box(bw - 0.2, 0.04, 0.8, 0x5a4a30, { x: bx, y: fy + 0.25, z: BENCH.z });
    k.box(0.4, 0.3, 0.3, 0x6a6a70, { x: BENCH.x0 + 0.1, y: fy + 0.25 + 0.17, z: BENCH.z - 0.2 }, 'shiny');
    k.box(0.12, 0.12, 0.22, 0x3a5a8a, { x: BENCH.x0 + 0.35, y: fy + 1.0, z: BENCH.z + 0.25 }, 'shiny');
    k.box(0.16, 0.16, 0.2, 0x3a5a8a, { x: BENCH.x0 + 0.35, y: fy + 1.02, z: BENCH.z + 0.05 }, 'shiny');
    k.cyl(0.015, 0.015, 0.3, 0xc8c8c8, { x: BENCH.x0 + 0.35, y: fy + 1.0, z: BENCH.z + 0.42, rz: Math.PI / 2 }, 'shiny', 6);
    k.box(1.6, 0.01, 0.6, 0x2a6a4a, { x: bx + 0.2, y: fy + 0.945, z: BENCH.z + 0.05 });
    // Small parts tray, a cleaning rod, an oil can.
    k.box(0.3, 0.04, 0.2, 0xb8b8c0, { x: bx + 1.0, y: fy + 0.96, z: BENCH.z + 0.28 }, 'shiny');
    k.cyl(0.004, 0.004, 0.9, 0xc8c8c8, { x: bx + 0.2, y: fy + 0.95, z: BENCH.z - 0.28, rz: Math.PI / 2 }, 'shiny', 4);
    k.cyl(0.04, 0.05, 0.12, 0xd8a020, { x: bx - 0.4, y: fy + 1.0, z: BENCH.z - 0.3 }, 'shiny', 10);
    // The tool board.
    k.box(bw, 1.2, 0.04, 0xc8a070, { x: bx, y: fy + 1.75, z: iz1 + 0.05 });
    for (let i = 0; i < 9; i++) {
      const x = BENCH.x0 + 0.3 + i * 0.37;
      const kind = i % 3;
      if (kind === 0) k.box(0.04, 0.32, 0.02, 0x9a9aa0, { x, y: fy + 1.85, z: iz1 + 0.09, rz: 0.1 }, 'shiny');
      else if (kind === 1) {
        k.box(0.03, 0.14, 0.02, 0xc8202f, { x, y: fy + 1.95, z: iz1 + 0.09 }, 'shiny');
        k.box(0.01, 0.16, 0.015, 0xb8b8c0, { x, y: fy + 1.8, z: iz1 + 0.09 }, 'shiny');
      } else {
        k.box(0.03, 0.3, 0.02, 0x6a4a2a, { x, y: fy + 1.7, z: iz1 + 0.09 });
        k.box(0.14, 0.05, 0.04, 0x3a3a3e, { x, y: fy + 1.86, z: iz1 + 0.09 }, 'shiny');
      }
    }
    // Lamp: base, two arms, the shade with a lit bulb.
    const lx = BENCH.x1 - 0.35;
    k.cyl(0.1, 0.12, 0.04, 0x1a1a1e, { x: lx, y: fy + 0.96, z: BENCH.z - 0.25 }, 'shiny', 12);
    k.box(0.03, 0.5, 0.03, 0x1a1a1e, { x: lx, y: fy + 1.2, z: BENCH.z - 0.15, rx: 0.4 }, 'shiny');
    k.box(0.03, 0.45, 0.03, 0x1a1a1e, { x: lx - 0.12, y: fy + 1.5, z: BENCH.z + 0.08, rz: 0.9 }, 'shiny');
    k.cone(0.1, 0.16, 0xc8202f, { x: lx - 0.32, y: fy + 1.58, z: BENCH.z + 0.1, rz: 0.5 }, 'shiny', 12);
    glow.sphere(0.04, 0xfff4c0, { x: lx - 0.3, y: fy + 1.5, z: BENCH.z + 0.1 }, 'glow', 8, 6);
    glow.cyl(0.4, 0.4, 0.002, 0xfff0c0, { x: lx - 0.55, y: fy + 0.952, z: BENCH.z + 0.1 }, 'glow', 16);
    // Stool.
    k.cyl(0.2, 0.2, 0.05, 0x2a2a2e, { x: bx, y: fy + 0.7, z: BENCH.z + 0.9 }, 'shiny', 12);
    k.cyl(0.03, 0.03, 0.68, 0x8a8a90, { x: bx, y: fy + 0.34, z: BENCH.z + 0.9 }, 'shiny', 6);
    k.cyl(0.22, 0.24, 0.03, 0x3a3a3e, { x: bx, y: fy + 0.02, z: BENCH.z + 0.9 }, 'shiny', 12);
    // Featured plinth with a spotlight ring.
    k.box(1.0, 0.9, 1.0, s.counter, { x: 2.6, y: fy + 0.45, z: -4.4 }, 'shiny');
    k.box(1.06, 0.05, 1.06, s.trim, { x: 2.6, y: fy + 0.92, z: -4.4 }, 'shiny');
    glow.cyl(0.6, 0.6, 0.01, new THREE.Color(s.neon).getHex(), { x: 2.6, y: fy + CEIL - 0.02, z: -4.4 }, 'glow', 20);
    // Window display plinth.
    k.box(5.6, 0.5, 0.7, s.counter, { x: (WIN[0][0] + WIN[0][1]) / 2, y: fy + 0.25, z: -0.75 }, 'shiny');
    // The range wall: glass from the front of the lane back, a header above.
    k.box(0.08, 2.9, D - 2.9, 0xbfe0f0, { x: RANGE.x0, y: fy + 1.55, z: -2.6 - (D - 2.9) / 2 }, 'glass');
    for (let z = -2.6; z >= -D + 0.3; z -= 1.8) k.box(0.1, 3.0, 0.08, 0x3a3a3e, { x: RANGE.x0, y: fy + 1.5, z }, 'shiny');
    k.box(0.15, CEIL - 3.0, D - 0.3, 0x6a6a6e, { x: RANGE.x0, y: fy + 3.0 + (CEIL - 3.0) / 2, z: -D / 2 });
    k.box(0.12, 0.1, D - 2.9, 0x3a3a3e, { x: RANGE.x0, y: fy + 0.05, z: -2.6 - (D - 2.9) / 2 }, 'shiny');
    // Firing bench and the booth divider, baffles, the backstop.
    k.box(RANGE.x1 - RANGE.x0, 0.06, 0.6, 0x2a2a2e, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + 0.95, z: RANGE.bench }, 'shiny');
    k.box(RANGE.x1 - RANGE.x0, 0.9, 0.08, 0x4a4a50, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + 0.46, z: RANGE.bench - 0.26 });
    k.box(0.06, 2.2, 1.8, 0x5a5a60, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + 1.1, z: RANGE.bench + 0.6 });
    for (let z = -6; z > -D + 1; z -= 2) k.box(RANGE.x1 - RANGE.x0, 0.6, 0.1, 0x3a3a3e, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + CEIL - 0.4, z, rx: 0.6 });
    k.box(RANGE.x1 - RANGE.x0, 2.6, 0.2, 0x1a1a1e, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + 1.3, z: -D + 0.6, rx: -0.25 }, 'shiny');
    k.box(RANGE.x1 - RANGE.x0, 0.5, 1.0, 0x2a2420, { x: (RANGE.x0 + RANGE.x1) / 2, y: fy + 0.25, z: -D + 0.9 });
    // Target carrier rails.
    for (const x of [6.5, 9.3]) k.box(0.05, 0.05, D - 4, 0x8a8a90, { x, y: fy + 3.3, z: -D / 2 - 1.5 }, 'shiny');
    // Ear defenders on hooks by the lane.
    for (let i = 0; i < 3; i++) {
      k.torus(0.08, 0.015, 0xc8202f, { x: ix1 - 0.05, y: fy + 1.7, z: -0.9 - i * 0.35, ry: Math.PI / 2 }, 'shiny', Math.PI, 4, 8);
      for (const s2 of [-1, 1]) k.box(0.05, 0.08, 0.07, 0x1a1a1e, { x: ix1 - 0.06, y: fy + 1.62, z: -0.9 - i * 0.35 + s2 * 0.08 }, 'shiny');
    }
    this.interior.add(k.bake(), glow.bake());
    // Signs inside.
    const sign = (text: string, w: number, h: number, x: number, y: number, z: number, ry: number, bg: string, color = '#ffffff', size = 80) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: labelTexture(text, { width: 768, height: Math.round((768 * h) / w), color, bg, size, font: 'Bungee' }), toneMapped: false }));
      m.position.set(x, fy + y, z);
      m.rotation.y = ry;
      this.interior.add(m);
    };
    sign(this.store.name.toUpperCase(), 6, 0.7, -5.3, 3.75, iz1 + 0.08, 0, '#16161c', s.neon, 64);
    sign('GUNSMITH', 2.6, 0.5, bx, 2.75, iz1 + 0.08, 0, '#16161c', '#ffd23d', 90);
    sign('RANGE ▶', 1.6, 0.45, RANGE.x0 - 0.09, 3.3, -1.5, -Math.PI / 2, '#c8202f', '#ffffff', 90);
    sign('EYE & EAR PROTECTION REQUIRED', 3.2, 0.4, RANGE.x0 + 0.1, 3.3, -8, Math.PI / 2, '#f2c230', '#1a1a1e', 52);
    sign('AMMO', 1.6, 0.4, ix0 + 0.06, 2.6, -3.8, Math.PI / 2, '#16161c', '#ffd23d', 90);
    sign('HANDGUNS · SMGS', 3.2, 0.4, ix0 + 0.06, 3.4, -9.8, Math.PI / 2, '#16161c', '#ffffff', 64);
  }

  // ---------------------------------------------------------------- guns on display

  /** Put a weapon's default build on display, centred on (x, y, z), turned by (rz, then ry). */
  private show(id: string, x: number, y: number, z: number, ry: number, rz = 0, into: THREE.Object3D = this.detail): number {
    const b = buildWeapon(id, DEFAULT_LOADOUT);
    const box = new THREE.Box3().setFromObject(b.root);
    const c = box.getCenter(new THREE.Vector3());
    b.root.position.sub(c);
    const pivot = new THREE.Group();
    pivot.add(b.root);
    pivot.rotation.set(0, ry, rz, 'YXZ');
    pivot.position.set(x, y, z);
    into.add(pivot);
    return box.max.z - box.min.z;
  }

  private buildDisplays(): void {
    const fy = this.floorY;
    const stock = storeStock(this.store);
    const hand = stock.filter((w) => w.cls === 'pistol');
    const smgs = stock.filter((w) => w.cls === 'smg');
    const long = stock.filter((w) => !['pistol', 'smg', 'launcher', 'special'].includes(w.cls));
    const heavy = stock.filter((w) => w.cls === 'launcher' || w.cls === 'special');
    const cycle = <T,>(list: T[], i: number, fallback: T[]): T => (list.length ? list[i % list.length] : fallback[i % fallback.length]);
    const group = new THREE.Group();
    // Handguns in the counter cases, lying on their right side, muzzles to the left.
    let i = 0;
    for (let x = COUNTER.x0 + 0.35; x < COUNTER.x1 - 0.2; x += 0.55, i++) this.show(cycle(hand, i, stock).id, x, fy + 0.84, COUNTER.z + (i % 2 ? 0.12 : -0.12), Math.PI / 2, Math.PI / 2, group);
    for (let x = -5.9; x < -3.4; x += 0.6, i++) this.show(cycle(hand.length > 1 ? hand : smgs, i, stock).id, x, fy + 0.84, -4.5, Math.PI / 2, Math.PI / 2, group);
    // The pegboard: handguns and SMGs, right side out, muzzles to the back.
    const pegItems = [...hand, ...smgs];
    i = 0;
    for (let row = 0; row < 3; row++) {
      for (let z = -7.2; z > -12.6; z -= row === 2 ? 0.95 : 0.7, i++) this.show(cycle(row === 2 ? smgs : pegItems, i, stock).id, -W / 2 + 0.42, fy + 1.3 + row * 0.6, z, 0, 0, group);
    }
    // Back wall: long guns in rows, muzzles right; launchers along the top.
    const rows = [fy + 1.2, fy + 1.75, fy + 2.3, fy + 2.85];
    i = 0;
    rows.forEach((ry, r) => {
      let x = -10.4;
      for (let n = 0; n < 8; n++, i++) {
        const w = r === 3 && heavy.length ? cycle(heavy, n, stock) : cycle(long, i, stock);
        const b = buildWeapon(w.id, DEFAULT_LOADOUT);
        const len = new THREE.Box3().setFromObject(b.root).getSize(new THREE.Vector3()).z;
        b.dispose();
        if (x + len > -0.4) break;
        this.show(w.id, x + len / 2, ry, -D + 0.42, -Math.PI / 2, 0, group);
        x += len + 0.22;
      }
    });
    // Window: a few long guns on stands.
    for (let n = 0; n < 3; n++) this.show(cycle(long, n + 2, stock).id, -8.6 + n * 2.4, fy + 0.85, -0.8, -Math.PI / 2, -0.35, group);
    // Featured on the plinth.
    const feature = ['minigun', 'awm', 'aug', 'rifle'].find((id) => this.store.stock.includes(id)) ?? stock[0].id;
    this.show(feature, 2.6, fy + 1.25, -4.4, -Math.PI / 4, 0, group);
    // On the workbench, lying flat.
    this.show(cycle(long, 1, stock).id, (BENCH.x0 + BENCH.x1) / 2 + 0.2, fy + 1.0, BENCH.z + 0.05, Math.PI / 2, Math.PI / 2, group);
    // Bake the displays into a few meshes (they never move).
    markStatic(group);
    this.detail.add(group);
    mergeStatic(group, group);
  }

  private buildClerk(): void {
    const rng = mulberry32(this.store.key.length * 7919 + this.store.key.charCodeAt(4));
    const model = new CharacterModel(randomAppearance(rng, 'staff'));
    const anim = new Animator(model);
    model.root.position.set(-3.6, this.floorY, COUNTER.z - 1.1);
    model.root.rotation.y = 0;
    this.detail.add(model.root);
    this.clerk = { model, anim };
  }

  private buildRange(): void {
    const fy = this.floorY;
    const tex = targetTexture();
    for (const x of [6.5, 9.3]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, fy + 3.25, RANGE.targets);
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      card.position.y = -1.3;
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.03), new THREE.MeshLambertMaterial({ color: 0x3a3a3e }));
      clip.position.y = -0.83;
      const wire = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.8, 0.01), new THREE.MeshLambertMaterial({ color: 0x8a8a90 }));
      wire.position.y = -0.4;
      pivot.add(card, clip, wire);
      this.interior.add(pivot);
      const t = new Target(pivot);
      this.group.updateMatrixWorld(true);
      t.pos.copy(this.toWorld(x, RANGE.targets, fy + 1.5));
      this.targets.push(t);
      this.g.combat.targets.add(t);
    }
  }

  // ---------------------------------------------------------------- collision and use

  private box(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, cam = true): void {
    const a = this.toWorld(x0, z0, 0);
    const b = this.toWorld(x1, z1, 0);
    this.g.world.collision.addBox({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), minY: y0, maxY: y1, tag: `gunstore:${this.store.key}`, cam });
  }

  private collide(y: number): void {
    const fy = this.floorY;
    const top = y + H + 0.5;
    const t = 0.3;
    // Shell: the front either side of the door, sides, back, and the ceiling (for the camera).
    this.box(-W / 2, DOOR.x0, 0, -t, y - 1, top);
    this.box(DOOR.x1, W / 2, 0, -t, y - 1, top);
    this.box(DOOR.x0, DOOR.x1, 0, -t, fy + DOOR.h, top);
    this.box(-W / 2, -W / 2 + t, 0, -D, y - 1, top);
    this.box(W / 2 - t, W / 2, 0, -D, y - 1, top);
    this.box(-W / 2, W / 2, -D + t, -D, y - 1, top);
    this.box(-W / 2, W / 2, 0, -D, fy + CEIL, top);
    // The range glass and its header.
    this.box(RANGE.x0 - 0.08, RANGE.x0 + 0.08, -2.6, -D, y - 1, top);
    this.box(RANGE.x0, W / 2, RANGE.bench + 0.3, RANGE.bench - 0.35, y - 1, fy + 1.0, false);
    this.box(7.85, 7.95, RANGE.bench + 1.5, RANGE.bench + 0.3, y - 1, fy + 2.2, false);
    // Furniture.
    this.box(COUNTER.x0, COUNTER.x1, COUNTER.z + 0.4, COUNTER.z - 0.4, y - 1, fy + 1.12, false);
    this.box(-6.2, -3.2, -4.1, -4.9, y - 1, fy + 1.12, false);
    this.box(-W / 2, -W / 2 + 0.85, -1.4, -6.2, y - 1, fy + 2.3, false);
    this.box(BENCH.x0, BENCH.x1, BENCH.z + 0.45, -D, y - 1, fy + 0.95, false);
    this.box(2.1, 3.1, -3.9, -4.9, y - 1, fy + 1.6, false);
    this.box(WIN[0][0], WIN[0][1], -0.3, -1.1, y - 1, fy + 0.5, false);
    this.box(-4.0, -3.2, COUNTER.z - 0.7, COUNTER.z - 1.5, y - 1, fy + 1.8, false);
    // The floor.
    const a = this.toWorld(-W / 2, 0, 0);
    const b = this.toWorld(W / 2, -D, 0);
    this.g.world.collision.addFloor({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), y: () => fy, tag: `gunstore:${this.store.key}` });
  }

  private interactions(): void {
    const g = this.g;
    const key = this.store.key;
    const c = this.toWorld(-3.6, COUNTER.z + 1.0);
    g.interactions.add({ id: `gun:${key}:counter`, x: c.x, y: this.floorY, z: c.z, radius: 2.4, label: `Buy weapons at ${this.store.name}`, sub: this.store.tagline, action: () => g.ui.gunShop(key) });
    const w = this.toWorld((BENCH.x0 + BENCH.x1) / 2, BENCH.z + 1.3);
    g.interactions.add({
      id: `gun:${key}:bench`, x: w.x, y: this.floorY, z: w.z, radius: 1.8, priority: 1, label: 'Gunsmith workbench',
      sub: () => (g.armory.owned.length ? 'Parts, camos, sights and your crosshair' : 'Buy a weapon at the counter first'),
      action: () => g.ui.gunsmith(key),
    });
    const r = this.toWorld((RANGE.x0 + RANGE.x1) / 2, RANGE.bench + 0.9);
    g.interactions.add({
      id: `gun:${key}:range`, x: r.x, y: this.floorY, z: r.z, radius: 1.8, label: 'Shooting range',
      sub: () => (g.armory.owned.length ? 'Guns are allowed on the lane: hold Tab for the weapon wheel' : 'Buy a weapon at the counter first'),
      enabled: () => !g.combat.armed,
      action: () => {
        const id = g.armory.owned[g.armory.owned.length - 1];
        if (id) g.combat.draw(id);
        else g.hud.toast('Buy a weapon at the counter first', 'bad');
      },
    });
  }

  update(dt: number): void {
    const cam = this.g.renderer.camera.position;
    const b = this.bounds;
    const d = Math.hypot(Math.max(b.minX - cam.x, 0, cam.x - b.maxX), Math.max(b.minZ - cam.z, 0, cam.z - b.maxZ));
    this.interior.visible = d < 60;
    this.far.visible = !this.interior.visible;
    this.detail.visible = d < 30;
    if (this.detail.visible && this.clerk) {
      this.clerk.anim.update(dt);
      this.clerk.model.updateLod(d);
    }
    if (this.interior.visible) {
      for (const t of this.targets) {
        if (t.swing <= 0) continue;
        t.swing = Math.max(0, t.swing - dt * 0.9);
        t.pivot.rotation.x = Math.sin(t.swing * 18) * t.swing * 0.5;
      }
    }
  }
}

function pegboardTexture(bg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 4; y < c.height; y += 8) for (let x = 4; x < c.width; x += 8) g.fillRect(x, y, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let targetTex: THREE.CanvasTexture | null = null;
function targetTexture(): THREE.CanvasTexture {
  if (targetTex) return targetTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4efe2';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#1a1a1e';
  g.beginPath();
  g.arc(64, 44, 26, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(64, 140, 52, 60, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f4efe2';
  g.lineWidth = 2;
  for (let r = 10; r < 60; r += 12) {
    g.beginPath();
    g.ellipse(64, 130, r, r * 1.1, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#c8202f';
  g.beginPath();
  g.arc(64, 130, 7, 0, Math.PI * 2);
  g.fill();
  targetTex = new THREE.CanvasTexture(c);
  targetTex.colorSpace = THREE.SRGBColorSpace;
  return targetTex;
}

/** All the gun stores, and the questions the rest of the game asks about them. */
export class GunStores {
  readonly list: GunStoreBuilding[] = [];

  constructor(g: Game) {
    for (const s of GUN_STORES) {
      const lot = g.world.terrain.lots.find((l) => l.special === s.key);
      if (lot) this.list.push(new GunStoreBuilding(g, s, lot));
    }
  }

  get sites(): GunStoreSite[] {
    return this.list.map((b) => b.site);
  }

  site(key: string): GunStoreSite | undefined {
    return this.list.find((b) => b.store.key === key)?.site;
  }

  /** Guns stay holstered here (inside a store, off the range lane). */
  noGuns(x: number, z: number): boolean {
    for (const b of this.list) if (b.inside(x, z) && !b.onRange(x, z)) return true;
    return false;
  }

  /** The store you're standing in. */
  at(x: number, z: number): GunStoreBuilding | null {
    return this.list.find((b) => b.inside(x, z)) ?? null;
  }

  update(dt: number): void {
    for (const b of this.list) b.update(dt);
  }
}
