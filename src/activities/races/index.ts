import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the races activity. */
export class Races implements Activity {
  readonly id = 'races';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
