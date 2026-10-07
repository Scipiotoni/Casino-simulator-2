import * as THREE from 'three';
import { BAYS, FLOORS, MODULE, facadeTextures, roofTexture, shopfrontTexture, type FacadeStyle } from '../render/facades';
import { Kit, SLOT_MATERIALS, type Slot } from '../render/kit';
import { lotRng, type Lot } from './layout';
import type { Terrain } from './terrain';
import type { Collision } from './collision';
import { withRim } from '../render/materials';

/**
 * The city's own buildings: every lot that isn't for sale or reserved for a story building
 * gets a building in its district's style (glass towers downtown, resort hotels on the
 * Strip, pastel art deco by the beach, warehouses at the harbor, houses in Palm Heights,
 * cottages in Coral Cove). Facades are textured boxes merged per city quarter and style,
 * with rooftop clutter and neon in one more merged mesh each.
 */

type MatKey = FacadeStyle | 'shop' | 'roof';

const PASTELS = [0xffc6c6, 0xbfe9d9, 0xfff0b0, 0xffd8b0, 0xc6dcff, 0xe6ccff, 0xffffff, 0xd7f5ff];
const HOUSE_COLORS = [0xfff6e8, 0xffe1c4, 0xd9eef7, 0xe8f3d6, 0xfde2e4, 0xf3e6c8, 0xffffff];
const ROOF_COLORS = [0xb5452f, 0x8f3b2b, 0x4a5568, 0x6b4f3a, 0x2f6f73, 0x9c5a33];
const NEON = [0xff3fa4, 0x3fe0ff, 0xffd23d, 0x7cff5a, 0xb36bff, 0xff7a2f];

class FacadeBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** One wall from (x0,z0) to (x1,z1), bottom y0 to top y1, facing outward (right of the edge). */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: FacadeStyle | 'shop', tint: THREE.Color, ou: number, ov: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mod = style === 'shop' ? { bay: 4.5, floor: 4.2 } : MODULE[style];
    const uScale = style === 'shop' ? 4 : BAYS;
    const vScale = style === 'shop' ? 1 : FLOORS;
    const u0 = ou;
    const u1 = ou + len / (mod.bay * uScale);
    const v0 = ov;
    const v1 = ov + (y1 - y0) / (mod.floor * vScale);
    const nx = (z1 - z0) / len;
    const nz = -(x1 - x0) / len;
    const b = this.pos.length / 3;
    this.pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
    for (let i = 0; i < 4; i++) {
      this.nor.push(nx, 0, nz);
      this.col.push(tint.r, tint.g, tint.b);
    }
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }

  /** Flat horizontal quad (roofs). */
  top(x0: number, z0: number, x1: number, z1: number, y: number, tint: THREE.Color): void {
    const b = this.pos.length / 3;
    this.pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
    for (let i = 0; i < 4; i++) {
      this.nor.push(0, 1, 0);
      this.col.push(tint.r, tint.g, tint.b);
    }
    this.uv.push(x0 / 12, z0 / 12, x0 / 12, z1 / 12, x1 / 12, z1 / 12, x1 / 12, z0 / 12);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
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

interface Quarter {
  key: string;
  facades: Map<MatKey, FacadeBuilder>;
  kit: Kit;
  group: THREE.Group;
  cx: number;
  cz: number;
  maxH: number;
}

const _tint = new THREE.Color();

export class CityBuildings {
  readonly group = new THREE.Group();
  readonly materials = new Map<MatKey, THREE.MeshLambertMaterial | THREE.MeshPhongMaterial>();
  private quarters = new Map<string, Quarter>();
  /** Lots with a city building on them (and its footprint, for the minimap). */
  readonly footprints: { lot: Lot; x0: number; x1: number; z0: number; z1: number; h: number }[] = [];

  constructor(private terrain: Terrain, private collision: Collision) {
    for (const style of ['glassBlue', 'glassTeal', 'office', 'brick', 'stucco', 'deco', 'warehouse', 'house', 'hotel'] as FacadeStyle[]) {
      const t = facadeTextures(style);
      const glassy = style === 'glassBlue' || style === 'glassTeal' || style === 'hotel';
      const m = glassy
        ? new THREE.MeshPhongMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, shininess: 80, specular: 0x667788 })
        : withRim(new THREE.MeshLambertMaterial({ map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true }), 0.4);
      this.materials.set(style, m);
    }
    const shop = shopfrontTexture();
    this.materials.set('shop', new THREE.MeshLambertMaterial({ map: shop.map, emissiveMap: shop.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true }));
    this.materials.set('roof', new THREE.MeshLambertMaterial({ map: roofTexture(), vertexColors: true }));

    for (const lot of terrain.lots) {
      if (lot.forSale || lot.special) continue;
      this.buildLot(lot);
    }
    for (const q of this.quarters.values()) this.bakeQuarter(q);
  }

  private quarter(x: number, z: number): Quarter {
    const key = `${Math.floor(x / 500)}:${Math.floor(z / 500)}`;
    let q = this.quarters.get(key);
    if (!q) {
      q = { key, facades: new Map(), kit: new Kit(), group: new THREE.Group(), cx: (Math.floor(x / 500) + 0.5) * 500, cz: (Math.floor(z / 500) + 0.5) * 500, maxH: 0 };
      this.quarters.set(key, q);
    }
    return q;
  }

  private fb(q: Quarter, k: MatKey): FacadeBuilder {
    let b = q.facades.get(k);
    if (!b) q.facades.set(k, (b = new FacadeBuilder()));
    return b;
  }

  /** A textured box section: four walls and a roof. */
  private section(q: Quarter, style: FacadeStyle, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tint: number, r: () => number, roofTint = 0xe4e0d8): void {
    const b = this.fb(q, style);
    _tint.setHex(tint);
    const ou = Math.floor(r() * BAYS) / BAYS;
    const ov = Math.floor(r() * FLOORS) / FLOORS;
    // Walls go round clockwise seen from above so each faces outward.
    b.wall(x0, z0, x1, z0, y0, y1, style, _tint, ou, ov);
    b.wall(x1, z0, x1, z1, y0, y1, style, _tint, ou + 0.37, ov);
    b.wall(x1, z1, x0, z1, y0, y1, style, _tint, ou + 0.61, ov);
    b.wall(x0, z1, x0, z0, y0, y1, style, _tint, ou + 0.13, ov);
    this.fb(q, 'roof').top(x0, z0, x1, z1, y1, _tint.setHex(roofTint));
    q.maxH = Math.max(q.maxH, y1);
  }

  private shopBand(q: Quarter, x0: number, z0: number, x1: number, z1: number, y0: number, h: number): void {
    const b = this.fb(q, 'shop');
    _tint.setHex(0xffffff);
    b.wall(x0, z0, x1, z0, y0, y0 + h, 'shop', _tint, 0, 0);
    b.wall(x1, z0, x1, z1, y0, y0 + h, 'shop', _tint, 0.25, 0);
    b.wall(x1, z1, x0, z1, y0, y0 + h, 'shop', _tint, 0.5, 0);
    b.wall(x0, z1, x0, z0, y0, y0 + h, 'shop', _tint, 0.75, 0);
  }

  private collide(lot: Lot, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): void {
    this.collision.addBox({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0 - 1, maxY: y1, tag: `city:${lot.id}` });
  }

  /** Parapet, rooftop units, tanks and antennas on a flat roof. */
  private roofClutter(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, r: () => number, tall: boolean): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const par = 0xd8d4cc;
    k.box(w, 0.9, 0.35, par, { x: cx, y: y + 0.45, z: z0 + 0.17 });
    k.box(w, 0.9, 0.35, par, { x: cx, y: y + 0.45, z: z1 - 0.17 });
    k.box(0.35, 0.9, d, par, { x: x0 + 0.17, y: y + 0.45, z: cz });
    k.box(0.35, 0.9, d, par, { x: x1 - 0.17, y: y + 0.45, z: cz });
    const units = Math.min(6, Math.floor((w * d) / 220) + 1);
    for (let i = 0; i < units; i++) {
      const ux = x0 + 3 + r() * Math.max(1, w - 6);
      const uz = z0 + 3 + r() * Math.max(1, d - 6);
      const s = 1.6 + r() * 2.2;
      k.block(s, 1.2 + r(), s * 0.8, 0x9aa1a8, { x: ux, y, z: uz });
      k.cyl(s * 0.3, s * 0.3, 0.15, 0x50565c, { x: ux, y: y + 1.3 + 0.5, z: uz });
    }
    if (r() < 0.35 && w > 12 && d > 12) {
      // Water tank on legs.
      const tx = cx + (r() - 0.5) * w * 0.4;
      const tz = cz + (r() - 0.5) * d * 0.4;
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.cyl(0.12, 0.12, 3, 0x4a3a2a, { x: tx + lx * 1.2, y: y + 1.5, z: tz + lz * 1.2 });
      k.cyl(2, 2, 3.2, 0x8a6a48, { x: tx, y: y + 4.6, z: tz }, 'matte', 14);
      k.cone(2.2, 1.4, 0x5a4a3a, { x: tx, y: y + 6.9, z: tz }, 'matte', 14);
    }
    if (tall && r() < 0.6) {
      const ax = cx + (r() - 0.5) * w * 0.3;
      const az = cz + (r() - 0.5) * d * 0.3;
      const h = 8 + r() * 18;
      k.cyl(0.18, 0.35, h, 0xc8ccd2, { x: ax, y: y + h / 2, z: az });
      k.sphere(0.45, 0xff2a2a, { x: ax, y: y + h + 0.3, z: az }, 'glow', 8, 6);
    }
  }

  private buildLot(lot: Lot): void {
    const r = lotRng(lot);
    const y = this.terrain.lotY.get(lot.id) ?? 6;
    const cx = (lot.x0 + lot.x1) / 2;
    const cz = (lot.z0 + lot.z1) / 2;
    const q = this.quarter(cx, cz);
    const k = q.kit;
    // Inset from the lot edges (front setback is smaller for commercial districts).
    const setFront = lot.district === 'heights' ? 9 : lot.district === 'oldtown' ? 3 : 2 + r() * 4;
    let x0 = lot.x0 + 2;
    let x1 = lot.x1 - 2;
    let z0 = lot.z0 + 2;
    let z1 = lot.z1 - 2;
    if (lot.front === 'N') z0 = lot.z0 + setFront;
    if (lot.front === 'S') z1 = lot.z1 - setFront;
    if (lot.front === 'W') x0 = lot.x0 + setFront;
    if (lot.front === 'E') x1 = lot.x1 - setFront;
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

    switch (lot.district) {
      case 'downtown': {
        const style = pick<FacadeStyle>(['glassBlue', 'glassTeal', 'office', 'glassBlue', 'brick']);
        const podH = 9 + Math.floor(r() * 3) * 4;
        this.shopBand(q, x0, z0, x1, z1, y, 4.2);
        this.section(q, style === 'brick' ? 'brick' : 'office', x0, z0, x1, z1, y + 4.2, y + podH, 0xffffff, r);
        this.collide(lot, x0, z0, x1, z1, y, y + podH);
        // The tower, set back on the podium.
        const inset = 3 + r() * 6;
        const tx0 = x0 + inset;
        const tx1 = x1 - inset;
        const tz0 = z0 + inset;
        const tz1 = z1 - inset;
        const h = 45 + Math.pow(r(), 1.6) * 190;
        const split = r() < 0.5 ? h * (0.55 + r() * 0.2) : h;
        this.section(q, style, tx0, tz0, tx1, tz1, y + podH, y + split, 0xffffff, r);
        let topY = y + split;
        if (split < h) {
          const i2 = Math.min((tx1 - tx0) * 0.18, (tz1 - tz0) * 0.18);
          this.section(q, style, tx0 + i2, tz0 + i2, tx1 - i2, tz1 - i2, topY, y + h, 0xffffff, r);
          this.roofClutter(k, tx0, tz0, tx1, tz1, topY, r, false);
          topY = y + h;
          this.roofClutter(k, tx0 + i2, tz0 + i2, tx1 - i2, tz1 - i2, topY, r, true);
          this.collide(lot, tx0 + i2, tz0 + i2, tx1 - i2, tz1 - i2, y, topY);
        } else this.roofClutter(k, tx0, tz0, tx1, tz1, topY, r, true);
        this.collide(lot, tx0, tz0, tx1, tz1, y, y + split);
        // A glowing crown band on some towers.
        if (r() < 0.45) {
          const c = pick(NEON);
          const ww = tx1 - tx0;
          const dd = tz1 - tz0;
          k.box(ww + 0.4, 0.6, 0.3, c, { x: (tx0 + tx1) / 2, y: y + split - 1.5, z: tz0 - 0.1 }, 'glow');
          k.box(ww + 0.4, 0.6, 0.3, c, { x: (tx0 + tx1) / 2, y: y + split - 1.5, z: tz1 + 0.1 }, 'glow');
          k.box(0.3, 0.6, dd, c, { x: tx0 - 0.1, y: y + split - 1.5, z: (tz0 + tz1) / 2 }, 'glow');
          k.box(0.3, 0.6, dd, c, { x: tx1 + 0.1, y: y + split - 1.5, z: (tz0 + tz1) / 2 }, 'glow');
        }
        this.footprints.push({ lot, x0, x1, z0, z1, h });
        break;
      }
      case 'strip': {
        // A resort hotel: low casino podium with neon, a tall slab tower behind it.
        const podH = 14;
        const neon = pick(NEON);
        this.shopBand(q, x0, z0, x1, z1, y, 5);
        this.section(q, 'deco', x0, z0, x1, z1, y + 5, y + podH, pick(PASTELS), r);
        this.collide(lot, x0, z0, x1, z1, y, y + podH);
        this.roofClutter(k, x0, z0, x1, z1, y + podH, r, false);
        k.box(x1 - x0 + 0.6, 0.8, z1 - z0 + 0.6, neon, { x: cx, y: y + podH - 0.6, z: cz }, 'glow');
        const slabAlongX = lot.front === 'N' || lot.front === 'S';
        const back = 0.35;
        let sx0 = x0 + (x1 - x0) * 0.12;
        let sx1 = x1 - (x1 - x0) * 0.12;
        let sz0 = z0 + (z1 - z0) * 0.12;
        let sz1 = z1 - (z1 - z0) * 0.12;
        if (slabAlongX) {
          const mid = lot.front === 'S' ? z0 + (z1 - z0) * back : z1 - (z1 - z0) * back;
          sz0 = mid - 11;
          sz1 = mid + 11;
        } else {
          const mid = lot.front === 'E' ? x0 + (x1 - x0) * back : x1 - (x1 - x0) * back;
          sx0 = mid - 11;
          sx1 = mid + 11;
        }
        const h = 60 + r() * 90;
        this.section(q, 'hotel', sx0, sz0, sx1, sz1, y + podH, y + h, pick(PASTELS), r);
        this.collide(lot, sx0, sz0, sx1, sz1, y, y + h);
        this.roofClutter(k, sx0, sz0, sx1, sz1, y + h, r, true);
        // Neon fins up the corners.
        for (const [fx, fz] of [[sx0, sz0], [sx1, sz0], [sx1, sz1], [sx0, sz1]]) k.box(0.5, h - podH, 0.5, neon, { x: fx, y: y + (h + podH) / 2, z: fz }, 'glow');
        // Porte-cochère canopy at the front.
        this.canopy(k, lot, y, neon);
        this.footprints.push({ lot, x0, x1, z0, z1, h });
        break;
      }
      case 'beach': {
        const h = 22 + r() * 60;
        const tint = pick(PASTELS);
        const style = r() < 0.5 ? 'deco' : 'hotel';
        const inset = (Math.min(x1 - x0, z1 - z0) * 0.15) | 0;
        this.shopBand(q, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y, 4);
        this.section(q, style, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y + 4, y + h, tint, r);
        this.collide(lot, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y, y + h);
        this.roofClutter(k, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y + h, r, false);
        // Balconies: horizontal bands with a white lip.
        for (let fy = y + 7; fy < y + h - 2; fy += 3.3) {
          k.box(x1 - x0 - inset * 2 + 1.6, 0.25, 0.9, 0xffffff, { x: cx, y: fy, z: lot.front === 'W' || lot.front === 'E' ? cz : z0 + inset - 0.4 });
        }
        if (r() < 0.5) {
          // Pool deck with a pool.
          k.block(Math.min(14, x1 - x0 - 8), 0.12, 6, 0x41c8e8, { x: cx, y: y + 0.05, z: z1 - 5 }, 'shiny');
        }
        this.footprints.push({ lot, x0: x0 + inset, x1: x1 - inset, z0: z0 + inset, z1: z1 - inset, h });
        break;
      }
      case 'midtown': {
        const style = pick<FacadeStyle>(['office', 'brick', 'stucco', 'brick', 'glassTeal']);
        const h = 14 + r() * 36;
        const tint = style === 'stucco' ? pick(PASTELS) : 0xffffff;
        this.shopBand(q, x0, z0, x1, z1, y, 4.2);
        this.section(q, style, x0, z0, x1, z1, y + 4.2, y + h, tint, r);
        this.collide(lot, x0, z0, x1, z1, y, y + h);
        this.roofClutter(k, x0, z0, x1, z1, y + h, r, h > 35);
        this.footprints.push({ lot, x0, x1, z0, z1, h });
        break;
      }
      case 'harbor': {
        const h = 9 + r() * 6;
        const inset = 4;
        this.section(q, 'warehouse', x0 + inset, z0 + inset, x1 - inset, z1 - inset, y, y + h, pick([0xffffff, 0xd8e6f0, 0xf0e0d0, 0xe0f0e0]), r, 0xb8bbbe);
        this.collide(lot, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y, y + h);
        // Roller doors along the front and a loading apron.
        this.loadingDoors(k, lot, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y);
        this.footprints.push({ lot, x0: x0 + inset, x1: x1 - inset, z0: z0 + inset, z1: z1 - inset, h });
        break;
      }
      case 'heights':
      case 'oldtown': {
        this.house(q, lot, x0, z0, x1, z1, y, r);
        break;
      }
    }
  }

  private canopy(k: Kit, lot: Lot, y: number, neon: number): void {
    const cx = (lot.x0 + lot.x1) / 2;
    const cz = (lot.z0 + lot.z1) / 2;
    const alongX = lot.front === 'N' || lot.front === 'S';
    const fx = lot.front === 'W' ? lot.x0 + 6 : lot.front === 'E' ? lot.x1 - 6 : cx;
    const fz = lot.front === 'N' ? lot.z0 + 6 : lot.front === 'S' ? lot.z1 - 6 : cz;
    const w = alongX ? 28 : 9;
    const d = alongX ? 9 : 28;
    k.box(w, 0.7, d, 0xf8f4ea, { x: fx, y: y + 5.4, z: fz });
    k.box(w + 0.3, 0.25, d + 0.3, neon, { x: fx, y: y + 5.0, z: fz }, 'glow');
    for (const s of [-1, 1]) {
      const px = alongX ? fx + s * (w / 2 - 1) : fx;
      const pz = alongX ? fz : fz + s * (d / 2 - 1);
      k.cyl(0.35, 0.35, 5.2, 0xe8c37a, { x: px, y: y + 2.6, z: pz }, 'shiny');
    }
  }

  private loadingDoors(k: Kit, lot: Lot, x0: number, z0: number, x1: number, z1: number, y: number): void {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (lot.front === 'N' || lot.front === 'S') {
        const z = lot.front === 'N' ? z0 - 0.15 : z1 + 0.15;
        k.box(5, 4.5, 0.2, 0x6d7781, { x: x0 + (x1 - x0) * t, y: y + 2.25, z });
        k.box(5.6, 0.4, 0.5, 0xf2c230, { x: x0 + (x1 - x0) * t, y: y + 4.7, z });
      } else {
        const x = lot.front === 'W' ? x0 - 0.15 : x1 + 0.15;
        k.box(0.2, 4.5, 5, 0x6d7781, { x, y: y + 2.25, z: z0 + (z1 - z0) * t });
        k.box(0.5, 0.4, 5.6, 0xf2c230, { x, y: y + 4.7, z: z0 + (z1 - z0) * t });
      }
    }
  }

  /** A detached house (or a Coral Cove cottage) with a pitched roof, yard and fence. */
  private house(q: Quarter, lot: Lot, x0: number, z0: number, x1: number, z1: number, y: number, r: () => number): void {
    const k = q.kit;
    const cove = lot.district === 'oldtown';
    const w = Math.min(x1 - x0 - 4, cove ? 18 : 16 + r() * 6);
    const d = Math.min(z1 - z0 - 6, cove ? 14 : 12 + r() * 5);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Pull the house towards the street.
    const hx0 = lot.front === 'W' ? x0 : lot.front === 'E' ? x1 - w : cx - w / 2;
    const hz0 = lot.front === 'N' ? z0 : lot.front === 'S' ? z1 - d : cz - d / 2;
    const floors = cove ? 2 : r() < 0.5 ? 1 : 2;
    const h = floors * 3.1;
    const tint = (cove ? PASTELS : HOUSE_COLORS)[Math.floor(r() * (cove ? PASTELS.length : HOUSE_COLORS.length))];
    this.section(q, 'house', hx0, hz0, hx0 + w, hz0 + d, y, y + h, tint, r);
    this.collide(lot, hx0, hz0, hx0 + w, hz0 + d, y, y + h + 3);
    // Pitched roof: a triangular prism along the longer side.
    const roofC = ROOF_COLORS[Math.floor(r() * ROOF_COLORS.length)];
    const along = w >= d;
    const span = along ? d : w;
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2 - 0.6, 0);
    shape.lineTo(span / 2 + 0.6, 0);
    shape.lineTo(0, span * 0.38);
    shape.closePath();
    k.extrude(shape, (along ? w : d) + 1, roofC, { x: hx0 + w / 2, y: y + h, z: hz0 + d / 2, ry: along ? Math.PI / 2 : 0 });
    // Chimney, door and porch.
    k.block(1, 2.6, 1, 0x8a5a44, { x: hx0 + w * 0.75, y: y + h, z: hz0 + d * 0.3 });
    const front = lot.front;
    const doorX = front === 'W' ? hx0 - 0.1 : front === 'E' ? hx0 + w + 0.1 : hx0 + w / 2;
    const doorZ = front === 'N' ? hz0 - 0.1 : front === 'S' ? hz0 + d + 0.1 : hz0 + d / 2;
    const side = front === 'W' || front === 'E';
    k.block(side ? 0.2 : 1.3, 2.3, side ? 1.3 : 0.2, 0x7a4a2a, { x: doorX, y, z: doorZ });
    if (!cove) {
      // Low hedge round the yard, a palm or two, maybe a pool out back.
      const lx0 = lot.x0 + 1;
      const lx1 = lot.x1 - 1;
      const lz0 = lot.z0 + 1;
      const lz1 = lot.z1 - 1;
      const hedge = 0x3f8f3a;
      if (front !== 'N') k.block(lx1 - lx0, 1, 0.8, hedge, { x: (lx0 + lx1) / 2, y, z: lz0 });
      if (front !== 'S') k.block(lx1 - lx0, 1, 0.8, hedge, { x: (lx0 + lx1) / 2, y, z: lz1 });
      if (front !== 'W') k.block(0.8, 1, lz1 - lz0, hedge, { x: lx0, y, z: (lz0 + lz1) / 2 });
      if (front !== 'E') k.block(0.8, 1, lz1 - lz0, hedge, { x: lx1, y, z: (lz0 + lz1) / 2 });
      if (r() < 0.45) {
        const px = lot.front === 'W' ? lot.x1 - 8 : lot.front === 'E' ? lot.x0 + 8 : cx;
        const pz = lot.front === 'N' ? lot.z1 - 7 : lot.front === 'S' ? lot.z0 + 7 : cz;
        k.block(side ? 5 : 9, 0.1, side ? 9 : 5, 0x3fd0f0, { x: px, y: y + 0.04, z: pz }, 'shiny');
        k.block(side ? 6 : 10, 0.08, side ? 10 : 6, 0xf2efe8, { x: px, y: y + 0.01, z: pz });
      }
      // Driveway.
      const dw = front === 'N' || front === 'S';
      k.block(dw ? 4 : 9, 0.06, dw ? 9 : 4, 0x9a9a98, {
        x: front === 'W' ? lot.x0 + 4 : front === 'E' ? lot.x1 - 4 : hx0 + w + 3,
        y: y + 0.02,
        z: front === 'N' ? lot.z0 + 4 : front === 'S' ? lot.z1 - 4 : hz0 + d + 3,
      });
    } else {
      // Cottage awning over the door.
      k.box(side ? 1.2 : 4, 0.15, side ? 4 : 1.2, PASTELS[Math.floor(r() * PASTELS.length)], { x: doorX + (front === 'W' ? -0.6 : front === 'E' ? 0.6 : 0), y: y + 2.8, z: doorZ + (front === 'N' ? -0.6 : front === 'S' ? 0.6 : 0) });
    }
    this.footprints.push({ lot, x0: hx0, x1: hx0 + w, z0: hz0, z1: hz0 + d, h: h + 3 });
  }

  private bakeQuarter(q: Quarter): void {
    for (const [key, b] of q.facades) {
      const g = b.build();
      if (!g) continue;
      const m = new THREE.Mesh(g, this.materials.get(key)!);
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.receiveShadow = true;
      q.group.add(m);
    }
    const geos = q.kit.bakeGeometries();
    for (const slot of Object.keys(geos) as Slot[]) {
      const m = new THREE.Mesh(geos[slot]!, SLOT_MATERIALS[slot]);
      m.matrixAutoUpdate = false;
      m.castShadow = slot === 'matte';
      q.group.add(m);
    }
    this.group.add(q.group);
  }

  update(camX: number, camZ: number, night: number, drawDist: number, fogFar: number): void {
    for (const m of this.materials.values()) {
      if ('emissiveIntensity' in m) m.emissiveIntensity = night * 1.1;
    }
    for (const q of this.quarters.values()) {
      const d = Math.hypot(q.cx - camX, q.cz - camZ) - 360;
      q.group.visible = d < drawDist || (q.maxH > 40 && d < fogFar * 0.8);
    }
  }
}
