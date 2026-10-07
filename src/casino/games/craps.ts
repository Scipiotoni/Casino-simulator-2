import * as THREE from 'three';
import { TableBase } from '../table';
import { Kit } from '../../render/kit';
import { markStatic } from '../../render/mergeStatic';
import { canPlace, crapsRoll, betName, isContract, POINTS, placePays, oddsMultiple } from '../craps';
import { feltCanvas, feltBox } from '../felt';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';
import { roundRect } from '../../render/signs';

/**
 * Craps on a real Las Vegas layout (one side of the table): Pass and Don't Pass with
 * 3-4-5x odds, Come and Don't Come bets that travel to their numbers, place bets (9:5,
 * 7:5, 7:6), Big 6/8, the Field (2 pays double, 12 triple), the hardways and the centre
 * props (Any 7, Any Craps, Aces, Ace-Deuce, Yo, Twelve, C&E, Horn). You're the shooter:
 * the dice fly down the table, bounce off the back wall and settle. The puck marks the point.
 */

interface Region {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  label: string;
  /** Where chips for this bet sit. */
  cx: number;
  cz: number;
}

const FELT = { x0: -1.15, x1: 1.15, z0: -0.62, z1: 0.6 };
const regions: Region[] = [];
function R(id: string, x0: number, x1: number, z0: number, z1: number, label: string, cx?: number, cz?: number): void {
  regions.push({ id, x0, x1, z0, z1, label, cx: cx ?? (x0 + x1) / 2, cz: cz ?? (z0 + z1) / 2 });
}
// Place-number boxes along the far side.
POINTS.forEach((n, i) => R(`place:${n}`, -0.8 + i * 0.2, -0.6 + i * 0.2, -0.62, -0.36, n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n)));
R('dontCome', -1.12, -0.8, -0.62, -0.36, "DON'T\nCOME\nBAR 12");
R('come', -0.8, 0.42, -0.36, -0.12, 'COME');
R('field', -0.8, 0.42, -0.12, 0.12, 'FIELD');
R('big6', -1.12, -0.8, -0.36, -0.12, 'BIG 6');
R('big8', -1.12, -0.8, -0.12, 0.12, 'BIG 8');
R('dontPass', -1.12, 0.42, 0.12, 0.26, "DON'T PASS BAR 12");
R('pass', -1.12, 0.42, 0.26, 0.44, 'PASS LINE');
R('any7', 0.46, 1.12, -0.62, -0.5, 'SEVEN · 4 TO 1');
R('hard:6', 0.46, 0.79, -0.5, -0.35, 'HARD 6\n9 to 1');
R('hard:10', 0.79, 1.12, -0.5, -0.35, 'HARD 10\n7 to 1');
R('hard:8', 0.46, 0.79, -0.35, -0.2, 'HARD 8\n9 to 1');
R('hard:4', 0.79, 1.12, -0.35, -0.2, 'HARD 4\n7 to 1');
R('aceDeuce', 0.46, 0.625, -0.2, -0.06, '3\n15:1');
R('aces', 0.625, 0.79, -0.2, -0.06, '2\n30:1');
R('twelve', 0.79, 0.955, -0.2, -0.06, '12\n30:1');
R('yo', 0.955, 1.12, -0.2, -0.06, '11\n15:1');
R('anyCraps', 0.46, 1.12, -0.06, 0.06, 'ANY CRAPS · 7 TO 1');
R('ce', 0.46, 0.79, 0.06, 0.2, 'C & E');
R('horn', 0.79, 1.12, 0.06, 0.2, 'HORN');

const PICK_FELT = new Map<string, THREE.MeshLambertMaterial>();

function feltMaterial(color: string): THREE.MeshLambertMaterial {
  let m = PICK_FELT.get(color);
  if (m) return m;
  const W = 1400;
  const H = Math.round((W * (FELT.z1 - FELT.z0)) / (FELT.x1 - FELT.x0));
  const { canvas, g } = feltCanvas(W, H, color);
  const sx = (x: number) => ((x - FELT.x0) / (FELT.x1 - FELT.x0)) * W;
  const sz = (z: number) => ((z - FELT.z0) / (FELT.z1 - FELT.z0)) * H;
  for (const r of regions) {
    const red = r.id === 'any7' || r.id.startsWith('hard') || ['aces', 'aceDeuce', 'yo', 'twelve', 'anyCraps', 'ce', 'horn'].includes(r.id);
    const fill = r.id === 'field' ? 'rgba(255,255,255,0.06)' : r.id === 'any7' ? 'rgba(200,16,46,0.5)' : undefined;
    feltBox(g, sx(r.x0), sz(r.z0), sx(r.x1) - sx(r.x0), sz(r.z1) - sz(r.z0), r.id === 'field' ? '' : r.label, { fill, text: red ? '#ffe0a0' : '#ffffff', size: r.id === 'pass' || r.id === 'come' ? 46 : r.id.startsWith('place') ? 40 : 22, line: red ? '#f2d27a' : '#ffffff' });
  }
  // Field numbers, with 2 and 12 circled (they pay double and triple).
  const f = regions.find((r) => r.id === 'field')!;
  const nums = ['2', '3', '4', '9', '10', '11', '12'];
  nums.forEach((n, i) => {
    const x = sx(f.x0) + ((i + 0.5) / nums.length) * (sx(f.x1) - sx(f.x0));
    const y = sz((f.z0 + f.z1) / 2);
    g.fillStyle = n === '2' || n === '12' ? '#ffd23d' : '#ffffff';
    g.font = '40px "Lilita One", Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(n, x, y);
    if (n === '2' || n === '12') {
      g.strokeStyle = '#ffd23d';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 30, 0, Math.PI * 2);
      g.stroke();
      g.font = '14px Nunito, Arial';
      g.fillText(n === '2' ? 'DOUBLE' : 'TRIPLE', x, y + 42);
    }
  });
  g.fillStyle = '#f2d27a';
  g.font = '30px "Lilita One", Arial';
  g.textAlign = 'center';
  g.fillText('FIELD', sx(f.x0) + 60, sz(f.z0) + 22);
  g.font = '18px Nunito, Arial';
  g.fillText('Odds behind the line: 3-4-5x · Place 4/10 pay 9:5, 5/9 7:5, 6/8 7:6', sx(0.79), sz(0.4));
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  m = new THREE.MeshLambertMaterial({ map: t });
  PICK_FELT.set(color, m);
  return m;
}

let dieMats: THREE.MeshLambertMaterial[] | null = null;
/** Six faces of a red casino die (order: +x, -x, +y, -y, +z, -z → 3, 4, 1, 6, 2, 5). */
function dieMaterials(): THREE.MeshLambertMaterial[] {
  if (dieMats) return dieMats;
  const face = (n: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d8102a';
    roundRect(g, 0, 0, 64, 64, 8);
    g.fill();
    g.fillStyle = '#ffffff';
    const p: Record<number, [number, number][]> = {
      1: [[32, 32]], 2: [[18, 18], [46, 46]], 3: [[16, 16], [32, 32], [48, 48]], 4: [[18, 18], [46, 18], [18, 46], [46, 46]],
      5: [[16, 16], [48, 16], [32, 32], [16, 48], [48, 48]], 6: [[18, 14], [46, 14], [18, 32], [46, 32], [18, 50], [46, 50]],
    };
    for (const [x, y] of p[n]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: t });
  };
  dieMats = [3, 4, 1, 6, 2, 5].map(face);
  return dieMats;
}

/** Rotation that puts face n on top. */
function upRotation(n: number, spin: number): THREE.Euler {
  // Faces: +y=1, -y=6, +x=3, -x=4, +z=2, -z=5.
  switch (n) {
    case 1: return new THREE.Euler(0, spin, 0);
    case 6: return new THREE.Euler(Math.PI, spin, 0);
    case 3: return new THREE.Euler(0, spin, Math.PI / 2);
    case 4: return new THREE.Euler(0, spin, -Math.PI / 2);
    case 2: return new THREE.Euler(-Math.PI / 2, spin, 0, 'YXZ');
    default: return new THREE.Euler(Math.PI / 2, spin, 0, 'YXZ');
  }
}

type Phase = 'betting' | 'rolling';

export class CrapsTable extends TableBase {
  readonly kind = 'craps' as const;
  readonly name = 'Craps';
  private felt!: THREE.Mesh;
  private point = 0;
  private bets = new Map<string, number>();
  private phase: Phase = 'betting';
  private dice: THREE.Mesh[] = [];
  private puck!: THREE.Mesh;
  private puckMat!: THREE.MeshBasicMaterial[];
  private hoverMesh!: THREE.Mesh;
  lastRoll: [number, number] = [3, 4];
  private hoverId = '';

  constructor(seed: number, opts: { felt?: string; min?: number; max?: number } = {}) {
    super(seed);
    this.minBet = opts.min ?? 5;
    this.maxBet = opts.max ?? 5000;
    this.surfaceY = 0.82;
    this.build(opts.felt ?? '#0f6b3a');
    this.focus.set(0, 0.85, -0.15);
  }

  private build(color: string): void {
    const y = this.surfaceY;
    const fw = FELT.x1 - FELT.x0;
    const fd = FELT.z1 - FELT.z0;
    this.felt = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), feltMaterial(color));
    this.felt.rotation.x = -Math.PI / 2;
    this.felt.position.set((FELT.x0 + FELT.x1) / 2, y + 0.001, (FELT.z0 + FELT.z1) / 2);
    markStatic(this.felt);
    this.group.add(this.felt);
    this.pickables.push(this.felt);
    const k = new Kit();
    // The tub: high padded walls round the felt, the back wall lined with rubber pyramids.
    const W = fw + 0.24;
    const D = fd + 0.24;
    k.box(W, 0.06, D, 0x6b3a1e, { y: y - 0.03 }, 'shiny');
    k.box(W - 0.1, 0.7, D - 0.1, 0x2a1a12, { y: y - 0.4 });
    k.box(W, 0.28, 0.12, 0x6b3a1e, { y: y + 0.08, z: -D / 2 + 0.06 }, 'shiny');
    k.box(0.12, 0.28, D, 0x6b3a1e, { x: -W / 2 + 0.06, y: y + 0.08 }, 'shiny');
    k.box(0.12, 0.28, D, 0x6b3a1e, { x: W / 2 - 0.06, y: y + 0.08 }, 'shiny');
    k.box(W, 0.2, 0.12, 0x6b3a1e, { y: y + 0.05, z: D / 2 - 0.06 }, 'shiny');
    k.rbox(W + 0.06, 0.08, 0.18, 0.04, 0x1a1214, { y: y + 0.2, z: D / 2 - 0.06 }, 'shiny');
    k.box(W - 0.3, 0.16, 0.02, 0x15151a, { y: y + 0.09, z: -D / 2 + 0.125 });
    for (let i = 0; i < 28; i++) k.cone(0.02, 0.025, 0x0f0f12, { x: -W / 2 + 0.2 + i * ((W - 0.4) / 27), y: y + 0.09, z: -D / 2 + 0.14, rx: Math.PI / 2 }, 'matte', 4);
    // Chip rail along the player side.
    k.box(W - 0.2, 0.03, 0.08, 0x15151a, { y: y + 0.17, z: D / 2 + 0.02 });
    const body = k.bake({ shadows: true });
    markStatic(body);
    this.group.add(body);
    // Dice.
    const geo = new THREE.BoxGeometry(0.019, 0.019, 0.019);
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(geo, dieMaterials());
      d.position.set(-0.2 + i * 0.03, y + 0.0095, 0.5);
      this.dice.push(d);
      this.group.add(d);
    }
    // The puck (OFF black side up / ON white side up).
    this.puckMat = [new THREE.MeshBasicMaterial({ map: this.puckTex('OFF', '#111', '#fff') }), new THREE.MeshBasicMaterial({ map: this.puckTex('ON', '#fff', '#111') })];
    this.puck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 20), [new THREE.MeshBasicMaterial({ color: 0x444444 }), this.puckMat[0], this.puckMat[0]]);
    this.placePuck();
    this.group.add(this.puck);
    this.hoverMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.22, depthWrite: false }));
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 5;
    this.group.add(this.hoverMesh);
    // Players stand along the near rail.
    for (let i = 0; i < 4; i++) this.seats.push({ x: -0.75 + i * 0.5, z: 0.98, yaw: Math.PI, who: null, eye: 1.62, standing: true });
    this.display.mesh.position.set(0.8, y + 0.42, -D / 2 + 0.05);
    this.display.mesh.rotation.set(-0.15, 0, 0);
    this.group.add(this.display.mesh);
    this.addDealer(0.1, -D / 2 - 0.35, 'idle');
  }

  private puckTex(t: string, bg: string, fg: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.beginPath();
    g.arc(32, 32, 32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = fg;
    g.font = '26px "Lilita One", Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private placePuck(): void {
    const mats = this.puck.material as THREE.Material[];
    if (this.point) {
      const r = regions.find((x) => x.id === `place:${this.point}`)!;
      this.puck.position.set(r.cx, this.surfaceY + 0.006, r.z0 + 0.05);
      mats[1] = mats[2] = this.puckMat[1];
    } else {
      const r = regions.find((x) => x.id === 'dontCome')!;
      this.puck.position.set(r.cx, this.surfaceY + 0.006, r.cz);
      mats[1] = mats[2] = this.puckMat[0];
    }
  }

  private regionAt(x: number, z: number): Region | null {
    for (const r of regions) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
    // Behind the pass line: odds.
    if (x >= -1.12 && x <= 0.42 && z > 0.44 && z < 0.58) return { id: 'odds', x0: -1.12, x1: 0.42, z0: 0.44, z1: 0.58, label: 'ODDS', cx: -0.2, cz: 0.51 };
    return null;
  }

  /** Where a bet's chips sit (travelled come bets sit in their number box). */
  private pilePos(id: string): [number, number] {
    const [kind, n] = id.split(':');
    if (kind === 'come' && n) {
      const r = regions.find((x) => x.id === `place:${n}`)!;
      return [r.cx - 0.04, r.z1 - 0.06];
    }
    if (kind === 'comeOdds') {
      const r = regions.find((x) => x.id === `place:${n}`)!;
      return [r.cx + 0.03, r.z1 - 0.06];
    }
    if (kind === 'dontCome' && n) {
      const r = regions.find((x) => x.id === `place:${n}`)!;
      return [r.cx - 0.04, r.z0 + 0.12];
    }
    if (kind === 'dontComeOdds') {
      const r = regions.find((x) => x.id === `place:${n}`)!;
      return [r.cx + 0.03, r.z0 + 0.12];
    }
    if (id === 'passOdds') return [-0.3, 0.51];
    if (id === 'dontOdds') return [-0.6, 0.2];
    const r = regions.find((x) => x.id === id);
    if (!r) return [0, 0];
    if (kind === 'place') return [r.cx, r.z0 + 0.07];
    if (id === 'pass') return [-0.3, 0.35];
    if (id === 'dontPass') return [-0.6, 0.19];
    return [r.cx, r.cz];
  }

  private refreshPiles(): void {
    this.chips.clear();
    for (const [id, amt] of this.bets) {
      const [x, z] = this.pilePos(id);
      this.chips.set(id, x, this.surfaceY + 0.001, z, amt);
    }
  }

  protected onEnter(): void {
    this.phase = 'betting';
    this.display.show(this.point ? `POINT IS ${this.point}` : 'COMING OUT', `$${this.minBet} - ${money(this.maxBet)}`);
    this.speech.say(this.point ? `The point is ${this.point}.` : 'New shooter coming out!');
    this.refreshOptions();
  }

  protected onExit(): void {
    // Bets that can be taken down come back; contract bets are lost if you walk away.
    let back = 0;
    for (const [id, amt] of [...this.bets]) {
      if (!isContract(this.point, id)) {
        back += amt;
        this.bets.delete(id);
      }
    }
    if (back) this.host?.give(back);
    this.bets.clear();
    this.refreshPiles();
    this.hoverMesh.visible = false;
  }

  canLeave(): boolean {
    return this.phase === 'betting';
  }

  private total(): number {
    let t = 0;
    for (const v of this.bets.values()) t += v;
    return t;
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const total = this.total();
    if (this.phase === 'betting') {
      h.options.show({
        title: this.point ? `CRAPS · POINT ${this.point}` : 'CRAPS · COME-OUT ROLL',
        chips: true,
        bet: total,
        balance: h.balance(),
        hint: this.point ? 'Click behind the Pass Line for odds, Come, the numbers, Field or the props · right-click to take a bet down' : 'Bet the Pass Line (or Don\'t Pass), then roll',
        buttons: [
          { id: 'odds', label: 'Max odds', key: 'O', enabled: !!this.point && !!this.bets.get('pass') },
          { id: 'roll', label: 'Roll the dice', key: 'Space', primary: true, enabled: total > 0 },
          { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
        ],
      });
    } else h.options.show({ title: 'CRAPS', bet: total, balance: h.balance(), buttons: [{ id: 'wait', label: 'Dice are out…', enabled: false }] });
  }

  hover(p: THREE.Vector3 | null): void {
    if (!p || this.phase !== 'betting') {
      this.hoverMesh.visible = false;
      return;
    }
    const r = this.regionAt(p.x, p.z);
    if (!r) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.set((r.x0 + r.x1) / 2, this.surfaceY + 0.003, (r.z0 + r.z1) / 2);
    this.hoverMesh.scale.set(r.x1 - r.x0, r.z1 - r.z0, 1);
    if (r.id !== this.hoverId) {
      this.hoverId = r.id;
      const id = this.resolveId(r.id);
      this.display.show(betName(id).toUpperCase(), this.payText(id));
    }
  }

  private payText(id: string): string {
    const [kind, n] = id.split(':');
    switch (kind) {
      case 'pass': case 'dontPass': case 'come': case 'dontCome': return 'Pays 1 to 1';
      case 'place': return `Pays ${placePays(Number(n)) === 7 / 6 ? '7 to 6' : placePays(Number(n)) === 7 / 5 ? '7 to 5' : '9 to 5'}`;
      case 'passOdds': return `True odds · up to ${oddsMultiple(this.point)}x`;
      case 'hard': return Number(n) === 6 || Number(n) === 8 ? 'Pays 9 to 1' : 'Pays 7 to 1';
      case 'field': return '2 pays double, 12 triple';
      case 'big6': case 'big8': return 'Pays 1 to 1';
      default: return 'One roll';
    }
  }

  /** The bet a region means right now (e.g. the pass line area becomes odds once there's a point). */
  private resolveId(region: string): string {
    if (region === 'odds') return this.bets.get('dontPass') && !this.bets.get('pass') ? 'dontOdds' : 'passOdds';
    if (region.startsWith('place:')) {
      const n = region.split(':')[1];
      if (this.bets.get(`come:${n}`)) return `comeOdds:${n}`;
    }
    return region;
  }

  click(p: THREE.Vector3, button: number): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    const r = this.regionAt(p.x, p.z);
    if (!r) return;
    const id = this.resolveId(r.id);
    const cur = this.bets.get(id) ?? 0;
    if (button === 2) {
      if (!cur) return;
      if (isContract(this.point, id)) {
        this.speech.say("That's a contract bet, it stays up.");
        return;
      }
      this.bets.delete(id);
      h.give(cur);
      h.sound('chips', 0.5);
      this.refreshPiles();
      this.refreshOptions();
      return;
    }
    const ok = canPlace(this.point, this.bets, id);
    if (!ok.ok) {
      this.speech.say(ok.reason ?? "Can't bet that now.");
      return;
    }
    const cap = Math.min(this.maxBet, ok.max ?? this.maxBet);
    const add = Math.min(h.options.selectedChip, cap - cur);
    if (add <= 0) {
      this.speech.say(`That's the max there (${money(cap)}).`);
      return;
    }
    if (!h.take(add)) {
      this.speech.say("You're short for that chip.");
      return;
    }
    this.bets.set(id, cur + add);
    h.sound('chips', 0.6);
    this.display.show(betName(id).toUpperCase(), `on it: ${money(cur + add)}`);
    this.refreshPiles();
    this.refreshOptions();
  }

  key(code: string): boolean {
    if (code === 'Space') {
      this.button('roll');
      return true;
    }
    if (code === 'KeyO') {
      this.button('odds');
      return true;
    }
    return false;
  }

  button(id: string): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    if (id === 'odds' && this.point && this.bets.get('pass')) {
      const ok = canPlace(this.point, this.bets, 'passOdds');
      const max = (ok.max ?? 0) - (this.bets.get('passOdds') ?? 0);
      if (max > 0 && h.take(max)) {
        this.bets.set('passOdds', (this.bets.get('passOdds') ?? 0) + max);
        this.refreshPiles();
        h.sound('chips', 0.6);
      } else if (max > 0) this.speech.say("You're short for full odds.");
    } else if (id === 'roll' && this.total() > 0) void this.roll();
    this.refreshOptions();
  }

  private async roll(): Promise<void> {
    const h = this.host;
    if (!h) return;
    this.phase = 'rolling';
    this.hoverMesh.visible = false;
    this.refreshOptions();
    this.speech.say('Dice are out!');
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    this.lastRoll = [d1, d2];
    // Throw: from your hand, down the table, off the back wall, tumbling to rest.
    const y = this.surfaceY + 0.0095;
    const starts = this.dice.map((_, i) => new THREE.Vector3(-0.1 + i * 0.03, y + 0.25, 0.75));
    const ends = this.dice.map((_, i) => new THREE.Vector3(-0.35 + this.rng() * 0.5 + i * 0.04, y, -0.25 - this.rng() * 0.2));
    const wallZ = -0.6;
    const finals = [upRotation(d1, this.rng() * 6), upRotation(d2, this.rng() * 6)];
    const spins = this.dice.map(() => new THREE.Vector3(8 + this.rng() * 6, 5 + this.rng() * 5, 7 + this.rng() * 6));
    h.sound('dice', 0.8);
    await tweens.run(1.6, (k) => {
      this.dice.forEach((d, i) => {
        const s = starts[i];
        const e = ends[i];
        let px: number;
        let pz: number;
        let py: number;
        if (k < 0.55) {
          // Out to the back wall.
          const t = k / 0.55;
          px = s.x + (e.x - s.x) * t * 0.7;
          pz = s.z + (wallZ - s.z) * t;
          py = y + (s.y - y) * (1 - t) + Math.sin(t * Math.PI) * 0.15;
        } else {
          // Bounce back and settle.
          const t = (k - 0.55) / 0.45;
          const decay = 1 - t;
          px = s.x + (e.x - s.x) * (0.7 + 0.3 * t);
          pz = wallZ + (e.z - wallZ) * (1 - Math.pow(1 - t, 2));
          py = y + Math.abs(Math.sin(t * Math.PI * 3)) * 0.05 * decay * decay;
        }
        d.position.set(px, py, pz);
        const w = 1 - Math.min(1, k * 1.15);
        const f = finals[i];
        d.rotation.set(f.x + spins[i].x * w, f.y + spins[i].y * w, f.z + spins[i].z * w, f.order);
      });
    }, (t) => t);
    h.sound('clack', 0.6);
    const sum = d1 + d2;
    const res = crapsRoll(this.point, this.bets, [d1, d2]);
    const call = sum === 7 ? (this.point ? 'Seven out!' : 'Seven, front line winner!') : sum === 11 ? 'Yo-leven!' : sum === 2 ? 'Aces, craps!' : sum === 3 ? 'Ace-deuce, craps!' : sum === 12 ? 'Twelve, craps!' : d1 === d2 ? `${sum} the hard way!` : `${sum}${res.point && res.point !== this.point ? ', mark it!' : '.'}`;
    this.speech.say(call);
    const stake = res.decisions.reduce((a, d) => a + d.stake, 0);
    const back = res.decisions.reduce((a, d) => a + d.back, 0);
    if (back > 0) h.give(back);
    h.record('craps', stake, back);
    this.bets = res.bets;
    this.point = res.point;
    this.placePuck();
    this.refreshPiles();
    // Winning payouts appear by their bets for a moment.
    for (const d of res.decisions) {
      if (d.back > d.stake) {
        const [x, z] = this.pilePos(d.id);
        this.chips.set(`win:${d.id}`, x + 0.035, this.surfaceY + 0.001, z + 0.02, Math.round(d.back - d.stake));
      }
    }
    const net = back - stake;
    this.display.show(`${sum} · ${this.point ? `POINT ${this.point}` : 'COMING OUT'}`, net > 0 ? `+${money(net)}` : net < 0 ? money(net) : '', net > 0 ? '#7dff9a' : net < 0 ? '#ff8a8a' : '#ffd23d');
    if (net > 0) h.sound(net > 2000 ? 'bigwin' : 'win', 0.8);
    if (net >= 10000) h.celebrate('big', net);
    await tweens.wait(1.6);
    this.refreshPiles();
    this.phase = 'betting';
    this.refreshOptions();
  }

  tick(): void {
    if (this.host && this.phase === 'betting') this.refreshOptions();
  }
}
