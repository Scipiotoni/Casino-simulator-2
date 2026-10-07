import * as THREE from 'three';
import { TableBase, stoolParts } from '../table';
import { Kit } from '../../render/kit';
import { markStatic } from '../../render/mergeStatic';
import { CanvasScreen } from '../../render/signs';
import { drawCard } from '../cards3d';
import { Shoe } from '../cards';
import { JOB_PAYTABLE, jacksOrBetter, vpPays, simpleHold } from '../rules';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';
import type { Card } from '../types';

/**
 * Jacks or Better video poker, full pay 9/6, on a real machine: bet one to five coins,
 * DEAL, touch the cards on the screen (or press 1–5) to hold them, DRAW. The royal flush
 * pays 4,000 coins at max bet. The paytable glass lights the column you're playing and
 * the line your hand makes.
 */

const SCREEN_W = 640;
const SCREEN_H = 560;
const PICK = new THREE.MeshBasicMaterial({ visible: false });

type Phase = 'idle' | 'dealt' | 'drawing';

export class VideoPokerMachine extends TableBase {
  readonly kind = 'videopoker' as const;
  readonly name = 'Video Poker';
  private screen = new CanvasScreen(SCREEN_W, SCREEN_H);
  private screenMesh!: THREE.Mesh;
  private buttons = new Map<THREE.Object3D, string>();
  private deck: Shoe;
  private hand: Card[] = [];
  private held = [false, false, false, false, false];
  private phase: Phase = 'idle';
  private coins = 5;
  private denom: number;
  private result = '';
  private lastWin = 0;
  private faceDown = [false, false, false, false, false];
  private ambient = 8 + Math.random() * 8;

  constructor(seed: number, opts: { min?: number; max?: number } = {}) {
    super(seed);
    this.denom = Math.max(1, opts.min ?? 1);
    this.minBet = this.denom;
    this.maxBet = this.denom * 5;
    this.deck = new Shoe(1, this.rng);
    this.build();
    this.hand = [0, 1, 2, 3, 4].map(() => this.deck.draw());
    this.draw();
  }

  private build(): void {
    const k = new Kit();
    k.rbox(0.66, 0.72, 0.56, 0.03, 0x15151a, { y: 0.36 }, 'shiny');
    k.box(0.68, 0.04, 0.58, 0xd8b04a, { y: 0.72 }, 'shiny');
    k.rbox(0.7, 1.15, 0.5, 0.05, 0x1d2a5a, { y: 1.32, z: -0.06 }, 'shiny');
    k.box(0.72, 0.06, 0.24, 0x15151a, { y: 1.0, z: 0.34, rx: 0.12 }, 'shiny');
    // Buttons: five HOLD, BET ONE, BET MAX, DEAL/DRAW.
    for (let i = 0; i < 5; i++) k.box(0.075, 0.02, 0.035, 0xffd23d, { x: -0.27 + i * 0.09, y: 1.04, z: 0.38, rx: 0.12 }, 'glow');
    k.box(0.09, 0.02, 0.035, 0x7cff5a, { x: -0.22, y: 1.035, z: 0.31, rx: 0.12 }, 'glow');
    k.box(0.09, 0.02, 0.035, 0xffb020, { x: -0.11, y: 1.035, z: 0.31, rx: 0.12 }, 'glow');
    k.box(0.14, 0.02, 0.035, 0xff3b3b, { x: 0.2, y: 1.035, z: 0.31, rx: 0.12 }, 'glow');
    k.rbox(0.72, 0.2, 0.5, 0.06, 0x1d2a5a, { y: 2.0, z: -0.06 }, 'shiny');
    k.box(0.6, 0.12, 0.01, 0x05050a, { y: 2.0, z: 0.195 });
    stoolParts(k, 0, 0.78, Math.PI, 0x2a2a30);
    const cab = k.bake({ shadows: true });
    markStatic(cab);
    this.group.add(cab);
    // The screen (tilted back a little), holding the paytable, the cards and the meters.
    this.screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.525), new THREE.MeshBasicMaterial({ map: this.screen.texture, toneMapped: false }));
    this.screenMesh.position.set(0, 1.42, 0.2);
    this.screenMesh.rotation.x = -0.12;
    this.group.add(this.screenMesh);
    this.pickables.push(this.screenMesh);
    const pick = (id: string, x: number, z: number, w: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), PICK);
      m.position.set(x, 1.04, z);
      m.rotation.x = 0.12;
      this.group.add(m);
      this.pickables.push(m);
      this.buttons.set(m, id);
    };
    for (let i = 0; i < 5; i++) pick(`hold${i}`, -0.27 + i * 0.09, 0.38, 0.08);
    pick('one', -0.22, 0.31, 0.1);
    pick('max', -0.11, 0.31, 0.1);
    pick('deal', 0.2, 0.31, 0.15);
    this.seats.push({ x: 0, z: 0.78, yaw: Math.PI, who: null, eye: 1.22 });
    this.focus.set(0, 1.36, 0.2);
  }

  private draw(): void {
    const g = this.screen.g;
    const W = SCREEN_W;
    const H = SCREEN_H;
    g.fillStyle = '#0a1a6a';
    g.fillRect(0, 0, W, H);
    // Paytable with five coin columns; the one you're playing is lit.
    const top = 8;
    const rowH = 22;
    const colW = 74;
    const x0 = 220;
    g.fillStyle = '#c8202f';
    g.fillRect(x0 + (this.coins - 1) * colW, top, colW, rowH * JOB_PAYTABLE.length + 4);
    const best = this.phase !== 'dealt' ? this.result : jacksOrBetter(this.hand).name;
    JOB_PAYTABLE.forEach((l, i) => {
      const y = top + 16 + i * rowH;
      const lit = l.name === best && (this.phase === 'idle' ? this.lastWin > 0 : true);
      g.fillStyle = lit ? '#ffffff' : '#ffd23d';
      g.font = '19px "Lilita One", Arial';
      g.textAlign = 'left';
      g.fillText(l.name.toUpperCase(), 14, y);
      for (let c = 1; c <= 5; c++) {
        g.textAlign = 'right';
        g.fillText(String(vpPays(l.name, c)), x0 + c * colW - 8, y);
      }
    });
    // The cards.
    const cy = 230;
    const cw = 112;
    const ch = 158;
    for (let i = 0; i < 5; i++) {
      const x = 14 + i * (cw + 10);
      drawCard(g, this.faceDown[i] ? null : this.hand[i] ?? null, x, cy, cw, ch, 1);
      if (this.held[i] && this.phase === 'dealt') {
        g.fillStyle = '#ffd23d';
        g.font = '28px "Lilita One", Arial';
        g.textAlign = 'center';
        g.fillText('HELD', x + cw / 2, cy - 8);
      }
    }
    // Message line and meters.
    g.textAlign = 'center';
    g.font = '30px "Lilita One", Arial';
    g.fillStyle = '#ffffff';
    const msg = this.phase === 'dealt' ? 'TOUCH CARDS TO HOLD, THEN DRAW' : this.lastWin > 0 ? `${this.result.toUpperCase()}!  WIN ${this.lastWin * this.denom}` : this.result ? (this.result === 'Nothing' || this.result === 'Low pair' ? 'GAME OVER' : this.result.toUpperCase()) : 'PLAY 5 COINS FOR THE ROYAL BONUS';
    g.fillText(msg, W / 2, cy + ch + 42);
    g.fillStyle = '#05050a';
    g.fillRect(0, H - 52, W, 52);
    g.font = '24px "Lilita One", Arial';
    g.fillStyle = '#ff3b3b';
    g.textAlign = 'left';
    g.fillText(`CREDIT ${money(this.host ? this.host.balance() : 0, true)}`, 14, H - 18);
    g.textAlign = 'center';
    g.fillText(`BET ${this.coins} × $${this.denom}`, W / 2, H - 18);
    g.textAlign = 'right';
    g.fillText(`WIN ${money(this.lastWin * this.denom, true)}`, W - 14, H - 18);
    this.screen.update();
  }

  protected onEnter(): void {
    this.phase = 'idle';
    this.result = '';
    this.lastWin = 0;
    this.held = [false, false, false, false, false];
    this.draw();
    this.refreshOptions();
  }

  protected onExit(): void {
    if (this.phase === 'dealt') {
      // Leaving mid-hand plays it as dealt.
      void this.drawCards();
    }
  }

  canLeave(): boolean {
    return this.phase !== 'drawing';
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const dealt = this.phase === 'dealt';
    h.options.show({
      title: 'JACKS OR BETTER 9/6',
      bet: this.coins * this.denom,
      balance: h.balance(),
      hint: dealt ? 'Touch the cards on the screen (or 1–5) to hold, then Draw' : `$${this.denom} a coin · 5 coins pays 4,000 on a royal flush`,
      buttons: [
        { id: 'one', label: `Bet one (${this.coins})`, key: 'B', enabled: !dealt && this.phase === 'idle' },
        { id: 'max', label: 'Bet max', key: 'M', enabled: !dealt && this.phase === 'idle' },
        { id: 'deal', label: dealt ? 'Draw' : 'Deal', key: 'Space', primary: true, enabled: this.phase !== 'drawing' },
        { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
      ],
    });
  }

  click(p: THREE.Vector3, button: number, object: THREE.Object3D): void {
    if (button !== 0 || !this.host) return;
    const id = this.buttons.get(object);
    if (id) {
      this.button(id);
      return;
    }
    if (object === this.screenMesh && this.phase === 'dealt') {
      // Which card was touched? Map the hit point to screen pixels.
      const local = this.screenMesh.worldToLocal(this.group.localToWorld(p.clone()));
      const sx = (local.x / 0.6 + 0.5) * SCREEN_W;
      const sy = (0.5 - local.y / 0.525) * SCREEN_H;
      if (sy > 220 && sy < 400) {
        const i = Math.floor((sx - 14) / 122);
        if (i >= 0 && i < 5) this.button(`hold${i}`);
      }
    }
  }

  key(code: string): boolean {
    const m = /^Digit([1-5])$/.exec(code);
    if (m) {
      this.button(`hold${Number(m[1]) - 1}`);
      return true;
    }
    const map: Record<string, string> = { Space: 'deal', Enter: 'deal', KeyB: 'one', KeyM: 'max' };
    if (!map[code]) return false;
    this.button(map[code]);
    return true;
  }

  button(id: string): void {
    const h = this.host;
    if (!h) return;
    if (id.startsWith('hold') && this.phase === 'dealt') {
      const i = Number(id.slice(4));
      this.held[i] = !this.held[i];
      h.sound('blip', 0.5);
    } else if (id === 'one' && this.phase === 'idle') {
      this.coins = (this.coins % 5) + 1;
      h.sound('coin', 0.4);
    } else if (id === 'max' && this.phase === 'idle') {
      this.coins = 5;
      void this.deal();
    } else if (id === 'deal') {
      if (this.phase === 'idle') void this.deal();
      else if (this.phase === 'dealt') void this.drawCards();
    }
    this.draw();
    this.refreshOptions();
  }

  private async deal(ambient = false): Promise<void> {
    const h = ambient ? null : this.host;
    if (!ambient) {
      if (!h) return;
      if (!h.take(this.coins * this.denom)) {
        h.sound('error', 0.5);
        return;
      }
    }
    this.deck.shuffle();
    this.held = [false, false, false, false, false];
    this.result = '';
    this.lastWin = 0;
    this.hand = [0, 1, 2, 3, 4].map(() => this.deck.draw());
    this.phase = 'drawing';
    for (let i = 0; i < 5; i++) {
      this.faceDown = this.faceDown.map((_, j) => j >= i);
      this.draw();
      h?.sound('cards', 0.35);
      await tweens.wait(0.09);
    }
    this.faceDown = [false, false, false, false, false];
    this.phase = 'dealt';
    this.draw();
    this.refreshOptions();
  }

  private async drawCards(ambient = false): Promise<void> {
    if (this.phase !== 'dealt') return;
    const h = ambient ? null : this.host;
    this.phase = 'drawing';
    this.refreshOptions();
    for (let i = 0; i < 5; i++) {
      if (this.held[i]) continue;
      this.faceDown[i] = true;
    }
    this.draw();
    await tweens.wait(0.15);
    for (let i = 0; i < 5; i++) {
      if (this.held[i]) continue;
      this.hand[i] = this.deck.draw();
      this.faceDown[i] = false;
      this.draw();
      h?.sound('cards', 0.35);
      await tweens.wait(0.12);
    }
    const r = jacksOrBetter(this.hand);
    this.result = r.name;
    this.lastWin = r.pays > 0 ? vpPays(r.name, this.coins) : 0;
    this.phase = 'idle';
    if (h) {
      const win = this.lastWin * this.denom;
      if (win > 0) {
        h.give(win);
        if (r.name === 'Royal Flush') h.celebrate('jackpot', win);
        else if (r.pays >= 25) h.celebrate('big', win);
        else h.sound('win', 0.7);
      }
      h.record('videopoker', this.coins * this.denom, win);
    }
    this.draw();
    this.refreshOptions();
  }

  protected sitPose(): 'sitSlot' {
    return 'sitSlot';
  }

  tick(dt: number): void {
    // An NPC at the machine plays by the book now and then (no money involved).
    if (!this.host && this.seats[0].who === 'npc') {
      this.ambient -= dt;
      if (this.ambient < 0) {
        this.ambient = 6 + this.rng() * 8;
        if (this.phase === 'idle') void this.deal(true).then(() => {
          this.held = simpleHold(this.hand);
          setTimeout(() => void this.drawCards(true), 1200);
        });
      }
    }
  }
}
