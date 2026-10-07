import * as THREE from 'three';
import { TableBase, HandLabel } from '../table';
import { buildHalfMoon, hmPolar, HM, feltArcLabel } from '../halfmoon';
import { Card3D } from '../cards3d';
import { Shoe } from '../cards';
import { dealBaccarat, baccaratReturn, baccaratTotal, bigRoad, beadPlate, type BaccaratRound, type CoupMark } from '../rules';
import { CanvasScreen } from '../../render/signs';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';
import type { Card } from '../types';

/**
 * Punto banco (midi baccarat): eight decks with a cut card, the full third-card tableau,
 * Player pays 1:1, Banker 19:20 (5% commission), Tie 8:1, and the Player Pair and Banker
 * Pair side bets 11:1. The dealer turns the hands over in the middle of the table, and the
 * electronic board beside it keeps the bead plate and the big road.
 */

const ANGLES = [0.9, 0.3, -0.3, -0.9];
type Spot = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair';
const SPOTS: Spot[] = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'];

function spotPos(seat: number, s: Spot): [number, number] {
  const a = ANGLES[seat];
  switch (s) {
    case 'player':
      return hmPolar(0.97, a);
    case 'banker':
      return hmPolar(0.82, a);
    case 'tie':
      return hmPolar(0.68, a);
    case 'playerPair':
      return hmPolar(1.06, a + 0.15);
    default:
      return hmPolar(1.06, a - 0.15);
  }
}

function drawFelt(g: CanvasRenderingContext2D, W: number, _H: number, s: number): void {
  const cx = W / 2;
  const gold = '#f2d27a';
  feltArcLabel(g, 'BANKER PAYS 19 TO 20 · TIE PAYS 8 TO 1 · PAIRS PAY 11 TO 1', cx, 0.47 * s, 0, 24, gold);
  for (const a of ANGLES) {
    for (const sp of SPOTS) {
      const [x, z] = spotPos(ANGLES.indexOf(a), sp);
      const px = cx + x * s;
      const pz = (z - HM.cz) * s;
      const big = sp === 'player' || sp === 'banker' || sp === 'tie';
      const r = big ? 0.06 * s : 0.035 * s;
      g.lineWidth = big ? 4 : 2.5;
      g.strokeStyle = sp === 'player' || sp === 'playerPair' ? '#5fb0ff' : sp === 'tie' ? '#7dff9a' : '#ff6b6b';
      g.beginPath();
      g.arc(px, pz, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = `${big ? 15 : 11}px "Lilita One", Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.translate(px, pz);
      g.rotate(-a);
      g.fillText(sp === 'playerPair' ? 'P PAIR' : sp === 'bankerPair' ? 'B PAIR' : sp.toUpperCase(), 0, 0);
      g.restore();
    }
  }
  // Card boxes in the middle.
  for (const [lbl, x, col] of [['PLAYER', -0.26, '#5fb0ff'], ['BANKER', 0.26, '#ff6b6b']] as const) {
    const px = cx + x * s;
    const pz = 0.32 * s;
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.strokeRect(px - 0.17 * s, pz - 0.075 * s, 0.34 * s, 0.15 * s);
    g.fillStyle = col;
    g.font = '22px "Lilita One", Arial';
    g.textAlign = 'center';
    g.fillText(lbl, px, pz - 0.1 * s);
  }
}

type Phase = 'betting' | 'dealing' | 'settle';

export class BaccaratTable extends TableBase {
  readonly kind = 'baccarat' as const;
  readonly name = 'Baccarat';
  private shoe: Shoe;
  private shoeObj!: THREE.Object3D;
  private phase: Phase = 'betting';
  private bets: Record<Spot, number>[] = [];
  private lastBets: Record<Spot, number> | null = null;
  private cards: Card3D[] = [];
  private coups: CoupMark[] = [];
  private board = new CanvasScreen(512, 256);
  private pLabel = new HandLabel();
  private bLabel = new HandLabel();

  constructor(seed: number, opts: { felt?: string; min?: number; max?: number } = {}) {
    super(seed);
    this.minBet = opts.min ?? 25;
    this.maxBet = opts.max ?? 10000;
    this.shoe = new Shoe(8, this.rng, 16);
    const { shoe } = buildHalfMoon(this, 'baccarat', drawFelt, opts.felt ?? '#5a1a2a', ANGLES);
    this.shoeObj = shoe;
    this.focus.set(0, 0.95, -0.15);
    for (let i = 0; i < ANGLES.length; i++) this.bets.push(this.empty());
    this.addDealer(0, HM.cz - 0.42);
    // Scoreboard on a post by the dealer.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), new THREE.MeshPhongMaterial({ color: 0x111114 }));
    post.position.set(0.62, this.surfaceY + 0.35, HM.cz - 0.12);
    this.group.add(post);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.24), new THREE.MeshBasicMaterial({ map: this.board.texture, toneMapped: false }));
    scr.position.set(0.62, this.surfaceY + 0.82, HM.cz - 0.1);
    scr.rotation.y = -0.4;
    this.group.add(scr);
    for (const l of [this.pLabel, this.bLabel]) this.group.add(l.sprite);
    this.pLabel.sprite.position.set(-0.26, this.surfaceY + 0.13, HM.cz + 0.24);
    this.bLabel.sprite.position.set(0.26, this.surfaceY + 0.13, HM.cz + 0.24);
    // A short history so the board isn't empty.
    for (let i = 0; i < 18; i++) {
      const r = dealBaccarat(() => this.shoe.draw());
      this.coups.push({ winner: r.winner === 'player' ? 'P' : r.winner === 'banker' ? 'B' : 'T', pp: r.playerPair, bp: r.bankerPair, natural: r.natural });
    }
    this.drawBoard();
  }

  private empty(): Record<Spot, number> {
    return { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 };
  }

  private drawBoard(): void {
    const g = this.board.g;
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, 512, 256);
    const cell = 21;
    // Bead plate on the left, big road on the right.
    g.strokeStyle = '#d0ccc0';
    g.lineWidth = 1;
    for (let c = 0; c <= 8; c++) {
      g.beginPath();
      g.moveTo(8 + c * cell, 30);
      g.lineTo(8 + c * cell, 30 + 6 * cell);
      g.stroke();
    }
    const bead = beadPlate(this.coups.slice(-48));
    for (const b of bead) {
      g.fillStyle = b.winner === 'P' ? '#1e6bff' : b.winner === 'B' ? '#d8202f' : '#1f9a4c';
      g.beginPath();
      g.arc(8 + b.col * cell + cell / 2, 30 + b.row * cell + cell / 2, cell * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '12px "Lilita One", Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(b.winner === 'P' ? 'P' : b.winner === 'B' ? 'B' : 'T', 8 + b.col * cell + cell / 2, 30 + b.row * cell + cell / 2 + 1);
    }
    const road = bigRoad(this.coups.slice(-60));
    const ox = 200;
    for (const r of road) {
      if (r.col > 14) continue;
      g.strokeStyle = r.winner === 'P' ? '#1e6bff' : '#d8202f';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(ox + r.col * cell + cell / 2, 30 + r.row * cell + cell / 2, cell * 0.38, 0, Math.PI * 2);
      g.stroke();
      if (r.ties) {
        g.strokeStyle = '#1f9a4c';
        g.beginPath();
        g.moveTo(ox + r.col * cell + 4, 30 + r.row * cell + cell - 4);
        g.lineTo(ox + r.col * cell + cell - 4, 30 + r.row * cell + 4);
        g.stroke();
      }
    }
    const last = this.coups.slice(-60);
    const pc = last.filter((c) => c.winner === 'P').length;
    const bc = last.filter((c) => c.winner === 'B').length;
    const tc = last.filter((c) => c.winner === 'T').length;
    g.fillStyle = '#15151a';
    g.font = '18px "Lilita One", Arial';
    g.textAlign = 'left';
    g.fillText(`BANKER ${bc}   PLAYER ${pc}   TIE ${tc}`, 10, 18);
    g.fillText(`MIN ${money(this.minBet)}  MAX ${money(this.maxBet)}`, 10, 210);
    this.board.update();
  }

  protected onEnter(): void {
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `${money(this.minBet)} - ${money(this.maxBet)}`);
    this.speech.say('Player, Banker or Tie?');
    this.refreshOptions();
  }

  protected onExit(): void {
    if (this.phase === 'betting') {
      const b = this.bets[this.mySeat];
      const back = SPOTS.reduce((a, s) => a + b[s], 0);
      if (back) this.host?.give(back);
      this.bets[this.mySeat] = this.empty();
      this.refreshPiles(this.mySeat);
    }
  }

  canLeave(): boolean {
    return this.phase === 'betting';
  }

  private refreshPiles(seat: number): void {
    for (const s of SPOTS) {
      const [x, z] = spotPos(seat, s);
      this.chips.set(`${seat}:${s}`, x, this.surfaceY + 0.001, z, this.bets[seat][s]);
    }
  }

  private myTotal(): number {
    const b = this.bets[this.mySeat];
    return b ? SPOTS.reduce((a, s) => a + b[s], 0) : 0;
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const total = this.myTotal();
    if (this.phase === 'betting') {
      h.options.show({
        title: 'BACCARAT · PUNTO BANCO',
        chips: true,
        bet: total,
        balance: h.balance(),
        hint: 'Click PLAYER, BANKER, TIE or the pair circles in front of you · right-click to take a bet back',
        buttons: [
          { id: 'clear', label: 'Clear', key: 'C', enabled: total > 0 },
          { id: 'rebet', label: 'Rebet', key: 'R', enabled: total === 0 && !!this.lastBets },
          { id: 'deal', label: 'Deal', key: 'Space', primary: true, enabled: total > 0 },
          { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
        ],
      });
    } else h.options.show({ title: 'BACCARAT', bet: total, balance: h.balance(), buttons: [{ id: 'wait', label: 'Dealing…', enabled: false }] });
  }

  click(p: THREE.Vector3, button: number): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    let hit: Spot | null = null;
    for (const s of SPOTS) {
      const [x, z] = spotPos(this.mySeat, s);
      const r = s === 'playerPair' || s === 'bankerPair' ? 0.05 : 0.075;
      if (Math.hypot(p.x - x, p.z - z) < r) hit = s;
    }
    if (!hit) return;
    const b = this.bets[this.mySeat];
    if (button === 2) {
      if (b[hit]) {
        h.give(b[hit]);
        b[hit] = 0;
        h.sound('chips', 0.5);
      }
    } else {
      const cap = hit === 'player' || hit === 'banker' ? this.maxBet : Math.min(this.maxBet, Math.max(100, this.maxBet / 10));
      const add = Math.min(h.options.selectedChip, cap - b[hit]);
      if (add <= 0) {
        this.speech.say(`Limit there is ${money(cap)}.`);
        return;
      }
      if (!h.take(add)) {
        this.speech.say("You're short for that chip.");
        return;
      }
      b[hit] += add;
      h.sound('chips', 0.6);
      this.display.show(hit === 'playerPair' ? 'PLAYER PAIR' : hit === 'bankerPair' ? 'BANKER PAIR' : hit.toUpperCase(), `on it: ${money(b[hit])}`);
    }
    this.refreshPiles(this.mySeat);
    this.refreshOptions();
  }

  key(code: string): boolean {
    const map: Record<string, string> = { Space: 'deal', KeyC: 'clear', KeyR: 'rebet' };
    if (!map[code]) return false;
    this.button(map[code]);
    return true;
  }

  button(id: string): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    const b = this.bets[this.mySeat];
    if (id === 'clear') {
      const back = this.myTotal();
      if (back) h.give(back);
      this.bets[this.mySeat] = this.empty();
    } else if (id === 'rebet' && this.lastBets) {
      const need = SPOTS.reduce((a, s) => a + this.lastBets![s], 0);
      if (h.take(need)) this.bets[this.mySeat] = { ...this.lastBets };
      else this.speech.say("You're short for a rebet.");
    } else if (id === 'deal' && this.myTotal() > 0) {
      this.lastBets = { ...b };
      void this.round();
    }
    this.refreshPiles(this.mySeat);
    this.refreshOptions();
  }

  private async dealCard(card: Card, x: number, z: number, faceUp: boolean): Promise<Card3D> {
    const c = new Card3D(card, 1);
    c.mesh.position.copy(this.shoeObj.position);
    c.mesh.rotation.z = Math.PI;
    this.group.add(c.mesh);
    this.cards.push(c);
    this.host?.sound('cards', 0.5);
    this.dealer?.react('dealCards', 'neutral', 0.4);
    await c.dealTo(x, this.surfaceY + 0.001, z, 0, faceUp, 0.32);
    return c;
  }

  private async round(): Promise<void> {
    const h = this.host;
    if (!h) return;
    this.phase = 'dealing';
    this.refreshOptions();
    // NPCs bet (most back the banker, as at real tables).
    this.seats.forEach((s, i) => {
      if (s.who !== 'npc') return;
      const unit = this.minBet * (1 + Math.floor(this.rng() * 3));
      const roll = this.rng();
      this.bets[i][roll < 0.55 ? 'banker' : roll < 0.95 ? 'player' : 'tie'] = unit;
      if (this.rng() < 0.15) this.bets[i].playerPair = this.minBet;
      this.refreshPiles(i);
    });
    this.display.show('NO MORE BETS', '');
    this.speech.say('No more bets.');
    await tweens.wait(0.6);
    if (this.shoe.cutCardOut) {
      this.speech.say('New shoe!');
      this.shoe.shuffle();
      this.shoe.burn();
      await tweens.wait(1);
    }
    const r: BaccaratRound = dealBaccarat(() => this.shoe.draw());
    const pz = HM.cz + 0.32;
    const pPos = (i: number) => (i < 2 ? -0.31 + i * 0.075 : -0.15);
    const bPos = (i: number) => (i < 2 ? 0.21 + i * 0.075 : 0.37);
    // Player, banker, player, banker; then the third cards.
    const pMeshes: Card3D[] = [];
    const bMeshes: Card3D[] = [];
    pMeshes.push(await this.dealCard(r.player[0], pPos(0), pz, false));
    bMeshes.push(await this.dealCard(r.banker[0], bPos(0), pz, false));
    pMeshes.push(await this.dealCard(r.player[1], pPos(1), pz, false));
    bMeshes.push(await this.dealCard(r.banker[1], bPos(1), pz, false));
    await tweens.wait(0.4);
    // The hands are turned over.
    await Promise.all(pMeshes.map((m) => m.flip(true)));
    this.pLabel.set(`PLAYER ${baccaratTotal(r.player.slice(0, 2))}`, '#5fb0ff');
    await tweens.wait(0.5);
    await Promise.all(bMeshes.map((m) => m.flip(true)));
    this.bLabel.set(`BANKER ${baccaratTotal(r.banker.slice(0, 2))}`, '#ff6b6b');
    await tweens.wait(0.7);
    if (r.natural) this.speech.say(`Natural ${Math.max(r.playerTotal, r.bankerTotal)}!`);
    if (r.player.length > 2) {
      this.speech.say('Card for the player.');
      const m = await this.dealCard(r.player[2], pPos(2), pz + 0.02, true);
      m.mesh.rotation.y = Math.PI / 2;
      this.pLabel.set(`PLAYER ${r.playerTotal}`, '#5fb0ff');
      await tweens.wait(0.6);
    }
    if (r.banker.length > 2) {
      this.speech.say('Card for the banker.');
      const m = await this.dealCard(r.banker[2], bPos(2), pz + 0.02, true);
      m.mesh.rotation.y = Math.PI / 2;
      this.bLabel.set(`BANKER ${r.bankerTotal}`, '#ff6b6b');
      await tweens.wait(0.6);
    }
    const word = r.winner === 'tie' ? `Tie, ${r.playerTotal} all.` : `${r.winner === 'player' ? 'Player' : 'Banker'} wins, ${Math.max(r.playerTotal, r.bankerTotal)} over ${Math.min(r.playerTotal, r.bankerTotal)}.`;
    this.speech.say(word);
    this.display.show(r.winner === 'tie' ? 'TIE' : `${r.winner.toUpperCase()} WINS`, `${r.playerTotal} - ${r.bankerTotal}`, r.winner === 'player' ? '#5fb0ff' : r.winner === 'banker' ? '#ff6b6b' : '#7dff9a');
    this.coups.push({ winner: r.winner === 'player' ? 'P' : r.winner === 'banker' ? 'B' : 'T', pp: r.playerPair, bp: r.bankerPair, natural: r.natural });
    this.drawBoard();
    await this.settle(r);
  }

  private async settle(r: BaccaratRound): Promise<void> {
    const h = this.host;
    this.phase = 'settle';
    await tweens.wait(0.8);
    let myStake = 0;
    let myBack = 0;
    this.bets.forEach((b, i) => {
      let back = 0;
      let stake = 0;
      for (const s of SPOTS) {
        if (!b[s]) continue;
        stake += b[s];
        const ret = baccaratReturn(s, b[s], r);
        back += ret;
        const [x, z] = spotPos(i, s);
        this.chips.set(`${i}:${s}`, x, this.surfaceY + 0.001, z, ret > 0 ? b[s] : 0);
        if (ret > b[s]) this.chips.set(`${i}:${s}:w`, x + 0.035, this.surfaceY + 0.001, z + 0.02, Math.floor(ret - b[s]));
      }
      if (i === this.mySeat) {
        myStake = stake;
        myBack = back;
        if (back) h?.give(back);
      } else if (stake && this.seats[i].npc) this.seats[i].npc!.react(back > stake ? 'cheer' : back === 0 ? 'facepalm' : 'idle', back > stake ? 'grin' : 'sad');
    });
    if (h) {
      const net = myBack - myStake;
      if (net > 0) {
        h.sound(net > myStake * 4 ? 'bigwin' : 'win');
        this.display.show(`YOU WIN ${money(net)}`, r.winner === 'banker' ? 'Banker pays 19 to 20' : '', '#7dff9a');
        if (net >= 10000) h.celebrate('big', net);
      } else if (myStake) this.display.show(myBack > 0 ? 'PUSH' : 'NO WIN', '', '#ff8a8a');
      h.record('baccarat', myStake, myBack);
    }
    await tweens.wait(2.4);
    for (const c of this.cards) void c.dealTo(-0.78, this.surfaceY + 0.06, HM.cz + 0.14, 0.6, false, 0.3).then(() => c.dispose());
    this.cards = [];
    this.chips.clear();
    for (let i = 0; i < this.bets.length; i++) this.bets[i] = this.empty();
    this.pLabel.set('');
    this.bLabel.set('');
    await tweens.wait(0.4);
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `${money(this.minBet)} - ${money(this.maxBet)}`);
    this.refreshOptions();
  }

  tick(): void {
    if (this.host && this.phase === 'betting') this.refreshOptions();
  }
}
