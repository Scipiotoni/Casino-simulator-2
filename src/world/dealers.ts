import { VEHICLES, type VehicleDef } from '../vehicles/models';

/**
 * The island's car dealerships. Each has its own lot (in layout's SPECIAL_SITES), its own
 * stock and look, and four cars on the forecourt. What you buy is delivered to the kerb
 * outside the dealer you bought it from.
 */

export interface Dealer {
  key: string;
  name: string;
  sign: string;
  /** Who they are, for the panel and the map. */
  tagline: string;
  color: number;
  neon: string;
  /** Car ids for sale, cheapest first in the panel. */
  stock: string[];
  /** Four cars parked on the forecourt. */
  display: string[];
}

export const DEALERS: Dealer[] = [
  {
    key: 'carDealer', name: 'Island Motors', sign: 'ISLAND MOTORS', tagline: 'New everyday cars, by the harbor',
    color: 0xe8ecf2, neon: '#3aa7ff',
    stock: ['hatch', 'civic', 'golf', 'prius', 'mini', 'rav4', 'sedan', 'taxi', 'minivan', 'van', 'model3'],
    display: ['civic', 'golf', 'model3', 'rav4'],
  },
  {
    key: 'dealerUsed', name: 'Honest Eddie’s Used Cars', sign: 'HONEST EDDIE’S', tagline: 'Cheap and cheerful, next to Palm Court',
    color: 0xf2d45c, neon: '#ff9a3a',
    stock: ['wagon240', 'beetle', 'crownvic', 'pickup', 'miata', 'muscle'],
    display: ['beetle', 'wagon240', 'crownvic', 'miata'],
  },
  {
    key: 'dealerExotic', name: 'Fortuna Exotics', sign: 'FORTUNA EXOTICS', tagline: 'Supercars and luxury on the Strip',
    color: 0x1a1a22, neon: '#ffd23d',
    stock: ['convertible', 'sports', 'p911', 'gclass', 'bentley', 'limo', 'ferrari', 'mclaren', 'phantom', 'lambo', 'super', 'bugatti'],
    display: ['ferrari', 'lambo', 'p911', 'bugatti'],
  },
  {
    key: 'dealer4x4', name: 'Dustwater 4x4', sign: 'DUSTWATER 4X4', tagline: 'Pickups, off-roaders and a big rig, out in the desert',
    color: 0xc89a5a, neon: '#ff6b3a',
    stock: ['buggy', 'hilux', 'wrangler', 'f150', 'suv', 'cybertruck', 'hummer', 'bigrig'],
    display: ['f150', 'wrangler', 'hummer', 'cybertruck'],
  },
  {
    key: 'dealerClassic', name: 'Halibut Bay Classics', sign: 'BAY CLASSICS', tagline: 'Restored classics on the north coast',
    color: 0x2f5a6a, neon: '#4fd0c8',
    stock: ['vwbus', 'belair', 'delorean', 'etype', 'countach'],
    display: ['belair', 'etype', 'delorean', 'vwbus'],
  },
];

export function dealer(key: string): Dealer | undefined {
  return DEALERS.find((d) => d.key === key);
}

export function isDealer(key: string): boolean {
  return DEALERS.some((d) => d.key === key);
}

/** A dealer's cars, cheapest first. */
export function dealerStock(d: Dealer): VehicleDef[] {
  return d.stock.map((id) => VEHICLES.find((v) => v.id === id)).filter((v): v is VehicleDef => !!v).sort((a, b) => a.price - b.price);
}

/** Every dealer that sells a car. */
export function dealersSelling(id: string): Dealer[] {
  return DEALERS.filter((d) => d.stock.includes(id));
}
