import * as THREE from 'three';
import { Vehicle } from '../vehicles/vehicle';
import { CharacterModel } from '../chars/model';
import { Animator } from '../chars/anim';
import { randomAppearance } from '../chars/skins';
import { GRID_X, GRID_Z } from './layout';
import { mulberry32 } from '../core/noise';
import type { Game } from '../game/game';
import { audio } from '../core/audio';

/**
 * City traffic: cars driving the street grid on the right-hand lane, turning at random at
 * junctions, braking for the car ahead, for you and for your car. Only a handful exist,
 * always near you; ones you leave behind reappear on streets ahead. Walk up to one and
 * press E to take it (the driver won't be happy, and neither will the police).
 */

interface Node {
  x: number;
  z: number;
  links: Node[];
}

const MODELS = ['hatch', 'sedan', 'sedan', 'taxi', 'suv', 'van', 'convertible', 'pickup', 'muscle', 'limo'];
const COLORS = [0xe8e8ea, 0x15151a, 0xc8202f, 0x1e6bff, 0x9aa0ab, 0x2bd96b, 0xffd23d, 0xff7a1a, 0x7b2ff7, 0x6a3f22];

class TrafficCar {
  v: Vehicle;
  driver: CharacterModel;
  anim: Animator;
  from!: Node;
  to!: Node;
  t = 0;
  len = 1;
  speed = 0;
  honkT = 0;
  lane = 3.2;

  constructor(scene: THREE.Scene, seed: number) {
    const r = mulberry32(seed);
    const def = MODELS[Math.floor(r() * MODELS.length)];
    this.v = new Vehicle(def, def === 'taxi' ? undefined : COLORS[Math.floor(r() * COLORS.length)], `traffic${seed}`);
    this.v.scripted = true;
    this.v.driver = 'npc';
    this.driver = new CharacterModel(randomAppearance(r, 'civilian'));
    this.anim = new Animator(this.driver);
    this.anim.pose = 'drive';
    this.anim.snap();
    scene.add(this.v.root, this.driver.root);
  }
}

export class Traffic {
  private nodes: Node[] = [];
  private cars: TrafficCar[] = [];
  private rng = mulberry32(777);
  private tmp = new THREE.Vector3();

  constructor(private game: Game, count: number) {
    // Junctions of the street grid (only where both streets exist).
    const hasX = (x: number, z: number) => z >= (x === 3450 ? -1650 : GRID_Z[0]) && z <= GRID_Z[GRID_Z.length - 1];
    const hasZ = (x: number, z: number) => x >= GRID_X[0] && x <= (z === -2100 ? 3050 : 3450);
    const grid = new Map<string, Node>();
    for (const x of GRID_X) for (const z of GRID_Z) if (hasX(x, z) && hasZ(x, z)) grid.set(`${x},${z}`, { x, z, links: [] });
    for (const n of grid.values()) {
      const xi = GRID_X.indexOf(n.x);
      const zi = GRID_Z.indexOf(n.z);
      const link = (x: number | undefined, z: number | undefined) => {
        if (x === undefined || z === undefined) return;
        const m = grid.get(`${x},${z}`);
        if (m) n.links.push(m);
      };
      link(GRID_X[xi + 1], n.z);
      link(GRID_X[xi - 1], n.z);
      link(n.x, GRID_Z[zi + 1]);
      link(n.x, GRID_Z[zi - 1]);
    }
    this.nodes = [...grid.values()];
    for (let i = 0; i < count; i++) {
      const c = new TrafficCar(game.renderer.scene, 300 + i * 13);
      this.cars.push(c);
      this.respawn(c, true);
    }
  }

  get list(): Vehicle[] {
    return this.cars.map((c) => c.v);
  }

  private laneFor(a: Node, b: Node): number {
    // Boulevards (the Strip and I-15) have two lanes each way: keep to the outer one.
    if ((a.x === 2600 && b.x === 2600) || (a.z === -300 && b.z === -300)) return 6.2;
    return 3.2;
  }

  private start(c: TrafficCar, a: Node, b: Node, t = 0): void {
    c.from = a;
    c.to = b;
    c.len = Math.hypot(b.x - a.x, b.z - a.z);
    c.t = t;
    c.lane = this.laneFor(a, b);
  }

  /** Put a car on a street segment near (but not right in front of) the player. */
  private respawn(c: TrafficCar, anywhere = false): void {
    const p = this.game.player?.pos ?? new THREE.Vector3(2600, 6, -300);
    for (let tries = 0; tries < 20; tries++) {
      const a = this.nodes[Math.floor(this.rng() * this.nodes.length)];
      const b = a.links[Math.floor(this.rng() * a.links.length)];
      if (!b) continue;
      const t = this.rng();
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const d = Math.hypot(x - p.x, z - p.z);
      if (!anywhere && (d < 110 || d > 300)) continue;
      if (anywhere && d > 500 && tries < 19) continue;
      this.start(c, a, b, t * Math.hypot(b.x - a.x, b.z - a.z));
      c.speed = 8;
      return;
    }
  }

  /** Lane position along the current segment. */
  private posOf(c: TrafficCar, out: THREE.Vector3): number {
    const dx = (c.to.x - c.from.x) / c.len;
    const dz = (c.to.z - c.from.z) / c.len;
    // Right of the heading is (-dz, dx).
    out.set(c.from.x + dx * c.t - dz * c.lane, 0, c.from.z + dz * c.t + dx * c.lane);
    return Math.atan2(dx, dz);
  }

  /** You took this car: it leaves traffic and becomes a normal car. */
  carjack(v: Vehicle): void {
    const i = this.cars.findIndex((c) => c.v === v);
    if (i < 0) return;
    const c = this.cars[i];
    this.cars.splice(i, 1);
    c.driver.root.removeFromParent();
    c.driver.dispose();
    v.scripted = false;
    v.driver = null;
    v.speed = 0;
    this.game.vehicles.adopt(v);
    this.game.vehicles.enter(v);
    this.game.combat.crime('stole a car', 1);
    audio.play('carAlarm', { volume: 0.4 });
    // Replace it so the streets stay busy.
    const n = new TrafficCar(this.game.renderer.scene, 600 + Math.floor(this.rng() * 1e6));
    this.cars.push(n);
    this.respawn(n);
  }

  /** The traffic car closest to a point (for "take this car"). */
  nearest(x: number, z: number, r: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = r;
    for (const c of this.cars) {
      const d = Math.hypot(c.v.pos.x - x, c.v.pos.z - z);
      if (d < bd) {
        bd = d;
        best = c.v;
      }
    }
    return best;
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.pos;
    const inCity = p.x > 900 && p.x < 3900 && p.z > -2400 && p.z < 1900;
    const cam = g.renderer.camera.position;
    const mine = g.vehicles.driving;
    for (const c of this.cars) {
      c.v.root.visible = inCity;
      c.driver.root.visible = inCity;
      if (!inCity) continue;
      if (Math.hypot(c.v.pos.x - p.x, c.v.pos.z - p.z) > 340) this.respawn(c);
      // Brake for anything ahead in the lane: other traffic, your car, you.
      const fx = Math.sin(c.v.heading);
      const fz = Math.cos(c.v.heading);
      let gap = 99;
      const look = (x: number, z: number, r: number) => {
        const dx = x - c.v.pos.x;
        const dz = z - c.v.pos.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(-dx * fz + dz * fx);
        if (ahead > 0 && side < r) gap = Math.min(gap, ahead);
      };
      for (const o of this.cars) if (o !== c) look(o.v.pos.x, o.v.pos.z, 2.2);
      if (mine) look(mine.pos.x, mine.pos.z, 2.6);
      else if (g.player.mode === 'walk') look(p.x, p.z, 2.0);
      for (const v of g.vehicles.list) if (v !== mine) look(v.pos.x, v.pos.z, 2.2);
      const near = c.len - c.t;
      const turnSlow = near < 18 ? 6 : 12.5;
      let want = turnSlow;
      if (gap < c.v.def.L + 9) want = Math.min(want, Math.max(0, (gap - c.v.def.L - 2) * 1.2));
      c.speed += (want - c.speed) * Math.min(1, dt * (want < c.speed ? 4 : 1.2));
      if (gap < c.v.def.L + 3 && mine) {
        c.honkT -= dt;
        if (c.honkT <= 0) {
          c.honkT = 3 + this.rng() * 3;
          audio.playAt('honk', c.v.pos.x, c.v.pos.z, 0.6);
        }
      }
      c.t += c.speed * dt;
      if (c.t >= c.len) {
        // Pick the next street at the junction (no U-turns unless it's a dead end).
        const options = c.to.links.filter((n) => n !== c.from);
        const next = options.length ? options[Math.floor(this.rng() * options.length)] : c.from;
        this.start(c, c.to, next, c.t - c.len);
      }
      const h = this.posOf(c, this.tmp);
      // Smooth the heading (and corner a little wide).
      let dh = h - c.v.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.v.heading += dh * Math.min(1, dt * 6);
      c.v.steer = Math.max(-0.5, Math.min(0.5, dh * 1.5));
      c.v.pos.x += (this.tmp.x - c.v.pos.x) * Math.min(1, dt * 8);
      c.v.pos.z += (this.tmp.z - c.v.pos.z) * Math.min(1, dt * 8);
      c.v.speed = c.speed;
      c.v.sync(dt, g.world);
      // Driver in the seat.
      const dist = c.v.pos.distanceTo(cam);
      c.driver.updateLod(dist);
      if (c.driver.lod < 2) {
        const seat = c.v.seatWorld(0, this.tmp);
        c.driver.root.position.set(seat.x, seat.y - 0.2, seat.z);
        c.driver.root.rotation.y = c.v.heading;
        c.anim.update(dt);
      }
      // Your car hitting it.
      if (mine && Math.hypot(mine.pos.x - c.v.pos.x, mine.pos.z - c.v.pos.z) < (mine.def.L + c.v.def.L) * 0.32) {
        const rel = Math.abs(mine.speed - c.speed);
        if (rel > 4) {
          audio.play('crash', { volume: Math.min(1, rel / 25) });
          g.camera.shake = Math.min(1, rel / 30);
          mine.health = Math.max(0, mine.health - rel * 0.3);
        }
        mine.speed *= -0.3;
        c.speed = 0;
        // Push apart.
        const dx = mine.pos.x - c.v.pos.x;
        const dz = mine.pos.z - c.v.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        mine.pos.x += (dx / d) * 0.6;
        mine.pos.z += (dz / d) * 0.6;
      }
    }
  }
}
