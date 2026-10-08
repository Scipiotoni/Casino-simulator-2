import * as THREE from 'three';
import { CharacterModel } from '../chars/model';
import { Animator } from '../chars/anim';
import type { Appearance } from '../chars/skins';
import { buildGun } from './gunModel';
import { gunDef } from './guns';
import { dampAngle } from '../core/math';
import type { Game } from '../game/game';
import type { Hittable } from './combat';
import { audio } from '../core/audio';

export type Faction = 'soldier' | 'police';

/**
 * Armed NPCs: soldiers patrolling Fort Hammerhead and police answering your wanted level.
 * They walk a patrol loop until they spot you (in their sight cone, in range, with a clear
 * line), then close in and shoot. Shot enough, they're knocked out and get up later.
 */
export class Gunman implements Hittable {
  readonly model: CharacterModel;
  readonly anim: Animator;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  radius = 0.42;
  height = 1.8;
  state: 'patrol' | 'alert' | 'ko' | 'idle' = 'patrol';
  /** Patrol loop (world xz). */
  route: { x: number; z: number }[] = [];
  private ri = 0;
  private fireT = 1;
  private koT = 0;
  private seenT = 0;
  private lostT = 0;
  private wait = 0;
  readonly home = new THREE.Vector3();
  readonly homeYaw: number;
  private muzzle: THREE.Object3D;
  alive = true;
  /** Fires on the player when alerted. */
  hostile = true;
  /** Spotting range. */
  sight = 42;

  constructor(private game: Game, appearance: Appearance, readonly faction: Faction, x: number, z: number, yaw: number, gun = 'rifle') {
    this.model = new CharacterModel(appearance);
    this.anim = new Animator(this.model);
    const gm = buildGun(gunDef(gun));
    this.model.attach(gm.group, 'handR');
    this.muzzle = gm.muzzle;
    this.pos.set(x, game.world.groundY(x, z), z);
    this.home.copy(this.pos);
    this.yaw = this.homeYaw = yaw;
    game.renderer.scene.add(this.model.root);
    this.place(0);
  }

  get alert(): boolean {
    return this.state === 'alert';
  }

  hit(dmg: number, _head: boolean, fromX: number, fromZ: number): void {
    if (this.state === 'ko') return;
    this.hp -= dmg;
    this.model.setExpression('angry', 1.2);
    // Turn to face whoever shot.
    this.yaw = Math.atan2(fromX - this.pos.x, fromZ - this.pos.z);
    if (this.hp <= 0) {
      this.state = 'ko';
      this.alive = false;
      this.koT = this.faction === 'police' ? 30 : 75;
      this.anim.pose = 'ko';
      this.model.setExpression('ko' as never, 999);
      audio.playAt('knockout', this.pos.x, this.pos.z, 0.8);
      return;
    }
    this.state = 'alert';
    this.seenT = 1;
  }

  /** Can this NPC see the player? */
  private sees(px: number, py: number, pz: number): boolean {
    const dx = px - this.pos.x;
    const dz = pz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > (this.state === 'alert' ? this.sight * 1.6 : this.sight)) return false;
    if (this.state !== 'alert' && d > 6) {
      // Sight cone: 120° ahead.
      const fa = Math.atan2(dx, dz);
      let da = fa - this.yaw;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > 1.05) return false;
    }
    return this.game.combat.lineOfSight(this.pos.x, this.pos.y + 1.55, this.pos.z, px, py + 1.3, pz);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    const g = this.game;
    const dCam = this.pos.distanceTo(camPos);
    this.model.updateLod(dCam);
    if (this.state === 'ko') {
      this.koT -= dt;
      if (this.koT <= 0 && dCam > 60) this.revive();
      this.place(dt);
      return;
    }
    const p = g.player;
    const canTarget = g.combat.targetable;
    const seeing = canTarget && this.hostile && this.sees(p.pos.x, p.pos.y, p.pos.z);
    if (seeing) {
      this.seenT += dt;
      this.lostT = 0;
      // A moment to react, quicker once alert.
      if (this.state !== 'alert' && this.seenT > (this.faction === 'police' ? 0.2 : 0.8)) this.alarm();
    } else {
      this.seenT = Math.max(0, this.seenT - dt);
      if (this.state === 'alert') {
        this.lostT += dt;
        if (this.lostT > 14 || !canTarget) this.state = this.faction === 'police' ? 'alert' : 'patrol';
      }
    }
    let speed = 0;
    if (this.state === 'alert' && canTarget) {
      const dx = p.pos.x - this.pos.x;
      const dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
      // Close in until in range with a clear line, then stand and shoot.
      const want = seeing ? 16 : 3;
      if (d > want) speed = this.faction === 'police' ? 5.6 : 4.6;
      this.anim.upper = 'aimPistol';
      if (seeing) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = this.faction === 'police' ? 0.75 + Math.random() * 0.6 : 0.45 + Math.random() * 0.5;
          this.shoot(d);
        }
      }
    } else if (this.state === 'patrol' && this.route.length) {
      this.anim.upper = null;
      if (this.wait > 0) this.wait -= dt;
      else {
        const t = this.route[this.ri];
        const dx = t.x - this.pos.x;
        const dz = t.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1) {
          this.ri = (this.ri + 1) % this.route.length;
          this.wait = 1 + Math.random() * 3;
        } else {
          this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
          speed = 1.5;
        }
      }
    } else {
      this.anim.upper = null;
      this.yaw = dampAngle(this.yaw, this.homeYaw, 3, dt);
    }
    if (speed > 0) {
      const nx = this.pos.x + Math.sin(this.yaw) * speed * dt;
      const nz = this.pos.z + Math.cos(this.yaw) * speed * dt;
      const next = { x: nx, z: nz };
      g.world.collision.resolve(next, this.radius, this.pos.y + 0.3, 1.5);
      this.pos.x = next.x;
      this.pos.z = next.z;
      this.pos.y = g.world.groundY(this.pos.x, this.pos.z, this.pos.y + 0.6);
    }
    this.anim.speed = speed;
    this.anim.pose = 'idle';
    this.anim.lookPitch = this.state === 'alert' ? Math.atan2(p.pos.y - this.pos.y, Math.max(1, this.pos.distanceTo(p.pos))) : 0;
    this.place(dt);
  }

  /** Raise the alarm (soldiers call the others nearby). */
  alarm(): void {
    if (this.state === 'alert' || this.state === 'ko') return;
    this.state = 'alert';
    this.model.setExpression('angry', 3);
    this.fireT = 0.6;
    this.game.combat.onSpotted(this);
  }

  private shoot(dist: number): void {
    const g = this.game;
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    const p = g.player;
    // Aim at the chest with a spread that grows with distance (and if you're moving fast).
    const moving = Math.hypot(p.vel.x, p.vel.z);
    const spread = 0.025 + dist * 0.0012 + moving * 0.006 + (this.faction === 'police' ? 0.01 : 0);
    const target = new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
    const dir = target.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    audio.playAt(this.faction === 'police' ? 'gunshot' : 'smg', this.pos.x, this.pos.z, 0.7);
    g.combat.npcFire(from, dir, this.faction === 'police' ? 9 : 7);
  }

  revive(): void {
    this.hp = 100;
    this.alive = true;
    this.state = this.route.length ? 'patrol' : 'idle';
    this.pos.copy(this.home);
    this.yaw = this.homeYaw;
    this.model.setExpression('neutral');
    this.anim.pose = 'idle';
  }

  private place(dt: number): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    if (this.model.lod < 2) this.anim.update(dt);
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
  }
}
