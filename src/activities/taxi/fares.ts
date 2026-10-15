import { LANDMARKS, SIDEWALK, lotFrontPoint, type Lot } from '../../world/layout';

/**
 * Sunshine Cabs as plain data and maths: the places passengers ask for, where a cab can pull
 * up to the kerb (on a real road, on land, clear of junctions and lots), how a fare and its
 * tips are worked out, and the save format. No three.js or DOM here, so it is unit-testable.
 */

// ------------------------------------------------------------------ the stand

/**
 * The Sunshine Cabs stand: a kiosk on the Golden Viper's forecourt (north of the hall), facing
 * the Strip. The cab for a shift waits at the kerb in front of it, pointing down the Strip.
 */
export const STAND = {
  x: 2578,
  z: -580,
  /** The kiosk faces east, onto the Strip. */
  yaw: Math.PI / 2,
  /** Where the cab waits: against the kerb of the Strip's southbound side. */
  cabX: 2600 - 13 + 1.15,
  cabZ: -580,
  cabHeading: 0,
};

// ------------------------------------------------------------------ the ground

/** What the cab logic needs from a road profile (the terrain's RoadProfile fits). */
export interface RoadLine {
  road: { id: string; name: string; kind: string; width: number };
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
}

/** The island as far as kerbs are concerned. */
export interface Ground {
  roads: readonly RoadLine[];
  lots: readonly Lot[];
  isLand(x: number, z: number): boolean;
  /** Something solid stands here (a wall, a tree, a lamp post). */
  blocked?(x: number, z: number): boolean;
}

/** A place at the side of a road: where the passenger stands and where the cab stops. */
export interface Kerb {
  /** The passenger's spot on the pavement (or the verge). */
  px: number;
  pz: number;
  /** Where the cab pulls up: the middle of the ring, in the kerbside lane. */
  x: number;
  z: number;
  /** Which way the passenger faces (towards the road), as a character yaw. */
  yaw: number;
  road: string;
}

/** How far onto the pavement a passenger stands (m past the edge of the road). */
const PAVEMENT = 1.4;
/** How far in from the edge of the road the cab stops (the middle of its lane). */
const LANE = 2.4;
/** A kerb this close to another road's edge is in a junction. */
const JUNCTION_CLEAR = 6;
/** Roads a cab works: everything but the dirt tracks. */
export const CAB_ROADS = (r: RoadLine): boolean => r.road.kind !== 'dirt';

function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Distance from a point to a road's centre line, skipping points further than `near`. */
export function roadDistance(r: RoadLine, x: number, z: number, near = 60): number {
  let best = Infinity;
  for (let i = 0; i < r.xs.length - 1; i++) {
    const ax = r.xs[i];
    const az = r.zs[i];
    if (Math.abs(ax - x) > near + 20 || Math.abs(az - z) > near + 20) continue;
    best = Math.min(best, segDist(ax, az, r.xs[i + 1], r.zs[i + 1], x, z));
  }
  return best;
}

function inLot(lots: readonly Lot[], x: number, z: number, margin = 0.5): boolean {
  return lots.some((l) => x > l.x0 - margin && x < l.x1 + margin && z > l.z0 - margin && z < l.z1 + margin);
}

/** The kerb at point i of road r, on `side` (+1 = right of the way the points run, -1 = left). */
export function kerbAt(r: RoadLine, i: number, side: 1 | -1): Kerb {
  const n = r.xs.length;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  const l = Math.hypot(r.xs[b] - r.xs[a], r.zs[b] - r.zs[a]) || 1;
  const dx = (r.xs[b] - r.xs[a]) / l;
  const dz = (r.zs[b] - r.zs[a]) / l;
  // Right of the direction (dx, dz) is (-dz, dx).
  const nx = -dz * side;
  const nz = dx * side;
  const half = r.road.width / 2;
  const x = r.xs[i];
  const z = r.zs[i];
  return {
    px: x + nx * (half + PAVEMENT),
    pz: z + nz * (half + PAVEMENT),
    x: x + nx * Math.max(0.5, half - LANE),
    z: z + nz * Math.max(0.5, half - LANE),
    // Facing back across the road: a yaw of atan2(fx, fz) faces along (fx, fz).
    yaw: Math.atan2(-nx, -nz),
    road: r.road.id,
  };
}

/** A kerb a cab can really use: on land, off the lots, clear of every other road and of walls. */
export function kerbOk(g: Ground, k: Kerb): boolean {
  const ox = k.px - k.x;
  const oz = k.pz - k.z;
  // The passenger, the cab and a step beyond the passenger must all be on dry land.
  if (!g.isLand(k.px, k.pz) || !g.isLand(k.x, k.z) || !g.isLand(k.px + ox * 0.5, k.pz + oz * 0.5)) return false;
  if (inLot(g.lots, k.px, k.pz) || inLot(g.lots, k.x, k.z)) return false;
  for (const r of g.roads) {
    if (r.road.id === k.road) continue;
    const clear = r.road.width / 2 + JUNCTION_CLEAR;
    if (roadDistance(r, k.px, k.pz, clear) < clear || roadDistance(r, k.x, k.z, clear) < clear) return false;
  }
  if (g.blocked && (g.blocked(k.px, k.pz) || g.blocked(k.x, k.z))) return false;
  return true;
}

// ------------------------------------------------------------------ places

export interface Place {
  id: string;
  name: string;
  icon: string;
  /** A story lot's key (or a lot id): the cab stops on that lot's street, by its front. */
  lot?: string;
  /** Or a point: the cab stops on the nearest of `roads`. */
  x?: number;
  z?: number;
  roads?: string[];
}

const L = LANDMARKS;

/** Everywhere a passenger might ask for (the Strip's resort hotels are added from the lots). */
export const PLACES: readonly Place[] = [
  { id: 'viper', name: 'The Golden Viper', icon: '🎰', lot: 'goldenViper' },
  { id: 'lagoon', name: 'Lucky Lagoon', icon: '🎰', lot: 'luckyLagoon' },
  { id: 'royal', name: 'Royal Flush Palace', icon: '🎰', lot: 'royalFlush' },
  { id: 'driftwood', name: 'Driftwood Tavern, Coral Cove', icon: '🍺', lot: 'driftwood' },
  { id: 'hospital', name: 'Mercy Island Hospital', icon: '➕', lot: 'hospital' },
  { id: 'motors', name: 'Island Motors', icon: '🚗', lot: 'carDealer' },
  { id: 'realty', name: 'Paradise Realty', icon: '🏢', lot: 'realEstate' },
  { id: 'drip', name: 'Drip Locker', icon: '👕', lot: 'clothing' },
  { id: 'pawn', name: 'Pawn Paradise', icon: '💍', lot: 'pawnShop' },
  { id: 'beach', name: L.sunsetBeach.name, icon: '🏖', x: 880, z: 3120, roads: ['beach'] },
  { id: 'marina', name: L.marina.name, icon: '⚓', x: L.marina.x, z: L.marina.z0, roads: ['marina'] },
  { id: 'port', name: `${L.port.name} gate`, icon: '🚢', x: L.port.x0 + 70, z: L.port.z0 + 20, roads: ['port'] },
  { id: 'cove', name: `${L.oldTown.name} Main Street`, icon: '🌴', x: -1500, z: L.oldTown.z, roads: ['route1'] },
  { id: 'lighthouse', name: L.lighthouse.name, icon: '🗼', x: 3090, z: -2260, roads: ['light'] },
  { id: 'observatory', name: 'Mount Fortuna Observatory', icon: '🔭', x: -1925, z: -555, roads: ['crater'] },
  { id: 'dustwater', name: L.desertTown.name, icon: '🌵', x: L.desertTown.x, z: L.desertTown.z, roads: ['lakeshore'] },
  { id: 'airstrip', name: L.airstrip.name, icon: '🛩', x: L.airstrip.x1 - 80, z: L.airstrip.z1 + 30, roads: ['airstrip'] },
  { id: 'halibut', name: L.northTown.name, icon: '🐟', x: L.northTown.x, z: L.northTown.z, roads: ['route1n'] },
];

const HOTEL_NAMES = ['Starlight Resort', 'Hotel Miramar', 'The Sands Tower', 'Oasis Grand Hotel'];

/** The Strip's resort hotels (every city-owned lot on the Strip is one), spread along it. */
export function hotelPlaces(lots: readonly Lot[]): Place[] {
  const strip = lots.filter((l) => l.district === 'strip' && !l.forSale && !l.special).sort((a, b) => a.z0 - b.z0 || a.x0 - b.x0);
  const n = Math.min(HOTEL_NAMES.length, strip.length);
  const out: Place[] = [];
  for (let i = 0; i < n; i++) {
    const l = strip[Math.floor(((i + 0.5) * strip.length) / n)];
    out.push({ id: `hotel${i}`, name: HOTEL_NAMES[i], icon: '🏨', lot: l.id });
  }
  return out;
}

/** A place with its kerb found: where the cab stops and where the passenger walks off to. */
export interface Stop {
  place: Place;
  kerb: Kerb;
  /** Where the passenger heads after getting out (the door, the beach, the pier). */
  goX: number;
  goZ: number;
}

/** Find where a cab can drop off at a place, or null if no kerb near it works. */
export function placeStop(g: Ground, place: Place): Stop | null {
  let ax: number;
  let az: number;
  let goX: number;
  let goZ: number;
  let roads: readonly RoadLine[];
  if (place.lot) {
    const lot = g.lots.find((l) => l.special === place.lot || l.id === place.lot);
    if (!lot) return null;
    const f = lotFrontPoint(lot);
    goX = f.x;
    goZ = f.z;
    // The street edge in front of the lot.
    ax = f.x + Math.sin(f.yaw) * (SIDEWALK + 2);
    az = f.z + Math.cos(f.yaw) * (SIDEWALK + 2);
    roads = g.roads.filter((r) => r.road.name === lot.street && CAB_ROADS(r));
    // Town lots name their main street rather than the road (Coral Cove's is Route 1): the nearest road then.
    if (!roads.length) roads = g.roads.filter(CAB_ROADS);
  } else {
    ax = goX = place.x ?? 0;
    az = goZ = place.z ?? 0;
    roads = g.roads.filter((r) => (place.roads ? place.roads.includes(r.road.id) : CAB_ROADS(r)));
  }
  // The nearest point of those roads, then the kerb on the place's side (or the nearest one that works).
  let best: { r: RoadLine; i: number; d: number } | null = null;
  for (const r of roads) {
    for (let i = 0; i < r.xs.length; i++) {
      const d = Math.hypot(r.xs[i] - ax, r.zs[i] - az);
      if (!best || d < best.d) best = { r, i, d };
    }
  }
  if (!best || best.d > 250) return null;
  const { r, i } = best;
  const n = r.xs.length;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  // (to the place) · (right of the way the points run, (-dz, dx)): positive means it's on the right.
  const right = (r.xs[b] - r.xs[a]) * (az - r.zs[i]) - (r.zs[b] - r.zs[a]) * (ax - r.xs[i]);
  const side: 1 | -1 = right > 0 ? 1 : -1;
  for (let step = 0; step <= 16; step++) {
    for (const j of step ? [i + step, i - step] : [i]) {
      if (j < 1 || j > n - 2) continue;
      for (const s of [side, -side as 1 | -1]) {
        const k = kerbAt(r, j, s);
        if (kerbOk(g, k)) return { place, kerb: k, goX, goZ };
      }
    }
  }
  return null;
}

/**
 * Somewhere for the next passenger to wait: a kerb on a cab road between minD and maxD from
 * (x, z) as the crow flies, picked at random. Widens the search if nothing near works.
 */
export function pickupKerb(g: Ground, x: number, z: number, rng: () => number, minD = 150, maxD = 600): Kerb | null {
  for (let widen = 0; widen < 4; widen++) {
    const hi = maxD * (1 + widen);
    const cands: { r: RoadLine; i: number }[] = [];
    for (const r of g.roads) {
      if (!CAB_ROADS(r)) continue;
      // Every third point (about 30 m apart) is plenty to choose from.
      for (let i = 2; i < r.xs.length - 2; i += 3) {
        const d = Math.hypot(r.xs[i] - x, r.zs[i] - z);
        if (d >= minD && d <= hi) cands.push({ r, i });
      }
    }
    for (let tries = 0; tries < 40 && cands.length; tries++) {
      const k = Math.floor(rng() * cands.length);
      const c = cands[k];
      cands[k] = cands[cands.length - 1];
      cands.pop();
      const kerb = kerbAt(c.r, c.i, rng() < 0.5 ? 1 : -1);
      if (kerbOk(g, kerb)) return kerb;
    }
  }
  return null;
}

/** Shortest and longest trips a passenger asks for (m, as the crow flies). */
export const TRIP_MIN = 350;
export const TRIP_CITY = 3200;

/**
 * Where this passenger wants to go: anywhere a fair ride away (not round the corner), now
 * and then a long haul out of town; never the place the last one went to.
 */
export function chooseStop(stops: readonly Stop[], from: { x: number; z: number }, rng: () => number, last = ''): Stop | null {
  const w = stops.map((s): number => {
    if (s.place.id === last) return 0;
    const d = Math.hypot(s.kerb.x - from.x, s.kerb.z - from.z);
    if (d < TRIP_MIN) return 0;
    return d <= TRIP_CITY ? 1 : 0.12;
  });
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    // Nothing a fair ride away: anything not right here.
    for (let i = 0; i < stops.length; i++) w[i] = Math.hypot(stops[i].kerb.x - from.x, stops[i].kerb.z - from.z) > 150 ? 1 : 0;
    sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return null;
  }
  let t = rng() * sum;
  let pick: Stop | null = null;
  for (let i = 0; i < stops.length; i++) {
    if (w[i] <= 0) continue;
    pick = stops[i];
    t -= w[i];
    if (t <= 0) break;
  }
  return pick;
}

// ------------------------------------------------------------------ fares and tips

/** Flag fall and the rate per kilometre on the meter. */
export const BASE_FARE = 30;
export const PER_KM = 110;
/** The meter stops at this share over the expected route (no driving in circles). */
export const METER_CAP = 1.25;
/** Best tips, as a share of the fare: for a quick ride and for not hitting anything. */
export const SPEED_TIP = 0.3;
export const CARE_TIP = 0.2;
/** Damage (the car's health lost) that costs the whole careful-driving tip. */
export const DAMAGE_LIMIT = 12;

/** The expected road distance for a trip this far as the crow flies (streets don't run straight). */
export function routeEstimate(crow: number): number {
  return crow * 1.3;
}

/** Seconds on the clock for a trip: time to get going plus a brisk average speed. */
export function timeLimit(crow: number): number {
  return Math.round(25 + routeEstimate(crow) / 13);
}

/** How long a passenger waits for the cab to turn up. */
export function waitLimit(dist: number): number {
  return Math.round(Math.max(60, 30 + dist / 8));
}

/** What the meter reads after driving `driven` metres with the passenger on a trip of `crow` m. */
export function meterFare(driven: number, crow: number): number {
  const d = Math.max(0, Math.min(driven, routeEstimate(crow) * METER_CAP));
  return Math.round(BASE_FARE + (d * PER_KM) / 1000);
}

export interface Payment {
  fare: number;
  speedTip: number;
  careTip: number;
  total: number;
}

/**
 * The fare at the drop-off: the meter (never less than the straight-line trip), a tip for
 * speed (all of it with 70% of the clock left, none under 20%) and one for a smooth ride.
 */
export function payment(driven: number, crow: number, used: number, limit: number, damage: number): Payment {
  const fare = meterFare(Math.max(driven, crow), crow);
  const left = limit > 0 ? Math.max(0, Math.min(1, (limit - used) / limit)) : 0;
  const quick = Math.max(0, Math.min(1, (left - 0.2) / 0.5));
  const smooth = Math.max(0, Math.min(1, 1 - Math.max(0, damage) / DAMAGE_LIMIT));
  const speedTip = Math.round(fare * SPEED_TIP * quick);
  const careTip = Math.round(fare * CARE_TIP * smooth);
  return { fare, speedTip, careTip, total: fare + speedTip + careTip };
}

/** 83.4 → "1:24" (rounded up: the time you still have). */
export function clock(t: number): string {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ saves

export interface TaxiRecord {
  /** Fares completed, ever. */
  fares: number;
  /** Money made from fares and tips, ever. */
  earned: number;
  /** The best shift: most money, and most fares. */
  bestShift: number;
  bestFares: number;
}

export function emptyRecord(): TaxiRecord {
  return { fares: 0, earned: 0, bestShift: 0, bestFares: 0 };
}

/** Read a saved record, keeping only sane whole numbers. */
export function readRecord(data: unknown): TaxiRecord {
  const out = emptyRecord();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  const d = data as Record<string, unknown>;
  const num = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
  out.fares = num(d.fares, 1e7);
  out.earned = num(d.earned, 1e12);
  out.bestShift = Math.min(num(d.bestShift, 1e10), out.earned);
  out.bestFares = Math.min(num(d.bestFares, 1e6), out.fares);
  return out;
}
