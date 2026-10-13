import { LANDMARKS } from '../../world/layout';

/**
 * The street races as plain data: each route is a chain of legs along the island's real
 * roads (by road id from the layout), turned into a racing line, a start and evenly spaced
 * checkpoints once the terrain has profiled the roads. Also the medal and prize rules and
 * the save format. No three.js or DOM here, so it is unit-testable.
 */

/** One stretch of a route: follow a road from the point nearest `from` to the point nearest `to`. */
export interface Leg {
  /** A road id from the layout, or 'deck' for the Interstate 15 bridge (a straight deck, not a profiled road). */
  road: string;
  from: [number, number];
  to: [number, number];
  /** Drive this far right of the centre line (the boulevards have palms down the middle). */
  lane?: number;
}

export interface RouteDef {
  id: string;
  name: string;
  /** One line for the start card: where it goes. */
  blurb: string;
  legs: Leg[];
  /** Checkpoints, the finish line included. */
  checkpoints: number;
  /**
   * Gold, silver and bronze times in seconds, set from the route's length, corners and climb:
   * gold wants a clean run in a muscle car (or a sports car driven tidily), silver a good run
   * in an ordinary sedan, bronze any car that keeps moving.
   */
  medals: readonly [number, number, number];
  /** Ends where it starts. */
  loop?: boolean;
}

/** The bridge deck isn't in the terrain's road list: a straight line at the bridge's z. */
export const DECK = 'deck';
const DECK_Z = LANDMARKS.bridgeWest.z;
const DECK_HALF = 11;

export const ROUTES: readonly RouteDef[] = [
  {
    id: 'strip',
    name: 'Fortuna Strip Sprint',
    blurb: 'Sahara Avenue, down the Strip, round by Paradise Road and back up to Flamingo',
    legs: [
      { road: 'z-750', from: [2160, -750], to: [2600, -750] },
      { road: 'x2600', from: [2600, -750], to: [2600, 150], lane: 7 },
      { road: 'z150', from: [2600, 150], to: [3050, 150] },
      { road: 'x3050', from: [3050, 150], to: [3050, -1200] },
      { road: 'z-1200', from: [3050, -1200], to: [2660, -1200] },
    ],
    checkpoints: 10,
    medals: [95, 110, 130],
  },
  {
    id: 'coast',
    name: 'Sunset Coast Run',
    blurb: 'Route 1 out of Coral Cove, along Sunset Beach and into the harbour',
    legs: [{ road: 'route1', from: [-1760, 2700], to: [1300, 1560] }],
    checkpoints: 10,
    medals: [92, 108, 130],
  },
  {
    id: 'thunder',
    name: 'Thunderhead Hillclimb',
    blurb: 'Out of Dustwater on Lakeshore Drive, then up Thunderhead Road to the lookout',
    legs: [
      { road: 'lakeshore', from: [1300, -6000], to: [-1550, -5800] },
      { road: 'thunderhead', from: [-1550, -5800], to: [-2936, -8005] },
    ],
    checkpoints: 14,
    medals: [165, 200, 250],
  },
  {
    id: 'bridge',
    name: 'Interstate 15 Bridge Run',
    blurb: 'Down Main Street, along Interstate 15 and over the bridge to the far tower',
    legs: [
      { road: 'x2100', from: [2100, -1140], to: [2100, -300] },
      { road: 'z-300', from: [2100, -300], to: [3450, -300], lane: 7 },
      { road: 'i15', from: [3450, -300], to: [3640, -300], lane: 4.5 },
      { road: DECK, from: [3640, -300], to: [5460, -300], lane: 4.5 },
    ],
    checkpoints: 10,
    medals: [92, 113, 140],
  },
  {
    id: 'loop',
    name: 'Grand Island Loop',
    blurb: 'Route 1 all the way round: the heights, the west coast, Coral Cove and back',
    legs: [
      { road: 'x1300', from: [1300, 1300], to: [1300, -2100] },
      { road: 'route1', from: [1300, -2100], to: [1300, 1500] },
      { road: 'x1300', from: [1300, 1500], to: [1300, 1300] },
    ],
    checkpoints: 20,
    medals: [430, 500, 610],
    loop: true,
  },
];

// ------------------------------------------------------------------ courses

/** What the course builder needs from a road profile (the terrain's RoadProfile fits). */
export interface RoadLine {
  road: { id: string; width: number };
  xs: ArrayLike<number>;
  zs: ArrayLike<number>;
}

/** A point on the course and the way to drive through it. */
export interface Gate {
  x: number;
  z: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  /** Distance along the course (m). */
  s: number;
  /** Half the drivable width here (how far off the line still counts). */
  half: number;
}

export interface Course {
  route: RouteDef;
  /** The racing line, about every 10 m. */
  path: { x: number; z: number; half: number }[];
  length: number;
  start: Gate;
  /** Checkpoints in order; the last one is the finish line. */
  gates: Gate[];
}

interface Pt {
  x: number;
  z: number;
  half: number;
}

function nearestIndex(r: RoadLine, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < r.xs.length; i++) {
    const d = (r.xs[i] - x) ** 2 + (r.zs[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** The points of one leg, centre line first, then shifted into the lane. */
function legPoints(roads: readonly RoadLine[], leg: Leg): Pt[] {
  const pts: Pt[] = [];
  if (leg.road === DECK) {
    const ax = leg.from[0];
    const bx = leg.to[0];
    const n = Math.max(1, Math.ceil(Math.abs(bx - ax) / 10));
    for (let i = 0; i <= n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, z: DECK_Z, half: DECK_HALF });
  } else {
    const r = roads.find((p) => p.road.id === leg.road);
    if (!r) throw new Error(`Race route: no road '${leg.road}'`);
    const i0 = nearestIndex(r, leg.from[0], leg.from[1]);
    const i1 = nearestIndex(r, leg.to[0], leg.to[1]);
    const step = i1 >= i0 ? 1 : -1;
    for (let i = i0; ; i += step) {
      pts.push({ x: r.xs[i], z: r.zs[i], half: r.road.width / 2 });
      if (i === i1) break;
    }
  }
  const lane = leg.lane ?? 0;
  if (!lane || pts.length < 2) return pts;
  // Right of the direction of travel is (-dz, dx).
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / l;
    const dz = (b.z - a.z) / l;
    return { x: p.x - dz * lane, z: p.z + dx * lane, half: Math.max(4, p.half - Math.abs(lane)) };
  });
}

/** Turn a route into its racing line, start and checkpoints. */
export function buildCourse(roads: readonly RoadLine[], route: RouteDef): Course {
  const path: Pt[] = [];
  /** Where one leg hands over to the next (corners), as indices into the path. */
  const joints: number[] = [];
  for (const leg of route.legs) {
    const pts = legPoints(roads, leg);
    if (path.length) {
      joints.push(path.length - 1);
      // Skip a first point that repeats the last one.
      const last = path[path.length - 1];
      if (Math.hypot(pts[0].x - last.x, pts[0].z - last.z) < 1) pts.shift();
    }
    path.push(...pts);
  }
  const ss: number[] = [0];
  for (let i = 1; i < path.length; i++) ss.push(ss[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  const length = ss[ss.length - 1];
  const at = (s: number): Gate => {
    s = Math.max(0, Math.min(length, s));
    let i = 1;
    while (i < path.length - 1 && ss[i] < s) i++;
    const a = path[i - 1];
    const b = path[i];
    const t = (s - ss[i - 1]) / Math.max(1e-6, ss[i] - ss[i - 1]);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    // Direction: the line from a little before to a little after, so corners read smoothly.
    const p0 = pointAt(path, ss, Math.max(0, s - 12));
    const p1 = pointAt(path, ss, Math.min(length, s + 12));
    const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    return { x, z, dx: (p1.x - p0.x) / l, dz: (p1.z - p0.z) / l, s, half: Math.min(a.half, b.half) };
  };
  // Sharp corners (where legs meet at an angle): keep checkpoints out of the junction itself.
  const corners = joints.map((j) => ss[j]);
  const gates: Gate[] = [];
  const n = route.checkpoints;
  for (let k = 1; k <= n; k++) {
    let s = (length * k) / n;
    if (k < n) {
      for (const c of corners) if (Math.abs(s - c) < 40) s = c + 40;
    }
    gates.push(at(s));
  }
  return { route, path, length, start: at(0), gates };
}

function pointAt(path: Pt[], ss: number[], s: number): { x: number; z: number } {
  let i = 1;
  while (i < path.length - 1 && ss[i] < s) i++;
  const a = path[i - 1];
  const b = path[i];
  const t = (s - ss[i - 1]) / Math.max(1e-6, ss[i] - ss[i - 1]);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Distance from point p to the segment a-b (on the ground plane). */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** How close to a checkpoint's centre counts as through it. */
export function gateRadius(g: Gate): number {
  return Math.max(9, g.half + 2.5);
}

// ------------------------------------------------------------------ medals and prizes

/** From worst to best. */
export const MEDALS = ['finish', 'bronze', 'silver', 'gold'] as const;
export type Medal = (typeof MEDALS)[number];

export const MEDAL_ICON: Record<Medal, string> = { gold: '🥇', silver: '🥈', bronze: '🥉', finish: '🏁' };
export const MEDAL_NAME: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', finish: 'Finished' };

/** Prize for a medal on a 5 km route; longer routes pay more, shorter ones less. */
const BASE_PRIZE: Record<Medal, number> = { gold: 3000, silver: 1500, bronze: 750, finish: 250 };

export function medalFor(time: number, targets: readonly [number, number, number]): Medal {
  if (time <= targets[0]) return 'gold';
  if (time <= targets[1]) return 'silver';
  if (time <= targets[2]) return 'bronze';
  return 'finish';
}

/** 0 = finished, 3 = gold, -1 = never finished. */
export function medalRank(m: Medal | null | undefined): number {
  return m ? MEDALS.indexOf(m) : -1;
}

export function prizeFor(medal: Medal, length: number): number {
  const scale = Math.max(0.6, Math.min(4, length / 5000));
  return Math.round((BASE_PRIZE[medal] * scale) / 50) * 50;
}

/** What a finish pays: only the step up from the best medal already won here (no farming). */
export function payout(previous: Medal | null | undefined, now: Medal, length: number): number {
  if (medalRank(now) <= medalRank(previous)) return 0;
  return prizeFor(now, length) - (previous ? prizeFor(previous, length) : 0);
}

// ------------------------------------------------------------------ records and saves

export interface RaceRecord {
  /** Best time in seconds. */
  time: number;
  /** Best medal won (what has been paid out). */
  medal: Medal;
  /** Race clock at each checkpoint on the best run (the last one is the finish). */
  splits?: number[];
}

/** Read saved records, keeping only well-formed entries for routes that exist. */
export function readRecords(data: unknown): Record<string, RaceRecord> {
  const out: Record<string, RaceRecord> = {};
  if (!data || typeof data !== 'object') return out;
  const best = (data as { best?: unknown }).best;
  if (!best || typeof best !== 'object' || Array.isArray(best)) return out;
  for (const r of ROUTES) {
    if (!Object.prototype.hasOwnProperty.call(best, r.id)) continue;
    const e = (best as Record<string, unknown>)[r.id];
    if (!e || typeof e !== 'object') continue;
    const { time, medal, splits } = e as { time?: unknown; medal?: unknown; splits?: unknown };
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 5 || time > 24 * 3600) continue;
    if (typeof medal !== 'string' || !(MEDALS as readonly string[]).includes(medal)) continue;
    const rec: RaceRecord = { time, medal: medal as Medal };
    if (validSplits(splits, r.checkpoints, time)) rec.splits = [...splits];
    out[r.id] = rec;
  }
  return out;
}

/** One time per checkpoint, never going back, ending on the finish time. */
function validSplits(v: unknown, n: number, time: number): v is number[] {
  if (!Array.isArray(v) || v.length !== n) return false;
  let prev = 0;
  for (const t of v) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t < prev) return false;
    prev = t;
  }
  return Math.abs(prev - time) < 0.05;
}

/** A checkpoint time against the best run's: "-1.24" ahead, "+0.80" behind. */
export function splitDelta(now: number, best: number): string {
  const d = Math.round((now - best) * 100) / 100;
  return `${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(2)}`;
}

/** 83.456 → "1:23.45". */
export function formatTime(t: number): string {
  const cs = Math.max(0, Math.floor(t * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
