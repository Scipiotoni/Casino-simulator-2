import { describe, expect, it } from 'vitest';
import { CHIP_COUNT, CHIP_REWARD, CHIP_SPOTS, MILESTONES, milestoneAt, parseFound, settle } from '../src/activities/collectibles/spots';
import { Terrain } from '../src/world/terrain';
import { BRIDGE, mainlandY } from '../src/world/bridge';
import { SKINS } from '../src/chars/skins';

describe('lucky chip spots', () => {
  it('hides fifty chips, well spread out', () => {
    expect(CHIP_COUNT).toBe(50);
    expect(CHIP_SPOTS).toHaveLength(50);
    for (let i = 0; i < CHIP_SPOTS.length; i++) {
      for (let j = i + 1; j < CHIP_SPOTS.length; j++) {
        const a = CHIP_SPOTS[i];
        const b = CHIP_SPOTS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `chips ${i} and ${j}`).toBeGreaterThan(150);
      }
    }
    // The whole island: the city and the south, and Saguaro County up north.
    expect(CHIP_SPOTS.filter((s) => s.z < -3000).length).toBeGreaterThanOrEqual(15);
    expect(CHIP_SPOTS.filter((s) => s.z > -3000).length).toBeGreaterThanOrEqual(15);
    expect(CHIP_SPOTS.filter((s) => s.x < 0).length).toBeGreaterThanOrEqual(15);
  });

  it('keeps them all on the island (the mainland end of the bridge asks whether to cross)', () => {
    for (const s of CHIP_SPOTS) expect(s.x).toBeLessThan(BRIDGE.x1);
  });

  it('puts every chip on dry, walkable ground, clear of the lots', () => {
    const t = new Terrain();
    CHIP_SPOTS.forEach((s, i) => {
      for (const l of t.lots) {
        const inLot = s.x > l.x0 - 3 && s.x < l.x1 + 3 && s.z > l.z0 - 3 && s.z < l.z1 + 3;
        expect(inLot, `chip ${i} is on lot ${l.id}`).toBe(false);
      }
      // Deck chips sit on a pier or the bridge, over the water: the game settles them on it.
      if (s.deck) return;
      const ground = s.x > 6150 ? Math.max(t.heightAt(s.x, s.z), mainlandY(s.x, s.z)) : t.heightAt(s.x, s.z);
      expect(ground, `chip ${i} is in the water`).toBeGreaterThan(0.5);
      if (s.x < 6150) expect(t.slopeAt(s.x, s.z), `chip ${i} is on a cliff`).toBeGreaterThan(0.7);
    });
  }, 60000);
});

describe('saved chips', () => {
  it('keeps valid found chips, sorted and unique', () => {
    expect(parseFound({ found: [7, 3, 3, 49, 0] })).toEqual([0, 3, 7, 49]);
  });

  it('drops anything that is not a chip', () => {
    expect(parseFound({ found: [-1, 50, 2.5, '4', null, {}, NaN, Infinity, 1e9, 12] })).toEqual([12]);
    expect(parseFound(null)).toEqual([]);
    expect(parseFound(undefined)).toEqual([]);
    expect(parseFound('found')).toEqual([]);
    expect(parseFound(42)).toEqual([]);
    expect(parseFound({ found: 'all of them' })).toEqual([]);
    expect(parseFound({ found: { 0: 1 } })).toEqual([]);
    expect(parseFound([1, 2, 3])).toEqual([]);
  });

  it('copes with an absurdly long list', () => {
    const big = Array.from({ length: 100000 }, (_, i) => i % 60);
    expect(parseFound({ found: big })).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('settling a chip', () => {
  const flat = () => 5;

  it('keeps a free spot where it is', () => {
    expect(settle({ x: 10, z: 20 }, flat, () => true)).toEqual({ x: 10, y: 5, z: 20 });
  });

  it('steps round something solid', () => {
    // A 4 m crate on the spot.
    const free = (x: number, _y: number, z: number) => Math.abs(x - 10) > 2 || Math.abs(z - 20) > 2;
    const p = settle({ x: 10, z: 20 }, flat, free);
    expect(free(p.x, p.y, p.z)).toBe(true);
    expect(Math.hypot(p.x - 10, p.z - 20)).toBeLessThan(4.5);
  });

  it('keeps out of the water', () => {
    // The sea west of x = 0.
    const ground = (x: number) => (x < 0 ? null : 2);
    const p = settle({ x: -3, z: 0 }, ground, () => true);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBe(2);
  });

  it('falls back to the spot when there is nowhere better', () => {
    expect(settle({ x: 1, z: 2 }, flat, () => false)).toEqual({ x: 1, y: 5, z: 2 });
  });
});

describe('rewards', () => {
  it('pays bigger at 10, 25 and all 50, and dresses you for it', () => {
    expect(CHIP_REWARD).toBeGreaterThan(0);
    expect(milestoneAt(10)?.bonus).toBeGreaterThan(CHIP_REWARD);
    expect(milestoneAt(25)!.bonus).toBeGreaterThan(milestoneAt(10)!.bonus);
    expect(milestoneAt(50)!.bonus).toBeGreaterThan(milestoneAt(25)!.bonus);
    for (const n of [0, 1, 9, 11, 24, 26, 49, 51]) expect(milestoneAt(n)).toBeNull();
    const skin = milestoneAt(50)?.skin;
    expect(skin && SKINS.some((s) => s.id === skin)).toBe(true);
    expect(MILESTONES.every((m) => m.at <= CHIP_COUNT)).toBe(true);
  });
});
