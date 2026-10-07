import * as THREE from 'three';
import { TableBase, HandLabel, stoolParts } from '../table';
import { Kit } from '../../render/kit';
import { Card3D, CARD_W } from '../cards3d';
import { Shoe, bjTotal, isBlackjack, dealerShouldHit } from '../cards';
import { perfectPairs, twentyOnePlus3 } from '../rules';
import { basicStrategy, type BjMove } from '../strategy';
import type { Card } from '../types';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';
import { feltCanvas, arcText } from '../felt';

/**
 * Blackjack, Las Vegas rules: six decks dealt from a shoe down to the cut card, dealer
 * peeks for blackjack and stands on all 17s, blackjack pays 3:2, insurance 2:1 (even money
 * on a blackjack), double on any two cards (also after splits), split up to four hands
 * (aces once, one card each), late surrender. Perfect Pairs and 21+3 side bets.
 * Everything is on the table: you click the felt to bet, and the options bar only offers
 * the moves the rules allow at that moment.
 */

const C = { x: 0, z: -0.35 };
const R = 1.15;
const SEAT_ANGLES = [0.98, 0.49, 0, -0.49, -0.98];

interface Hand {
  cards: Card[];
  meshes: Card3D[];
  bet: number;
  doubled: boolean;
  done: boolean;
  surrendered: boolean;
  split: boolean;
  splitAces: boolean;
  /** Already paid (even money). */
  paid: number;
  label: HandLabel;
}

interface SeatPlay {
  main: number;
  pp: number;
  p213: number;
  insurance: number;
  hands: Hand[];
}

type Phase = 'betting' | 'dealing' | 'insurance' | 'turn' | 'dealer' | 'settle';

export class BlackjackTable extends TableBase {
  readonly kind = 'blackjack' as const;
  readonly name: string;
  private shoe: Shoe;
  private felt!: THREE.Mesh;
  private phase: Phase = 'betting';
  private plays: SeatPlay[] = [];
  private dealerCards: Card[] = [];
  private dealerMeshes: Card3D[] = [];
  private dealerLabel = new HandLabel();
  private pendingMove: ((m: BjMove | 'insure' | 'noInsure') => void) | null = null;
  private allowed: { canDouble: boolean; canSplit: boolean; canSurrender: boolean; insurance: boolean } = { canDouble: false, canSplit: false, canSurrender: false, insurance: false };
  private lastBets = { main: 0, pp: 0, p213: 0 };
  private turnSeat = -1;
  private turnHand = 0;
  private shoeMesh!: THREE.Object3D;
  private discard = 0;
  private discardStack!: THREE.Mesh;
  private ambientT = 4;

  constructor(seed: number, opts: { felt?: string; min?: number; max?: number; name?: string } = {}) {
    super(seed);
    this.minBet = opts.min ?? 10;
    this.maxBet = opts.max ?? 5000;
    this.name = opts.name ?? 'Blackjack';
    this.shoe = new Shoe(6, this.rng, 78);
    this.build(opts.felt ?? '#0f6b3a');
    this.focus.set(0, 0.98, -0.2);
    for (let i = 0; i < SEAT_ANGLES.length; i++) this.plays.push(this.emptyPlay());
  }

  private emptyPlay(): SeatPlay {
    return { main: 0, pp: 0, p213: 0, insurance: 0, hands: [] };
  }

  private polar(r: number, a: number): [number, number] {
    return [C.x + Math.sin(a) * r, C.z + Math.cos(a) * r];
  }

  // ---------------------------------------------------------------- model

  private build(feltColor: string): void {
    const y = this.surfaceY;
    // Felt: a half disc with the printed layout.
    const tex = this.feltTexture(feltColor);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const seg = 48;
    pos.push(C.x, y, C.z);
    uv.push(0.5, 1);
    for (let i = 0; i <= seg; i++) {
      const a = -Math.PI / 2 + (i / seg) * Math.PI;
      const x = C.x + Math.sin(a) * R;
      const z = C.z + Math.cos(a) * R;
      pos.push(x, y, z);
      uv.push((x + R) / (2 * R), 1 - (z - C.z) / R);
      if (i > 0) idx.push(0, i, i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.felt = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
    this.felt.receiveShadow = true;
    this.group.add(this.felt);
    this.pickables.push(this.felt);

    const k = new Kit();
    // Padded rail round the curve, wooden trim, body and pedestal.
    k.torus(R + 0.02, 0.055, 0x1a1214, { x: C.x, y: y + 0.01, z: C.z, rx: Math.PI / 2, rz: 0 }, 'shiny', Math.PI, 10, 40);
    k.add(new THREE.TorusGeometry(R + 0.02, 0.055, 10, 40, Math.PI), 0x1a1214, { x: C.x, y: y + 0.01, z: C.z, rx: -Math.PI / 2, rz: -Math.PI / 2 }, 'shiny');
    k.add(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.08, 40, 1, false, -Math.PI / 2, Math.PI), 0x6b3a1e, { x: C.x, y: y - 0.05, z: C.z }, 'shiny');
    k.box(2 * R + 0.18, 0.08, 0.12, 0x6b3a1e, { x: 0, y: y - 0.05, z: C.z - 0.05 }, 'shiny');
    k.add(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.5, 30, 1, false, -Math.PI / 2, Math.PI), 0x2a1a12, { x: C.x, y: y - 0.34, z: C.z });
    k.cyl(0.1, 0.3, 0.12, 0x222226, { x: 0, y: 0.06, z: 0.15 }, 'shiny', 18);
    // Dealer side: chip tray, shoe, discard holder, limit sign.
    k.box(0.62, 0.035, 0.16, 0x111114, { x: 0, y: y + 0.018, z: C.z + 0.1 }, 'shiny');
    for (let i = 0; i < 8; i++) {
      const col = [0xf4f4f0, 0xd8202f, 0x1f9a4c, 0x18181c, 0x6a2fb8, 0xf2c230, 0xd8202f, 0x1f9a4c][i];
      k.cyl(0.0195, 0.0195, 0.12, col, { x: -0.27 + i * 0.077, y: y + 0.045, z: C.z + 0.1, rz: Math.PI / 2 }, 'matte', 14);
    }
    this.group.add(k.bake({ shadows: true }));
    // The shoe (cards inside, a red cut card poking out).
    const sk = new Kit();
    sk.box(0.13, 0.09, 0.2, 0x1b1b20, { y: 0.045 }, 'shiny');
    sk.box(0.11, 0.06, 0.17, 0xf2efe6, { y: 0.07, z: -0.01 });
    sk.box(0.002, 0.075, 0.12, 0xd8202f, { x: 0.02, y: 0.075, z: -0.02 });
    sk.box(0.13, 0.02, 0.06, 0x1b1b20, { y: 0.06, z: 0.11, rx: -0.5 }, 'shiny');
    this.shoeMesh = sk.bake();
    this.shoeMesh.position.set(0.78, y, C.z + 0.14);
    this.shoeMesh.rotation.y = -0.6;
    this.group.add(this.shoeMesh);
    const dk = new Kit();
    dk.box(0.1, 0.12, 0.13, 0x1b1b20, { y: 0.06 }, 'glass');
    const discardHolder = dk.bake();
    discardHolder.position.set(-0.78, y, C.z + 0.14);
    discardHolder.rotation.y = 0.6;
    this.group.add(discardHolder);
    this.discardStack = new THREE.Mesh(new THREE.BoxGeometry(0.063, 1, 0.088), new THREE.MeshLambertMaterial({ color: 0xb3122e }));
    this.discardStack.position.set(-0.78, y, C.z + 0.14);
    this.discardStack.rotation.y = 0.6;
    this.discardStack.scale.y = 0.0001;
    this.group.add(this.discardStack);
    // Display on a little stand by the dealer.
    this.display.mesh.position.set(-0.46, y + 0.17, C.z + 0.02);
    this.display.mesh.rotation.set(-0.35, 0.25, 0);
    this.group.add(this.display.mesh);
    const stand = new Kit().box(0.44, 0.15, 0.02, 0x111114, { x: -0.46, y: y + 0.1, z: C.z + 0.01, rx: -0.35, ry: 0.25 }, 'shiny').bake();
    this.group.add(stand);
    // Stools and seats.
    const st = new Kit();
    SEAT_ANGLES.forEach((a) => {
      const [x, z] = this.polar(1.52, a);
      const yaw = a + Math.PI;
      stoolParts(st, x, z, yaw);
      this.seats.push({ x, z, yaw, who: null, eye: 1.24 });
    });
    this.group.add(st.bake({ shadows: true }));
    this.addDealer(0, C.z - 0.42);
    this.dealerLabel.sprite.position.set(0, y + 0.14, C.z + 0.27);
    this.group.add(this.dealerLabel.sprite);
  }

  private feltTexture(color: string): THREE.CanvasTexture {
    const W = 1024;
    const H = 512;
    const { canvas, g } = feltCanvas(W, H, color);
    const cx = W / 2;
    const s = W / 2 / R;
    const gold = '#f2d27a';
    g.strokeStyle = gold;
    g.fillStyle = gold;
    arcText(g, 'BLACKJACK PAYS 3 TO 2', cx, 0, 0.5 * s, 34, '"Lilita One", Arial', gold);
    arcText(g, 'Dealer must draw to 16 and stand on all 17s', cx, 0, 0.405 * s, 19, 'Nunito, Arial', '#ffffffcc');
    // Insurance band.
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, 0, 0.3 * s, 0.25 * Math.PI, 0.75 * Math.PI);
    g.stroke();
    g.beginPath();
    g.arc(cx, 0, 0.36 * s, 0.25 * Math.PI, 0.75 * Math.PI);
    g.stroke();
    arcText(g, 'INSURANCE PAYS 2 TO 1', cx, 0, 0.32 * s, 20, '"Lilita One", Arial', gold);
    // Betting circles and side-bet spots for every seat.
    for (const a of SEAT_ANGLES) {
      const [x, z] = [Math.sin(a) * 0.84, Math.cos(a) * 0.84];
      g.lineWidth = 4;
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.arc(cx + x * s, z * s, 0.065 * s, 0, Math.PI * 2);
      g.stroke();
      for (const [off, label] of [[0.105, 'PP'], [-0.105, '21+3']] as const) {
        const px = cx + Math.sin(a + off) * 0.98 * s;
        const pz = Math.cos(a + off) * 0.98 * s;
        g.lineWidth = 2.5;
        g.strokeStyle = gold;
        g.beginPath();
        g.arc(px, pz, 0.036 * s, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = gold;
        g.font = 'bold 13px Nunito, Arial';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, px, pz);
      }
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // ---------------------------------------------------------------- spots

  private spot(seat: number, which: 'main' | 'pp' | 'p213' | 'win' | 'ins' | 'win2' | 'win3'): [number, number] {
    const a = SEAT_ANGLES[seat];
    switch (which) {
      case 'main':
        return this.polar(0.84, a);
      case 'pp':
        return this.polar(0.98, a + 0.105);
      case 'p213':
        return this.polar(0.98, a - 0.105);
      case 'ins':
        return this.polar(0.33, a * 0.5);
      case 'win':
        return this.polar(0.75, a - 0.05);
      case 'win2':
        return this.polar(0.9, a + 0.16);
      default:
        return this.polar(0.9, a - 0.16);
    }
  }

  private setPile(seat: number, which: 'main' | 'pp' | 'p213' | 'win' | 'ins' | 'win2' | 'win3', amount: number): void {
    const [x, z] = this.spot(seat, which);
    this.chips.set(`${seat}:${which}`, x, this.surfaceY + 0.001, z, amount);
  }

  private refreshPiles(seat: number): void {
    const p = this.plays[seat];
    const handBets = p.hands.length ? p.hands.reduce((a, h) => a + h.bet, 0) : p.main;
    this.setPile(seat, 'main', handBets);
    this.setPile(seat, 'pp', p.pp);
    this.setPile(seat, 'p213', p.p213);
    this.setPile(seat, 'ins', p.insurance);
  }

  // ---------------------------------------------------------------- session

  protected onEnter(): void {
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `$${this.minBet} - ${money(this.maxBet)}`);
    this.dealer?.react('wave', 'happy', 1.5);
    this.speech.say('Welcome! Place your bet.');
    this.refreshOptions();
  }

  protected onExit(): void {
    // Chips still sitting in the betting spots go back to you.
    const p = this.plays[this.mySeat];
    if (this.phase === 'betting' && p) {
      const back = p.main + p.pp + p.p213;
      if (back > 0) this.host?.give(back);
      this.plays[this.mySeat] = this.emptyPlay();
      this.refreshPiles(this.mySeat);
    }
  }

  canLeave(): boolean {
    return this.phase === 'betting';
  }

  private get my(): SeatPlay {
    return this.plays[this.mySeat];
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const my = this.my;
    const total = my.main + my.pp + my.p213 + my.hands.reduce((a, x) => a + x.bet, 0) + my.insurance;
    if (this.phase === 'betting') {
      const can = my.main >= this.minBet;
      h.options.show({
        title: this.name.toUpperCase(),
        chips: true,
        bet: total,
        balance: h.balance(),
        hint: 'Click the circle to bet · PP and 21+3 are side bets · right-click a spot to take it back',
        buttons: [
          { id: 'clear', label: 'Clear', key: 'C', enabled: total > 0 },
          { id: 'rebet', label: 'Rebet', key: 'R', enabled: total === 0 && this.lastBets.main > 0 },
          { id: 'deal', label: 'Deal', key: 'Space', enabled: can, primary: true },
          { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
        ],
      });
    } else if (this.phase === 'insurance' && this.pendingMove) {
      const bjHand = my.hands[0] && isBlackjack(my.hands[0].cards);
      h.options.show({
        title: 'INSURANCE?',
        bet: total,
        balance: h.balance(),
        hint: bjHand ? 'You have blackjack: take even money (1:1 now) or play on for 3:2?' : 'The dealer shows an ace. Insurance costs half your bet and pays 2:1 if the dealer has blackjack.',
        buttons: [
          { id: 'insure', label: bjHand ? 'Even money' : 'Insurance', key: 'Y', primary: true },
          { id: 'noInsure', label: 'No thanks', key: 'N' },
        ],
      });
    } else if (this.phase === 'turn' && this.pendingMove && this.turnSeat === this.mySeat) {
      const hand = my.hands[this.turnHand];
      const { total: t, soft } = bjTotal(hand.cards);
      h.options.show({
        title: `HAND ${my.hands.length > 1 ? `${this.turnHand + 1} · ` : ''}${soft && t < 21 ? `SOFT ${t}` : t}`,
        bet: total,
        balance: h.balance(),
        buttons: [
          { id: 'hit', label: 'Hit', key: 'H', primary: true },
          { id: 'stand', label: 'Stand', key: 'S' },
          { id: 'double', label: 'Double', key: 'D', enabled: this.allowed.canDouble },
          { id: 'split', label: 'Split', key: 'P', enabled: this.allowed.canSplit },
          { id: 'surrender', label: 'Surrender', key: 'U', enabled: this.allowed.canSurrender },
        ],
      });
    } else {
      h.options.show({ title: this.name.toUpperCase(), bet: total, balance: h.balance(), buttons: [{ id: 'wait', label: 'Dealing…', enabled: false }] });
    }
  }

  click(p: THREE.Vector3, button: number): void {
    if (!this.host || this.phase !== 'betting') return;
    const seat = this.mySeat;
    let which: 'main' | 'pp' | 'p213' | null = null;
    for (const w of ['main', 'pp', 'p213'] as const) {
      const [x, z] = this.spot(seat, w);
      if (Math.hypot(p.x - x, p.z - z) < (w === 'main' ? 0.11 : 0.06)) which = w;
    }
    if (!which) return;
    const my = this.my;
    if (button === 2) {
      const back = my[which];
      if (back > 0) {
        this.host.give(back);
        my[which] = 0;
        this.host.sound('chips', 0.6);
      }
    } else {
      const chip = this.host.options.selectedChip;
      const cap = which === 'main' ? this.maxBet : Math.min(100, this.maxBet);
      const add = Math.min(chip, cap - my[which]);
      if (add <= 0) {
        this.host.toast(`Table limit on that spot is ${money(cap)}`, 'bad');
        return;
      }
      if (!this.host.take(add)) {
        this.host.toast('Not enough money for that chip', 'bad');
        return;
      }
      my[which] += add;
      this.host.sound('chips', 0.7);
    }
    this.refreshPiles(seat);
    this.refreshOptions();
  }

  key(code: string): boolean {
    const map: Record<string, string> = { Space: 'deal', KeyC: 'clear', KeyR: 'rebet', KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split', KeyU: 'surrender', KeyY: 'insure', KeyN: 'noInsure' };
    const id = map[code];
    if (!id) return false;
    this.button(id);
    return true;
  }

  button(id: string): void {
    const h = this.host;
    if (!h) return;
    const my = this.my;
    if (this.phase === 'betting') {
      if (id === 'clear') {
        const back = my.main + my.pp + my.p213;
        if (back) h.give(back);
        this.plays[this.mySeat] = this.emptyPlay();
        this.refreshPiles(this.mySeat);
        h.sound('chips', 0.5);
      } else if (id === 'rebet') {
        const need = this.lastBets.main + this.lastBets.pp + this.lastBets.p213;
        if (h.take(need)) {
          my.main = this.lastBets.main;
          my.pp = this.lastBets.pp;
          my.p213 = this.lastBets.p213;
          this.refreshPiles(this.mySeat);
          h.sound('chips', 0.7);
        } else h.toast('Not enough money to rebet', 'bad');
      } else if (id === 'deal' && my.main >= this.minBet) {
        this.lastBets = { main: my.main, pp: my.pp, p213: my.p213 };
        void this.round();
      } else if (id === 'deal') h.toast(`Minimum bet is $${this.minBet}`, 'bad');
      this.refreshOptions();
      return;
    }
    const pm = this.pendingMove;
    if (!pm) return;
    if (this.phase === 'insurance' && (id === 'insure' || id === 'noInsure')) {
      this.pendingMove = null;
      pm(id);
      return;
    }
    if (this.phase === 'turn') {
      const ok =
        id === 'hit' || id === 'stand' || (id === 'double' && this.allowed.canDouble) || (id === 'split' && this.allowed.canSplit) || (id === 'surrender' && this.allowed.canSurrender);
      if (!ok) return;
      this.pendingMove = null;
      pm(id as BjMove);
    }
  }

  // ---------------------------------------------------------------- the round

  private order(): number[] {
    // First base (the dealer's left, the players' right) first.
    return SEAT_ANGLES.map((_, i) => i).filter((i) => this.plays[i].main > 0);
  }

  private async round(): Promise<void> {
    const host = this.host;
    if (!host) return;
    this.phase = 'dealing';
    this.speech.say('No more bets.');
    this.display.show('NO MORE BETS', '');
    // NPCs bet.
    this.seats.forEach((s, i) => {
      if (s.who !== 'npc' || !s.npc) return;
      const p = this.plays[i];
      const unit = Math.max(this.minBet, Math.round((s.npc.bank * 0.05) / 5) * 5);
      p.main = Math.min(this.maxBet, unit * (1 + Math.floor(this.rng() * 3)));
      if (this.rng() < 0.2) p.pp = 5;
      if (this.rng() < 0.2) p.p213 = 5;
      this.refreshPiles(i);
    });
    this.refreshOptions();
    await tweens.wait(0.5);
    if (this.shoe.cutCardOut) {
      this.speech.say('Shuffling up!');
      this.display.show('SHUFFLE', 'New shoe');
      this.shoe.shuffle();
      this.discard = 0;
      this.discardStack.scale.y = 0.0001;
      await tweens.wait(1.2);
    }
    const seats = this.order();
    for (const i of seats) {
      const p = this.plays[i];
      p.hands = [this.newHand(p.main)];
      p.main = 0;
    }
    // Two passes round the table, dealer last (second card face down).
    for (let pass = 0; pass < 2; pass++) {
      for (const i of seats) await this.dealToHand(i, 0, true);
      await this.dealToDealer(pass === 0);
    }
    this.showTotals();
    // Side bets are settled right after the deal.
    for (const i of seats) {
      const p = this.plays[i];
      const cards = p.hands[0].cards;
      if (p.pp > 0) {
        const r = perfectPairs(cards[0], cards[1]);
        await this.settleSide(i, 'pp', p.pp, r.pays, r.name);
        p.pp = 0;
      }
      if (p.p213 > 0) {
        const r = twentyOnePlus3([cards[0], cards[1], this.dealerCards[0]]);
        await this.settleSide(i, 'p213', p.p213, r.pays, r.name);
        p.p213 = 0;
      }
    }
    const upCard = this.dealerCards[0];
    const upVal = upCard.rank === 0 ? 11 : Math.min(10, upCard.rank + 1);
    // Insurance when the dealer shows an ace.
    if (upVal === 11) {
      this.speech.say('Insurance?');
      this.display.show('INSURANCE?', 'Pays 2 to 1');
      for (const i of seats) {
        const p = this.plays[i];
        const half = Math.floor(p.hands[0].bet / 2);
        if (i === this.mySeat) {
          this.phase = 'insurance';
          const ans = await new Promise<string>((res) => {
            this.pendingMove = res as (m: BjMove | 'insure' | 'noInsure') => void;
            this.refreshOptions();
          });
          if (ans === 'insure') {
            if (isBlackjack(p.hands[0].cards)) {
              // Even money: paid 1:1 now and the hand is over.
              const h = p.hands[0];
              this.payHand(i, h.bet * 2);
              h.paid = h.bet * 2;
              h.done = true;
              h.label.set('EVEN MONEY', '#7dff9a');
              host.toast(`Even money: +${money(h.bet)}`, 'money');
            } else if (host.take(half)) {
              p.insurance = half;
              this.setPile(i, 'ins', half);
              host.sound('chips', 0.6);
            } else host.toast('Not enough money for insurance', 'bad');
          }
          this.phase = 'dealing';
        } else if (this.rng() < 0.12) {
          p.insurance = half;
          this.setPile(i, 'ins', half);
        }
      }
      this.refreshOptions();
    }
    // The dealer peeks under a ten or an ace.
    if (upVal >= 10) {
      this.display.show('DEALER CHECKS', 'for blackjack');
      await tweens.wait(0.8);
      if (isBlackjack(this.dealerCards)) {
        await this.dealerMeshes[1].flip(true);
        this.speech.say('Dealer has blackjack.');
        this.display.show('DEALER BLACKJACK', '');
        this.showTotals();
        host.sound('bust', 0.5);
        await tweens.wait(0.8);
        await this.settleAll(true);
        return;
      }
      // No blackjack: insurance loses.
      for (const i of seats) {
        if (this.plays[i].insurance) {
          this.plays[i].insurance = 0;
          this.setPile(i, 'ins', 0);
        }
      }
      this.speech.say('Nobody home.');
    }
    // Players act in turn.
    this.phase = 'turn';
    for (const i of seats) {
      const p = this.plays[i];
      for (let hi = 0; hi < p.hands.length; hi++) {
        const hand = p.hands[hi];
        if (hand.done) continue;
        if (isBlackjack(hand.cards) && !hand.split) {
          hand.done = true;
          hand.label.set('BLACKJACK!', '#7dff9a');
          if (i === this.mySeat) host.sound('win', 0.8);
          continue;
        }
        this.turnSeat = i;
        this.turnHand = hi;
        this.display.show(i === this.mySeat ? 'YOUR TURN' : 'PLAYER ACTING', '');
        while (!hand.done) {
          const { total } = bjTotal(hand.cards);
          if (total >= 21) {
            hand.done = true;
            break;
          }
          const canDouble = hand.cards.length === 2 && !hand.splitAces;
          const canSplit = hand.cards.length === 2 && p.hands.length < 4 && Math.min(10, hand.cards[0].rank + 1) === Math.min(10, hand.cards[1].rank + 1) && !hand.splitAces;
          const canSurrender = hand.cards.length === 2 && p.hands.length === 1;
          let move: BjMove;
          if (i === this.mySeat) {
            this.allowed = { canDouble, canSplit, canSurrender, insurance: false };
            const chosen = await new Promise<BjMove | 'insure' | 'noInsure'>((res) => {
              this.pendingMove = res;
              this.refreshOptions();
            });
            move = chosen as BjMove;
            if ((move === 'double' || move === 'split') && !host.take(hand.bet)) {
              host.toast('Not enough money for that', 'bad');
              continue;
            }
          } else {
            await tweens.wait(0.6 + this.rng() * 0.5);
            move = basicStrategy(hand.cards, upCard, { canDouble, canSplit, canSurrender });
            if (move === 'surrender' && this.rng() < 0.6) move = 'hit';
          }
          await this.applyMove(i, hi, move);
        }
        const t = bjTotal(hand.cards).total;
        if (t > 21) {
          hand.label.set('BUST', '#ff6b6b');
          if (i === this.mySeat) host.sound('bust', 0.6);
        }
        this.showTotals();
      }
    }
    this.turnSeat = -1;
    // Dealer's turn (only if someone is still in).
    this.phase = 'dealer';
    this.refreshOptions();
    const live = seats.some((i) => this.plays[i].hands.some((h) => !h.surrendered && !h.paid && bjTotal(h.cards).total <= 21 && !(isBlackjack(h.cards) && !h.split)));
    await this.dealerMeshes[1].flip(true);
    this.showTotals();
    await tweens.wait(0.5);
    if (live) {
      while (dealerShouldHit(this.dealerCards)) {
        await this.dealToDealer(true);
        this.showTotals();
        await tweens.wait(0.35);
      }
    }
    const dt = bjTotal(this.dealerCards).total;
    this.speech.say(dt > 21 ? 'Dealer busts!' : `Dealer has ${dt}.`);
    this.display.show(dt > 21 ? 'DEALER BUSTS' : `DEALER ${dt}`, '');
    await tweens.wait(0.6);
    await this.settleAll(false);
  }

  private newHand(bet: number): Hand {
    const label = new HandLabel();
    this.group.add(label.sprite);
    return { cards: [], meshes: [], bet, doubled: false, done: false, surrendered: false, split: false, splitAces: false, paid: 0, label };
  }

  private handPos(seat: number, hand: number, nHands: number, k: number): [number, number, number, number] {
    const a = SEAT_ANGLES[seat];
    const [bx, bz] = this.polar(0.6, a);
    const tx = Math.cos(a);
    const tz = -Math.sin(a);
    const off = (hand - (nHands - 1) / 2) * (CARD_W + 0.035);
    const x = bx + tx * (off + k * 0.016) - Math.sin(a) * k * 0.022;
    const z = bz + tz * (off + k * 0.016) - Math.cos(a) * k * 0.022;
    return [x, this.surfaceY + 0.001 + k * 0.0009, z, a];
  }

  private async dealToHand(seat: number, hand: number, faceUp: boolean): Promise<void> {
    const p = this.plays[seat];
    const h = p.hands[hand];
    const card = this.shoe.draw();
    const c3 = new Card3D(card);
    c3.mesh.position.copy(this.shoeMesh.position).add(new THREE.Vector3(0, 0.08, 0.1));
    c3.mesh.rotation.z = Math.PI;
    this.group.add(c3.mesh);
    h.cards.push(card);
    h.meshes.push(c3);
    const [x, y, z, a] = this.handPos(seat, hand, p.hands.length, h.cards.length - 1);
    this.host?.sound('cards', 0.5);
    this.dealer?.react('dealCards', 'neutral', 0.4);
    await c3.dealTo(x, y, z, a, faceUp, 0.3);
    this.placeLabel(seat, hand);
  }

  private async dealToDealer(faceUp: boolean): Promise<void> {
    const card = this.shoe.draw();
    const c3 = new Card3D(card);
    c3.mesh.position.copy(this.shoeMesh.position).add(new THREE.Vector3(0, 0.08, 0.1));
    c3.mesh.rotation.z = Math.PI;
    this.group.add(c3.mesh);
    this.dealerCards.push(card);
    this.dealerMeshes.push(c3);
    const k = this.dealerCards.length - 1;
    this.host?.sound('cards', 0.5);
    this.dealer?.react('dealCards', 'neutral', 0.4);
    await c3.dealTo(C.x - 0.04 + k * 0.072 - (this.dealerCards.length > 2 ? 0.03 * (this.dealerCards.length - 2) : 0), this.surfaceY + 0.001 + k * 0.0009, C.z + 0.27, 0, faceUp, 0.3);
  }

  private placeLabel(seat: number, hand: number): void {
    const p = this.plays[seat];
    const h = p.hands[hand];
    const [x, , z] = this.handPos(seat, hand, p.hands.length, 0);
    h.label.sprite.position.set(x, this.surfaceY + 0.11, z + 0.02);
  }

  private showTotals(): void {
    for (const i of this.order().concat(this.plays.map((p, i) => (p.hands.length ? i : -1)).filter((i) => i >= 0))) {
      const p = this.plays[i];
      p.hands.forEach((h, hi) => {
        this.placeLabel(i, hi);
        const { total, soft } = bjTotal(h.cards);
        if (h.surrendered) h.label.set('SURRENDER', '#ffb020');
        else if (total > 21) h.label.set('BUST', '#ff6b6b');
        else if (isBlackjack(h.cards) && !h.split) h.label.set('BLACKJACK!', '#7dff9a');
        else h.label.set(soft && total < 21 ? `${total - 10}/${total}` : String(total));
      });
    }
    const showing = this.dealerMeshes.filter((m) => m.faceUp).map((m) => m.card!);
    if (showing.length) {
      const { total, soft } = bjTotal(showing);
      this.dealerLabel.set(total > 21 ? 'BUST' : soft && total < 21 && showing.length > 1 ? `${total - 10}/${total}` : String(total), total > 21 ? '#7dff9a' : '#ffffff');
    } else this.dealerLabel.set('');
  }

  private async applyMove(seat: number, hi: number, move: BjMove): Promise<void> {
    const p = this.plays[seat];
    const hand = p.hands[hi];
    switch (move) {
      case 'hit':
        await this.dealToHand(seat, hi, true);
        break;
      case 'stand':
        hand.done = true;
        break;
      case 'double':
        hand.bet *= 2;
        hand.doubled = true;
        this.refreshPiles(seat);
        await this.dealToHand(seat, hi, true);
        // The doubled card lies sideways.
        hand.meshes[hand.meshes.length - 1].mesh.rotation.y += Math.PI / 2;
        hand.done = true;
        break;
      case 'surrender':
        hand.surrendered = true;
        hand.done = true;
        break;
      case 'split': {
        const second = hand.cards.pop()!;
        const secondMesh = hand.meshes.pop()!;
        const nh = this.newHand(hand.bet);
        nh.split = true;
        hand.split = true;
        nh.cards.push(second);
        nh.meshes.push(secondMesh);
        p.hands.splice(hi + 1, 0, nh);
        const aces = second.rank === 0;
        // Spread the hands out.
        p.hands.forEach((h, j) => {
          h.meshes.forEach((m, k) => {
            const [x, y, z, a] = this.handPos(seat, j, p.hands.length, k);
            void m.dealTo(x, y, z, a, true, 0.25);
          });
        });
        await tweens.wait(0.3);
        this.refreshPiles(seat);
        await this.dealToHand(seat, hi, true);
        await this.dealToHand(seat, hi + 1, true);
        if (aces) {
          hand.splitAces = nh.splitAces = true;
          hand.done = nh.done = true;
        }
        break;
      }
    }
    this.showTotals();
  }

  private payHand(seat: number, amount: number): void {
    if (seat === this.mySeat && this.host) this.host.give(amount);
    else if (this.seats[seat].npc) this.seats[seat].npc!.bank += amount;
  }

  private async settleSide(seat: number, which: 'pp' | 'p213', stake: number, pays: number, name: string): Promise<void> {
    const host = this.host;
    if (pays > 0) {
      const win = stake * pays;
      this.setPile(seat, which === 'pp' ? 'win2' : 'win3', win);
      this.payHand(seat, stake + win);
      if (seat === this.mySeat && host) {
        host.toast(`${which === 'pp' ? 'Perfect Pairs' : '21+3'}: ${name}! +${money(win)}`, 'money');
        host.sound('win', 0.7);
        if (pays >= 25) host.celebrate('big', win);
      }
    }
    this.setPile(seat, which, 0);
    await tweens.wait(0.25);
  }

  private async settleAll(dealerBJ: boolean): Promise<void> {
    this.phase = 'settle';
    const host = this.host;
    const dT = bjTotal(this.dealerCards).total;
    let myStake = 0;
    let myBack = 0;
    for (let i = 0; i < this.plays.length; i++) {
      const p = this.plays[i];
      if (!p.hands.length) continue;
      // Insurance pays 2:1 on a dealer blackjack.
      if (p.insurance) {
        if (dealerBJ) this.payHand(i, p.insurance * 3);
        if (i === this.mySeat) {
          myStake += p.insurance;
          if (dealerBJ) myBack += p.insurance * 3;
        }
        p.insurance = 0;
        this.setPile(i, 'ins', 0);
      }
      let back = 0;
      let staked = 0;
      let prepaid = 0;
      for (const h of p.hands) {
        staked += h.bet;
        if (h.paid) {
          prepaid += h.paid;
          continue;
        }
        const t = bjTotal(h.cards).total;
        const bj = isBlackjack(h.cards) && !h.split;
        let ret = 0;
        if (h.surrendered) ret = h.bet / 2;
        else if (t > 21) ret = 0;
        else if (dealerBJ) ret = bj ? h.bet : 0;
        else if (bj) ret = h.bet * 2.5;
        else if (dT > 21 || t > dT) ret = h.bet * 2;
        else if (t === dT) ret = h.bet;
        back += ret;
        const npc = this.seats[i].npc;
        if (npc) npc.react(ret > h.bet ? 'cheer' : ret === 0 ? 'facepalm' : 'idle', ret > h.bet ? 'grin' : ret === 0 ? 'sad' : 'neutral');
      }
      if (back > 0) {
        this.setPile(i, 'win', Math.max(0, back - staked));
        this.payHand(i, back);
      }
      if (i === this.mySeat) {
        myStake += staked;
        myBack += back + prepaid;
      }
    }
    this.showTotals();
    if (host) {
      const net = myBack - myStake;
      if (net > 0) {
        this.display.show('YOU WIN', `+${money(net)}`, '#7dff9a');
        host.sound(net >= myStake * 1.4 ? 'bigwin' : 'win');
        this.dealer?.react('clap', 'happy');
        if (net >= 5000) host.celebrate('big', net);
      } else if (net < 0) {
        this.display.show(myBack > 0 ? 'PUSH SOME' : 'DEALER WINS', money(net), '#ff8a8a');
      } else if (myStake > 0) this.display.show('PUSH', 'Bet returned', '#ffffff');
      host.record('blackjack', myStake, myBack);
    }
    await tweens.wait(2.2);
    // Sweep: cards to the discard holder, chips away.
    let n = 0;
    for (const p of this.plays) {
      for (const h of p.hands) {
        for (const m of h.meshes) {
          void m.dealTo(-0.78, this.surfaceY + 0.06, C.z + 0.14, 0.6, false, 0.3).then(() => m.dispose());
          n++;
        }
        h.label.sprite.removeFromParent();
      }
      p.hands = [];
    }
    for (const m of this.dealerMeshes) {
      void m.dealTo(-0.78, this.surfaceY + 0.06, C.z + 0.14, 0.6, false, 0.3).then(() => m.dispose());
      n++;
    }
    this.discard += n;
    this.discardStack.scale.y = Math.max(0.0001, this.discard * 0.0004);
    this.discardStack.position.y = this.surfaceY + this.discardStack.scale.y / 2;
    this.dealerCards = [];
    this.dealerMeshes = [];
    this.dealerLabel.set('');
    for (let i = 0; i < this.plays.length; i++) {
      this.plays[i] = this.emptyPlay();
      for (const w of ['main', 'pp', 'p213', 'win', 'ins', 'win2', 'win3'] as const) this.setPile(i, w, 0);
    }
    await tweens.wait(0.4);
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `$${this.minBet} - ${money(this.maxBet)}`);
    this.speech.say('Place your bets.');
    // NPCs come and go between hands.
    this.seats.forEach((s, i) => {
      if (s.who === 'npc' && s.npc && (s.npc.bank < this.minBet * 2 || this.rng() < 0.08)) this.unseatNpc(i);
      else if (!s.who && this.rng() < 0.08) this.seatNpc(i);
    });
    this.refreshOptions();
  }

  tick(dt: number): void {
    if (this.host) {
      if (this.phase === 'betting') this.refreshOptions();
      return;
    }
    // Nobody playing: the dealer shuffles chips now and then.
    this.ambientT -= dt;
    if (this.ambientT < 0) {
      this.ambientT = 5 + this.rng() * 6;
      this.dealer?.react(this.rng() < 0.5 ? 'deal' : 'idle', 'neutral', 1.5);
    }
  }
}
