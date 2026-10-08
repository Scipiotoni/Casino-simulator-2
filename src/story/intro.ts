import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Director } from './director';
import { BRIDGE, deckY } from '../world/bridge';
import { tweens } from '../core/tween';

/**
 * The only cutscene: you drive onto Jackpot Island over the Interstate 15 bridge at sunset,
 * pass under the welcome arch, roll off the bridge into the city and park outside your new
 * flat. No dialogue, just the drive. A skip (Esc) lands you in the same place.
 */
export async function playIntro(g: Game, d: Director): Promise<void> {
  const z = BRIDGE.z - 3.5; // westbound lane
  const flat = g.flat;
  g.hours = 19.05;
  // Your car, scripted for the cutscene; it's yours afterwards.
  const car = g.vehicles.spawn('hatch', 6700, z, -Math.PI / 2, { color: 0x4fc3f7, id: 'starter', owned: true });
  car.scripted = true;
  g.vehicles.driving = car;
  g.player.mode = 'driving';
  g.player.poseOverride = 'drive';
  g.player.setVisible(true);

  const drive = (x0: number, x1: number, seconds: number, e: (t: number) => number = (t) => t) => {
    car.speed = Math.abs(x1 - x0) / seconds;
    return tweens.run(seconds, (k) => {
      car.pos.x = x0 + (x1 - x0) * e(k);
      car.pos.z = z;
    }, (t) => t, 'cine');
  };
  const at = (x: number) => {
    car.pos.set(x, deckY(x), z);
    car.heading = -Math.PI / 2;
    car.sync(1, g.world);
  };

  d.black();
  at(6650);
  d.cut([6450, 70, 250], [4600, 40, -300], 52);
  await d.wait(0.4);
  void d.fade(false, 2.2);
  d.caption('INTERSTATE 15 · 7:04 PM', 5);
  // Shot 1: wide and high, the bridge and the island skyline with the sun going down.
  void drive(6650, 6350, 7);
  await d.dolly([[6480, 75, 260], [4400, 60, -300]], [[6330, 45, 120], [3300, 60, -300]], 7, 48);
  // Shot 2: alongside the car on the main span, cables flicking past.
  at(5400);
  d.track(car.root, [4, 1.6, 9], [0, 1.0, 0], 46);
  void drive(5400, 5060, 9);
  await d.wait(6);
  // Shot 3: low in front, the car coming at us with the pylon above.
  at(4700);
  d.cut([4420, deckY(4420) + 0.8, z + 1.6], [4700, deckY(4700) + 1.2, z], 44);
  void drive(4700, 4460, 8);
  await d.wait(5.5);
  // Shot 4: under the welcome arch, panning as the car goes by.
  at(4010);
  d.pan([BRIDGE.x0 + 140, deckY(BRIDGE.x0 + 140) + 1.2, z + 6], car.root, [0, 1, 0], 50);
  await drive(4010, 3720, 7);
  // Shot 5: off the bridge and into the city, braking to a stop outside Palm Court.
  const stopX = flat.parking.x;
  const lane = flat.parking.z;
  d.track(car.root, [-9, 3.2, -2.5], [6, 0.8, 0], 50, 3);
  car.speed = 14;
  await tweens.run(6, (k) => {
    const e = 1 - Math.pow(1 - k, 2);
    car.pos.x = 3720 + (stopX - 3720) * e;
    car.pos.z = z + (lane - z) * Math.min(1, Math.max(0, (k - 0.55) / 0.45));
    car.pos.y = g.world.groundY(car.pos.x, car.pos.z, car.pos.y + 2);
    car.speed = 14 * (1 - k);
  }, (t) => t, 'cine');
  car.speed = 0;
  // Title over the skyline.
  d.dolly([[stopX + 14, 8, lane + 10], [stopX - 20, 10, lane - 30]], [[stopX + 60, 90, lane + 120], [2600, 60, -500]], 7, 52);
  await d.wait(0.6);
  await d.title('CASINO SIMULATOR 2', 'JACKPOT ISLAND', 4.2);
  await d.fade(true, 0.8);
  // End state (also what a skip leaves you with): parked outside your flat, standing at the door.
  tweens.finish('cine');
  car.scripted = false;
  car.place(flat.parking.x, flat.parking.z, flat.parking.heading, g.world);
  car.speed = 0;
  g.vehicles.driving = null;
  car.driver = null;
  g.vehicles.parked(car);
  g.player.mode = 'walk';
  g.player.poseOverride = null;
  const p = new THREE.Vector3(flat.door.x + Math.sin(flat.yaw) * 1.5, 0, flat.door.z + Math.cos(flat.yaw) * 1.5);
  g.player.teleport(p.x, g.world.groundY(p.x, p.z, flat.floorY + 1), p.z, flat.yaw + Math.PI);
  g.camera.yaw = flat.yaw;
  g.camera.pitch = -0.15;
  g.hours = Math.max(g.hours, 19.4);
  void d.fade(false, 1.0);
}
