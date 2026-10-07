import * as THREE from 'three';
import { TableBase, HandLabel } from '../table';
import { buildHalfMoon, hmPolar, HM, feltArcLabel } from '../halfmoon';
import { Card3D, CARD_W } from '../cards3d';
import { Shoe } from '../cards';
import { threeCardScore, threeCardReturn, pairPlusPays, tcpDealerQualifies, TCP_NAMES, sixCardBonus } from '../rules';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';
import type { Card } from '../types';

/**
 * Three Card Poker: put up an Ante (and Pair Plus if you like), see your three cards, then
 * Play (match the ante) or Fold. The dealer needs queen high to qualify; if not, the ante
 * pays even money and the play bet pushes. Ante Bonus for straights and better is paid
 * whatever the dealer has, Pair Plus pays on your hand alone, and the 6-Card Bonus uses your
 * three cards and the dealer's three.
 */

const ANGLES = [0.9, 0.45, 0, -0.45, -0.9];
type Spot = 'ante' | 'play' | 'pair' | 'six';
const SPOTS: Spot[] = ['ante', 'play', 'pair', 'six'];

function spotPos(seat: number, s: Spot): [number, number] {
  const a = ANGLES[seat];
  switch (s) {
    case 'ante':
      return hmPolar(0.92, a);
    case 'play':
      return hmPolar(0.78, a);
    case 'pair':
      return hmPolar(1.04, a + 0.12);
    default:
      return hmPolar(1.04, a - 0.12);
  }
}

function drawFelt(g: CanvasRenderingContext2D, W: number, _H: number, s: number): void {
  const cx = W / 2;
  const gold = '#f2d27a';
  feltArcLabel(g, 'THREE CARD POKER', cx, 0.5 * s, 0, 34, gold);
  feltArcLabel(g, 'Dealer plays with Queen high or better', cx, 0.42 * s, 0, 18, '#ffffffcc');
  ANGLES.forEach((a, i) => {
    for (const sp of SPOTS) {
      const [x, z] = spotPos(i, sp);
      const px = cx + x * s;
      const pz = (z - HM.cz) * s;
      g.lineWidth = sp === 'ante' || sp === 'play' ? 4 : 2.5;
      g.strokeStyle = sp === 'pair' ? '#ffb020' : sp === 'six' ? '#d68bff' : '#ffffff';
      g.beginPath();
      if (sp === 'play') {
        // The play spot is a diamond.
        const r = 0.055 * s;
        g.moveTo(px, pz - r);
        g.lineTo(px + r, pz);
        g.lineTo(px, pz + r);
        g.lineTo(px - r, pz);
        g.closePath();
      } else g.arc(px, pz, (sp === 'ante' ? 0.058 : 0.036) * s, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = `${sp === 'ante' || sp === 'play' ? 15 : 10}px "Lilita One", Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.translate(px, pz);
      g.rotate(-a);
      g.fillText(sp === 'pair' ? 'PAIR+' : sp === 'six' ? '6-CARD' : sp.toUpperCase(), 0, 0);
      g.restore();
    }
  });
  g.fillStyle = gold;
  g.font = '15px Nunito, Arial';
  g.textAlign = 'center';
  g.fillText('PAIR PLUS: Pair 1 · Flush 4 · Straight 6 · Trips 30 · Straight Flush 40', cx, 0.34 * s);
  g.fillText('ANTE BONUS: Straight 1 · Trips 4 · Straight Flush 5', cx, 0.37 * s + 6);
}

type Phase = 'betting' | 'decide' | 'showdown';

interface SeatPlay {
  ante: number;
  play: number;
  pair: number;
  six: number;
  cards: Card[];
  meshes: Card3D[];
  folded: boolean;
  label: HandLabel;
}

export class ThreeCardTable extends TableBase {
  readonly kind = 'threecard' as const;
  readonly name = 'Three Card Poker';
  private shoe: Shoe;
  private shoeObj!: THREE.Object3D;
  private phase: Phase = 'betting';
  private plays: SeatPlay[] = [];
  private dealerCards: Card[] = [];
  private dealerMeshes: Card3D[] = [];
  private dealerLabel = new HandLabel();
  private lastBets: { ante: number; pair: number; six: number } | null = null;
  private decide: ((play: boolean) => void) | null = null;

  constructor(seed: number, opts: { felt?: string; min?: number; max?: number } = {}) {
    super(seed);
    this.minBet = opts.min ?? 10;
    this.maxBet = opts.max ?? 2500;
    this.shoe = new Shoe(1, this.rng);
    const { shoe } = buildHalfMoon(this, 'threecard', drawFelt, opts.felt ?? '#0d4a7a', ANGLES);
    this.shoeObj = shoe;
    this.focus.set(0, 0.95, -0.15);
    for (let i = 0; i < ANGLES.length; i++) this.plays.push(this.empty());
    this.addDealer(0, HM.cz - 0.42);
    this.group.add(this.dealerLabel.sprite);
    this.dealerLabel.sprite.position.set(0, this.surfaceY + 0.13, HM.cz + 0.3);
  }

  private empty(): SeatPlay {
    const label = new HandLabel();
    this.group.add(label.sprite);
    return { ante: 0, play: 0, pair: 0, six: 0, cards: [], meshes: [], folded: false, label };
  }

  private refreshPiles(seat: number): void {
    const p = this.plays[seat];
    for (const s of SPOTS) {
      const [x, z] = spotPos(seat, s);
      this.chips.set(`${seat}:${s}`, x, this.surfaceY + 0.001, z, p[s]);
    }
  }

  protected onEnter(): void {
    this.phase = 'betting';
    this.display.show('ANTE UP', `${money(this.minBet)} - ${money(this.maxBet)}`);
    this.speech.say('Ante up!');
    this.refreshOptions();
  }

  protected onExit(): void {
    if (this.phase === 'betting') {
      const p = this.plays[this.mySeat];
      const back = p.ante + p.pair + p.six;
      if (back) this.host?.give(back);
      p.ante = p.pair = p.six = 0;
      this.refreshPiles(this.mySeat);
    }
  }

  canLeave(): boolean {
    return this.phase === 'betting';
  }

  private myTotal(): number {
    const p = this.plays[this.mySeat];
    return p ? p.ante + p.play + p.pair + p.six : 0;
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const total = this.myTotal();
    if (this.phase === 'betting') {
      h.options.show({
        title: 'THREE CARD POKER',
        chips: true,
        bet: total,
        balance: h.balance(),
        hint: 'Click ANTE (and PAIR+ or 6-CARD for the bonuses) · right-click to take a bet back',
        buttons: [
          { id: 'clear', label: 'Clear', key: 'C', enabled: total > 0 },
          { id: 'rebet', label: 'Rebet', key: 'R', enabled: total === 0 && !!this.lastBets },
          { id: 'deal', label: 'Deal', key: 'Space', primary: true, enabled: this.plays[this.mySeat].ante >= this.minBet || this.plays[this.mySeat].pair > 0 },
          { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
        ],
      });
    } else if (this.phase === 'decide' && this.decide) {
      const p = this.plays[this.mySeat];
      const sc = threeCardScore(p.cards);
      h.options.show({
        title: `YOU HAVE ${TCP_NAMES[sc[0]].toUpperCase()}`,
        bet: total,
        balance: h.balance(),
        hint: 'Play (match your ante) or fold. Book strategy: play Q-6-4 or better.',
        buttons: [
          { id: 'play', label: `Play ${money(p.ante)}`, key: 'P', primary: true },
          { id: 'fold', label: 'Fold', key: 'F', danger: true },
        ],
      });
    } else h.options.show({ title: 'THREE CARD POKER', bet: total, balance: h.balance(), buttons: [{ id: 'wait', label: 'Dealing…', enabled: false }] });
  }

  click(p: THREE.Vector3, button: number): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    const pl = this.plays[this.mySeat];
    let hit: Spot | null = null;
    for (const s of ['ante', 'pair', 'six'] as const) {
      const [x, z] = spotPos(this.mySeat, s);
      if (Math.hypot(p.x - x, p.z - z) < (s === 'ante' ? 0.075 : 0.05)) hit = s;
    }
    if (!hit) return;
    if (button === 2) {
      if (pl[hit]) {
        h.give(pl[hit]);
        pl[hit] = 0;
      }
    } else {
      const cap = hit === 'ante' ? this.maxBet : Math.min(this.maxBet, 500);
      const add = Math.min(h.options.selectedChip, cap - pl[hit]);
      if (add <= 0) {
        this.speech.say(`Limit there is ${money(cap)}.`);
        return;
      }
      if (!h.take(add)) {
        this.speech.say("You're short for that chip.");
        return;
      }
      pl[hit] += add;
      this.display.show(hit === 'pair' ? 'PAIR PLUS' : hit === 'six' ? '6-CARD BONUS' : 'ANTE', `on it: ${money(pl[hit])}`);
    }
    h.sound('chips', 0.6);
    this.refreshPiles(this.mySeat);
    this.refreshOptions();
  }

  key(code: string): boolean {
    const map: Record<string, string> = { Space: 'deal', KeyC: 'clear', KeyR: 'rebet', KeyP: 'play', KeyF: 'fold' };
    if (!map[code]) return false;
    this.button(map[code]);
    return true;
  }

  button(id: string): void {
    const h = this.host;
    if (!h) return;
    const pl = this.plays[this.mySeat];
    if (this.phase === 'decide' && this.decide && (id === 'play' || id === 'fold')) {
      if (id === 'play' && !h.take(pl.ante)) {
        this.speech.say("You're short for the play bet.");
        return;
      }
      const d = this.decide;
      this.decide = null;
      d(id === 'play');
      return;
    }
    if (this.phase !== 'betting') return;
    if (id === 'clear') {
      const back = pl.ante + pl.pair + pl.six;
      if (back) h.give(back);
      pl.ante = pl.pair = pl.six = 0;
    } else if (id === 'rebet' && this.lastBets) {
      const need = this.lastBets.ante + this.lastBets.pair + this.lastBets.six;
      if (h.take(need)) Object.assign(pl, this.lastBets);
      else this.speech.say("You're short for a rebet.");
    } else if (id === 'deal' && (pl.ante >= this.minBet || pl.pair > 0)) {
      this.lastBets = { ante: pl.ante, pair: pl.pair, six: pl.six };
      void this.round();
    }
    this.refreshPiles(this.mySeat);
    this.refreshOptions();
  }

  private handPos(seat: number, k: number): [number, number, number] {
    const a = ANGLES[seat];
    const [bx, bz] = hmPolar(0.6, a);
    const tx = Math.cos(a);
    const tz = -Math.sin(a);
    return [bx + tx * (k - 1) * (CARD_W + 0.008), bz + tz * (k - 1) * (CARD_W + 0.008), a];
  }

  private async deal(card: Card, x: number, z: number, rotY: number, faceUp: boolean): Promise<Card3D> {
    const c = new Card3D(card, 3);
    c.mesh.position.copy(this.shoeObj.position);
    c.mesh.rotation.z = Math.PI;
    this.group.add(c.mesh);
    this.host?.sound('cards', 0.45);
    this.dealer?.react('dealCards', 'neutral', 0.3);
    await c.dealTo(x, this.surfaceY + 0.001, z, rotY, faceUp, 0.26);
    return c;
  }

  private async round(): Promise<void> {
    const h = this.host;
    if (!h) return;
    this.phase = 'showdown';
    this.refreshOptions();
    this.seats.forEach((s, i) => {
      if (s.who !== 'npc') return;
      const p = this.plays[i];
      p.ante = this.minBet * (1 + Math.floor(this.rng() * 3));
      if (this.rng() < 0.5) p.pair = this.minBet;
      this.refreshPiles(i);
    });
    this.speech.say('Good luck!');
    this.shoe.shuffle();
    const active = this.plays.map((p, i) => (p.ante > 0 || p.pair > 0 ? i : -1)).filter((i) => i >= 0);
    for (const i of active) this.plays[i].cards = [this.shoe.draw(), this.shoe.draw(), this.shoe.draw()];
    this.dealerCards = [this.shoe.draw(), this.shoe.draw(), this.shoe.draw()];
    // Deal three to everyone (face down), then the dealer's three.
    for (let k = 0; k < 3; k++) {
      for (const i of active) {
        const [x, z, a] = this.handPos(i, k);
        this.plays[i].meshes.push(await this.deal(this.plays[i].cards[k], x, z, a, i === this.mySeat));
      }
      this.dealerMeshes.push(await this.deal(this.dealerCards[k], -0.075 + k * (CARD_W + 0.01), HM.cz + 0.26, 0, false));
    }
    const mine = this.plays[this.mySeat];
    const myScore = threeCardScore(mine.cards);
    mine.label.set(TCP_NAMES[myScore[0]].toUpperCase());
    const [lx, lz] = this.handPos(this.mySeat, 1);
    mine.label.sprite.position.set(lx, this.surfaceY + 0.12, lz);
    // Pair Plus is decided by your hand alone.
    // Players decide.
    for (const i of active) {
      const p = this.plays[i];
      if (!p.ante) continue;
      let play: boolean;
      if (i === this.mySeat) {
        this.phase = 'decide';
        this.display.show('PLAY OR FOLD?', TCP_NAMES[myScore[0]]);
        play = await new Promise<boolean>((res) => {
          this.decide = res;
          this.refreshOptions();
        });
        this.phase = 'showdown';
        this.refreshOptions();
      } else {
        await tweens.wait(0.5);
        const sc = threeCardScore(p.cards);
        // Optimal strategy: play queen-six-four or better.
        play = sc[0] > 0 || sc[1] > 12 || (sc[1] === 12 && (sc[2] > 6 || (sc[2] === 6 && sc[3] >= 4)));
        for (const m of p.meshes) void m.flip(true);
      }
      if (play) p.play = p.ante;
      else p.folded = true;
      this.refreshPiles(i);
      if (p.folded) {
        p.ante = 0;
        this.refreshPiles(i);
        for (const m of p.meshes) void m.dealTo(m.mesh.position.x, this.surfaceY + 0.001, m.mesh.position.z, m.mesh.rotation.y, false, 0.2);
      }
    }
    // Dealer turns over.
    await Promise.all(this.dealerMeshes.map((m) => m.flip(true)));
    const ds = threeCardScore(this.dealerCards);
    const q = tcpDealerQualifies(ds);
    this.dealerLabel.set(`${TCP_NAMES[ds[0]].toUpperCase()}${q ? '' : ' · NO QUALIFY'}`, q ? '#ffffff' : '#ffb020');
    this.speech.say(q ? `Dealer has ${TCP_NAMES[ds[0]].toLowerCase()}.` : 'Dealer does not qualify.');
    await tweens.wait(1.0);
    let myStake = 0;
    let myBack = 0;
    for (const i of active) {
      const p = this.plays[i];
      const sc = threeCardScore(p.cards);
      const stake = p.ante + p.play + p.pair + p.six + (p.folded ? 0 : 0);
      let back = 0;
      if (p.ante && !p.folded) back += threeCardReturn(p.ante, true, sc, ds).total;
      else if (p.folded) back += 0;
      if (p.pair) back += pairPlusPays(sc) > 0 ? p.pair * (pairPlusPays(sc) + 1) : 0;
      if (p.six) {
        const six = sixCardBonus([...p.cards, ...this.dealerCards]);
        back += six.pays > 0 ? p.six * (six.pays + 1) : 0;
      }
      // Chips: winners get their payout beside the spots.
      for (const s of SPOTS) this.chips.set(`${i}:${s}`, 0, 0, 0, 0);
      if (back > 0) {
        const [x, z] = spotPos(i, 'ante');
        this.chips.set(`${i}:win`, x + 0.05, this.surfaceY + 0.001, z, Math.round(back));
      }
      if (i === this.mySeat) {
        myStake = stake + (p.folded ? this.lastBets?.ante ?? 0 : 0);
        myBack = back;
        if (back) h.give(back);
      } else this.seats[i].npc?.react(back > stake ? 'cheer' : 'facepalm', back > stake ? 'grin' : 'sad');
    }
    const net = myBack - myStake;
    if (net > 0) {
      h.sound(net > myStake * 3 ? 'bigwin' : 'win');
      this.display.show(`YOU WIN ${money(net)}`, TCP_NAMES[myScore[0]], '#7dff9a');
      if (net >= 10000) h.celebrate('big', net);
    } else this.display.show(myBack > 0 ? `BACK ${money(myBack)}` : 'DEALER WINS', '', '#ff8a8a');
    h.record('threecard', myStake, myBack);
    await tweens.wait(2.6);
    for (const p of this.plays) {
      for (const m of p.meshes) void m.dealTo(-0.78, this.surfaceY + 0.06, HM.cz + 0.14, 0.6, false, 0.3).then(() => m.dispose());
      p.label.set('');
    }
    for (const m of this.dealerMeshes) void m.dealTo(-0.78, this.surfaceY + 0.06, HM.cz + 0.14, 0.6, false, 0.3).then(() => m.dispose());
    this.dealerMeshes = [];
    this.dealerLabel.set('');
    this.chips.clear();
    for (let i = 0; i < this.plays.length; i++) {
      this.plays[i].label.sprite.removeFromParent();
      this.plays[i] = this.empty();
    }
    this.phase = 'betting';
    this.display.show('ANTE UP', `${money(this.minBet)} - ${money(this.maxBet)}`);
    this.refreshOptions();
  }

  tick(): void {
    if (this.host && this.phase === 'betting') this.refreshOptions();
  }
}
