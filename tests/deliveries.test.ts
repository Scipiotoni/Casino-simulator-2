import { beforeAll, describe, expect, it } from 'vitest';
import { Terrain } from '../src/world/terrain';
import { mulberry32 } from '../src/core/noise';
import { kerbOk, type Ground, type Kerb } from '../src/activities/taxi/fares';
import {
  DEPOT, DEPOT_D, DEPOT_W, EARLY_FULL, FRAGILE_LIMIT, HEAVY_ACCEL, KERB_REACH, MAX_DIST, MIN_DIST, PARCELS, ROUTE_FACTOR, basePay, condition,
  emptyRecord, findAddresses, fmtDist, heavySpeed, parcelById, payout, pickJob, readRecord, streetAddress, timeLimit, type Address, type Job,
} from '../src/activities/deliveries/jobs';

let terrain: Terrain;
let ground: Ground;
let addresses: Address[];

beforeAll(() => {
  terrain = new Terrain();
  ground = { roads: terrain.roads, lots: terrain.lots, isLand: (x, z) => terrain.isLand(x, z) };
  addresses = findAddresses(ground);
}, 60000);

const kind = (id: string) => parcelById(id)!;

/** On land, off every lot, the van's spot inside the road's paving and the pavement spot just off it. */
function checkKerb(k: Kerb, where: string): void {
  expect(terrain.isLand(k.px, k.pz), where).toBe(true);
  expect(terrain.isLand(k.x, k.z), where).toBe(true);
  for (const [x, z] of [[k.px, k.pz], [k.x, k.z]]) expect(terrain.lots.find((l) => x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1), where).toBeUndefined();
  const near = terrain.nearestRoad(k.x, k.z, 30);
  expect(near, where).not.toBeNull();
  expect(near!.profile.road.id, where).toBe(k.road);
  expect(near!.dist, where).toBeLessThan(near!.profile.road.width / 2);
  const p = terrain.nearestRoad(k.px, k.pz, 30);
  expect(p, where).not.toBeNull();
  expect(p!.dist, where).toBeGreaterThan(p!.profile.road.width / 2);
}

describe('deliveries depot', () => {
  it('stands on open ground south of Dock Street, clear of every lot and road', () => {
    const half = { x: DEPOT_W / 2 + 1.5, z: DEPOT_D / 2 + 1.5 };
    for (const sx of [-1, 0, 1]) {
      for (const sz of [-1, 0, 1]) {
        const x = DEPOT.x + sx * half.x;
        const z = DEPOT.z + sz * half.z;
        expect(terrain.isLand(x, z)).toBe(true);
        const r = terrain.nearestRoad(x, z, 60);
        if (r) expect(r.dist - r.profile.road.width / 2, `(${x}, ${z})`).toBeGreaterThan(2);
      }
    }
    for (const l of terrain.lots) {
      const apart = DEPOT.x + half.x < l.x0 || DEPOT.x - half.x > l.x1 || DEPOT.z + half.z < l.z0 || DEPOT.z - half.z > l.z1;
      expect(apart, l.id).toBe(true);
    }
  });

  it('parks the van at the Dock Street kerb, out of the traffic lane', () => {
    const r = terrain.nearestRoad(DEPOT.vanX, DEPOT.vanZ, 30)!;
    expect(r.profile.road.id).toBe('z1500');
    expect(r.dist + 1).toBeLessThan(r.profile.road.width / 2);
    // Traffic keeps 3.2 m right of the middle: a 2 m van and a 2 m car clear each other.
    expect(r.dist - 1 - (3.2 + 1)).toBeGreaterThan(0.1);
    // Pointing east, the way the kerbside lane runs.
    expect(Math.sin(DEPOT.vanHeading)).toBeCloseTo(1);
    expect(DEPOT.vanZ).toBeLessThan(DEPOT.z - DEPOT_D / 2);
  });
});

describe('deliveries addresses', () => {
  it('finds a kerb for nearly every city building, never a lot for sale or a story building', () => {
    const own = terrain.lots.filter((l) => !l.forSale && !l.special);
    expect(addresses.length).toBeGreaterThan(own.length * 0.85);
    expect(new Set(addresses.map((a) => a.lotId)).size).toBe(addresses.length);
    for (const a of addresses) {
      const lot = terrain.lots.find((l) => l.id === a.lotId)!;
      expect(lot.forSale || !!lot.special, a.lotId).toBe(false);
    }
  });

  it('puts every kerb on a real road, on land, by the door and clear of junctions', () => {
    for (const a of addresses) {
      const where = `${a.street} (${a.lotId}) at (${a.kerb.x.toFixed(0)}, ${a.kerb.z.toFixed(0)})`;
      checkKerb(a.kerb, where);
      expect(kerbOk(ground, a.kerb), where).toBe(true);
      expect(Math.hypot(a.kerb.px - a.doorX, a.kerb.pz - a.doorZ), where).toBeLessThanOrEqual(KERB_REACH);
      expect(a.street, where).toMatch(/^\d+ [A-Z]/);
      expect(a.area, where).not.toBe('');
    }
  });

  it('numbers the houses odd on the north and east sides, even on the others', () => {
    for (const l of terrain.lots.slice(0, 80)) {
      const n = Number(streetAddress(l).split(' ')[0]);
      expect(n % 2, l.id).toBe(l.front === 'N' || l.front === 'E' ? 1 : 0);
      expect(streetAddress(l)).toContain(l.street);
    }
  });
});

describe('deliveries jobs', () => {
  it('hands out jobs 300 m to 2.5 km away, never to the same door twice running', () => {
    const rng = mulberry32(5);
    const seen = new Set<string>();
    let last = '';
    for (let i = 0; i < 400; i++) {
      const from = i % 2 ? { x: DEPOT.vanX, z: DEPOT.vanZ } : { x: 1900 + (i % 7) * 150, z: -1500 + (i % 11) * 250 };
      const j = pickJob(addresses, from, rng, { last })!;
      expect(j).not.toBeNull();
      expect(j.to.lotId).not.toBe(last);
      expect(j.dist).toBeGreaterThanOrEqual(MIN_DIST);
      expect(j.dist).toBeLessThanOrEqual(Math.min(MAX_DIST, j.kind.maxDist));
      expect(j.dist).toBeCloseTo(Math.hypot(j.to.kerb.x - from.x, j.to.kerb.z - from.z), 6);
      expect(j.route).toBe(Math.round(j.dist * ROUTE_FACTOR));
      expect(j.time).toBe(timeLimit(j.route, j.kind));
      expect(j.pay).toBe(basePay(j.route, j.kind));
      expect(j.kind.contents).toContain(j.contents);
      seen.add(j.kind.id);
      last = j.to.lotId;
    }
    // Every kind of parcel comes up.
    expect(seen.size).toBe(PARCELS.length);
  });

  it('keeps valuables off the list while you are wanted', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 200; i++) expect(pickJob(addresses, DEPOT, rng, { wanted: true })!.kind.rule).not.toBe('valuable');
  });

  it('still finds somewhere out of town, and nothing with nowhere to go', () => {
    const rng = mulberry32(3);
    const far = pickJob(addresses, { x: 300, z: -8760 }, rng);
    expect(far).not.toBeNull();
    expect(far!.dist).toBeGreaterThan(150);
    expect(pickJob([], DEPOT, rng)).toBeNull();
    expect(pickJob(addresses.slice(0, 1), DEPOT, rng, { last: addresses[0].lotId })).toBeNull();
  });
});

describe('deliveries timing and pay', () => {
  const job = (id: string, route: number): Job => ({
    kind: kind(id), contents: '', to: addresses[0], dist: route / ROUTE_FACTOR, route, pay: basePay(route, kind(id)), time: timeLimit(route, kind(id)),
  });

  it('gives more time for longer routes, and less for rush jobs', () => {
    for (const p of PARCELS) expect(timeLimit(3000, p)).toBeGreaterThan(timeLimit(600, p));
    for (const r of [400, 1300, 3250]) {
      expect(timeLimit(r, kind('pizza'))).toBeLessThan(timeLimit(r, kind('papers')));
      // A van averaging 20 m/s on the road makes a standard job with time in hand.
      expect(r / 20).toBeLessThan(timeLimit(r, kind('papers')) * 0.9);
      // A rush job (only ever a short hop) wants about 25 m/s.
      if (r <= kind('pizza').maxDist * ROUTE_FACTOR) expect(r / 25).toBeLessThan(timeLimit(r, kind('pizza')));
      expect(timeLimit(r, kind('papers'))).toBeGreaterThanOrEqual(30);
    }
  });

  it('pays by distance times the kind of parcel', () => {
    expect(basePay(3000, kind('papers'))).toBeGreaterThan(basePay(600, kind('papers')));
    for (const id of ['pizza', 'chips', 'vase', 'slot']) expect(basePay(1300, kind(id)), id).toBeGreaterThan(basePay(1300, kind('papers')));
    for (const p of PARCELS) expect(basePay(1300, p) % 5).toBe(0);
  });

  it('adds an early bonus, all of it with half the clock left', () => {
    const j = job('papers', 1300);
    const full = payout(j, j.time * EARLY_FULL);
    expect(full.early).toBe(Math.round((j.pay * j.kind.early) / 5) * 5);
    expect(payout(j, j.time).early).toBe(full.early);
    expect(payout(j, 0).early).toBe(0);
    expect(payout(j, 0).total).toBe(j.pay);
    const mid = payout(j, j.time * EARLY_FULL * 0.5);
    expect(mid.early).toBeGreaterThan(0);
    expect(mid.early).toBeLessThan(full.early);
    expect(full.total).toBe(full.base + full.early);
    expect(full.broken).toBe(0);
  });

  it('cuts fragile pay with every knock, and ignores knocks for the rest', () => {
    const v = job('vase', 1300);
    const clean = payout(v, 0, 0);
    expect(clean.total).toBe(v.pay);
    const dented = payout(v, 0, FRAGILE_LIMIT / 3);
    expect(dented.total).toBeLessThan(clean.total);
    expect(dented.total).toBeGreaterThan(0);
    expect(dented.broken).toBe(clean.total - dented.total);
    expect(payout(v, 0, FRAGILE_LIMIT).total).toBe(0);
    expect(condition(0)).toBe(1);
    expect(condition(FRAGILE_LIMIT * 2)).toBe(0);
    expect(condition(-5)).toBe(1);
    const p = job('papers', 1300);
    expect(payout(p, 0, 40).total).toBe(p.pay);
  });

  it('makes a heavy van slow to pull away, but not to brake', () => {
    expect(heavySpeed(10, 12)).toBeCloseTo(10 + 2 * HEAVY_ACCEL);
    expect(heavySpeed(12, 10)).toBe(10);
    expect(heavySpeed(-3, -1)).toBe(-1);
    expect(heavySpeed(-1, 2)).toBeCloseTo(2 * HEAVY_ACCEL);
  });

  it('formats distances', () => {
    expect(fmtDist(1234)).toBe('1.2 km');
    expect(fmtDist(87)).toBe('90 m');
    expect(fmtDist(2)).toBe('10 m');
  });
});

describe('deliveries saves', () => {
  it('reads back what it wrote', () => {
    const r = { delivered: 12, earned: 3400, bestShift: 1200, bestCount: 7 };
    expect(readRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('throws out junk', () => {
    expect(readRecord(undefined)).toEqual(emptyRecord());
    expect(readRecord('lots')).toEqual(emptyRecord());
    expect(readRecord([3])).toEqual(emptyRecord());
    expect(readRecord({ delivered: -4, earned: NaN, bestShift: Infinity, bestCount: '9' })).toEqual(emptyRecord());
    expect(readRecord({ delivered: 2.7, earned: 100.9 })).toEqual({ delivered: 2, earned: 100, bestShift: 0, bestCount: 0 });
    // A best shift can't beat everything ever earned or delivered.
    expect(readRecord({ delivered: 3, earned: 500, bestShift: 9000, bestCount: 50 })).toEqual({ delivered: 3, earned: 500, bestShift: 500, bestCount: 3 });
    expect(readRecord({ delivered: 1e30, earned: 1e30 }).delivered).toBeLessThanOrEqual(1e7);
  });
});
