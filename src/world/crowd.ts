import * as THREE from 'three';
import { CharacterModel } from '../chars/model';
import { Animator } from '../chars/anim';
import { randomAppearance } from '../chars/skins';
import { cityBlocks, CITY_Y, type Block } from './layout';
import { mulberry32 } from '../core/noise';
import type { Hittable } from '../combat/combat';
import type { Game } from '../game/game';
import { dampAngle } from '../core/math';

/**
 * People on the city's sidewalks. A small pool of walkers is kept near you: each strolls
 * round a block a couple of metres in from the kerb, and is quietly moved to a block
 * near you once you've left them behind. Gunfire sends them running; a stray bullet (or a
 * car) knocks them over for a few seconds.
 */

class Walker implements Hittable {
  model: CharacterModel;
  anim: Animator;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  radius = 0.38;
  height = 1.75;
  alive = true;
  hp = 100;
  block!: Block;
  /** Distance along the block's loop. */
  s = 0;
  dir = 1;
  speed = 1.3;
  panicT = 0;
  koT = 0;
  inset = 2.2;

  constructor(scene: THREE.Scene, seed: number) {
    const r = mulberry32(seed);
    this.model = new CharacterModel(randomAppearance(r, r() < 0.3 ? 'gambler' : 'civilian'));
    this.anim = new Animator(this.model);
    this.speed = 1.1 + r() * 0.5;
    this.dir = r() < 0.5 ? 1 : -1;
    this.inset = 1.6 + r() * 1.4;
    scene.add(this.model.root);
  }

  hit(dmg: number, _head: boolean, fx: number, fz: number): void {
    if (!this.alive) return;
    this.hp -= dmg;
    this.panicT = 8;
    this.yaw = Math.atan2(this.pos.x - fx, this.pos.z - fz);
    if (this.hp <= 0) {
      this.alive = false;
      this.koT = 9;
      this.anim.pose = 'ko';
    } else this.model.setExpression('surprised', 3);
  }

  loopLen(): number {
    const b = this.block;
    return 2 * (b.x1 - b.x0 - 2 * this.inset) + 2 * (b.z1 - b.z0 - 2 * this.inset);
  }

  /** Point and heading at distance s round the block (clockwise from the north-west corner). */
  at(s: number, out: THREE.Vector3): number {
    const b = this.block;
    const x0 = b.x0 + this.inset;
    const x1 = b.x1 - this.inset;
    const z0 = b.z0 + this.inset;
    const z1 = b.z1 - this.inset;
    const w = x1 - x0;
    const d = z1 - z0;
    const L = 2 * (w + d);
    s = ((s % L) + L) % L;
    if (s < w) {
      out.set(x0 + s, 0, z0);
      return Math.PI / 2;
    }
    s -= w;
    if (s < d) {
      out.set(x1, 0, z0 + s);
      return 0;
    }
    s -= d;
    if (s < w) {
      out.set(x1 - s, 0, z1);
      return -Math.PI / 2;
    }
    s -= w;
    out.set(x0, 0, z1 - s);
    return Math.PI;
  }
}

export class Crowd {
  private walkers: Walker[] = [];
  private blocks = cityBlocks();
  private rng = mulberry32(4242);
  private tmp = new THREE.Vector3();

  constructor(private game: Game, count: number) {
    for (let i = 0; i < count; i++) this.walkers.push(new Walker(game.renderer.scene, 900 + i * 37));
    for (const w of this.walkers) this.place(w, true);
  }

  hittables(): Iterable<Hittable> {
    return this.walkers;
  }

  isCivilian(h: Hittable): boolean {
    return h instanceof Walker;
  }

  /** Gunfire nearby: everyone within r runs. */
  panic(x: number, z: number, r: number): void {
    for (const w of this.walkers) {
      if (!w.alive) continue;
      if (Math.hypot(w.pos.x - x, w.pos.z - z) < r) {
        w.panicT = 7;
        w.model.setExpression('surprised', 4);
        // Run away from the noise.
        const away = Math.atan2(w.pos.x - x, w.pos.z - z);
        const ahead = w.at(w.s + 1, this.tmp);
        let da = away - ahead;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        w.dir = Math.abs(da) < Math.PI / 2 ? 1 : -1;
      }
    }
  }

  /** Put a walker on a block near the player (off-screen if possible). */
  private place(w: Walker, anywhere = false): void {
    const p = this.game.player?.pos ?? new THREE.Vector3(2600, 0, -300);
    const near = this.blocks.filter((b) => {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const d = Math.hypot(cx - p.x, cz - p.z);
      return d < 320;
    });
    const list = near.length ? near : this.blocks;
    w.block = list[Math.floor(this.rng() * list.length)];
    w.s = this.rng() * w.loopLen();
    if (!anywhere) {
      // Prefer a spot more than 70 m away.
      for (let i = 0; i < 6; i++) {
        w.at(w.s, this.tmp);
        if (Math.hypot(this.tmp.x - p.x, this.tmp.z - p.z) > 70) break;
        w.s = this.rng() * w.loopLen();
      }
    }
    w.alive = true;
    w.hp = 100;
    w.koT = 0;
    w.panicT = 0;
    w.yaw = w.at(w.s, w.pos);
    w.pos.y = CITY_Y;
  }

  setVisible(v: boolean): void {
    for (const w of this.walkers) w.model.root.visible = v;
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player.pos;
    const cam = g.renderer.camera.position;
    const inCity = p.x > 1000 && p.x < 3800 && p.z > -2000 && p.z < 1800;
    const indoors = !!g.world.venueAt(p.x, p.z);
    for (const w of this.walkers) {
      const d = Math.hypot(w.pos.x - p.x, w.pos.z - p.z);
      if (d > 190 && inCity) this.place(w);
      w.model.root.visible = inCity && !indoors;
      if (!w.model.root.visible) continue;
      if (!w.alive) {
        w.koT -= dt;
        if (w.koT <= 0) {
          w.alive = true;
          w.hp = 100;
          w.panicT = 6;
        }
        w.anim.pose = 'ko';
        w.anim.speed = 0;
      } else {
        const run = w.panicT > 0;
        w.panicT -= dt;
        const sp = run ? 5.8 : w.speed;
        // Wait for the player rather than walking through them.
        const blocked = !run && d < 1.2;
        if (!blocked) w.s += w.dir * sp * dt;
        const heading = w.at(w.s, this.tmp);
        w.pos.x = this.tmp.x;
        w.pos.z = this.tmp.z;
        w.pos.y = g.world.groundY(w.pos.x, w.pos.z, CITY_Y + 2);
        w.yaw = dampAngle(w.yaw, w.dir > 0 ? heading : heading + Math.PI, 8, dt);
        w.anim.pose = 'idle';
        w.anim.speed = blocked ? 0 : sp;
        // Hit by your car.
        const car = g.vehicles.driving;
        if (car && Math.abs(car.speed) > 6 && Math.hypot(car.pos.x - w.pos.x, car.pos.z - w.pos.z) < car.def.W * 0.6 + 0.4) {
          w.hit(200, false, car.pos.x, car.pos.z);
          g.camera.shake = Math.max(g.camera.shake, 0.2);
        }
      }
      w.model.root.position.copy(w.pos);
      w.model.root.rotation.y = w.yaw;
      const dc = w.pos.distanceTo(cam);
      w.model.updateLod(dc);
      if (w.model.lod < 2) w.anim.update(dt);
    }
  }
}
