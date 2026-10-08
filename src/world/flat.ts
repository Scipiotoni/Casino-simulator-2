import * as THREE from 'three';
import { Kit } from '../render/kit';
import { labelTexture } from '../render/signs';
import { lotFrontPoint, type Lot } from './layout';
import type { Game } from '../game/game';

/**
 * Your flat: a ground-floor apartment in Palm Court, the first block off the Interstate 15
 * bridge. Everyone starts here. Walk in through your own front door: a bed to sleep and save,
 * a wardrobe, a laptop with the property listings, a sofa and a TV. Your car parks outside.
 */

/** The unit inside the building, in the building's frame (x across the front, -z into the lot). */
const UNIT = { x0: -19, x1: -5, z0: -0.4, z1: -10.4, h: 3.2 };

export class Flat {
  readonly group = new THREE.Group();
  /** On the pavement outside your front door, and the way the door faces. */
  readonly door = new THREE.Vector3();
  readonly yaw: number;
  /** Where your car parks (kerb in front of the building), heading along the street. */
  readonly parking = { x: 0, z: 0, heading: 0 };
  readonly floorY: number;
  readonly lot: Lot;
  private interior = new THREE.Group();
  private bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  constructor(private game: Game) {
    const lot = game.world.terrain.lots.find((l) => l.special === 'flat');
    if (!lot) throw new Error('No lot for the flat');
    this.lot = lot;
    const y = game.world.terrain.lotY.get(lot.id) ?? 6;
    this.floorY = y + 0.15;
    const fp = lotFrontPoint(lot);
    this.yaw = fp.yaw;
    const setback = 4;
    this.group.position.set(fp.x - Math.sin(fp.yaw) * setback, 0, fp.z - Math.cos(fp.yaw) * setback);
    this.group.rotation.y = fp.yaw;
    this.group.add(this.interior);
    this.group.updateMatrixWorld(true);
    this.build(y);
    game.renderer.scene.add(this.group);
    const d = this.toWorld((UNIT.x0 + UNIT.x1) / 2, 2.2);
    this.door.set(d.x, y, d.z);
    // Kerbside parking, in the near lane, facing the way traffic goes (west on I-15).
    const p = this.toWorld((UNIT.x0 + UNIT.x1) / 2, setback + 6.5);
    this.parking.x = p.x;
    this.parking.z = p.z;
    this.parking.heading = fp.yaw - Math.PI / 2;
    this.interactions();
  }

  /** A point in the building's frame, in world space. */
  toWorld(x: number, z: number, y = this.floorY): THREE.Vector3 {
    return this.group.localToWorld(new THREE.Vector3(x, y, z));
  }

  /** Is a world point inside your flat? */
  inside(x: number, z: number): boolean {
    const p = this.group.worldToLocal(new THREE.Vector3(x, 0, z));
    return p.x > UNIT.x0 && p.x < UNIT.x1 && p.z < UNIT.z0 && p.z > UNIT.z1;
  }

  /** Spawn point inside, by the bed. */
  spawn(): { x: number; y: number; z: number; yaw: number } {
    const p = this.toWorld((UNIT.x0 + UNIT.x1) / 2, -3);
    return { x: p.x, y: this.floorY, z: p.z, yaw: this.yaw };
  }

  private box(x: number, z: number, w: number, d: number, y0: number, y1: number, tag = 'flat', cam = true): void {
    const p = this.toWorld(x, z, 0);
    const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
    const ww = rot ? d : w;
    const dd = rot ? w : d;
    this.game.world.collision.addBox({ minX: p.x - ww / 2, maxX: p.x + ww / 2, minZ: p.z - dd / 2, maxZ: p.z + dd / 2, minY: y0, maxY: y1, tag, cam });
  }

  private build(y: number): void {
    const k = new Kit();
    const glow = new Kit();
    const inner = new Kit();
    const W = 42;
    const D = 22;
    const floors = 4;
    const FH = 3.6;
    const H = floors * FH;
    const stucco = 0xf3e7d3;
    const trim = 0x2f6f73;
    const fy = this.floorY;
    // Shell: back and side walls, the upper floors' front, the roof and a parapet.
    k.box(W, H, 0.4, stucco, { y: y + H / 2, z: -D });
    k.box(0.4, H, D, stucco, { x: -W / 2, y: y + H / 2, z: -D / 2 });
    k.box(0.4, H, D, stucco, { x: W / 2, y: y + H / 2, z: -D / 2 });
    k.box(W, H - FH, 0.4, stucco, { y: y + FH + (H - FH) / 2, z: 0 });
    k.box(W + 0.8, 0.5, D + 0.8, 0xd8ccb8, { y: y + H + 0.25, z: -D / 2 });
    k.box(W + 0.8, 0.9, 0.3, trim, { y: y + H + 0.95, z: 0.25 });
    // Ground floor front: your door and window on the left, the lobby on the right.
    const ux0 = UNIT.x0;
    const ux1 = UNIT.x1;
    const doorX = (ux0 + ux1) / 2;
    const doorW = 1.3;
    k.box(ux0 + W / 2, FH, 0.4, stucco, { x: (-W / 2 + ux0) / 2, y: y + FH / 2, z: 0 });
    k.box(doorX - doorW / 2 - ux0, 0.9, 0.4, stucco, { x: (ux0 + doorX - doorW / 2) / 2, y: y + 0.45, z: 0 });
    k.box(ux1 - doorX - doorW / 2, 0.9, 0.4, stucco, { x: (doorX + doorW / 2 + ux1) / 2, y: y + 0.45, z: 0 });
    k.box(ux1 - ux0, FH - 2.5, 0.4, stucco, { x: (ux0 + ux1) / 2, y: y + 2.5 + (FH - 2.5) / 2, z: 0 });
    for (const [a, b] of [[ux0, doorX - doorW / 2], [doorX + doorW / 2, ux1]]) {
      k.box(b - a - 0.2, 1.6, 0.08, 0x9ccfe8, { x: (a + b) / 2, y: y + 1.7, z: 0.02 }, 'glass');
      k.box(b - a, 0.12, 0.5, trim, { x: (a + b) / 2, y: y + 0.92, z: 0.1 }, 'shiny');
    }
    // Front door (open, swung inwards), frame and number.
    k.box(doorW + 0.3, 0.2, 0.5, trim, { x: doorX, y: y + 2.55, z: 0 }, 'shiny');
    k.box(0.08, 2.4, doorW, 0x7a3a22, { x: doorX - doorW / 2 + 0.04, y: fy + 1.2, z: -doorW / 2 - 0.2 }, 'shiny');
    k.box(W / 2 - ux1, FH, 0.4, stucco, { x: (ux1 + W / 2) / 2, y: y + FH / 2, z: 0 });
    glow.box(3.4, 1.1, 0.06, 0xfff1c8, { x: 11, y: y + 2.9, z: 0.24 }, 'glow');
    k.box(4, 2.6, 0.1, 0x3a2416, { x: 11, y: y + 1.3, z: 0.24 }, 'shiny');
    // Upper floors: windows with lit panes, little balconies.
    for (let f = 1; f < floors; f++) {
      const wy = y + f * FH;
      for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 4.4) {
        glow.box(2.0, 1.5, 0.06, (x * 7 + f * 3) % 3 === 0 ? 0xffe2a8 : 0x93b6c8, { x, y: wy + 1.75, z: 0.23 }, 'glow');
        k.box(2.4, 0.15, 0.3, trim, { x, y: wy + 0.95, z: 0.3 }, 'shiny');
        if ((Math.round(x) + f) % 2 === 0) {
          k.box(3.0, 0.14, 1.2, 0xd8ccb8, { x, y: wy + 0.1, z: 0.8 });
          k.box(3.0, 0.9, 0.05, trim, { x, y: wy + 0.6, z: 1.38 }, 'shiny');
        }
      }
    }
    // Planters and palms by the door.
    for (const px of [ux0 - 1.6, ux1 + 1.6]) {
      k.box(1.2, 0.7, 1.2, 0xc8b89a, { x: px, y: y + 0.35, z: 1.4 });
      k.cyl(0.12, 0.16, 4.4, 0x8a6a40, { x: px, y: y + 2.9, z: 1.4 }, 'matte', 6);
      for (let i = 0; i < 6; i++) k.cone(0.25, 2.2, 0x3fae3a, { x: px + Math.cos(i) * 0.8, y: y + 5.0, z: 1.4 + Math.sin(i) * 0.8, rz: Math.cos(i) * 1.2, rx: Math.sin(i) * 1.2 }, 'matte', 4);
    }
    this.group.add(k.bake({ shadows: true }), glow.bake());
    // The sign over the lobby.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.3), new THREE.MeshBasicMaterial({ map: labelTexture('PALM COURT', { width: 1024, height: 148, font: 'Lilita One', color: '#ffffff', bg: '#2f6f73', size: 100 }), toneMapped: false }));
    sign.position.set(11, y + FH + 0.6, 0.26);
    this.group.add(sign);
    // Your unit inside: walls, floor, ceiling and furniture.
    const iw = ux1 - ux0;
    const id = UNIT.z0 - UNIT.z1;
    const cx = (ux0 + ux1) / 2;
    const cz = (UNIT.z0 + UNIT.z1) / 2;
    for (let i = 0; i < 14; i++) inner.box(iw / 14 - 0.02, 0.05, id, i % 2 ? 0xa8743e : 0xb98450, { x: ux0 + (i + 0.5) * (iw / 14), y: fy - 0.02, z: cz });
    inner.box(iw, 0.1, id, 0xf4efe6, { x: cx, y: fy + UNIT.h, z: cz });
    inner.box(iw, UNIT.h, 0.15, 0xe6dccb, { x: cx, y: fy + UNIT.h / 2, z: UNIT.z1 });
    inner.box(0.15, UNIT.h, id, 0xd9e4e0, { x: ux0 + 0.1, y: fy + UNIT.h / 2, z: cz });
    inner.box(0.15, UNIT.h, id, 0xd9e4e0, { x: ux1 - 0.1, y: fy + UNIT.h / 2, z: cz });
    inner.box(iw, 0.12, 0.2, 0xffffff, { x: cx, y: fy + 0.06, z: UNIT.z1 + 0.1 });
    glow.box(1.4, 0.04, 1.4, 0xfff4dc, { x: cx, y: fy + UNIT.h - 0.04, z: cz }, 'glow');
    // Bed (back left), wardrobe, desk with laptop, sofa and TV, a kitchenette on the right.
    const bx = ux0 + 2.2;
    const bz = UNIT.z1 + 1.6;
    inner.rbox(2.0, 0.45, 2.4, 0.08, 0x5a3a24, { x: bx, y: fy + 0.25, z: bz });
    inner.rbox(1.9, 0.25, 2.2, 0.1, 0xf4f4f4, { x: bx, y: fy + 0.55, z: bz + 0.05 });
    inner.rbox(1.95, 0.12, 1.4, 0.06, 0x2f6f73, { x: bx, y: fy + 0.68, z: bz + 0.45 });
    inner.rbox(0.7, 0.18, 0.4, 0.08, 0xffffff, { x: bx - 0.45, y: fy + 0.75, z: bz - 0.85 });
    inner.rbox(0.7, 0.18, 0.4, 0.08, 0xffffff, { x: bx + 0.45, y: fy + 0.75, z: bz - 0.85 });
    inner.box(2.1, 1.0, 0.12, 0x5a3a24, { x: bx, y: fy + 0.8, z: UNIT.z1 + 0.25 });
    const wx = ux0 + 0.6;
    const wz = UNIT.z1 + 4.6;
    inner.box(0.7, 2.2, 1.6, 0x7a5a3a, { x: wx, y: fy + 1.1, z: wz }, 'shiny');
    inner.box(0.04, 2.0, 0.02, 0x3a2416, { x: wx + 0.36, y: fy + 1.1, z: wz });
    const dx = ux0 + 5.2;
    const dz = UNIT.z1 + 0.6;
    inner.box(1.6, 0.06, 0.7, 0xd8c8a8, { x: dx, y: fy + 0.76, z: dz }, 'shiny');
    for (const s of [-1, 1]) inner.box(0.06, 0.76, 0.6, 0x2a2a2a, { x: dx + s * 0.75, y: fy + 0.38, z: dz }, 'shiny');
    inner.box(0.5, 0.02, 0.35, 0x2a2a2e, { x: dx, y: fy + 0.8, z: dz + 0.05 }, 'shiny');
    inner.box(0.5, 0.32, 0.02, 0x2a2a2e, { x: dx, y: fy + 0.96, z: dz - 0.12, rx: -0.2 }, 'shiny');
    glow.box(0.44, 0.27, 0.01, 0x7fd8ff, { x: dx, y: fy + 0.96, z: dz - 0.105, rx: -0.2 }, 'glow');
    const sx = ux1 - 4.6;
    const sz = UNIT.z1 + 5.6;
    inner.rbox(2.6, 0.45, 0.9, 0.12, 0x3a5fa0, { x: sx, y: fy + 0.25, z: sz });
    inner.rbox(2.6, 0.55, 0.25, 0.1, 0x3a5fa0, { x: sx, y: fy + 0.65, z: sz - 0.4 });
    inner.rbox(1.2, 0.4, 0.6, 0.05, 0x7a5a3a, { x: sx, y: fy + 0.2, z: sz + 1.2 }, 'shiny');
    inner.box(1.8, 0.5, 0.45, 0x2a2a2e, { x: sx, y: fy + 0.25, z: sz + 3.2 }, 'shiny');
    inner.box(1.7, 1.0, 0.06, 0x111114, { x: sx, y: fy + 1.15, z: sz + 3.2 }, 'shiny');
    glow.box(1.6, 0.9, 0.01, 0x3a7bd5, { x: sx, y: fy + 1.15, z: sz + 3.15 }, 'glow');
    inner.box(2.6, 0.06, 2.0, 0xc8402f, { x: sx, y: fy + 0.02, z: sz + 1.4 });
    const kx = ux1 - 0.5;
    inner.box(0.7, 0.9, 3.4, 0xf4f4f4, { x: kx, y: fy + 0.45, z: UNIT.z1 + 2.2 }, 'shiny');
    inner.box(0.75, 0.05, 3.45, 0x2a2a2e, { x: kx, y: fy + 0.92, z: UNIT.z1 + 2.2 }, 'shiny');
    inner.box(0.75, 1.9, 0.8, 0xd8dce4, { x: kx, y: fy + 0.95, z: UNIT.z1 + 0.45 }, 'shiny');
    inner.cyl(0.3, 0.22, 0.5, 0xc8b89a, { x: ux1 - 0.6, y: fy + 0.25, z: UNIT.z0 - 0.7 }, 'matte', 10);
    inner.sphere(0.5, 0x3fae3a, { x: ux1 - 0.6, y: fy + 0.85, z: UNIT.z0 - 0.7, sy: 1.2 });
    this.interior.add(inner.bake());
    // Collision: the unit's walls (front wall has the door gap), furniture, the rest of the building.
    const bw = (a: number, b: number, z: number) => this.box((a + b) / 2, z, b - a, 0.4, y - 1, y + FH);
    bw(ux0, doorX - doorW / 2, 0);
    bw(doorX + doorW / 2, ux1, 0);
    this.box(ux0, (UNIT.z0 + UNIT.z1) / 2, 0.3, id, y - 1, y + FH);
    this.box(ux1, (UNIT.z0 + UNIT.z1) / 2, 0.3, id, y - 1, y + FH);
    this.box(cx, UNIT.z1, iw, 0.3, y - 1, y + FH);
    // The ceiling stops the camera (it starts above your head).
    this.box(cx, cz, iw, id, fy + UNIT.h, fy + UNIT.h + 0.3, 'flat', true);
    this.box(bx, bz, 2.0, 2.4, y - 1, fy + 0.6, 'flat', false);
    this.box(wx, wz, 0.7, 1.6, y - 1, fy + 2.2, 'flat', false);
    this.box(sx, sz, 2.6, 1.0, y - 1, fy + 0.7, 'flat', false);
    this.box(sx, sz + 3.2, 1.8, 0.5, y - 1, fy + 1.6, 'flat', false);
    this.box(kx, UNIT.z1 + 1.8, 0.8, 4.2, y - 1, fy + 1.9, 'flat', false);
    // Everything else: the rest of the ground floor and the building as one block.
    this.box(-W / 2 + (ux0 + W / 2) / 2, -D / 2, ux0 + W / 2, D, y - 1, y + H);
    this.box((ux1 + W / 2) / 2, -D / 2, W / 2 - ux1, D, y - 1, y + H);
    this.box(cx, (UNIT.z1 - D) / 2, iw, D + UNIT.z1, y - 1, y + H);
    const p = this.toWorld(cx, cz, 0);
    const rot = Math.abs(Math.sin(this.yaw)) > 0.5;
    this.game.world.collision.addFloor({ minX: p.x - (rot ? id : iw) / 2, maxX: p.x + (rot ? id : iw) / 2, minZ: p.z - (rot ? iw : id) / 2, maxZ: p.z + (rot ? iw : id) / 2, y: () => fy, tag: 'flat' });
    const c = [this.toWorld(-W / 2, 0, 0), this.toWorld(W / 2, -D, 0)];
    this.bounds = { minX: Math.min(c[0].x, c[1].x), maxX: Math.max(c[0].x, c[1].x), minZ: Math.min(c[0].z, c[1].z), maxZ: Math.max(c[0].z, c[1].z) };
  }

  private interactions(): void {
    const g = this.game;
    const at = (x: number, z: number) => this.toWorld(x, z);
    const bed = at(UNIT.x0 + 2.2, UNIT.z1 + 3.2);
    g.interactions.add({ id: 'flat:bed', x: bed.x, y: this.floorY, z: bed.z, radius: 1.8, label: 'Sleep until morning', sub: 'Saves your game', action: () => g.sleep() });
    const wr = at(UNIT.x0 + 1.4, UNIT.z1 + 4.6);
    g.interactions.add({ id: 'flat:wardrobe', x: wr.x, y: this.floorY, z: wr.z, radius: 1.4, label: 'Wardrobe', sub: 'Change your outfit', action: () => g.ui.wardrobe(false) });
    const lp = at(UNIT.x0 + 5.2, UNIT.z1 + 1.4);
    g.interactions.add({ id: 'flat:laptop', x: lp.x, y: this.floorY, z: lp.z, radius: 1.3, label: 'Laptop', sub: 'Lots for sale on the island', action: () => g.ui.realtyPanel() });
  }

  update(): void {
    const cam = this.game.renderer.camera.position;
    const b = this.bounds;
    const dx = Math.max(b.minX - cam.x, 0, cam.x - b.maxX);
    const dz = Math.max(b.minZ - cam.z, 0, cam.z - b.maxZ);
    this.interior.visible = Math.hypot(dx, dz) < 60;
  }
}
