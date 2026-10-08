import type { District, Lot } from '../world/layout';

/**
 * What you can build on a lot, and what you can put on a casino floor. Pure data plus the
 * income maths, so it's unit-testable.
 */

export type BizType = 'casino' | 'bar' | 'shop' | 'restaurant' | 'nightclub' | 'hotel' | 'house';

export interface BizDef {
  type: BizType;
  name: string;
  icon: string;
  desc: string;
  /** Building cost before the size factor. */
  cost: number;
  /** Smallest lot it fits on (m²). */
  minArea: number;
  /** Seconds of construction. */
  buildTime: number;
  /** Income per game hour at level 1 on an average lot (casinos earn from their floor). */
  income: number;
  /** How it does by district (1 = average). */
  district: Partial<Record<District, number>>;
  /** Income by hour of the day (0..23), as a multiplier. */
  hours: (h: number) => number;
  theme: string;
  color: string;
}

const dayCurve = (h: number) => (h >= 8 && h < 22 ? 1.15 : 0.55);
const mealCurve = (h: number) => (h >= 11 && h < 14 ? 1.8 : h >= 18 && h < 22 ? 2.0 : h >= 7 && h < 23 ? 0.8 : 0.2);
const nightCurve = (h: number) => (h >= 21 || h < 3 ? 2.6 : h >= 18 ? 1.0 : 0.25);
const flat = () => 1;

export const BIZ: BizDef[] = [
  {
    type: 'casino', name: 'Casino', icon: '🎰', desc: 'Fill the floor with slots and tables. Guests gamble, the house edge pays the bills.',
    cost: 25000, minArea: 1000, buildTime: 45, income: 0, district: { strip: 1.6, beach: 1.3, downtown: 1.2, midtown: 1, harbor: 0.75, heights: 0.7, oldtown: 0.7 }, hours: (h) => (h >= 19 || h < 4 ? 1.4 : 0.85), theme: 'classic', color: '#ffd23d',
  },
  {
    type: 'bar', name: 'Bar & Lounge', icon: '🍸', desc: 'Cheap to open, steady money, busiest in the evening.',
    cost: 4000, minArea: 600, buildTime: 20, income: 95, district: { beach: 1.4, strip: 1.3, oldtown: 1.2, downtown: 1.1, midtown: 1, harbor: 0.9, heights: 0.7 }, hours: (h) => (h >= 17 || h < 2 ? 1.8 : 0.5), theme: 'tavern', color: '#ff9f2e',
  },
  {
    type: 'shop', name: 'Convenience Store', icon: '🛒', desc: 'Snacks, sunscreen, lottery tickets. Small, steady and open all day.',
    cost: 5000, minArea: 500, buildTime: 20, income: 80, district: { heights: 1.3, midtown: 1.2, oldtown: 1.1, downtown: 1, harbor: 0.9, beach: 1.1, strip: 0.9 }, hours: dayCurve, theme: 'lagoon', color: '#3ddc84',
  },
  {
    type: 'restaurant', name: 'Restaurant', icon: '🍽️', desc: 'Lunch and dinner rushes make the money.',
    cost: 12000, minArea: 900, buildTime: 30, income: 210, district: { downtown: 1.3, beach: 1.3, strip: 1.2, midtown: 1.1, oldtown: 1, heights: 0.9, harbor: 0.8 }, hours: mealCurve, theme: 'classic', color: '#ff6b6b',
  },
  {
    type: 'nightclub', name: 'Nightclub', icon: '🪩', desc: 'Dead by day, packed after dark. Big money at night.',
    cost: 40000, minArea: 1500, buildTime: 40, income: 560, district: { strip: 1.5, downtown: 1.3, beach: 1.2, midtown: 1, harbor: 1.1, heights: 0.6, oldtown: 0.7 }, hours: nightCurve, theme: 'neon', color: '#d68bff',
  },
  {
    type: 'hotel', name: 'Hotel', icon: '🏨', desc: 'A tower of rooms. Earns around the clock, and fills casinos nearby.',
    cost: 150000, minArea: 4000, buildTime: 60, income: 1500, district: { strip: 1.5, beach: 1.5, downtown: 1.2, midtown: 1, harbor: 0.8, heights: 0.7, oldtown: 0.8 }, hours: flat, theme: 'royal', color: '#3aa7ff',
  },
  {
    type: 'house', name: 'House', icon: '🏠', desc: 'Your home: a place to sleep, save and park your cars. Adds to your net worth.',
    cost: 15000, minArea: 500, buildTime: 30, income: 0, district: {}, hours: flat, theme: 'classic', color: '#9fe8ff',
  },
];

export function bizDef(t: string): BizDef {
  return BIZ.find((b) => b.type === t) ?? BIZ[0];
}

export function lotArea(l: Lot): number {
  return (l.x1 - l.x0) * (l.z1 - l.z0);
}

/** Bigger lots get bigger buildings: cost and income scale with the lot (capped). */
export function sizeFactor(area: number): number {
  return Math.min(2.5, Math.max(1, Math.sqrt(area / 1200)));
}

export function buildCost(t: BizType, l: Lot): number {
  return Math.round((bizDef(t).cost * sizeFactor(lotArea(l))) / 100) * 100;
}

export function upgradeCost(t: BizType, l: Lot, level: number): number {
  return Math.round((buildCost(t, l) * 0.6 * Math.pow(1.8, level - 1)) / 100) * 100;
}

export const MAX_LEVEL = 5;

/** Money a (non-casino) business makes in one game hour. */
export function hourlyIncome(t: BizType, l: Lot, level: number, hour: number): number {
  const d = bizDef(t);
  if (!d.income) return 0;
  const lv = 1 + 0.65 * (level - 1);
  const dist = d.district[l.district] ?? 1;
  return d.income * lv * dist * sizeFactor(lotArea(l)) * d.hours(Math.floor(hour) % 24);
}

// ------------------------------------------------------------------ casino floor

export interface FloorItem {
  kind: 'slots' | 'videopoker' | 'blackjack' | 'roulette' | 'baccarat' | 'threecard' | 'craps';
  name: string;
  icon: string;
  price: number;
  /** House profit per game hour when it's busy (before occupancy). */
  profit: number;
  /** Clearance radius for placement (m). */
  r: number;
  minBet: number;
  maxBet: number;
  needs: number;
  desc: string;
}

export const FLOOR_ITEMS: FloorItem[] = [
  { kind: 'slots', name: 'Slot Machine', icon: '🎰', price: 2500, profit: 45, r: 0.5, minBet: 1, maxBet: 15, needs: 1, desc: '3 reels, 5 lines, 94.9% RTP. The workhorse of every casino.' },
  { kind: 'videopoker', name: 'Video Poker', icon: '🃏', price: 3500, profit: 38, r: 0.5, minBet: 1, maxBet: 5, needs: 1, desc: 'Jacks or Better 9/6. Smart players love it.' },
  { kind: 'blackjack', name: 'Blackjack Table', icon: '♠️', price: 9000, profit: 120, r: 1.9, minBet: 10, maxBet: 5000, needs: 1, desc: 'Six decks, 3:2, dealer stands on 17. Needs room for its stools.' },
  { kind: 'roulette', name: 'Roulette Table', icon: '🎡', price: 14000, profit: 160, r: 1.9, minBet: 5, maxBet: 5000, needs: 2, desc: 'Single zero with la partage.' },
  { kind: 'threecard', name: 'Three Card Poker', icon: '🂡', price: 11000, profit: 130, r: 1.9, minBet: 10, maxBet: 2500, needs: 2, desc: 'Ante, Play and Pair Plus.' },
  { kind: 'baccarat', name: 'Baccarat Table', icon: '🀄', price: 22000, profit: 240, r: 1.9, minBet: 25, maxBet: 10000, needs: 3, desc: 'Punto banco. High rollers adore it.' },
  { kind: 'craps', name: 'Craps Table', icon: '🎲', price: 26000, profit: 280, r: 2.2, minBet: 5, maxBet: 5000, needs: 3, desc: 'The loudest table in the house.' },
];

export function floorItem(kind: string): FloorItem {
  return FLOOR_ITEMS.find((f) => f.kind === kind) ?? FLOOR_ITEMS[0];
}

/** Casino level from lifetime earnings. */
export function casinoLevel(earned: number): number {
  const steps = [0, 10000, 40000, 120000, 350000, 1000000];
  let lv = 1;
  for (let i = 1; i < steps.length; i++) if (earned >= steps[i]) lv = i + 1;
  return Math.min(6, lv);
}

/**
 * Casino profit per game hour: every item's profit times how busy the floor is. Busy-ness
 * comes from the district, the hour, the variety of games and how crowded the floor is.
 */
export function casinoHourly(items: { kind: string }[], l: Lot, hour: number, staffOk: boolean): number {
  if (!items.length) return 0;
  const d = bizDef('casino');
  const kinds = new Set(items.map((i) => i.kind)).size;
  const variety = 0.7 + Math.min(0.5, kinds * 0.08);
  const dist = d.district[l.district] ?? 1;
  const occupancy = Math.min(1, 0.35 + 0.65 * (dist / 1.6)) * d.hours(Math.floor(hour) % 24);
  const sum = items.reduce((a, i) => a + floorItem(i.kind).profit, 0);
  return sum * variety * occupancy * (staffOk ? 1 : 0.6);
}

/** Dealers needed: one per table. */
export function dealersNeeded(items: { kind: string }[]): number {
  return items.filter((i) => i.kind !== 'slots' && i.kind !== 'videopoker').length;
}
