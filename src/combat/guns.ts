/**
 * Guns sold at Bullseye Guns (and the one you can lift from Fort Hammerhead's armory). Pure
 * data so the shop, the HUD and the shooting code agree.
 */

export interface GunDef {
  id: string;
  name: string;
  price: number;
  /** Shots per second. */
  rate: number;
  auto: boolean;
  mag: number;
  reload: number;
  pellets: number;
  /** Spread in radians (hip fire; halved when aiming). */
  spread: number;
  range: number;
  dmg: number;
  /** Aim-down-sights field of view. */
  adsFov: number;
  twoHand: boolean;
  color: number;
  /** View kick per shot (radians). */
  kick: number;
  /** Only from the armory. */
  secret?: boolean;
  blurb: string;
}

export const GUNS: GunDef[] = [
  { id: 'pistol', name: 'Bullseye 9', price: 1500, rate: 3.2, auto: false, mag: 12, reload: 1.1, pellets: 1, spread: 0.02, range: 60, dmg: 26, adsFov: 52, twoHand: false, color: 0x2b2b35, kick: 0.025, blurb: 'Light, quick, reliable. Everyone’s first gun.' },
  { id: 'revolver', name: 'Six-Shooter', price: 4500, rate: 1.6, auto: false, mag: 6, reload: 1.9, pellets: 1, spread: 0.01, range: 80, dmg: 55, adsFov: 48, twoHand: false, color: 0x9aa0ab, kick: 0.06, blurb: 'Loud, slow and accurate. A classic.' },
  { id: 'smg', name: 'Compact SMG', price: 12000, rate: 11, auto: true, mag: 32, reload: 1.6, pellets: 1, spread: 0.055, range: 50, dmg: 14, adsFov: 54, twoHand: false, color: 0x17151f, kick: 0.012, blurb: 'Thirty-two rounds in three seconds. Hold the trigger.' },
  { id: 'shotgun', name: 'Pump Shotgun', price: 9000, rate: 1.1, auto: false, mag: 6, reload: 2.4, pellets: 9, spread: 0.16, range: 28, dmg: 18, adsFov: 58, twoHand: true, color: 0x6b4422, kick: 0.08, blurb: 'Nine pellets in a wide cone. Devastating up close.' },
  { id: 'rifle', name: 'Assault Rifle', price: 26000, rate: 8, auto: true, mag: 30, reload: 2, pellets: 1, spread: 0.022, range: 110, dmg: 24, adsFov: 42, twoHand: true, color: 0x4a4f3a, kick: 0.016, blurb: 'Full auto, long range, steady aim.' },
  { id: 'sniper', name: 'Sniper Rifle', price: 48000, rate: 0.8, auto: false, mag: 5, reload: 2.6, pellets: 1, spread: 0.0, range: 260, dmg: 110, adsFov: 14, twoHand: true, color: 0x2a3a2a, kick: 0.09, blurb: 'One shot, one knockout.' },
  { id: 'goldcannon', name: 'Golden Hand Cannon', price: 0, rate: 1.5, auto: false, mag: 7, reload: 1.6, pellets: 1, spread: 0.008, range: 90, dmg: 80, adsFov: 46, twoHand: false, color: 0xf2b632, kick: 0.07, secret: true, blurb: 'Solid gold. Taken from Fort Hammerhead’s armory.' },
];

export function gunDef(id: string): GunDef {
  return GUNS.find((g) => g.id === id) ?? GUNS[0];
}
