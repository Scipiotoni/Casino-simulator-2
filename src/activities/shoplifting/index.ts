import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the shoplifting activity. */
export class Shoplifting implements Activity {
  readonly id = 'shoplifting';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
