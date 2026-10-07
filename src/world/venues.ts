import { Venue, THEMES } from '../casino/venue';
import type { TableBase } from '../casino/table';
import type { Terrain } from './terrain';
import type { Collision } from './collision';
import { BlackjackTable } from '../casino/games/blackjack';
import type { Lot } from './layout';

/**
 * The island's own casinos. The Golden Viper is back (and bigger), the Lucky Lagoon and the
 * Royal Flush Palace line the Strip, and the Driftwood Tavern in Coral Cove is the dive bar
 * where your story starts.
 */

export type TableFactory = (seed: number, opts: { min: number; max: number; felt?: string }) => TableBase;

export const FACTORIES: Partial<Record<string, TableFactory>> = {
  blackjack: (seed, o) => new BlackjackTable(seed, { min: o.min, max: o.max, felt: o.felt }),
};

export interface VenueDef {
  key: string;
  name: string;
  theme: keyof typeof THEMES;
  width: number;
  depth: number;
  tower?: number;
  felt: string;
  /** [kind, x, z, yaw, min, max] in hall coordinates (front wall at z = 0, inside is -z). */
  layout: [string, number, number, number, number, number][];
  font?: string;
}

function grid(kind: string, x0: number, z0: number, cols: number, rows: number, dx: number, dz: number, yaw: number, min: number, max: number): [string, number, number, number, number, number][] {
  const out: [string, number, number, number, number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([kind, x0 + c * dx, z0 - r * dz, yaw, min, max]);
  return out;
}

export const VENUES: VenueDef[] = [
  {
    key: 'goldenViper', name: 'The Golden Viper', theme: 'viper', width: 56, depth: 44, tower: 28, felt: '#0f5a32', font: 'Bungee',
    layout: [
      ...grid('blackjack', -15, -12, 3, 2, 7, 8, Math.PI, 25, 10000),
      ...grid('roulette', 8, -12, 2, 1, 9, 0, Math.PI, 10, 25000),
      ['baccarat', 8, -21, Math.PI, 100, 50000],
      ['craps', 17, -21, Math.PI, 10, 10000],
      ['threecard', 0, -30, Math.PI, 10, 2500],
      ...grid('slots', -24, -8, 1, 6, 0, 3.2, Math.PI / 2, 1, 100),
      ...grid('slots', 24, -8, 1, 6, 0, 3.2, -Math.PI / 2, 1, 100),
      ...grid('videopoker', -6, -38.5, 6, 1, 2.0, 0, 0, 1, 25),
    ],
  },
  {
    key: 'luckyLagoon', name: 'Lucky Lagoon', theme: 'lagoon', width: 50, depth: 40, tower: 20, felt: '#0d5f7a', font: 'Lilita One',
    layout: [
      ...grid('blackjack', -12, -12, 3, 1, 7, 0, Math.PI, 10, 2500),
      ['roulette', -9, -21, Math.PI, 5, 5000],
      ['roulette', 2, -21, Math.PI, 5, 5000],
      ['craps', 13, -21, Math.PI, 5, 5000],
      ['threecard', 13, -12, Math.PI, 5, 1000],
      ['baccarat', -4, -30, Math.PI, 25, 10000],
      ...grid('slots', -21, -6, 1, 7, 0, 3.2, Math.PI / 2, 1, 50),
      ...grid('slots', 21, -6, 1, 7, 0, 3.2, -Math.PI / 2, 1, 50),
    ],
  },
  {
    key: 'royalFlush', name: 'Royal Flush Palace', theme: 'royal', width: 52, depth: 42, tower: 34, felt: '#5a1a2a', font: 'Lilita One',
    layout: [
      ...grid('blackjack', -14, -11, 3, 1, 7, 0, Math.PI, 100, 50000),
      ['baccarat', 9, -11, Math.PI, 500, 250000],
      ['baccarat', 17, -11, Math.PI, 500, 250000],
      ['roulette', -10, -21, Math.PI, 50, 100000],
      ['craps', 6, -21, Math.PI, 25, 50000],
      ['threecard', 0, -30, Math.PI, 50, 10000],
      ...grid('slots', -22, -6, 1, 7, 0, 3.2, Math.PI / 2, 5, 500),
      ...grid('videopoker', -5, -36.5, 5, 1, 2.0, 0, 0, 5, 100),
    ],
  },
  {
    key: 'driftwood', name: 'Driftwood Tavern', theme: 'tavern', width: 22, depth: 18, felt: '#2f5a2f', font: 'Lilita One',
    layout: [
      ['blackjack', 3, -9, Math.PI, 5, 500],
      ...grid('slots', 9.4, -4, 1, 3, 0, 3.0, -Math.PI / 2, 1, 10),
      ...grid('videopoker', -9.4, -9, 1, 2, 0, 2.2, Math.PI / 2, 1, 5),
    ],
  },
];

export function buildVenues(terrain: Terrain, collision: Collision): Venue[] {
  const out: Venue[] = [];
  let seed = 100;
  for (const def of VENUES) {
    const lot = terrain.lots.find((l) => l.special === def.key);
    if (!lot) continue;
    const venue = makeVenue(def, lot, terrain.lotY.get(lot.id) ?? 6, collision);
    for (const [kind, x, z, yaw, min, max] of def.layout) {
      const f = FACTORIES[kind];
      if (!f) continue;
      const t = f(seed++, { min, max, felt: def.felt });
      venue.addTable(t, x, z, yaw);
      t.populate(def.key === 'driftwood' ? 0.4 : 0.55);
    }
    out.push(venue);
  }
  return out;
}

function makeVenue(def: VenueDef, lot: Lot, y: number, collision: Collision): Venue {
  // Fit the hall to the lot.
  const lw = lot.front === 'N' || lot.front === 'S' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
  const ld = lot.front === 'N' || lot.front === 'S' ? lot.z1 - lot.z0 : lot.x1 - lot.x0;
  return new Venue(
    { id: def.key, name: def.name, theme: THEMES[def.theme], lot, y, width: Math.min(def.width, lw - 6), depth: Math.min(def.depth, ld - 14), tower: def.tower, sign: { font: def.font }, seed: def.name.length },
    collision,
  );
}
