import * as THREE from 'three';
import { Kit } from '../render/kit';
import { labelTexture } from '../render/signs';
import type { Venue } from '../casino/venue';
import { lotFrontPoint, type Lot } from '../world/layout';
import type { BizType } from './catalog';

/**
 * Looks for your buildings: what goes inside a bar, a restaurant, a nightclub, a shop or a
 * hotel lobby; a modern villa for houses; scaffolding while it's being built; and the FOR
 * SALE signs on empty lots.
 */

/** Type-specific interior furnishings, added into the venue's interior kit. */
export function furnish(type: BizType, v: Venue, k: Kit, glow: Kit): void {
  const W = v.W;
  const D = v.D;
  const y = v.floorY;
  const accent = v.opts.theme.accent;
  switch (type) {
    case 'bar':
    case 'restaurant': {
      const tables = type === 'restaurant' ? 0xf4f0e8 : 0x3a2416;
      for (let x = -W / 2 + 4; x <= W / 2 - 4; x += 3.2) {
        for (let z = -4; z > -D + (type === 'bar' ? 7 : 4); z -= 3.2) {
          k.cyl(0.55, 0.55, 0.05, tables, { x, y: y + 0.76, z }, 'shiny', 16);
          k.cyl(0.05, 0.05, 0.74, 0x2a2a2a, { x, y: y + 0.37, z }, 'shiny', 6);
          for (let a = 0; a < 4; a++) {
            const ang = (a / 4) * Math.PI * 2 + 0.4;
            k.rbox(0.4, 0.06, 0.4, 0.04, accent, { x: x + Math.cos(ang) * 0.8, y: y + 0.46, z: z + Math.sin(ang) * 0.8 });
            k.cyl(0.03, 0.03, 0.44, 0x2a2a2a, { x: x + Math.cos(ang) * 0.8, y: y + 0.22, z: z + Math.sin(ang) * 0.8 }, 'shiny', 5);
          }
          if (type === 'restaurant') {
            for (let a = 0; a < 4; a++) {
              const ang = (a / 4) * Math.PI * 2 + 0.4;
              k.cyl(0.11, 0.1, 0.015, 0xffffff, { x: x + Math.cos(ang) * 0.32, y: y + 0.79, z: z + Math.sin(ang) * 0.32 }, 'shiny', 12);
            }
            glow.cyl(0.03, 0.03, 0.1, 0xffd28a, { x, y: y + 0.84, z }, 'glow', 6);
          }
        }
      }
      break;
    }
    case 'nightclub': {
      // Glowing dance floor and a DJ booth.
      const cols = [0xff3fa4, 0x3fe0ff, 0xffd23d, 0x7cff5a, 0xb36bff];
      let i = 0;
      for (let x = -4; x <= 4; x += 1) for (let z = -6; z >= -14; z -= 1) glow.box(0.96, 0.04, 0.96, cols[i++ % cols.length], { x, y: y + 0.02, z }, 'glow');
      k.rbox(4, 1.1, 1.4, 0.15, 0x15151a, { x: 0, y: y + 0.55, z: -D + 2.5 }, 'shiny');
      glow.box(4, 0.08, 0.05, 0x3fe0ff, { x: 0, y: y + 1.0, z: -D + 3.21 }, 'glow');
      for (const s of [-1, 1]) {
        k.rbox(1.0, 2.0, 0.9, 0.1, 0x111114, { x: s * 3.4, y: y + 1, z: -D + 2.5 }, 'shiny');
        k.cyl(0.32, 0.32, 0.1, 0x333338, { x: s * 3.4, y: y + 1.4, z: -D + 2.98, rx: Math.PI / 2 }, 'shiny', 16);
      }
      // Mirror ball.
      glow.sphere(0.5, 0xe8f0ff, { x: 0, y: y + v.H - 1.2, z: -10 }, 'glow', 12, 10);
      break;
    }
    case 'shop': {
      for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 2.6) {
        for (let z = -5; z > -D + 3; z -= 4) {
          k.box(1.8, 1.6, 0.6, 0xe8e8ea, { x, y: y + 0.8, z }, 'shiny');
          for (let s = 0; s < 3; s++) for (let b = 0; b < 6; b++) k.box(0.22, 0.25, 0.22, [0xff6b6b, 0xffd23d, 0x3fa0ff, 0x7cff5a, 0xff9f2e, 0xd68bff][(b + s) % 6], { x: x - 0.7 + b * 0.28, y: y + 0.4 + s * 0.5, z: z + 0.18 });
        }
      }
      k.rbox(3, 1.0, 0.8, 0.08, accent, { x: W / 2 - 3, y: y + 0.5, z: -2.5 }, 'shiny');
      break;
    }
    case 'hotel': {
      k.rbox(6, 1.1, 1.2, 0.12, 0x3a2416, { x: 0, y: y + 0.55, z: -D + 4 }, 'shiny');
      k.box(6.2, 0.06, 1.3, 0xd8b04a, { x: 0, y: y + 1.12, z: -D + 4 }, 'shiny');
      for (const s of [-1, 1]) {
        k.rbox(2.4, 0.45, 0.9, 0.15, 0x7a1020, { x: s * 5, y: y + 0.23, z: -6 });
        k.rbox(2.4, 0.6, 0.25, 0.1, 0x7a1020, { x: s * 5, y: y + 0.6, z: -6.4 });
        k.cyl(0.6, 0.5, 0.9, accent, { x: s * 8, y: y + 0.45, z: -3 }, 'shiny', 14);
        k.sphere(0.8, 0x3fae3a, { x: s * 8, y: y + 1.4, z: -3, sy: 0.8 });
      }
      break;
    }
    default:
      break;
  }
}

/** A modern villa (two storeys, flat roofs, glass, a pool and a garage). */
export function buildHouse(lot: Lot, y: number, color: number): { group: THREE.Group; door: THREE.Vector3; yaw: number; bed: THREE.Vector3; garage: THREE.Vector3 } {
  const fp = lotFrontPoint(lot);
  const g = new THREE.Group();
  const k = new Kit();
  const glow = new Kit();
  const lw = lot.front === 'N' || lot.front === 'S' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
  const W = Math.min(18, lw - 6);
  const D = 12;
  const setback = 8;
  g.position.set(fp.x - Math.sin(fp.yaw) * setback, y, fp.z - Math.cos(fp.yaw) * setback);
  g.rotation.y = fp.yaw;
  // Ground floor (local: front at z=0, the house extends to -z).
  k.block(W, 3.2, D, color, { z: -D / 2 });
  k.block(W * 0.7, 3.0, D * 0.8, 0xf4f2ee, { x: -W * 0.12, y: 3.2, z: -D * 0.45 });
  k.box(W + 0.6, 0.25, D + 0.6, 0x2a2a2e, { y: 3.25, z: -D / 2 });
  k.box(W * 0.7 + 0.6, 0.25, D * 0.8 + 0.6, 0x2a2a2e, { x: -W * 0.12, y: 6.3, z: -D * 0.45 });
  // Glass front and windows.
  k.box(W * 0.5, 2.6, 0.08, 0x9ccfe8, { x: W * 0.15, y: 1.4, z: 0.02 }, 'glass');
  k.box(W * 0.55, 2.2, 0.08, 0x9ccfe8, { x: -W * 0.12, y: 4.6, z: -D * 0.05 + 0.02 }, 'glass');
  // Door.
  k.box(1.2, 2.3, 0.1, 0x6b3a1e, { x: -W * 0.28, y: 1.15, z: 0.05 }, 'shiny');
  // Garage door.
  k.box(3.2, 2.6, 0.1, 0xd8dde4, { x: -W / 2 + 2, y: 1.3, z: 0.06 }, 'shiny');
  for (let i = 0; i < 5; i++) k.box(3.2, 0.03, 0.12, 0xa8adb4, { x: -W / 2 + 2, y: 0.4 + i * 0.5, z: 0.07 });
  // Pool and deck behind.
  k.box(W * 0.6, 0.1, 6, 0xd8c8a8, { y: 0.05, z: -D - 4 });
  k.box(W * 0.45, 0.06, 4, 0x3fd0f0, { y: 0.09, z: -D - 4 }, 'shiny');
  // Driveway, lights.
  k.box(3.6, 0.04, setback, 0x9a9a98, { x: -W / 2 + 2, y: 0.02, z: setback / 2 });
  glow.box(W, 0.06, 0.06, 0xfff1c8, { y: 3.1, z: 0.32 }, 'glow');
  for (const s of [-1, 1]) {
    k.cyl(0.6, 0.5, 0.8, 0x2a2a2e, { x: s * (W / 2 - 0.6), y: 0.4, z: 1.2 }, 'shiny', 12);
    k.sphere(0.75, 0x3fae3a, { x: s * (W / 2 - 0.6), y: 1.2, z: 1.2, sy: 0.85 });
  }
  // Inside: a sofa, a TV and a bed you can sleep in.
  k.rbox(2.6, 0.5, 0.9, 0.15, 0x3a5bb8, { x: W * 0.15, y: 0.25, z: -4 });
  k.box(2.0, 1.1, 0.08, 0x111114, { x: W * 0.15, y: 1.5, z: -D + 0.3 }, 'shiny');
  k.rbox(2.0, 0.55, 2.2, 0.1, 0xf4f4f4, { x: W * 0.3, y: 0.28, z: -D + 2 });
  k.box(2.0, 0.9, 0.12, 0x6b3a1e, { x: W * 0.3, y: 0.6, z: -D + 0.9 }, 'shiny');
  g.add(k.bake({ shadows: true }));
  g.add(glow.bake());
  g.updateMatrixWorld(true);
  const door = g.localToWorld(new THREE.Vector3(-W * 0.28, 0, 1.2));
  const bed = g.localToWorld(new THREE.Vector3(W * 0.3, 0, -D + 3.5));
  const garage = g.localToWorld(new THREE.Vector3(-W / 2 + 2, 0, 4));
  return { group: g, door, yaw: fp.yaw, bed, garage };
}

/** Scaffolding, a fence and a crane while a building goes up. */
export function buildSite(lot: Lot, y: number, progress: number): THREE.Group {
  const fp = lotFrontPoint(lot);
  const g = new THREE.Group();
  const k = new Kit();
  const lw = lot.front === 'N' || lot.front === 'S' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
  const ld = lot.front === 'N' || lot.front === 'S' ? lot.z1 - lot.z0 : lot.x1 - lot.x0;
  const W = Math.min(40, lw - 6);
  const D = Math.min(36, ld - 14);
  g.position.set(fp.x - Math.sin(fp.yaw) * 9, y, fp.z - Math.cos(fp.yaw) * 9);
  g.rotation.y = fp.yaw;
  const H = 3 + progress * 9;
  // Concrete slab, columns rising with progress, scaffold poles and nets.
  k.box(W, 0.4, D, 0xa8a49c, { y: 0.2, z: -D / 2 });
  for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 5) {
    for (let z = -1; z >= -D + 1; z -= 6) k.block(0.5, H, 0.5, 0xc8c4bc, { x, y: 0.4, z });
  }
  for (let x = -W / 2; x <= W / 2; x += 2.5) {
    k.cyl(0.05, 0.05, H + 1.5, 0xff7a1a, { x, y: (H + 1.5) / 2, z: 0.8 }, 'shiny', 5);
  }
  for (let h = 1.5; h < H + 1.5; h += 2) k.box(W, 0.05, 0.05, 0xff7a1a, { y: h, z: 0.8 }, 'shiny');
  k.box(W, H * 0.8, 0.02, 0x2a9a3a, { y: H * 0.45, z: 0.85 }, 'glass');
  // Crane.
  k.box(1.2, 26, 1.2, 0xffcc1f, { x: W / 2 - 3, y: 13, z: -D / 2 });
  k.box(22, 0.8, 0.8, 0xffcc1f, { x: W / 2 - 8, y: 26, z: -D / 2 });
  k.box(4, 2, 2, 0x555555, { x: W / 2 + 1.5, y: 25.6, z: -D / 2 });
  k.cyl(0.03, 0.03, 10, 0x222222, { x: W / 2 - 16, y: 21, z: -D / 2 }, 'matte', 4);
  // Site fence and a sign.
  k.box(W + 2, 2, 0.1, 0x3a5bb8, { y: 1, z: 2.5 });
  g.add(k.bake({ shadows: true }));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), new THREE.MeshBasicMaterial({ map: labelTexture('COMING SOON', { width: 512, height: 120, color: '#ffffff', bg: '#1e6bff', size: 72 }), toneMapped: false }));
  sign.position.set(0, 1.2, 2.58);
  g.add(sign);
  return g;
}

/** Name sign on a post by the street. */
export function nameSign(lot: Lot, y: number, text: string, color: string): THREE.Group {
  const fp = lotFrontPoint(lot);
  const g = new THREE.Group();
  g.position.set(fp.x - Math.sin(fp.yaw) * 2, y, fp.z - Math.cos(fp.yaw) * 2);
  g.rotation.y = fp.yaw;
  const k = new Kit();
  k.block(0.3, 3.2, 0.3, 0x2a2a2e, { x: -2.2 }, 'shiny');
  k.block(0.3, 3.2, 0.3, 0x2a2a2e, { x: 2.2 }, 'shiny');
  g.add(k.bake());
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.2), new THREE.MeshBasicMaterial({ map: labelTexture(text, { width: 768, height: 200, color: '#ffffff', bg: '#0b1530', stroke: color, glow: color, size: 100, radius: 24, border: color }), toneMapped: false, side: THREE.DoubleSide }));
  board.position.set(0, 2.9, 0.2);
  g.add(board);
  return g;
}

let saleTex: THREE.CanvasTexture | null = null;
export function forSaleTexture(): THREE.CanvasTexture {
  if (!saleTex) saleTex = labelTexture('FOR SALE\nPARADISE REALTY', { width: 512, height: 300, color: '#c8202f', bg: '#ffffff', size: 110, border: '#c8202f', radius: 16 });
  return saleTex;
}
