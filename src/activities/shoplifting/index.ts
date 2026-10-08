import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import { Kit } from '../../render/kit';
import { labelTexture } from '../../render/signs';
import { lotFrontPoint, type Lot } from '../../world/layout';
import { CharacterModel } from '../../chars/model';
import { Animator } from '../../chars/anim';
import { randomAppearance } from '../../chars/skins';
import { mulberry32 } from '../../core/noise';
import { audio } from '../../core/audio';
import { el } from '../../ui/dom';
import './style.css';

/**
 * Sunny Mart corner stores round the island, and Pawn Paradise to sell what you lift.
 *
 * Walk the aisles and pocket things off the shelves while the clerk isn't looking: they
 * glance at their phone, then look up and watch the store, and getting caught in their eye
 * line sets the alarm off. The pricier stock is security-tagged, so walking out through the
 * door gates with it can trip them too. Pay at the counter to leave clean, or draw a gun at
 * the counter and empty the register (that's a silent alarm: the police are on their way).
 * Stolen goods go in your bag until you sell them at the pawn shop.
 */

interface Item {
  name: string;
  value: number;
  /** Security-tagged: can trip the door gates. */
  tag: boolean;
}

const ITEMS: Item[] = [
  { name: 'Chips', value: 6, tag: false },
  { name: 'Energy drinks', value: 12, tag: false },
  { name: 'Candy bars', value: 9, tag: false },
  { name: 'Lucky dice set', value: 28, tag: false },
  { name: 'Phone charger', value: 35, tag: true },
  { name: 'Sunglasses', value: 55, tag: true },
  { name: 'Scratch cards', value: 70, tag: true },
  { name: 'Perfume', value: 95, tag: true },
  { name: 'Headphones', value: 140, tag: true },
];

/** The store, in its own frame: x across the front, -z into the lot, the front wall at z = 0. */
const W = 16;
const D = 12;
const H = 4.2;
const DOOR = 1.1;
/** The counter runs along the right wall; the clerk stands behind it. */
const COUNTER = { x: 4.6, z0: -2.2, z1: -6.2 };
const CLERK = { x: 6.4, z: -4.2 };
/** Shelf units down the store, each stocked on both sides. */
const SHELVES = [-6, -3.2, -0.4];
const SHELF = { z0: -4.2, z1: -10, h: 1.7, d: 0.9 };
const RESTOCK = 300;
const ROB_TIME = 5;
const ROB_COOLDOWN = 600;

interface Spot {
  item: Item;
  stock: number;
  /** Seconds until one more comes back. */
  restock: number;
}

interface Store {
  key: string;
  name: string;
  lot: Lot;
  group: THREE.Group;
  interior: THREE.Group;
  y: number;
  clerk: CharacterModel;
  anim: Animator;
  /** 'watch': looking over the store; 'busy': on the phone at the register. */
  mood: 'watch' | 'busy';
  moodT: number;
  /** Current and wanted head turn (radians, model yaw). */
  look: number;
  spots: Spot[];
  /** Seconds until the register is worth robbing again. */
  robbedT: number;
  door: THREE.Vector3;
}

export class Shoplifting implements Activity {
  readonly id = 'shoplifting';
  private stores: Store[] = [];
  private pawn: { x: number; z: number; y: number } | null = null;
  /** Pocketed in the store you're in (not yet out of the door). */
  private pocket: Item[] = [];
  /** Stolen goods carried out (sell them at the pawn shop). */
  private bag: Item[] = [];
  private robbing: { store: Store; t: number } | null = null;
  private hud: HTMLDivElement;
  private built = false;
  private inside: Store | null = null;

  constructor(readonly game: Game) {
    this.hud = el('div', 'lift-hud');
    game.uiRoot.appendChild(this.hud);
  }

  // ---------------------------------------------------------------- world

  private build(): void {
    this.built = true;
    const g = this.game;
    const rng = mulberry32(4242);
    for (let i = 1; i <= 8; i++) {
      const lot = g.world.terrain.lots.find((l) => l.special === `store${i}`);
      if (!lot) continue;
      this.stores.push(this.buildStore(`store${i}`, lot, rng));
    }
    const pawnLot = g.world.terrain.lots.find((l) => l.special === 'pawnShop');
    if (pawnLot) this.buildPawn(pawnLot);
  }

  private frame(lot: Lot, setback: number): { group: THREE.Group; y: number } {
    const g = this.game;
    const y = g.world.terrain.lotY.get(lot.id) ?? 6;
    const fp = lotFrontPoint(lot);
    const group = new THREE.Group();
    group.position.set(fp.x - Math.sin(fp.yaw) * setback, 0, fp.z - Math.cos(fp.yaw) * setback);
    group.rotation.y = fp.yaw;
    group.updateMatrixWorld(true);
    g.renderer.scene.add(group);
    return { group, y };
  }

  private world(group: THREE.Group, x: number, z: number, y = 0): THREE.Vector3 {
    return group.localToWorld(new THREE.Vector3(x, y, z));
  }

  /** An axis-aligned collision box given in a building's frame (buildings face along the grid). */
  private solid(group: THREE.Group, x: number, z: number, w: number, d: number, y0: number, y1: number, cam = true): void {
    const p = this.world(group, x, z);
    const turned = Math.abs(Math.sin(group.rotation.y)) > 0.5;
    const ww = turned ? d : w;
    const dd = turned ? w : d;
    this.game.world.collision.addBox({ minX: p.x - ww / 2, maxX: p.x + ww / 2, minZ: p.z - dd / 2, maxZ: p.z + dd / 2, minY: y0, maxY: y1, tag: 'store', cam });
  }

  private buildStore(key: string, lot: Lot, rng: () => number): Store {
    const g = this.game;
    const { group, y } = this.frame(lot, 5);
    const interior = new THREE.Group();
    group.add(interior);
    const k = new Kit();
    const glow = new Kit();
    const inner = new Kit();
    const wall = 0xfff4dc;
    const trim = 0xff8a1a;
    // Shell: back and sides, the front either side of the door, a glass front, the roof.
    k.box(W, H, 0.3, wall, { y: y + H / 2, z: -D });
    k.box(0.3, H, D, wall, { x: -W / 2, y: y + H / 2, z: -D / 2 });
    k.box(0.3, H, D, wall, { x: W / 2, y: y + H / 2, z: -D / 2 });
    k.box(W / 2 - DOOR, 0.9, 0.3, wall, { x: -(W / 2 + DOOR) / 2, y: y + 0.45, z: 0 });
    k.box(W / 2 - DOOR, 0.9, 0.3, wall, { x: (W / 2 + DOOR) / 2, y: y + 0.45, z: 0 });
    k.box(W, H - 2.7, 0.3, wall, { y: y + 2.7 + (H - 2.7) / 2, z: 0 });
    for (const s of [-1, 1]) k.box(W / 2 - DOOR - 0.2, 1.8, 0.06, 0x9ccfe8, { x: s * (W / 2 + DOOR) / 2, y: y + 1.8, z: 0.02 }, 'glass');
    k.box(W + 0.6, 0.4, D + 0.6, 0xd8ccb8, { y: y + H + 0.2, z: -D / 2 });
    // The orange fascia, a striped awning and the lit sign.
    k.box(W + 0.4, 0.9, 0.2, trim, { y: y + H - 0.2, z: 0.2 }, 'shiny');
    for (let i = 0; i < 8; i++) k.box(W / 8, 0.08, 1.4, i % 2 ? 0xffffff : 0xff6a2a, { x: -W / 2 + (i + 0.5) * (W / 8), y: y + 2.95, z: 0.8, rx: 0.25 });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 0.9),
      new THREE.MeshBasicMaterial({ map: labelTexture('SUNNY MART  24/7', { width: 1024, height: 132, font: 'Lilita One', color: '#ffffff', bg: '#ff6a1a', size: 92 }), toneMapped: false }),
    );
    sign.position.set(0, y + H - 0.2, 0.32);
    group.add(sign);
    // Door gates (the security tags trip them).
    for (const s of [-1, 1]) {
      k.box(0.12, 1.5, 0.5, 0xd8dce4, { x: s * (DOOR + 0.2), y: y + 0.75, z: -1.0 }, 'shiny');
      glow.box(0.04, 1.3, 0.3, 0x7fd8ff, { x: s * (DOOR + 0.2) - s * 0.07, y: y + 0.8, z: -1.0 }, 'glow');
    }
    // Inside: a tiled floor, ceiling lights, fridges along the back, shelves, the counter.
    const fy = y + 0.05;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) inner.box(W / 8 - 0.03, 0.04, D / 6 - 0.03, (i + j) % 2 ? 0xf4f4f4 : 0xdcdcdc, { x: -W / 2 + (i + 0.5) * (W / 8), y: fy, z: -(j + 0.5) * (D / 6) });
    inner.box(W, 0.08, D, 0xf8f8f8, { y: y + H - 0.04, z: -D / 2 });
    for (const lx of [-4.5, 0, 4.5]) glow.box(0.5, 0.04, 8, 0xffffff, { x: lx, y: y + H - 0.1, z: -6 }, 'glow');
    for (let i = 0; i < 6; i++) {
      const fx = -W / 2 + 1.4 + i * 2.2;
      inner.box(2.1, 2.2, 0.8, 0xd8dce4, { x: fx, y: fy + 1.1, z: -D + 0.55 }, 'shiny');
      glow.box(1.8, 1.8, 0.04, [0x9be8ff, 0xffe3a8][i % 2], { x: fx, y: fy + 1.15, z: -D + 0.97 }, 'glow');
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) inner.box(0.2, 0.3, 0.2, [0xd8202f, 0x2ecc71, 0x1e6bff, 0xf2c230, 0xff8fd8][(r + c + i) % 5], { x: fx - 0.75 + c * 0.3, y: fy + 0.45 + r * 0.45, z: -D + 0.8 });
    }
    const colors = [0xd8202f, 0xf2c230, 0x2ecc71, 0x1e6bff, 0xff8fd8, 0xff7a1a, 0x9b5de5, 0xffffff];
    for (const sx of SHELVES) {
      const len = SHELF.z0 - SHELF.z1;
      const cz = (SHELF.z0 + SHELF.z1) / 2;
      inner.box(SHELF.d, SHELF.h, len, 0x4a5a6a, { x: sx, y: fy + SHELF.h / 2, z: cz }, 'shiny');
      for (let lvl = 0; lvl < 4; lvl++) {
        for (const side of [-1, 1]) {
          inner.box(0.12, 0.03, len, 0x2a3a4a, { x: sx + side * (SHELF.d / 2 + 0.05), y: fy + 0.25 + lvl * 0.42, z: cz }, 'shiny');
          for (let n = 0; n < 12; n++) {
            const c = colors[Math.floor(rng() * colors.length)];
            const h = 0.15 + rng() * 0.18;
            inner.box(0.18, h, 0.32, c, { x: sx + side * (SHELF.d / 2 - 0.05), y: fy + 0.27 + lvl * 0.42 + h / 2, z: SHELF.z0 - 0.3 - n * (len - 0.4) / 12 });
          }
        }
      }
    }
    inner.box(0.9, 1.05, COUNTER.z0 - COUNTER.z1, 0x8a5a3a, { x: COUNTER.x, y: fy + 0.52, z: (COUNTER.z0 + COUNTER.z1) / 2 }, 'shiny');
    inner.box(1.0, 0.06, COUNTER.z0 - COUNTER.z1 + 0.1, 0x2a2a2e, { x: COUNTER.x, y: fy + 1.07, z: (COUNTER.z0 + COUNTER.z1) / 2 }, 'shiny');
    inner.box(0.4, 0.25, 0.5, 0x2a2a2e, { x: COUNTER.x + 0.1, y: fy + 1.22, z: -3.3 }, 'shiny');
    glow.box(0.02, 0.16, 0.36, 0x6bff9a, { x: COUNTER.x - 0.11, y: fy + 1.27, z: -3.3 }, 'glow');
    // Lottery and cigarette racks behind the counter, a camera dome in the corner.
    inner.box(0.4, 1.4, 3.6, 0x3a2416, { x: W / 2 - 0.4, y: fy + 1.6, z: -4.2 });
    for (let i = 0; i < 18; i++) inner.box(0.08, 0.16, 0.16, colors[i % colors.length], { x: W / 2 - 0.63, y: fy + 1.1 + Math.floor(i / 6) * 0.45, z: -2.7 - (i % 6) * 0.55 });
    inner.sphere(0.18, 0x111114, { x: W / 2 - 0.5, y: y + H - 0.3, z: -0.6, sy: 0.7 }, 'shiny');
    interior.add(inner.bake());
    group.add(k.bake({ shadows: true }), glow.bake());
    // Collision: the walls (with the door), shelves, counter and back fridges.
    const fy0 = y - 1;
    this.solid(group, 0, -D, W, 0.3, fy0, y + H);
    this.solid(group, -W / 2, -D / 2, 0.3, D, fy0, y + H);
    this.solid(group, W / 2, -D / 2, 0.3, D, fy0, y + H);
    this.solid(group, -(W / 2 + DOOR) / 2, 0, W / 2 - DOOR, 0.3, fy0, y + H);
    this.solid(group, (W / 2 + DOOR) / 2, 0, W / 2 - DOOR, 0.3, fy0, y + H);
    this.solid(group, 0, -D / 2, W, D, y + H - 0.05, y + H + 0.4);
    for (const sx of SHELVES) this.solid(group, sx, (SHELF.z0 + SHELF.z1) / 2, SHELF.d, SHELF.z0 - SHELF.z1, fy0, fy + SHELF.h, false);
    this.solid(group, COUNTER.x, (COUNTER.z0 + COUNTER.z1) / 2, 0.9, COUNTER.z0 - COUNTER.z1, fy0, fy + 1.1, false);
    this.solid(group, 0, -D + 0.55, W, 0.8, fy0, fy + 2.2, false);
    for (const s of [-1, 1]) this.solid(group, s * (DOOR + 0.2), -1.0, 0.12, 0.5, fy0, fy + 1.5, false);

    // The clerk.
    const look = randomAppearance(rng, 'civilian');
    look.outfit = { ...look.outfit, top: 'tee', c1: 0xff7a1a, c2: 0xffffff, accent: 0xffffff, hat: 'visor', glasses: 'none', back: 'none', neck: 'none' };
    const clerk = new CharacterModel(look);
    const cw = this.world(group, CLERK.x, CLERK.z, fy);
    clerk.root.position.copy(cw);
    interior.add(clerk.root);
    clerk.root.position.set(CLERK.x, fy, CLERK.z);
    const anim = new Animator(clerk);
    anim.pose = 'phone';
    const spots: Spot[] = [];
    const store: Store = {
      key, name: 'Sunny Mart', lot, group, interior, y, clerk, anim, mood: 'busy', moodT: 2 + rng() * 3, look: 0, spots, robbedT: 0,
      door: this.world(group, 0, 1.2, y),
    };
    // Shelf spots: both sides of each unit, two along each side.
    let n = 0;
    for (const sx of SHELVES) {
      for (const side of [-1, 1]) {
        for (const t of [0.3, 0.75]) {
          const item = ITEMS[(n * 5 + Math.floor(rng() * 3)) % ITEMS.length];
          const spot: Spot = { item, stock: 3, restock: 0 };
          spots.push(spot);
          const p = this.world(group, sx + side * (SHELF.d / 2 + 0.6), SHELF.z0 + (SHELF.z1 - SHELF.z0) * t, y);
          g.interactions.add({
            id: `lift:${key}:${n}`,
            x: p.x,
            y,
            z: p.z,
            radius: 1.3,
            label: () => (spot.stock > 0 ? `Pocket ${spot.item.name.toLowerCase()}` : `${spot.item.name}: sold out`),
            sub: () => `$${spot.item.value}${spot.item.tag ? ' · security tagged' : ''}`,
            enabled: () => !this.robbing,
            action: () => this.take(store, spot),
          });
          n++;
        }
      }
    }
    const till = this.world(group, COUNTER.x - 1.0, -4.2, y);
    g.interactions.add({
      id: `lift:${key}:till`,
      x: till.x,
      y,
      z: till.z,
      radius: 1.8,
      priority: 2,
      label: () => (g.combat.armed ? 'Rob the register' : this.pocket.length ? `Pay for ${this.pocket.length} item${this.pocket.length > 1 ? 's' : ''}` : 'Buy a snack'),
      sub: () => (g.combat.armed ? (store.robbedT > 0 ? 'Already emptied: come back later' : 'Hold it for 5 seconds') : this.pocket.length ? `$${this.pocketValue()}` : '$5 · restores health'),
      enabled: () => !this.robbing,
      action: () => this.counter(store),
    });
    return store;
  }

  private buildPawn(lot: Lot): void {
    const g = this.game;
    const { group, y } = this.frame(lot, 6);
    const k = new Kit();
    const glow = new Kit();
    const w = 12;
    const d = 10;
    k.box(w, 4.6, d, 0x3a2a4a, { y: y + 2.3, z: -d / 2 });
    k.box(w + 0.4, 0.4, d + 0.4, 0x2a2030, { y: y + 4.8, z: -d / 2 });
    k.box(w - 2, 2.4, 0.1, 0x8a7a5a, { y: y + 1.5, z: 0.05 }, 'glass');
    for (let i = 0; i < 6; i++) k.box(0.06, 2.4, 0.06, 0x2a2a2e, { x: -4.5 + i * 1.8, y: y + 1.5, z: 0.12 }, 'shiny');
    k.box(1.4, 2.4, 0.1, 0x2a1a10, { y: y + 1.2, z: 0.12 });
    // Three gold balls, the pawnbroker's sign.
    for (const [bx, by] of [[-0.35, 0], [0.35, 0], [0, -0.55]]) glow.sphere(0.28, 0xf2c230, { x: 4.6 + bx, y: y + 3.6 + by, z: 0.6 }, 'glow');
    group.add(k.bake({ shadows: true }), glow.bake());
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6.5, 1),
      new THREE.MeshBasicMaterial({ map: labelTexture('PAWN PARADISE', { width: 1024, height: 158, font: 'Lilita One', color: '#ffe08a', bg: '#3a2a4a', size: 104 }), toneMapped: false }),
    );
    sign.position.set(-1.5, y + 3.7, 0.12);
    group.add(sign);
    this.solid(group, 0, -d / 2, w, d, y - 1, y + 5);
    const p = this.world(group, 0, 1.6, y);
    this.pawn = { x: p.x, z: p.z, y };
    g.interactions.add({
      id: 'lift:pawn',
      x: p.x,
      y,
      z: p.z,
      radius: 3,
      label: () => (this.bag.length ? `Sell ${this.bag.length} stolen item${this.bag.length > 1 ? 's' : ''}` : 'Pawn Paradise'),
      sub: () => (this.bag.length ? `$${this.fence()} (no questions asked)` : 'Buys anything. Bring something to sell'),
      action: () => this.sell(),
    });
  }

  // ---------------------------------------------------------------- actions

  private pocketValue(): number {
    return this.pocket.reduce((s, i) => s + i.value, 0);
  }

  /** What the pawn shop pays for the bag. */
  private fence(): number {
    return Math.round(this.bag.reduce((s, i) => s + i.value, 0) * 0.7);
  }

  private take(store: Store, spot: Spot): void {
    const g = this.game;
    if (spot.stock <= 0) {
      audio.play('error');
      return;
    }
    spot.stock--;
    spot.restock = RESTOCK;
    this.pocket.push(spot.item);
    audio.play('pop', { volume: 0.6 });
    g.player.emote('crouch', 0.5);
    if (this.seen(store)) this.caught(store, 'The clerk saw you');
  }

  private counter(store: Store): void {
    const g = this.game;
    if (g.combat.armed) {
      if (store.robbedT > 0) {
        audio.play('error');
        g.hud.toast('The register is empty. Come back later', 'bad');
        return;
      }
      this.robbing = { store, t: 0 };
      store.anim.pose = 'handsUp';
      store.mood = 'watch';
      audio.play('alarm', { volume: 0.5 });
      g.crime('armed robbery', 2);
      return;
    }
    if (this.pocket.length) {
      const v = this.pocketValue();
      if (g.money < v) {
        audio.play('error');
        g.hud.toast('Not enough money', 'bad');
        return;
      }
      g.money -= v;
      this.pocket = [];
      audio.play('purchase');
      g.hud.toast(`Paid $${v}`, 'money');
      return;
    }
    if (g.money < 5) {
      audio.play('error');
      return;
    }
    g.money -= 5;
    g.combat.hp = Math.min(100, g.combat.hp + 35);
    audio.play('drink');
  }

  private sell(): void {
    const g = this.game;
    if (!this.bag.length) {
      audio.play('error');
      return;
    }
    const v = this.fence();
    g.money += v;
    g.stats.fenced = (g.stats.fenced ?? 0) + v;
    this.bag = [];
    audio.play('cash');
    g.hud.toast(`Sold the goods for $${v}`, 'money');
    g.save();
  }

  // ---------------------------------------------------------------- stealth

  /** Is the clerk looking at the player right now? */
  private seen(store: Store): boolean {
    if (store.mood !== 'watch') return false;
    const p = store.group.worldToLocal(this.game.player.pos.clone());
    const dx = p.x - CLERK.x;
    const dz = p.z - CLERK.z;
    const d = Math.hypot(dx, dz);
    if (d > 15) return false;
    // The clerk faces -x (into the store), turning their head by `look`.
    const ang = Math.atan2(dz, -dx) - store.look;
    if (Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) > 0.75) return false;
    // Behind a shelf (crouched low between the units) you're out of sight.
    const between = SHELVES.some((sx) => sx > p.x && sx < CLERK.x - 1 && p.z < SHELF.z0 + 0.3 && p.z > SHELF.z1 - 0.3);
    return !between;
  }

  private caught(store: Store, why: string): void {
    const g = this.game;
    audio.play('alarm', { volume: 0.7 });
    g.hud.toast(`${why}! The alarm is ringing`, 'bad');
    store.anim.pose = 'point';
    store.mood = 'watch';
    store.moodT = 4;
    g.crime('shoplifting', 1);
  }

  /** Which store the player is standing in (or null). */
  private storeAt(x: number, z: number): Store | null {
    for (const s of this.stores) {
      const p = s.group.worldToLocal(new THREE.Vector3(x, 0, z));
      if (p.x > -W / 2 && p.x < W / 2 && p.z < 0 && p.z > -D) return s;
    }
    return null;
  }

  update(dt: number): void {
    const g = this.game;
    if (g.mode === 'loading') return;
    if (!this.built) this.build();
    const pp = g.player.pos;
    const inside = g.player.mode === 'walk' ? this.storeAt(pp.x, pp.z) : null;
    // Walked out of the door with unpaid goods: they're stolen now (and the gates may beep).
    if (this.inside && inside !== this.inside && this.pocket.length) {
      const tagged = this.pocket.filter((i) => i.tag).length;
      if (tagged && Math.random() < Math.min(0.85, 0.3 + tagged * 0.15)) this.caught(this.inside, 'The door gates beeped');
      else audio.play('coin', { volume: 0.5 });
      const v = this.pocketValue();
      this.bag.push(...this.pocket);
      g.stats.shoplifted = (g.stats.shoplifted ?? 0) + v;
      g.hud.toast(`Walked out with $${v} of goods: sell them at Pawn Paradise`, 'good');
      this.pocket = [];
    }
    this.inside = inside;
    for (const s of this.stores) {
      const near = s.group.position.distanceToSquared(pp) < 90 * 90;
      s.interior.visible = near;
      if (s.robbedT > 0) s.robbedT -= dt;
      for (const spot of s.spots) {
        if (spot.stock < 3 && (spot.restock -= dt) <= 0) {
          spot.stock++;
          spot.restock = RESTOCK;
        }
      }
      if (!near) continue;
      // The clerk: on the phone for a while, then looks up and watches the store.
      if (!this.robbing || this.robbing.store !== s) {
        s.moodT -= dt;
        if (s.moodT <= 0) {
          s.mood = s.mood === 'watch' ? 'busy' : 'watch';
          s.moodT = s.mood === 'watch' ? 2.5 + Math.random() * 3 : 2 + Math.random() * 4;
          s.anim.pose = s.mood === 'watch' ? 'idle' : 'phone';
        }
      }
      // Turn to face the store (-x), sweeping the aisles while watching.
      const want = s.mood === 'watch' ? Math.sin(performance.now() / 900) * 0.5 : 0.9;
      s.look += (want - s.look) * Math.min(1, dt * 3);
      s.clerk.root.rotation.y = -Math.PI / 2 + s.look;
      s.anim.update(dt);
    }
    // Holding up the register.
    const r = this.robbing;
    if (r) {
      const p = r.store.group.worldToLocal(pp.clone());
      if (Math.hypot(p.x - (COUNTER.x - 1), p.z + 4.2) > 4 || !g.combat.armed) {
        this.robbing = null;
        r.store.anim.pose = 'idle';
        g.hud.toast('You left the counter: no cash', 'bad');
      } else if ((r.t += dt) >= ROB_TIME) {
        const cash = 250 + Math.floor(Math.random() * 650);
        g.money += cash;
        g.stats.robberies = (g.stats.robberies ?? 0) + 1;
        r.store.robbedT = ROB_COOLDOWN;
        r.store.anim.pose = 'handsUp';
        this.robbing = null;
        audio.play('cash');
        g.hud.toast(`Emptied the register: $${cash}. Get out of here!`, 'money');
      }
    }
    this.renderHud(inside);
  }

  private renderHud(inside: Store | null): void {
    const parts: string[] = [];
    if (this.robbing) parts.push(`<b>💰 Emptying the register</b><div class="lift-bar"><i style="width:${Math.round((this.robbing.t / ROB_TIME) * 100)}%"></i></div>`);
    else if (inside) {
      const s = inside;
      parts.push(s.mood === 'watch' ? `<b class="watch">👀 The clerk is watching</b>` : `<b class="busy">📱 The clerk is on the phone</b>`);
      if (this.pocket.length) parts.push(`<span>In your pockets: ${this.pocket.length} · $${this.pocketValue()}</span>`);
    }
    if (this.bag.length) parts.push(`<span>🛍 Stolen goods: $${this.bag.reduce((t, i) => t + i.value, 0)} · sell at Pawn Paradise</span>`);
    const html = parts.join('');
    if (this.hud.innerHTML !== html) this.hud.innerHTML = html;
    this.hud.classList.toggle('on', parts.length > 0 && this.game.mode === 'play');
  }

  markers(full: boolean): MapMarker[] {
    const out: MapMarker[] = [];
    for (const s of this.stores) out.push({ x: s.door.x, z: s.door.z, icon: '🛒', color: '#ff7a1a', label: full ? 'Sunny Mart' : undefined });
    if (this.pawn) out.push({ x: this.pawn.x, z: this.pawn.z, icon: '💍', color: '#f2c230', label: full ? 'Pawn Paradise' : undefined, big: this.bag.length > 0 });
    return out;
  }

  save(): unknown {
    return { bag: this.bag.map((i) => i.name) };
  }

  load(data: unknown): void {
    const d = data as { bag?: unknown } | null;
    this.bag = Array.isArray(d?.bag) ? d.bag.map((n) => ITEMS.find((i) => i.name === n)).filter((i): i is Item => !!i) : [];
  }
}
