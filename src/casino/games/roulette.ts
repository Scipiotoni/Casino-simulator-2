import * as THREE from 'three';
import { TableBase, stoolParts } from '../table';
import { Kit } from '../../render/kit';
import { markStatic } from '../../render/mergeStatic';
import { CanvasScreen } from '../../render/signs';
import { RED_NUMBERS, WHEEL_ORDER, numberAt, rouletteReturn, spotById, spotFor, spotPays, type RouletteSpot } from '../roulette';
import { feltCanvas, feltBox } from '../felt';
import { tweens } from '../../core/tween';
import { money } from '../../ui/dom';

/**
 * European roulette: single zero, la partage (even-money bets lose only half on zero).
 * The whole layout is live: click a number for a straight up, the line between two numbers
 * for a split, a corner for four, the edge of a row for a street or six line, the zero's
 * edges for the trios and first four, plus columns, dozens and the even-money boxes. The
 * croupier spins a real wheel: the ball runs round the track the other way, slows, drops
 * through the diamonds and rattles into the pocket that decides it.
 */

// Layout geometry (table-local metres). Players sit on the +z side.
const CELL_W = 0.105;
const CELL_D = 0.13;
const GX0 = -0.28; // left edge of column 1 (zero box sits to its left)
const GZ0 = -0.3; // top edge of the number grid (row 0: 3, 6, 9 …)
const ZERO_W = 0.11;
const COL_W = 0.11;
const OUT_D = 0.11;
const FELT = { x0: -0.42, x1: 1.12, z0: -0.38, z1: 0.38 };
const WHEEL = { x: -0.86, z: 0, r: 0.42 };
const POCKET_R = 0.215;
const TRACK_R = 0.335;

const FELT_TEX = new Map<string, THREE.CanvasTexture>();
const FELT_MAT = new Map<string, THREE.MeshLambertMaterial>();

function fx(x: number, W: number): number {
  return ((x - FELT.x0) / (FELT.x1 - FELT.x0)) * W;
}
function fz(z: number, H: number): number {
  return ((z - FELT.z0) / (FELT.z1 - FELT.z0)) * H;
}

function feltTexture(color: string): THREE.CanvasTexture {
  const hit = FELT_TEX.get(color);
  if (hit) return hit;
  const W = 1280;
  const H = Math.round((W * (FELT.z1 - FELT.z0)) / (FELT.x1 - FELT.x0));
  const { canvas, g } = feltCanvas(W, H, color);
  const sx = (x: number) => fx(x, W);
  const sz = (z: number) => fz(z, H);
  const cw = sx(GX0 + CELL_W) - sx(GX0);
  const cd = sz(GZ0 + CELL_D) - sz(GZ0);
  // Zero.
  g.fillStyle = '#1f9a4c';
  g.beginPath();
  g.moveTo(sx(GX0), sz(GZ0));
  g.lineTo(sx(GX0 - ZERO_W * 0.55), sz(GZ0));
  g.lineTo(sx(GX0 - ZERO_W), sz(GZ0 + CELL_D * 1.5));
  g.lineTo(sx(GX0 - ZERO_W * 0.55), sz(GZ0 + CELL_D * 3));
  g.lineTo(sx(GX0), sz(GZ0 + CELL_D * 3));
  g.closePath();
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `${cd * 0.55}px "Lilita One", Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(sx(GX0 - ZERO_W * 0.5), sz(GZ0 + CELL_D * 1.5));
  g.rotate(-Math.PI / 2);
  g.fillText('0', 0, 0);
  g.restore();
  // Numbers.
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = numberAt(c, r);
      const x = sx(GX0 + c * CELL_W);
      const z = sz(GZ0 + r * CELL_D);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.strokeRect(x, z, cw, cd);
      g.fillStyle = RED_NUMBERS.has(n) ? '#d8202f' : '#15151a';
      g.beginPath();
      g.ellipse(x + cw / 2, z + cd / 2, cw * 0.36, cd * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `${cd * 0.42}px "Lilita One", Arial`;
      g.save();
      g.translate(x + cw / 2, z + cd / 2);
      g.rotate(-Math.PI / 2);
      g.fillText(String(n), 0, 2);
      g.restore();
    }
  }
  // Columns (2 to 1).
  for (let r = 0; r < 3; r++) feltBox(g, sx(GX0 + 12 * CELL_W), sz(GZ0 + r * CELL_D), sx(GX0 + 12 * CELL_W + COL_W) - sx(GX0 + 12 * CELL_W), cd, '2 to 1', { size: cd * 0.3 });
  // Dozens.
  for (let d = 0; d < 3; d++) feltBox(g, sx(GX0 + d * 4 * CELL_W), sz(GZ0 + 3 * CELL_D), cw * 4, sz(GZ0 + 3 * CELL_D + OUT_D) - sz(GZ0 + 3 * CELL_D), ['1st 12', '2nd 12', '3rd 12'][d], { size: cd * 0.38 });
  // Even money.
  const evens = ['1-18', 'EVEN', 'RED', 'BLACK', 'ODD', '19-36'];
  const ez = sz(GZ0 + 3 * CELL_D + OUT_D);
  const ed = sz(GZ0 + 3 * CELL_D + OUT_D * 2) - ez;
  evens.forEach((lbl, i) => {
    const x = sx(GX0 + i * 2 * CELL_W);
    feltBox(g, x, ez, cw * 2, ed, lbl === 'RED' || lbl === 'BLACK' ? '' : lbl, { size: cd * 0.36 });
    if (lbl === 'RED' || lbl === 'BLACK') {
      g.fillStyle = lbl === 'RED' ? '#d8202f' : '#15151a';
      g.beginPath();
      g.moveTo(x + cw, ez + ed * 0.15);
      g.lineTo(x + cw * 1.6, ez + ed / 2);
      g.lineTo(x + cw, ez + ed * 0.85);
      g.lineTo(x + cw * 0.4, ez + ed / 2);
      g.closePath();
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.stroke();
    }
  });
  g.fillStyle = '#f2d27a';
  g.font = `${cd * 0.28}px "Lilita One", Arial`;
  g.textAlign = 'left';
  g.fillText('SINGLE ZERO · LA PARTAGE: EVEN-MONEY BETS LOSE HALF ON 0', sx(GX0), sz(GZ0) - cd * 0.35);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  FELT_TEX.set(color, t);
  return t;
}

let wheelTex: THREE.CanvasTexture | null = null;
/** The rotor: 37 pockets in wheel order with their numbers, seen from above. */
function rotorTexture(): THREE.CanvasTexture {
  if (wheelTex) return wheelTex;
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const cx = S / 2;
  const R = S / 2;
  g.fillStyle = '#5a2e14';
  g.fillRect(0, 0, S, S);
  const n = WHEEL_ORDER.length;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    const num = WHEEL_ORDER[i];
    g.fillStyle = num === 0 ? '#1f9a4c' : RED_NUMBERS.has(num) ? '#c8102e' : '#15151a';
    g.beginPath();
    g.arc(cx, cx, R * 0.98, a0, a1);
    g.arc(cx, cx, R * 0.62, a1, a0, true);
    g.closePath();
    g.fill();
    // Number ring.
    g.save();
    g.translate(cx, cx);
    g.rotate((a0 + a1) / 2 + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.font = `${R * 0.085}px "Lilita One", Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), 0, -R * 0.89);
    g.restore();
    // Frets.
    g.strokeStyle = '#d8b04a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + Math.cos(a0) * R * 0.62, cx + Math.sin(a0) * R * 0.62);
    g.lineTo(cx + Math.cos(a0) * R * 0.98, cx + Math.sin(a0) * R * 0.98);
    g.stroke();
  }
  g.strokeStyle = '#d8b04a';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, cx, R * 0.8, 0, Math.PI * 2);
  g.stroke();
  // Inner cone.
  const gr = g.createRadialGradient(cx, cx, 10, cx, cx, R * 0.62);
  gr.addColorStop(0, '#d8b04a');
  gr.addColorStop(0.3, '#7a4a20');
  gr.addColorStop(1, '#5a2e14');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cx, R * 0.62, 0, Math.PI * 2);
  g.fill();
  wheelTex = new THREE.CanvasTexture(c);
  wheelTex.colorSpace = THREE.SRGBColorSpace;
  wheelTex.anisotropy = 8;
  return wheelTex;
}

/** Rotor angle (about +y) of a pocket's centre, measured like the texture. */
function pocketAngle(num: number): number {
  const i = WHEEL_ORDER.indexOf(num);
  // Texture angle a (canvas, clockwise from +x) maps to local direction (cos a, -sin a)... in
  // the xz plane the canvas y axis is +z, so a canvas angle a points at (cos a, sin a) in xz.
  return (i / WHEEL_ORDER.length) * Math.PI * 2 - Math.PI / 2;
}

interface Bet {
  spot: RouletteSpot;
  amount: number;
}

type Phase = 'betting' | 'spinning' | 'settle';

export class RouletteTable extends TableBase {
  readonly kind = 'roulette' as const;
  readonly name = 'Roulette';
  private felt!: THREE.Mesh;
  private rotor!: THREE.Group;
  private ball!: THREE.Mesh;
  private dolly!: THREE.Mesh;
  private phase: Phase = 'betting';
  private bets = new Map<number, Map<string, Bet>>();
  private lastBets: Bet[] = [];
  private history: number[] = [];
  private board = new CanvasScreen(256, 512);
  private hoverMesh!: THREE.Mesh;
  private rotorAngle = Math.random() * 6;
  private rotorSpeed = 0.35;
  private ballState: { mode: 'rest' | 'run' | 'pocket'; angle: number; r: number; y: number } = { mode: 'pocket', angle: 0, r: POCKET_R, y: 0 };
  private ballPocket = 0;
  private hoverId = '';

  constructor(seed: number, opts: { felt?: string; min?: number; max?: number } = {}) {
    super(seed);
    this.minBet = opts.min ?? 5;
    this.maxBet = opts.max ?? 5000;
    this.build(opts.felt ?? '#0f6b3a');
    this.focus.set(0.25, 0.9, -0.05);
    this.history = Array.from({ length: 10 }, () => WHEEL_ORDER[Math.floor(this.rng() * 37)]);
    this.drawBoard();
  }

  private build(feltColor: string): void {
    const y = this.surfaceY;
    let mat = FELT_MAT.get(feltColor);
    if (!mat) FELT_MAT.set(feltColor, (mat = new THREE.MeshLambertMaterial({ map: feltTexture(feltColor) })));
    const fw = FELT.x1 - FELT.x0;
    const fd = FELT.z1 - FELT.z0;
    this.felt = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), mat);
    this.felt.rotation.x = -Math.PI / 2;
    this.felt.position.set((FELT.x0 + FELT.x1) / 2, y + 0.001, (FELT.z0 + FELT.z1) / 2);
    this.felt.receiveShadow = true;
    markStatic(this.felt);
    this.group.add(this.felt);
    this.pickables.push(this.felt);
    const k = new Kit();
    // Table body, padded rail, legs.
    k.rbox(2.7, 0.08, 1.0, 0.04, 0x6b3a1e, { x: -0.12, y: y - 0.05, z: 0 }, 'shiny');
    k.rbox(2.6, 0.5, 0.86, 0.05, 0x2a1a12, { x: -0.12, y: y - 0.33, z: 0 });
    k.rbox(1.62, 0.06, 0.09, 0.04, 0x1a1214, { x: 0.35, y: y + 0.03, z: 0.43 }, 'shiny');
    k.rbox(1.62, 0.06, 0.09, 0.04, 0x1a1214, { x: 0.35, y: y + 0.03, z: -0.43 }, 'shiny');
    k.rbox(0.09, 0.06, 0.95, 0.04, 0x1a1214, { x: 1.17, y: y + 0.03, z: 0 }, 'shiny');
    // Wheel bowl: a wooden ring sloping down to the rotor, with a polished ball track.
    k.lathe([[WHEEL.r + 0.06, -0.08], [WHEEL.r + 0.06, 0.1], [WHEEL.r, 0.11], [0.36, 0.1], [0.3, 0.075], [0.29, 0.06], [0.28, 0.0]], 0x6b3a1e, { x: WHEEL.x, y, z: WHEEL.z }, 'shiny', 48);
    k.torus(WHEEL.r + 0.02, 0.02, 0xd8b04a, { x: WHEEL.x, y: y + 0.105, z: WHEEL.z, rx: Math.PI / 2 }, 'shiny', Math.PI * 2, 6, 48);
    // The track the ball runs on and the diamonds (deflectors).
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.box(0.03, 0.012, 0.018, 0xe8e8ee, { x: WHEEL.x + Math.cos(a) * 0.29, y: y + 0.06, z: WHEEL.z + Math.sin(a) * 0.29, ry: -a, rz: 0.4 }, 'shiny');
    }
    // Chip float at the croupier's side.
    k.box(0.5, 0.03, 0.14, 0x111114, { x: 0.3, y: y + 0.015, z: -0.47 }, 'shiny');
    // Seats along the player side.
    for (let i = 0; i < 5; i++) {
      const sx = -0.15 + i * 0.32;
      stoolParts(k, sx, 0.98, Math.PI, 0x5a1a2a);
      this.seats.push({ x: sx, z: 0.98, yaw: Math.PI, who: null, eye: 1.32 });
    }
    const body = k.bake({ shadows: true });
    markStatic(body);
    this.group.add(body);
    // Rotor (moves): textured disc, frets ring and the turret.
    this.rotor = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(POCKET_R + 0.075, 48), new THREE.MeshLambertMaterial({ map: rotorTexture() }));
    disc.rotation.x = -Math.PI / 2;
    this.rotor.add(disc);
    const tk = new Kit();
    tk.cone(0.06, 0.07, 0xd8b04a, { y: 0.035 }, 'shiny', 16);
    tk.cyl(0.008, 0.008, 0.16, 0xd8b04a, { y: 0.075, rz: Math.PI / 2 }, 'shiny', 6);
    tk.cyl(0.008, 0.008, 0.16, 0xd8b04a, { y: 0.075, rx: Math.PI / 2 }, 'shiny', 6);
    for (const [px, pz] of [[0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08]]) tk.sphere(0.013, 0xd8b04a, { x: px, y: 0.075, z: pz }, 'shiny', 8, 6);
    this.rotor.add(tk.bake());
    this.rotor.position.set(WHEEL.x, y + 0.06, WHEEL.z);
    this.group.add(this.rotor);
    // Ball and dolly.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 12, 8), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100, specular: 0xffffff }));
    this.group.add(this.ball);
    const dk = new Kit();
    dk.cyl(0.014, 0.016, 0.05, 0xf2f2f2, { y: 0.025 }, 'shiny', 12);
    dk.sphere(0.017, 0xf2c230, { y: 0.058 }, 'shiny', 10, 8);
    this.dolly = dk.bake().children[0] as THREE.Mesh;
    this.dolly.visible = false;
    this.group.add(this.dolly);
    // Hover highlight.
    this.hoverMesh = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.55, depthWrite: false }));
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.visible = false;
    this.hoverMesh.renderOrder = 5;
    this.group.add(this.hoverMesh);
    // Marquee showing the last numbers.
    const bk = new Kit();
    bk.cyl(0.02, 0.02, 0.6, 0x111114, { x: WHEEL.x - 0.3, y: y + 0.3, z: -0.42 }, 'shiny', 8);
    const boardBase = bk.bake();
    markStatic(boardBase);
    this.group.add(boardBase);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), new THREE.MeshBasicMaterial({ map: this.board.texture, toneMapped: false }));
    board.position.set(WHEEL.x - 0.3, y + 0.78, -0.42);
    board.rotation.y = 0.5;
    this.group.add(board);
    this.display.mesh.position.set(1.0, y + 0.17, -0.5);
    this.display.mesh.rotation.set(-0.3, 0, 0);
    this.group.add(this.display.mesh);
    this.addDealer(WHEEL.x + 0.25, -0.85);
    this.placeBallAtPocket(WHEEL_ORDER[Math.floor(this.rng() * 37)]);
  }

  private drawBoard(): void {
    const g = this.board.g;
    g.fillStyle = '#05050a';
    g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#ffd23d';
    g.font = '30px "Lilita One", Arial';
    g.textAlign = 'center';
    g.fillText('LAST', 128, 38);
    this.history.slice(-10).reverse().forEach((n, i) => {
      const col = n === 0 ? '#3fdc84' : RED_NUMBERS.has(n) ? '#ff4d5e' : '#ffffff';
      g.fillStyle = col;
      g.shadowColor = col;
      g.shadowBlur = 10;
      g.font = `${i === 0 ? 60 : 40}px "Lilita One", Arial`;
      const x = n === 0 ? 128 : RED_NUMBERS.has(n) ? 80 : 176;
      g.fillText(String(n), x, 100 + i * 42 + (i === 0 ? 0 : 14));
      g.shadowBlur = 0;
    });
    this.board.update();
  }

  // ---------------------------------------------------------------- layout picking

  /** The bet spot under a table-local point, and where its chips sit. */
  spotAt(x: number, z: number): { spot: RouletteSpot; px: number; pz: number } | null {
    const c = (x - GX0) / CELL_W;
    const r = (z - GZ0) / CELL_D;
    // Zero box and its edge with the first column.
    if (x < GX0 && x > GX0 - ZERO_W && r >= 0 && r < 3) {
      if (GX0 - x < CELL_W * 0.18) {
        // On the zero's edge: split with 3/2/1, or the trios at the row lines.
        const rr = Math.round(r);
        if (Math.abs(r - rr) < 0.2 && rr >= 1 && rr <= 2) {
          const nums = rr === 1 ? [0, 3, 2] : [0, 2, 1];
          return { spot: spotFor('trio', nums)!, px: GX0, pz: GZ0 + rr * CELL_D };
        }
        const n = numberAt(0, Math.floor(r));
        return { spot: spotFor('split', [0, n])!, px: GX0, pz: GZ0 + (Math.floor(r) + 0.5) * CELL_D };
      }
      return { spot: spotFor('straight', [0])!, px: GX0 - ZERO_W * 0.5, pz: GZ0 + 1.5 * CELL_D };
    }
    // Column bets.
    if (c >= 12 && c < 12 + COL_W / CELL_W && r >= 0 && r < 3) {
      const row = Math.floor(r);
      const k = 3 - row; // top row is column 3
      return { spot: spotById(`column:${k}`)!, px: GX0 + 12 * CELL_W + COL_W / 2, pz: GZ0 + (row + 0.5) * CELL_D };
    }
    if (c < 0 || c >= 12) return null;
    // Dozens and even money below the grid.
    if (r >= 3) {
      const below = (z - (GZ0 + 3 * CELL_D)) / OUT_D;
      if (below < 1) {
        const d = Math.floor(c / 4);
        return { spot: spotById(`dozen:${d + 1}`)!, px: GX0 + (d * 4 + 2) * CELL_W, pz: GZ0 + 3 * CELL_D + OUT_D / 2 };
      }
      if (below < 2) {
        const i = Math.floor(c / 2);
        const ids = ['low', 'even', 'red', 'black', 'odd', 'high'];
        // Right on the grid's bottom edge are streets/six lines; this is the box below them.
        return { spot: spotById(ids[i])!, px: GX0 + (i * 2 + 1) * CELL_W, pz: GZ0 + 3 * CELL_D + OUT_D * 1.5 };
      }
      return null;
    }
    if (r < 0) return null;
    const ci = Math.floor(c);
    const ri = Math.floor(r);
    const fxc = c - ci;
    const frc = r - ri;
    const nearV = fxc < 0.2 ? -1 : fxc > 0.8 ? 1 : 0; // near the left/right line
    const nearH = frc < 0.2 ? -1 : frc > 0.8 ? 1 : 0; // near the top/bottom line
    // Bottom edge of the grid: streets and six lines.
    if (ri === 2 && nearH === 1) {
      if (nearV !== 0) {
        const left = nearV < 0 ? ci - 1 : ci;
        if (left >= 0 && left <= 10) {
          const nums = [1, 2, 3, 4, 5, 6].map((k) => 3 * left + k);
          return { spot: spotFor('line', nums)!, px: GX0 + (left + 1) * CELL_W, pz: GZ0 + 3 * CELL_D };
        }
      }
      const nums = [1, 2, 3].map((k) => 3 * ci + k);
      return { spot: spotFor('street', nums)!, px: GX0 + (ci + 0.5) * CELL_W, pz: GZ0 + 3 * CELL_D };
    }
    const n = numberAt(ci, ri);
    // Corners.
    if (nearV !== 0 && nearH !== 0) {
      const c2 = ci + (nearV > 0 ? 1 : -1);
      const r2 = ri + (nearH > 0 ? 1 : -1);
      if (c2 >= 0 && c2 < 12 && r2 >= 0 && r2 < 3) {
        const nums = [numberAt(ci, ri), numberAt(c2, ri), numberAt(ci, r2), numberAt(c2, r2)];
        const sp = spotFor('corner', nums);
        if (sp) return { spot: sp, px: GX0 + (Math.max(ci, c2)) * CELL_W, pz: GZ0 + Math.max(ri, r2) * CELL_D };
      }
    }
    // Splits.
    if (nearV !== 0) {
      const c2 = ci + nearV;
      if (c2 >= 0 && c2 < 12) return { spot: spotFor('split', [n, numberAt(c2, ri)])!, px: GX0 + Math.max(ci, c2) * CELL_W, pz: GZ0 + (ri + 0.5) * CELL_D };
    }
    if (nearH !== 0) {
      const r2 = ri + nearH;
      if (r2 >= 0 && r2 < 3) return { spot: spotFor('split', [n, numberAt(ci, r2)])!, px: GX0 + (ci + 0.5) * CELL_W, pz: GZ0 + Math.max(ri, r2) * CELL_D };
    }
    return { spot: spotFor('straight', [n])!, px: GX0 + (ci + 0.5) * CELL_W, pz: GZ0 + (ri + 0.5) * CELL_D };
  }

  private seatBets(seat: number): Map<string, Bet> {
    let m = this.bets.get(seat);
    if (!m) this.bets.set(seat, (m = new Map()));
    return m;
  }

  private pileFor(seat: number, spot: RouletteSpot, amount: number): void {
    // Each seat's chips sit a hair apart so stacks from different players don't merge.
    const loc = this.locate(spot);
    const off = (seat - 2) * 0.006;
    this.chips.set(`${seat}:${spot.id}`, loc.px + off, this.surfaceY + 0.002, loc.pz + off * 0.5, amount);
  }

  private locate(spot: RouletteSpot): { px: number; pz: number } {
    // Find a click point that resolves to this spot (search the grid once, cached).
    let hit = SPOT_POS.get(spot.id);
    if (!hit) {
      for (let x = FELT.x0; x < FELT.x1; x += 0.01) {
        for (let z = FELT.z0; z < FELT.z1; z += 0.01) {
          const s = this.spotAt(x, z);
          if (s && !SPOT_POS.has(s.spot.id)) SPOT_POS.set(s.spot.id, { px: s.px, pz: s.pz });
        }
      }
      hit = SPOT_POS.get(spot.id) ?? { px: 0, pz: 0 };
    }
    return hit;
  }

  // ---------------------------------------------------------------- session

  protected onEnter(): void {
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `$${this.minBet} - ${money(this.maxBet)} a spot`);
    this.speech.say('Faites vos jeux!');
    this.refreshOptions();
  }

  protected onExit(): void {
    if (this.phase === 'betting') {
      const mine = this.seatBets(this.mySeat);
      let back = 0;
      for (const b of mine.values()) {
        back += b.amount;
        this.chips.set(`${this.mySeat}:${b.spot.id}`, 0, 0, 0, 0);
      }
      mine.clear();
      if (back) this.host?.give(back);
    }
    this.hoverMesh.visible = false;
  }

  canLeave(): boolean {
    return this.phase === 'betting';
  }

  private myTotal(): number {
    let t = 0;
    for (const b of this.seatBets(this.mySeat).values()) t += b.amount;
    return t;
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    const total = this.myTotal();
    if (this.phase === 'betting') {
      h.options.show({
        title: 'ROULETTE · SINGLE ZERO',
        chips: true,
        bet: total,
        balance: h.balance(),
        hint: 'Click numbers, lines and corners on the layout · right-click a bet to take it back',
        buttons: [
          { id: 'clear', label: 'Clear', key: 'C', enabled: total > 0 },
          { id: 'rebet', label: 'Rebet', key: 'R', enabled: total === 0 && this.lastBets.length > 0 },
          { id: 'double', label: 'Double', key: 'D', enabled: total > 0 },
          { id: 'spin', label: 'Spin', key: 'Space', primary: true, enabled: total > 0 },
          { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
        ],
      });
    } else {
      h.options.show({ title: 'ROULETTE', bet: total, balance: h.balance(), buttons: [{ id: 'wait', label: this.phase === 'spinning' ? 'Rien ne va plus…' : 'Paying…', enabled: false }] });
    }
  }

  hover(p: THREE.Vector3 | null): void {
    if (!p || this.phase !== 'betting') {
      this.hoverMesh.visible = false;
      return;
    }
    const s = this.spotAt(p.x, p.z);
    if (!s) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.visible = true;
    this.hoverMesh.position.set(s.px, this.surfaceY + 0.004, s.pz);
    if (s.spot.id !== this.hoverId) {
      this.hoverId = s.spot.id;
      const on = this.seatBets(this.mySeat).get(s.spot.id)?.amount ?? 0;
      this.display.show(spotLabel(s.spot), `Pays ${spotPays(s.spot)} to 1${on ? ` · on it: ${money(on)}` : ''}`);
    }
  }

  click(p: THREE.Vector3, button: number): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    const s = this.spotAt(p.x, p.z);
    if (!s) return;
    const mine = this.seatBets(this.mySeat);
    const cur = mine.get(s.spot.id);
    if (button === 2) {
      if (cur) {
        h.give(cur.amount);
        mine.delete(s.spot.id);
        this.chips.set(`${this.mySeat}:${s.spot.id}`, 0, 0, 0, 0);
        h.sound('chips', 0.5);
      }
    } else {
      const chip = h.options.selectedChip;
      const have = cur?.amount ?? 0;
      const add = Math.min(chip, this.maxBet - have);
      if (add <= 0) {
        this.speech.say(`Limit is ${money(this.maxBet)} a spot`);
        return;
      }
      if (!h.take(add)) {
        this.speech.say("You're short for that chip.");
        return;
      }
      mine.set(s.spot.id, { spot: s.spot, amount: have + add });
      this.pileFor(this.mySeat, s.spot, have + add);
      h.sound('chips', 0.6);
      this.display.show(spotLabel(s.spot), `Pays ${spotPays(s.spot)} to 1 · on it: ${money(have + add)}`);
    }
    this.refreshOptions();
  }

  key(code: string): boolean {
    const map: Record<string, string> = { Space: 'spin', KeyC: 'clear', KeyR: 'rebet', KeyD: 'double' };
    if (!map[code]) return false;
    this.button(map[code]);
    return true;
  }

  button(id: string): void {
    const h = this.host;
    if (!h || this.phase !== 'betting') return;
    const mine = this.seatBets(this.mySeat);
    if (id === 'clear') {
      let back = 0;
      for (const b of mine.values()) {
        back += b.amount;
        this.chips.set(`${this.mySeat}:${b.spot.id}`, 0, 0, 0, 0);
      }
      mine.clear();
      if (back) h.give(back);
      h.sound('chips', 0.5);
    } else if (id === 'rebet' || id === 'double') {
      const src = id === 'rebet' ? this.lastBets : [...mine.values()];
      const need = src.reduce((a, b) => a + b.amount, 0);
      if (!h.take(need)) {
        this.speech.say("You're short for that.");
        return;
      }
      for (const b of src) {
        const cur = mine.get(b.spot.id)?.amount ?? 0;
        mine.set(b.spot.id, { spot: b.spot, amount: cur + b.amount });
        this.pileFor(this.mySeat, b.spot, cur + b.amount);
      }
      h.sound('chips', 0.6);
    } else if (id === 'spin' && mine.size) {
      this.lastBets = [...mine.values()].map((b) => ({ ...b }));
      void this.spin();
    }
    this.refreshOptions();
  }

  // ---------------------------------------------------------------- the spin

  private npcBets(): void {
    this.seats.forEach((s, i) => {
      if (s.who !== 'npc') return;
      const m = this.seatBets(i);
      const n = 1 + Math.floor(this.rng() * 3);
      for (let k = 0; k < n; k++) {
        const roll = this.rng();
        let spot: RouletteSpot;
        if (roll < 0.4) spot = spotFor('straight', [Math.floor(this.rng() * 37)])!;
        else if (roll < 0.7) spot = spotById(['red', 'black', 'odd', 'even', 'low', 'high'][Math.floor(this.rng() * 6)])!;
        else if (roll < 0.85) spot = spotById(`dozen:${1 + Math.floor(this.rng() * 3)}`)!;
        else spot = spotById(`column:${1 + Math.floor(this.rng() * 3)}`)!;
        const amt = this.minBet * (1 + Math.floor(this.rng() * 4));
        m.set(spot.id, { spot, amount: amt });
        this.pileFor(i, spot, amt);
      }
    });
  }

  private placeBallAtPocket(n: number): void {
    this.ballPocket = n;
    this.ballState = { mode: 'pocket', angle: 0, r: POCKET_R, y: 0 };
  }

  private async spin(): Promise<void> {
    const h = this.host;
    if (!h) return;
    this.phase = 'spinning';
    this.dolly.visible = false;
    this.npcBets();
    this.refreshOptions();
    this.speech.say('No more bets!');
    this.display.show('NO MORE BETS', '');
    this.dealer?.react('spinWheel', 'focused', 1.2);
    h.sound('spin', 0.6);
    // Decide the number, then fly the ball so it lands there.
    const result = WHEEL_ORDER[Math.floor(this.rng() * 37)];
    const T = 7.5;
    const landAt = 5.6;
    this.rotorSpeed = 1.6;
    const w0 = -9.5; // ball runs the other way round
    const decel = 1.15;
    // Where the rotor will be when the ball lands (it slows from 1.6 to ~0.9 rad/s).
    const rotorAt = (t: number) => this.rotorAngle + 1.6 * t - 0.06 * t * t;
    const targetWorld = rotorAt(landAt) + pocketAngle(result);
    const ballFree = (t: number) => w0 * t + 0.5 * decel * t * t;
    const offset = targetWorld - ballFree(landAt);
    const startRotor = this.rotorAngle;
    let rattled = false;
    this.ballState.mode = 'run';
    await tweens.run(T, (k) => {
      const t = k * T;
      this.rotorAngle = startRotor + 1.6 * t - 0.06 * t * t;
      if (t < landAt) {
        const a = offset + ballFree(t);
        // Spiral in during the last 1.2 s, with a couple of hops off the diamonds.
        const fall = Math.max(0, Math.min(1, (t - (landAt - 1.2)) / 1.2));
        const r = TRACK_R + (POCKET_R - TRACK_R) * fall * fall;
        const hop = fall > 0.2 ? Math.abs(Math.sin(fall * 14)) * 0.02 * (1 - fall) : 0;
        this.ballState = { mode: 'run', angle: a, r, y: 0.03 * (1 - fall) + hop };
        if (fall > 0.3 && !rattled) {
          rattled = true;
          this.host?.sound('clack', 0.4);
        }
      } else {
        this.ballState = { mode: 'pocket', angle: 0, r: POCKET_R, y: 0 };
        this.ballPocket = result;
      }
    }, (x) => x);
    this.rotorSpeed = 1.6 - 0.12 * T;
    this.history.push(result);
    this.drawBoard();
    const col = result === 0 ? 'GREEN' : RED_NUMBERS.has(result) ? 'RED' : 'BLACK';
    this.speech.say(`${result} ${col.toLowerCase()}!`);
    this.display.show(`${result} ${col}`, result === 0 ? 'Zero' : `${result % 2 ? 'Odd' : 'Even'} · ${result <= 18 ? '1-18' : '19-36'}`, result === 0 ? '#3fdc84' : RED_NUMBERS.has(result) ? '#ff4d5e' : '#ffffff');
    // The dolly marks the winning number.
    const loc = this.locate(spotFor('straight', [result])!);
    this.dolly.position.set(loc.px, this.surfaceY, loc.pz);
    this.dolly.visible = true;
    await this.settle(result);
  }

  private async settle(n: number): Promise<void> {
    const h = this.host;
    this.phase = 'settle';
    this.refreshOptions();
    await tweens.wait(1.0);
    let myStake = 0;
    let myBack = 0;
    for (const [seat, m] of this.bets) {
      let back = 0;
      for (const b of m.values()) {
        const ret = rouletteReturn(b.spot, b.amount, n, true);
        back += ret;
        if (seat === this.mySeat) myStake += b.amount;
        // Losing chips are swept; winners get their payout stacked beside the bet.
        if (ret <= 0) this.chips.set(`${seat}:${b.spot.id}`, 0, 0, 0, 0);
        else if (ret > b.amount) {
          const loc = this.locate(b.spot);
          this.chips.set(`${seat}:${b.spot.id}:win`, loc.px + 0.03, this.surfaceY + 0.002, loc.pz + 0.02, ret - b.amount);
        } else this.pileFor(seat, b.spot, ret);
      }
      if (seat === this.mySeat) {
        myBack = back;
        if (back > 0) h?.give(back);
      } else {
        const npc = this.seats[seat].npc;
        if (npc) npc.react(back > 0 ? 'cheer' : 'sad', back > 0 ? 'grin' : 'sad', 2);
      }
    }
    h?.sound('chips', 0.6);
    if (h) {
      const net = myBack - myStake;
      if (net > 0) {
        h.sound(net >= myStake * 10 ? 'bigwin' : 'win');
        this.display.show(`YOU WIN ${money(net)}`, `${n} ${n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black'}`, '#7dff9a');
        if (net >= 10000 || net >= myStake * 30) h.celebrate('big', net);
        this.dealer?.react('clap', 'happy');
      } else if (myStake > 0) this.display.show(myBack > 0 ? `BACK ${money(myBack)}` : 'NO WIN', `${n} ${n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black'}`, '#ff8a8a');
      h.record('roulette', myStake, myBack);
    }
    await tweens.wait(2.2);
    // Clear the felt.
    this.chips.clear();
    this.bets.clear();
    this.phase = 'betting';
    this.display.show('PLACE YOUR BETS', `$${this.minBet} - ${money(this.maxBet)} a spot`);
    this.speech.say('Faites vos jeux!');
    this.refreshOptions();
  }

  tick(dt: number): void {
    if (this.phase !== 'spinning') {
      // The wheel never quite stops.
      this.rotorSpeed += (0.35 - this.rotorSpeed) * Math.min(1, dt * 0.5);
      this.rotorAngle += this.rotorSpeed * dt;
    }
    this.rotor.rotation.y = -this.rotorAngle;
    // Ball position (local to the table).
    const s = this.ballState;
    let a: number;
    let r: number;
    let yy: number;
    if (s.mode === 'pocket') {
      a = this.rotorAngle + pocketAngle(this.ballPocket);
      r = POCKET_R;
      yy = 0.075;
    } else {
      a = s.angle;
      r = s.r;
      yy = 0.075 + s.y;
    }
    // Rotor rotation.y = -angle turns local (cos a, sin a) in xz by +angle.
    this.ball.position.set(WHEEL.x + Math.cos(a) * r, this.surfaceY + yy, WHEEL.z + Math.sin(a) * r);
    if (this.host && this.phase === 'betting') this.refreshOptions();
  }
}

const SPOT_POS = new Map<string, { px: number; pz: number }>();

/** How a croupier would name a bet. */
function spotLabel(s: RouletteSpot): string {
  switch (s.kind) {
    case 'straight': return `STRAIGHT UP ${s.numbers[0]}`;
    case 'split': return `SPLIT ${s.numbers.join('/')}`;
    case 'street': return `STREET ${s.numbers[0]}-${s.numbers[2]}`;
    case 'corner': return `CORNER ${s.numbers.join('/')}`;
    case 'line': return `SIX LINE ${s.numbers[0]}-${s.numbers[5]}`;
    case 'trio': return `TRIO ${s.numbers.join('/')}`;
    case 'firstFour': return 'FIRST FOUR';
    case 'column': return `COLUMN ${s.id.split(':')[1]}`;
    case 'dozen': return s.label.toUpperCase();
    default: return s.label.toUpperCase();
  }
}
