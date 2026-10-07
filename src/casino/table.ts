import * as THREE from 'three';
import { ChipLayer } from './chips';
import { CanvasScreen, roundRect } from '../render/signs';
import { CharacterModel } from '../chars/model';
import { Animator, type Pose } from '../chars/anim';
import { randomAppearance, type Appearance } from '../chars/skins';
import type { OptionsBar } from '../ui/optionsBar';
import type { SfxName } from '../core/audio';
import type { Expression } from '../chars/faces';
import { mulberry32 } from '../core/noise';

export type GameKind = 'blackjack' | 'roulette' | 'baccarat' | 'craps' | 'threecard' | 'slots' | 'videopoker' | 'bigsix';

/** What a table needs from the game while you're sitting at it. */
export interface GameHost {
  balance(): number;
  /** Take a stake from the player's money. False if they can't cover it. */
  take(amount: number): boolean;
  /** Pay the player (stake back plus winnings). */
  give(amount: number): void;
  options: OptionsBar;
  sound(name: SfxName, volume?: number): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad' | 'money'): void;
  /** Big moment: confetti and a banner. */
  celebrate(kind: 'win' | 'big' | 'jackpot', amount: number): void;
  leave(): void;
  /** Practice chips at your own tables: nothing real changes hands. */
  practice: boolean;
  /** Called with every settled round (for stats, story goals, the house's books). */
  record(kind: GameKind, staked: number, returned: number): void;
}

export interface Seat {
  /** Table-local position of the seat and the way it faces (towards the table). */
  x: number;
  z: number;
  yaw: number;
  /** Who's sitting: the player, an NPC, or nobody. */
  who: 'player' | 'npc' | null;
  npc?: Sitter;
  /** Eye height above the floor when seated (standing games are higher). */
  eye: number;
  standing?: boolean;
}

/** A seated NPC gambler (or the dealer): a character with an animator. */
export class Sitter {
  readonly model: CharacterModel;
  readonly anim: Animator;
  private holdPose: Pose | null = null;
  private holdT = 0;
  basePose: Pose;
  /** Their bankroll for the session. */
  bank: number;

  constructor(app: Appearance, pose: Pose, bank = 2000) {
    this.model = new CharacterModel(app);
    this.anim = new Animator(this.model);
    this.basePose = pose;
    this.anim.pose = pose;
    this.anim.snap();
    this.bank = bank;
  }

  react(pose: Pose, expr: Expression, seconds = 2.2): void {
    this.holdPose = pose;
    this.holdT = seconds;
    this.model.setExpression(expr, seconds);
  }

  update(dt: number, lookYaw = 0): void {
    if (this.holdT > 0) {
      this.holdT -= dt;
      this.anim.pose = this.holdPose ?? this.basePose;
      if (this.holdT <= 0) this.holdPose = null;
    } else this.anim.pose = this.basePose;
    this.anim.lookYaw += (lookYaw - this.anim.lookYaw) * Math.min(1, dt * 3);
    this.anim.update(dt);
  }
}

/** A little LED sign on the table: status, totals, results. In the world, not on screen. */
export class TableDisplay {
  readonly mesh: THREE.Mesh;
  private screen = new CanvasScreen(512, 160);
  private l1 = '';
  private l2 = '';

  constructor(w = 0.42, h = 0.13, private accent = '#ffd23d') {
    const mat = new THREE.MeshBasicMaterial({ map: this.screen.texture, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    this.show('PLACE YOUR BETS', '');
  }

  show(line1: string, line2 = '', color = this.accent): void {
    if (line1 === this.l1 && line2 === this.l2) return;
    this.l1 = line1;
    this.l2 = line2;
    const g = this.screen.g;
    const W = this.screen.width;
    const H = this.screen.height;
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = color;
    g.lineWidth = 6;
    roundRect(g, 4, 4, W - 8, H - 8, 14);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    let fs = line2 ? 54 : 66;
    g.font = `${fs}px "Lilita One", Arial`;
    while (g.measureText(line1).width > W - 40 && fs > 20) {
      fs -= 3;
      g.font = `${fs}px "Lilita One", Arial`;
    }
    g.fillText(line1, W / 2, line2 ? H * 0.36 : H / 2);
    if (line2) {
      g.fillStyle = '#ffffff';
      g.shadowColor = '#ffffff';
      g.shadowBlur = 6;
      let f2 = 40;
      g.font = `${f2}px "Lilita One", Arial`;
      while (g.measureText(line2).width > W - 40 && f2 > 16) {
        f2 -= 3;
        g.font = `${f2}px "Lilita One", Arial`;
      }
      g.fillText(line2, W / 2, H * 0.74);
    }
    g.shadowBlur = 0;
    this.screen.update();
  }
}

/** A floating speech bubble over the dealer ("Insurance?", "Seventeen."). */
export class SpeechBubble {
  readonly sprite: THREE.Sprite;
  private screen = new CanvasScreen(512, 128);
  private t = 0;

  constructor() {
    const mat = new THREE.SpriteMaterial({ map: this.screen.texture, transparent: true, depthTest: false, toneMapped: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(0.9, 0.225, 1);
    this.sprite.renderOrder = 20;
    this.sprite.visible = false;
  }

  say(text: string, seconds = 2.2): void {
    const g = this.screen.g;
    g.clearRect(0, 0, 512, 128);
    g.font = '44px "Lilita One", Arial';
    const w = Math.min(500, g.measureText(text).width + 50);
    g.fillStyle = 'rgba(255,255,255,0.96)';
    roundRect(g, 256 - w / 2, 8, w, 84, 30);
    g.fill();
    g.beginPath();
    g.moveTo(240, 90);
    g.lineTo(256, 118);
    g.lineTo(272, 90);
    g.fill();
    g.fillStyle = '#0b1530';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 52, 470);
    this.screen.update();
    this.sprite.visible = true;
    this.t = seconds;
  }

  update(dt: number): void {
    if (this.t > 0) {
      this.t -= dt;
      if (this.t <= 0) this.sprite.visible = false;
    }
  }
}

/** Floating number labels over hands ("17", "BUST"). */
export class HandLabel {
  readonly sprite: THREE.Sprite;
  private screen = new CanvasScreen(256, 96);
  private text = '';

  constructor() {
    const mat = new THREE.SpriteMaterial({ map: this.screen.texture, transparent: true, depthTest: false, toneMapped: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(0.12, 0.045, 1);
    this.sprite.renderOrder = 19;
    this.sprite.visible = false;
  }

  set(text: string, color = '#ffd23d'): void {
    if (!text) {
      this.sprite.visible = false;
      this.text = '';
      return;
    }
    this.sprite.visible = true;
    if (text === this.text) return;
    this.text = text;
    const g = this.screen.g;
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(5,10,25,0.85)';
    roundRect(g, 8, 8, 240, 80, 36);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = color;
    g.font = '54px "Lilita One", Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 50, 220);
    this.screen.update();
  }
}

/**
 * Everything every table shares: the model group, a chip layer, seats with stools, the
 * in-world display and dealer, and the seated session plumbing. Each game subclasses it.
 */
export abstract class TableBase {
  readonly group = new THREE.Group();
  readonly chips = new ChipLayer();
  readonly display: TableDisplay;
  readonly speech = new SpeechBubble();
  abstract readonly kind: GameKind;
  abstract readonly name: string;
  seats: Seat[] = [];
  /** Things the cursor can click (felt, machine buttons). */
  pickables: THREE.Object3D[] = [];
  dealer: Sitter | null = null;
  host: GameHost | null = null;
  mySeat = -1;
  minBet = 10;
  maxBet = 5000;
  /** Where to look from a seat (table-local). */
  focus = new THREE.Vector3(0, 0.78, 0);
  protected rng: () => number;
  private sitters: Sitter[] = [];
  /** Height of the playing surface. */
  surfaceY = 0.78;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.display = new TableDisplay();
    this.group.add(this.chips.group);
  }

  /** Put a dealer behind the table at (x, z), facing +z. */
  protected addDealer(x: number, z: number, pose: Pose = 'deal'): void {
    const app = randomAppearance(this.rng, 'dealer');
    this.dealer = new Sitter(app, pose);
    this.dealer.model.root.position.set(x, 0, z);
    this.group.add(this.dealer.model.root);
    this.speech.sprite.position.set(x, 2.15, z);
    this.group.add(this.speech.sprite);
  }

  /** Seat NPC gamblers in some of the seats. */
  populate(share: number): void {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s.who) continue;
      if (this.rng() < share) this.seatNpc(i);
    }
  }

  seatNpc(i: number): Sitter {
    const s = this.seats[i];
    const app = randomAppearance(this.rng, 'gambler');
    const sitter = new Sitter(app, s.standing ? 'idle' : this.sitPose(), 400 + Math.floor(this.rng() * 4000));
    sitter.model.root.position.set(s.x, 0, s.z);
    sitter.model.root.rotation.y = s.yaw;
    sitter.anim.snap();
    this.group.add(sitter.model.root);
    s.who = 'npc';
    s.npc = sitter;
    this.sitters.push(sitter);
    return sitter;
  }

  unseatNpc(i: number): void {
    const s = this.seats[i];
    if (!s.npc) return;
    s.npc.model.root.removeFromParent();
    s.npc.model.dispose();
    this.sitters = this.sitters.filter((x) => x !== s.npc);
    s.npc = undefined;
    s.who = null;
  }

  protected sitPose(): Pose {
    return 'sitTable';
  }

  /** A free seat nearest a point (table-local), or -1. */
  freeSeatNear(x: number, z: number): number {
    let best = -1;
    let bd = Infinity;
    this.seats.forEach((s, i) => {
      if (s.who === 'player') return;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  enter(host: GameHost, seat: number): void {
    // An NPC in the seat gets up for you.
    if (this.seats[seat].who === 'npc') this.unseatNpc(seat);
    this.seats[seat].who = 'player';
    this.host = host;
    this.mySeat = seat;
    this.onEnter();
  }

  exit(): void {
    this.onExit();
    if (this.mySeat >= 0) this.seats[this.mySeat].who = null;
    this.mySeat = -1;
    this.host = null;
  }

  /** Can the player leave right now without forfeiting chips in play? */
  canLeave(): boolean {
    return true;
  }

  protected abstract onEnter(): void;
  protected abstract onExit(): void;
  /** A click on a pickable: `p` is the table-local hit point. */
  abstract click(p: THREE.Vector3, button: number, object: THREE.Object3D): void;
  /** Keyboard shortcut; return true if used. */
  abstract key(code: string): boolean;
  /** Called every frame while seated (and for ambience otherwise). */
  abstract tick(dt: number): void;
  /** What the cursor is over (for highlights); optional. */
  hover(_p: THREE.Vector3 | null, _object: THREE.Object3D | null): void {}

  private _wp = new THREE.Vector3();
  /** Detail level for everyone at the table, from the camera's distance. */
  updateLods(cam: THREE.Vector3): void {
    this.group.getWorldPosition(this._wp);
    const d = this._wp.distanceTo(cam);
    for (const s of this.sitters) s.model.updateLod(d);
    this.dealer?.model.updateLod(d);
  }

  update(dt: number, seen: boolean): void {
    if (seen) {
      for (const s of this.sitters) s.update(dt);
      this.dealer?.update(dt, this.host && this.mySeat >= 0 ? Math.atan2(this.seats[this.mySeat].x, this.seats[this.mySeat].z) * 0.5 : 0);
    }
    this.speech.update(dt);
    this.chips.rebuild();
    this.tick(dt);
  }

  /** Seat world transform for the session (eye position and facing). */
  seatEye(i: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.seats[i];
    // Sit a little back from the seat, eyes over the edge of the table.
    const back = 0.08;
    out.set(s.x - Math.sin(s.yaw) * back, s.eye, s.z - Math.cos(s.yaw) * back);
    return this.group.localToWorld(out);
  }
}

/** Stool: a chrome post, a padded seat and a backrest (merged by the table into its kit). */
export function stoolParts(k: import('../render/kit').Kit, x: number, z: number, yaw: number, color = 0x7a1020): void {
  k.push({ x, z, ry: yaw });
  k.cyl(0.22, 0.25, 0.04, 0x222226, { y: 0.02 }, 'shiny', 16);
  k.cyl(0.035, 0.035, 0.42, 0xc8ccd2, { y: 0.24 }, 'shiny', 8);
  k.cyl(0.21, 0.2, 0.09, color, { y: 0.47 }, 'matte', 18);
  k.torus(0.2, 0.025, 0xd8b04a, { y: 0.47, rx: Math.PI / 2 }, 'shiny', Math.PI * 2, 6, 20);
  k.rbox(0.36, 0.3, 0.06, 0.03, color, { y: 0.72, z: -0.2, rx: -0.12 });
  k.cyl(0.015, 0.015, 0.3, 0xc8ccd2, { x: 0.12, y: 0.56, z: -0.19 }, 'shiny', 6);
  k.cyl(0.015, 0.015, 0.3, 0xc8ccd2, { x: -0.12, y: 0.56, z: -0.19 }, 'shiny', 6);
  k.pop();
}
