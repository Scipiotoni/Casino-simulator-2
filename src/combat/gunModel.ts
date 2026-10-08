import * as THREE from 'three';
import { Kit } from '../render/kit';
import type { GunDef } from './guns';

/**
 * Chunky toy-like gun models (a few boxes and cylinders each), built along +z with the
 * grip down, then turned to lie along a hand bone. `muzzle` marks where tracers start.
 */
export function buildGun(def: GunDef): { group: THREE.Group; muzzle: THREE.Object3D } {
  const k = new Kit();
  const c = def.color;
  const dark = 0x1a1a1f;
  const wood = 0x7a4a26;
  let len = 0.26;
  switch (def.id) {
    case 'pistol':
    case 'goldcannon': {
      const s = def.id === 'goldcannon' ? 1.25 : 1;
      len = 0.2 * s;
      k.rbox(0.045 * s, 0.06 * s, 0.2 * s, 0.01, c, { x: 0, y: 0.03 * s, z: 0.06 * s }, 'shiny');
      k.rbox(0.04 * s, 0.11 * s, 0.05 * s, 0.01, def.id === 'goldcannon' ? 0x3a2410 : dark, { x: 0, y: -0.04 * s, z: -0.01, rx: -0.25 });
      k.box(0.012, 0.012, 0.02, 0xffffff, { x: 0, y: 0.065 * s, z: 0.15 * s }, 'shiny');
      break;
    }
    case 'revolver':
      len = 0.26;
      k.cyl(0.014, 0.014, 0.22, c, { x: 0, y: 0.04, z: 0.14, rx: Math.PI / 2 }, 'shiny', 8);
      k.cyl(0.035, 0.035, 0.05, c, { x: 0, y: 0.035, z: 0.02, rx: Math.PI / 2 }, 'shiny', 6);
      k.rbox(0.035, 0.11, 0.05, 0.01, wood, { x: 0, y: -0.04, z: -0.03, rx: -0.3 });
      break;
    case 'smg':
      len = 0.34;
      k.rbox(0.05, 0.08, 0.3, 0.01, c, { x: 0, y: 0.03, z: 0.08 }, 'shiny');
      k.cyl(0.012, 0.012, 0.08, dark, { x: 0, y: 0.04, z: 0.26, rx: Math.PI / 2 }, 'shiny', 6);
      k.box(0.03, 0.14, 0.04, dark, { x: 0, y: -0.08, z: 0.1 });
      k.rbox(0.035, 0.1, 0.045, 0.01, dark, { x: 0, y: -0.05, z: -0.02, rx: -0.2 });
      break;
    case 'shotgun':
      len = 0.75;
      k.cyl(0.02, 0.02, 0.62, dark, { x: 0, y: 0.05, z: 0.32, rx: Math.PI / 2 }, 'shiny', 8);
      k.cyl(0.024, 0.024, 0.3, wood, { x: 0, y: 0.012, z: 0.34, rx: Math.PI / 2 }, 'matte', 8);
      k.rbox(0.05, 0.08, 0.2, 0.01, c, { x: 0, y: 0.03, z: 0.0 });
      k.rbox(0.045, 0.1, 0.28, 0.02, wood, { x: 0, y: -0.01, z: -0.2, rx: 0.15 });
      break;
    case 'rifle':
      len = 0.78;
      k.rbox(0.055, 0.1, 0.42, 0.01, c, { x: 0, y: 0.03, z: 0.12 }, 'shiny');
      k.cyl(0.015, 0.015, 0.28, dark, { x: 0, y: 0.04, z: 0.46, rx: Math.PI / 2 }, 'shiny', 6);
      k.box(0.035, 0.16, 0.06, dark, { x: 0, y: -0.09, z: 0.14, rx: 0.2 });
      k.rbox(0.04, 0.1, 0.05, 0.01, dark, { x: 0, y: -0.05, z: -0.03, rx: -0.2 });
      k.rbox(0.045, 0.1, 0.24, 0.02, c, { x: 0, y: 0.0, z: -0.2 });
      k.box(0.02, 0.04, 0.12, dark, { x: 0, y: 0.1, z: 0.1 });
      break;
    case 'sniper':
      len = 1.0;
      k.rbox(0.05, 0.09, 0.5, 0.01, c, { x: 0, y: 0.03, z: 0.1 }, 'shiny');
      k.cyl(0.014, 0.014, 0.5, dark, { x: 0, y: 0.04, z: 0.6, rx: Math.PI / 2 }, 'shiny', 6);
      k.cyl(0.03, 0.03, 0.26, dark, { x: 0, y: 0.13, z: 0.1, rx: Math.PI / 2 }, 'shiny', 10);
      k.rbox(0.045, 0.11, 0.28, 0.02, c, { x: 0, y: -0.01, z: -0.26, rx: 0.12 });
      k.rbox(0.04, 0.1, 0.05, 0.01, dark, { x: 0, y: -0.05, z: -0.04, rx: -0.2 });
      break;
  }
  const g = k.bake();
  g.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  const holder = new THREE.Group();
  holder.add(g);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, len);
  holder.add(muzzle);
  // Lie along the hand bone (which points down the arm), grip towards the palm.
  holder.rotation.set(Math.PI / 2, 0, 0);
  holder.position.set(0, -0.06, 0.02);
  return { group: holder, muzzle };
}
