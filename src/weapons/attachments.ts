import type { OpticMount, StatKey, Thread, WeaponClass, WeaponDef } from './catalog';

/**
 * The attachments that fit more than one weapon: optics, muzzle devices, underbarrel grips
 * and bipods, lasers and lights, all from made-up makers, plus the cosmetic side: camos,
 * charms, optic reticles and the HUD crosshair. Each attachment's model is its own file
 * (tools/blender/build_guns.py, `att_<id>`); see docs/weapons.md.
 */

export type GenericSlot = 'optic' | 'muzzle' | 'underbarrel' | 'laser';

export interface Attachment {
  id: string;
  slot: GenericSlot;
  name: string;
  brand: string;
  /** What it's modelled on (for the model makers). */
  basedOn: string;
  blurb: string;
  price: number;
  /** Stat changes as fractions (+0.1 = 10% more). */
  mods: Partial<Record<StatKey, number>>;
  /** Optic: which mounts it fits, its magnification, whether you pick a reticle for it, thermal view. */
  mounts?: OpticMount[];
  zoom?: number;
  reticle?: boolean;
  thermal?: boolean;
  /** Muzzle: which threads it screws onto; suppressors hide you from the map and quiet the shot. */
  threads?: Thread[];
  suppressor?: boolean;
  /** Only for these classes (e.g. big scopes on snipers and marksman rifles). */
  classes?: WeaponClass[];
  /** Laser colour (lasers), or a torch. */
  beam?: number;
  light?: boolean;
}

const ALL_GUNS: WeaponClass[] = ['pistol', 'smg', 'rifle', 'marksman', 'sniper', 'shotgun', 'lmg', 'launcher', 'special'];
const LONG: WeaponClass[] = ['rifle', 'marksman', 'sniper', 'lmg'];

export const ATTACHMENTS: Attachment[] = [
  // ---- Optics.
  { id: 'microdot', slot: 'optic', name: 'Corvid Micro RMR', brand: 'Corvid Optics', basedOn: 'Trijicon RMR pistol red dot', blurb: 'A tiny red dot for pistol slides.', price: 1200, mounts: ['pistol', 'rail'], zoom: 1, reticle: true, classes: ['pistol'], mods: { adsTime: 0.04, hipSpread: -0.05 } },
  { id: 'reddot', slot: 'optic', name: 'Corvid Mini Dot', brand: 'Corvid Optics', basedOn: 'Aimpoint Micro T-2 red dot', blurb: 'A small tube red dot. Clear and quick.', price: 1600, mounts: ['rail'], zoom: 1.1, reticle: true, mods: { adsTime: 0.03 } },
  { id: 'reflex', slot: 'optic', name: 'Halcyon Open Reflex', brand: 'Halcyon', basedOn: 'Holosun 507 / open reflex sight', blurb: 'An open window with a dot in it. The quickest optic.', price: 1400, mounts: ['rail'], zoom: 1, reticle: true, mods: { adsTime: 0.01 } },
  { id: 'holo', slot: 'optic', name: 'Halcyon Holo-X', brand: 'Halcyon', basedOn: 'EOTech EXPS3 holographic sight', blurb: 'The boxy holographic sight with the ring.', price: 2200, mounts: ['rail'], zoom: 1.2, reticle: true, mods: { adsTime: 0.05 } },
  { id: 'acog', slot: 'optic', name: 'Tidewater 4x Combat', brand: 'Tidewater', basedOn: 'Trijicon ACOG TA31 4x32', blurb: 'A rugged 4x scope with a lit chevron.', price: 3800, mounts: ['rail'], zoom: 4, reticle: true, classes: ['smg', 'rifle', 'marksman', 'lmg', 'shotgun', 'launcher'], mods: { adsTime: 0.14, move: -0.01 } },
  { id: 'lpvo', slot: 'optic', name: 'Vanta 1-6 Variable', brand: 'Vanta', basedOn: 'Vortex Razor 1-6x LPVO', blurb: 'A low-power variable scope set at 3x.', price: 4600, mounts: ['rail'], zoom: 3, reticle: true, classes: LONG, mods: { adsTime: 0.12, move: -0.01 } },
  { id: 'scope8', slot: 'optic', name: 'Longreach 8x', brand: 'Longreach', basedOn: 'Leupold Mark 4 8x scope', blurb: 'A proper hunting scope. Glints in the sun.', price: 5200, mounts: ['rail'], zoom: 8, reticle: true, classes: ['marksman', 'sniper'], mods: { adsTime: 0.2, move: -0.02 } },
  { id: 'scope12', slot: 'optic', name: 'Longreach 12x Precision', brand: 'Longreach', basedOn: 'Schmidt & Bender PM II 5-25x (at 12x)', blurb: 'For the very long shot.', price: 7800, mounts: ['rail'], zoom: 12, reticle: true, classes: ['sniper'], mods: { adsTime: 0.28, move: -0.03 } },
  { id: 'thermal', slot: 'optic', name: 'Ember Thermal', brand: 'Ember Systems', basedOn: 'FLIR thermal weapon sight', blurb: 'Shows warm bodies white-hot. 3x.', price: 9800, mounts: ['rail'], zoom: 3, thermal: true, classes: ['rifle', 'marksman', 'sniper', 'lmg', 'smg'], mods: { adsTime: 0.22, move: -0.02 } },
  { id: 'canted', slot: 'optic', name: 'Kestrel Prism 2x', brand: 'Kestrel', basedOn: 'Vortex Spitfire 3x prism', blurb: 'A compact prism sight at 2x.', price: 2900, mounts: ['rail'], zoom: 2, reticle: true, classes: ['smg', 'rifle', 'marksman', 'lmg', 'shotgun', 'launcher'], mods: { adsTime: 0.08 } },

  // ---- Muzzle devices.
  { id: 'supp9', slot: 'muzzle', name: 'Hush 9 Suppressor', brand: 'Silent Mile', basedOn: 'SilencerCo Osprey 9', blurb: 'Quiet 9 mm: off the minimap, no flash.', price: 2400, threads: ['pistol', 'smg'], suppressor: true, mods: { range: -0.08, recoilV: -0.05, adsTime: 0.05 } },
  { id: 'suppPistol', slot: 'muzzle', name: 'Ghost Can Mini', brand: 'Silent Mile', basedOn: 'SilencerCo Omega 9K compact suppressor', blurb: 'A short can for pistols: quiet, barely any weight.', price: 1800, threads: ['pistol'], suppressor: true, classes: ['pistol'], mods: { range: -0.05, adsTime: 0.02 } },
  { id: 'supp556', slot: 'muzzle', name: 'Whisper Monocore', brand: 'Silent Mile', basedOn: 'SureFire SOCOM556-RC2', blurb: 'A rifle can: quiet, steadier, slower to aim.', price: 3200, threads: ['556'], suppressor: true, mods: { range: 0.05, recoilV: -0.1, adsTime: 0.08, move: -0.02 } },
  { id: 'supp762', slot: 'muzzle', name: 'Specter 762', brand: 'Silent Mile', basedOn: 'SilencerCo Omega 300 / AAC 762-SD', blurb: 'A big can for big rifles.', price: 3800, threads: ['762'], suppressor: true, mods: { range: 0.05, recoilV: -0.12, adsTime: 0.1, move: -0.02 } },
  { id: 'supp50', slot: 'muzzle', name: 'Titan .50 Can', brand: 'Silent Mile', basedOn: 'Barrett QDL .50 suppressor', blurb: 'A suppressor as big as a pistol.', price: 6000, threads: ['50'], suppressor: true, mods: { recoilV: -0.15, adsTime: 0.12, move: -0.03 } },
  { id: 'oilcan', slot: 'muzzle', name: 'Garage Oil-Filter Can', brand: 'Eddie’s Garage', basedOn: 'Solvent-trap / oil filter suppressor', blurb: 'An oil filter on a thread adapter. Suppressed, technically.', price: 600, threads: ['pistol', 'smg', '556'], suppressor: true, mods: { range: -0.15, hipSpread: 0.08, adsTime: 0.06 } },
  { id: 'comp', slot: 'muzzle', name: 'Ridgeback Compensator', brand: 'Ridgeback Arms', basedOn: 'SilencerCo ASR / JP Bullet Buster compensator', blurb: 'Ports on top push the muzzle down: less climb.', price: 1400, threads: ['pistol', 'smg', '556', '762'], mods: { recoilV: -0.2, recoilH: 0.1 } },
  { id: 'flash', slot: 'muzzle', name: 'Birdcage Flash Hider', brand: 'Ridgeback Arms', basedOn: 'A2 birdcage flash hider', blurb: 'Hides the flash, steadies side-to-side kick.', price: 900, threads: ['smg', '556', '762'], mods: { recoilH: -0.2 } },
  { id: 'brake', slot: 'muzzle', name: 'Kalinov Tanker Brake', brand: 'Kalinov', basedOn: 'Muzzle brake (AK-74 / tanker style)', blurb: 'A big brake: much less kick, very loud.', price: 1800, threads: ['556', '762', '50'], mods: { recoilV: -0.25, recoilH: -0.15, adsTime: 0.04 } },
  { id: 'choke', slot: 'muzzle', name: 'Tight Choke', brand: 'Benedetti', basedOn: 'Extended full choke tube', blurb: 'Tighter spread: reaches further.', price: 1000, threads: ['shotgun'], mods: { hipSpread: -0.25, adsSpread: -0.3, range: 0.25 } },
  { id: 'duckbill', slot: 'muzzle', name: 'Duckbill Spreader', brand: 'Benedetti', basedOn: 'Duckbill shotgun choke', blurb: 'Spreads pellets sideways: a flat wide fan.', price: 1100, threads: ['shotgun'], mods: { hipSpread: 0.2, recoilV: -0.1, range: -0.1 } },
  { id: 'breacher', slot: 'muzzle', name: 'Breacher Muzzle', brand: 'Remmick', basedOn: 'Stand-off breaching muzzle', blurb: 'Spiky. Less kick close up.', price: 1200, threads: ['shotgun'], mods: { recoilV: -0.15, move: 0.02 } },

  // ---- Underbarrel.
  { id: 'vgrip', slot: 'underbarrel', name: 'Kestrel Vertical Grip', brand: 'Kestrel', basedOn: 'Magpul RVG vertical foregrip', blurb: 'A vertical grip: much less vertical kick.', price: 1200, mods: { recoilV: -0.15, adsTime: 0.04 } },
  { id: 'agrip', slot: 'underbarrel', name: 'Kestrel Angled Grip', brand: 'Kestrel', basedOn: 'Magpul AFG angled foregrip', blurb: 'An angled grip: quicker to aim.', price: 1200, mods: { adsTime: -0.08, recoilV: -0.05 } },
  { id: 'stubby', slot: 'underbarrel', name: 'Stubby Grip', brand: 'Vanta', basedOn: 'Short stubby vertical grip', blurb: 'A short grip: steadier from the hip.', price: 900, mods: { hipSpread: -0.15, recoilH: -0.1 } },
  { id: 'handstop', slot: 'underbarrel', name: 'Handstop', brand: 'Ridgeback Arms', basedOn: 'Magpul M-LOK handstop', blurb: 'A small stop for the hand: tiny bit steadier, no weight.', price: 600, mods: { recoilH: -0.08, move: 0.01 } },
  { id: 'bipod', slot: 'underbarrel', name: 'Harrow Bipod', brand: 'Harrow', basedOn: 'Harris S-BRM bipod (folded)', blurb: 'Folding legs. Steadiest when crouched behind cover.', price: 1800, classes: LONG, mods: { recoilV: -0.2, recoilH: -0.2, adsTime: 0.1, move: -0.03 } },
  { id: 'light', slot: 'underbarrel', name: 'Lumen Weapon Light', brand: 'Lumen', basedOn: 'SureFire M600 Scout light', blurb: 'A bright torch under the barrel.', price: 1000, light: true, mods: { hipSpread: -0.05 } },

  // ---- Lasers (side rail).
  { id: 'laserRed', slot: 'laser', name: 'Redline Laser', brand: 'Lumen', basedOn: 'Crimson Trace red laser module', blurb: 'A red beam: tighter hip fire.', price: 1500, beam: 0xff2a2a, mods: { hipSpread: -0.2 } },
  { id: 'laserGreen', slot: 'laser', name: 'Greenline Laser', brand: 'Lumen', basedOn: 'Steiner DBAL green laser', blurb: 'A brighter green beam: tighter hip fire, quicker sprint-out.', price: 2400, beam: 0x2aff6a, mods: { hipSpread: -0.25, adsTime: -0.02 } },
  { id: 'laserIr', slot: 'laser', name: 'PEQ Combo', brand: 'Lumen', basedOn: 'L3 PEQ-15 laser and light box', blurb: 'Laser and light in one box.', price: 3200, beam: 0xff2a2a, light: true, mods: { hipSpread: -0.22, recoilH: -0.05, adsTime: 0.03 } },
];

// ------------------------------------------------------------------ cosmetics

export interface Camo {
  id: string;
  name: string;
  price: number;
  /** How the paint looks (the game draws these as procedural textures). */
  pattern: 'solid' | 'woodland' | 'tiger' | 'digital' | 'arctic' | 'carbon' | 'hex' | 'damascus' | 'gold' | 'diamond' | 'darkmatter' | 'cards' | 'chips' | 'neon' | 'flames';
  colors: number[];
  /** Earned, not bought: knockouts with the weapon needed. */
  kills?: number;
}

export const CAMOS: Camo[] = [
  { id: 'factory', name: 'Factory', price: 0, pattern: 'solid', colors: [] },
  { id: 'woodland', name: 'Woodland', price: 800, pattern: 'woodland', colors: [0x4a5a2a, 0x2a3018, 0x7a6a3a, 0x15180c] },
  { id: 'desert', name: 'Desert Tiger', price: 800, pattern: 'tiger', colors: [0xc8a86a, 0x8a6a3a, 0x5a4020] },
  { id: 'urban', name: 'Urban Digital', price: 900, pattern: 'digital', colors: [0x6a6e74, 0x3a3e44, 0x9aa0a8, 0x1a1c20] },
  { id: 'arctic', name: 'Arctic', price: 900, pattern: 'arctic', colors: [0xf0f4f8, 0xb8c4d0, 0x6a7a8a] },
  { id: 'redtiger', name: 'Red Tiger', price: 1500, pattern: 'tiger', colors: [0xc81e1e, 0x2a0a0a, 0xff6a3a] },
  { id: 'carbon', name: 'Carbon Fibre', price: 1800, pattern: 'carbon', colors: [0x1a1a1e, 0x3a3a40] },
  { id: 'hex', name: 'Hex Grid', price: 1800, pattern: 'hex', colors: [0x2a3a4a, 0x4fd0ff] },
  { id: 'neon', name: 'Neon Strip', price: 2500, pattern: 'neon', colors: [0x1a0a2a, 0xff3ad0, 0x3affff] },
  { id: 'flames', name: 'Hot Rod Flames', price: 2500, pattern: 'flames', colors: [0x15151a, 0xff6a1a, 0xffd23d] },
  { id: 'cards', name: 'Royal Flush', price: 3000, pattern: 'cards', colors: [0x0a3a1a, 0xf4f4f4, 0xc81e1e, 0x15151a] },
  { id: 'chips', name: 'High Roller', price: 3500, pattern: 'chips', colors: [0x6a0a1a, 0xf2c230, 0xf4f4f4] },
  { id: 'damascus', name: 'Damascus', price: 0, pattern: 'damascus', colors: [0x5a5a60, 0x9a9aa0, 0x2a2a30], kills: 50 },
  { id: 'gold', name: 'Gold', price: 0, pattern: 'gold', colors: [0xf2c230, 0xffe58a, 0x8a6a10], kills: 100 },
  { id: 'diamond', name: 'Diamond', price: 0, pattern: 'diamond', colors: [0xbfefff, 0xffffff, 0x7ad0ff], kills: 200 },
  { id: 'darkmatter', name: 'Dark Matter', price: 0, pattern: 'darkmatter', colors: [0x0a0a1a, 0x6a2aff, 0xff3ad0], kills: 350 },
];

export interface Charm {
  id: string;
  name: string;
  price: number;
}

/** Little things hanging off the gun (models `charm_<id>`). */
export const CHARMS: Charm[] = [
  { id: 'none', name: 'No charm', price: 0 },
  { id: 'dice', name: 'Fuzzy Dice', price: 400 },
  { id: 'chip', name: 'Lucky Chip', price: 500 },
  { id: 'palm', name: 'Little Palm', price: 400 },
  { id: 'horseshoe', name: 'Horseshoe', price: 500 },
  { id: 'duck', name: 'Rubber Duck', price: 600 },
  { id: 'slot', name: 'Mini Slot Machine', price: 900 },
  { id: 'skull', name: 'Chrome Skull', price: 700 },
];

/** Reticles you can pick for an optic that has one, and their colours. */
export const RETICLES = ['dot', 'circleDot', 'chevron', 'cross', 'ring', 'spade', 'triangle', 'mil'] as const;
export type Reticle = (typeof RETICLES)[number];
export const RETICLE_COLORS = [0xff2a2a, 0x2aff6a, 0x2ad0ff, 0xffd23d, 0xff3ad0, 0xffffff];

/** The HUD crosshair (one choice for all weapons). */
export const CROSSHAIRS = ['classic', 'dot', 'circle', 'cross', 'tee', 'chevron', 'none'] as const;
export type Crosshair = (typeof CROSSHAIRS)[number];
export const CROSSHAIR_COLORS = [0xffffff, 0x2aff6a, 0xffd23d, 0x2ad0ff, 0xff3ad0, 0xff2a2a];

export function attachment(id: string): Attachment | undefined {
  return ATTACHMENTS.find((a) => a.id === id);
}

/** Does a generic attachment fit a weapon? */
export function fits(a: Attachment, w: WeaponDef): boolean {
  if (a.classes && !a.classes.includes(w.cls)) return false;
  switch (a.slot) {
    case 'optic':
      return w.optic !== 'none' && !!a.mounts?.includes(w.optic);
    case 'muzzle':
      return w.thread !== 'none' && !w.integralSuppressor && !!a.threads?.includes(w.thread);
    case 'underbarrel':
      return w.underRail;
    case 'laser':
      return w.sideRail;
  }
}

/** Every generic attachment that fits a weapon, by slot. */
export function compatible(w: WeaponDef, slot: GenericSlot): Attachment[] {
  return ATTACHMENTS.filter((a) => a.slot === slot && fits(a, w));
}

export { ALL_GUNS };
