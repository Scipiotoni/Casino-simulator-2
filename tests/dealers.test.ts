import { describe, expect, it } from 'vitest';
import { DEALERS, dealerStock, dealersSelling } from '../src/world/dealers';
import { VEHICLES } from '../src/vehicles/models';
import { cityLots } from '../src/world/layout';
import { newSave } from '../src/game/save';
import { appearanceFromSkin } from '../src/chars/skins';

describe('car dealers', () => {
  it('only stock cars that exist, and park four of them out front', () => {
    for (const d of DEALERS) {
      expect(dealerStock(d).length).toBe(d.stock.length);
      expect(d.display).toHaveLength(4);
      for (const id of d.display) expect(d.stock).toContain(id);
    }
  });

  it('sell every car you can buy, and nothing that is not for sale', () => {
    for (const v of VEHICLES) {
      const sold = dealersSelling(v.id).length > 0;
      expect(sold, v.id).toBe(v.price > 0 && v.cls !== 'boat');
    }
  });

  it('list their cars cheapest first', () => {
    for (const d of DEALERS) {
      const prices = dealerStock(d).map((v) => v.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    }
  });

  it('each have a lot of their own that was never for sale, spread round the island', () => {
    const lots = cityLots();
    const mine = DEALERS.map((d) => lots.find((l) => l.special === d.key));
    for (const l of mine) {
      expect(l).toBeDefined();
      expect(l!.forSale).toBe(false);
    }
    expect(new Set(mine.map((l) => l!.id)).size).toBe(DEALERS.length);
    expect(new Set(mine.map((l) => l!.district)).size).toBeGreaterThanOrEqual(4);
  });

  it('give every car a different name', () => {
    expect(new Set(VEHICLES.map((v) => v.name)).size).toBe(VEHICLES.length);
    expect(new Set(VEHICLES.map((v) => v.id)).size).toBe(VEHICLES.length);
  });
});

describe('a new game', () => {
  it('starts with cash but no home and no car', () => {
    const s = newSave('Test', appearanceFromSkin('rookie'));
    expect(s.flat).toBe(false);
    expect(s.vehicles).toEqual([]);
    expect(s.money).toBe(30000);
  });
});
