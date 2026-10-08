import * as THREE from 'three';
import type { Game } from '../game/game';
import { Kit } from '../render/kit';
import { LANDMARKS } from './layout';
import { Gunman } from '../combat/gunman';
import { randomAppearance } from '../chars/skins';
import { mulberry32 } from '../core/noise';
import { labelTexture } from '../render/signs';
import { audio } from '../core/audio';

/**
 * Fort Hammerhead: the island's military base in the north-west. A fenced compound with a
 * gatehouse, watchtowers, a runway with hangars and a jet, barracks, a helipad, a radar,
 * a motor pool (with a tank you can take) and the armory, where the Golden Chip is kept.
 * Soldiers patrol inside; step over the line and they open fire. Grab the chip and the
 * whole base goes on alert.
 */

const B = LANDMARKS.base;
const Y = 14;

export class FortHammerhead {
  readonly group = new THREE.Group();
  readonly soldiers: Gunman[] = [];
  readonly gate = new THREE.Vector3(-2580, Y, B.z + B.d / 2);
  readonly bounds = { minX: B.x - B.w / 2, maxX: B.x + B.w / 2, minZ: B.z - B.d / 2, maxZ: B.z + B.d / 2 };
  alarm = false;
  private alarmT = 0;
  private sirenT = 0;
  private radar: THREE.Object3D;
  private boom: THREE.Object3D;
  private armory = new THREE.Vector3(-2400, Y, -2460);
  private chip: THREE.Mesh | null = null;
  private rng = mulberry32(1234);
  private active = false;

  constructor(private game: Game) {
    const k = new Kit();
    const glow = new Kit();
    this.fence(k);
    this.gatehouse(k, glow);
    this.runway(k, glow);
    for (const [i, x] of [-3020, -2900, -2780].entries()) this.hangar(k, glow, x, -2640, i === 1);
    for (let i = 0; i < 3; i++) this.barracks(k, -2450 + i * 0, -2660 + i * 70);
    this.armoryBuilding(k, glow);
    this.helipad(k, glow, -2380, -2330);
    this.motorPool(k, -2520, -2320);
    this.props(k, glow);
    for (const [x, z] of [[this.bounds.minX + 6, this.bounds.minZ + 6], [this.bounds.maxX - 6, this.bounds.minZ + 6], [this.bounds.minX + 6, this.bounds.maxZ - 6], [this.bounds.maxX - 6, this.bounds.maxZ - 6], [B.x, this.bounds.minZ + 6], [B.x - 150, this.bounds.maxZ - 6]]) this.tower(k, glow, x, z);
    const baked = k.bake({ shadows: true });
    this.group.add(baked, glow.bake());
    // Radar dish (turns).
    const rk = new Kit();
    rk.cyl(0.25, 0.25, 2.5, 0x8a8f96, { y: 1.25 }, 'shiny', 8);
    rk.box(8, 3.2, 0.3, 0xe8e8ea, { y: 3.4, rx: -0.3 }, 'shiny');
    rk.cyl(0.15, 0.15, 1.6, 0x8a8f96, { y: 3.4, z: 0.9, rx: Math.PI / 2 }, 'shiny', 6);
    this.radar = rk.bake();
    this.radar.position.set(-2300, Y + 12, -2700);
    this.group.add(this.radar);
    const rbase = new Kit();
    rbase.box(6, 12, 6, 0x9aa08a, { x: -2300, y: Y + 6, z: -2700 });
    this.group.add(rbase.bake({ shadows: true }));
    game.world.collision.addBox({ minX: -2303, maxX: -2297, minZ: -2703, maxZ: -2697, minY: Y - 1, maxY: Y + 12, tag: 'base' });
    // Boom barrier at the gate.
    const bk = new Kit();
    bk.box(8, 0.25, 0.25, 0xe8e8ea, { x: 4, y: 0 });
    for (let i = 0; i < 4; i++) bk.box(1, 0.27, 0.27, 0xd8202f, { x: 0.8 + i * 2, y: 0 });
    this.boom = bk.bake();
    this.boom.position.set(this.gate.x - 4, Y + 1.1, this.gate.z);
    this.group.add(this.boom);
    // The Golden Chip on its pedestal.
    this.chip = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 24), new THREE.MeshPhongMaterial({ color: 0xffc83a, emissive: 0x6a4a00, shininess: 120, specular: 0xffffff }));
    this.chip.rotation.x = Math.PI / 2;
    this.chip.position.set(this.armory.x, Y + 1.45, this.armory.z - 4);
    this.group.add(this.chip);
    game.renderer.scene.add(this.group);
    this.spawnSoldiers();
    this.interactions();
  }

  contains(x: number, z: number): boolean {
    const b = this.bounds;
    return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  }

  armoryPos(): { x: number; z: number } {
    return { x: this.armory.x, z: this.armory.z + 9 };
  }

  raiseAlarm(): void {
    if (!this.alarm) {
      this.alarm = true;
      this.game.hud.toast('Fort Hammerhead is on alert!', 'bad', 4000);
    }
    this.alarmT = 0;
  }

  // ---------------------------------------------------------------- building

  private fence(k: Kit): void {
    const b = this.bounds;
    const c = this.game.world.collision;
    const tex = chainLink();
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const H = 3.6;
    const side = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat.clone());
      (m.material as THREE.MeshLambertMaterial).map = tex.clone();
      (m.material as THREE.MeshLambertMaterial).map!.repeat.set(len / 3, 1);
      (m.material as THREE.MeshLambertMaterial).map!.needsUpdate = true;
      m.position.set((x0 + x1) / 2, Y + H / 2, (z0 + z1) / 2);
      m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      this.group.add(m);
      for (let s = 0; s <= len; s += 6) {
        const t = s / len;
        k.cyl(0.07, 0.07, H + 0.6, 0x8a8f96, { x: x0 + (x1 - x0) * t, y: Y + (H + 0.6) / 2, z: z0 + (z1 - z0) * t }, 'shiny', 6);
      }
      // Barbed wire on top.
      k.cyl(0.03, 0.03, len, 0x5a5f66, { x: (x0 + x1) / 2, y: Y + H + 0.45, z: (z0 + z1) / 2, rz: Math.PI / 2, ry: -Math.atan2(z1 - z0, x1 - x0) }, 'shiny', 4);
      const minX = Math.min(x0, x1) - 0.4;
      const maxX = Math.max(x0, x1) + 0.4;
      const minZ = Math.min(z0, z1) - 0.4;
      const maxZ = Math.max(z0, z1) + 0.4;
      c.addBox({ minX, maxX, minZ, maxZ, minY: Y - 4, maxY: Y + H + 1, tag: 'baseFence', cam: false });
    };
    const gx = this.gate.x;
    side(b.minX, b.minZ, b.maxX, b.minZ);
    side(b.minX, b.minZ, b.minX, b.maxZ);
    side(b.maxX, b.minZ, b.maxX, b.maxZ);
    side(b.minX, b.maxZ, gx - 7, b.maxZ);
    side(gx + 7, b.maxZ, b.maxX, b.maxZ);
  }

  private gatehouse(k: Kit, glow: Kit): void {
    const g = this.gate;
    k.box(4, 3, 4, 0xd8d2c0, { x: g.x + 10, y: Y + 1.5, z: g.z - 1 });
    k.box(4.6, 0.3, 4.6, 0x5d6b3a, { x: g.x + 10, y: Y + 3.15, z: g.z - 1 });
    k.box(3.2, 1.2, 0.08, 0x9ccfe8, { x: g.x + 10, y: Y + 2, z: g.z + 1.02 }, 'glass');
    k.box(1.2, 1.1, 0.4, 0xd8d2c0, { x: g.x - 4.6, y: Y + 0.55, z: g.z });
    for (const s of [-1, 1]) {
      k.box(1.2, 6, 1.2, 0x9aa08a, { x: g.x + s * 8, y: Y + 3, z: g.z });
      // Concrete barriers in a chicane outside.
      k.box(3, 1, 0.8, 0xd0ccc0, { x: g.x + s * 3.5, y: Y + 0.5, z: g.z + 14 + (s > 0 ? 8 : 0) });
    }
    k.box(17, 1.4, 0.5, 0x5d6b3a, { x: g.x, y: Y + 6.6, z: g.z });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.2), new THREE.MeshBasicMaterial({ map: labelTexture('FORT HAMMERHEAD', { width: 1024, height: 90, color: '#f2f2e0', bg: '#3a4426', size: 70, font: 'Bungee' }), toneMapped: false }));
    sign.position.set(g.x, Y + 6.6, g.z + 0.27);
    this.group.add(sign);
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), new THREE.MeshBasicMaterial({ map: labelTexture('RESTRICTED AREA', { width: 512, height: 240, color: '#ffffff', bg: '#c8202f', size: 64 }), toneMapped: false }));
    warn.position.set(g.x - 12, Y + 1.8, g.z + 0.5);
    this.group.add(warn);
    k.cyl(0.06, 0.06, 1.8, 0x8a8f96, { x: g.x - 12, y: Y + 0.9, z: g.z + 0.45 }, 'shiny', 6);
    glow.sphere(0.25, 0xff3030, { x: g.x - 8, y: Y + 6.3, z: g.z + 0.7 }, 'glow', 8, 6);
    glow.sphere(0.25, 0xff3030, { x: g.x + 8, y: Y + 6.3, z: g.z + 0.7 }, 'glow', 8, 6);
    const c = this.game.world.collision;
    c.addBox({ minX: g.x + 8, maxX: g.x + 12, minZ: g.z - 3, maxZ: g.z + 1, minY: Y - 1, maxY: Y + 3.3, tag: 'base' });
    for (const s of [-1, 1]) c.addBox({ minX: g.x + s * 8 - 0.6, maxX: g.x + s * 8 + 0.6, minZ: g.z - 0.6, maxZ: g.z + 0.6, minY: Y - 1, maxY: Y + 7, tag: 'base' });
  }

  private runway(k: Kit, glow: Kit): void {
    const z = -2730;
    const x0 = -3120;
    const x1 = -2340;
    k.box(x1 - x0, 0.12, 36, 0x3a3c40, { x: (x0 + x1) / 2, y: Y + 0.06, z });
    for (let x = x0 + 30; x < x1 - 30; x += 30) k.box(14, 0.02, 1, 0xf4f4f4, { x, y: Y + 0.13, z });
    for (const s of [-1, 1]) {
      k.box(x1 - x0, 0.02, 0.6, 0xf4f4f4, { x: (x0 + x1) / 2, y: Y + 0.13, z: z + s * 16.5 });
      for (let x = x0; x <= x1; x += 40) glow.sphere(0.18, s > 0 ? 0x3fe07a : 0xffd23d, { x, y: Y + 0.3, z: z + s * 18.5 }, 'glow', 6, 4);
    }
    for (let i = 0; i < 8; i++) {
      k.box(16, 0.02, 1.2, 0xf4f4f4, { x: x0 + 14, y: Y + 0.13, z: z - 13 + i * 3.6 });
      k.box(16, 0.02, 1.2, 0xf4f4f4, { x: x1 - 14, y: Y + 0.13, z: z - 13 + i * 3.6 });
    }
    // Control tower.
    k.box(6, 18, 6, 0xd8d2c0, { x: -2380, y: Y + 9, z: -2650 });
    k.cyl(5.5, 4.2, 4, 0x9ccfe8, { x: -2380, y: Y + 20, z: -2650 }, 'glass', 8);
    k.cyl(6, 6, 0.6, 0x5d6b3a, { x: -2380, y: Y + 22.3, z: -2650 }, 'matte', 8);
    glow.sphere(0.4, 0xff3030, { x: -2380, y: Y + 23.2, z: -2650 }, 'glow', 8, 6);
    this.game.world.collision.addBox({ minX: -2383, maxX: -2377, minZ: -2653, maxZ: -2647, minY: Y - 1, maxY: Y + 22, tag: 'base' });
  }

  private hangar(k: Kit, glow: Kit, x: number, z: number, jet: boolean): void {
    const W = 34;
    const D = 40;
    // Arched roof (half cylinder along z), open at the front (+z towards the runway is -z...).
    k.cyl(W / 2, W / 2, D, 0x7d8670, { x, y: Y, z, rx: Math.PI / 2 }, 'shiny', 18, true);
    // The same shell mirrored, so the roof shows from inside too.
    k.cyl(W / 2 - 0.15, W / 2 - 0.15, D, 0x9aa08a, { x, y: Y, z, rx: Math.PI / 2, sx: -1 }, 'matte', 18, true);
    k.box(W, W / 2, 0.4, 0x6b735e, { x, y: Y + W / 4, z: z + D / 2 });
    k.box(W + 0.2, 0.4, D, 0x5a614f, { x, y: Y + 0.2, z: z });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2), new THREE.MeshBasicMaterial({ map: labelTexture(`HANGAR ${Math.round((x + 3100) / 120)}`, { width: 512, height: 100, color: '#f2f2e0', bg: '#3a4426', size: 60 }), toneMapped: false }));
    sign.position.set(x, Y + 12, z - D / 2 - 0.05);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    glow.box(W - 4, 0.15, 0.15, 0xfff1c8, { x, y: Y + 13.5, z: z - D / 2 + 1 }, 'glow');
    const c = this.game.world.collision;
    c.addBox({ minX: x - W / 2 - 0.5, maxX: x - W / 2 + 1.5, minZ: z - D / 2, maxZ: z + D / 2, minY: Y - 1, maxY: Y + 14, tag: 'base' });
    c.addBox({ minX: x + W / 2 - 1.5, maxX: x + W / 2 + 0.5, minZ: z - D / 2, maxZ: z + D / 2, minY: Y - 1, maxY: Y + 14, tag: 'base' });
    c.addBox({ minX: x - W / 2, maxX: x + W / 2, minZ: z + D / 2 - 0.5, maxZ: z + D / 2 + 0.5, minY: Y - 1, maxY: Y + 17, tag: 'base' });
    if (jet) this.jet(k, glow, x, z - 4);
    else {
      for (let i = 0; i < 6; i++) k.box(1.6, 1.6, 1.6, 0x6b5a3a, { x: x - 10 + (i % 3) * 2, y: Y + 0.8 + Math.floor(i / 3) * 1.6, z: z + 12 });
      k.cyl(1.2, 1.2, 4, 0x5d6b3a, { x: x + 8, y: Y + 1.2, z: z + 10, rz: Math.PI / 2 }, 'shiny', 12);
    }
  }

  private jet(k: Kit, glow: Kit, x: number, z: number): void {
    const c = 0x6a737a;
    k.cyl(0.9, 1.1, 12, c, { x, y: Y + 2.4, z, rx: Math.PI / 2 }, 'shiny', 12);
    k.cone(0.9, 3, c, { x, y: Y + 2.4, z: z - 7.5, rx: -Math.PI / 2 }, 'shiny', 12);
    k.sphere(0.8, 0x2a3a4a, { x, y: Y + 3.2, z: z - 4.2, sz: 2.2, sy: 0.7 }, 'glass');
    k.box(11, 0.18, 4, c, { x, y: Y + 2.2, z: z + 1.5 }, 'shiny');
    k.box(4.4, 0.14, 1.8, c, { x, y: Y + 2.5, z: z + 5.6 }, 'shiny');
    for (const s of [-1, 1]) k.box(0.14, 2.6, 2.2, c, { x: x + s * 0.8, y: Y + 3.8, z: z + 5.2, rz: s * 0.35 }, 'shiny');
    glow.cyl(0.7, 0.7, 0.1, 0xff7a2f, { x, y: Y + 2.4, z: z + 6.05, rx: Math.PI / 2 }, 'glow', 12);
    for (const [dx, dz] of [[0, -4], [-1.8, 2], [1.8, 2]]) k.cyl(0.25, 0.25, 0.2, 0x111111, { x: x + dx, y: Y + 0.3, z: z + dz, rz: Math.PI / 2 }, 'matte', 10);
  }

  private barracks(k: Kit, x: number, z: number): void {
    k.box(40, 4, 11, 0xc8c2a8, { x, y: Y + 2, z });
    k.box(41, 0.5, 12, 0x4a5a2a, { x, y: Y + 4.25, z });
    for (let i = -4; i <= 4; i++) {
      k.box(1.4, 1.2, 0.1, 0x9ccfe8, { x: x + i * 4.2, y: Y + 2.4, z: z + 5.52 }, 'glass');
      k.box(1.4, 1.2, 0.1, 0x9ccfe8, { x: x + i * 4.2, y: Y + 2.4, z: z - 5.52 }, 'glass');
    }
    k.box(1.6, 2.4, 0.12, 0x5a4a32, { x: x - 18, y: Y + 1.2, z: z + 5.55 });
    this.game.world.collision.addBox({ minX: x - 20, maxX: x + 20, minZ: z - 5.5, maxZ: z + 5.5, minY: Y - 1, maxY: Y + 4.5, tag: 'base' });
  }

  private armoryBuilding(k: Kit, glow: Kit): void {
    const a = this.armory;
    const W = 18;
    const D = 12;
    const H = 5;
    const c = this.game.world.collision;
    const wall = (x: number, z: number, w: number, d: number) => {
      k.box(w, H, d, 0xa8a89a, { x: a.x + x, y: Y + H / 2, z: a.z + z });
      c.addBox({ minX: a.x + x - w / 2, maxX: a.x + x + w / 2, minZ: a.z + z - d / 2, maxZ: a.z + z + d / 2, minY: Y - 1, maxY: Y + H + 0.5, tag: 'base' });
    };
    wall(0, -D / 2, W, 0.8);
    wall(-W / 2, 0, 0.8, D);
    wall(W / 2, 0, 0.8, D);
    wall(-5.75, D / 2, 6.5, 0.8);
    wall(5.75, D / 2, 6.5, 0.8);
    k.box(W + 1.2, 0.8, D + 1.2, 0x7a7a6e, { x: a.x, y: Y + H + 0.4, z: a.z });
    k.box(W, 0.05, D, 0x4a4a46, { x: a.x, y: Y + 0.03, z: a.z });
    // Blast door (open) and a yellow-black stripe frame.
    k.box(0.4, 3.6, 5, 0x5a5f66, { x: a.x + 2.7, y: Y + 1.8, z: a.z + D / 2 + 2.6, ry: 0.2 }, 'shiny');
    for (let i = 0; i < 6; i++) k.box(0.9, 0.3, 0.9, i % 2 ? 0x111111 : 0xffd23d, { x: a.x - 2.5 + i, y: Y + 3.9, z: a.z + D / 2 + 0.2 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1), new THREE.MeshBasicMaterial({ map: labelTexture('ARMORY', { width: 512, height: 100, color: '#ffd23d', bg: '#1a1a1a', size: 70, font: 'Bungee' }), toneMapped: false }));
    sign.position.set(a.x, Y + 4.6, a.z + D / 2 + 0.45);
    this.group.add(sign);
    // Gun racks and the pedestal.
    for (const s of [-1, 1]) {
      k.box(0.6, 2.2, 8, 0x3a3a36, { x: a.x + s * (W / 2 - 1), y: Y + 1.1, z: a.z }, 'shiny');
      for (let i = 0; i < 7; i++) k.box(0.15, 1.2, 0.12, 0x2a2a2a, { x: a.x + s * (W / 2 - 1.4), y: Y + 1.3, z: a.z - 3 + i }, 'shiny');
    }
    k.cyl(0.6, 0.7, 1.2, 0x2a2a2a, { x: a.x, y: Y + 0.6, z: a.z - 4 }, 'shiny', 16);
    glow.cyl(0.62, 0.62, 0.06, 0xffd23d, { x: a.x, y: Y + 1.22, z: a.z - 4 }, 'glow', 16);
    glow.cone(1.4, 4, 0xfff1b0, { x: a.x, y: Y + 3, z: a.z - 4 }, 'glow', 14);
  }

  private helipad(k: Kit, glow: Kit, x: number, z: number): void {
    k.cyl(12, 12, 0.2, 0x3a3c40, { x, y: Y + 0.1, z }, 'matte', 28);
    k.torus(9, 0.3, 0xffd23d, { x, y: Y + 0.22, z, rx: Math.PI / 2 }, 'matte', Math.PI * 2, 4, 28);
    k.box(1, 0.02, 7, 0xf4f4f4, { x: x - 2.2, y: Y + 0.22, z });
    k.box(1, 0.02, 7, 0xf4f4f4, { x: x + 2.2, y: Y + 0.22, z });
    k.box(3.4, 0.02, 1, 0xf4f4f4, { x, y: Y + 0.22, z });
    for (let a = 0; a < 8; a++) glow.sphere(0.15, 0x3fe07a, { x: x + Math.cos((a / 8) * Math.PI * 2) * 11.5, y: Y + 0.3, z: z + Math.sin((a / 8) * Math.PI * 2) * 11.5 }, 'glow', 6, 4);
    // Helicopter.
    const c = 0x4a5a3a;
    k.sphere(1.6, c, { x, y: Y + 2.2, z, sz: 1.6 }, 'shiny');
    k.sphere(1.2, 0x2a3a4a, { x, y: Y + 2.5, z: z - 1.4, sz: 1.2, sy: 0.9 }, 'glass');
    k.cyl(0.35, 0.18, 6, c, { x, y: Y + 2.6, z: z + 4.5, rx: Math.PI / 2 }, 'shiny', 8);
    k.box(0.12, 1.6, 1.0, c, { x, y: Y + 3.3, z: z + 7.4 }, 'shiny');
    k.cyl(0.12, 0.12, 0.8, 0x2a2a2a, { x, y: Y + 4, z }, 'shiny', 6);
    k.box(11, 0.06, 0.4, 0x1a1a1a, { x, y: Y + 4.4, z, ry: 0.5 });
    k.box(11, 0.06, 0.4, 0x1a1a1a, { x, y: Y + 4.4, z, ry: 0.5 + Math.PI / 2 });
    for (const s of [-1, 1]) k.box(0.15, 0.15, 4, 0x2a2a2a, { x: x + s * 1.2, y: Y + 0.4, z }, 'shiny');
  }

  private motorPool(k: Kit, x: number, z: number): void {
    k.box(60, 0.1, 30, 0x45474c, { x, y: Y + 0.05, z });
    for (let i = 0; i < 6; i++) k.box(0.2, 0.02, 10, 0xf4f4f4, { x: x - 25 + i * 10, y: Y + 0.11, z: z - 6 });
    k.box(60, 0.4, 8, 0x5d6b3a, { x, y: Y + 5, z: z - 12 });
    for (let i = 0; i < 4; i++) k.cyl(0.15, 0.15, 5, 0x8a8f96, { x: x - 28 + i * 18.6, y: Y + 2.5, z: z - 9 }, 'shiny', 6);
  }

  private tower(k: Kit, glow: Kit, x: number, z: number): void {
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) k.cyl(0.14, 0.14, 9, 0x6b5a3a, { x: x + dx, y: Y + 4.5, z: z + dz }, 'matte', 6);
    k.box(4, 0.3, 4, 0x6b5a3a, { x, y: Y + 9, z });
    k.box(4, 1.1, 0.12, 0x6b5a3a, { x, y: Y + 9.7, z: z - 2 });
    k.box(4, 1.1, 0.12, 0x6b5a3a, { x, y: Y + 9.7, z: z + 2 });
    k.box(0.12, 1.1, 4, 0x6b5a3a, { x: x - 2, y: Y + 9.7, z });
    k.box(0.12, 1.1, 4, 0x6b5a3a, { x: x + 2, y: Y + 9.7, z });
    k.cone(3.2, 1.6, 0x4a5a2a, { x, y: Y + 12, z }, 'matte', 4);
    for (const [dx, dz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) k.cyl(0.06, 0.06, 2.2, 0x6b5a3a, { x: x + dx, y: Y + 10.3, z: z + dz }, 'matte', 4);
    glow.cyl(0.3, 0.45, 0.5, 0xfff8d0, { x: x + 1.6, y: Y + 10.6, z: z + 1.6, rx: 0.6 }, 'glow', 8);
    this.game.world.collision.addBox({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, minY: Y - 1, maxY: Y + 9, tag: 'base', cam: false });
  }

  private props(k: Kit, glow: Kit): void {
    const r = this.rng;
    const c = this.game.world.collision;
    // Sandbag walls and crate stacks round the compound.
    for (let i = 0; i < 26; i++) {
      const x = B.x - B.w / 2 + 40 + r() * (B.w - 80);
      const z = B.z - B.d / 2 + 140 + r() * (B.d - 200);
      if (Math.abs(x - this.armory.x) < 20 && Math.abs(z - this.armory.z) < 16) continue;
      if (Math.abs(x + 2450) < 25 && z < -2500 && z > -2700) continue;
      if (r() < 0.5) {
        const ry = r() * Math.PI;
        for (let j = 0; j < 3; j++) k.rbox(4, 0.45, 1, 0.2, 0xb8a878, { x, y: Y + 0.25 + j * 0.42, z, ry }, 'matte', 2);
        c.addCircle({ x, z, r: 1.6, minY: Y - 1, maxY: Y + 1.3, tag: 'base' });
      } else {
        const n = 1 + Math.floor(r() * 4);
        for (let j = 0; j < n; j++) k.box(1.4, 1.4, 1.4, j % 2 ? 0x6b5a3a : 0x5d6b3a, { x: x + (j % 2) * 1.5, y: Y + 0.7 + Math.floor(j / 2) * 1.4, z, ry: 0.1 });
        c.addCircle({ x: x + 0.7, z, r: 1.6, minY: Y - 1, maxY: Y + 2.8, tag: 'base' });
      }
    }
    // Fuel tanks.
    for (let i = 0; i < 3; i++) {
      k.cyl(3, 3, 6, 0xe8e8ea, { x: -3080 + i * 8, y: Y + 3, z: -2300 }, 'shiny', 16);
      c.addCircle({ x: -3080 + i * 8, z: -2300, r: 3.2, minY: Y - 1, maxY: Y + 6, tag: 'base' });
    }
    // Flag.
    k.cyl(0.1, 0.12, 14, 0xe8e8ea, { x: this.gate.x + 30, y: Y + 7, z: this.gate.z - 30 }, 'shiny', 8);
    k.box(3.2, 2, 0.05, 0x3a5fa0, { x: this.gate.x + 31.7, y: Y + 13, z: this.gate.z - 30 });
    glow.box(0.6, 0.4, 0.06, 0xffd23d, { x: this.gate.x + 31, y: Y + 13.4, z: this.gate.z - 30 }, 'glow');
  }

  // ---------------------------------------------------------------- soldiers

  private spawnSoldiers(): void {
    const g = this.game;
    const add = (x: number, z: number, yaw: number, route: [number, number][], gun = 'rifle') => {
      const s = new Gunman(g, randomAppearance(this.rng, 'soldier'), 'soldier', x, z, yaw, gun);
      s.route = route.map(([rx, rz]) => ({ x: rx, z: rz }));
      s.state = route.length ? 'patrol' : 'idle';
      this.soldiers.push(s);
    };
    const gx = this.gate.x;
    const gz = this.gate.z;
    add(gx - 5, gz - 3, Math.PI * 0, [], 'rifle');
    add(gx + 5, gz - 3, 0, [], 'rifle');
    const a = this.armory;
    add(a.x - 6, a.z + 9, 0, [], 'rifle');
    add(a.x + 6, a.z + 9, 0, [], 'smg');
    add(a.x, a.z - 1, 0, [[a.x - 5, a.z], [a.x + 5, a.z]], 'pistol');
    add(-2600, -2400, 0, [[-2600, -2400], [-2400, -2400], [-2400, -2300], [-2600, -2300]]);
    add(-2900, -2450, 0, [[-2900, -2450], [-3100, -2450], [-3100, -2300], [-2900, -2300]]);
    add(-2800, -2600, 0, [[-2800, -2600], [-3050, -2600]]);
    add(-2500, -2560, 0, [[-2500, -2560], [-2500, -2420], [-2350, -2420]]);
    add(-2700, -2500, 0, [[-2700, -2500], [-2700, -2300], [-2850, -2300]]);
    add(-2380, -2640, Math.PI, []);
    add(-2380, -2320, 0, [[-2400, -2340], [-2360, -2310]], 'smg');
    add(-3000, -2780, 0, [[-3000, -2780], [-2500, -2780]]);
    add(-2262, -2230, Math.PI, [[-2262, -2230], [-2262, -2760]]);
  }

  private interactions(): void {
    const g = this.game;
    const a = this.armory;
    g.interactions.add({
      id: 'base:chip',
      x: a.x, y: Y, z: a.z - 2.6, radius: 2.2,
      label: () => ((g.stats.goldenChip ?? 0) > 0 ? 'Empty pedestal' : 'Take the Golden Chip'),
      sub: () => ((g.stats.goldenChip ?? 0) > 0 ? '' : 'This will not go unnoticed'),
      enabled: () => (g.stats.goldenChip ?? 0) === 0,
      action: () => {
        g.stats.goldenChip = 1;
        if (this.chip) this.chip.visible = false;
        audio.play('jackpot');
        g.hud.banner('THE GOLDEN CHIP', 'Now get out alive!', 3000, 'gold');
        g.unlockSkin('commando');
        if (!g.combat.owned.includes('goldcannon')) g.combat.give('goldcannon');
        for (const s of this.soldiers) s.alarm();
        this.raiseAlarm();
        g.save();
      },
    });
  }

  /** The chip is gone from its pedestal (on load, quietly). */
  takeChip(_loud: boolean): void {
    if (this.chip) this.chip.visible = false;
  }

  /** Spawn the base's vehicles once the vehicle system exists. */
  spawnVehicles(): void {
    const g = this.game;
    g.vehicles.spawn('tank', -2540, -2322, Math.PI / 2, { id: 'basetank' });
    g.vehicles.spawn('jeep', -2510, -2322, Math.PI / 2, { id: 'basejeep1' });
    g.vehicles.spawn('jeep', -2500, -2322, Math.PI / 2, { id: 'basejeep2' });
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.pos;
    const d = Math.hypot(p.x - B.x, p.z - B.z);
    const near = d < 700;
    if (near !== this.active) {
      this.active = near;
      for (const s of this.soldiers) s.model.root.visible = near;
    }
    this.radar.rotation.y += dt * 0.8;
    if (this.chip?.visible) this.chip.rotation.z += dt * 2;
    // The boom lifts for you when the alarm is off (the guards are friendly at the gate).
    const atGate = Math.hypot(p.x - this.gate.x, p.z - this.gate.z) < 14;
    const lift = atGate && !this.alarm && g.vehicles.driving?.def.cls !== 'tank' ? 1 : 0;
    this.boom.rotation.z += ((lift ? 1.35 : 0) - this.boom.rotation.z) * Math.min(1, dt * 3);
    if (!near) return;
    const inside = this.contains(p.x, p.z);
    for (const s of this.soldiers) {
      s.hostile = this.alarm || inside;
      s.update(dt, g.renderer.camera.position);
    }
    if (this.alarm) {
      this.sirenT -= dt;
      if (this.sirenT <= 0) {
        this.sirenT = 2.2;
        audio.playAt('alarm', B.x, B.z, 0.6);
      }
      if (!inside) this.alarmT += dt;
      if (this.alarmT > 50 && d > 500) {
        this.alarm = false;
        for (const s of this.soldiers) if (s.state === 'alert') s.state = s.route.length ? 'patrol' : 'idle';
      }
    }
  }
}

/** A chain-link fence pattern with transparent holes. */
function chainLink(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#b8bcc4';
  g.lineWidth = 3;
  for (let i = -64; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 64, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  g.fillStyle = '#8a8f96';
  g.fillRect(0, 0, 64, 4);
  g.fillRect(0, 60, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
