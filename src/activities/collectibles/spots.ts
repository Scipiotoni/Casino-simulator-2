import { LANDMARKS, DESERT_TOWN, NORTH_TOWN, OLD_TOWN } from '../../world/layout';

/**
 * Where the 50 lucky chips are hidden, as plain data (no three.js, so it is unit-testable).
 * Every spot is hand-picked: a back alley, a beach, a pier, a fence line, a mountain top.
 * The game settles each one on the ground when you first come near it, nudging it a step
 * or two if something solid (a crate, a tree) happens to stand right there.
 */

export interface ChipSpot {
  x: number;
  z: number;
  /** Sits on a walkable deck (a pier, the bridge) rather than on the ground below it. */
  deck?: boolean;
}

const { port, marina, airstrip } = LANDMARKS;
const B = LANDMARKS.base;

export const CHIP_SPOTS: ChipSpot[] = [
  // Fortuna City: back alleys and yards between the blocks.
  { x: 1500, z: -150 }, // downtown, a back alley a block off Route 1
  { x: 2347, z: -640 }, // the Strip, a service alley up from Sahara Avenue
  { x: 3200, z: -975 }, // midtown, between the back yards
  { x: 2780, z: 1275 }, // the harbor district, between Harbor Road and Dock Street
  { x: 1950, z: 1275 }, // the harbor district, its quiet west end
  { x: 3600, z: -470 }, // the grass above the beach, by the island end of the bridge
  // Interstate 15: under the island end of the bridge and up on its deck.
  { x: 3728, z: -300 }, // the island end, down on the bank right under the deck
  { x: 4598, z: -291, deck: true }, // up on the bridge, on the walkway just short of the first pylon
  // The Port of Fortuna and the waterfront.
  { x: 3660, z: 600 }, // the sea front below Ocean Drive
  { x: 3496, z: 1765 }, // a lane through the container stacks
  { x: port.x1 + 4, z: port.z1 - 31, deck: true }, // the boat pontoon at the end of the quay
  { x: 3060, z: -2330 }, // Point Fortuna, by the lighthouse
  { x: 2050, z: -2400 }, // the top of Palm Heights, looking over the city
  // Coral Cove, the marina and the south coast.
  { x: marina.x1 - 110, z: marina.z1 + 90, deck: true }, // the end of the last finger pier
  { x: -1320, z: OLD_TOWN.z - 60 }, // behind the shops on Coral Cove's main street
  { x: -300, z: 3425 }, // the cove beach
  { x: 760, z: 3445 }, // Sunset Beach
  { x: 930, z: 3135 }, // the end of Sunset Beach Road
  // Mount Fortuna and the jungle.
  { x: -1925, z: -555 }, // the observatory at the top of Crater Road
  { x: -1650, z: -620 }, // the crater rim
  { x: -1902, z: 1910 }, // halfway along the Jungle Trail
  { x: -2915, z: 1140 }, // where the Jungle Trail runs out
  { x: -4250, z: 300 }, // the west beach
  { x: -3120, z: 2230 }, // the south-west beach
  // Fort Hammerhead's perimeter (outside the fence: the guards shoot at trespassers).
  { x: -2556, z: B.z + B.d / 2 + 16 }, // just outside the gate
  { x: B.x - B.w / 2 - 15, z: B.z - B.d / 2 - 15 }, // the far north-west corner
  { x: -3600, z: -2700 }, // the coast west of the fort
  // The foothills between the city and Saguaro County.
  { x: 1880, z: -3700 }, // the Sagebrush Freeway pass
  { x: 2790, z: -2640 }, // the sandy cove on the north-east coast
  { x: -2020, z: -4630 }, // the Route 44 junction
  // Alkali Lake and the desert.
  { x: -300, z: -4790 }, // the salt flats on the south shore
  { x: -1450, z: -5600 }, // the west shore, by Lakeshore Drive
  { x: 950, z: DESERT_TOWN.z - 75 }, // Dustwater, behind the north side of the main street
  { x: 1180, z: DESERT_TOWN.z + 78 }, // Dustwater, behind the south side, towards the lake
  { x: airstrip.x0 + 20, z: airstrip.z1 + 10 }, // the west end of Dustwater Airstrip
  { x: 265, z: -7060 }, // the end of the Prospector Trail
  // Mount Thunderhead.
  { x: -2936, z: -8005 }, // the lookout at the top of Thunderhead Road
  { x: -2252, z: -7420 }, // the summit
  { x: -720, z: -8160 }, // the end of the Logging Road, deep in the pines
  // Harvest Valley and the wind farm.
  { x: 2472, z: -6950 }, // a farm track between the fields
  { x: 2960, z: -6530 }, // the end of Harvest Road
  { x: 2800, z: -5060 }, // the wind farm
  { x: 3330, z: -5320 }, // the east coast beach
  // Halibut Bay and the north coast.
  { x: -190, z: -8985 }, // the beach west of town
  { x: 100, z: NORTH_TOWN.z - 75 }, // behind the fish shacks
  { x: 600, z: NORTH_TOWN.z + 68 }, // behind the south side of Route 1
  { x: 2750, z: -7960 }, // the north-east beach
  { x: -2600, z: -8650 }, // up on Route 1 in the north-west
  // One for the road: the far west of the island.
  { x: -3850, z: -900 }, // Route 1 on the west coast
  { x: -3900, z: -5500 }, // Route 1 above the west coast cliffs
];

export const CHIP_COUNT = CHIP_SPOTS.length;

export interface Milestone {
  at: number;
  bonus: number;
  /** An outfit that comes with it (an id from SKINS). */
  skin?: string;
}

/** Bonuses for finding 10, 25 and all 50 chips. All 50 also puts Lady Luck (chips on her back) in your wardrobe. */
export const MILESTONES: Milestone[] = [
  { at: 10, bonus: 5000 },
  { at: 25, bonus: 15000 },
  { at: CHIP_COUNT, bonus: 50000, skin: 'luckylady' },
];

/** Paid for each chip. */
export const CHIP_REWARD = 500;

/** The milestone reached by finding chip number `count`, if it is one. */
export function milestoneAt(count: number): Milestone | null {
  return MILESTONES.find((m) => m.at === count) ?? null;
}

/** Found chip indices from a save (untrusted: anything that isn't a valid index is dropped). */
export function parseFound(data: unknown): number[] {
  const list = data && typeof data === 'object' ? (data as { found?: unknown }).found : undefined;
  if (!Array.isArray(list)) return [];
  const out = new Set<number>();
  for (const v of list.slice(0, CHIP_COUNT * 4)) if (Number.isInteger(v) && v >= 0 && v < CHIP_COUNT) out.add(v);
  return [...out].sort((a, b) => a - b);
}

/**
 * Settle a spot: the first free place at or round it, looking in rings out to `reach` metres.
 * `ground` gives the height to stand at (null where you can't: the sea, a cliff); `free` says
 * whether a chip there would be clear of anything solid. Falls back to the spot itself.
 */
export function settle(
  spot: ChipSpot,
  ground: (x: number, z: number) => number | null,
  free: (x: number, y: number, z: number) => boolean,
  reach = 14,
): { x: number; y: number; z: number } {
  for (let r = 0; r <= reach; r += 1.5) {
    const n = r === 0 ? 1 : Math.max(8, Math.round(r * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = spot.x + Math.cos(a) * r;
      const z = spot.z + Math.sin(a) * r;
      const y = ground(x, z);
      if (y !== null && free(x, y, z)) return { x, y, z };
    }
  }
  return { x: spot.x, y: ground(spot.x, spot.z) ?? 0, z: spot.z };
}
