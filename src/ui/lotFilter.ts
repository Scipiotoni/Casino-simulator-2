import type { District, Lot } from '../world/layout';

/**
 * The big map's property filters: which lots to show and how to colour them. Pure, so the
 * rules are unit-tested; the map draws whatever these say.
 */

export type LotSize = 'S' | 'M' | 'L';

export interface LotFilter {
  /** Show the lots that are for sale. */
  sale: boolean;
  /** ...only the ones you can pay for with the cash you have. */
  afford: boolean;
  /** ...only the ones big enough for a casino. */
  casino: boolean;
  /** Show your own lots and businesses (always clickable). */
  mine: boolean;
  /** Highest price to show (0 = any). */
  maxPrice: number;
  /** Sizes to show (empty = all). */
  sizes: LotSize[];
  /** Districts to show (empty = all). */
  districts: District[];
}

export const DEFAULT_FILTER: LotFilter = { sale: true, afford: false, casino: false, mine: true, maxPrice: 0, sizes: [], districts: [] };

export const PRICE_STEPS = [0, 10000, 25000, 50000, 100000, 250000, 1000000];
export const DISTRICTS: District[] = ['strip', 'downtown', 'midtown', 'beach', 'harbor', 'heights', 'oldtown', 'desert', 'north'];

export function lotArea(l: Lot): number {
  return (l.x1 - l.x0) * (l.z1 - l.z0);
}

/** Small (under 1,200 m²), medium (under 3,000 m²) or large. */
export function lotSize(l: Lot): LotSize {
  const a = lotArea(l);
  return a < 1200 ? 'S' : a < 3000 ? 'M' : 'L';
}

export type LotState = 'mine' | 'afford' | 'pricey';

export interface LotView {
  lot: Lot;
  state: LotState;
}

/**
 * The lots to draw: yours (when asked for) and the ones for sale that pass every filter.
 * `owned` and `taken` say which lots are yours and which other players hold.
 */
export function visibleLots(lots: readonly Lot[], f: LotFilter, money: number, owned: (l: Lot) => boolean, taken: (l: Lot) => boolean, casinoArea: number): LotView[] {
  const out: LotView[] = [];
  for (const l of lots) {
    if (owned(l)) {
      if (f.mine) out.push({ lot: l, state: 'mine' });
      continue;
    }
    if (!f.sale || !l.forSale || taken(l)) continue;
    if (f.afford && l.price > money) continue;
    if (f.maxPrice > 0 && l.price > f.maxPrice) continue;
    if (f.casino && lotArea(l) < casinoArea) continue;
    if (f.sizes.length && !f.sizes.includes(lotSize(l))) continue;
    if (f.districts.length && !f.districts.includes(l.district)) continue;
    out.push({ lot: l, state: l.price <= money ? 'afford' : 'pricey' });
  }
  return out;
}

/** A filter read back from storage: anything unknown falls back to the default. */
export function parseFilter(raw: unknown): LotFilter {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof LotFilter) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_FILTER[k] as boolean));
  const sizes = Array.isArray(r.sizes) ? (r.sizes.filter((s) => s === 'S' || s === 'M' || s === 'L') as LotSize[]) : [];
  const districts = Array.isArray(r.districts) ? (r.districts.filter((d) => DISTRICTS.includes(d as District)) as District[]) : [];
  return {
    sale: bool('sale'),
    afford: bool('afford'),
    casino: bool('casino'),
    mine: bool('mine'),
    maxPrice: PRICE_STEPS.includes(r.maxPrice as number) ? (r.maxPrice as number) : 0,
    sizes: [...new Set(sizes)],
    districts: [...new Set(districts)],
  };
}

/** The lot under a point (world metres), within `pad` metres of its edge; the smallest wins. */
export function lotAt(views: readonly LotView[], x: number, z: number, pad: number): LotView | null {
  let best: LotView | null = null;
  let area = Infinity;
  for (const v of views) {
    const l = v.lot;
    if (x < l.x0 - pad || x > l.x1 + pad || z < l.z0 - pad || z > l.z1 + pad) continue;
    const a = lotArea(l);
    if (a < area) {
      area = a;
      best = v;
    }
  }
  return best;
}
