import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, lotAt, lotSize, parseFilter, visibleLots, type LotFilter } from '../src/ui/lotFilter';
import type { Lot } from '../src/world/layout';

const lot = (id: string, price: number, w: number, d: number, extra: Partial<Lot> = {}): Lot => ({
  id, district: 'midtown', x0: 0, x1: w, z0: 0, z1: d, front: 'N', street: 'Test Street', price, forSale: true, ...extra,
});

const LOTS = [
  lot('cheap', 4000, 20, 30), // 600 m², S
  lot('mid', 22000, 40, 40), // 1,600 m², M
  lot('big', 90000, 60, 60, { district: 'strip' }), // 3,600 m², L
  lot('city', 50000, 40, 40, { forSale: false }),
  lot('taken', 5000, 30, 30),
  lot('owned', 8000, 30, 30),
];
const owned = (l: Lot) => l.id === 'owned';
const taken = (l: Lot) => l.id === 'taken';
const ids = (f: Partial<LotFilter>, cash = 25000) => visibleLots(LOTS, { ...DEFAULT_FILTER, ...f }, cash, owned, taken, 600).map((v) => `${v.lot.id}:${v.state}`);

describe('map lot filters', () => {
  it('shows what is for sale, coloured by what you can afford, plus your own', () => {
    expect(ids({})).toEqual(['cheap:afford', 'mid:afford', 'big:pricey', 'owned:mine']);
  });

  it('never shows the city’s own buildings or lots other players hold', () => {
    expect(ids({}).some((s) => s.startsWith('city') || s.startsWith('taken'))).toBe(false);
  });

  it('keeps to your cash when asked', () => {
    expect(ids({ afford: true })).toEqual(['cheap:afford', 'mid:afford', 'owned:mine']);
    expect(ids({ afford: true }, 10000)).toEqual(['cheap:afford', 'owned:mine']);
  });

  it('filters by price, size, district and casino room', () => {
    expect(ids({ maxPrice: 10000 })).toEqual(['cheap:afford', 'owned:mine']);
    expect(ids({ sizes: ['L'], mine: false })).toEqual(['big:pricey']);
    expect(ids({ districts: ['strip'], mine: false })).toEqual(['big:pricey']);
    expect(visibleLots(LOTS, { ...DEFAULT_FILTER, casino: true, mine: false }, 1e6, owned, taken, 1000).map((v) => v.lot.id)).toEqual(['mid', 'big']);
  });

  it('can hide the lots for sale and show only yours', () => {
    expect(ids({ sale: false })).toEqual(['owned:mine']);
    expect(ids({ sale: false, mine: false })).toEqual([]);
  });

  it('sizes lots by area', () => {
    expect(['cheap', 'mid', 'big'].map((id) => lotSize(LOTS.find((l) => l.id === id)!))).toEqual(['S', 'M', 'L']);
  });

  it('finds the lot under a click, the smallest when they overlap', () => {
    const views = visibleLots(LOTS, DEFAULT_FILTER, 25000, owned, taken, 600);
    expect(lotAt(views, 10, 10, 0)?.lot.id).toBe('cheap');
    expect(lotAt(views, 35, 35, 0)?.lot.id).toBe('mid');
    expect(lotAt(views, 59, 59, 0)?.lot.id).toBe('big');
    expect(lotAt(views, 70, 70, 0)).toBeNull();
    expect(lotAt(views, 62, 30, 3)?.lot.id).toBe('big');
  });

  it('reads back stored filters safely', () => {
    expect(parseFilter(null)).toEqual(DEFAULT_FILTER);
    expect(parseFilter({ sale: 'yes', afford: true, maxPrice: 1234, sizes: ['S', 'XL', 'S'], districts: ['strip', 'mars'] })).toEqual({
      ...DEFAULT_FILTER, afford: true, sizes: ['S'], districts: ['strip'],
    });
    expect(parseFilter({ maxPrice: 50000 }).maxPrice).toBe(50000);
  });
});
