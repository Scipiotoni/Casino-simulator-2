import { lotFrontPoint, type District, type Lot } from '../../world/layout';
import { clamp } from '../../core/math';
import { placeStop, type Ground, type Kerb } from '../taxi/fares';

/**
 * Island Express as plain data and maths: the courier depot, the kinds of parcel and their
 * handling rules, the island's street addresses (each with a kerb a van can really stop at),
 * how a job is picked, timed and paid, and what a save may hold. No three.js or DOM here, so
 * it is unit-testable.
 */

// ------------------------------------------------------------------ the depot

/**
 * The Island Express depot: a small parcel office in the harbor district, on the open ground
 * south of Dock Street (between Main Street and the Strip, clear of every lot), facing the
 * street. The shift's van waits at the kerb in front of it, pointing east with the traffic.
 */
export const DEPOT = {
  x: 2350,
  z: 1521,
  /** The office faces north, onto Dock Street. */
  yaw: Math.PI,
  /** Where the van waits: against the south kerb of Dock Street (its edge is at z = 1506.5). */
  vanX: 2350,
  vanZ: 1506.5 - 1.1,
  vanHeading: Math.PI / 2,
};

/** The building's footprint round (DEPOT.x, DEPOT.z): width along the street, depth back from it. */
export const DEPOT_W = 9;
export const DEPOT_D = 7;

// ------------------------------------------------------------------ parcels

/** How a parcel has to be handled. */
export type Rule = 'standard' | 'rush' | 'fragile' | 'valuable' | 'heavy';

export const RULE_NAMES: Record<Rule, string> = { standard: 'Standard', rush: 'Rush', fragile: 'Fragile', valuable: 'Valuable', heavy: 'Heavy' };

export interface ParcelKind {
  id: string;
  name: string;
  icon: string;
  rule: Rule;
  /** The handling rule in a few words, for the job card. */
  hint: string;
  /** What's inside (one is picked per job, for the card). */
  contents: readonly string[];
  /** Multiplies the base pay. */
  pay: number;
  /** Multiplies the time limit. */
  time: number;
  /** Share of the pay added for arriving early (all of it with half the clock left). */
  early: number;
  /** How often it comes up. */
  weight: number;
  /** Longest trip it's offered for, as the crow flies (pizza has to arrive hot). */
  maxDist: number;
}

export const PARCELS: readonly ParcelKind[] = [
  {
    id: 'papers', name: 'Documents', icon: '📄', rule: 'standard', hint: 'Standard delivery',
    contents: ['Signed contracts', 'A sealed legal envelope', 'Blueprints in a tube', 'A stack of casino payslips'],
    pay: 1, time: 1, early: 0.4, weight: 3, maxDist: Infinity,
  },
  {
    id: 'flowers', name: 'Flowers', icon: '💐', rule: 'standard', hint: 'Standard delivery',
    contents: ['A dozen red roses', 'Sunflowers and lilies', 'An orchid in a pot', 'A get-well-soon bouquet'],
    pay: 1, time: 1, early: 0.4, weight: 2, maxDist: Infinity,
  },
  {
    id: 'pizza', name: 'Hot pizza', icon: '🍕', rule: 'rush', hint: 'Rush: short clock, bigger pay',
    contents: ['Two large pepperonis', 'A family-size Hawaiian', 'Four margheritas and garlic bread', 'The Jackpot Supreme'],
    pay: 1.4, time: 0.6, early: 0.6, weight: 3, maxDist: 1600,
  },
  {
    id: 'chips', name: 'Casino chips', icon: '💰', rule: 'valuable', hint: 'Valuable: lost if you get wanted',
    contents: ['A rack of $500 chips', 'A sealed case of high-roller plaques', '$20,000 in tournament chips', 'A cashier’s float'],
    pay: 1.7, time: 1, early: 0.4, weight: 2, maxDist: Infinity,
  },
  {
    id: 'vase', name: 'Antique vase', icon: '🏺', rule: 'fragile', hint: 'Fragile: every knock cuts the pay',
    contents: ['An antique porcelain vase', 'A crystal punch bowl', 'A hand-blown glass lamp', 'A signed ceramic lucky cat'],
    pay: 1.5, time: 1.2, early: 0.3, weight: 2, maxDist: Infinity,
  },
  {
    id: 'cake', name: 'Birthday cake', icon: '🎂', rule: 'fragile', hint: 'Fragile: every knock cuts the pay',
    contents: ['A three-tier chocolate cake', 'A strawberry sponge with candles', 'A cake shaped like a slot machine', 'Two dozen frosted cupcakes'],
    pay: 1.35, time: 1, early: 0.4, weight: 1, maxDist: 2000,
  },
  {
    id: 'slot', name: 'Slot machine parts', icon: '🎰', rule: 'heavy', hint: 'Heavy: the van pulls away slowly',
    contents: ['A reel motor', 'A coin hopper', 'A bill validator', 'A jackpot light bar'],
    pay: 1.45, time: 1.2, early: 0.4, weight: 2, maxDist: Infinity,
  },
];

export function parcelById(id: string): ParcelKind | undefined {
  return PARCELS.find((p) => p.id === id);
}

// ------------------------------------------------------------------ addresses

const AREA: Record<District, string> = {
  strip: 'The Strip', downtown: 'Downtown', midtown: 'Midtown', beach: 'Beachfront', harbor: 'Harbor District',
  heights: 'Palm Heights', oldtown: 'Coral Cove', desert: 'Dustwater', north: 'Halibut Bay',
};

export interface Address {
  lotId: string;
  /** "2741 Sahara Avenue". */
  street: string;
  /** "Downtown". */
  area: string;
  /** The middle of the lot's frontage (its street edge): the front door, near enough. */
  doorX: number;
  doorZ: number;
  /** Where the van stops: the ring, in the kerbside lane (from the taxi's kerb finder). */
  kerb: Kerb;
}

/** A lot's street number and name: odd numbers on the north and east sides, even on the others. */
export function streetAddress(l: Lot): string {
  const along = l.front === 'N' || l.front === 'S' ? (l.x0 + l.x1) / 2 : (l.z0 + l.z1) / 2;
  const odd = l.front === 'N' || l.front === 'E' ? 1 : 0;
  const n = 2 * Math.max(1, Math.round((along + 5000) / 10)) + odd;
  return `${n} ${l.street}`;
}

/** Furthest the van's kerb may be from the door (m): further and it isn't "at the address". */
export const KERB_REACH = 35;

/**
 * Every deliverable address: the island's own buildings (not lots for sale, which may be
 * empty or yours, and not the story buildings) that have a kerb a van can use close to the
 * front door. Uses the taxi's kerb finder, so it's on land, on the lot's street and clear of
 * junctions.
 */
export function findAddresses(g: Ground): Address[] {
  const out: Address[] = [];
  for (const l of g.lots) {
    if (l.forSale || l.special) continue;
    const street = streetAddress(l);
    const stop = placeStop(g, { id: l.id, name: street, icon: '📦', lot: l.id });
    if (!stop) continue;
    const f = lotFrontPoint(l);
    if (Math.hypot(stop.kerb.px - f.x, stop.kerb.pz - f.z) > KERB_REACH) continue;
    out.push({ lotId: l.id, street, area: AREA[l.district] ?? '', doorX: f.x, doorZ: f.z, kerb: stop.kerb });
  }
  return out;
}

// ------------------------------------------------------------------ jobs

export interface Job {
  kind: ParcelKind;
  contents: string;
  to: Address;
  /** Straight-line distance from where the job was handed out to the kerb (m). */
  dist: number;
  /** About how far it is by road (m). */
  route: number;
  /** Base pay (before the early bonus and any breakage). */
  pay: number;
  /** Seconds on the clock. */
  time: number;
}

/** Jobs go this far away, as the crow flies (m). */
export const MIN_DIST = 300;
export const MAX_DIST = 2500;
/** Roads wind: a trip by road is about this much longer than the straight line. */
export const ROUTE_FACTOR = 1.3;
/** The early bonus is all yours with this share of the clock left (and scales down to none at the buzzer). */
export const EARLY_FULL = 0.5;
/** Damage to the van (health lost) that smashes a fragile parcel outright. */
export const FRAGILE_LIMIT = 15;
/** A heavy load keeps this share of the van's acceleration. */
export const HEAVY_ACCEL = 0.55;

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/** Seconds allowed for a trip of `route` metres: slow through town, quicker over longer runs. */
export function timeLimit(route: number, kind: ParcelKind): number {
  const speed = 9 + Math.min(8, route / 400);
  return Math.max(30, round5((20 + route / speed) * kind.time));
}

/** The pay for a trip of `route` metres, before the early bonus. */
export function basePay(route: number, kind: ParcelKind): number {
  return Math.max(20, round5((40 + route * 0.11) * kind.pay));
}

function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, r: number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let x = r * total;
  for (const t of items) {
    x -= weight(t);
    if (x < 0) return t;
  }
  return items[items.length - 1];
}

export interface PickOpts {
  /** The last job's lot: never twice running. */
  last?: string;
  /** No valuables while the police are after you (they'd be lost on the spot). */
  wanted?: boolean;
}

/**
 * The next job, handed out at (from.x, from.z): a parcel kind, then an address MIN_DIST to
 * MAX_DIST away (nearer ones a little more often), its clock and its pay. When nowhere is in
 * that range (out in the country) anywhere not right here will do. Null when there's nowhere.
 */
export function pickJob(addresses: readonly Address[], from: { x: number; z: number }, rng: () => number, opts: PickOpts = {}): Job | null {
  const all = addresses
    .filter((a) => a.lotId !== opts.last)
    .map((a) => ({ a, d: Math.hypot(a.kerb.x - from.x, a.kerb.z - from.z) }))
    .sort((p, q) => p.d - q.d || (p.a.lotId < q.a.lotId ? -1 : 1));
  let near = all.filter((c) => c.d >= MIN_DIST && c.d <= MAX_DIST);
  if (!near.length) near = all.filter((c) => c.d >= 150);
  if (!near.length) return null;
  const kinds = PARCELS.filter((k) => near[0].d <= k.maxDist && !(opts.wanted && k.rule === 'valuable'));
  const kind = pickWeighted(kinds, (k) => k.weight, rng());
  const reach = near.filter((c) => c.d <= kind.maxDist);
  const pick = reach[Math.min(reach.length - 1, Math.floor(Math.pow(rng(), 1.25) * reach.length))];
  const route = Math.round(pick.d * ROUTE_FACTOR);
  const contents = kind.contents[Math.floor(rng() * kind.contents.length)];
  return { kind, contents, to: pick.a, dist: pick.d, route, pay: basePay(route, kind), time: timeLimit(route, kind) };
}

/** What's left of a fragile parcel after the van has lost `damage` health (1 = perfect, 0 = smashed). */
export function condition(damage: number): number {
  return clamp(1 - Math.max(0, damage) / FRAGILE_LIMIT, 0, 1);
}

export interface Payout {
  base: number;
  /** The early bonus. */
  early: number;
  /** Fragile parcels: what the knocks cost (0 for the rest). */
  broken: number;
  total: number;
}

/** What a delivery pays with `left` seconds on the clock, after the van has lost `damage` health on the way. */
export function payout(job: Job, left: number, damage = 0): Payout {
  const f = job.time > 0 ? clamp(left / job.time / EARLY_FULL, 0, 1) : 0;
  const early = round5(job.pay * job.kind.early * f);
  const whole = job.pay + early;
  const total = job.kind.rule === 'fragile' ? round5(whole * condition(damage)) : whole;
  return { base: job.pay, early, broken: whole - total, total };
}

/**
 * A heavy load on the van: of the speed it just gained (`now` against `prev`, going forwards)
 * it keeps only HEAVY_ACCEL. Braking, coasting and reversing are untouched.
 */
export function heavySpeed(prev: number, now: number): number {
  if (now <= prev || now <= 0) return now;
  const from = Math.max(0, prev);
  return from + (now - from) * HEAVY_ACCEL;
}

// ------------------------------------------------------------------ saves and formatting

export interface DeliveryRecord {
  /** Parcels delivered, ever. */
  delivered: number;
  /** Money made from deliveries, ever. */
  earned: number;
  /** The best shift: most money, and most deliveries. */
  bestShift: number;
  bestCount: number;
}

export function emptyRecord(): DeliveryRecord {
  return { delivered: 0, earned: 0, bestShift: 0, bestCount: 0 };
}

/** Read a saved record, keeping only sane whole numbers. */
export function readRecord(data: unknown): DeliveryRecord {
  const out = emptyRecord();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  const d = data as Record<string, unknown>;
  const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
  out.delivered = num(d.delivered, 1e7);
  out.earned = num(d.earned, 1e12);
  out.bestShift = Math.min(num(d.bestShift, 1e10), out.earned);
  out.bestCount = Math.min(num(d.bestCount, 1e6), out.delivered);
  return out;
}

/** 1234 → "1.2 km", 87 → "90 m". */
export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`;
}
