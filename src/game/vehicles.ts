import * as THREE from 'three';
import { Vehicle, type DriveInput } from '../vehicles/vehicle';
import type { Game } from './game';
import { audio } from '../core/audio';

/**
 * Every car in the world that isn't traffic: your own cars, cars parked for the story,
 * and whatever you're driving. Handles getting in and out, the driving controls, the
 * chase camera and the engine sound.
 */
export class VehicleSystem {
  readonly list: Vehicle[] = [];
  driving: Vehicle | null = null;
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {}

  spawn(defId: string, x: number, z: number, heading: number, opts: { owned?: boolean; color?: number; id?: string } = {}): Vehicle {
    const v = new Vehicle(defId, opts.color, opts.id);
    v.owned = !!opts.owned;
    v.place(x, z, heading, this.game.world);
    this.game.renderer.scene.add(v.root);
    this.adopt(v);
    return v;
  }

  /** Take an existing car (e.g. one pulled out of traffic) into the system. */
  adopt(v: Vehicle): Vehicle {
    if (!this.list.includes(v)) this.list.push(v);
    if (!v.root.parent) this.game.renderer.scene.add(v.root);
    this.addBlocker(v);
    this.game.interactions.add({
      id: `car:${v.id}`,
      x: v.pos.x, y: v.pos.y, z: v.pos.z, radius: Math.max(2.4, v.def.L * 0.55),
      label: () => `Drive the ${v.def.name}`,
      sub: () => (v.owned ? 'Yours' : v.def.cls === 'police' ? 'Stealing a police car will cost you' : ''),
      enabled: () => !this.driving && !v.scripted && v.driver !== 'npc',
      action: () => this.enter(v),
      priority: -0.5,
    });
    return v;
  }

  /** After moving a parked car from outside (a cutscene, a respawn), refresh its blocker and prompt. */
  parked(v: Vehicle): void {
    this.addBlocker(v);
    this.game.interactions.move(`car:${v.id}`, v.pos.x, v.pos.y, v.pos.z);
  }

  remove(v: Vehicle): void {
    this.game.renderer.scene.remove(v.root);
    this.game.interactions.remove(`car:${v.id}`);
    this.game.world.collision.removeTagged(`veh:${v.id}`);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Parked cars block people walking (and other cars). */
  private addBlocker(v: Vehicle): void {
    const c = this.game.world.collision;
    c.removeTagged(`veh:${v.id}`);
    const fx = Math.sin(v.heading);
    const fz = Math.cos(v.heading);
    for (const k of [-0.32, 0, 0.32]) c.addCircle({ x: v.pos.x + fx * v.def.L * k, z: v.pos.z + fz * v.def.L * k, r: v.def.W * 0.48, minY: v.pos.y - 0.5, maxY: v.pos.y + v.def.roof, tag: `veh:${v.id}` });
  }

  enter(v: Vehicle): void {
    const g = this.game;
    if (this.driving) return;
    this.driving = v;
    v.driver = 'player';
    g.world.collision.removeTagged(`veh:${v.id}`);
    const p = g.player;
    p.mode = 'driving';
    p.poseOverride = 'drive';
    p.anim.pose = 'drive';
    g.camera.mode = p.firstPerson ? 'first' : 'vehicle';
    g.camera.vehicleYaw = v.heading;
    g.hud.setPrompt(null);
    audio.play('ignition');
    if (v.def.cls === 'police' && !v.owned) g.crime('stole a police car', 3);
  }

  exit(): void {
    const g = this.game;
    const v = this.driving;
    if (!v) return;
    if (Math.abs(v.speed) > 6) {
      g.hud.toast('Slow down to get out', 'bad');
      return;
    }
    v.speed = 0;
    v.driver = null;
    this.driving = null;
    audio.engine(null);
    const out = v.isBoat ? this.landing(v) : v.exitPoint();
    const p = g.player;
    p.mode = 'walk';
    p.poseOverride = null;
    p.setVisible(true);
    p.teleport(out.x, v.isBoat ? out.y : g.world.groundY(out.x, out.z, v.pos.y + 1), out.z, v.heading);
    g.camera.mode = p.firstPerson ? 'first' : 'third';
    g.camera.yaw = v.heading + Math.PI;
    this.addBlocker(v);
    g.interactions.move(`car:${v.id}`, v.pos.x, v.pos.y, v.pos.z);
  }

  /** Getting off a boat: onto the nearest pier, jetty or beach within a few steps, else into the water. */
  private landing(v: Vehicle): THREE.Vector3 {
    const w = this.game.world;
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (let r = v.def.W / 2 + 1; r <= v.def.W / 2 + 4.5; r += 1) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = v.pos.x + Math.sin(a) * r;
        const z = v.pos.z + Math.cos(a) * r;
        const y = w.groundY(x, z, 4);
        if (y < -0.2 || y > 4) continue;
        const q = { x, z };
        if (w.collision.resolve(q, 0.35, y + 0.1, 1.6)) continue;
        if (r < bestD) {
          bestD = r;
          best = new THREE.Vector3(x, y, z);
        }
      }
      if (best) break;
    }
    if (best) return best;
    // Nowhere to step: over the side and swim.
    const e = v.exitPoint();
    return e.set(e.x, -1.25, e.z);
  }

  readInput(): DriveInput {
    const inp = this.game.input;
    const ax = inp.moveAxes();
    return { throttle: ax.y, steer: ax.x, handbrake: inp.down('Space'), boost: inp.down('ShiftLeft') || inp.down('ShiftRight') };
  }

  update(dt: number, inputEnabled: boolean): void {
    const g = this.game;
    const v = this.driving;
    for (const car of this.list) {
      if (car === v) continue;
      if (!car.scripted && Math.abs(car.speed) > 0.05) {
        car.update(dt, null, g.world);
        if (Math.abs(car.speed) < 0.06) {
          this.addBlocker(car);
          g.interactions.move(`car:${car.id}`, car.pos.x, car.pos.y, car.pos.z);
        }
      } else if (car.scripted) car.sync(dt, g.world);
    }
    if (!v) return;
    const inp = g.input;
    if (inputEnabled && inp.pressed('KeyE')) {
      this.exit();
      return;
    }
    if (inputEnabled && inp.pressed('KeyV')) {
      g.player.firstPerson = !g.player.firstPerson;
      g.camera.mode = g.player.firstPerson ? 'first' : 'vehicle';
    }
    const impact = v.update(dt, inputEnabled ? this.readInput() : null, g.world);
    if (impact > 8) {
      audio.play('crash', { volume: Math.min(1, impact / 30) });
      g.camera.shake = Math.min(1, impact / 25);
      v.health = Math.max(0, v.health - impact * 0.4);
    }
    // Sit the player in the driver's seat.
    const p = g.player;
    const seat = v.seatWorld(0, this.tmp);
    p.pos.set(seat.x, seat.y - 0.2, seat.z);
    p.yaw = v.heading;
    p.anchor.copy(p.pos);
    g.camera.vehicleYaw = v.heading;
    g.camera.vehicleSpeed = v.speed;
    if (g.camera.mode === 'first') {
      // Cockpit view: from the driver's eyes, looking down the road.
      g.camera.yaw = v.heading + Math.PI;
    }
    audio.engine({ profile: v.def.engine, rpm: 0.15 + v.rpm * 0.85, throttle: Math.abs(this.readInput().throttle), skid: v.skid, speed: Math.abs(v.speed) });
  }

  /** Where the camera should focus while driving. */
  focus(out: THREE.Vector3): THREE.Vector3 {
    const v = this.driving!;
    return out.set(v.pos.x, v.pos.y + v.def.roof * 0.6, v.pos.z);
  }

  /** Cockpit eye position. */
  cockpitEye(out: THREE.Vector3): THREE.Vector3 {
    const v = this.driving!;
    out.copy(v.model.driverEye);
    v.root.updateMatrixWorld(true);
    return v.root.localToWorld(out);
  }
}
