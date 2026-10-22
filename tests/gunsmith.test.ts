import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponDef } from '../src/weapons/catalog';
import { attachment } from '../src/weapons/attachments';
import { DEFAULT_LOADOUT, equip } from '../src/weapons/loadout';
import { Armory } from '../src/weapons/armory';
import { misfits, slotClosed, whyNot, keyBars, statScore } from '../src/weapons/fitting';
import { GUN_STORES, storeStock, storesSelling } from '../src/weapons/stores';
import { wheelPages } from '../src/ui/wheel';
import { cityLots } from '../src/world/layout';

const L = DEFAULT_LOADOUT;
const why = (w: string, a: string, l = L) => whyNot(weaponDef(w), attachment(a)!, l);

describe('fit reasons', () => {
  it('explain why a part does not fit, from the data', () => {
    expect(why('m1911', 'reddot')).toBe('Needs a rail');
    expect(why('rifle', 'supp762')).toBe('Wrong thread: needs 7.62');
    expect(why('rifle', 'scope8')).toBe('Marksman rifles and snipers only');
    expect(why('rifle', 'scope12')).toBe('Snipers only');
    expect(why('m9', 'reddot')).toMatch(/No optic mount/);
    expect(why('aug', 'reddot')).toMatch(/own fixed sight/);
    expect(why('revolver', 'supp9')).toBe('No threaded muzzle');
    expect(why('pistol', 'vgrip')).toBe('Needs a rail under the barrel');
    expect(why('uzi', 'laserRed')).toBe('Needs a side rail');
    const sd = equip('smg', L, 'barrel', 'sd');
    expect(why('smg', 'supp9', sd)).toBe('The SD barrel has a suppressor built in');
    expect(why('smg', 'supp9')).toBeNull();
    expect(why('rifle', 'acog')).toBeNull();
  });

  it('give every misfit a reason and never list something that fits', () => {
    for (const w of WEAPONS) {
      for (const slot of ['optic', 'muzzle', 'underbarrel', 'laser'] as const) {
        for (const m of misfits(w, slot, L)) expect(m.reason.length).toBeGreaterThan(5);
      }
    }
    expect(slotClosed(weaponDef('rpg7'), 'muzzle')).toBe('No muzzle thread');
    expect(slotClosed(weaponDef('rifle'), 'optic')).toBeNull();
  });

  it('score stats between 0 and 1, higher better', () => {
    for (const w of WEAPONS) for (const b of keyBars(w.stats)) expect(b.v).toBeGreaterThanOrEqual(0), expect(b.v).toBeLessThanOrEqual(1);
    expect(statScore('reload', 1)).toBeGreaterThan(statScore('reload', 3));
    expect(statScore('range', 200)).toBeGreaterThan(statScore('range', 30));
  });
});

describe('prices and unlocks', () => {
  it('charge for parts until bought, then fit them', () => {
    const a = new Armory();
    a.give('rifle');
    expect(a.price('rifle', 'optic', 'acog')).toBe(attachment('acog')!.price);
    a.fit('rifle', 'optic', 'acog');
    expect(a.loadout('rifle').optic).toBeUndefined();
    a.unlock('rifle', 'optic', 'acog');
    expect(a.price('rifle', 'optic', 'acog')).toBe(0);
    a.fit('rifle', 'optic', 'acog');
    expect(a.loadout('rifle').optic).toBe('acog');
    expect(a.unlocked('rifle', 'camo', 'gold')).toBe(false);
    for (let i = 0; i < 100; i++) a.addKill('rifle');
    expect(a.unlocked('rifle', 'camo', 'gold')).toBe(true);
  });
});

describe('save migration', () => {
  it('keeps the guns of saves that only had a weapon list, and new games start with none', () => {
    const a = new Armory();
    a.load(undefined, ['pistol', 'shotgun', 'nonsense']);
    expect(a.owned).toEqual(['pistol', 'shotgun']);
    const b = new Armory();
    b.load(a.state(), []);
    expect(b.owned).toEqual(['pistol', 'shotgun']);
    const c = new Armory();
    c.load(undefined, []);
    expect(c.owned).toEqual([]);
  });
});

describe('gun stores', () => {
  it('sell every weapon but the secret ones, and only real ids', () => {
    for (const s of GUN_STORES) {
      expect(storeStock(s).length).toBe(s.stock.length);
      for (const id of s.stock) expect(WEAPONS.some((w) => w.id === id && !w.secret), id).toBe(true);
    }
    for (const w of WEAPONS) expect(storesSelling(w.id).length > 0, w.id).toBe(!w.secret);
  });

  it('have their own emphasis: the desert sells the heavy stuff', () => {
    const desert = GUN_STORES.find((s) => s.key === 'gunDesert')!;
    for (const id of ['rpg7', 'minigun', 'm249', 'pkm']) expect(desert.stock).toContain(id);
    const downtown = GUN_STORES.find((s) => s.key === 'gunShop')!;
    expect(storeStock(downtown).every((w) => ['pistol', 'smg', 'rifle', 'shotgun'].includes(w.cls))).toBe(true);
  });

  it('each have a lot of their own that was never for sale, round the island', () => {
    const lots = cityLots();
    const mine = GUN_STORES.map((s) => lots.find((l) => l.special === s.key));
    for (const l of mine) expect(l?.forSale).toBe(false);
    expect(new Set(mine.map((l) => l!.id)).size).toBe(GUN_STORES.length);
    expect(new Set(mine.map((l) => l!.district)).size).toBe(4);
  });

  it('put 36 weapons on wheel pages of at most ten', () => {
    const pages = wheelPages(WEAPONS.map((w) => w.id));
    expect(pages.flat().length).toBe(WEAPONS.length);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(10);
  });
});
