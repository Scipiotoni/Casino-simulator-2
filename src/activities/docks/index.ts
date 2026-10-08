import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import { Kit } from '../../render/kit';
import { labelTexture } from '../../render/signs';
import { LANDMARKS } from '../../world/layout';
import { mulberry32 } from '../../core/noise';
import { audio } from '../../core/audio';
import { el } from '../../ui/dom';
import './style.css';

/**
 * The waterfront: the Port of Fortuna (a container yard, two ship-to-shore cranes and a
 * container ship at the berth) and Coral Cove Marina (finger piers you can walk out on, with
 * boats moored alongside). Speedboats and a cruiser are there to take out on the water.
 *
 * Cargo runs: pick up a crate at either harbour office and get it to the other one before the
 * clock runs out, by boat (round the south coast) or by road. Some crates are hot: halfway
 * there the police get a tip-off.
 */

const port = LANDMARKS.port;
const marina = LANDMARKS.marina;

interface Office {
  key: 'port' | 'marina';
  name: string;
  x: number;
  z: number;
  y: number;
  /** Where a delivery to this harbour is dropped (the end of a pier, by the water). */
  drop: THREE.Vector3;
}

interface Run {
  to: Office;
  left: number;
  total: number;
  pay: number;
  hot: boolean;
  tipped: boolean;
}

const CONTAINER_COLORS = [0xd8452f, 0x1e6bff, 0x2e9e5b, 0xf2a830, 0x7a4fd8, 0xe8e2d6, 0x1aa3a3, 0xb8202f, 0x3a3a40];

export class Docks implements Activity {
  readonly id = 'docks';
  private built = false;
  private offices: Office[] = [];
  private run: Run | null = null;
  private hud: HTMLDivElement;
  private marker: THREE.Mesh | null = null;
  private t = 0;
  private ship: THREE.Group | null = null;
  private best: Record<string, number> = {};

  constructor(readonly game: Game) {
    this.hud = el('div', 'dock-hud');
    game.uiRoot.appendChild(this.hud);
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    this.built = true;
    this.buildPort();
    this.buildMarina();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd23d, toneMapped: false, transparent: true, opacity: 0.85 }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    this.game.renderer.scene.add(ring);
    this.marker = ring;
  }

  private solid(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, cam = true): void {
    this.game.world.collision.addBox({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minY: y0, maxY: y1, tag: 'docks', cam });
  }

  /** A walkable deck (pier, pontoon, ramp): `y` gives its height. */
  private deck(x0: number, x1: number, z0: number, z1: number, y: (x: number, z: number) => number): void {
    this.game.world.collision.addFloor({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y, tag: 'docks' });
  }

  private sign(text: string, bg: string, w: number, x: number, y: number, z: number, ry: number): void {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w * 0.16),
      new THREE.MeshBasicMaterial({ map: labelTexture(text, { width: 1024, height: 164, font: 'Lilita One', color: '#ffffff', bg, size: 104 }), toneMapped: false, side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    this.game.renderer.scene.add(m);
  }

  private buildPort(): void {
    const g = this.game;
    const k = new Kit();
    const glow = new Kit();
    const y = port.y;
    const qx = port.x1;
    const rng = mulberry32(9101);
    // The quay edge: a concrete cap with fenders and bollards along the berth.
    k.box(2, 1.2, port.z1 - port.z0, 0xb8b4aa, { x: qx - 1, y: y - 0.3, z: (port.z0 + port.z1) / 2 });
    k.box(0.4, 14, port.z1 - port.z0, 0x8a8680, { x: qx - 0.2, y: y - 7.5, z: (port.z0 + port.z1) / 2 });
    for (let z = port.z0 + 8; z < port.z1; z += 14) {
      k.cyl(0.25, 0.3, 0.7, 0x2a2a2e, { x: qx - 1.2, y: y + 0.35, z }, 'shiny', 10);
      k.box(0.5, 2.2, 1.6, 0x1a1a1a, { x: qx + 0.1, y: y - 1.6, z: z + 7 });
    }
    // Ship-to-shore cranes straddling the quay edge, booms out over the ship.
    for (const cz of [1880, 2010]) {
      for (const lx of [qx - 26, qx - 4]) {
        for (const lz of [-7, 7]) {
          k.box(1.4, 38, 1.4, 0xd8452f, { x: lx, y: y + 19, z: cz + lz });
          this.solid(lx - 0.8, lx + 0.8, cz + lz - 0.8, cz + lz + 0.8, y - 1, y + 38);
        }
        k.box(1.6, 1.6, 15.4, 0xd8452f, { x: lx, y: y + 2, z: cz });
      }
      k.box(30, 3, 16, 0xf4f4f4, { x: qx - 15, y: y + 39.5, z: cz });
      k.box(78, 2.2, 3, 0xd8452f, { x: qx + 14, y: y + 41, z: cz });
      k.box(10, 5, 8, 0xf4f4f4, { x: qx - 26, y: y + 44, z: cz });
      k.box(4, 3, 3, 0x2a3a4a, { x: qx + 6, y: y + 38.6, z: cz }, 'glass');
      for (const s of [-1, 1]) k.box(0.15, 30, 0.15, 0x2a2a2e, { x: qx + 6 + s * 0.6, y: y + 25, z: cz }, 'shiny');
      glow.sphere(0.5, 0xff3030, { x: qx + 52, y: y + 42.5, z: cz }, 'glow');
    }
    // Warehouses along the west side.
    for (const [wz, len] of [[1700, 140], [1880, 120]]) {
      k.box(34, 12, len, 0x8fa3b8, { x: port.x0 + 30, y: y + 6, z: wz + len / 2 });
      k.box(35, 1, len + 1, 0x5a6a7a, { x: port.x0 + 30, y: y + 12.4, z: wz + len / 2, rx: 0 });
      for (let i = 0; i < len / 20; i++) k.box(0.3, 6, 8, 0xd8dce4, { x: port.x0 + 47.1, y: y + 3, z: wz + 10 + i * 20 }, 'shiny');
      this.solid(port.x0 + 13, port.x0 + 47, wz, wz + len, y - 1, y + 12.5);
    }
    // The container yard: blocks of stacks with lanes between them (one instanced mesh).
    const mats: THREE.Matrix4[] = [];
    const cols: number[] = [];
    for (let bx = port.x0 + 70; bx < qx - 50; bx += 32) {
      for (let bz = port.z0 + 30; bz < port.z1 - 30; bz += 20) {
        let top = 0;
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 5; c++) {
            const h = 1 + Math.floor(rng() * 4);
            for (let l = 0; l < h; l++) {
              mats.push(new THREE.Matrix4().makeTranslation(bx + r * 12.6, y + 1.3 + l * 2.6, bz + c * 2.55));
              cols.push(CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)]);
            }
            top = Math.max(top, h);
          }
        }
        this.solid(bx - 6.2, bx + 18.8, bz - 1.25, bz + 11.5, y - 1, y + top * 2.6);
      }
    }
    // The container ship at the berth: hull, a pointed bow, the bridge aft, containers on deck.
    const ship = new Kit();
    const sx = qx + 19;
    const z0 = 1830;
    const z1 = 2060;
    const beam = 30;
    ship.box(beam, 16, z1 - z0, 0x1d3a5f, { x: sx, y: 0, z: (z0 + z1) / 2 });
    ship.box(beam + 0.2, 2.5, z1 - z0, 0xb8202f, { x: sx, y: -0.4, z: (z0 + z1) / 2 });
    const bow = new THREE.Shape();
    bow.moveTo(-beam / 2, 0);
    bow.quadraticCurveTo(-beam / 2, 18, 0, 30);
    bow.quadraticCurveTo(beam / 2, 18, beam / 2, 0);
    bow.closePath();
    ship.extrude(bow, 16, 0x1d3a5f, { x: sx, y: 0, z: z1, rx: -Math.PI / 2 }, 'matte', 0, 10);
    ship.box(beam, 1, z1 - z0, 0xb8b4aa, { x: sx, y: 8.2, z: (z0 + z1) / 2 });
    ship.box(beam - 4, 22, 18, 0xf4f4f4, { x: sx, y: 19, z: z0 + 14 });
    ship.box(beam + 6, 3, 8, 0xf4f4f4, { x: sx, y: 29, z: z0 + 18 });
    ship.box(5, 10, 5, 0xb8202f, { x: sx, y: 33, z: z0 + 6 });
    for (let i = 0; i < 6; i++) glow.box(beam - 4.2, 1.2, 0.1, 0xffe8b0, { x: sx, y: 12 + i * 3.2, z: z0 + 23.05 }, 'glow');
    glow.box(beam + 5, 1.4, 0.1, 0x9be8ff, { x: sx, y: 29, z: z0 + 22.05 }, 'glow');
    for (let bz = z0 + 30; bz < z1 - 8; bz += 13) {
      for (let r = 0; r < 11; r++) {
        const h = 2 + Math.floor(rng() * 4);
        for (let l = 0; l < h; l++) {
          const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(sx - beam / 2 + 1.5 + r * 2.7, 10 + l * 2.6, bz + 6);
          mats.push(m);
          cols.push(CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)]);
        }
      }
    }
    this.ship = ship.bake({ shadows: true });
    g.renderer.scene.add(this.ship);
    this.solid(sx - beam / 2, sx + beam / 2, z0, z1 + 22, -8, 30);
    const box = new THREE.BoxGeometry(12.2, 2.6, 2.45);
    const im = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), mats.length);
    const c = new THREE.Color();
    mats.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setHex(cols[i]));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    g.renderer.scene.add(im);
    // A boat pontoon at the south end of the quay, a ramp down to it.
    const pz = port.z1 - 30;
    const deckY = 1.4;
    k.box(10, 0.3, 4, 0x8a6a40, { x: qx + 5, y: deckY - 0.15, z: pz });
    for (const px of [qx + 1, qx + 9]) for (const s of [-1, 1]) k.cyl(0.2, 0.2, 3, 0x5a4a3a, { x: px, y: deckY - 1.5, z: pz + s * 1.8 }, 'matte', 8);
    k.box(6, 0.25, 3, 0x8a6a40, { x: qx - 2, y: (y + deckY) / 2, z: pz, rz: Math.atan2(y - deckY, 6) });
    this.deck(qx - 5, qx, pz - 1.5, pz + 1.5, (x) => y + ((deckY - y) * (x - (qx - 5))) / 5);
    this.deck(qx, qx + 10, pz - 2, pz + 2, () => deckY);
    this.solid(qx, qx + 10, pz - 2, pz + 2, -2, deckY - 0.4, false);
    g.renderer.scene.add(k.bake({ shadows: true }), glow.bake());
    // The harbour office by the gate.
    const ox = port.x0 + 70;
    const oz = port.z0 + 12;
    const off = new Kit();
    off.box(12, 4, 8, 0xf4efe2, { x: ox, y: y + 2, z: oz });
    off.box(12.4, 0.4, 8.4, 0x2a5a8a, { x: ox, y: y + 4.2, z: oz });
    off.box(10, 1.6, 0.1, 0x9ccfe8, { x: ox, y: y + 2.2, z: oz + 4.05 }, 'glass');
    g.renderer.scene.add(off.bake({ shadows: true }));
    this.solid(ox - 6, ox + 6, oz - 4, oz + 4, y - 1, y + 4.4);
    this.sign('PORT OF FORTUNA', '#2a5a8a', 9, ox, y + 5.2, oz + 4.1, 0);
    this.offices.push({ key: 'port', name: 'Port of Fortuna', x: ox, z: oz + 5.5, y, drop: new THREE.Vector3(qx + 6, deckY, pz) });
    g.vehicles.spawn('speedboat', qx + 6, pz + 4.2, Math.PI / 2, { color: 0x1e6bff, id: 'boat-port' });
  }

  private buildMarina(): void {
    const g = this.game;
    const k = new Kit();
    const glow = new Kit();
    const y = marina.y;
    const deckY = 1.7;
    const shore = marina.z1;
    // A boardwalk along the shore and four finger piers out into the basin.
    k.box(marina.x1 - marina.x0, 0.3, 6, 0x9a7a50, { x: marina.x, y: deckY - 0.15, z: shore + 3 });
    this.deck(marina.x0, marina.x1, shore - 1, shore + 6, () => deckY);
    this.solid(marina.x0, marina.x1, shore, shore + 6, -3, deckY - 0.4, false);
    const fingers = [-1060, -960, -860, -760];
    for (const fx of fingers) {
      const len = 90;
      k.box(3, 0.3, len, 0x9a7a50, { x: fx, y: deckY - 0.15, z: shore + 6 + len / 2 });
      for (let z = shore + 10; z < shore + 6 + len; z += 8) {
        for (const s of [-1, 1]) k.cyl(0.18, 0.18, 4.5, 0x5a4a3a, { x: fx + s * 1.4, y: deckY - 2, z }, 'matte', 8);
        for (const s of [-1, 1]) k.cyl(0.12, 0.14, 0.5, 0x2a2a2e, { x: fx + s * 1.2, y: deckY + 0.25, z }, 'shiny', 8);
      }
      glow.sphere(0.25, 0xfff1c8, { x: fx, y: deckY + 2.6, z: shore + 6 + len - 1 }, 'glow');
      k.cyl(0.08, 0.08, 2.6, 0x2a2a2e, { x: fx, y: deckY + 1.3, z: shore + 6 + len - 1 }, 'shiny', 6);
      this.deck(fx - 1.5, fx + 1.5, shore + 5, shore + 6 + len, () => deckY);
      this.solid(fx - 1.6, fx + 1.6, shore + 6, shore + 6 + len, -3, deckY - 0.4, false);
    }
    // The marina office, a fuel dock sign, a lighthouse on the breakwater.
    const ox = marina.x;
    const oz = marina.z0 + 18;
    k.box(14, 4.2, 9, 0xf4f4f4, { x: ox, y: y + 2.1, z: oz });
    k.box(14.6, 0.5, 9.6, 0x1aa3a3, { x: ox, y: y + 4.4, z: oz });
    k.box(12, 1.8, 0.1, 0x9ccfe8, { x: ox, y: y + 2.2, z: oz + 4.55 }, 'glass');
    this.solid(ox - 7, ox + 7, oz - 4.5, oz + 4.5, y - 1, y + 4.6);
    const lx = marina.x1 + 30;
    const lz = marina.basin.z1 - 40;
    k.cyl(3.2, 4, 18, 0xf4f4f4, { x: lx, y: 9, z: lz }, 'matte', 16);
    for (let i = 0; i < 3; i++) k.cyl(3.25 - i * 0.25, 3.4 - i * 0.25, 2, 0xd8202f, { x: lx, y: 3 + i * 5, z: lz }, 'matte', 16);
    k.cyl(2.2, 2.2, 3, 0x2a2a2e, { x: lx, y: 19.5, z: lz }, 'shiny', 12);
    glow.sphere(1.4, 0xfff4b0, { x: lx, y: 19.6, z: lz }, 'glow');
    this.solid(lx - 4, lx + 4, lz - 4, lz + 4, -10, 22);
    g.renderer.scene.add(k.bake({ shadows: true }), glow.bake());
    this.sign('CORAL COVE MARINA', '#1aa3a3', 10, ox, y + 5.4, oz + 4.6, 0);
    this.offices.push({ key: 'marina', name: 'Coral Cove Marina', x: ox, z: oz + 6, y, drop: new THREE.Vector3(fingers[1], deckY, shore + 90) });
    // Boats moored alongside the piers.
    g.vehicles.spawn('speedboat', fingers[0] + 4.5, shore + 30, 0, { color: 0xff4f5a, id: 'boat-m1' });
    g.vehicles.spawn('speedboat', fingers[1] + 4.5, shore + 52, 0, { color: 0xf2c230, id: 'boat-m2' });
    g.vehicles.spawn('cruiser', fingers[2] + 6, shore + 40, 0, { id: 'boat-m3' });
    g.vehicles.spawn('speedboat', fingers[3] - 4.5, shore + 70, Math.PI, { color: 0x2ecc71, id: 'boat-m4' });
    for (const o of this.offices) {
      g.interactions.add({
        id: `docks:${o.key}`,
        x: o.x,
        y: o.y,
        z: o.z,
        radius: 3.2,
        label: () => (this.run ? (this.run.to === o ? 'Deliver the crate' : 'Cargo run in progress') : 'Take a cargo run'),
        sub: () => (this.run ? `To ${this.run.to.name}` : `A crate for ${this.other(o).name}, against the clock${this.best[o.key] ? ` · best ${Math.round(this.best[o.key])} s` : ''}`),
        action: () => (this.run ? undefined : this.start(o)),
      });
    }
  }

  private other(o: Office): Office {
    return this.offices.find((x) => x !== o) ?? o;
  }

  // ---------------------------------------------------------------- cargo runs

  private start(from: Office): void {
    const g = this.game;
    const to = this.other(from);
    const dist = Math.hypot(to.drop.x - from.x, to.drop.z - from.z);
    // About a speedboat's pace round the coast, with a bit in hand.
    const total = Math.round(dist / 19 + 70);
    const hot = Math.random() < 0.35;
    this.run = { to, left: total, total, pay: Math.round(400 + dist * 0.3), hot, tipped: false };
    g.setUserWaypoint(to.drop.x, to.drop.z, `Cargo for ${to.name}`);
    audio.play('objective');
    g.hud.toast(hot ? 'Hot cargo: keep it quiet and keep moving' : `Get the crate to ${to.name}`, hot ? 'bad' : 'info');
  }

  private finish(ok: boolean): void {
    const g = this.game;
    const r = this.run!;
    this.run = null;
    g.clearUserWaypoint();
    if (!ok) {
      audio.play('error');
      g.hud.toast('Too slow: the buyer went elsewhere', 'bad');
      return;
    }
    const used = r.total - r.left;
    const bonus = Math.round((r.left / r.total) * r.pay * 0.6);
    const pay = r.pay + bonus + (r.hot ? 500 : 0);
    g.money += pay;
    g.stats.cargoRuns = (g.stats.cargoRuns ?? 0) + 1;
    const key = r.to.key === 'port' ? 'marina' : 'port';
    if (!this.best[key] || used < this.best[key]) this.best[key] = used;
    audio.play('cash');
    g.hud.toast(`Delivered in ${Math.round(used)} s: $${pay}`, 'money');
    g.save();
  }

  update(dt: number): void {
    const g = this.game;
    if (g.mode === 'loading') return;
    if (!this.built) this.build();
    this.t += dt;
    const r = this.run;
    const m = this.marker!;
    if (r) {
      r.left -= dt;
      const v = g.vehicles.driving;
      const p = v ? v.pos : g.player.pos;
      if (Math.hypot(p.x - r.to.drop.x, p.z - r.to.drop.z) < (v ? 9 : 4)) this.finish(true);
      else if (r.left <= 0) this.finish(false);
      else if (r.hot && !r.tipped && r.left < r.total / 2) {
        r.tipped = true;
        g.crime('smuggling', 1);
        g.hud.toast('Somebody tipped off the police!', 'bad');
      }
    }
    if (this.run) {
      m.visible = true;
      m.position.set(this.run.to.drop.x, this.run.to.drop.y + 1 + Math.sin(this.t * 3) * 0.25, this.run.to.drop.z);
      m.rotation.z += dt;
      const s = Math.ceil(this.run.left);
      const html = `<b>📦 Cargo for ${this.run.to.name}</b><span class="${s < 20 ? 'late' : ''}">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
      if (this.hud.innerHTML !== html) this.hud.innerHTML = html;
    } else m.visible = false;
    this.hud.classList.toggle('on', !!this.run && g.mode === 'play');
  }

  markers(full: boolean): MapMarker[] {
    const out: MapMarker[] = this.offices.map((o) => ({ x: o.x, z: o.z, icon: '⚓', color: '#1aa3a3', label: full ? o.name : undefined }));
    if (this.run) out.push({ x: this.run.to.drop.x, z: this.run.to.drop.z, icon: '📦', color: '#ffd23d', label: 'Cargo drop', big: true });
    return out;
  }

  save(): unknown {
    return { best: this.best };
  }

  load(data: unknown): void {
    const d = data as { best?: Record<string, number> } | null;
    this.best = d && typeof d.best === 'object' && d.best ? { ...d.best } : {};
  }
}
