import type { Game } from '../game/game';
import type { Director } from './director';
import { Actor, CAST } from './actors';

/**
 * The end of the story: sunset at Point Fortuna Lighthouse. Sal looks out over the island
 * you now half own, hands over the crown, and the bridge reopens.
 */
export async function playFinale(g: Game, d: Director): Promise<void> {
  const L = g.world.landmarks.lighthouse;
  const px = L.x;
  const pz = L.z + 22;
  const y = g.world.groundY(px, pz);
  g.hours = 19.2;
  d.black();
  const sal = new Actor(CAST.sal, g.renderer.scene, g.world);
  g.story.actors.push(sal);
  sal.place(px + 1.4, pz - 1.0, Math.PI);
  g.player.mode = 'scripted';
  g.player.anchor.set(px - 1.0, y, pz);
  g.player.anchorYaw = Math.PI / 2;
  g.player.poseOverride = 'idle';
  d.orbit([px, y + 1.5, pz], 9, 2.2, 0.4, 0.06, 45);
  await d.fade(false, 1.6);
  d.caption('POINT FORTUNA LIGHTHOUSE · SUNSET', 4);
  sal.lookAt(px - 1.0, pz).pose('talk').face('grin');
  await d.say('UNCLE SAL', 'Look at it, kid. Every light down there, a piece of it is yours now.', '#ff9f2e');
  await d.say('YOU', 'A year ago everything I owned fit in a glovebox.', '#3aa7ff');
  sal.pose('point').face('happy');
  await d.say('UNCLE SAL', 'And now you own the glovebox factory. Ha! Victor Vane left on the morning ferry, by the way. Couldn’t stand the competition.', '#ff9f2e');
  sal.pose('shrug').face('smirk');
  await d.say('UNCLE SAL', 'One more thing. They finished fixing Interstate 15. The bridge is open again. You can leave whenever you want.', '#ff9f2e');
  await d.say('YOU', 'Leave? I just got here.', '#3aa7ff');
  sal.pose('cheer').face('grin');
  await d.say('UNCLE SAL', 'That’s my nephew. The Island Kingpin!', '#ff9f2e');
  d.dolly([[px + 12, y + 6, pz + 12], [px, y + 2, pz]], [[px + 60, y + 60, pz + 90], [L.x, y + 30, L.z]], 8, 50);
  await d.wait(1);
  await d.title('ISLAND KINGPIN', 'THANKS FOR PLAYING · THE ISLAND IS YOURS', 5);
  await d.fade(true, 0.8);
  sal.remove();
  g.story.actors.splice(g.story.actors.indexOf(sal), 1);
  g.player.mode = 'walk';
  g.player.poseOverride = null;
  g.player.teleport(px - 1, y, pz + 2, Math.PI);
  g.world.bridge.setClosed(false);
  g.unlockSkin('kingpin');
  void d.fade(false, 1);
}
