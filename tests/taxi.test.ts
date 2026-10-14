import { beforeAll, describe, expect, it } from 'vitest';
import { Terrain } from '../src/world/terrain';
import { mulberry32 } from '../src/core/noise';
import {
  BASE_FARE, CARE_TIP, METER_CAP, PER_KM, PLACES, SPEED_TIP, TRIP_MIN, chooseStop, clock, emptyRecord, hotelPlaces, kerbOk, meterFare, payment,
  pickupKerb, placeStop, readRecord, routeEstimate, STAND, timeLimit, waitLimit, type Ground, type Kerb, type Stop,
} from '../src/activities/taxi/fares';

let terrain: Terrain;
let ground: Ground;
let stops: Stop[];

beforeAll(() => {
  terrain = new Terrain();
  ground = { roads: terrain.roads, lots: terrain.lots, isLand: (x, z) => terrain.isLand(x, z) };
  stops = [...PLACES, ...hotelPlaces(terrain.lots)].map((p) => placeStop(ground, p)).filter((s): s is Stop => !!s);
}, 60000);

/** On land, off every lot, on the road it names and inside its paving (the cab's spot) or just off it (the passenger's). */
function checkKerb(k: Kerb, where: string): void {
  expect(terrain.isLand(k.px, k.pz), where).toBe(true);
  expect(terrain.isLand(k.x, k.z), where).toBe(true);
  for (const [x, z] of [[k.px, k.pz], [k.x, k.z]]) expect(terrain.lots.find((l) => x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1), where).toBeUndefined();
  const road = terrain.roads.find((r) => r.road.id === k.road)!;
  expect(road, where).toBeDefined();
  const near = terrain.nearestRoad(k.x, k.z, 30);
  expect(near, where).not.toBeNull();
  expect(near!.dist, where).toBeLessThan(near!.profile.road.width / 2);
  const p = terrain.nearestRoad(k.px, k.pz, 30);
  expect(p, where).not.toBeNull();
  expect(p!.dist, where).toBeGreaterThan(p!.profile.road.width / 2);
  expect(p!.dist, where).toBeLessThan(p!.profile.road.width / 2 + 3);
  // The passenger and the cab's spot are a car's width or so apart, the passenger facing the road.
  const gap = Math.hypot(k.px - k.x, k.pz - k.z);
  expect(gap, where).toBeGreaterThan(3);
  expect(gap, where).toBeLessThan(5);
  const fx = Math.sin(k.yaw);
  const fz = Math.cos(k.yaw);
  expect((k.x - k.px) * fx + (k.z - k.pz) * fz, where).toBeGreaterThan(gap * 0.99);
}

describe('taxi stand', () => {
  it('sits on the Golden Viper forecourt, clear of the hall, with the cab at the Strip kerb', () => {
    const lot = terrain.lots.find((l) => l.special === 'goldenViper')!;
    expect(STAND.x).toBeGreaterThan(lot.x0);
    expect(STAND.x + 1.5).toBeLessThan(lot.x1);
    expect(STAND.z - 3).toBeGreaterThan(lot.z0);
    // The hall is 56 m wide round the middle of the frontage.
    expect(Math.abs(STAND.z - (lot.z0 + lot.z1) / 2)).toBeGreaterThan(28 + 6);
    const road = terrain.nearestRoad(STAND.cabX, STAND.cabZ, 30)!;
    expect(road.profile.road.id).toBe('x2600');
    expect(road.dist + 1).toBeLessThan(road.profile.road.width / 2);
    // Clear of the southbound traffic lane (6.2 m out from the middle).
    expect(road.dist - 6.2).toBeGreaterThan(2.3);
  });
});

describe('taxi destinations', () => {
  it('finds a kerb for every place passengers ask for', () => {
    const hotels = hotelPlaces(terrain.lots);
    expect(hotels.length).toBe(4);
    for (const p of [...PLACES, ...hotels]) expect(placeStop(ground, p), p.id).not.toBeNull();
    expect(new Set(stops.map((s) => s.place.id)).size).toBe(stops.length);
  });

  it('stops on the right road, on land, beside the place and clear of junctions', () => {
    for (const s of stops) {
      const where = `${s.place.id} at (${s.kerb.x.toFixed(0)}, ${s.kerb.z.toFixed(0)})`;
      checkKerb(s.kerb, where);
      expect(kerbOk(ground, s.kerb), where).toBe(true);
      // Close to the place itself.
      expect(Math.hypot(s.kerb.px - s.goX, s.kerb.pz - s.goZ), where).toBeLessThan(s.place.lot ? 60 : 160);
      if (s.place.roads) expect(s.place.roads, where).toContain(s.kerb.road);
      for (const r of terrain.roads) {
        if (r.road.id === s.kerb.road) continue;
        const d = terrain.nearestRoad(s.kerb.x, s.kerb.z, 40);
        if (d && d.profile === r) expect(d.dist, where).toBeGreaterThan(r.road.width / 2);
      }
    }
  });

  it('puts the casinos on their streets and the far places out of town', () => {
    const at = (id: string) => stops.find((s) => s.place.id === id)!;
    expect(at('viper').kerb.road).toBe('x2600');
    expect(at('lagoon').kerb.road).toMatch(/^[xz]/);
    expect(at('dustwater').kerb.road).toBe('lakeshore');
    expect(at('halibut').kerb.road).toBe('route1n');
    expect(at('marina').kerb.road).toBe('marina');
    expect(at('beach').kerb.road).toBe('beach');
  });
});

describe('taxi pickups', () => {
  it('finds passengers 150-600 m from the cab, on a kerb that works', () => {
    const rng = mulberry32(7);
    for (const [x, z] of [[STAND.x, STAND.z], [2600, -300], [1700, 900], [-1300, 2760], [1100, -6000], [3450, 1900], [300, -8760]]) {
      for (let i = 0; i < 6; i++) {
        const k = pickupKerb(ground, x, z, rng);
        expect(k, `near (${x}, ${z})`).not.toBeNull();
        const d = Math.hypot(k!.px - x, k!.pz - z);
        const where = `pickup (${k!.px.toFixed(0)}, ${k!.pz.toFixed(0)}) for (${x}, ${z})`;
        expect(d, where).toBeGreaterThan(140);
        if (x > 1000 && x < 3600 && z > -2200 && z < 1600) expect(d, where).toBeLessThan(610);
        checkKerb(k!, where);
      }
    }
  });

  it('sends passengers somewhere a fair ride away, never back where the last one went', () => {
    const rng = mulberry32(11);
    const from = { x: 2600, z: -300 };
    let far = 0;
    for (let i = 0; i < 300; i++) {
      const s = chooseStop(stops, from, rng, 'viper')!;
      expect(s).not.toBeNull();
      expect(s.place.id).not.toBe('viper');
      const d = Math.hypot(s.kerb.x - from.x, s.kerb.z - from.z);
      expect(d).toBeGreaterThanOrEqual(TRIP_MIN);
      if (d > 3200) far++;
    }
    // Long hauls happen, but not often.
    expect(far).toBeGreaterThan(5);
    expect(far).toBeLessThan(150);
    // Even out in the sticks there's somewhere to go.
    expect(chooseStop(stops, { x: 300, z: -8760 }, rng)).not.toBeNull();
  });
});

describe('taxi fares', () => {
  it('runs the meter on distance from the flag fall, capped over the expected route', () => {
    expect(meterFare(0, 1000)).toBe(BASE_FARE);
    expect(meterFare(1000, 1000)).toBe(BASE_FARE + PER_KM);
    expect(meterFare(500, 1000)).toBeLessThan(meterFare(1000, 1000));
    const cap = meterFare(routeEstimate(1000) * METER_CAP, 1000);
    expect(meterFare(1e6, 1000)).toBe(cap);
    expect(routeEstimate(1000)).toBeGreaterThan(1000);
  });

  it('gives time for the trip and longer trips more of it', () => {
    expect(timeLimit(400)).toBeGreaterThan(400 / 15);
    expect(timeLimit(3000)).toBeGreaterThan(timeLimit(1000));
    // A cab averaging 20 m/s on the real route makes it with time to spare.
    for (const d of [400, 1000, 3000, 7000]) expect(routeEstimate(d) / 20).toBeLessThan(timeLimit(d) * 0.75);
    expect(waitLimit(100)).toBeGreaterThanOrEqual(60);
    expect(waitLimit(600)).toBeGreaterThan(waitLimit(150));
  });

  it('tips for a quick ride and for not crashing', () => {
    const best = payment(1300, 1000, 10, 100, 0);
    expect(best.speedTip).toBe(Math.round(best.fare * SPEED_TIP));
    expect(best.careTip).toBe(Math.round(best.fare * CARE_TIP));
    expect(best.total).toBe(best.fare + best.speedTip + best.careTip);
    const slow = payment(1300, 1000, 90, 100, 0);
    expect(slow.speedTip).toBe(0);
    expect(slow.careTip).toBe(best.careTip);
    const crashed = payment(1300, 1000, 10, 100, 30);
    expect(crashed.careTip).toBe(0);
    expect(crashed.speedTip).toBe(best.speedTip);
    const dented = payment(1300, 1000, 10, 100, 6);
    expect(dented.careTip).toBeGreaterThan(0);
    expect(dented.careTip).toBeLessThan(best.careTip);
    const mid = payment(1300, 1000, 50, 100, 0);
    expect(mid.speedTip).toBeGreaterThan(0);
    expect(mid.speedTip).toBeLessThan(best.speedTip);
    // Never less than the straight line, however the cab got there.
    expect(payment(0, 1000, 10, 100, 0).fare).toBe(meterFare(1000, 1000));
    expect(payment(1300, 1000, 120, 100, 0).speedTip).toBe(0);
  });

  it('formats the clock', () => {
    expect(clock(83.4)).toBe('1:24');
    expect(clock(5)).toBe('0:05');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('taxi saves', () => {
  it('reads back what it wrote', () => {
    const r = { fares: 12, earned: 3400, bestShift: 1200, bestFares: 7 };
    expect(readRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('throws out junk', () => {
    expect(readRecord(null)).toEqual(emptyRecord());
    expect(readRecord('lots')).toEqual(emptyRecord());
    expect(readRecord([1, 2])).toEqual(emptyRecord());
    expect(readRecord({ fares: -4, earned: NaN, bestShift: Infinity, bestFares: '9' })).toEqual(emptyRecord());
    expect(readRecord({ fares: 2.7, earned: 100.9 })).toEqual({ fares: 2, earned: 100, bestShift: 0, bestFares: 0 });
    // A best shift can't beat everything ever earned.
    expect(readRecord({ fares: 3, earned: 500, bestShift: 9000, bestFares: 50 })).toEqual({ fares: 3, earned: 500, bestShift: 500, bestFares: 3 });
    expect(readRecord({ fares: 1e30, earned: 1e30 }).fares).toBeLessThanOrEqual(1e7);
  });
});
