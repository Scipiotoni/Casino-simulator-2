import * as THREE from 'three';
import type { Input } from '../core/input';
import type { World } from './world';
import { clamp, damp } from '../core/math';

export type CamMode = 'third' | 'first' | 'seated' | 'vehicle' | 'cinematic' | 'free';

/**
 * The camera: over-the-shoulder third person (pulled in so walls and hills never get in
 * the way), first person, a seated view for the gambling tables (the mouse moves a
 * cursor and the view leans gently towards it), a chase camera for vehicles, and a
 * cinematic mode the cutscene director drives directly.
 */
export class CameraRig {
  mode: CamMode = 'third';
  yaw = 0;
  pitch = -0.18;
  distance = 4.6;
  sensitivity = 1;
  invertY = false;
  private curDist = 4.6;
  private shoulder = 0.55;
  readonly target = new THREE.Vector3();
  /** Seated view: eye position and the yaw/pitch it looks at. */
  readonly seatEye = new THREE.Vector3();
  seatYaw = 0;
  seatPitch = -0.45;
  /** Extra look offset while seated (follows the cursor / right-drag). */
  private seatLook = { yaw: 0, pitch: 0 };
  /** Vehicle chase. */
  vehicleYaw = 0;
  vehicleSpeed = 0;
  private chaseYaw = 0;
  /** Cinematic: set by the director every frame. */
  readonly cinePos = new THREE.Vector3();
  readonly cineLook = new THREE.Vector3();
  cineFov = 55;
  shake = 0;
  /** A gun is drawn (tighter over-the-shoulder view) and how far you're aiming down the sights (0..1). */
  armed = false;
  aim = 0;
  aimFov = 50;
  private tmp = new THREE.Vector3();

  constructor(private cam: THREE.PerspectiveCamera) {}

  /** Mouse look (pointer lock or right-drag). */
  look(input: Input, enabled: boolean): void {
    if (!enabled) return;
    const s = 0.0024 * this.sensitivity;
    if (this.mode === 'seated') {
      // Right-drag looks around; the cursor alone leans the view a little.
      this.seatLook.yaw = clamp(this.seatLook.yaw - input.lookDX * s, -1.1, 1.1);
      this.seatLook.pitch = clamp(this.seatLook.pitch - input.lookDY * s * (this.invertY ? -1 : 1), -0.6, 0.7);
      return;
    }
    this.yaw -= input.lookDX * s;
    this.pitch = clamp(this.pitch - input.lookDY * s * (this.invertY ? -1 : 1), -1.35, this.mode === 'first' ? 1.35 : 0.9);
    if (input.wheel && this.mode === 'third') this.distance = clamp(this.distance + input.wheel * 0.6, 1.6, 10);
  }

  resetSeatLook(): void {
    this.seatLook.yaw = 0;
    this.seatLook.pitch = 0;
  }

  update(dt: number, world: World, focus: THREE.Vector3, eye: THREE.Vector3, defaultFov: number, cursor?: { x: number; y: number }): void {
    const cam = this.cam;
    let fov = defaultFov;
    switch (this.mode) {
      case 'first': {
        cam.position.copy(eye);
        cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        break;
      }
      case 'seated': {
        // The view leans towards the cursor so you can glance over the felt.
        let leanY = 0;
        let leanP = 0;
        if (cursor) {
          leanY = -(cursor.x - 0.5) * 0.35;
          leanP = -(cursor.y - 0.5) * 0.22;
        }
        cam.position.copy(this.seatEye);
        const yaw = this.seatYaw + this.seatLook.yaw + leanY;
        const pitch = this.seatPitch + this.seatLook.pitch + leanP;
        this.tmpEuler.set(pitch, yaw, 0, 'YXZ');
        this.tmpQ.setFromEuler(this.tmpEuler);
        cam.quaternion.slerp(this.tmpQ, 1 - Math.exp(-8 * dt));
        fov = defaultFov - 6;
        break;
      }
      case 'vehicle': {
        // Swing round behind the car; pull back and widen with speed.
        this.chaseYaw = dampAngleLocal(this.chaseYaw, this.vehicleYaw + Math.PI, 3.5, dt);
        const yaw = this.chaseYaw + this.yawOffset;
        const sp = Math.min(1, Math.abs(this.vehicleSpeed) / 45);
        const dist = this.distance * 1.45 + sp * 3;
        const h = 2.6 + sp * 0.6 - this.pitch * 3;
        this.target.copy(focus);
        this.tmp.set(focus.x + Math.sin(yaw) * dist, focus.y + h, focus.z + Math.cos(yaw) * dist);
        const gy = world.groundY(this.tmp.x, this.tmp.z) + 0.8;
        if (this.tmp.y < gy) this.tmp.y = gy;
        cam.position.lerp(this.tmp, 1 - Math.exp(-10 * dt));
        cam.lookAt(focus.x, focus.y + 1.2, focus.z);
        fov = defaultFov + sp * 12;
        this.yaw = yaw + Math.PI;
        break;
      }
      case 'cinematic': {
        cam.position.copy(this.cinePos);
        cam.lookAt(this.cineLook);
        fov = this.cineFov;
        break;
      }
      case 'free':
        break;
      default: {
        // Over the shoulder, pulled in when something is in the way.
        this.target.copy(focus);
        const cy = Math.cos(this.pitch);
        const back = this.tmp.set(Math.sin(this.yaw) * cy, -Math.sin(this.pitch), Math.cos(this.yaw) * cy);
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const baseDist = this.armed ? 2.7 - this.aim * 1.1 : this.distance;
        const shoulder = this.armed ? 0.72 : this.shoulder * Math.min(1, this.distance / 4);
        const pivot = new THREE.Vector3().copy(focus).addScaledVector(right, shoulder);
        let want = baseDist;
        const hit = world.collision.raycast(pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, want + 0.3);
        if (hit < want + 0.3) want = Math.max(0.6, hit - 0.35);
        // Terrain: march along the ray.
        for (let s = 0.5; s <= want; s += 0.5) {
          const px = pivot.x + back.x * s;
          const py = pivot.y + back.y * s;
          const pz = pivot.z + back.z * s;
          if (py < world.groundY(px, pz) + 0.35) {
            want = Math.max(0.6, s - 0.4);
            break;
          }
        }
        // Pull in fast, ease back out.
        this.curDist = want < this.curDist ? want : damp(this.curDist, want, 4, dt);
        cam.position.copy(pivot).addScaledVector(back, this.curDist);
        cam.lookAt(pivot.x - back.x, pivot.y - back.y, pivot.z - back.z);
      }
    }
    if ((this.mode === 'first' || this.mode === 'third') && this.aim > 0) fov += (this.aimFov - fov) * this.aim;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const a = this.shake * 0.06;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 6, dt);
      cam.updateProjectionMatrix();
    }
  }

  /** Extra yaw from looking around while driving. */
  yawOffset = 0;
  private tmpEuler = new THREE.Euler();
  private tmpQ = new THREE.Quaternion();
}

function dampAngleLocal(a: number, b: number, lambda: number, dt: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}
