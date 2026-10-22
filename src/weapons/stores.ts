import { WEAPONS, weaponDef, type WeaponDef } from './catalog';

/**
 * The island's gun stores. Each is a building you walk into (src/world/gunStores.ts) with
 * its own lot in layout's SPECIAL_SITES, its own look and its own stock: downtown sells
 * handguns, SMGs and rifles; the Strip boutique the premium pieces; Dustwater the heavy
 * stuff; Halibut Bay hunting rifles and shotguns. Every store has a gunsmith's workbench
 * (the parts are the same everywhere).
 */

export interface GunStore {
  key: string;
  name: string;
  sign: string;
  tagline: string;
  /** Facade, trim, floor, wall, counter and neon colours. */
  look: { wall: number; trim: number; floor: number; inner: number; counter: number; neon: string; awning: number; style: 'brick' | 'boutique' | 'shed' | 'cabin' };
  /** Weapon ids for sale (never the secret ones). */
  stock: string[];
}

export const GUN_STORES: GunStore[] = [
  {
    key: 'gunShop', name: 'Bullseye Guns', sign: 'BULLSEYE GUNS', tagline: 'Handguns, SMGs and rifles, downtown',
    look: { wall: 0x8a3a2a, trim: 0x1e1e22, floor: 0x6a6a70, inner: 0xd8d2c4, counter: 0x5a4a3a, neon: '#ff5a6a', awning: 0xc8202f, style: 'brick' },
    stock: ['pistol', 'm9', 'm1911', 'fiveseven', 'revolver', 'smg', 'uzi', 'mp7', 'vector', 'rifle', 'g36c', 'famas', 'ak47', 'shotgun', 'benelli'],
  },
  {
    key: 'gunStrip', name: 'Royal Arms Boutique', sign: 'ROYAL ARMS', tagline: 'Premium pieces on the Strip',
    look: { wall: 0x16161c, trim: 0xd8b04a, floor: 0xe8e2d6, inner: 0x2a2630, counter: 0x101014, neon: '#ffd23d', awning: 0x16161c, style: 'boutique' },
    stock: ['deagle', 'fiveseven', 'm1911', 'vector', 'p90', 'mp7', 'aug', 'scarh', 'famas', 'm14', 'awm', 'spas12', 'benelli', 'aa12'],
  },
  {
    key: 'gunDesert', name: 'Dustwater Heavy Ordnance', sign: 'HEAVY ORDNANCE', tagline: 'Launchers, machine guns and the minigun, out in the desert',
    look: { wall: 0xb88a52, trim: 0x5a4a32, floor: 0x9a8a6a, inner: 0xc8b28a, counter: 0x4a3a26, neon: '#ff7a2a', awning: 0x6a5a3a, style: 'shed' },
    stock: ['rpg7', 'at4', 'm202', 'homing', 'm32', 'minigun', 'm249', 'pkm', 'barrett', 'ak47', 'aa12', 'sawnoff', 'deagle'],
  },
  {
    key: 'gunBay', name: 'Halibut Bay Outfitters', sign: 'BAY OUTFITTERS', tagline: 'Hunting rifles and shotguns on the north coast',
    look: { wall: 0x3a5a4a, trim: 0xe8e0c8, floor: 0x8a6a48, inner: 0xc8a878, counter: 0x5a3a22, neon: '#6fe0b0', awning: 0x2a4a3a, style: 'cabin' },
    stock: ['sniper', 'awm', 'svd', 'm14', 'shotgun', 'benelli', 'spas12', 'sawnoff', 'revolver', 'm1911', 'scarh', 'm9'],
  },
];

export function gunStore(key: string): GunStore | undefined {
  return GUN_STORES.find((s) => s.key === key);
}

export function isGunStore(key: string): boolean {
  return GUN_STORES.some((s) => s.key === key);
}

/** A store's weapons, by class order then price. */
export function storeStock(s: GunStore): WeaponDef[] {
  const order = WEAPONS.map((w) => w.cls).filter((c, i, a) => a.indexOf(c) === i);
  return s.stock
    .map((id) => weaponDef(id))
    .filter((w) => s.stock.includes(w.id) && !w.secret)
    .sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls) || a.price - b.price);
}

/** Every store that sells a weapon. */
export function storesSelling(id: string): GunStore[] {
  return GUN_STORES.filter((s) => s.stock.includes(id));
}
