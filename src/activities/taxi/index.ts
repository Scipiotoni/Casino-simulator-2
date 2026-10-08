import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the taxi activity. */
export class Taxi implements Activity {
  readonly id = 'taxi';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
