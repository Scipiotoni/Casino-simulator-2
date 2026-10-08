import type { Game } from '../../game/game';
import type { Activity } from '../activity';

/** Placeholder: filled in by the radio activity. */
export class Radio implements Activity {
  readonly id = 'radio';
  constructor(readonly game: Game) {}
  update(_dt: number): void {}
}
