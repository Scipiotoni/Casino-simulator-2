import type { Card } from './types';
import { bjTotal } from './cards';

/**
 * Basic strategy for 6-deck blackjack, dealer stands on soft 17, double after split, late
 * surrender. NPC players follow it (so the tables play like real ones), and it powers the
 * optional "what would the book do?" hint.
 */

export type BjMove = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

const up = (c: Card) => (c.rank === 0 ? 11 : Math.min(10, c.rank + 1));

export function basicStrategy(hand: Card[], dealerUp: Card, opts: { canDouble: boolean; canSplit: boolean; canSurrender: boolean }): BjMove {
  const d = up(dealerUp);
  const { total, soft } = bjTotal(hand);
  // Pairs.
  if (opts.canSplit && hand.length === 2 && Math.min(10, hand[0].rank + 1) === Math.min(10, hand[1].rank + 1)) {
    const p = hand[0].rank === 0 ? 11 : Math.min(10, hand[0].rank + 1);
    if (p === 11 || p === 8) return 'split';
    if (p === 9 && d !== 7 && d !== 10 && d !== 11) return 'split';
    if ((p === 2 || p === 3) && d >= 2 && d <= 7) return 'split';
    if (p === 6 && d >= 2 && d <= 6) return 'split';
    if (p === 7 && d >= 2 && d <= 7) return 'split';
    if (p === 4 && (d === 5 || d === 6)) return 'split';
  }
  // Late surrender: hard 16 v 9-A, hard 15 v 10.
  if (opts.canSurrender && hand.length === 2 && !soft) {
    if (total === 16 && d >= 9) return 'surrender';
    if (total === 15 && d === 10) return 'surrender';
  }
  if (soft) {
    if (total >= 20) return 'stand';
    if (total === 19) return d === 6 && opts.canDouble ? 'double' : 'stand';
    if (total === 18) {
      if (d >= 2 && d <= 6) return opts.canDouble ? 'double' : 'stand';
      if (d === 7 || d === 8) return 'stand';
      return 'hit';
    }
    if (total === 17) return d >= 3 && d <= 6 && opts.canDouble ? 'double' : 'hit';
    if (total === 15 || total === 16) return d >= 4 && d <= 6 && opts.canDouble ? 'double' : 'hit';
    return d >= 5 && d <= 6 && opts.canDouble ? 'double' : 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return opts.canDouble ? 'double' : 'hit';
  if (total === 10) return d <= 9 && opts.canDouble ? 'double' : 'hit';
  if (total === 9) return d >= 3 && d <= 6 && opts.canDouble ? 'double' : 'hit';
  return 'hit';
}
