import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Director } from './director';
import { Actor, CAST } from './actors';
import { BRIDGE, deckY } from '../world/bridge';
import { tweens } from '../core/tween';
import { audio } from '../core/audio';

/**
 * The opening: you drive onto Jackpot Island over the Interstate 15 bridge at sunset with
 * everything you own in a tired little hatchback. It gives up right at the end of the
 * bridge, the bridge closes behind you for repairs, and Uncle Sal turns up in his old
 * pickup to hand you the keys.
 */
export async function playIntro(g: Game, d: Director): Promise<void> {
  const z = BRIDGE.z - 3.5; // westbound lane
  g.hours = 19.05;
  g.world.bridge.setClosed(false);
  // Your car, scripted for the cutscene.
  const car = g.vehicles.spawn('hatch', 6700, z, -Math.PI / 2, { color: 0x8aa39a, id: 'oldhatch' });
  car.scripted = true;
  g.vehicles.driving = car;
  g.player.mode = 'driving';
  g.player.poseOverride = 'drive';
  g.player.setVisible(true);
  const sal = new Actor(CAST.sal, g.renderer.scene, g.world);
  sal.place(3560, z - 10, Math.PI / 2);
  sal.model.root.visible = false;
  const pickup = g.vehicles.spawn('pickup', 3520, z - 7, Math.PI / 2, { id: 'salpickup' });
  pickup.scripted = true;
  pickup.root.visible = false;
  g.story.actors.push(sal);

  const drive = (x0: number, x1: number, seconds: number) => {
    car.speed = Math.abs(x1 - x0) / seconds;
    return tweens.run(seconds, (k) => {
      car.pos.x = x0 + (x1 - x0) * k;
      car.pos.z = z;
    }, (t) => t, 'cine');
  };
  const at = (x: number) => {
    car.pos.set(x, deckY(x), z);
    car.sync(1, g.world);
  };

  d.black();
  at(6650);
  d.cut([6450, 70, 250], [4600, 40, -300], 52);
  await d.wait(0.4);
  void d.fade(false, 2.2);
  d.caption('INTERSTATE 15 · LEAVING THE MAINLAND · 7:04 PM', 5);
  // Shot 1: wide and high, the bridge and the island skyline with the sun going down.
  void drive(6650, 6350, 7);
  await d.dolly([[6480, 75, 260], [4400, 60, -300]], [[6330, 45, 120], [3300, 60, -300]], 7, 48);
  // Shot 2: alongside the car on the main span, cables flicking past.
  at(5400);
  d.track(car.root, [4, 1.6, 9], [0, 1.0, 0], 46);
  void drive(5400, 5060, 12);
  await d.wait(1.2);
  audio.play('ping');
  await d.say('UNCLE SAL', 'Kid! You on the bridge yet? Tell me you made it to the bridge.', '#ff9f2e');
  await d.say('YOU', "I'm on it, Uncle Sal. The desert strip's in the mirror, Jackpot Island dead ahead. Everything I own is in this car.", '#3aa7ff');
  await d.say('UNCLE SAL', 'Everything you own fits in that glovebox. Good! That means there\'s nowhere to go but up.', '#ff9f2e');
  await d.say('UNCLE SAL', "This island, nobody cares where you came from. Everybody starts with nothing. What you build is what you're worth.", '#ff9f2e');
  // Shot 3: in front, low, the car coming at us with the pylon above.
  at(4700);
  d.cut([4420, deckY(4420) + 0.8, z + 1.6], [4700, deckY(4700) + 1.2, z], 44);
  void drive(4700, 4460, 9);
  await d.wait(3.2);
  await d.say('UNCLE SAL', "I'll meet you at the end of the bridge. Don't stop for anything!", '#ff9f2e', 2600);
  // Shot 4: under the welcome arch.
  at(4010);
  d.pan([BRIDGE.x0 + 140, deckY(BRIDGE.x0 + 140) + 1.2, z + 6], car.root, [0, 1, 0], 50);
  const arrive = drive(4010, 3700, 9);
  await d.wait(6.5);
  // The car coughs and dies.
  audio.play('backfire');
  car.speed = 0;
  tweens.finish('cine');
  await arrive;
  at(3700);
  await d.wait(0.6);
  audio.play('backfire');
  d.cut([3712, deckY(3712) + 2.2, z + 7], [3700, deckY(3700) + 0.8, z], 46);
  await d.say('YOU', 'No, no, no… come on. Not now.', '#3aa7ff');
  // The player climbs out.
  g.vehicles.driving = null;
  g.player.mode = 'scripted';
  g.player.poseOverride = 'facepalm';
  const out = car.exitPoint();
  g.player.anchor.set(out.x, g.world.groundY(out.x, out.z, out.y + 1), out.z);
  g.player.anchorYaw = Math.PI;
  await d.wait(1.6);
  // Behind you, the bridge closes.
  g.world.bridge.setClosed(true);
  d.cut([3790, deckY(3790) + 3.5, z - 9], [4300, deckY(4300) + 1, z], 48);
  await d.say('RADIO', 'Island traffic: Interstate 15 is now closed in both directions for urgent bridge repairs. No word on when it will reopen.', '#9fe8ff', 3800);
  // Sal pulls up in his pickup.
  pickup.root.visible = true;
  pickup.pos.set(3420, g.world.groundY(3420, z - 7), z - 7);
  pickup.heading = Math.PI / 2;
  pickup.speed = 12;
  d.cut([3660, deckY(3660) + 1.6, z + 6], [3600, 7, z - 6], 50);
  await tweens.run(3.2, (k) => {
    pickup.pos.x = 3420 + 176 * (1 - Math.pow(1 - k, 2));
  }, (t) => t, 'cine');
  pickup.speed = 0;
  audio.play('honk');
  sal.model.root.visible = true;
  sal.place(pickup.pos.x - 1.2, pickup.pos.z + 1.6, Math.PI / 2);
  g.player.poseOverride = 'idle';
  g.player.anchorYaw = -Math.PI / 2;
  d.track(sal.model.root, [1.8, 1.7, 3.2], [0, 1.5, 0], 42, 3);
  await sal.walkTo(out.x - 2.2, out.z - 0.4, 1.6);
  sal.lookAt(out.x, out.z).pose('talk').face('grin');
  await d.say('UNCLE SAL', "Well look at that. The prodigal nephew! And the car didn't even make it off the bridge. Classic.", '#ff9f2e');
  await d.say('YOU', 'And now the bridge is closed. I guess I live here now.', '#3aa7ff');
  sal.pose('shrug').face('smirk');
  await d.say('UNCLE SAL', "Everybody lives here now, kid. Welcome to Jackpot Island. Here, take the keys to my old pickup. She's ugly, but she runs.", '#ff9f2e');
  sal.pose('point').face('happy');
  await d.say('UNCLE SAL', "Meet me at my bar, the Driftwood Tavern, down in Coral Cove on the south coast. Follow Route 1. I'll grab a cab.", '#ff9f2e');
  // Title over the skyline.
  d.dolly([[3600, 40, -200], [2600, 60, -400]], [[3450, 120, -80], [2300, 50, -500]], 7, 55);
  await d.wait(0.8);
  await d.title('CASINO SIMULATOR 2', 'JACKPOT ISLAND', 4.2);
  await d.fade(true, 0.8);
  // End state (also what a skip leaves you with).
  tweens.finish('cine');
  sal.remove();
  g.story.actors.splice(g.story.actors.indexOf(sal), 1);
  g.world.bridge.setClosed(true);
  car.scripted = true;
  car.place(3700, z, -Math.PI / 2, g.world);
  car.speed = 0;
  pickup.scripted = false;
  pickup.root.visible = true;
  pickup.owned = true;
  pickup.place(3600, z - 7, -Math.PI / 2, g.world);
  pickup.speed = 0;
  g.vehicles.parked(car);
  g.vehicles.parked(pickup);
  g.vehicles.driving = null;
  g.player.mode = 'walk';
  g.player.poseOverride = null;
  const p = new THREE.Vector3(3612, 0, z - 4);
  g.player.teleport(p.x, g.world.groundY(p.x, p.z, 50), p.z, -Math.PI / 2);
  g.camera.yaw = Math.PI / 2;
  g.camera.pitch = -0.15;
  g.hours = Math.max(g.hours, 19.4);
  void d.fade(false, 1.0);
}
