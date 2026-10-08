import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the collectibles activity. */
export class Collectibles implements Activity {
  readonly id = 'collectibles';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
