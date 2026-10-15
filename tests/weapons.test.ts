import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponDef } from '../src/weapons/catalog';
import { ATTACHMENTS, compatible } from '../src/weapons/attachments';
import { DEFAULT_LOADOUT, SLOTS, equip, finalWeapon, sanitizeArmory, sanitizeLoadout, slotOptions, weaponSlots, type Loadout } from '../src/weapons/loadout';

const L = (o: Partial<Loadout> = {}): Loadout => ({ ...DEFAULT_LOADOUT, ...o });

describe('weapon catalog', () => {
  it('has 30+ weapons with unique ids and names, including launchers and a minigun', () => {
    expect(WEAPONS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
    expect(new Set(WEAPONS.map((w) => w.name)).size).toBe(WEAPONS.length);
    expect(WEAPONS.filter((w) => w.cls === 'launcher').length).toBeGreaterThanOrEqual(4);
    expect(WEAPONS.some((w) => w.id === 'minigun' && w.stats.spinUp > 0)).toBe(true);
  });

  it('keeps the ids older saves and NPCs use', () => {
    for (const id of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'sniper', 'goldcannon']) expect(weaponDef(id).id).toBe(id);
  });

  it('gives every weapon sane stats and parts that come with it free', () => {
    for (const w of WEAPONS) {
      for (const [k, v] of Object.entries(w.stats)) expect(Number.isFinite(v) && v >= 0, `${w.id}.${k}`).toBe(true);
      for (const list of [w.barrels, w.mags, w.stocks]) if (list.length) expect(list[0].price, w.id).toBe(0);
      if (w.mags.length) expect(w.mags[0].mag, w.id).toBe(w.stats.mag);
      expect(w.projectile === 'hitscan' || w.stats.splash > 0, w.id).toBe(true);
    }
  });
});

describe('what fits what', () => {
  it('keeps big scopes off pistols and pistol dots off rifles’ slides', () => {
    const pistol = weaponDef('pistol');
    expect(compatible(pistol, 'optic').map((a) => a.id)).toEqual(['microdot']);
    const sniper = weaponDef('sniper');
    expect(compatible(sniper, 'optic').map((a) => a.id)).toContain('scope12');
    expect(compatible(weaponDef('rifle'), 'optic').map((a) => a.id)).not.toContain('scope12');
  });

  it('screws muzzles onto the right threads only', () => {
    expect(compatible(weaponDef('rifle'), 'muzzle').map((a) => a.id)).toContain('supp556');
    expect(compatible(weaponDef('rifle'), 'muzzle').map((a) => a.id)).not.toContain('supp762');
    expect(compatible(weaponDef('ak47'), 'muzzle').map((a) => a.id)).toContain('supp762');
    expect(compatible(weaponDef('shotgun'), 'muzzle').map((a) => a.id)).toEqual(expect.arrayContaining(['choke', 'duckbill']));
    expect(compatible(weaponDef('revolver'), 'muzzle')).toEqual([]);
  });

  it('gives launchers and the minigun nothing to bolt on except cosmetics', () => {
    for (const id of ['rpg7', 'at4', 'm202', 'homing', 'minigun']) expect(weaponSlots(weaponDef(id)), id).toEqual([]);
  });

  it('gives every attachment at least one weapon, and the rifles most of them', () => {
    for (const a of ATTACHMENTS) expect(WEAPONS.some((w) => compatible(w, a.slot).includes(a)), a.id).toBe(true);
    expect(weaponSlots(weaponDef('rifle'))).toEqual([...SLOTS]);
  });

  it('closes the muzzle when the barrel has a suppressor built in', () => {
    const l = sanitizeLoadout('smg', { barrel: 'sd', muzzle: 'supp9' });
    expect(l.barrel).toBe('sd');
    expect(l.muzzle).toBeUndefined();
    expect(finalWeapon('smg', l).suppressed).toBe(true);
  });
});

describe('gunsmith maths', () => {
  it('builds every option on every weapon into finite stats', () => {
    for (const w of WEAPONS) {
      for (const s of weaponSlots(w)) {
        for (const o of slotOptions(w, s)) {
          const f = finalWeapon(w.id, equip(w.id, L(), s, o.id));
          for (const [k, v] of Object.entries(f.stats)) expect(Number.isFinite(v) && v >= 0, `${w.id}/${s}/${o.id}/${k}`).toBe(true);
          expect(f.adsFov).toBeGreaterThan(3);
        }
      }
    }
  });

  it('changes the stats the parts say they change', () => {
    const base = finalWeapon('rifle');
    expect(finalWeapon('rifle', L({ magazine: 'drum' })).stats.mag).toBe(60);
    expect(finalWeapon('rifle', L({ underbarrel: 'vgrip' })).stats.recoilV).toBeLessThan(base.stats.recoilV);
    expect(finalWeapon('rifle', L({ barrel: 'long' })).stats.range).toBeGreaterThan(base.stats.range);
    expect(finalWeapon('rifle', L({ optic: 'acog' })).zoom).toBe(4);
    expect(finalWeapon('rifle', L({ optic: 'acog' })).adsFov).toBeLessThan(base.adsFov);
    expect(finalWeapon('rifle', L({ muzzle: 'supp556' })).suppressed).toBe(true);
    expect(finalWeapon('rifle', L({ laser: 'laserGreen' })).beam).toBe(0x2aff6a);
    expect(finalWeapon('m9', L({ stock: 'brace' })).fire).toBe('burst');
  });

  it('drops parts that don’t fit when a loadout is read back', () => {
    const l = sanitizeLoadout('pistol', { optic: 'scope12', muzzle: 'supp556', underbarrel: 'vgrip', magazine: 'drum', camo: 'gold', charm: 'duck', reticle: 'spade', reticleColor: 0x2aff6a });
    expect(l).toEqual({ ...DEFAULT_LOADOUT, magazine: 'drum', camo: 'gold', charm: 'duck', reticle: 'spade', reticleColor: 0x2aff6a });
    expect(sanitizeLoadout('rifle', 'junk')).toEqual(DEFAULT_LOADOUT);
  });

  it('reads back an armory, keeping the guns an older save owned', () => {
    const a = sanitizeArmory({ owned: ['ak47', 'laser-sword'], parts: ['optic:reddot', 7], kills: { ak47: 12.6, nope: 3, rifle: -1 }, loadouts: { ak47: { muzzle: 'supp762' } } }, ['pistol']);
    expect(a.owned).toEqual(['ak47', 'pistol']);
    expect(a.parts).toEqual(['optic:reddot']);
    expect(a.kills).toEqual({ ak47: 12 });
    expect(a.loadouts.ak47.muzzle).toBe('supp762');
    expect(a.loadouts.pistol).toEqual(DEFAULT_LOADOUT);
  });
});
