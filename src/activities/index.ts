import type { Game } from '../game/game';
import type { Activity } from './activity';
import { Shoplifting } from './shoplifting';
import { Docks } from './docks';
import { Collectibles } from './collectibles';
import { Deliveries } from './deliveries';
import { Races } from './races';
import { Taxi } from './taxi';
import { Radio } from './radio';
import { Crossover } from './crossover';

/** Every side activity on the island. Each owns its folder; this list is the only shared line. */
export function createActivities(g: Game): Activity[] {
  return [new Shoplifting(g), new Docks(g), new Collectibles(g), new Deliveries(g), new Races(g), new Taxi(g), new Radio(g), new Crossover(g)];
}
