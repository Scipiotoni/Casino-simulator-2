import { BETTER_HIGH, weaponDef, isWeapon, type FireMode, type StatKey, type Variant, type WeaponDef, type WeaponStats } from './catalog';
import { ATTACHMENTS, CAMOS, CHARMS, CROSSHAIRS, CROSSHAIR_COLORS, RETICLES, RETICLE_COLORS, attachment, fits, type Attachment, type Crosshair, type GenericSlot, type Reticle } from './attachments';

/**
 * A weapon as you've built it in the gunsmith, and the maths that turns it into stats. Every
 * change is a fraction of the base stat (+0.1 = 10% more) and they add up; the magazine sets
 * the round count. What doesn't fit is dropped when a loadout is read back.
 */

/** The swappable slots, in the order the gunsmith shows them. */
export const SLOTS = ['optic', 'muzzle', 'barrel', 'underbarrel', 'laser', 'magazine', 'stock'] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_NAMES: Record<Slot, string> = {
  optic: 'Optic', muzzle: 'Muzzle', barrel: 'Barrel', underbarrel: 'Underbarrel', laser: 'Laser', magazine: 'Magazine', stock: 'Stock',
};

export interface Loadout {
  /** Generic attachments by id (absent = none). */
  optic?: string;
  muzzle?: string;
  underbarrel?: string;
  laser?: string;
  /** Weapon-specific parts by variant id (absent = the one it comes with). */
  barrel?: string;
  magazine?: string;
  stock?: string;
  camo: string;
  charm: string;
  reticle: Reticle;
  reticleColor: number;
}

export const DEFAULT_LOADOUT: Loadout = { camo: 'factory', charm: 'none', reticle: 'dot', reticleColor: RETICLE_COLORS[0] };

/** The HUD crosshair, the same for every weapon. */
export interface CrosshairSettings {
  style: Crosshair;
  color: number;
  /** Size 0.6–1.6 and gap 0–1.5 (multipliers). */
  size: number;
  gap: number;
}

export const DEFAULT_CROSSHAIR: CrosshairSettings = { style: 'classic', color: CROSSHAIR_COLORS[0], size: 1, gap: 1 };

/** Everything a slot can take on this weapon (the first is "none" or what it comes with). */
export function slotOptions(w: WeaponDef, slot: Slot): { id: string | null; name: string; price: number; blurb: string; brand?: string }[] {
  const variants = (vs: Variant[]) => vs.map((v) => ({ id: v.id, name: v.name, price: v.price, blurb: v.blurb }));
  const generic = (s: GenericSlot) => [{ id: null, name: 'None', price: 0, blurb: '' }, ...ATTACHMENTS.filter((a) => a.slot === s && fits(a, w)).map((a) => ({ id: a.id, name: a.name, price: a.price, blurb: a.blurb, brand: a.brand }))];
  switch (slot) {
    case 'barrel':
      return w.barrels.length > 1 ? variants(w.barrels) : [];
    case 'magazine':
      return w.mags.length > 1 ? variants(w.mags) : [];
    case 'stock':
      return w.stocks.length > 1 ? variants(w.stocks) : [];
    case 'muzzle':
      return muzzleOpen(w, undefined) ? generic('muzzle') : [];
    default: {
      const g = generic(slot);
      return g.length > 1 ? g : [];
    }
  }
}

/** Slots this weapon has at all. */
export function weaponSlots(w: WeaponDef): Slot[] {
  return SLOTS.filter((s) => slotOptions(w, s).length > 0);
}

function variant(list: Variant[], id: string | undefined): Variant | undefined {
  return list.find((v) => v.id === id) ?? list[0];
}

/** A muzzle device fits unless the barrel has a suppressor built in. */
function muzzleOpen(w: WeaponDef, barrel: string | undefined): boolean {
  if (w.thread === 'none' || w.integralSuppressor) return false;
  return !variant(w.barrels, barrel)?.suppressor;
}

/** What's actually fitted (the weapon's own parts resolved, generic ones looked up). */
export function fitted(w: WeaponDef, l: Loadout): { generic: Attachment[]; barrel?: Variant; mag?: Variant; stock?: Variant } {
  const generic: Attachment[] = [];
  for (const s of ['optic', 'muzzle', 'underbarrel', 'laser'] as const) {
    const a = l[s] ? attachment(l[s]!) : undefined;
    if (a && a.slot === s && fits(a, w) && (s !== 'muzzle' || muzzleOpen(w, l.barrel))) generic.push(a);
  }
  return { generic, barrel: variant(w.barrels, l.barrel), mag: variant(w.mags, l.magazine), stock: variant(w.stocks, l.stock) };
}

export interface FinalWeapon {
  def: WeaponDef;
  stats: WeaponStats;
  fire: FireMode;
  burst: number;
  suppressed: boolean;
  /** Field of view aimed down sights, and the optic's magnification (1 = irons). */
  adsFov: number;
  zoom: number;
  thermal: boolean;
  /** Laser beam colour, and whether there's a torch. */
  beam: number | null;
  light: boolean;
}

/** The weapon with everything fitted: final stats and behaviour. */
export function finalWeapon(id: string, l: Loadout = DEFAULT_LOADOUT): FinalWeapon {
  const w = weaponDef(id);
  const f = fitted(w, l);
  const sum: Partial<Record<StatKey, number>> = {};
  const add = (mods: Partial<Record<StatKey, number>>) => {
    for (const [k, v] of Object.entries(mods) as [StatKey, number][]) sum[k] = (sum[k] ?? 0) + v;
  };
  for (const a of f.generic) add(a.mods);
  for (const v of [f.barrel, f.mag, f.stock]) if (v) add(v.mods);
  const stats = { ...w.stats };
  for (const [k, v] of Object.entries(sum) as [StatKey, number][]) {
    // Fractions never take a stat below a tenth of itself.
    stats[k] = stats[k] * Math.max(0.1, 1 + v);
  }
  if (f.mag?.mag) stats.mag = f.mag.mag;
  stats.mag = Math.round(stats.mag);
  stats.pellets = w.stats.pellets;
  const optic = f.generic.find((a) => a.slot === 'optic');
  const zoom = optic?.zoom ?? w.builtInZoom ?? 1;
  const adsFov = optic ? Math.min(w.adsFov, 70 / Math.max(1, zoom * 1.05)) : w.adsFov;
  const variantFire = [f.stock, f.barrel, f.mag].find((v) => v?.fire);
  const laser = f.generic.find((a) => a.slot === 'laser');
  return {
    def: w,
    stats,
    fire: variantFire?.fire ?? w.fire,
    burst: variantFire?.burst ?? w.burst ?? 3,
    suppressed: !!w.integralSuppressor || !!f.barrel?.suppressor || f.generic.some((a) => a.suppressor),
    adsFov,
    zoom,
    thermal: !!optic?.thermal,
    beam: laser?.beam ?? null,
    light: f.generic.some((a) => a.light),
  };
}

/** How a fitted part changes each stat, for the gunsmith's bars: + is better, − worse. */
export function compare(id: string, from: Loadout, to: Loadout): { key: StatKey; from: number; to: number; better: boolean | null }[] {
  const a = finalWeapon(id, from).stats;
  const b = finalWeapon(id, to).stats;
  return (Object.keys(a) as StatKey[]).map((key) => {
    const d = b[key] - a[key];
    return { key, from: a[key], to: b[key], better: Math.abs(d) < 1e-9 ? null : d > 0 === BETTER_HIGH[key] };
  });
}

/** Put a part on (or take it off: null), returning the new loadout; anything that no longer fits comes off. */
export function equip(id: string, l: Loadout, slot: Slot, part: string | null): Loadout {
  const out: Loadout = { ...l };
  if (part === null) delete out[slot];
  else out[slot] = part;
  return sanitizeLoadout(id, out);
}

// ------------------------------------------------------------------ saves

/** Read back a stored loadout: unknown or unfitting parts are dropped, cosmetics checked. */
export function sanitizeLoadout(id: string, raw: unknown): Loadout {
  if (!isWeapon(id)) return { ...DEFAULT_LOADOUT };
  const w = weaponDef(id);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : undefined);
  const out: Loadout = {
    camo: CAMOS.some((c) => c.id === r.camo) ? (r.camo as string) : DEFAULT_LOADOUT.camo,
    charm: CHARMS.some((c) => c.id === r.charm) ? (r.charm as string) : DEFAULT_LOADOUT.charm,
    reticle: (RETICLES as readonly string[]).includes(r.reticle as string) ? (r.reticle as Reticle) : DEFAULT_LOADOUT.reticle,
    reticleColor: RETICLE_COLORS.includes(r.reticleColor as number) ? (r.reticleColor as number) : DEFAULT_LOADOUT.reticleColor,
  };
  const barrel = str('barrel');
  if (barrel && w.barrels.some((v) => v.id === barrel)) out.barrel = barrel;
  const mag = str('magazine');
  if (mag && w.mags.some((v) => v.id === mag)) out.magazine = mag;
  const stock = str('stock');
  if (stock && w.stocks.some((v) => v.id === stock)) out.stock = stock;
  for (const s of ['optic', 'muzzle', 'underbarrel', 'laser'] as const) {
    const a = str(s) ? attachment(str(s)!) : undefined;
    if (a && a.slot === s && fits(a, w) && (s !== 'muzzle' || muzzleOpen(w, out.barrel))) out[s] = a.id;
  }
  return out;
}

export function sanitizeCrosshair(raw: unknown): CrosshairSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    style: (CROSSHAIRS as readonly string[]).includes(r.style as string) ? (r.style as Crosshair) : DEFAULT_CROSSHAIR.style,
    color: CROSSHAIR_COLORS.includes(r.color as number) ? (r.color as number) : DEFAULT_CROSSHAIR.color,
    size: num(r.size, 0.6, 1.6, 1),
    gap: num(r.gap, 0, 1.5, 1),
  };
}

/** What you own in the armory: weapons, parts bought (by `<weapon>:<slot>:<id>` for weapon parts, `<id>` for generic ones and camos/charms), kills per weapon. */
export interface ArmorySave {
  owned: string[];
  parts: string[];
  loadouts: Record<string, Loadout>;
  kills: Record<string, number>;
  crosshair: CrosshairSettings;
}

export function sanitizeArmory(raw: unknown, legacyWeapons: string[] = []): ArmorySave {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const owned = [...new Set([...(Array.isArray(r.owned) ? r.owned : []), ...legacyWeapons].filter((x): x is string => typeof x === 'string' && isWeapon(x)))];
  const parts = Array.isArray(r.parts) ? [...new Set(r.parts.filter((x): x is string => typeof x === 'string' && x.length < 64))] : [];
  const loadouts: Record<string, Loadout> = {};
  const rl = (r.loadouts && typeof r.loadouts === 'object' ? r.loadouts : {}) as Record<string, unknown>;
  for (const id of owned) loadouts[id] = sanitizeLoadout(id, rl[id]);
  const kills: Record<string, number> = {};
  const rk = (r.kills && typeof r.kills === 'object' ? r.kills : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(rk)) if (isWeapon(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) kills[k] = Math.floor(v);
  return { owned, parts, loadouts, kills, crosshair: sanitizeCrosshair(r.crosshair) };
}

/** The key a bought part is stored under. */
export function partKey(weapon: string, slot: Slot | 'camo' | 'charm', id: string): string {
  return slot === 'barrel' || slot === 'magazine' || slot === 'stock' ? `${weapon}:${slot}:${id}` : `${slot}:${id}`;
}

/** Is a part yours to fit (free parts and the factory ones always are; camos may need kills)? */
export function partUnlocked(a: ArmorySave, weapon: string, slot: Slot | 'camo' | 'charm', id: string): boolean {
  if (slot === 'camo') {
    const c = CAMOS.find((x) => x.id === id);
    if (!c) return false;
    if (c.kills) return (a.kills[weapon] ?? 0) >= c.kills;
    return c.price === 0 || a.parts.includes(partKey(weapon, slot, id));
  }
  if (slot === 'charm') return id === 'none' || a.parts.includes(partKey(weapon, slot, id));
  const opt = slotOptions(weaponDef(weapon), slot).find((o) => o.id === id);
  if (!opt) return false;
  return opt.price === 0 || a.parts.includes(partKey(weapon, slot, id));
}
