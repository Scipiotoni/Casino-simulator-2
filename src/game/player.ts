import * as THREE from 'three';
import { CharacterModel } from '../chars/model';
import { Animator, type Pose } from '../chars/anim';
import type { Appearance } from '../chars/skins';
import type { Input } from '../core/input';
import type { World } from './world';
import { dampAngle } from '../core/math';

export type PlayerMode = 'walk' | 'seated' | 'driving' | 'scripted' | 'dead';

/**
 * You: a character on foot. Moves relative to the camera, jogs by default and sprints with
 * Shift, jumps, swims, steps onto floors (bridge deck, building floors) and is pushed out
 * of walls, trees and parked cars.
 */
export class Player {
  model: CharacterModel;
  anim: Animator;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  mode: PlayerMode = 'walk';
  grounded = true;
  swimming = false;
  radius = 0.35;
  height = 1.8;
  /** Overrides the animation (emotes, seated poses); null = locomotion. */
  poseOverride: Pose | null = null;
  private emoteTime = 0;
  health = 100;
  stamina = 1;
  /** Set when moving fast enough to count as sprinting (for the HUD). */
  sprinting = false;
  firstPerson = false;
  /** Cutscene / seat target the model is snapped to. */
  readonly anchor = new THREE.Vector3();
  anchorYaw = 0;

  constructor(private scene: THREE.Scene, appearance: Appearance) {
    this.model = new CharacterModel(appearance);
    this.anim = new Animator(this.model);
    scene.add(this.model.root);
  }

  setAppearance(a: Appearance): void {
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = new CharacterModel(a);
    this.anim = new Animator(this.model);
    this.scene.add(this.model.root);
  }

  /** Play an emote until the player moves. */
  emote(p: Pose, seconds = 6): void {
    this.poseOverride = p;
    this.emoteTime = seconds;
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
  }

  update(dt: number, input: Input | null, camYaw: number, world: World, inputEnabled: boolean): void {
    if (this.mode === 'seated' || this.mode === 'scripted') {
      this.pos.copy(this.anchor);
      this.yaw = this.anchorYaw;
      this.anim.speed = 0;
      this.anim.pose = this.poseOverride ?? 'idle';
      this.place(dt);
      return;
    }
    if (this.mode === 'driving' || this.mode === 'dead') {
      this.place(dt);
      return;
    }
    const ax = inputEnabled && input ? input.moveAxes() : { x: 0, y: 0 };
    const moving = Math.hypot(ax.x, ax.y) > 0.05;
    const sprint = inputEnabled && !!input && (input.down('ShiftLeft') || input.down('ShiftRight')) && moving && !this.swimming;
    const walkSlow = inputEnabled && !!input && (input.down('ControlLeft') || input.down('AltLeft'));
    let target = this.swimming ? 2.6 : sprint ? 8.2 : walkSlow ? 1.8 : 5.2;
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 0.08);
    else this.stamina = Math.min(1, this.stamina + dt * 0.15);
    if (sprint && this.stamina <= 0) target = 5.2;
    this.sprinting = sprint && this.stamina > 0;
    // Camera-relative direction.
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    const dx = ax.x * cos - ax.y * sin;
    const dz = -ax.x * sin - ax.y * cos;
    const wantX = dx * target;
    const wantZ = dz * target;
    const accel = this.grounded || this.swimming ? 14 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wantX - this.vel.x) * k;
    this.vel.z += (wantZ - this.vel.z) * k;
    if (moving) {
      this.poseOverride = null;
      const faceYaw = this.firstPerson ? camYaw + Math.PI : Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, faceYaw, 12, dt);
    } else if (this.firstPerson) {
      this.yaw = dampAngle(this.yaw, camYaw + Math.PI, 20, dt);
    }
    // Jump.
    if (inputEnabled && input && input.pressed('Space') && this.grounded && !this.swimming) {
      this.vel.y = 6.2;
      this.grounded = false;
      this.poseOverride = null;
    }
    this.vel.y -= 19 * dt;
    if (this.swimming) this.vel.y = Math.max(this.vel.y, -2);
    // Integrate horizontally, then collide.
    const next = { x: this.pos.x + this.vel.x * dt, z: this.pos.z + this.vel.z * dt };
    world.collision.resolve(next, this.radius, this.pos.y + 0.3, this.height - 0.3);
    // Don't walk up cliffs: if the ground ahead is much steeper, slide back.
    const gNext = world.groundY(next.x, next.z, this.pos.y);
    const gHere = world.groundY(this.pos.x, this.pos.z, this.pos.y);
    if (this.grounded && gNext - gHere > 0.6 && gNext > this.pos.y + 0.6) {
      next.x = this.pos.x;
      next.z = this.pos.z;
    } else if (this.grounded && world.terrain.slopeAt(next.x, next.z) < 0.5 && gNext > gHere + 0.05) {
      // Steep slope: you can't climb it.
      next.x = this.pos.x + (next.x - this.pos.x) * 0.15;
      next.z = this.pos.z + (next.z - this.pos.z) * 0.15;
    }
    this.pos.x = next.x;
    this.pos.z = next.z;
    this.pos.y += this.vel.y * dt;
    const ground = world.groundY(this.pos.x, this.pos.z, this.pos.y);
    // Water: float with your head above the surface.
    const waterY = -1.25;
    if (ground < waterY - 0.2 && this.pos.y <= waterY + 0.05) {
      this.swimming = true;
      this.grounded = false;
      this.pos.y = waterY;
      this.vel.y = 0;
    } else {
      this.swimming = false;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.y = 0;
        this.grounded = true;
      } else if (this.grounded && this.pos.y - ground < 0.45 && this.vel.y <= 0) {
        // Stick to the ground walking down slopes and steps.
        this.pos.y = ground;
        this.vel.y = 0;
      } else {
        this.grounded = false;
      }
    }
    // Animation state.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.poseOverride) {
      this.emoteTime -= dt;
      if (this.emoteTime <= 0) this.poseOverride = null;
    }
    this.anim.speed = hs;
    this.anim.pose = this.swimming ? 'swim' : !this.grounded ? (this.vel.y > 0 ? 'jump' : 'fall') : this.poseOverride ?? 'idle';
    this.place(dt);
  }

  private place(dt: number): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.anim.update(dt);
  }

  /** Where the eyes are (for first person). */
  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    this.model.bones.head.updateWorldMatrix(true, false);
    out.set(0, 0.12, 0.06).applyMatrix4(this.model.bones.head.matrixWorld);
    return out;
  }

  /** Hide the head in first person so the camera doesn't see the inside of it. */
  setHeadVisible(v: boolean): void {
    this.model.bones.head.scale.setScalar(v ? 1 : 0.001);
  }

  setVisible(v: boolean): void {
    this.model.root.visible = v;
  }
}
