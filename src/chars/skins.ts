/**
 * What a character looks like: body, face, hair and an outfit ("skin"). Outfits come from
 * a catalog with rarities, like a locker in a battle-royale game; you unlock them through
 * special deeds and buy them at the Drip Locker clothing store.
 */

export type BodyType = 'm' | 'f';
export type Hair = 'buzz' | 'short' | 'spiky' | 'quiff' | 'long' | 'ponytail' | 'bun' | 'afro' | 'mohawk' | 'bob' | 'bald' | 'braids';
export type Top = 'tee' | 'tank' | 'hoodie' | 'jacket' | 'suit' | 'hawaiian' | 'vest' | 'armor' | 'dress' | 'racing' | 'tux' | 'military' | 'coat';
export type Bottom = 'jeans' | 'cargo' | 'shorts' | 'slacks' | 'skirt' | 'camo';
export type Shoes = 'sneakers' | 'boots' | 'heels' | 'sandals' | 'loafers';
export type Hat = 'none' | 'cap' | 'beanie' | 'tophat' | 'cowboy' | 'helmet' | 'fedora' | 'visor' | 'beret' | 'crown' | 'headset' | 'bandana';
export type Glasses = 'none' | 'shades' | 'aviators' | 'visor' | 'round' | 'goggles';
export type Back = 'none' | 'backpack' | 'surfboard' | 'dice' | 'wings' | 'cape' | 'jetpack' | 'guitar' | 'chips';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface Outfit {
  top: Top;
  bottom: Bottom;
  shoes: Shoes;
  hat: Hat;
  glasses: Glasses;
  back: Back;
  /** Main colour, second colour, accent (trim, logos, glow). */
  c1: number;
  c2: number;
  accent: number;
  pants: number;
  shoe: number;
  gloves: boolean;
  /** Gold chain, bow tie, scarf, mask. */
  neck: 'none' | 'chain' | 'bowtie' | 'tie' | 'scarf' | 'mask';
  /** Accent pieces that glow (neon trims). */
  glow: boolean;
}

export interface Appearance {
  body: BodyType;
  skin: number;
  eyes: string;
  hair: Hair;
  hairColor: number;
  outfit: Outfit;
  /** The catalog skin this came from (or 'custom'). */
  skinId: string;
  /** Slightly taller / bulkier for variety. */
  height: number;
  build: number;
}

export const SKIN_TONES = [0xffe0c8, 0xf6cfaa, 0xe9b98c, 0xd59e6e, 0xb8804f, 0x99643b, 0x7a4a2b, 0x5a3520];
export const HAIR_COLORS = [0x1c1410, 0x3a2416, 0x6a3f22, 0xa86a34, 0xe0b25a, 0xf2dc9a, 0xc0392b, 0xe84393, 0x3a7bd5, 0x2ecc71, 0xeeeeee, 0x9b59b6];

export interface SkinDef {
  id: string;
  name: string;
  rarity: Rarity;
  desc: string;
  price: number;
  /** How you get it if it isn't for sale ('base' = the Fort Hammerhead armory). */
  unlock?: string;
  appearance: Omit<Appearance, 'skinId' | 'height' | 'build'>;
}

const o = (p: Partial<Outfit>): Outfit => ({
  top: 'tee', bottom: 'jeans', shoes: 'sneakers', hat: 'none', glasses: 'none', back: 'none',
  c1: 0xffffff, c2: 0x2a2a2a, accent: 0xffd23d, pants: 0x3a5fa0, shoe: 0xf2f2f2, gloves: false, neck: 'none', glow: false,
  ...p,
});

export const SKINS: SkinDef[] = [
  {
    id: 'rookie', name: 'Rookie', rarity: 'common', price: 0, desc: 'Fresh off the bridge with empty pockets.',
    appearance: { body: 'm', skin: SKIN_TONES[2], eyes: 'brown', hair: 'short', hairColor: HAIR_COLORS[1], outfit: o({ top: 'tee', c1: 0xf4f4f4, accent: 0x1e6bff, pants: 0x35588f }) },
  },
  {
    id: 'rookieF', name: 'Rookie', rarity: 'common', price: 0, desc: 'Fresh off the bridge with empty pockets.',
    appearance: { body: 'f', skin: SKIN_TONES[1], eyes: 'green', hair: 'ponytail', hairColor: HAIR_COLORS[3], outfit: o({ top: 'tee', c1: 0xff6b8a, accent: 0xffffff, pants: 0x35588f }) },
  },
  {
    id: 'tourist', name: 'Island Tourist', rarity: 'common', price: 1500, desc: 'Loud shirt, louder sunburn.',
    appearance: { body: 'm', skin: SKIN_TONES[0], eyes: 'blue', hair: 'quiff', hairColor: HAIR_COLORS[4], outfit: o({ top: 'hawaiian', bottom: 'shorts', shoes: 'sandals', glasses: 'shades', c1: 0x1fb5c8, c2: 0xff7a3d, accent: 0xffe14d, pants: 0xe8d6a8, shoe: 0x8a5a3a }) },
  },
  {
    id: 'croupier', name: 'The Croupier', rarity: 'uncommon', price: 4000, desc: 'Place your bets. No more bets.',
    appearance: { body: 'f', skin: SKIN_TONES[3], eyes: 'hazel', hair: 'bun', hairColor: HAIR_COLORS[0], outfit: o({ top: 'vest', bottom: 'slacks', shoes: 'loafers', c1: 0xffffff, c2: 0x1a1a1f, accent: 0xb8202f, pants: 0x1a1a1f, shoe: 0x111111, neck: 'bowtie' }) },
  },
  {
    id: 'beachbum', name: 'Beach Bum', rarity: 'uncommon', price: 6000, desc: 'Board under the arm, sand in everything.',
    appearance: { body: 'm', skin: SKIN_TONES[4], eyes: 'brown', hair: 'long', hairColor: HAIR_COLORS[5], outfit: o({ top: 'tank', bottom: 'shorts', shoes: 'sandals', back: 'surfboard', c1: 0xffd23d, accent: 0x1fb5c8, pants: 0x1f8fc8, shoe: 0x2a2a2a }) },
  },
  {
    id: 'racer', name: 'Street Racer', rarity: 'rare', price: 15000, desc: 'Lives a quarter mile at a time.',
    appearance: { body: 'm', skin: SKIN_TONES[5], eyes: 'amber', hair: 'spiky', hairColor: HAIR_COLORS[0], outfit: o({ top: 'racing', bottom: 'cargo', shoes: 'sneakers', gloves: true, c1: 0xe3262f, c2: 0xffffff, accent: 0x111111, pants: 0x2b2b30, shoe: 0xe3262f }) },
  },
  {
    id: 'highroller', name: 'High Roller', rarity: 'rare', price: 25000, desc: 'Never asks the price. Never needs to.',
    appearance: { body: 'm', skin: SKIN_TONES[6], eyes: 'brown', hair: 'buzz', hairColor: HAIR_COLORS[0], outfit: o({ top: 'suit', bottom: 'slacks', shoes: 'loafers', glasses: 'aviators', c1: 0x6a2fb8, c2: 0x111111, accent: 0xf2c230, pants: 0x6a2fb8, shoe: 0x1a1a1a, neck: 'chain' }) },
  },
  {
    id: 'commando', name: 'Commando', rarity: 'rare', price: 0, unlock: 'base', desc: 'Issued at Fort Hammerhead. Not for sale.',
    appearance: { body: 'm', skin: SKIN_TONES[3], eyes: 'grey', hair: 'buzz', hairColor: HAIR_COLORS[1], outfit: o({ top: 'military', bottom: 'camo', shoes: 'boots', hat: 'helmet', back: 'backpack', gloves: true, c1: 0x5d6b3a, c2: 0x3e4a28, accent: 0x2a2a20, pants: 0x5d6b3a, shoe: 0x3a2a1a }) },
  },
  {
    id: 'showstopper', name: 'Showstopper', rarity: 'epic', price: 60000, desc: 'Sequins catch every light on the Strip.',
    appearance: { body: 'f', skin: SKIN_TONES[2], eyes: 'violet', hair: 'long', hairColor: HAIR_COLORS[0], outfit: o({ top: 'dress', bottom: 'skirt', shoes: 'heels', c1: 0xf2c230, c2: 0xffe680, accent: 0xffffff, pants: 0xf2c230, shoe: 0xf2c230, neck: 'chain', glow: true }) },
  },
  {
    id: 'neonnomad', name: 'Neon Nomad', rarity: 'epic', price: 80000, desc: 'Comes alive after midnight.',
    appearance: { body: 'f', skin: SKIN_TONES[5], eyes: 'blue', hair: 'bob', hairColor: HAIR_COLORS[8], outfit: o({ top: 'hoodie', bottom: 'cargo', shoes: 'sneakers', back: 'backpack', glasses: 'visor', c1: 0x1b1530, c2: 0x2a2050, accent: 0x3fe0ff, pants: 0x1b1530, shoe: 0x3fe0ff, neck: 'mask', glow: true }) },
  },
  {
    id: 'ranger', name: 'Volcano Ranger', rarity: 'epic', price: 35000, desc: 'Has been to the crater rim and back.',
    appearance: { body: 'f', skin: SKIN_TONES[4], eyes: 'green', hair: 'braids', hairColor: HAIR_COLORS[2], outfit: o({ top: 'jacket', bottom: 'cargo', shoes: 'boots', hat: 'cowboy', back: 'backpack', c1: 0xd9772b, c2: 0x6b4a2a, accent: 0xf2e6c8, pants: 0x6b5a3a, shoe: 0x4a3020, neck: 'scarf' }) },
  },
  {
    id: 'agentace', name: 'Agent Ace', rarity: 'legendary', price: 250000, desc: 'The ace up the house’s sleeve.',
    appearance: { body: 'm', skin: SKIN_TONES[1], eyes: 'grey', hair: 'quiff', hairColor: HAIR_COLORS[0], outfit: o({ top: 'suit', bottom: 'slacks', shoes: 'loafers', glasses: 'shades', hat: 'headset', gloves: true, c1: 0x15161c, c2: 0x0b0c10, accent: 0xff2a3a, pants: 0x15161c, shoe: 0x0b0b0b, neck: 'tie' }) },
  },
  {
    id: 'jackpotjack', name: 'Jackpot Jack', rarity: 'legendary', price: 500000, desc: 'Lucky sevens, all the way down.',
    appearance: { body: 'm', skin: SKIN_TONES[3], eyes: 'amber', hair: 'short', hairColor: HAIR_COLORS[0], outfit: o({ top: 'tux', bottom: 'slacks', shoes: 'loafers', hat: 'tophat', back: 'dice', c1: 0xf2c230, c2: 0x1a1208, accent: 0xff3b3b, pants: 0x1a1208, shoe: 0xf2c230, neck: 'bowtie', glow: true }) },
  },
  {
    id: 'luckylady', name: 'Lady Luck', rarity: 'legendary', price: 400000, desc: 'The house always wins. Except against her.',
    appearance: { body: 'f', skin: SKIN_TONES[0], eyes: 'green', hair: 'long', hairColor: HAIR_COLORS[6], outfit: o({ top: 'dress', bottom: 'skirt', shoes: 'heels', back: 'chips', c1: 0xc8202f, c2: 0x7a0f1a, accent: 0x2ecc71, pants: 0xc8202f, shoe: 0x111111, neck: 'chain' }) },
  },
  {
    id: 'cybercroupier', name: 'Cyber Croupier', rarity: 'mythic', price: 1500000, desc: 'Deals from the year 3000.',
    appearance: { body: 'f', skin: SKIN_TONES[2], eyes: 'violet', hair: 'mohawk', hairColor: HAIR_COLORS[7], outfit: o({ top: 'armor', bottom: 'cargo', shoes: 'boots', back: 'wings', glasses: 'visor', gloves: true, c1: 0xe8ecf2, c2: 0x2a2f3a, accent: 0xff3fa4, pants: 0x2a2f3a, shoe: 0xe8ecf2, glow: true }) },
  },
  {
    id: 'kingpin', name: 'Island Kingpin', rarity: 'mythic', price: 1000000, desc: 'Owns the island. Literally.',
    appearance: { body: 'm', skin: SKIN_TONES[4], eyes: 'amber', hair: 'quiff', hairColor: HAIR_COLORS[0], outfit: o({ top: 'coat', bottom: 'slacks', shoes: 'loafers', hat: 'crown', back: 'cape', gloves: true, c1: 0x5a0f8a, c2: 0xf2c230, accent: 0xf2c230, pants: 0x1a1a1f, shoe: 0xf2c230, neck: 'chain', glow: true }) },
  },
];

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#8e9aaf', uncommon: '#4fc64f', rare: '#3aa7ff', epic: '#b65cff', legendary: '#ff9f2e', mythic: '#ffd84a',
};

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function appearanceFromSkin(id: string, overrides: Partial<Appearance> = {}): Appearance {
  const s = skinById(id);
  return { ...s.appearance, outfit: { ...s.appearance.outfit }, skinId: s.id, height: 1, build: 1, ...overrides };
}

/** Random everyday people for crowds (tourists, gamblers, locals, staff). */
export function randomAppearance(r: () => number, role: 'civilian' | 'gambler' | 'staff' | 'soldier' | 'dealer' | 'guard' = 'civilian'): Appearance {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const body: BodyType = r() < 0.5 ? 'm' : 'f';
  const hairM: Hair[] = ['buzz', 'short', 'spiky', 'quiff', 'afro', 'bald', 'short', 'long'];
  const hairF: Hair[] = ['long', 'ponytail', 'bun', 'bob', 'braids', 'afro', 'long'];
  const bright = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xff8fd8, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0x00f5d4, 0xfee440, 0xffffff, 0x2b2d42, 0xef476f, 0x06d6a0, 0x118ab2];
  const pantsC = [0x35588f, 0x2b2b30, 0xc8b48a, 0x5a6b3a, 0x7a3b2b, 0x1f8fc8, 0xe8e2d6];
  let outfit: Outfit;
  switch (role) {
    case 'dealer':
      outfit = o({ top: 'vest', bottom: 'slacks', shoes: 'loafers', c1: 0xffffff, c2: 0x15151a, accent: 0xb8202f, pants: 0x15151a, shoe: 0x111111, neck: 'bowtie' });
      break;
    case 'guard':
      outfit = o({ top: 'suit', bottom: 'slacks', shoes: 'loafers', hat: 'headset', glasses: r() < 0.6 ? 'shades' : 'none', c1: 0x15161c, c2: 0x0b0c10, accent: 0xf2c230, pants: 0x15161c, shoe: 0x0b0b0b, neck: 'tie' });
      break;
    case 'staff':
      outfit = o({ top: 'tee', bottom: 'slacks', c1: 0xb8202f, accent: 0xf2c230, pants: 0x1a1a1f, shoe: 0x111111 });
      break;
    case 'soldier':
      outfit = o({ top: 'military', bottom: 'camo', shoes: 'boots', hat: r() < 0.7 ? 'helmet' : 'beret', back: 'backpack', gloves: true, c1: 0x5d6b3a, c2: 0x3e4a28, accent: 0x2a2a20, pants: 0x5d6b3a, shoe: 0x3a2a1a });
      break;
    case 'gambler': {
      const fancy = r() < 0.5;
      outfit = fancy
        ? o({ top: body === 'f' && r() < 0.6 ? 'dress' : 'suit', bottom: body === 'f' ? 'skirt' : 'slacks', shoes: body === 'f' ? 'heels' : 'loafers', c1: pick(bright), c2: 0x15151a, accent: pick([0xf2c230, 0xffffff, 0xc0c0c0]), pants: pick([0x15151a, 0x2b2b30, 0x3a2a5a]), shoe: 0x111111, neck: pick(['none', 'tie', 'chain', 'bowtie'] as const), glasses: r() < 0.2 ? 'aviators' : 'none' })
        : o({ top: pick(['tee', 'hawaiian', 'jacket', 'hoodie'] as const), bottom: pick(['jeans', 'slacks', 'shorts'] as const), c1: pick(bright), c2: pick(bright), accent: pick(bright), pants: pick(pantsC), shoe: pick([0xf2f2f2, 0x111111, 0x8a5a3a]), hat: r() < 0.2 ? pick(['cap', 'cowboy', 'fedora'] as const) : 'none' });
      break;
    }
    default:
      outfit = o({
        top: pick(['tee', 'tee', 'tank', 'hoodie', 'jacket', 'hawaiian'] as const),
        bottom: pick(['jeans', 'shorts', 'shorts', 'cargo', body === 'f' ? 'skirt' : 'jeans'] as const),
        shoes: pick(['sneakers', 'sneakers', 'sandals'] as const),
        hat: r() < 0.25 ? pick(['cap', 'visor', 'beanie', 'bandana'] as const) : 'none',
        glasses: r() < 0.3 ? 'shades' : 'none',
        back: r() < 0.12 ? 'backpack' : 'none',
        c1: pick(bright), c2: pick(bright), accent: pick(bright), pants: pick(pantsC), shoe: pick([0xf2f2f2, 0x111111, 0xe84393, 0x4d96ff]),
      });
  }
  return {
    body,
    skin: pick(SKIN_TONES),
    eyes: pick(['brown', 'brown', 'hazel', 'blue', 'green', 'grey']),
    hair: role === 'soldier' ? 'buzz' : pick(body === 'm' ? hairM : hairF),
    hairColor: pick(HAIR_COLORS.slice(0, role === 'civilian' ? 12 : 6)),
    outfit,
    skinId: 'custom',
    height: 0.94 + r() * 0.12,
    build: 0.92 + r() * 0.2,
  };
}
