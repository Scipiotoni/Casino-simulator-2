import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the docks activity. */
export class Docks implements Activity {
  readonly id = 'docks';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
