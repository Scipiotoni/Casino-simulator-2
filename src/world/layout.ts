import { hash2, mulberry32 } from '../core/noise';

/**
 * The map of Jackpot Island, as plain data: where the coast, the volcano, the city, the
 * base and the roads are, and how the city's blocks are cut into lots. No three.js here,
 * so it is unit-testable and the same on every machine.
 *
 * Axes: x runs east, z runs south (north is -z). One unit is one metre.
 */

export const DOMAIN = { minX: -5000, maxX: 5000, minZ: -10200, maxZ: 4400 };

/**
 * Where the island's set pieces are. The south is the old island (the city, Mount Fortuna,
 * Coral Cove); north of the foothills lies Saguaro County: a desert valley round a salt
 * lake, farms, a wind farm, Mount Thunderhead and the fishing town on the north coast.
 */
export const LANDMARKS = {
  volcano: { x: -1650, z: -350, name: 'Mount Fortuna' },
  base: { x: -2700, z: -2500, w: 900, d: 600, name: 'Fort Hammerhead' },
  oldTown: { x: -1300, z: 2760, name: 'Coral Cove' },
  lighthouse: { x: 3060, z: -2330, name: 'Point Fortuna Lighthouse' },
  bridgeEast: { x: 6300, z: -300 },
  bridgeWest: { x: 3640, z: -300 },
  sunsetBeach: { x: 700, z: 3050, name: 'Sunset Beach' },
  /** The big northern mountain (about 1 km high, snow on top). */
  mountain: { x: -2300, z: -7400, name: 'Mount Thunderhead' },
  /** The salt lake in the desert valley: an ellipse (half-axes a, b) turned by `rot`. */
  lake: { x: -150, z: -5400, a: 1200, b: 580, rot: 0.12, name: 'Alkali Lake' },
  desertTown: { x: 1100, z: -6000, name: 'Dustwater' },
  northTown: { x: 300, z: -8760, name: 'Halibut Bay' },
  farms: { x: 2450, z: -6750, name: 'Harvest Valley' },
  windFarm: { x: 2750, z: -5000, name: 'Breezeway Wind Farm' },
  airstrip: { x0: 100, x1: 1000, z0: -6620, z1: -6580, name: 'Dustwater Airstrip' },
  /**
   * The container port south-east of the harbor district: a flat quay (x0..x1, z0..z1) at
   * height y. Its east edge (x1) is the berth: the sea right beside it is dredged to `depth`.
   */
  port: { x: 3490, z: 1940, x0: 3340, x1: 3640, z0: 1640, z1: 2240, y: 2.5, depth: 13, name: 'Port of Fortuna' },
  /**
   * The small-boat marina below Coral Cove: a flat waterfront strip (x0..x1, z0..z1) at
   * height y, with a sheltered basin of calm water south of it (basin, `depth` deep).
   */
  marina: {
    x: -900, z: 3270, x0: -1150, x1: -650, z0: 3240, z1: 3300, y: 2.2,
    basin: { x0: -1150, x1: -650, z0: 3300, z1: 3640 }, depth: 5, name: 'Coral Cove Marina',
  },
};

/** Dustwater: the desert town on the lake's north-east shore, strung along Lakeshore Drive. */
export const DESERT_TOWN = { x0: 700, x1: 1500, z: -6000, y: 20 };
/** Halibut Bay: the fishing town on the north coast; Route 1 is its main street. */
export const NORTH_TOWN = { x0: -250, x1: 850, z: -8760, y: 5 };

/**
 * Saguaro County's coastline as a polygon (x, z). It overlaps the old island's north shore,
 * so the two coasts merge into one: everything north of the foothills is new land.
 */
export const NORTH_COAST: [number, number][] = [
  [-3200, -1500], [-3750, -2250], [-4050, -3000], [-4250, -3700], [-4150, -4300], [-3950, -4650],
  [-4150, -5050], [-4350, -5700], [-4300, -6500], [-4100, -7300], [-3750, -8000], [-3250, -8550],
  [-2550, -8950], [-1750, -9200], [-1000, -9250], [-450, -9100], [50, -8950], [650, -8940],
  [1150, -9020], [1650, -8850], [2200, -8500], [2750, -8000], [3150, -7300], [3350, -6500],
  [3450, -5700], [3450, -4900], [3350, -4200], [3100, -3650], [2850, -3150], [2550, -2650],
  [1600, -2200], [0, -1600], [-1600, -1500],
];

/** Mount Thunderhead's height at distance r from its summit (before its rocky detail). */
export function thunderheadProfile(r: number): number {
  return 640 * Math.exp(-Math.pow(r / 1000, 2)) + 330 * Math.exp(-Math.pow(r / 420, 2));
}

/** The city's flat ground (everything inside is levelled to CITY_Y). */
export const CITY = { minX: 1220, maxX: 3560, minZ: -1720, maxZ: 1580 };
export const CITY_Y = 6;

export type RoadKind = 'highway' | 'boulevard' | 'street' | 'road' | 'dirt';

export interface RoadDef {
  id: string;
  name: string;
  kind: RoadKind;
  /** Total paved width in metres. */
  width: number;
  pts: [number, number][];
  /** Grid streets: flat, straight, drawn with sidewalks by the blocks. */
  grid?: boolean;
  closed?: boolean;
}

export const ROAD_WIDTH: Record<RoadKind, number> = { highway: 18, boulevard: 26, street: 13, road: 10, dirt: 6 };

// The city grid. N-S streets (x) and E-W streets (z).
export const GRID_X = [1300, 1700, 2100, 2600, 3050, 3450];
export const GRID_Z = [-2100, -1650, -1200, -750, -300, 150, 600, 1050, 1500];

const X_NAMES: Record<number, string> = {
  1300: 'Route 1',
  1700: 'Coral Avenue',
  2100: 'Main Street',
  2600: 'Fortuna Strip',
  3050: 'Paradise Road',
  3450: 'Ocean Drive',
};
const Z_NAMES: Record<number, string> = {
  [-2100]: 'Hillcrest Road',
  [-1650]: 'Palm Street',
  [-1200]: 'Flamingo Road',
  [-750]: 'Sahara Avenue',
  [-300]: 'Interstate 15',
  150: 'Tropicana Avenue',
  600: 'Sands Avenue',
  1050: 'Harbor Road',
  1500: 'Dock Street',
};

function gridRoads(): RoadDef[] {
  const out: RoadDef[] = [];
  const zMin = GRID_Z[0];
  const zMax = GRID_Z[GRID_Z.length - 1];
  for (const x of GRID_X) {
    const kind: RoadKind = x === 2600 ? 'boulevard' : 'street';
    const z0 = x === 3450 ? -1650 : zMin;
    // Route 1 continues as a highway outside the city; inside it's a city street.
    out.push({ id: `x${x}`, name: X_NAMES[x], kind, width: ROAD_WIDTH[kind], pts: [[x, z0], [x, zMax]], grid: true });
  }
  for (const z of GRID_Z) {
    const kind: RoadKind = z === -300 ? 'boulevard' : 'street';
    const x1 = z === -2100 ? 3050 : 3450;
    out.push({ id: `z${z}`, name: Z_NAMES[z], kind, width: ROAD_WIDTH[kind], pts: [[1300, z], [x1, z]], grid: true });
  }
  return out;
}

/** Route 1: the coastal highway round the island, joining the city at both ends of Route 1. */
const ROUTE1: [number, number][] = [
  [1300, -2100], [1150, -2500], [700, -2950], [-200, -3180], [-1150, -3230], [-1900, -3080],
  [-2150, -2050], [-2700, -1900], [-3350, -1650], [-3850, -900], [-4000, 100], [-3780, 1150],
  [-3150, 2050], [-2250, 2600], [-1300, 2760], [-450, 2900], [450, 2950], [1050, 2600], [1300, 2050], [1300, 1500],
];

function spiral(cx: number, cz: number, r0: number, r1: number, turns: number, a0: number, steps: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

export function allRoads(): RoadDef[] {
  const v = LANDMARKS.volcano;
  const roads: RoadDef[] = [...gridRoads()];
  roads.push({ id: 'route1', name: 'Route 1', kind: 'highway', width: ROAD_WIDTH.highway, pts: ROUTE1 });
  // Interstate 15 from the bridge to Ocean Drive (the bridge itself is its own structure).
  roads.push({ id: 'i15', name: 'Interstate 15', kind: 'highway', width: ROAD_WIDTH.highway, pts: [[LANDMARKS.bridgeWest.x, -300], [3450, -300]] });
  // Crater Road: west from the city, then a spiral up Mount Fortuna to the observatory.
  const sp = spiral(v.x, v.z, 1180, 330, 1.6, 0, 90);
  roads.push({
    id: 'crater', name: 'Crater Road', kind: 'road', width: ROAD_WIDTH.road,
    pts: [[1300, -300], [600, -300], [-200, -320], [v.x + 1180 + 40, v.z + 10], ...sp],
  });
  roads.push({ id: 'fort', name: 'Fort Road', kind: 'road', width: ROAD_WIDTH.road, pts: [[-2150, -2050], [-2400, -2120], [-2580, -2200]] });
  roads.push({
    id: 'light', name: 'Lighthouse Road', kind: 'road', width: ROAD_WIDTH.road,
    pts: [[3050, -2100], [3120, -2190], [3090, -2260]],
  });
  roads.push({ id: 'beach', name: 'Sunset Beach Road', kind: 'road', width: ROAD_WIDTH.road, pts: [[450, 2950], [650, 3080], [900, 3120]] });
  // Jungle track from Coral Cove up into the hills.
  roads.push({ id: 'jungle', name: 'Jungle Trail', kind: 'dirt', width: ROAD_WIDTH.dirt, pts: [[-1300, 2760], [-1500, 2300], [-1900, 1900], [-2500, 1500], [-2900, 1150]] });
  const port = LANDMARKS.port;
  roads.push({ id: 'port', name: 'Port Road', kind: 'road', width: ROAD_WIDTH.road, pts: [[3450, 1500], [3450, port.z0 + 60], [3450, port.z1 - 40]] });
  const marina = LANDMARKS.marina;
  roads.push({ id: 'marina', name: 'Marina Way', kind: 'road', width: ROAD_WIDTH.road, pts: [[-875, 2832], [-880, 3000], [marina.x, marina.z0 + 4]] });
  roads.push(...countyRoads());
  return roads;
}

/** Saguaro County: Route 1 round the north, the freeway up the middle, county roads and tracks. */
const NORTH_ROUTE1: [number, number][] = [
  [-3350, -1650], [-3550, -2250], [-3800, -3000], [-3950, -3700], [-3850, -4300], [-3700, -4700], [-3900, -5300],
  [-4050, -6000], [-3950, -6900], [-3700, -7600], [-3250, -8200], [-2600, -8650], [-1800, -8950], [-1000, -9000],
  [NORTH_TOWN.x0 - 250, NORTH_TOWN.z], [NORTH_TOWN.x1 + 150, NORTH_TOWN.z], [1250, -8700],
];
const FREEWAY: [number, number][] = [
  [2600, -2100], [2350, -2550], [1950, -3100], [1850, -3700], [1800, -4400], [1750, -4800], [1650, -5500],
  [1650, -6000], [1550, -6800], [1350, -7600], [1250, -8700],
];

/**
 * A road that winds up round a mountain at a steady grade: start at (x, z), keep the summit
 * on one side (dir 1 = anticlockwise seen on the map, -1 = clockwise) and stop at height yTop.
 */
function climb(cx: number, cz: number, x: number, z: number, dir: number, grade: number, yTop: number): [number, number][] {
  const pts: [number, number][] = [[x, z]];
  let a = Math.atan2(z - cz, x - cx);
  let r = Math.hypot(x - cx, z - cz);
  let y = thunderheadProfile(r);
  while (y < yTop && pts.length < 2000) {
    const step = Math.min(45, r * 0.35);
    y += grade * step;
    // The radius where the mountain is that high (it only rises inwards).
    let lo = 0;
    let hi = r;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      if (thunderheadProfile(mid) > y) lo = mid;
      else hi = mid;
    }
    const nr = (lo + hi) / 2;
    a += (dir * Math.sqrt(Math.max(0, step * step - (r - nr) * (r - nr)))) / Math.max(nr, 1);
    r = nr;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

function countyRoads(): RoadDef[] {
  const m = LANDMARKS.mountain;
  const out: RoadDef[] = [];
  out.push({ id: 'route1n', name: 'Route 1', kind: 'highway', width: ROAD_WIDTH.highway, pts: NORTH_ROUTE1 });
  out.push({ id: 'freeway', name: 'Sagebrush Freeway', kind: 'highway', width: ROAD_WIDTH.highway, pts: FREEWAY });
  // Route 44 crosses the desert south of the lake, from the west coast to the wind farm.
  out.push({
    id: 'route44', name: 'Route 44', kind: 'road', width: ROAD_WIDTH.road,
    pts: [[-3700, -4700], [-3000, -4650], [-2000, -4650], [-1100, -4700], [-300, -4620], [600, -4650], [1750, -4800]],
  });
  out.push({ id: 'route44e', name: 'Route 44', kind: 'road', width: ROAD_WIDTH.road, pts: [[1750, -4800], [2400, -4850], [2950, -5050]] });
  // Lakeshore Drive: round the lake's west and north shores and down Dustwater's main street.
  out.push({
    id: 'lakeshore', name: 'Lakeshore Drive', kind: 'road', width: ROAD_WIDTH.road,
    pts: [[-2000, -4650], [-1800, -5250], [-1550, -5800], [-1000, -6150], [-200, -6150], [450, -6060],
      [DESERT_TOWN.x0 - 120, DESERT_TOWN.z], [DESERT_TOWN.x1 + 100, DESERT_TOWN.z], [1650, -6000]],
  });
  // Thunderhead Road winds up from the lake to the lookout; the summit trail goes on to the top.
  const road = climb(m.x, m.z, -1550, -5800, -1, 0.065, 300);
  out.push({ id: 'thunderhead', name: 'Thunderhead Road', kind: 'road', width: ROAD_WIDTH.road, pts: road });
  const [lx, lz] = road[road.length - 1];
  out.push({ id: 'summit', name: 'Summit Trail', kind: 'dirt', width: ROAD_WIDTH.dirt, pts: climb(m.x, m.z, lx, lz, -1, 0.12, thunderheadProfile(60)) });
  out.push({ id: 'harvest', name: 'Harvest Road', kind: 'road', width: ROAD_WIDTH.road, pts: [[1550, -6800], [2300, -6750], [2950, -6550]] });
  out.push({ id: 'logging', name: 'Logging Road', kind: 'dirt', width: ROAD_WIDTH.dirt, pts: [[1350, -7600], [600, -7750], [-200, -7950], [-700, -8150]] });
  out.push({ id: 'mine', name: 'Prospector Trail', kind: 'dirt', width: ROAD_WIDTH.dirt, pts: [[-200, -6150], [-100, -6600], [250, -7050]] });
  const as = LANDMARKS.airstrip;
  out.push({ id: 'airstrip', name: 'Airstrip Road', kind: 'dirt', width: ROAD_WIDTH.dirt, pts: [[DESERT_TOWN.x0 + 40, DESERT_TOWN.z], [DESERT_TOWN.x0 + 40, as.z1 + 30], [as.x1 - 60, as.z1 + 30]] });
  return out;
}

// ------------------------------------------------------------------ blocks and lots

export type District = 'strip' | 'downtown' | 'midtown' | 'beach' | 'harbor' | 'heights' | 'oldtown' | 'desert' | 'north';
export type Facing = 'N' | 'S' | 'E' | 'W';

export interface Lot {
  id: string;
  district: District;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The side the lot opens onto (its street). */
  front: Facing;
  /** Street the lot is on, for addresses. */
  street: string;
  price: number;
  /** For sale to players, or an NPC building that's always there. */
  forSale: boolean;
  /** Reserved for a story building (NPC casino, gun shop, …). */
  special?: string;
}

export interface Block {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  district: District;
}

const HALF_STREET = (x: number) => (x === 2600 ? ROAD_WIDTH.boulevard / 2 : ROAD_WIDTH.street / 2);
const HALF_STREET_Z = (z: number) => (z === -300 ? ROAD_WIDTH.boulevard / 2 : ROAD_WIDTH.street / 2);
/** Sidewalk width round every block. */
export const SIDEWALK = 4.5;

function districtFor(cx: number, cz: number): District {
  if (cz < -1650) return 'heights';
  if (cz > 1050) return 'harbor';
  if (cx > 3450) return 'beach';
  if (cx > 2100 && cx < 3050 && cz > -1200) return 'strip';
  if (cx < 2100 && cz > -1200 && cz < 600) return 'downtown';
  if (cz < -1200) return 'heights';
  return 'midtown';
}

export function cityBlocks(): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < GRID_X.length - 1; i++) {
    for (let j = 0; j < GRID_Z.length - 1; j++) {
      const xa = GRID_X[i];
      const xb = GRID_X[i + 1];
      const za = GRID_Z[j];
      const zb = GRID_Z[j + 1];
      if (za === -2100 && xa >= 3050) continue;
      blocks.push({
        x0: xa + HALF_STREET(xa),
        x1: xb - HALF_STREET(xb),
        z0: za + HALF_STREET_Z(za),
        z1: zb - HALF_STREET_Z(zb),
        district: districtFor((xa + xb) / 2, (za + zb) / 2),
      });
    }
  }
  // The beachfront strip east of Ocean Drive.
  for (let j = 1; j < GRID_Z.length - 2; j++) {
    const za = GRID_Z[j];
    const zb = GRID_Z[j + 1];
    blocks.push({ x0: 3450 + HALF_STREET(3450), x1: 3560, z0: za + HALF_STREET_Z(za), z1: zb - HALF_STREET_Z(zb), district: 'beach' });
  }
  return blocks;
}

/** Target lot frontage per district. */
const FRONTAGE: Record<District, number> = { strip: 140, downtown: 70, midtown: 80, beach: 110, harbor: 90, heights: 46, oldtown: 30, desert: 50, north: 38 };
/** Base land price per square metre. */
const PRICE_M2: Record<District, number> = { strip: 42, downtown: 30, midtown: 12, beach: 26, harbor: 5, heights: 4, oldtown: 2.2, desert: 1.1, north: 1.8 };
/** Share of lots that are for sale (the rest are the city's own buildings). */
const SALE_SHARE: Record<District, number> = { strip: 0.34, downtown: 0.16, midtown: 0.26, beach: 0.34, harbor: 0.38, heights: 0.4, oldtown: 0.5, desert: 0.55, north: 0.5 };

function roundPrice(p: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(p)) - 1);
  return Math.round(p / mag) * mag;
}

/** Cut every block into lots that each face a street. */
export function cityLots(): Lot[] {
  const lots: Lot[] = [];
  const blocks = cityBlocks();
  let n = 0;
  for (const b of blocks) {
    const inner = { x0: b.x0 + SIDEWALK, x1: b.x1 - SIDEWALK, z0: b.z0 + SIDEWALK, z1: b.z1 - SIDEWALK };
    const w = inner.x1 - inner.x0;
    const d = inner.z1 - inner.z0;
    const alley = 8;
    // Beach blocks are one lot deep, facing Ocean Drive.
    const halves: { x0: number; x1: number; z0: number; z1: number; front: Facing }[] = [];
    if (b.district === 'beach' && b.x0 > 3450) {
      halves.push({ ...inner, front: 'W' });
    } else if (b.district === 'strip' || b.district === 'downtown' || b.district === 'beach') {
      // Split east/west: each half faces its N-S street.
      const mid = inner.x0 + w / 2;
      halves.push({ x0: inner.x0, x1: mid - alley / 2, z0: inner.z0, z1: inner.z1, front: 'W' });
      halves.push({ x0: mid + alley / 2, x1: inner.x1, z0: inner.z0, z1: inner.z1, front: 'E' });
    } else {
      // Split north/south: each half faces its E-W street.
      const mid = inner.z0 + d / 2;
      halves.push({ x0: inner.x0, x1: inner.x1, z0: inner.z0, z1: mid - alley / 2, front: 'N' });
      halves.push({ x0: inner.x0, x1: inner.x1, z0: mid + alley / 2, z1: inner.z1, front: 'S' });
    }
    for (const h of halves) {
      const alongX = h.front === 'N' || h.front === 'S';
      const len = alongX ? h.x1 - h.x0 : h.z1 - h.z0;
      const target = FRONTAGE[b.district];
      const count = Math.max(1, Math.round(len / target));
      const gap = 4;
      const each = (len - gap * (count - 1)) / count;
      for (let k = 0; k < count; k++) {
        const a = (alongX ? h.x0 : h.z0) + k * (each + gap);
        const lot: Lot = alongX
          ? { id: '', district: b.district, x0: a, x1: a + each, z0: h.z0, z1: h.z1, front: h.front, street: '', price: 0, forSale: false }
          : { id: '', district: b.district, x0: h.x0, x1: h.x1, z0: a, z1: a + each, front: h.front, street: '', price: 0, forSale: false };
        lot.street = streetFor(lot);
        n++;
        lot.id = `L${String(n).padStart(3, '0')}`;
        lots.push(lot);
      }
    }
  }
  lots.push(...oldTownLots(n));
  n = lots.length;
  lots.push(...townLots(n, DESERT_TOWN, 'desert', 'Lakeshore Drive', ROAD_WIDTH.road, [44, 52, 70, 46, 60, 90, 48], 58));
  n = lots.length;
  lots.push(...townLots(n, NORTH_TOWN, 'north', 'Route 1', ROAD_WIDTH.highway, [34, 40, 34, 52, 36, 44, 70], 46));
  priceAndAssign(lots);
  return lots;
}

function streetFor(l: Lot): string {
  if (l.front === 'W') return X_NAMES[nearest(GRID_X, l.x0)] ?? 'Ocean Drive';
  if (l.front === 'E') return X_NAMES[nearest(GRID_X, l.x1)] ?? 'Ocean Drive';
  if (l.front === 'N') return Z_NAMES[nearest(GRID_Z, l.z0)];
  return Z_NAMES[nearest(GRID_Z, l.z1)];
}

function nearest(arr: number[], v: number): number {
  let best = arr[0];
  for (const a of arr) if (Math.abs(a - v) < Math.abs(best - v)) best = a;
  return best;
}

/** Coral Cove: one main street (Route 1) with lots on both sides. */
export const OLD_TOWN = { x0: -1650, x1: -950, z: 2760 };

function oldTownLots(start: number): Lot[] {
  const out: Lot[] = [];
  let n = start;
  const half = ROAD_WIDTH.highway / 2 + SIDEWALK;
  for (const side of [-1, 1] as const) {
    let x = OLD_TOWN.x0;
    while (x + 30 <= OLD_TOWN.x1) {
      n++;
      const z0 = side < 0 ? OLD_TOWN.z - half - 40 : OLD_TOWN.z + half;
      out.push({
        id: `L${String(n).padStart(3, '0')}`, district: 'oldtown', x0: x, x1: x + 30, z0, z1: z0 + 40,
        front: side < 0 ? 'S' : 'N', street: 'Coral Cove Main Street', price: 0, forSale: false,
      });
      x += 34;
    }
  }
  return out;
}

/**
 * A county town: lots on both sides of its main street (along z), in a repeating pattern of
 * frontages so there are small and big lots, each `depth` deep.
 */
function townLots(start: number, town: { x0: number; x1: number; z: number }, district: District, street: string, roadWidth: number, widths: number[], depth: number): Lot[] {
  const out: Lot[] = [];
  let n = start;
  const half = roadWidth / 2 + SIDEWALK;
  for (const side of [-1, 1] as const) {
    let x = town.x0;
    let k = side < 0 ? 0 : 3;
    for (;;) {
      const w = widths[k++ % widths.length];
      if (x + w > town.x1) break;
      n++;
      const z0 = side < 0 ? town.z - half - depth : town.z + half;
      out.push({
        id: `L${String(n).padStart(3, '0')}`, district, x0: x, x1: x + w, z0, z1: z0 + depth,
        front: side < 0 ? 'S' : 'N', street, price: 0, forSale: false,
      });
      x += w + 6;
    }
  }
  return out;
}

/** Story buildings that sit on fixed lots (found by position so they never move). */
export const SPECIAL_SITES: { key: string; x: number; z: number }[] = [
  { key: 'goldenViper', x: 2450, z: -500 },
  { key: 'luckyLagoon', x: 2770, z: 380 },
  { key: 'royalFlush', x: 2450, z: 800 },
  { key: 'driftwood', x: -1250, z: 2720 },
  { key: 'gunShop', x: 1900, z: -150 },
  { key: 'carDealer', x: 2900, z: 1300 },
  { key: 'realEstate', x: 1550, z: 0 },
  { key: 'clothing', x: 1850, z: 400 },
  { key: 'hospital', x: 1500, z: -900 },
  { key: 'police', x: 1500, z: 850 },
  // Your flat: the first block off the Interstate 15 bridge.
  { key: 'flat', x: 3403, z: -420 },
  // Convenience stores round the island (store1..store8) and the pawn shop.
  { key: 'store1', x: 1804, z: -422 },
  { key: 'store2', x: 3174, z: -421 },
  { key: 'store3', x: 3508, z: -581 },
  { key: 'store4', x: 2734, z: -1534 },
  { key: 'store5', x: 2828, z: 1166 },
  { key: 'store6', x: -1431, z: 2727 },
  { key: 'store7', x: 1000, z: -5960 },
  { key: 'store8', x: 300, z: -8800 },
  { key: 'pawnShop', x: 1900, z: 934 },
  // Gas stations in the county towns (built with the town).
  { key: 'gasDustwater', x: 1400, z: -5960 },
  { key: 'gasHalibut', x: 800, z: -8800 },
];

function priceAndAssign(lots: Lot[]): void {
  for (const s of SPECIAL_SITES) {
    let best: Lot | null = null;
    let bd = Infinity;
    for (const l of lots) {
      if (l.special) continue;
      const cx = (l.x0 + l.x1) / 2;
      const cz = (l.z0 + l.z1) / 2;
      const dd = Math.hypot(cx - s.x, cz - s.z);
      if (dd < bd) {
        bd = dd;
        best = l;
      }
    }
    if (best) best.special = s.key;
  }
  for (const l of lots) {
    const area = (l.x1 - l.x0) * (l.z1 - l.z0);
    const r = hash2(Math.round(l.x0), Math.round(l.z0), 77);
    l.price = roundPrice(Math.max(4000, area * PRICE_M2[l.district] * (0.8 + r * 0.5)));
    l.forSale = !l.special && hash2(Math.round(l.z0), Math.round(l.x0), 91) < SALE_SHARE[l.district];
  }
  // A couple of cheap starter lots in Coral Cove are always for sale.
  const cove = lots.filter((l) => l.district === 'oldtown' && !l.special);
  for (let i = 0; i < Math.min(4, cove.length); i += 2) cove[i].forSale = true;
}

export function lotCenter(l: Lot): { x: number; z: number } {
  return { x: (l.x0 + l.x1) / 2, z: (l.z0 + l.z1) / 2 };
}

/** The point on the lot's street edge in the middle of its frontage. */
export function lotFrontPoint(l: Lot): { x: number; z: number; yaw: number } {
  const c = lotCenter(l);
  // yaw: the direction a building on this lot faces (towards its street).
  switch (l.front) {
    case 'N': return { x: c.x, z: l.z0, yaw: Math.PI };
    case 'S': return { x: c.x, z: l.z1, yaw: 0 };
    case 'E': return { x: l.x1, z: c.z, yaw: Math.PI / 2 };
    default: return { x: l.x0, z: c.z, yaw: -Math.PI / 2 };
  }
}

/** Seeded RNG for a lot (stable building styles). */
export function lotRng(l: Lot): () => number {
  return mulberry32(Math.round(l.x0 * 31 + l.z0 * 17) >>> 0);
}
