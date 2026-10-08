import { describe, expect, it } from 'vitest';
import { rollAngle, rollProgress, rollSpeed, rollSwell, rollTuck } from '../src/chars/anim';

describe('dodge roll curves', () => {
  it('turns the body exactly once, forwards only', () => {
    expect(rollAngle(0)).toBe(0);
    expect(rollAngle(1)).toBeCloseTo(Math.PI * 2, 10);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const a = rollAngle(i / 100);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
  });

  it('covers the whole distance, never stopping or going back', () => {
    expect(rollProgress(0)).toBe(0);
    expect(rollProgress(1)).toBeCloseTo(1, 10);
    for (let i = 1; i <= 100; i++) expect(rollProgress(i / 100) - rollProgress((i - 1) / 100)).toBeGreaterThan(0.005);
  });

  it('has a speed curve that matches the distance curve', () => {
    for (const u of [0.02, 0.2, 0.44, 0.7, 0.9]) {
      const h = 1e-5;
      expect(rollSpeed(u)).toBeCloseTo((rollProgress(u + h) - rollProgress(u - h)) / (2 * h), 4);
    }
  });

  it('starts and ends standing, with the camera back where it was', () => {
    for (const f of [rollTuck, rollSwell]) {
      expect(f(0)).toBeCloseTo(0, 10);
      expect(f(1)).toBeCloseTo(0, 10);
    }
    expect(rollTuck(0.45)).toBeCloseTo(1, 5);
  });
});
