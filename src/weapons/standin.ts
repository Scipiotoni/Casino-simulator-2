import * as THREE from 'three';
import { Kit } from '../render/kit';
import { weaponDef, type WeaponDef } from './catalog';
import { CAMOS } from './attachments';
import { fitted, type Loadout } from './loadout';

/**
 * A simple stand-in for `buildWeapon(id, loadout)` from src/weapons/models.ts (the weapon
 * runtime, built separately): a low-poly weapon of the right shape and size for its class,
 * with the fitted parts on it. The gun stores, the gunsmith preview and the icons all call
 * `buildWeapon` from here; when models.ts lands, replace the body of this file with
 * `export { buildWeapon } from './models';`.
 *
 * Space as in docs/weapons.md: metres, +x right, +y up, muzzle down −z, origin at the grip.
 */

export interface WeaponBuild {
  root: THREE.Object3D;
  dispose(): void;
}

const FACTORY: Record<string, number> = {
  ak47: 0x7a4a22, shotgun: 0x6b4422, svd: 0x7a4a22, sawnoff: 0x6b4422, scarh: 0xb89a6a, aug: 0x4a5a3a, awm: 0x4a5a3a,
  goldcannon: 0xf2b632, revolver: 0x9aa0ab, deagle: 0x8a8e96, rpg7: 0x4a5a3a, at4: 0x5a6a3a, m202: 0x4a5a3a, homing: 0x4a5a3a, m32: 0x3a3a34,
  minigun: 0x3a3a3e, m14: 0x6a6a4a, famas: 0x2a2a2e,
};

const METAL = 0x2a2b30;
const POLY = 0x18181c;

/** Muzzle length per barrel variant. */
function barrelLen(w: WeaponDef, base: number, l: Loadout): number {
  const b = fitted(w, l).barrel?.id ?? 'std';
  return base * ({ short: 0.6, long: 1.45, heavy: 1.2, sd: 1.3 }[b as 'short'] ?? 1);
}

export function buildWeapon(id: string, l: Loadout): WeaponBuild {
  const w = weaponDef(id);
  const f = fitted(w, l);
  const camo = CAMOS.find((c) => c.id === l.camo);
  const paint = camo && camo.colors.length ? camo.colors[0] : (FACTORY[id] ?? POLY);
  const accent = camo && camo.colors.length > 1 ? camo.colors[1] : METAL;
  const k = new Kit();
  // Grip at the origin (every class but the minigun).
  const grip = () => k.box(0.032, 0.11, 0.04, POLY, { y: -0.045, z: 0.012, rx: 0.28 }, 'shiny');
  let muzzle = new THREE.Vector3(0, 0.06, -0.3);
  let top = new THREE.Vector3(0, 0.1, -0.1);
  let under = new THREE.Vector3(0, 0.02, -0.3);
  const cls = w.cls;
  if (cls === 'pistol') {
    grip();
    const slide = w.id === 'deagle' || w.id === 'goldcannon' ? 0.26 : 0.19;
    if (w.reloadStyle === 'cylinder') {
      k.box(0.03, 0.05, 0.08, paint, { y: 0.04, z: -0.02 }, 'shiny');
      k.cyl(0.024, 0.024, 0.05, paint, { y: 0.045, z: -0.05, rx: Math.PI / 2 }, 'shiny', 10);
      const bl = barrelLen(w, 0.16, l);
      k.cyl(0.011, 0.011, bl, paint, { y: 0.06, z: -0.075 - bl / 2, rx: Math.PI / 2 }, 'shiny', 8);
      muzzle = new THREE.Vector3(0, 0.06, -0.075 - bl);
    } else {
      const bl = barrelLen(w, slide, l);
      k.box(0.03, 0.035, bl, paint, { y: 0.045, z: 0.03 - bl / 2 }, 'shiny');
      k.box(0.028, 0.03, bl * 0.8, POLY, { y: 0.015, z: 0.02 - bl * 0.4 }, 'shiny');
      muzzle = new THREE.Vector3(0, 0.045, 0.03 - bl);
    }
    k.torus(0.02, 0.004, POLY, { y: -0.005, z: -0.03, ry: Math.PI / 2 }, 'shiny', Math.PI, 4, 8);
    top = new THREE.Vector3(0, 0.07, -0.03);
    under = new THREE.Vector3(0, 0, -0.1);
    if (f.mag && f.mag.id !== 'std') {
      if (f.mag.id === 'drum') k.cyl(0.05, 0.05, 0.04, POLY, { y: -0.13, z: 0.02, rz: Math.PI / 2 }, 'shiny', 14);
      else k.box(0.026, 0.06, 0.03, POLY, { y: -0.12, z: 0.03, rx: 0.28 }, 'shiny');
    }
    if (f.stock && f.stock.id !== 'std') k.box(0.03, 0.06, 0.22, POLY, { y: 0.0, z: 0.16 }, 'shiny');
  } else if (cls === 'launcher') {
    grip();
    const len = w.id === 'at4' ? 1.0 : w.id === 'homing' ? 1.5 : w.id === 'm32' ? 0.7 : 1.0;
    if (w.id === 'm202') {
      for (const [x, y] of [[-0.05, 0.05], [0.05, 0.05], [-0.05, 0.15], [0.05, 0.15]]) k.cyl(0.045, 0.045, 0.8, paint, { x, y: y + 0.04, z: -0.15, rx: Math.PI / 2 }, 'matte', 10);
      k.box(0.22, 0.22, 0.04, METAL, { y: 0.14, z: 0.25 }, 'shiny');
      muzzle = new THREE.Vector3(0, 0.14, -0.55);
    } else if (w.id === 'm32') {
      k.cyl(0.075, 0.075, 0.16, METAL, { y: 0.06, z: -0.12, rx: Math.PI / 2 }, 'shiny', 6);
      k.cyl(0.024, 0.024, 0.32, METAL, { y: 0.09, z: -0.36, rx: Math.PI / 2 }, 'shiny', 10);
      k.box(0.05, 0.08, 0.3, POLY, { y: 0.04, z: 0.2 }, 'shiny');
      k.box(0.03, 0.09, 0.04, POLY, { y: -0.02, z: -0.3 }, 'shiny');
      muzzle = new THREE.Vector3(0, 0.09, -0.52);
    } else {
      k.cyl(0.045, 0.045, len, paint, { y: 0.09, z: -len * 0.32, rx: Math.PI / 2 }, 'matte', 12);
      k.cyl(0.055, 0.04, 0.12, METAL, { y: 0.09, z: len * 0.18 + 0.06, rx: Math.PI / 2 }, 'shiny', 12);
      if (w.id === 'rpg7') {
        k.cone(0.06, 0.24, 0x4a5a3a, { y: 0.09, z: -len * 0.82 - 0.12, rx: -Math.PI / 2 }, 'matte', 10);
        k.cyl(0.02, 0.02, 0.12, 0x4a5a3a, { y: 0.09, z: -len * 0.82 + 0.04, rx: Math.PI / 2 }, 'matte', 8);
      }
      k.box(0.03, 0.09, 0.04, POLY, { y: 0.0, z: -0.25 }, 'shiny');
      if (w.builtInZoom) k.box(0.03, 0.05, 0.12, METAL, { x: -0.06, y: 0.14, z: -0.08 }, 'shiny');
      muzzle = new THREE.Vector3(0, 0.09, -len * 0.82);
    }
    top = new THREE.Vector3(0, 0.16, -0.1);
  } else if (cls === 'special') {
    // Minigun: six barrels round a spindle, the motor housing, the rear handles.
    k.box(0.16, 0.18, 0.34, paint, { y: 0.06, z: -0.1 }, 'shiny');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.cyl(0.012, 0.012, 0.6, METAL, { x: Math.cos(a) * 0.045, y: 0.06 + Math.sin(a) * 0.045, z: -0.56, rx: Math.PI / 2 }, 'shiny', 6);
    }
    k.cyl(0.06, 0.06, 0.03, METAL, { y: 0.06, z: -0.8, rx: Math.PI / 2 }, 'shiny', 12);
    k.cyl(0.06, 0.06, 0.03, METAL, { y: 0.06, z: -0.4, rx: Math.PI / 2 }, 'shiny', 12);
    for (const s of [-1, 1]) k.box(0.03, 0.12, 0.03, POLY, { x: s * 0.08, y: 0.0, z: 0.12 }, 'shiny');
    k.box(0.2, 0.03, 0.03, POLY, { y: 0.06, z: 0.12 }, 'shiny');
    k.box(0.14, 0.12, 0.2, 0x4a5a3a, { x: -0.16, y: 0.0, z: -0.08 }, 'matte');
    muzzle = new THREE.Vector3(0, 0.06, -0.86);
    top = new THREE.Vector3(0, 0.16, -0.1);
  } else {
    // Long guns: receiver, handguard, barrel, magazine, stock.
    grip();
    const spec: Record<string, [number, number, number, number]> = {
      // receiver length, barrel length, stock length, receiver height
      smg: [0.3, 0.12, 0.24, 0.07], rifle: [0.42, 0.3, 0.28, 0.075], marksman: [0.5, 0.42, 0.3, 0.075], sniper: [0.55, 0.55, 0.32, 0.075],
      shotgun: [0.42, 0.42, 0.32, 0.07], lmg: [0.5, 0.42, 0.3, 0.09],
    };
    const [rl, blBase, sl, rh] = spec[cls] ?? spec.rifle;
    const bull = w.reloadStyle === 'mag' && (w.id === 'aug' || w.id === 'famas' || w.id === 'p90');
    const z0 = bull ? 0.28 : 0.07;
    k.box(0.05, rh, rl, paint, { y: 0.04 + rh / 2, z: z0 - rl / 2 }, 'shiny');
    const hgL = cls === 'smg' ? 0.14 : 0.24;
    k.box(0.055, rh * 0.85, hgL, f.generic.length ? accent : paint, { y: 0.04 + rh / 2, z: z0 - rl - hgL / 2 + 0.02 }, 'matte');
    const bl = barrelLen(w, blBase, l);
    const bz = z0 - rl - hgL + 0.02;
    const br = cls === 'shotgun' ? 0.014 : cls === 'sniper' ? 0.012 : 0.009;
    k.cyl(br, br, bl, METAL, { y: 0.06 + rh * 0.3, z: bz - bl / 2, rx: Math.PI / 2 }, 'shiny', 8);
    if (cls === 'shotgun') {
      k.cyl(0.012, 0.012, bl * 0.8, METAL, { y: 0.04, z: bz - bl * 0.4, rx: Math.PI / 2 }, 'shiny', 8);
      k.box(0.05, 0.04, 0.14, paint, { y: 0.04, z: bz - 0.12 }, 'matte');
    }
    if (f.barrel?.suppressor || w.integralSuppressor) k.cyl(0.022, 0.022, bl * 0.7, METAL, { y: 0.06 + rh * 0.3, z: bz - bl * 0.6, rx: Math.PI / 2 }, 'shiny', 10);
    muzzle = new THREE.Vector3(0, 0.06 + rh * 0.3, bz - bl);
    top = new THREE.Vector3(0, 0.04 + rh, z0 - rl * 0.55);
    under = new THREE.Vector3(0, 0.04, z0 - rl - hgL * 0.5);
    // Magazine.
    const mag = f.mag?.id ?? 'std';
    const mz = bull ? 0.16 : -0.1;
    if (w.reloadStyle === 'magBelt') k.box(0.1, 0.12, 0.12, 0x4a5a3a, { x: -0.03, y: -0.03, z: -0.1 }, 'matte');
    else if (w.reloadStyle !== 'tube' && w.reloadStyle !== 'break') {
      if (mag === 'drum') k.cyl(0.07, 0.07, 0.05, POLY, { y: -0.05, z: mz, rz: Math.PI / 2 }, 'shiny', 16);
      else {
        const mh = (mag === 'ext' ? 0.2 : 0.14) * (cls === 'sniper' ? 0.5 : 1);
        k.box(0.025, mh, 0.05, cls === 'rifle' && w.id === 'ak47' ? 0x5a3a22 : POLY, { y: 0.04 - mh / 2, z: mz, rx: 0.15 }, 'shiny');
        if (mag === 'fast') k.box(0.025, mh, 0.05, POLY, { x: 0.03, y: 0.04 - mh / 2, z: mz, rx: 0.15 }, 'shiny');
      }
    }
    // Stock.
    const st = f.stock?.id ?? 'std';
    if (!bull && (w.stocks.length > 0 || cls !== 'smg')) {
      if (st !== 'none') {
        const len = st === 'heavy' ? sl * 1.1 : st === 'light' ? sl * 0.9 : sl;
        const h = st === 'heavy' ? 0.13 : st === 'light' ? 0.06 : 0.1;
        k.box(0.04, h, len, cls === 'shotgun' || w.id === 'ak47' || w.id === 'svd' ? paint : POLY, { y: 0.03, z: z0 + len / 2 }, 'matte');
        k.box(0.045, h + 0.03, 0.02, POLY, { y: 0.03, z: z0 + len }, 'matte');
      } else k.box(0.03, 0.03, 0.05, POLY, { y: 0.06, z: z0 + 0.02 }, 'shiny');
    }
    if (w.builtInZoom && !f.generic.some((a) => a.slot === 'optic')) {
      k.cyl(0.02, 0.022, 0.22, POLY, { y: 0.04 + rh + 0.05, z: z0 - rl * 0.5, rx: Math.PI / 2 }, 'shiny', 10);
      k.box(0.02, 0.04, 0.04, METAL, { y: 0.04 + rh + 0.015, z: z0 - rl * 0.5 }, 'shiny');
    }
  }
  // Generic attachments.
  for (const a of f.generic) {
    if (a.slot === 'optic') {
      const zoom = a.zoom ?? 1;
      if (zoom >= 3) {
        const len = 0.18 + zoom * 0.012;
        k.cyl(0.02, 0.026, len, POLY, { y: top.y + 0.045, z: top.z, rx: Math.PI / 2 }, 'shiny', 12);
        for (const s of [-1, 1]) k.box(0.02, 0.045, 0.02, METAL, { y: top.y + 0.02, z: top.z + s * len * 0.3 }, 'shiny');
      } else if (a.id === 'holo') {
        k.box(0.045, 0.05, 0.08, POLY, { y: top.y + 0.025, z: top.z }, 'shiny');
        k.box(0.04, 0.035, 0.005, 0x9ad8ff, { y: top.y + 0.04, z: top.z - 0.03 }, 'glass');
      } else {
        const s = a.id === 'microdot' ? 0.6 : 1;
        k.box(0.035 * s, 0.03 * s, 0.05 * s, POLY, { y: top.y + 0.015 * s, z: top.z }, 'shiny');
        k.box(0.03 * s, 0.025 * s, 0.004, 0x9ad8ff, { y: top.y + 0.035 * s, z: top.z - 0.02 * s }, 'glass');
      }
    } else if (a.slot === 'muzzle') {
      const len = a.suppressor ? (a.id === 'suppPistol' ? 0.09 : a.id === 'supp50' ? 0.26 : 0.17) : 0.05;
      const r = a.suppressor ? (a.id === 'oilcan' ? 0.04 : 0.02) : 0.016;
      k.cyl(r, r, len, a.id === 'oilcan' ? 0x2a5ab8 : METAL, { y: muzzle.y, z: muzzle.z - len / 2, rx: Math.PI / 2 }, 'shiny', 10);
      muzzle.z -= len;
    } else if (a.slot === 'underbarrel') {
      if (a.id === 'bipod') for (const s of [-1, 1]) k.box(0.012, 0.18, 0.012, METAL, { x: s * 0.03, y: under.y - 0.08, z: under.z - 0.06, rz: s * 0.25 }, 'shiny');
      else if (a.id === 'light') k.cyl(0.018, 0.018, 0.08, POLY, { y: under.y - 0.02, z: under.z, rx: Math.PI / 2 }, 'shiny', 10);
      else k.box(0.025, a.id === 'handstop' ? 0.025 : a.id === 'stubby' ? 0.045 : 0.08, 0.03, POLY, { y: under.y - 0.04, z: under.z, rx: a.id === 'agrip' ? 0.6 : 0 }, 'shiny');
    } else if (a.slot === 'laser') {
      k.box(0.025, 0.025, 0.06, a.light ? 0x5a5a40 : POLY, { x: 0.04, y: under.y + 0.03, z: under.z + 0.02 }, 'shiny');
      k.box(0.006, 0.006, 0.002, a.beam ?? 0xff2a2a, { x: 0.04, y: under.y + 0.03, z: under.z - 0.011 }, 'glow');
    }
  }
  if (l.charm !== 'none') {
    k.cyl(0.002, 0.002, 0.03, 0xc8c8c8, { x: 0.03, y: -0.005, z: 0.06 }, 'shiny', 4);
    k.sphere(0.014, l.charm === 'chip' ? 0xc81e1e : l.charm === 'duck' ? 0xffd23d : l.charm === 'palm' ? 0x3fae3a : 0xe8e8e8, { x: 0.03, y: -0.03, z: 0.06 }, 'shiny', 8, 6);
  }
  const root = k.bake();
  root.name = id;
  root.userData.muzzle = muzzle;
  return {
    root,
    dispose: () => root.traverse((o) => (o as THREE.Mesh).geometry?.dispose()),
  };
}
