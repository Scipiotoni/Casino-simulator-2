import { beforeAll, describe, expect, it } from 'vitest';
import { Terrain } from '../src/world/terrain';
import { BRIDGE } from '../src/world/bridge';
import { VEHICLES } from '../src/vehicles/models';
import {
  ROUTES, buildCourse, formatTime, gateRadius, medalFor, payout, prizeFor, readRecords, segmentDistance, splitDelta, type Course,
} from '../src/activities/races/routes';

let terrain: Terrain;
let courses: Course[];

beforeAll(() => {
  terrain = new Terrain();
  courses = ROUTES.map((r) => buildCourse(terrain.roads, r));
}, 60000);

const onDeck = (x: number, z: number) => x >= BRIDGE.x0 - 5 && x <= BRIDGE.x1 && Math.abs(z - BRIDGE.z) < BRIDGE.width / 2;

describe('race routes', () => {
  it('has a city sprint, a coast run, a mountain run, the bridge and a long loop', () => {
    expect(ROUTES.map((r) => r.id)).toEqual(['strip', 'coast', 'thunder', 'bridge', 'loop']);
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
  });

  it('puts every checkpoint on a drivable road, on land and outside the city lots', () => {
    for (const c of courses) {
      expect(c.gates.length).toBeGreaterThanOrEqual(6);
      expect(c.gates.length).toBeLessThanOrEqual(20);
      for (const q of [c.start, ...c.gates]) {
        const where = `${c.route.id} at (${q.x.toFixed(0)}, ${q.z.toFixed(0)})`;
        expect(terrain.lots.find((l) => q.x > l.x0 && q.x < l.x1 && q.z > l.z0 && q.z < l.z1), where).toBeUndefined();
        if (onDeck(q.x, q.z)) continue;
        expect(terrain.heightAt(q.x, q.z), where).toBeGreaterThan(0.3);
        const road = terrain.nearestRoad(q.x, q.z, 40);
        expect(road, where).not.toBeNull();
        expect(road!.dist, where).toBeLessThan(road!.profile.road.width / 2);
      }
    }
  });

  it('spaces checkpoints so a minute between them is plenty, and loops end where they start', () => {
    for (const c of courses) {
      let s = 0;
      for (const q of c.gates) {
        expect(q.s).toBeGreaterThan(s);
        expect(q.s - s).toBeLessThan(1100);
        s = q.s;
      }
      expect(c.gates[c.gates.length - 1].s).toBeCloseTo(c.length, 3);
      const end = c.gates[c.gates.length - 1];
      if (c.route.loop) expect(Math.hypot(end.x - c.start.x, end.z - c.start.z)).toBeLessThan(gateRadius(end));
    }
  });

  it('sets medal times a fast car can beat and an ordinary one can reach', () => {
    const muscle = VEHICLES.find((v) => v.id === 'muscle')!;
    const hatch = VEHICLES.find((v) => v.id === 'hatch')!;
    for (const c of courses) {
      const [gold, silver, bronze] = c.route.medals;
      expect(gold).toBeLessThan(silver);
      expect(silver).toBeLessThan(bronze);
      // Gold averages well under a muscle car's top speed; bronze is an easy pace for a hatchback.
      expect(c.length / gold).toBeLessThan(muscle.top * 0.75);
      expect(c.length / bronze).toBeLessThan(hatch.top * 0.8);
      expect(c.length / bronze).toBeGreaterThan(15);
    }
  });
});

describe('race rules', () => {
  it('awards medals by time', () => {
    const m = [90, 110, 130] as const;
    expect(medalFor(85, m)).toBe('gold');
    expect(medalFor(90, m)).toBe('gold');
    expect(medalFor(100, m)).toBe('silver');
    expect(medalFor(125, m)).toBe('bronze');
    expect(medalFor(200, m)).toBe('finish');
  });

  it('scales prizes with the route length', () => {
    expect(prizeFor('gold', 5000)).toBe(3000);
    expect(prizeFor('silver', 5000)).toBe(1500);
    expect(prizeFor('bronze', 5000)).toBe(750);
    expect(prizeFor('finish', 5000)).toBe(250);
    expect(prizeFor('gold', 20000)).toBe(12000);
    expect(prizeFor('gold', 1000)).toBe(1800);
  });

  it('only pays the step up from the best medal already won', () => {
    expect(payout(null, 'silver', 5000)).toBe(1500);
    expect(payout('silver', 'silver', 5000)).toBe(0);
    expect(payout('silver', 'bronze', 5000)).toBe(0);
    expect(payout('silver', 'gold', 5000)).toBe(1500);
    expect(payout('finish', 'bronze', 5000)).toBe(500);
    expect(payout('gold', 'gold', 5000)).toBe(0);
    // Winning gold in steps pays the same as winning it at once.
    const steps = payout(null, 'finish', 7000) + payout('finish', 'bronze', 7000) + payout('bronze', 'silver', 7000) + payout('silver', 'gold', 7000);
    expect(steps).toBe(payout(null, 'gold', 7000));
  });

  it('formats times and splits', () => {
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(5)).toBe('0:05.00');
    expect(formatTime(-1)).toBe('0:00.00');
    expect(splitDelta(40.5, 41.74)).toBe('-1.24');
    expect(splitDelta(42.3, 41.5)).toBe('+0.80');
  });

  it('measures how close the line driven came to a checkpoint', () => {
    expect(segmentDistance(0, 0, 10, 0, 5, 3)).toBeCloseTo(3);
    expect(segmentDistance(0, 0, 10, 0, -4, 3)).toBeCloseTo(5);
    expect(segmentDistance(2, 2, 2, 2, 5, 6)).toBeCloseTo(5);
  });
});

describe('race saves', () => {
  it('keeps good records and their splits', () => {
    const splits = Array.from({ length: 10 }, (_, i) => (i + 1) * 9.5);
    const rec = readRecords(JSON.parse(JSON.stringify({ best: { strip: { time: 95, medal: 'gold', splits }, loop: { time: 600, medal: 'bronze' } } })));
    expect(rec.strip).toEqual({ time: 95, medal: 'gold', splits });
    expect(rec.loop).toEqual({ time: 600, medal: 'bronze' });
  });

  it('drops junk, unknown routes, bad medals and impossible times', () => {
    expect(readRecords(null)).toEqual({});
    expect(readRecords('fast')).toEqual({});
    expect(readRecords({ best: [1, 2] })).toEqual({});
    const rec = readRecords({
      best: {
        strip: { time: Number.NaN, medal: 'gold' },
        coast: { time: 100, medal: 'platinum' },
        thunder: { time: 2, medal: 'gold' },
        bridge: { time: '90', medal: 'gold' },
        moon: { time: 100, medal: 'gold' },
        loop: { time: 500, medal: 'silver', splits: [1, 2, 3] },
        __proto__: { time: 100, medal: 'gold' },
      },
    });
    expect(rec).toEqual({ loop: { time: 500, medal: 'silver' } });
  });

  it('drops splits that go backwards or don\'t end on the time', () => {
    const back = Array.from({ length: 10 }, (_, i) => (i === 4 ? 1 : (i + 1) * 10));
    const off = Array.from({ length: 10 }, (_, i) => (i + 1) * 10);
    const rec = readRecords({ best: { strip: { time: 100, medal: 'silver', splits: back }, bridge: { time: 120, medal: 'silver', splits: off } } });
    expect(rec.strip.splits).toBeUndefined();
    expect(rec.bridge.splits).toBeUndefined();
  });
});
