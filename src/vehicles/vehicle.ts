import * as THREE from 'three';
import { buildVehicle, vehicleDef, type BuiltVehicle, type VehicleDef } from './models';
import type { World } from '../game/world';
import { clamp, dampAngle } from '../core/math';

export interface DriveInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

/**
 * A car (or the tank): the model plus an arcade driving model. It accelerates, brakes and
 * reverses, steers harder at low speed and gentler at high speed, slides when you yank the
 * handbrake (keeping momentum sideways, so you can drift), follows the ground's slope with
 * pitch and roll, and bounces off walls, trees and other cars.
 */
export class Vehicle {
  readonly root = new THREE.Group();
  readonly def: VehicleDef;
  readonly model: BuiltVehicle;
  /** Position on the ground (centre of the car). */
  readonly pos = new THREE.Vector3();
  /** Heading: forward is (sin h, cos h), like characters. */
  heading = 0;
  /** Forward and sideways speed (m/s). */
  speed = 0;
  side = 0;
  steer = 0;
  private wheelSpin = 0;
  private pitch = 0;
  private roll = 0;
  health = 100;
  /** Who's driving: the player, an NPC driver, or nobody. */
  driver: 'player' | 'npc' | null = null;
  /** Scripted (cutscene) control: position and heading are set from outside. */
  scripted = false;
  boost = 1;
  rpm = 0;
  skid = 0;
  lightsOn = false;
  readonly radius: number;
  private bodyOffsetY = 0;
  id: string;
  owned = false;
  color: number;

  constructor(defId: string, color?: number, id = `veh${Math.random().toString(36).slice(2, 8)}`) {
    this.def = vehicleDef(defId);
    this.color = color ?? this.def.color;
    this.model = buildVehicle(this.def, this.color);
    this.root.add(this.model.body);
    this.radius = Math.max(this.def.W, this.def.L) / 2;
    this.id = id;
  }

  /** Place the car on the ground facing `heading`. */
  place(x: number, z: number, heading: number, world: World): void {
    this.pos.set(x, world.groundY(x, z, 1e9), z);
    this.heading = heading;
    this.speed = this.side = 0;
    this.sync(0, world);
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  update(dt: number, input: DriveInput | null, world: World): number {
    let impact = 0;
    if (!this.scripted) {
      const d = this.def;
      const inp = input ?? { throttle: 0, steer: 0, handbrake: !this.driver, boost: false };
      const top = d.top * (inp.boost && this.boost > 0 ? 1.25 : 1);
      if (inp.boost && this.boost > 0 && inp.throttle > 0) this.boost = Math.max(0, this.boost - dt * 0.25);
      else this.boost = Math.min(1, this.boost + dt * 0.05);
      // Longitudinal: throttle, brakes, reverse, rolling resistance and drag.
      if (inp.throttle > 0) {
        if (this.speed < -0.5) this.speed += d.accel * 2.2 * dt;
        else this.speed += d.accel * inp.throttle * (1 - Math.max(0, this.speed) / top) * (inp.boost && this.boost > 0 ? 1.6 : 1) * dt;
      } else if (inp.throttle < 0) {
        if (this.speed > 0.5) this.speed -= d.accel * 2.4 * dt;
        else this.speed = Math.max(-top * 0.3, this.speed - d.accel * 0.6 * dt);
      } else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), (1.2 + Math.abs(this.speed) * 0.02) * dt);
      if (inp.handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 6 * dt);
      // Slopes: uphill slows you, downhill speeds you up.
      const ahead = world.groundY(this.pos.x + Math.sin(this.heading) * 2, this.pos.z + Math.cos(this.heading) * 2, this.pos.y + 1);
      const behind = world.groundY(this.pos.x - Math.sin(this.heading) * 2, this.pos.z - Math.cos(this.heading) * 2, this.pos.y + 1);
      this.speed -= ((ahead - behind) / 4) * 9.8 * dt;
      // Steering: sharper when slow, the tank turns on the spot.
      const spd = Math.abs(this.speed);
      const maxSteer = this.def.cls === 'tank' ? 0.9 : clamp(0.55 - spd * 0.006, 0.18, 0.55);
      this.steer += (inp.steer * maxSteer - this.steer) * Math.min(1, dt * 6);
      const turn = this.def.cls === 'tank' ? this.steer * 1.1 : (this.speed / (d.L * 0.62)) * Math.tan(this.steer);
      this.heading -= turn * dt;
      // Lateral slip: the handbrake lets the back step out; grip pulls it straight again.
      const grip = inp.handbrake ? 0.12 : d.grip;
      if (inp.handbrake && spd > 8) this.side += turn * this.speed * 0.25 * dt;
      this.side -= this.side * Math.min(1, grip * 6 * dt);
      this.skid = clamp(Math.abs(this.side) / 6 + (inp.handbrake && spd > 5 ? 0.5 : 0), 0, 1);
      // Move.
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const rx = -fz;
      const rz = fx;
      const nx = this.pos.x + (fx * this.speed + rx * this.side) * dt;
      const nz = this.pos.z + (fz * this.speed + rz * this.side) * dt;
      // Collide with the world: three circles along the car.
      const r = d.W * 0.5;
      let hit = false;
      const p = { x: nx, z: nz };
      for (const k of [-0.3, 0, 0.3]) {
        const cx = p.x + fx * d.L * k;
        const cz = p.z + fz * d.L * k;
        const q = { x: cx, z: cz };
        if (world.collision.resolve(q, r, this.pos.y + 0.3, 1.2, `veh:${this.id}`)) {
          hit = true;
          p.x += q.x - cx;
          p.z += q.z - cz;
        }
      }
      if (hit) {
        impact = Math.abs(this.speed);
        this.speed *= -0.25;
        this.side *= 0.3;
      }
      // Don't drive into deep water or off the edge of the world.
      const gy = world.groundY(p.x, p.z, this.pos.y + 1.2);
      if (gy < -1.6 && this.pos.y > -1) {
        this.speed *= 0.2;
        p.x = this.pos.x;
        p.z = this.pos.z;
      }
      this.pos.x = p.x;
      this.pos.z = p.z;
      this.rpm = clamp(Math.abs(this.speed) / d.top, 0, 1);
    }
    this.sync(dt, world);
    return impact;
  }

  /** Follow the ground: height, pitch and roll from the wheels; update the model. */
  sync(dt: number, world: World): void {
    const d = this.def;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const hl = d.L * 0.32;
    const hw = d.W * 0.4;
    const from = this.pos.y + 1.5;
    const gF = world.groundY(this.pos.x + fx * hl, this.pos.z + fz * hl, from);
    const gB = world.groundY(this.pos.x - fx * hl, this.pos.z - fz * hl, from);
    // Left of the heading is (fz, -fx); right is (-fz, fx).
    const gL = world.groundY(this.pos.x + fz * hw, this.pos.z - fx * hw, from);
    const gR = world.groundY(this.pos.x - fz * hw, this.pos.z + fx * hw, from);
    const target = Math.max((gF + gB + gL + gR) / 4, Math.min(gF, gB, gL, gR));
    if (this.scripted) this.pos.y = target;
    else this.pos.y += (target - this.pos.y) * Math.min(1, dt * 12 + 0.2);
    const tp = Math.atan2(gF - gB, hl * 2);
    const tr = Math.atan2(gL - gR, hw * 2);
    const k = Math.min(1, dt * 8 + (this.scripted ? 1 : 0));
    this.pitch += (tp - this.pitch) * k;
    this.roll += (tr - this.roll) * k;
    // Body sway: lean out of corners, squat on throttle.
    const lean = clamp(-this.steer * this.speed * 0.004, -0.07, 0.07);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, 0, 0);
    // rotation.y = heading - π/2 puts the model's +x along the heading.
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = this.heading - Math.PI / 2;
    this.root.rotation.z = this.pitch;
    this.root.rotation.x = this.roll + lean;
    this.model.body.position.y = this.bodyOffsetY;
    // Wheels: spin with the distance covered, the front pair steers.
    this.wheelSpin -= (this.speed * dt) / d.wheelR;
    // Rear pair first in the list, then the front pair (which steers).
    this.model.wheels.forEach((w, i) => {
      w.children[0].rotation.z = this.wheelSpin;
      if (i >= 2 && this.def.cls !== "tank") w.rotation.y = -this.steer;
    });
  }

  /** World position of a seat (0 = driver). */
  seatWorld(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.model.seatsLocal[Math.min(i, this.model.seatsLocal.length - 1)];
    out.copy(s);
    this.root.updateMatrixWorld(true);
    return this.root.localToWorld(out);
  }

  /** Where you get out (beside the driver's door). */
  exitPoint(): THREE.Vector3 {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // The driver sits on the car's left (local -z, which is world "left of heading").
    const lx = fz;
    const lz = -fx;
    return new THREE.Vector3(this.pos.x + lx * (this.def.W / 2 + 0.8), this.pos.y, this.pos.z + lz * (this.def.W / 2 + 0.8));
  }

  /** Aim the tank turret (world yaw) and barrel pitch. */
  aimTurret(yaw: number, pitch: number, dt: number): void {
    const t = this.model.turret;
    if (!t) return;
    const local = yaw - this.heading;
    t.rotation.y = dampAngle(t.rotation.y, local, 3, dt);
    if (this.model.barrel) this.model.barrel.rotation.z = clamp(pitch, -0.1, 0.35);
  }
}
