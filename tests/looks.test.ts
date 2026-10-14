import { describe, expect, it } from 'vitest';
import { DEFAULT_FACE, appearanceFromSkin, lockPieces, pieceUnlocked, sanitizeAppearance, type Appearance } from '../src/chars/skins';

const base = appearanceFromSkin('rookie');

function custom(): Appearance {
  return {
    ...appearanceFromSkin('rookieF'),
    skinId: 'custom',
    face: { ...DEFAULT_FACE, brows: 'arched', beard: 'none', lips: 'red', marks: 'freckles', lashes: true, eyeShape: 'round', makeup: 'shadow', makeupColor: 0x3a6fd8 },
    hairColor: 0x123456,
    height: 1.04,
    build: 0.95,
    outfit: { ...appearanceFromSkin('rookieF').outfit, top: 'hoodie', hat: 'beanie', c1: 0xabcdef, glow: false },
  };
}

describe('custom looks', () => {
  it('keeps a valid custom look as it is', () => {
    const a = custom();
    expect(sanitizeAppearance(JSON.parse(JSON.stringify(a)), base)).toEqual(a);
  });

  it('drops unknown pieces, bad colours and out-of-range sizes', () => {
    const raw = custom() as unknown as Record<string, unknown>;
    raw.outfit = { ...(raw.outfit as object), top: 'spacesuit', c1: 'red', pants: 0x1000000, gloves: 'yes' };
    raw.face = { brows: 'monobrow', beard: 'full', lips: 42, marks: 'none', lashes: 1 };
    raw.eyes = 'laser';
    raw.height = 3;
    raw.build = Number.NaN;
    const a = sanitizeAppearance(raw, base);
    expect(a.outfit.top).toBe(base.outfit.top);
    expect(a.outfit.c1).toBe(base.outfit.c1);
    expect(a.outfit.pants).toBe(base.outfit.pants);
    expect(a.outfit.gloves).toBe(base.outfit.gloves);
    expect(a.face).toEqual({ ...DEFAULT_FACE, beard: 'full' });
    expect(a.eyes).toBe(base.eyes);
    expect(a.height).toBe(1.08);
    expect(a.build).toBe(1);
  });

  it('rebuilds a catalog outfit from the catalog but keeps the wearer', () => {
    const raw = { ...custom(), skinId: 'kingpin', outfit: { ...custom().outfit, top: 'tee' } };
    const a = sanitizeAppearance(raw, base);
    expect(a.outfit).toEqual(appearanceFromSkin('kingpin').outfit);
    expect(a.face?.lips).toBe('red');
    expect(a.hairColor).toBe(0x123456);
    expect(a.body).toBe('f');
  });

  it('fills in face fields that older saves and other players leave out', () => {
    const raw = { ...custom(), face: { brows: 'thin', beard: 'goatee', lips: 'pink', marks: 'none', lashes: false } };
    const a = sanitizeAppearance(raw, base);
    expect(a.face).toEqual({ ...DEFAULT_FACE, brows: 'thin', beard: 'goatee', lips: 'pink' });
  });

  it('checks the new face fields too', () => {
    const raw = { ...custom(), face: { ...DEFAULT_FACE, eyeShape: 'cat', makeup: 'glitter', makeupColor: -1, lipShape: 'huge', paintColor: 'blue' } };
    expect(sanitizeAppearance(raw, base).face).toEqual(DEFAULT_FACE);
  });

  it('falls back on junk', () => {
    expect(sanitizeAppearance(null, base)).toBe(base);
    expect(sanitizeAppearance('hello', base)).toBe(base);
  });

  it('locks special pieces until an outfit that has them is owned', () => {
    expect(pieceUnlocked('hat', 'crown', ['rookie'])).toBe(false);
    expect(pieceUnlocked('hat', 'crown', ['rookie', 'kingpin'])).toBe(true);
    expect(pieceUnlocked('hat', 'beanie', [])).toBe(true);
    expect(pieceUnlocked('glow', true, ['rookie'])).toBe(false);
    expect(pieceUnlocked('glow', false, ['rookie'])).toBe(true);
  });

  it('takes locked pieces off a custom look, never off a catalog outfit', () => {
    const a = { ...custom(), outfit: { ...custom().outfit, hat: 'crown' as const, back: 'wings' as const, glow: true } };
    const locked = lockPieces(a, ['rookie']);
    expect(locked.outfit.hat).toBe('none');
    expect(locked.outfit.back).toBe('none');
    expect(locked.outfit.glow).toBe(false);
    expect(lockPieces(a, ['rookie', 'kingpin', 'cybercroupier']).outfit.hat).toBe('crown');
    const catalog = appearanceFromSkin('kingpin');
    expect(lockPieces(catalog, ['rookie'])).toBe(catalog);
  });
});
