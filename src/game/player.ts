import * as THREE from 'three';
import { CharacterModel } from '../chars/model';
import { Animator, ROLL_TIME, rollProgress, rollSpeed, rollSwell, type Pose } from '../chars/anim';
import type { Appearance } from '../chars/skins';
import type { Input } from '../core/input';
import type { World } from './world';
import { audio } from '../core/audio';
import { dampAngle, smoothstep } from '../core/math';

export type PlayerMode = 'walk' | 'seated' | 'driving' | 'scripted' | 'dead';

/** The dodge roll (Space): how far it carries you, and the breather before the next one. */
const ROLL_DIST = 4;
const ROLL_REST = 0.45;

/**
 * You: a character on foot. Moves relative to the camera, jogs by default and sprints with
 * Shift, dodge-rolls with Space, swims, steps onto floors (bridge deck, building floors) and
 * is pushed out of walls, trees and parked cars.
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
  /** Seconds into the current dodge roll (-1 when not rolling). */
  rollT = -1;
  private rollWait = 0;
  private rollThud = false;
  /** Ground direction of the roll (x, z). */
  private readonly rollDir = new THREE.Vector2();
  /** Where the eyes were, from the feet, as the roll began (the first-person view rides on it). */
  private readonly rollEye = new THREE.Vector3();
  private readonly tmpEye = new THREE.Vector3();

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
    this.endRoll();
  }

  get rolling(): boolean {
    return this.rollT >= 0;
  }

  /** 0..1 through the current roll (0 when not rolling). */
  get rollPhase(): number {
    return this.rollT < 0 ? 0 : Math.min(1, this.rollT / ROLL_TIME);
  }

  /** Tucked and turning: bullets go past. */
  get dodging(): boolean {
    const u = this.rollPhase;
    return this.rolling && u > 0.1 && u < 0.7;
  }

  /** Roll along (x, z), or the way you face when that's zero. */
  private startRoll(x: number, z: number): void {
    const l = Math.hypot(x, z);
    if (l > 1e-3) this.rollDir.set(x / l, z / l);
    else this.rollDir.set(Math.sin(this.yaw), Math.cos(this.yaw));
    this.headEye(this.rollEye).sub(this.pos);
    this.rollT = 0;
    this.rollThud = false;
    this.poseOverride = null;
    audio.play('whoosh', { volume: 0.9 });
  }

  private endRoll(): void {
    if (this.rollT < 0) return;
    this.rollT = -1;
    this.rollWait = ROLL_REST;
    this.anim.action = 0;
  }

  update(dt: number, input: Input | null, camYaw: number, world: World, inputEnabled: boolean): void {
    if (this.mode !== 'walk') this.endRoll();
    if (this.mode === 'seated' || this.mode === 'scripted') {
      this.pos.copy(this.anchor);
      this.yaw = this.anchorYaw;
      this.anim.speed = 0;
      this.anim.pose = this.poseOverride ?? 'idle';
      this.place(dt);
      return;
    }
    if (this.mode === 'driving' || this.mode === 'dead') {
      this.anim.speed = 0;
      this.anim.pose = this.mode === 'dead' ? 'ko' : this.poseOverride ?? 'drive';
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
    // Dodge roll: Space on the ground (not mid-air, in the water or straight after another one),
    // the way you're heading or, standing still, the way you face.
    this.rollWait = Math.max(0, this.rollWait - dt);
    if (inputEnabled && input && input.pressed('Space') && !this.rolling && this.rollWait <= 0 && this.grounded && !this.swimming) {
      this.startRoll(moving ? dx : 0, moving ? dz : 0);
    }
    if (this.rolling) {
      // A fixed path: the speed comes from the roll's own curve (exact distance, any frame rate);
      // the end of a frame that runs past the roll carries on at the speed you come out with.
      const t0 = this.rollT;
      const u0 = this.rollPhase;
      this.rollT += dt;
      const u1 = this.rollPhase;
      const after = dt - (Math.min(this.rollT, ROLL_TIME) - t0);
      const along = ROLL_DIST * (rollProgress(u1) - rollProgress(u0)) + (ROLL_DIST / ROLL_TIME) * rollSpeed(1) * after;
      const sp = dt > 0 ? along / dt : 0;
      this.vel.x = this.rollDir.x * sp;
      this.vel.z = this.rollDir.y * sp;
      this.yaw = dampAngle(this.yaw, Math.atan2(this.rollDir.x, this.rollDir.y), 30, dt);
      // Shoulders meet the ground: the tumble (its thump lands as you come up).
      if (!this.rollThud && u1 > 0.22) {
        this.rollThud = true;
        audio.play('roll', { volume: 0.45 });
      }
      if (this.rollT >= ROLL_TIME) this.endRoll();
    } else {
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
    if (this.swimming) this.endRoll();
    // Animation state.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.poseOverride) {
      this.emoteTime -= dt;
      if (this.emoteTime <= 0) this.poseOverride = null;
    }
    this.anim.speed = hs;
    if (this.rolling) this.anim.action = this.rollPhase;
    this.anim.pose = this.rolling ? 'roll' : this.swimming ? 'swim' : !this.grounded ? 'fall' : this.poseOverride ?? 'idle';
    this.place(dt);
  }

  private place(dt: number): void {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    // In first person the tumbling body (and gun) would sweep through the view: hide it mid-roll.
    this.model.mesh.visible = !(this.firstPerson && this.rolling);
    this.anim.update(dt);
  }

  private headEye(out: THREE.Vector3): THREE.Vector3 {
    this.model.bones.head.updateWorldMatrix(true, false);
    return out.set(0, 0.12, 0.06).applyMatrix4(this.model.bones.head.matrixWorld);
  }

  /**
   * Where the eyes are (for first person). Mid-roll the view follows a smooth dip low to the
   * ground rather than the head itself (a full turn of the camera is a quick way to feel sick),
   * easing back onto the head as you stand up.
   */
  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    this.headEye(out);
    if (!this.rolling) return out;
    const u = this.rollPhase;
    const e = this.tmpEye.copy(this.pos).add(this.rollEye);
    e.y -= rollSwell(u) * 0.75;
    return out.lerp(e, 1 - smoothstep(0.88, 1, u));
  }

  /**
   * The first-person tumble mid-roll: the view pitches the way you roll (down rolling forward,
   * up rolling back) and banks rolling sideways. Radians, for a camera with this yaw.
   */
  rollTumble(camYaw: number): { pitch: number; bank: number } {
    if (!this.rolling) return { pitch: 0, bank: 0 };
    const w = rollSwell(this.rollPhase);
    const s = Math.sin(camYaw);
    const c = Math.cos(camYaw);
    const ahead = -(this.rollDir.x * s + this.rollDir.y * c);
    const right = this.rollDir.x * c - this.rollDir.y * s;
    return { pitch: -0.55 * w * ahead, bank: -0.3 * w * right };
  }

  /** Hide the head in first person so the camera doesn't see the inside of it. */
  setHeadVisible(v: boolean): void {
    this.model.bones.head.scale.setScalar(v ? 1 : 0.001);
  }

  setVisible(v: boolean): void {
    this.model.root.visible = v;
  }
}
