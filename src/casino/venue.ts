import * as THREE from 'three';
import { Kit } from '../render/kit';
import { labelTexture } from '../render/signs';
import { facadeTextures } from '../render/facades';
import type { Collision } from '../world/collision';
import type { TableBase } from './table';
import { lotFrontPoint, type Lot } from '../world/layout';
import { mulberry32 } from '../core/noise';
import { mergeStatic } from '../render/mergeStatic';

/**
 * A casino (or bar, or club) building you can walk into: an exterior with a neon sign, a
 * marquee and a canopy, and an interior with patterned carpet, ceiling lights, chandeliers,
 * a bar and a cashier's cage, plus whatever tables and machines are placed inside. Used for
 * the island's own casinos and for the ones you build.
 */

export interface VenueTheme {
  carpet: [string, string, string];
  wall: number;
  trim: number;
  accent: number;
  neon: string;
  facade: number;
  ceiling: number;
}

export const THEMES: Record<string, VenueTheme> = {
  viper: { carpet: ['#14100a', '#c8962a', '#3a2a10'], wall: 0x1c1a16, trim: 0xd8a83a, accent: 0x2bd96b, neon: '#ffd23d', facade: 0x1a1a1a, ceiling: 0x14120e },
  lagoon: { carpet: ['#0d4a5a', '#ff6fae', '#13a0a0'], wall: 0x0f5a66, trim: 0xffc6e0, accent: 0xff6fae, neon: '#3fe0ff', facade: 0xbff0ee, ceiling: 0x0b3a44 },
  royal: { carpet: ['#2a0f4a', '#f2c230', '#5a1f8a'], wall: 0x2a1240, trim: 0xf2c230, accent: 0xb36bff, neon: '#d68bff', facade: 0x3a1a5a, ceiling: 0x1a0a2a },
  tavern: { carpet: ['#4a2a18', '#d8b04a', '#6a3a20'], wall: 0x6a4428, trim: 0xc89a5a, accent: 0xff7a2f, neon: '#ff7a2f', facade: 0x8a6a48, ceiling: 0x3a2414 },
  classic: { carpet: ['#6a0f1a', '#f2c230', '#2a0a10'], wall: 0x4a0f18, trim: 0xf2c230, accent: 0xff3b3b, neon: '#ff3fa4', facade: 0xf2e6d0, ceiling: 0x2a0a10 },
  neon: { carpet: ['#0b0b1e', '#3fe0ff', '#ff3fa4'], wall: 0x0e0e24, trim: 0x3fe0ff, accent: 0xff3fa4, neon: '#3fe0ff', facade: 0x15152e, ceiling: 0x08081a },
};

function carpetTexture(c: [string, string, string], seed: number): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = c[0];
  g.fillRect(0, 0, S, S);
  const r = mulberry32(seed);
  // Diamond lattice.
  g.strokeStyle = c[2];
  g.lineWidth = 6;
  for (let i = -S; i <= S * 2; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + S, S);
    g.moveTo(i, S);
    g.lineTo(i + S, 0);
    g.stroke();
  }
  // Medallions at the crossings and swirls in between.
  for (let y = 0; y <= S; y += 64) {
    for (let x = (y / 64) % 2 ? 32 : 0; x <= S; x += 64) {
      g.fillStyle = c[1];
      g.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rr = k % 2 ? 6 : 13;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    }
  }
  g.strokeStyle = c[1];
  g.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const x = r() * S;
    const y = r() * S;
    g.beginPath();
    g.arc(x, y, 8 + r() * 10, r() * 6, r() * 6 + 3);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export interface PlacedTable {
  table: TableBase;
  x: number;
  z: number;
  yaw: number;
}

export interface VenueOpts {
  id: string;
  name: string;
  theme: VenueTheme;
  lot: Lot;
  y: number;
  /** Hall size (metres). */
  width: number;
  depth: number;
  height?: number;
  /** Floors of hotel tower drawn above/behind (just the shell). */
  tower?: number;
  sign?: { font?: string; color?: string };
  bar?: boolean;
  cashier?: boolean;
  seed?: number;
  /** Extra furnishings (bars, restaurants, clubs, shops, lobbies). */
  decor?: (v: Venue, k: Kit, glow: Kit) => void;
}

/** A building with an interior. Tables are added after construction. */
export class Venue {
  readonly group = new THREE.Group();
  /** Interior contents (hidden when you're far away). */
  readonly interior = new THREE.Group();
  /** Tables and machines (rebuilt as a whole when your floor changes). */
  readonly tablesRoot = new THREE.Group();
  /** Ceiling, roof and tower: hidden for the top-down floor editor. */
  readonly top = new THREE.Group();
  readonly tables: PlacedTable[] = [];
  readonly W: number;
  readonly D: number;
  readonly H: number;
  /** World-space footprint of the hall (for "am I inside?" and the minimap). */
  readonly bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  readonly floorY: number;
  private glowMats: THREE.Material[] = [];
  readonly door = new THREE.Vector3();
  readonly yaw: number;
  private tag: string;

  constructor(readonly opts: VenueOpts, private collision: Collision) {
    const lot = opts.lot;
    this.W = opts.width;
    this.D = opts.depth;
    this.H = opts.height ?? 7;
    this.tag = `venue:${opts.id}`;
    const fp = lotFrontPoint(lot);
    this.yaw = fp.yaw;
    // The hall's front sits a few metres back from the lot edge (room for the canopy).
    const setback = 9;
    const fx = fp.x - Math.sin(fp.yaw) * setback;
    const fz = fp.z - Math.cos(fp.yaw) * setback;
    this.floorY = opts.y + 0.18;
    this.group.position.set(fx, 0, fz);
    this.group.rotation.y = fp.yaw;
    this.group.add(this.interior);
    this.interior.add(this.tablesRoot);
    this.group.add(this.top);
    this.group.updateMatrixWorld(true);
    const corners = [new THREE.Vector3(-this.W / 2, 0, 0), new THREE.Vector3(this.W / 2, 0, 0), new THREE.Vector3(-this.W / 2, 0, -this.D), new THREE.Vector3(this.W / 2, 0, -this.D)].map((v) => this.group.localToWorld(v));
    this.bounds.minX = Math.min(...corners.map((c) => c.x));
    this.bounds.maxX = Math.max(...corners.map((c) => c.x));
    this.bounds.minZ = Math.min(...corners.map((c) => c.z));
    this.bounds.maxZ = Math.max(...corners.map((c) => c.z));
    this.door.copy(this.group.localToWorld(new THREE.Vector3(0, this.floorY, 1.5)));
    this.door.y = this.floorY;
    this.build();
  }

  /** Local point to world (on the floor). */
  toWorld(x: number, z: number): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(x, this.floorY, z));
  }

  /** Is a world point inside the hall? */
  contains(x: number, z: number, margin = 0): boolean {
    const p = this.group.worldToLocal(new THREE.Vector3(x, 0, z));
    return p.x > -this.W / 2 - margin && p.x < this.W / 2 + margin && p.z < margin && p.z > -this.D - margin;
  }

  private build(): void {
    const { W, D, H } = this;
    const th = this.opts.theme;
    const y = this.floorY;
    const ext = new Kit();
    const int = new Kit();
    const top = new Kit();
    const topGlow = new Kit();
    const doorW = 8;
    const wallT = 0.4;
    // Floor slab and carpet.
    ext.box(W + 1, 0.4, D + 1, 0x8a8478, { x: 0, y: y - 0.2, z: -D / 2 });
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: carpetTexture(th.carpet, this.opts.seed ?? 3) }));
    (carpet.material as THREE.MeshLambertMaterial).map!.repeat.set(W / 4, D / 4);
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(0, y + 0.01, -D / 2);
    carpet.receiveShadow = true;
    this.interior.add(carpet);
    // Walls with the door gap in the front.
    const wall = (x: number, z: number, w: number, d: number) => {
      int.box(w, H, d, th.wall, { x, y: y + H / 2, z });
      const wp = this.group.localToWorld(new THREE.Vector3(x, 0, z));
      const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
      const ww = rot ? d : w;
      const dd = rot ? w : d;
      this.collision.addBox({ minX: wp.x - ww / 2, maxX: wp.x + ww / 2, minZ: wp.z - dd / 2, maxZ: wp.z + dd / 2, minY: y - 1, maxY: y + H + 6, tag: this.tag });
    };
    const side = (W - doorW) / 2;
    wall(-(doorW / 2 + side / 2), 0, side, wallT);
    wall(doorW / 2 + side / 2, 0, side, wallT);
    wall(0, -D, W, wallT);
    wall(-W / 2, -D / 2, wallT, D);
    wall(W / 2, -D / 2, wallT, D);
    // Wainscot and gold trim inside.
    for (const [x, z, w, d] of [[0, -D + 0.25, W - 0.6, 0.1], [-W / 2 + 0.25, -D / 2, 0.1, D - 0.6], [W / 2 - 0.25, -D / 2, 0.1, D - 0.6]] as const) {
      int.box(w, 1.1, d, th.trim === 0xf2c230 ? 0x3a2410 : 0x2a2a2a, { x, y: y + 0.55, z });
      int.box(w, 0.08, d + 0.04, th.trim, { x, y: y + 1.12, z }, 'shiny');
      int.box(w, 0.12, d + 0.04, th.trim, { x, y: y + H - 0.3, z }, 'shiny');
    }
    // Ceiling with glowing coffers and chandeliers.
    top.box(W, 0.3, D, th.ceiling, { x: 0, y: y + H + 0.15, z: -D / 2 });
    const glow = new Kit();
    for (let gx = -W / 2 + 4; gx <= W / 2 - 4; gx += 6) {
      for (let gz = -D + 4; gz <= -3; gz += 6) {
        topGlow.box(3.2, 0.06, 3.2, 0xfff1d0, { x: gx, y: y + H - 0.02, z: gz }, 'glow');
        top.box(3.6, 0.2, 3.6, th.trim, { x: gx, y: y + H - 0.05, z: gz }, 'shiny');
      }
    }
    const chandeliers = Math.max(1, Math.floor(W / 14));
    for (let i = 0; i < chandeliers; i++) {
      const cx = -W / 2 + ((i + 0.5) * W) / chandeliers;
      const cz = -D / 2;
      int.cyl(0.03, 0.03, 1.4, th.trim, { x: cx, y: y + H - 0.7, z: cz }, 'shiny', 6);
      int.torus(0.9, 0.05, th.trim, { x: cx, y: y + H - 1.5, z: cz, rx: Math.PI / 2 }, 'shiny', Math.PI * 2, 6, 24);
      int.torus(0.55, 0.04, th.trim, { x: cx, y: y + H - 1.15, z: cz, rx: Math.PI / 2 }, 'shiny', Math.PI * 2, 6, 20);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        glow.sphere(0.09, 0xfff4d8, { x: cx + Math.cos(a) * 0.9, y: y + H - 1.62, z: cz + Math.sin(a) * 0.9 }, 'glow', 6, 4);
        if (k % 2 === 0) glow.cone(0.06, 0.35, 0xe8f6ff, { x: cx + Math.cos(a) * 0.55, y: y + H - 1.38, z: cz + Math.sin(a) * 0.55, rx: Math.PI }, 'glow', 5);
      }
    }
    // Columns with neon rings.
    for (const sx of [-1, 1]) {
      for (let cz = -8; cz > -D + 4; cz -= 12) {
        const cx = sx * (W / 2 - 5);
        int.cyl(0.45, 0.45, H, th.trim === 0xf2c230 || th.trim === 0xd8a83a ? 0xd8a83a : th.trim, { x: cx, y: y + H / 2, z: cz }, 'shiny', 18);
        glow.torus(0.47, 0.04, th.accent, { x: cx, y: y + 2.2, z: cz, rx: Math.PI / 2 }, 'glow', Math.PI * 2, 4, 20);
        glow.torus(0.47, 0.04, th.accent, { x: cx, y: y + H - 1, z: cz, rx: Math.PI / 2 }, 'glow', Math.PI * 2, 4, 20);
        const wp = this.toWorld(cx, cz);
        this.collision.addCircle({ x: wp.x, z: wp.z, r: 0.5, minY: y - 1, maxY: y + H, tag: this.tag });
      }
    }
    // Bar along the back-left, cashier at the back-right.
    if (this.opts.bar !== false) this.buildBar(int, glow, -W / 2 + 7, -D + 3.2);
    if (this.opts.cashier !== false) this.buildCashier(int, glow, W / 2 - 6, -D + 2.2);
    this.opts.decor?.(this, int, glow);
    // Exterior shell: facade boxes outside the walls, roof, canopy, marquee, sign.
    this.buildExterior(ext, glow, top, topGlow);
    this.top.add(top.bake({ shadows: true }), topGlow.bake());
    const exterior = ext.bake({ shadows: true });
    this.group.add(exterior);
    this.interior.add(int.bake({ shadows: false }));
    const g = glow.bake();
    this.group.add(g);
    // Walkable floor for the hall and the entrance apron.
    const b = this.bounds;
    this.collision.addFloor({ minX: b.minX - 0.5, maxX: b.maxX + 0.5, minZ: b.minZ - 0.5, maxZ: b.maxZ + 0.5, y: () => y, tag: this.tag });
  }

  private buildBar(int: Kit, glow: Kit, x: number, z: number): void {
    const th = this.opts.theme;
    const y = this.floorY;
    int.rbox(9, 1.1, 0.9, 0.12, 0x2a1a10, { x, y: y + 0.55, z: z + 1.4 }, 'shiny');
    int.rbox(9.2, 0.08, 1.1, 0.04, 0x111111, { x, y: y + 1.12, z: z + 1.45 }, 'shiny');
    glow.box(9, 0.05, 0.05, th.accent, { x, y: y + 0.2, z: z + 1.86 }, 'glow');
    // Back shelves with bottles.
    int.box(9, 2.6, 0.4, 0x1a1008, { x, y: y + 1.3, z: z - 0.6 });
    for (let s = 0; s < 3; s++) {
      int.box(8.6, 0.05, 0.45, th.trim, { x, y: y + 1.0 + s * 0.6, z: z - 0.4 }, 'shiny');
      for (let b = 0; b < 16; b++) {
        const col = [0x3fae6a, 0xc8902a, 0x7a2a1a, 0xe8e0c0, 0x2a6ab8, 0xd8402f][(b + s) % 6];
        glow.cyl(0.04, 0.045, 0.28, col, { x: x - 4 + b * 0.53, y: y + 1.17 + s * 0.6, z: z - 0.38 }, 'glow', 6);
      }
    }
    for (let i = 0; i < 6; i++) {
      int.cyl(0.03, 0.03, 0.75, 0xc8ccd2, { x: x - 3.7 + i * 1.5, y: y + 0.375, z: z + 2.3 }, 'shiny', 6);
      int.cyl(0.2, 0.2, 0.08, 0x7a1020, { x: x - 3.7 + i * 1.5, y: y + 0.78, z: z + 2.3 }, 'matte', 14);
    }
    const wp = this.toWorld(x, z + 1.4);
    const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
    this.collision.addBox({ minX: wp.x - (rot ? 0.5 : 4.6), maxX: wp.x + (rot ? 0.5 : 4.6), minZ: wp.z - (rot ? 4.6 : 0.5), maxZ: wp.z + (rot ? 4.6 : 0.5), minY: y - 1, maxY: y + 1.2, tag: this.tag });
  }

  private buildCashier(int: Kit, glow: Kit, x: number, z: number): void {
    const th = this.opts.theme;
    const y = this.floorY;
    int.box(7, 1.15, 0.7, 0x2a2420, { x, y: y + 0.575, z: z + 1.0 }, 'shiny');
    int.box(7.1, 0.06, 0.8, th.trim, { x, y: y + 1.18, z: z + 1.0 }, 'shiny');
    for (let i = 0; i <= 20; i++) int.cyl(0.015, 0.015, 1.2, th.trim, { x: x - 3.5 + i * 0.35, y: y + 1.8, z: z + 1.0 }, 'shiny', 5);
    int.box(7.1, 0.12, 0.2, th.trim, { x, y: y + 2.45, z: z + 1.0 }, 'shiny');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture('CASHIER', { width: 512, height: 102, color: '#ffd23d', bg: '#140c06', glow: '#ffd23d', size: 70 }), toneMapped: false }));
    sign.position.set(x, y + 2.9, z + 1.05);
    this.interior.add(sign);
    glow.box(7, 0.05, 0.05, th.accent, { x, y: y + 2.55, z: z + 1.12 }, 'glow');
    const wp = this.toWorld(x, z + 1.0);
    const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
    this.collision.addBox({ minX: wp.x - (rot ? 0.4 : 3.6), maxX: wp.x + (rot ? 0.4 : 3.6), minZ: wp.z - (rot ? 3.6 : 0.4), maxZ: wp.z + (rot ? 3.6 : 0.4), minY: y - 1, maxY: y + 3, tag: this.tag });
  }

  private buildExterior(ext: Kit, glow: Kit, top: Kit, topGlow: Kit): void {
    const { W, D, H } = this;
    const th = this.opts.theme;
    const y = this.floorY;
    const facadeH = H + 5;
    const doorW = 8;
    // Outer skin (a touch outside the walls), parapet and roof.
    const skin = th.facade;
    const side = (W - doorW) / 2;
    ext.box(side, facadeH, 0.3, skin, { x: -(doorW / 2 + side / 2), y: y + facadeH / 2, z: 0.35 });
    ext.box(side, facadeH, 0.3, skin, { x: doorW / 2 + side / 2, y: y + facadeH / 2, z: 0.35 });
    ext.box(doorW, facadeH - H, 0.3, skin, { x: 0, y: y + H + (facadeH - H) / 2, z: 0.35 });
    ext.box(0.3, H + 1, D, skin, { x: -W / 2 - 0.35, y: y + (H + 1) / 2, z: -D / 2 });
    ext.box(0.3, H + 1, D, skin, { x: W / 2 + 0.35, y: y + (H + 1) / 2, z: -D / 2 });
    ext.box(W + 1, H + 1, 0.3, skin, { x: 0, y: y + (H + 1) / 2, z: -D - 0.35 });
    top.box(W + 1, 0.4, D + 1, 0xb8b4ac, { x: 0, y: y + H + 0.5, z: -D / 2 });
    // Gold doorframe and glass doors (open).
    ext.box(doorW + 0.6, 0.5, 0.6, th.trim, { x: 0, y: y + 3.6, z: 0.3 }, 'shiny');
    for (const s of [-1, 1]) {
      ext.box(0.5, 3.6, 0.6, th.trim, { x: s * (doorW / 2 + 0.05), y: y + 1.8, z: 0.3 }, 'shiny');
      ext.box(1.8, 3.2, 0.06, 0x9ccfe8, { x: s * (doorW / 2 - 1.1), y: y + 1.6, z: 0.75, ry: s * 1.2 }, 'glass');
    }
    // Front steps and red carpet.
    ext.box(doorW + 4, 0.18, 3, 0xd8d2c4, { x: 0, y: y - 0.09, z: 1.6 });
    ext.box(3, 0.02, 9, 0xb8202f, { x: 0, y: y + 0.01, z: 4 });
    // Canopy (porte-cochère) with chasing bulbs underneath.
    const cw = Math.min(W - 4, 24);
    ext.box(cw, 0.8, 7, th.facade === 0x1a1a1a ? 0x111111 : 0xf8f4ea, { x: 0, y: y + 5.6, z: 4.2 });
    glow.box(cw + 0.2, 0.25, 7.2, th.accent, { x: 0, y: y + 5.1, z: 4.2 }, 'glow');
    for (let i = 0; i < Math.floor(cw / 0.8); i++) glow.sphere(0.07, 0xfff1c8, { x: -cw / 2 + 0.4 + i * 0.8, y: y + 5.05, z: 7.75 }, 'glow', 6, 4);
    for (const s of [-1, 1]) {
      ext.cyl(0.35, 0.35, 5.2, th.trim, { x: s * (cw / 2 - 1), y: y + 2.6, z: 7 }, 'shiny', 14);
    }
    // Neon outline of the facade.
    glow.box(W + 1.2, 0.18, 0.18, th.accent, { x: 0, y: y + facadeH - 0.2, z: 0.55 }, 'glow');
    glow.box(0.18, facadeH, 0.18, th.accent, { x: -W / 2 - 0.5, y: y + facadeH / 2, z: 0.55 }, 'glow');
    glow.box(0.18, facadeH, 0.18, th.accent, { x: W / 2 + 0.5, y: y + facadeH / 2, z: 0.55 }, 'glow');
    // The name in lights.
    const tex = labelTexture(this.opts.name.toUpperCase(), { width: 1024, height: 200, font: this.opts.sign?.font ?? 'Bungee', color: this.opts.sign?.color ?? '#ffffff', glow: th.neon, stroke: th.neon, strokeWidth: 6, size: 130 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W - 2, 26), Math.min(W - 2, 26) * 0.19), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    sign.position.set(0, y + H + 2.4, 0.55);
    this.group.add(sign);
    this.glowMats.push(sign.material as THREE.Material);
    // Optional hotel tower behind.
    if (this.opts.tower) {
      const tw = Math.min(W - 6, 36);
      const td = 16;
      const tH = this.opts.tower * 3.3;
      const f = facadeTextures('hotel');
      const tmat = new THREE.MeshPhongMaterial({ map: f.map.clone(), emissiveMap: f.emissive.clone(), emissive: 0xffffff, emissiveIntensity: 0.0, shininess: 70, specular: 0x667788 });
      tmat.map!.repeat.set(tw / 25.6, tH / 25.6);
      tmat.emissiveMap!.repeat.set(tw / 25.6, tH / 25.6);
      tmat.map!.needsUpdate = tmat.emissiveMap!.needsUpdate = true;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, tH, td), tmat);
      tower.position.set(0, y + H + 1 + tH / 2, -D + td / 2 + 2);
      tower.castShadow = true;
      this.top.add(tower);
      this.towerMat = tmat;
      topGlow.box(tw + 0.4, 1.2, td + 0.4, th.accent, { x: 0, y: y + H + 1 + tH - 0.6, z: -D + td / 2 + 2 }, 'glow');
      const wp = this.toWorld(0, -D + td / 2 + 2);
      const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
      this.collision.addBox({ minX: wp.x - (rot ? td : tw) / 2, maxX: wp.x + (rot ? td : tw) / 2, minZ: wp.z - (rot ? tw : td) / 2, maxZ: wp.z + (rot ? tw : td) / 2, minY: y + H, maxY: y + H + 1 + tH, tag: this.tag });
    }
    // Palms in planters by the doors.
    for (const s of [-1, 1]) {
      ext.cyl(0.8, 0.7, 0.9, th.trim, { x: s * (doorW / 2 + 3), y: y + 0.45, z: 2.2 }, 'shiny', 14);
      ext.sphere(0.9, 0x3fae3a, { x: s * (doorW / 2 + 3), y: y + 1.4, z: 2.2, sy: 0.8 });
    }
  }

  private towerMat: THREE.MeshPhongMaterial | null = null;

  /** Place a table (local position and facing). Seats get "sit down" interactions from the game. */
  addTable(table: TableBase, x: number, z: number, yaw: number): PlacedTable {
    table.group.position.set(x, this.floorY, z);
    table.group.rotation.y = yaw;
    this.tablesRoot.add(table.group);
    this.interior.updateMatrixWorld(true);
    const p = { table, x, z, yaw };
    this.tables.push(p);
    // A rough collider for the table body.
    const wp = this.toWorld(x, z);
    this.collision.addCircle({ x: wp.x, z: wp.z, r: table.kind === 'craps' ? 1.6 : table.kind === 'roulette' ? 1.4 : table.kind === 'slots' || table.kind === 'videopoker' ? 0.45 : 1.15, minY: this.floorY - 1, maxY: this.floorY + 1, tag: `${this.tag}:tables` });
    return p;
  }

  /** Take every table and machine away (before rebuilding a floor). */
  clearTables(): void {
    for (const t of this.tables) if (t.table.host) t.table.exit();
    this.tables.length = 0;
    for (const c of [...this.tablesRoot.children]) {
      c.removeFromParent();
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.userData.merged) m.geometry.dispose();
      });
    }
    this.collision.removeTagged(`${this.tag}:tables`);
  }

  /** Remove the whole building (and its colliders). */
  dispose(): void {
    this.clearTables();
    this.group.removeFromParent();
    this.collision.removeTagged(this.tag);
  }

  /** Merge every table's static parts into a few meshes (call after placing tables). */
  finalize(): void {
    mergeStatic(this.tablesRoot, this.tablesRoot);
  }

  /** Lift the lid off (ceiling, roof, tower) so the floor can be seen from above. */
  setCutaway(on: boolean): void {
    this.top.visible = !on;
  }

  update(night: number, near: boolean): void {
    this.interior.visible = near;
    if (this.towerMat) this.towerMat.emissiveIntensity = night * 1.1;
  }
}
