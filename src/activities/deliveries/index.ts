import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the deliveries activity. */
export class Deliveries implements Activity {
  readonly id = 'deliveries';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
