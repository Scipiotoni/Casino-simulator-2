/**
 * Every weapon in the game, as data: what it is (after the real gun it's modelled on, under a
 * made-up maker), how it fires, its base stats, and which attachments it takes. Pure data with
 * no three.js, so the gunsmith maths is unit-tested. The models come from Blender
 * (tools/blender/build_guns.py, one file per weapon); see docs/weapons.md for the contract.
 */

export type WeaponClass = 'pistol' | 'smg' | 'rifle' | 'marksman' | 'sniper' | 'shotgun' | 'lmg' | 'launcher' | 'special';

/** How the trigger works: semi, full auto, three-round burst, pump or bolt (cycle between shots), single (reload after each shot). */
export type FireMode = 'semi' | 'auto' | 'burst' | 'pump' | 'bolt' | 'single';

/** How the projectile behaves: an instant bullet, a rocket that flies, a lobbed grenade. */
export type Projectile = 'hitscan' | 'rocket' | 'homing' | 'grenade';

/** What kind of reload animation it plays (the animation system keys off this and the parts it has). */
export type ReloadStyle =
  | 'mag' // magazine out, new one in, charge or slide release
  | 'magBelt' // LMG: top cover up, belt box swapped, cover shut
  | 'tube' // shotgun: shells one at a time into the tube
  | 'cylinder' // revolver: swing out, eject, speed loader, swing in
  | 'break' // break-action: open, two shells, close
  | 'rocket' // muzzle-loaded rocket (RPG)
  | 'tubeSwap' // disposable tube: throw away, draw a new one
  | 'pod' // quad launcher: pull the clip, push a new four-pack
  | 'drum' // revolving grenade launcher: open, spin the cylinder loading six
  | 'boxFeed'; // minigun: belt box swap

/** Stat keys the gunsmith shows and attachments change. */
export interface WeaponStats {
  /** Damage per bullet/pellet (or per rocket at the centre of the blast). */
  damage: number;
  pellets: number;
  /** Shots per second. */
  rate: number;
  mag: number;
  /** Seconds for a full reload (tube/cylinder: per round × rounds). */
  reload: number;
  /** Metres at full damage; it falls off to 60% by `range` × 2. */
  range: number;
  /** Spread in radians from the hip, and aimed down sights. */
  hipSpread: number;
  adsSpread: number;
  /** Camera kick per shot: up, and side to side (radians). */
  recoilV: number;
  recoilH: number;
  /** Seconds to aim down sights. */
  adsTime: number;
  /** Walking speed multiplier while carrying it. */
  move: number;
  /** Blast radius in metres (explosives only). */
  splash: number;
  /** Projectile speed m/s (rockets and grenades). */
  velocity: number;
  /** Seconds a minigun needs to spin up before it fires. */
  spinUp: number;
}

export type StatKey = keyof WeaponStats;

/** Which way is better, for the gunsmith's green/red bars. */
export const BETTER_HIGH: Record<StatKey, boolean> = {
  damage: true, pellets: true, rate: true, mag: true, reload: false, range: true, hipSpread: false, adsSpread: false,
  recoilV: false, recoilH: false, adsTime: false, move: true, splash: true, velocity: true, spinUp: false,
};

/** Optic mounts: a Picatinny rail, a pistol slide cut, or nothing (iron or built-in sights only). */
export type OpticMount = 'rail' | 'pistol' | 'none';
/** Muzzle threads (which suppressors and brakes screw on). */
export type Thread = 'pistol' | 'smg' | '556' | '762' | '50' | 'shotgun' | 'none';

/** A weapon-specific part (barrel, magazine, stock): a model of its own, named `<weapon>_<slot>_<id>`. */
export interface Variant {
  id: string;
  name: string;
  /** Changes to the base stats, as fractions (+0.1 = 10% more), except `mag` which sets the size. */
  mods: Partial<Record<StatKey, number>>;
  /** Sets the magazine size (magazines only). */
  mag?: number;
  price: number;
  blurb: string;
  /** Changes how it fires (a stock that makes a pistol burst-fire). */
  fire?: FireMode;
  burst?: number;
  /** A built-in suppressor (an SD barrel): the muzzle slot closes. */
  suppressor?: boolean;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** The made-up maker. */
  brand: string;
  cls: WeaponClass;
  /** What it's modelled on (for the model makers, not shown in the game). */
  basedOn: string;
  blurb: string;
  price: number;
  /** Only from Fort Hammerhead's armory. */
  secret?: boolean;
  fire: FireMode;
  /** Rounds per burst (burst fire). */
  burst?: number;
  projectile: Projectile;
  reloadStyle: ReloadStyle;
  /** How it's held: one hand, two hands at the shoulder, on the shoulder (launchers), at the hip (minigun). */
  hold: 'pistol' | 'rifle' | 'shoulder' | 'hip';
  stats: WeaponStats;
  /** Field of view aimed down the iron (or built-in) sights. */
  adsFov: number;
  /** Which attachments fit. */
  optic: OpticMount;
  thread: Thread;
  /** Has a rail under the barrel (grips, bipods) and on the side (lasers, lights). */
  underRail: boolean;
  sideRail: boolean;
  /** Weapon-specific parts; the first of each list is what it comes with. Empty = not swappable. */
  barrels: Variant[];
  mags: Variant[];
  stocks: Variant[];
  /** Built-in suppressor (no muzzle slot even if threaded). */
  integralSuppressor?: boolean;
  /** Its own sight is magnified (sniper's fixed scope, RPG's optic): zoom when no optic is fitted. */
  builtInZoom?: number;
  /** The sound it makes. */
  sound: 'pistol' | 'heavyPistol' | 'smg' | 'rifle' | 'heavyRifle' | 'sniper' | 'shotgun' | 'lmg' | 'minigun' | 'rocket' | 'grenade';
}

// ------------------------------------------------------------------ helpers for the data

const S = (s: Partial<WeaponStats> & Pick<WeaponStats, 'damage' | 'rate' | 'mag' | 'reload' | 'range' | 'hipSpread' | 'recoilV'>): WeaponStats => ({
  pellets: 1, adsSpread: s.hipSpread * 0.25, recoilH: s.recoilV * 0.35, adsTime: 0.25, move: 1, splash: 0, velocity: 0, spinUp: 0, ...s,
});

const V = (id: string, name: string, price: number, blurb: string, mods: Variant['mods'], mag?: number): Variant => ({ id, name, price, blurb, mods, mag });

const stdBarrel = (name = 'Factory barrel') => V('std', name, 0, 'What it comes with.', {});
const stdMag = (n: number, name = 'Standard magazine') => V('std', name, 0, `${n} rounds.`, {}, n);
const stdStock = (name = 'Factory stock') => V('std', name, 0, 'What it comes with.', {});

/** The usual barrel trio: short (handier, less range), standard, long (range and control, slower). */
function barrels(short: string, long: string, heavy?: string): Variant[] {
  const out = [
    stdBarrel(),
    V('short', short, 900, 'Shorter and lighter: quicker to aim and move with, less range.', { range: -0.2, adsTime: -0.12, move: 0.04, recoilV: 0.08, hipSpread: -0.1 }),
    V('long', long, 1400, 'Longer: more range and steadier, slower to aim.', { range: 0.3, adsTime: 0.1, move: -0.03, recoilV: -0.08, damage: 0.05 }),
  ];
  if (heavy) out.push(V('heavy', heavy, 2200, 'Heavy profile: the least recoil, the slowest handling.', { recoilV: -0.2, recoilH: -0.2, range: 0.15, adsTime: 0.18, move: -0.06 }));
  return out;
}

/** Magazines: standard, extended, and a drum or a fast-change clamp. */
function mags(std: number, ext: number, opts: { drum?: number; fast?: boolean } = {}): Variant[] {
  const out = [stdMag(std), V('ext', 'Extended magazine', 1100, `${ext} rounds, a little slower to reload.`, { reload: 0.12, adsTime: 0.04 }, ext)];
  if (opts.drum) out.push(V('drum', 'Drum magazine', 2600, `${opts.drum} rounds. Heavy: slow to reload and to aim.`, { reload: 0.35, adsTime: 0.1, move: -0.04 }, opts.drum));
  if (opts.fast) out.push(V('fast', 'Fast mag clamp', 1500, `Two ${std}-round mags clamped together: much quicker reloads.`, { reload: -0.3, adsTime: 0.03 }, std));
  return out;
}

/** Stocks: standard, none or folded (fast, kicks), heavy or precision (steady, slow), light. */
function stocks(opts: { none?: string; heavy?: string; light?: string } = {}): Variant[] {
  const out = [stdStock()];
  if (opts.none) out.push(V('none', opts.none, 600, 'No stock: aims and moves fastest, kicks the hardest.', { adsTime: -0.2, move: 0.05, recoilV: 0.3, recoilH: 0.3, adsSpread: 0.3 }));
  if (opts.light) out.push(V('light', opts.light, 1200, 'Skeletonised: quicker handling, a bit more kick.', { adsTime: -0.1, move: 0.03, recoilV: 0.1 }));
  if (opts.heavy) out.push(V('heavy', opts.heavy, 1600, 'Padded and weighted: much steadier, slower to aim.', { recoilV: -0.18, recoilH: -0.15, adsTime: 0.12, move: -0.03 }));
  return out;
}

// ------------------------------------------------------------------ the weapons

export const WEAPONS: WeaponDef[] = [
  // ---- Pistols.
  {
    id: 'pistol', name: 'Grendel 19', brand: 'Grendel', cls: 'pistol', basedOn: 'Glock 19 (Gen 5)', blurb: 'The polymer 9 mm everyone starts with. Light, quick, reliable.',
    price: 1500, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'pistol',
    stats: S({ damage: 26, rate: 4, mag: 15, reload: 1.1, range: 30, hipSpread: 0.025, recoilV: 0.022, adsTime: 0.14, move: 1.05 }), adsFov: 54,
    optic: 'pistol', thread: 'pistol', underRail: false, sideRail: true,
    barrels: [stdBarrel(), V('comp', 'Ported compensator slide', 1200, 'Ports in the slide keep the muzzle down.', { recoilV: -0.2, hipSpread: -0.05 }), V('long', 'Long slide (G34 style)', 1300, 'Longer sight radius: more range, slower to aim.', { range: 0.25, adsTime: 0.08, damage: 0.05 })],
    mags: [stdMag(15), V('ext', 'Extended magazine', 900, '24 rounds.', { reload: 0.1 }, 24), V('drum', '50-round drum', 2400, 'A 50-round drum. Silly, heavy, fun.', { reload: 0.4, adsTime: 0.12, move: -0.03 }, 50)],
    stocks: [V('std', 'No stock', 0, 'Just the pistol.', {}), V('brace', 'Carbine conversion kit', 2500, 'A stock and a long frame: rifle steady, slower to draw and aim.', { recoilV: -0.35, recoilH: -0.3, adsSpread: -0.3, adsTime: 0.15, range: 0.2, move: -0.03 })],
  },
  {
    id: 'm1911', name: 'Liberty 1911', brand: 'Liberty Arms', cls: 'pistol', basedOn: 'Colt M1911A1 .45 ACP', blurb: 'A hundred years old and still hits like a truck. Seven .45 rounds.',
    price: 2800, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'heavyPistol',
    stats: S({ damage: 36, rate: 3, mag: 7, reload: 1.2, range: 32, hipSpread: 0.022, recoilV: 0.035, adsTime: 0.15, move: 1.04 }), adsFov: 54,
    optic: 'pistol', thread: 'pistol', underRail: false, sideRail: true,
    barrels: [stdBarrel(), V('long', 'Long slide (Government)', 1200, 'Five-inch slide: more range.', { range: 0.25, adsTime: 0.06 }), V('comp', 'Race compensator', 1500, 'A comp on the nose for fast follow-ups.', { recoilV: -0.25, rate: 0.1 })],
    mags: [stdMag(7), V('ext', 'Extended magazine', 900, '10 rounds.', { reload: 0.08 }, 10)],
    stocks: [],
  },
  {
    id: 'm9', name: 'Bernardi 92', brand: 'Bernardi', cls: 'pistol', basedOn: 'Beretta 92FS / M9', blurb: 'The open-slide Italian service pistol. Smooth and accurate.',
    price: 2200, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'pistol',
    stats: S({ damage: 27, rate: 3.6, mag: 15, reload: 1.15, range: 34, hipSpread: 0.02, recoilV: 0.02, adsTime: 0.15 }), adsFov: 54,
    optic: 'none', thread: 'pistol', underRail: false, sideRail: true,
    barrels: [stdBarrel(), V('long', 'Long barrel', 1100, 'More range.', { range: 0.25, adsTime: 0.06 })],
    mags: [stdMag(15), V('ext', 'Extended magazine', 900, '20 rounds.', { reload: 0.08 }, 20)],
    stocks: [V('std', 'No stock', 0, 'Just the pistol.', {}), { ...V('brace', 'Detachable stock (93R style)', 2200, 'Steadier, and it fires in three-round bursts.', { recoilV: -0.3, adsSpread: -0.25, adsTime: 0.12, rate: 2 }), fire: 'burst', burst: 3 }],
  },
  {
    id: 'fiveseven', name: 'Fabrik 5.7', brand: 'Fabrik Nationale', cls: 'pistol', basedOn: 'FN Five-seveN', blurb: 'Twenty small fast rounds. Almost no kick.',
    price: 3800, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'pistol',
    stats: S({ damage: 23, rate: 4.6, mag: 20, reload: 1.1, range: 36, hipSpread: 0.022, recoilV: 0.014, adsTime: 0.14, move: 1.05 }), adsFov: 54,
    optic: 'pistol', thread: 'pistol', underRail: false, sideRail: true,
    barrels: [], mags: [stdMag(20), V('ext', 'Extended magazine', 1000, '30 rounds.', { reload: 0.1 }, 30)], stocks: [],
  },
  {
    id: 'deagle', name: 'Desert Hawk .50', brand: 'Hawkline', cls: 'pistol', basedOn: 'IMI Desert Eagle Mark XIX .50 AE', blurb: 'A hand cannon. Seven .50 rounds, a two-hand grip and a lot of kick.',
    price: 7500, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'heavyPistol',
    stats: S({ damage: 62, rate: 1.8, mag: 7, reload: 1.5, range: 40, hipSpread: 0.03, recoilV: 0.075, adsTime: 0.2, move: 1.0 }), adsFov: 52,
    optic: 'rail', thread: 'pistol', underRail: false, sideRail: false,
    barrels: [stdBarrel('6-inch barrel'), V('long', '10-inch barrel', 1600, 'Huge: more range, slower.', { range: 0.35, adsTime: 0.1, recoilV: -0.1 })],
    mags: [stdMag(7), V('ext', 'Extended magazine', 1400, '10 rounds.', { reload: 0.1 }, 10)], stocks: [],
  },
  {
    id: 'revolver', name: 'Six-Shooter .44', brand: 'Thunder & Sons', cls: 'pistol', basedOn: 'Smith & Wesson Model 29 .44 Magnum', blurb: 'Loud, slow and accurate. A classic.',
    price: 4500, fire: 'semi', projectile: 'hitscan', reloadStyle: 'cylinder', hold: 'pistol', sound: 'heavyPistol',
    stats: S({ damage: 55, rate: 1.6, mag: 6, reload: 2.0, range: 42, hipSpread: 0.018, recoilV: 0.06, adsTime: 0.17 }), adsFov: 52,
    optic: 'pistol', thread: 'none', underRail: false, sideRail: false,
    barrels: [stdBarrel('6.5-inch barrel'), V('short', 'Snub nose', 900, 'Tiny: quick to draw and aim, less range.', { range: -0.3, adsTime: -0.2, move: 0.03, recoilV: 0.15 }), V('long', '8⅜-inch hunter', 1400, 'Long barrel: more range and damage.', { range: 0.35, damage: 0.1, adsTime: 0.1 })],
    mags: [], stocks: [],
  },
  {
    id: 'goldcannon', name: 'Golden Desert Hawk', brand: 'Hawkline', cls: 'pistol', basedOn: 'Gold-plated Desert Eagle .50 AE', blurb: 'Solid gold. Taken from Fort Hammerhead’s armory.',
    price: 0, secret: true, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'pistol', sound: 'heavyPistol',
    stats: S({ damage: 80, rate: 1.6, mag: 7, reload: 1.5, range: 45, hipSpread: 0.02, recoilV: 0.07, adsTime: 0.2 }), adsFov: 50,
    optic: 'rail', thread: 'pistol', underRail: false, sideRail: false,
    barrels: [], mags: [stdMag(7), V('ext', 'Extended magazine', 1400, '10 rounds.', { reload: 0.1 }, 10)], stocks: [],
  },

  // ---- Submachine guns.
  {
    id: 'smg', name: 'Kessler MP5', brand: 'Kessler', cls: 'smg', basedOn: 'Heckler & Koch MP5A3 (retractable stock)', blurb: 'The classic roller-locked 9 mm SMG. Smooth, accurate, controllable.',
    price: 12000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'smg',
    stats: S({ damage: 17, rate: 13, mag: 30, reload: 1.8, range: 28, hipSpread: 0.04, recoilV: 0.011, adsTime: 0.2, move: 1.03 }), adsFov: 54,
    optic: 'rail', thread: 'smg', underRail: true, sideRail: true,
    barrels: [stdBarrel(), { ...V('sd', 'Integral suppressor (SD)', 2800, 'A built-in suppressor: silent, less range.', { range: -0.15, recoilV: -0.1 }), suppressor: true }, V('short', 'Kurz barrel', 900, 'MP5K length: handier, less range.', { range: -0.25, adsTime: -0.15, move: 0.04, recoilV: 0.12 })],
    mags: mags(30, 40, { drum: 100 }),
    stocks: stocks({ none: 'Stock collapsed', heavy: 'Fixed A2 stock' }),
  },
  {
    id: 'uzi', name: 'Uzzi', brand: 'Galil Works', cls: 'smg', basedOn: 'IMI Uzi (folding stock)', blurb: 'The boxy Israeli classic. Mag in the grip, bolt on top.',
    price: 9500, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'smg',
    stats: S({ damage: 18, rate: 10, mag: 32, reload: 1.7, range: 24, hipSpread: 0.045, recoilV: 0.013, adsTime: 0.18, move: 1.04 }), adsFov: 56,
    optic: 'none', thread: 'smg', underRail: false, sideRail: false,
    barrels: [stdBarrel(), V('short', 'Mini Uzzi', 800, 'Smaller and faster-firing.', { rate: 0.3, range: -0.2, adsTime: -0.15, recoilV: 0.2 })],
    mags: mags(32, 50), stocks: stocks({ none: 'Stock folded' }),
  },
  {
    id: 'mp7', name: 'Kessler PDW7', brand: 'Kessler', cls: 'smg', basedOn: 'Heckler & Koch MP7A1', blurb: 'A tiny personal defence weapon that fires very fast, very small rounds.',
    price: 16000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'smg',
    stats: S({ damage: 15, rate: 15, mag: 30, reload: 1.6, range: 30, hipSpread: 0.035, recoilV: 0.009, adsTime: 0.17, move: 1.05 }), adsFov: 54,
    optic: 'rail', thread: 'smg', underRail: true, sideRail: true,
    barrels: [], mags: mags(30, 40), stocks: stocks({ none: 'Stock collapsed' }),
  },
  {
    id: 'vector', name: 'Kriss-Cross Vector', brand: 'Vectra', cls: 'smg', basedOn: 'KRISS Vector Gen II .45', blurb: 'Its bolt kicks down, not back: a torrent of .45 that barely climbs.',
    price: 22000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'smg',
    stats: S({ damage: 19, rate: 17, mag: 25, reload: 1.9, range: 22, hipSpread: 0.035, recoilV: 0.007, adsTime: 0.19 }), adsFov: 54,
    optic: 'rail', thread: 'smg', underRail: true, sideRail: true,
    barrels: barrels('SBR barrel', 'Carbine barrel'), mags: mags(25, 33, { fast: true }), stocks: stocks({ none: 'Stock folded', light: 'Skeleton stock' }),
  },
  {
    id: 'p90', name: 'Fabrik P-50', brand: 'Fabrik Nationale', cls: 'smg', basedOn: 'FN P90', blurb: 'A 50-round mag lying on top. Bullpup, ambidextrous, futuristic.',
    price: 19000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'smg',
    stats: S({ damage: 16, rate: 14, mag: 50, reload: 2.3, range: 28, hipSpread: 0.035, recoilV: 0.008, adsTime: 0.2 }), adsFov: 54,
    optic: 'rail', thread: 'smg', underRail: false, sideRail: true,
    barrels: [stdBarrel(), V('long', 'PS90 long barrel', 1300, 'Carbine length: more range.', { range: 0.3, adsTime: 0.08, move: -0.02 })],
    mags: [stdMag(50)], stocks: [],
  },

  // ---- Assault rifles.
  {
    id: 'rifle', name: 'Ridgeback M4', brand: 'Ridgeback Arms', cls: 'rifle', basedOn: 'Colt M4A1 carbine', blurb: 'The do-everything 5.56 carbine. Takes every attachment there is.',
    price: 26000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'rifle',
    stats: S({ damage: 24, rate: 8, mag: 30, reload: 2, range: 55, hipSpread: 0.045, recoilV: 0.014, adsTime: 0.24 }), adsFov: 50,
    optic: 'rail', thread: '556', underRail: true, sideRail: true,
    barrels: barrels('10.5" CQB barrel', '20" rifle barrel', '16" heavy barrel'), mags: mags(30, 45, { drum: 60, fast: true }),
    stocks: stocks({ none: 'No stock (pistol brace off)', heavy: 'Precision stock', light: 'Skeleton stock' }),
  },
  {
    id: 'ak47', name: 'Kalinov 47', brand: 'Kalinov', cls: 'rifle', basedOn: 'AKM / AK-47 (wood furniture)', blurb: 'Wood and stamped steel, 7.62 and a lot of kick. Never jams.',
    price: 24000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'heavyRifle',
    stats: S({ damage: 31, rate: 6.8, mag: 30, reload: 2.2, range: 50, hipSpread: 0.05, recoilV: 0.021, recoilH: 0.01, adsTime: 0.26 }), adsFov: 52,
    optic: 'rail', thread: '762', underRail: true, sideRail: false,
    barrels: barrels('Krinkov short barrel', 'RPK long barrel'), mags: mags(30, 40, { drum: 75, fast: true }),
    stocks: stocks({ none: 'Stock off', light: 'Underfolder (folded out)', heavy: 'Polymer tactical stock' }),
  },
  {
    id: 'scarh', name: 'Fabrik Scar-H', brand: 'Fabrik Nationale', cls: 'rifle', basedOn: 'FN SCAR 17S (FDE)', blurb: 'A 7.62 battle rifle in desert tan. Slow, hard-hitting, long-range.',
    price: 34000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'heavyRifle',
    stats: S({ damage: 36, rate: 5.6, mag: 20, reload: 2.2, range: 70, hipSpread: 0.05, recoilV: 0.024, adsTime: 0.28, move: 0.97 }), adsFov: 50,
    optic: 'rail', thread: '762', underRail: true, sideRail: true,
    barrels: barrels('13" CQC barrel', '20" sniper barrel'), mags: mags(20, 30), stocks: stocks({ none: 'Stock folded', heavy: 'Precision stock' }),
  },
  {
    id: 'aug', name: 'Steyrer AUX', brand: 'Steyrer', cls: 'rifle', basedOn: 'Steyr AUG A1 (built-in 1.5x optic)', blurb: 'A green bullpup with a scope cast into its handle. Long barrel, short gun.',
    price: 30000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'rifle',
    stats: S({ damage: 25, rate: 7.5, mag: 30, reload: 2.3, range: 62, hipSpread: 0.042, recoilV: 0.012, adsTime: 0.27 }), adsFov: 40, builtInZoom: 1.5,
    optic: 'none', thread: '556', underRail: false, sideRail: false,
    barrels: barrels('Carbine barrel', 'HBAR long barrel'), mags: mags(30, 42), stocks: [],
  },
  {
    id: 'g36c', name: 'Kessler G36C', brand: 'Kessler', cls: 'rifle', basedOn: 'Heckler & Koch G36C', blurb: 'Compact, light and polymer. A little rifle that handles like an SMG.',
    price: 23000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'rifle',
    stats: S({ damage: 22, rate: 9, mag: 30, reload: 1.9, range: 45, hipSpread: 0.04, recoilV: 0.013, adsTime: 0.21, move: 1.02 }), adsFov: 52,
    optic: 'rail', thread: '556', underRail: true, sideRail: true,
    barrels: [stdBarrel(), V('long', 'G36K barrel', 1200, 'Longer: more range.', { range: 0.25, adsTime: 0.08 })], mags: mags(30, 40, { drum: 100 }),
    stocks: stocks({ none: 'Stock folded' }),
  },
  {
    id: 'famas', name: 'Clairon F1', brand: 'Saint-Étienne', cls: 'rifle', basedOn: 'FAMAS F1', blurb: 'The French bugle: a bullpup with a carry handle that fires in fast bursts.',
    price: 25000, fire: 'burst', burst: 3, projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'rifle',
    stats: S({ damage: 24, rate: 14, mag: 25, reload: 2.2, range: 55, hipSpread: 0.04, recoilV: 0.011, adsTime: 0.26 }), adsFov: 50,
    optic: 'rail', thread: '556', underRail: false, sideRail: false,
    barrels: [], mags: mags(25, 30), stocks: [],
  },

  // ---- Marksman rifles.
  {
    id: 'm14', name: 'Patriot M14 EBR', brand: 'Liberty Arms', cls: 'marksman', basedOn: 'M14 Enhanced Battle Rifle (Sage chassis)', blurb: 'A 1950s battle rifle in a modern chassis. Semi-auto 7.62, hits hard far away.',
    price: 38000, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'heavyRifle',
    stats: S({ damage: 52, rate: 4, mag: 20, reload: 2.3, range: 110, hipSpread: 0.055, recoilV: 0.03, adsTime: 0.32, move: 0.96 }), adsFov: 46,
    optic: 'rail', thread: '762', underRail: true, sideRail: true,
    barrels: barrels('Socom short barrel', '22" match barrel'), mags: mags(20, 30), stocks: stocks({ heavy: 'Adjustable cheek riser' }),
  },
  {
    id: 'svd', name: 'Dragunova SVD', brand: 'Kalinov', cls: 'marksman', basedOn: 'Dragunov SVD (wood thumbhole stock, PSO-1 scope)', blurb: 'The long skeleton-stocked Soviet marksman rifle with its own 4x scope.',
    price: 42000, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'sniper',
    stats: S({ damage: 64, rate: 2.5, mag: 10, reload: 2.4, range: 140, hipSpread: 0.07, recoilV: 0.04, adsTime: 0.36, move: 0.95 }), adsFov: 20, builtInZoom: 4,
    optic: 'rail', thread: '762', underRail: false, sideRail: false,
    barrels: [], mags: mags(10, 20), stocks: stocks({ light: 'Polymer folding stock' }),
  },

  // ---- Sniper rifles.
  {
    id: 'sniper', name: 'Longbow 24', brand: 'Remmick', cls: 'sniper', basedOn: 'Remington M24 SWS (bolt action)', blurb: 'One shot, one knockout. Work the bolt between shots.',
    price: 48000, fire: 'bolt', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'sniper',
    stats: S({ damage: 110, rate: 0.9, mag: 5, reload: 2.6, range: 220, hipSpread: 0.09, adsSpread: 0, recoilV: 0.09, adsTime: 0.42, move: 0.93 }), adsFov: 14, builtInZoom: 8,
    optic: 'rail', thread: '762', underRail: true, sideRail: false,
    barrels: barrels('Short-action barrel', 'Long heavy barrel'), mags: mags(5, 10), stocks: stocks({ heavy: 'Precision chassis stock' }),
  },
  {
    id: 'awm', name: 'Arctic Warlord .338', brand: 'Accura', cls: 'sniper', basedOn: 'Accuracy International AWM .338 Lapua (green)', blurb: 'The big green bolt gun with the thumbhole stock and the muzzle brake.',
    price: 72000, fire: 'bolt', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'sniper',
    stats: S({ damage: 140, rate: 0.8, mag: 5, reload: 2.8, range: 260, hipSpread: 0.1, adsSpread: 0, recoilV: 0.1, adsTime: 0.45, move: 0.92 }), adsFov: 12, builtInZoom: 10,
    optic: 'rail', thread: '762', underRail: true, sideRail: false,
    barrels: barrels('20" barrel', '27" barrel'), mags: mags(5, 10), stocks: stocks({ light: 'Folding stock' }),
  },
  {
    id: 'barrett', name: 'Barrow M82 .50', brand: 'Barrow', cls: 'sniper', basedOn: 'Barrett M82A1 .50 BMG', blurb: 'A semi-automatic anti-materiel rifle. It goes through cars.',
    price: 110000, fire: 'semi', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'sniper',
    stats: S({ damage: 160, rate: 1.4, mag: 10, reload: 3.2, range: 300, hipSpread: 0.12, adsSpread: 0, recoilV: 0.13, recoilH: 0.03, adsTime: 0.55, move: 0.86 }), adsFov: 12, builtInZoom: 10,
    optic: 'rail', thread: '50', underRail: true, sideRail: false,
    barrels: [stdBarrel(), V('short', '20" M107 CQ barrel', 1800, 'Shorter: quicker to swing.', { range: -0.15, adsTime: -0.12, move: 0.03 })], mags: [stdMag(10)], stocks: [],
  },

  // ---- Shotguns.
  {
    id: 'shotgun', name: 'Ranchman 870', brand: 'Remmick', cls: 'shotgun', basedOn: 'Remington 870 pump (wood furniture)', blurb: 'Nine pellets in a wide cone. Rack the pump between shots.',
    price: 9000, fire: 'pump', projectile: 'hitscan', reloadStyle: 'tube', hold: 'rifle', sound: 'shotgun',
    stats: S({ damage: 18, pellets: 9, rate: 1.2, mag: 6, reload: 0.5, range: 12, hipSpread: 0.12, adsSpread: 0.09, recoilV: 0.08, adsTime: 0.24 }), adsFov: 58,
    optic: 'rail', thread: 'shotgun', underRail: true, sideRail: true,
    barrels: barrels('Breacher barrel', 'Long field barrel'), mags: [stdMag(6, 'Standard tube'), V('ext', 'Extended tube', 1000, '8 shells.', {}, 8)],
    stocks: stocks({ none: 'Pistol-grip only', heavy: 'Padded stock' }),
  },
  {
    id: 'benelli', name: 'Benedetti M4', brand: 'Benedetti', cls: 'shotgun', basedOn: 'Benelli M4 Super 90 (semi-auto)', blurb: 'A semi-automatic combat shotgun. As fast as you can pull.',
    price: 21000, fire: 'semi', projectile: 'hitscan', reloadStyle: 'tube', hold: 'rifle', sound: 'shotgun',
    stats: S({ damage: 16, pellets: 8, rate: 3.2, mag: 7, reload: 0.45, range: 12, hipSpread: 0.12, adsSpread: 0.09, recoilV: 0.07, adsTime: 0.25 }), adsFov: 58,
    optic: 'rail', thread: 'shotgun', underRail: true, sideRail: true,
    barrels: barrels('14" entry barrel', '24" barrel'), mags: [stdMag(7, 'Standard tube'), V('ext', 'Extended tube', 1100, '9 shells.', {}, 9)],
    stocks: stocks({ light: 'Collapsible stock' }),
  },
  {
    id: 'spas12', name: 'Franchetti SPAS', brand: 'Franchetti', cls: 'shotgun', basedOn: 'Franchi SPAS-12 (folding stock with hook)', blurb: 'The movie shotgun: heat shield, folding hook stock, pump action.',
    price: 16000, fire: 'pump', projectile: 'hitscan', reloadStyle: 'tube', hold: 'rifle', sound: 'shotgun',
    stats: S({ damage: 19, pellets: 9, rate: 1.4, mag: 8, reload: 0.5, range: 13, hipSpread: 0.12, adsSpread: 0.09, recoilV: 0.085, adsTime: 0.26, move: 0.98 }), adsFov: 58,
    optic: 'none', thread: 'shotgun', underRail: false, sideRail: false,
    barrels: [], mags: [stdMag(8, 'Standard tube')], stocks: stocks({ none: 'Stock folded' }),
  },
  {
    id: 'aa12', name: 'Auto Assault 12', brand: 'Atchison', cls: 'shotgun', basedOn: 'AA-12 full-auto shotgun (drum)', blurb: 'A fully automatic shotgun with a 20-round drum. Absurd.',
    price: 58000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'mag', hold: 'rifle', sound: 'shotgun',
    stats: S({ damage: 14, pellets: 8, rate: 5, mag: 8, reload: 2.4, range: 11, hipSpread: 0.13, adsSpread: 0.1, recoilV: 0.04, adsTime: 0.3, move: 0.95 }), adsFov: 58,
    optic: 'rail', thread: 'shotgun', underRail: true, sideRail: false,
    barrels: [], mags: [stdMag(8, '8-round box'), V('drum', '20-round drum', 3000, 'The famous drum.', { reload: 0.3, adsTime: 0.1, move: -0.04 }, 20), V('drum32', '32-round drum', 4500, 'Even more.', { reload: 0.45, adsTime: 0.15, move: -0.06 }, 32)],
    stocks: [],
  },
  {
    id: 'sawnoff', name: 'Lucky Double', brand: 'Thunder & Sons', cls: 'shotgun', basedOn: 'Sawn-off side-by-side double-barrel shotgun', blurb: 'Two barrels, two shells, one hand. Both barrels at once if you like.',
    price: 3500, fire: 'semi', projectile: 'hitscan', reloadStyle: 'break', hold: 'pistol', sound: 'shotgun',
    stats: S({ damage: 20, pellets: 10, rate: 4, mag: 2, reload: 1.6, range: 9, hipSpread: 0.15, adsSpread: 0.12, recoilV: 0.1, adsTime: 0.16, move: 1.03 }), adsFov: 60,
    optic: 'none', thread: 'none', underRail: false, sideRail: false,
    barrels: [V('std', 'Sawn-off barrels', 0, 'Short and wide.', {}), V('long', 'Full-length barrels', 1200, 'A proper side-by-side: tighter spread, two hands.', { hipSpread: -0.25, adsSpread: -0.3, range: 0.4, adsTime: 0.1 })],
    mags: [], stocks: [],
  },

  // ---- Light machine guns.
  {
    id: 'm249', name: 'Fabrik Minimi', brand: 'Fabrik Nationale', cls: 'lmg', basedOn: 'FN M249 SAW (box magazine, bipod)', blurb: 'A belt-fed 5.56 machine gun with a 100-round box. Lie down the fire.',
    price: 52000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'magBelt', hold: 'rifle', sound: 'lmg',
    stats: S({ damage: 24, rate: 12, mag: 100, reload: 4.6, range: 60, hipSpread: 0.07, recoilV: 0.013, recoilH: 0.008, adsTime: 0.45, move: 0.88 }), adsFov: 50,
    optic: 'rail', thread: '556', underRail: true, sideRail: true,
    barrels: barrels('Para short barrel', 'Long barrel'), mags: [stdMag(100, '100-round box'), V('ext', '200-round box', 3200, 'Twice the belt.', { reload: 0.2, move: -0.05, adsTime: 0.08 }, 200)],
    stocks: stocks({ none: 'Para stock collapsed' }),
  },
  {
    id: 'pkm', name: 'Kalinov PKM', brand: 'Kalinov', cls: 'lmg', basedOn: 'PKM general purpose machine gun', blurb: 'A 7.62 belt gun with a skeleton stock. Heavy and relentless.',
    price: 64000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'magBelt', hold: 'rifle', sound: 'lmg',
    stats: S({ damage: 30, rate: 10, mag: 100, reload: 5, range: 70, hipSpread: 0.08, recoilV: 0.017, recoilH: 0.01, adsTime: 0.5, move: 0.85 }), adsFov: 50,
    optic: 'rail', thread: '762', underRail: true, sideRail: false,
    barrels: [], mags: [stdMag(100, '100-round box'), V('ext', '200-round box', 3600, 'Twice the belt.', { reload: 0.2, move: -0.05, adsTime: 0.08 }, 200)], stocks: [],
  },

  // ---- Launchers and the minigun.
  {
    id: 'rpg7', name: 'RPG-7', brand: 'Kalinov', cls: 'launcher', basedOn: 'RPG-7 with PG-7V rocket and PGO-7 optic', blurb: 'The shoulder-fired rocket launcher everyone knows. One rocket, load it from the front.',
    price: 85000, fire: 'single', projectile: 'rocket', reloadStyle: 'rocket', hold: 'shoulder', sound: 'rocket',
    stats: S({ damage: 220, rate: 1, mag: 1, reload: 2.8, range: 300, hipSpread: 0.03, adsSpread: 0, recoilV: 0.06, adsTime: 0.5, move: 0.85, splash: 7, velocity: 70 }), adsFov: 30, builtInZoom: 2.7,
    optic: 'none', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [], stocks: [],
  },
  {
    id: 'at4', name: 'AT-4 Tube', brand: 'Bofors-Nord', cls: 'launcher', basedOn: 'AT4 disposable anti-tank launcher', blurb: 'A one-shot fibreglass tube: fire, drop it, sling another.',
    price: 60000, fire: 'single', projectile: 'rocket', reloadStyle: 'tubeSwap', hold: 'shoulder', sound: 'rocket',
    stats: S({ damage: 260, rate: 1, mag: 1, reload: 3.4, range: 300, hipSpread: 0.025, adsSpread: 0, recoilV: 0.05, adsTime: 0.45, move: 0.88, splash: 6, velocity: 95 }), adsFov: 40,
    optic: 'none', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [], stocks: [],
  },
  {
    id: 'm202', name: 'Flash Quad', brand: 'Liberty Arms', cls: 'launcher', basedOn: 'M202 FLASH four-tube rocket launcher', blurb: 'Four rockets in a box. Fire them as fast as you can pull.',
    price: 140000, fire: 'semi', projectile: 'rocket', reloadStyle: 'pod', hold: 'shoulder', sound: 'rocket',
    stats: S({ damage: 160, rate: 2.5, mag: 4, reload: 4, range: 250, hipSpread: 0.04, adsSpread: 0.01, recoilV: 0.05, adsTime: 0.5, move: 0.84, splash: 5.5, velocity: 65 }), adsFov: 40,
    optic: 'none', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [], stocks: [],
  },
  {
    id: 'homing', name: 'Seeker SAM', brand: 'Raymark', cls: 'launcher', basedOn: 'FIM-92 Stinger (lock-on missile)', blurb: 'Hold aim on a vehicle to lock on; the missile does the rest.',
    price: 180000, fire: 'single', projectile: 'homing', reloadStyle: 'rocket', hold: 'shoulder', sound: 'rocket',
    stats: S({ damage: 240, rate: 1, mag: 1, reload: 3.2, range: 400, hipSpread: 0.03, adsSpread: 0, recoilV: 0.04, adsTime: 0.55, move: 0.85, splash: 6, velocity: 60 }), adsFov: 36, builtInZoom: 2,
    optic: 'none', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [], stocks: [],
  },
  {
    id: 'm32', name: 'Six-Pack MGL', brand: 'Milkor-Vaal', cls: 'launcher', basedOn: 'Milkor M32 six-shot revolving grenade launcher', blurb: 'Six 40 mm grenades in a revolving cylinder. They arc, they bounce, they bang.',
    price: 95000, fire: 'semi', projectile: 'grenade', reloadStyle: 'drum', hold: 'rifle', sound: 'grenade',
    stats: S({ damage: 140, rate: 1.8, mag: 6, reload: 4.2, range: 120, hipSpread: 0.035, adsSpread: 0.01, recoilV: 0.05, adsTime: 0.4, move: 0.9, splash: 5, velocity: 40 }), adsFov: 46,
    optic: 'rail', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [],
    stocks: stocks({ none: 'Stock collapsed' }),
  },
  {
    id: 'minigun', name: 'Buzzsaw Minigun', brand: 'General Dynamo', cls: 'special', basedOn: 'M134 Minigun (six barrels, backpack ammo feed)', blurb: 'Six spinning barrels and 500 rounds. It needs a moment to spin up.',
    price: 250000, fire: 'auto', projectile: 'hitscan', reloadStyle: 'boxFeed', hold: 'hip', sound: 'minigun',
    stats: S({ damage: 20, rate: 40, mag: 500, reload: 5.5, range: 55, hipSpread: 0.06, adsSpread: 0.045, recoilV: 0.004, recoilH: 0.005, adsTime: 0.6, move: 0.7, spinUp: 0.7 }), adsFov: 58,
    optic: 'none', thread: 'none', underRail: false, sideRail: false, barrels: [], mags: [], stocks: [],
  },
];

export function weaponDef(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

export function isWeapon(id: string): boolean {
  return WEAPONS.some((w) => w.id === id);
}

export const CLASS_NAMES: Record<WeaponClass, string> = {
  pistol: 'Pistols', smg: 'Submachine guns', rifle: 'Assault rifles', marksman: 'Marksman rifles', sniper: 'Sniper rifles',
  shotgun: 'Shotguns', lmg: 'Machine guns', launcher: 'Launchers', special: 'Special',
};
