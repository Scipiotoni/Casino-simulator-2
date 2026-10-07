import * as THREE from 'three';
import { TableBase, stoolParts } from '../table';
import { Kit } from '../../render/kit';
import { CanvasScreen, roundRect } from '../../render/signs';
import { markStatic } from '../../render/mergeStatic';
import { STRIPS, LINES, SYMBOL_NAMES, evaluate, spin, THREE_PAYS, TWO_CHERRIES, ONE_CHERRY, SYM, type LineWin } from '../slotMath';
import { tweens, ease } from '../../core/tween';
import { money } from '../../ui/dom';

/**
 * A three-reel, five-line slot machine you sit at. Real drums with printed reel strips spin
 * behind the glass and stop on the stops the RNG picked; the paylines light up, the LED
 * meters count your credits, and you can pull the handle or press SPIN. Diamonds are wild.
 */

const STOPS = 22;
const REEL_R = 0.2;
const REEL_W = 0.145;
const CELL = 96;

function drawSymbol(g: CanvasRenderingContext2D, sym: number, s: number): void {
  g.save();
  g.lineJoin = 'round';
  switch (sym) {
    case SYM.SEVEN: {
      g.font = `${s * 0.95}px Bungee, "Arial Black", Impact`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = s * 0.09;
      g.strokeStyle = '#ffd24a';
      g.strokeText('7', 0, s * 0.05);
      g.fillStyle = '#e8132d';
      g.fillText('7', 0, s * 0.05);
      break;
    }
    case SYM.BAR: {
      g.fillStyle = '#16121e';
      roundRect(g, -s * 0.44, -s * 0.2, s * 0.88, s * 0.4, s * 0.08);
      g.fill();
      g.strokeStyle = '#ffd24a';
      g.lineWidth = s * 0.05;
      g.stroke();
      g.font = `${s * 0.27}px Bungee, "Arial Black"`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.fillText('BAR', 0, s * 0.02);
      break;
    }
    case SYM.CHERRY: {
      g.strokeStyle = '#2f8f2f';
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(-s * 0.18, s * 0.1);
      g.quadraticCurveTo(-s * 0.05, -s * 0.25, s * 0.15, -s * 0.36);
      g.moveTo(s * 0.2, s * 0.08);
      g.quadraticCurveTo(s * 0.15, -s * 0.2, s * 0.15, -s * 0.36);
      g.stroke();
      g.fillStyle = '#4caf50';
      g.beginPath();
      g.ellipse(s * 0.24, -s * 0.34, s * 0.12, s * 0.06, -0.4, 0, Math.PI * 2);
      g.fill();
      for (const [x, y] of [[-s * 0.2, s * 0.2], [s * 0.2, s * 0.18]]) {
        const gr = g.createRadialGradient(x - s * 0.05, y - s * 0.05, s * 0.02, x, y, s * 0.18);
        gr.addColorStop(0, '#ff7a8a');
        gr.addColorStop(1, '#b3001b');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, s * 0.17, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case SYM.LEMON: {
      const gr = g.createRadialGradient(-s * 0.1, -s * 0.1, s * 0.05, 0, 0, s * 0.4);
      gr.addColorStop(0, '#fff7a0');
      gr.addColorStop(1, '#f2c200');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 0, s * 0.38, s * 0.27, -0.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#c79a00';
      g.lineWidth = s * 0.03;
      g.stroke();
      break;
    }
    case SYM.BELL: {
      const gr = g.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
      gr.addColorStop(0, '#b87a00');
      gr.addColorStop(0.5, '#ffe066');
      gr.addColorStop(1, '#b87a00');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-s * 0.34, s * 0.22);
      g.quadraticCurveTo(-s * 0.3, -s * 0.36, 0, -s * 0.36);
      g.quadraticCurveTo(s * 0.3, -s * 0.36, s * 0.34, s * 0.22);
      g.closePath();
      g.fill();
      g.fillRect(-s * 0.38, s * 0.2, s * 0.76, s * 0.07);
      g.fillStyle = '#8a5a00';
      g.beginPath();
      g.arc(0, s * 0.32, s * 0.07, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case SYM.DIAMOND: {
      g.fillStyle = '#35d7ff';
      g.beginPath();
      g.moveTo(-s * 0.36, -s * 0.1);
      g.lineTo(-s * 0.2, -s * 0.3);
      g.lineTo(s * 0.2, -s * 0.3);
      g.lineTo(s * 0.36, -s * 0.1);
      g.lineTo(0, s * 0.36);
      g.closePath();
      g.fill();
      g.fillStyle = '#b8f3ff';
      g.beginPath();
      g.moveTo(-s * 0.2, -s * 0.3);
      g.lineTo(0, -s * 0.1);
      g.lineTo(s * 0.2, -s * 0.3);
      g.closePath();
      g.fill();
      g.strokeStyle = '#0a7fa8';
      g.lineWidth = s * 0.025;
      g.beginPath();
      g.moveTo(-s * 0.36, -s * 0.1);
      g.lineTo(s * 0.36, -s * 0.1);
      g.moveTo(0, -s * 0.1);
      g.lineTo(0, s * 0.36);
      g.stroke();
      g.font = `${s * 0.13}px "Lilita One", Arial`;
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.fillText('WILD', 0, s * 0.47);
      break;
    }
    case SYM.STAR: {
      g.fillStyle = '#ffcc1f';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? s * 0.17 : s * 0.38;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r + s * 0.02);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = '#c47a00';
      g.lineWidth = s * 0.03;
      g.stroke();
      break;
    }
    case SYM.GRAPE: {
      const pts = [[0, -0.2], [-0.13, -0.08], [0.13, -0.08], [0, 0.04], [-0.13, 0.16], [0.13, 0.16], [0, 0.28], [-0.24, 0.02], [0.24, 0.02]];
      for (const [x, y] of pts) {
        const gr = g.createRadialGradient((x - 0.03) * s, (y - 0.03) * s, s * 0.01, x * s, y * s, s * 0.1);
        gr.addColorStop(0, '#c89bff');
        gr.addColorStop(1, '#4a1590');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x * s, y * s, s * 0.09, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#3c9b3c';
      g.fillRect(-s * 0.02, -s * 0.38, s * 0.04, s * 0.12);
      break;
    }
    default:
      break;
  }
  g.restore();
}

const reelTexCache = new Map<number, THREE.CanvasTexture>();
function reelTexture(reel: number): THREE.CanvasTexture {
  const hit = reelTexCache.get(reel);
  if (hit) return hit;
  const strip = STRIPS[reel];
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = STOPS * CELL;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 128, 0);
  bg.addColorStop(0, '#d8d4c8');
  bg.addColorStop(0.5, '#fbfaf4');
  bg.addColorStop(1, '#d8d4c8');
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, c.height);
  strip.forEach((sym, k) => {
    // Stop k sits at v = (k + 0.5) / STOPS (canvas row counted from the bottom).
    const cy = c.height - (k + 0.5) * CELL;
    g.save();
    g.translate(64, cy);
    // The drum maps canvas rows bottom-up, so draw each symbol flipped to read upright.
    g.scale(1, -1);
    drawSymbol(g, sym, CELL * 0.86);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  reelTexCache.set(reel, t);
  return t;
}

/** A drum with its axis along x, uv.v running round the circumference. */
function drumGeometry(): THREE.BufferGeometry {
  const N = 66;
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const th = t * Math.PI * 2;
    const y = Math.cos(th) * REEL_R;
    const z = Math.sin(th) * REEL_R;
    for (const j of [0, 1]) {
      pos.push(j ? REEL_W / 2 : -REEL_W / 2, y, z);
      uv.push(j, t);
      nor.push(0, Math.cos(th), Math.sin(th));
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Drum angle that puts `stop` dead centre in the window. */
function angleFor(stop: number): number {
  const th = ((stop + 0.5) / STOPS) * Math.PI * 2;
  return Math.PI / 2 - th;
}

export interface SlotTheme {
  name: string;
  body: number;
  trim: number;
  glow: string;
}

const SLOT_THEMES: SlotTheme[] = [
  { name: 'LUCKY 7s', body: 0xb8202f, trim: 0xf2c230, glow: '#ff3b3b' },
  { name: 'DIAMOND DELUXE', body: 0x1d3f9e, trim: 0xd8e6f2, glow: '#3fe0ff' },
  { name: 'FRUIT FIESTA', body: 0x2a9a3a, trim: 0xffd23d, glow: '#7cff5a' },
  { name: 'STAR STRIKE', body: 0x6a2fb8, trim: 0xf2c230, glow: '#d68bff' },
  { name: 'GOLDEN BELLS', body: 0x1a1a1f, trim: 0xf2c230, glow: '#ffd23d' },
];

function drawPaytable(g: CanvasRenderingContext2D, theme: SlotTheme, y0: number): void {
  g.save();
  g.translate(0, y0);
  g.fillStyle = '#0b0b14';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = theme.glow;
  g.lineWidth = 4;
  g.strokeRect(4, 4, 504, 248);
  const rows: [number[], string][] = [
    [[SYM.DIAMOND, SYM.DIAMOND, SYM.DIAMOND], String(THREE_PAYS[SYM.DIAMOND])],
    [[SYM.SEVEN, SYM.SEVEN, SYM.SEVEN], String(THREE_PAYS[SYM.SEVEN])],
    [[SYM.STAR, SYM.STAR, SYM.STAR], String(THREE_PAYS[SYM.STAR])],
    [[SYM.BAR, SYM.BAR, SYM.BAR], String(THREE_PAYS[SYM.BAR])],
    [[SYM.BELL, SYM.BELL, SYM.BELL], String(THREE_PAYS[SYM.BELL])],
    [[SYM.GRAPE, SYM.GRAPE, SYM.GRAPE], String(THREE_PAYS[SYM.GRAPE])],
    [[SYM.CHERRY, SYM.CHERRY, SYM.CHERRY], String(THREE_PAYS[SYM.CHERRY])],
    [[SYM.LEMON, SYM.LEMON, SYM.LEMON], String(THREE_PAYS[SYM.LEMON])],
    [[SYM.CHERRY, SYM.CHERRY], String(TWO_CHERRIES)],
    [[SYM.CHERRY], String(ONE_CHERRY)],
  ];
  rows.forEach(([syms, pay], i) => {
    const col = i < 5 ? 0 : 1;
    const row = i % 5;
    const x = 22 + col * 250;
    const y = 30 + row * 46;
    syms.forEach((sy, j) => {
      g.save();
      g.translate(x + j * 40 + 16, y + 14);
      drawSymbol(g, sy, 38);
      g.restore();
    });
    g.fillStyle = '#ffd23d';
    g.font = '30px "Lilita One", Arial';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillText(pay, x + 220, y + 24);
  });
  g.fillStyle = '#9fe8ff';
  g.font = '16px Nunito, Arial';
  g.textAlign = 'center';
  g.fillText('Pays x coins per line · 5 lines · Diamonds are WILD and double the win', 256, 248);
  g.restore();
}

const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false });

const themeMats = new Map<string, THREE.MeshBasicMaterial>();
/** Sign (top), paytable (middle) and button labels (bottom strip) in one texture per theme. */
function themeMaterial(theme: SlotTheme): THREE.MeshBasicMaterial {
  let m = themeMats.get(theme.name);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 640;
  const g = c.getContext('2d')!;
  const H = c.height;
  g.fillStyle = '#0b0b14';
  g.fillRect(0, 0, 512, H);
  // Sign: canvas rows 0..179 (v 0.72..1).
  g.strokeStyle = theme.glow;
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 167);
  g.font = '64px Bungee, "Arial Black"';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = theme.glow;
  g.shadowBlur = 20;
  g.fillStyle = '#ffffff';
  g.fillText(theme.name, 256, 92, 470);
  g.shadowBlur = 0;
  // Paytable: rows 192..448 (v 0.3..0.7).
  drawPaytable(g, theme, 192);
  // Button labels: the bottom strip (v 0..0.08).
  g.fillStyle = '#15151a';
  g.fillRect(0, H - 51, 512, 51);
  g.fillStyle = '#ffffff';
  g.font = '26px "Lilita One", Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [x, t] of [[48, 'LINES'], [139, 'BET'], [230, 'MAX'], [400, 'SPIN']] as const) g.fillText(t, x, H - 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  themeMats.set(theme.name, m);
  return m;
}

const reelMats = new Map<number, THREE.MeshLambertMaterial>();
function reelMaterial(i: number): THREE.MeshLambertMaterial {
  let m = reelMats.get(i);
  if (!m) reelMats.set(i, (m = new THREE.MeshLambertMaterial({ map: reelTexture(i), emissive: 0x2a2a2a })));
  return m;
}

export class SlotMachine extends TableBase {
  readonly kind = 'slots' as const;
  readonly name: string;
  private reels: THREE.Mesh[] = [];
  private stops = [0, 0, 0];
  private spinning = false;
  private meters = new CanvasScreen(480, 460);
  private live!: THREE.Mesh;
  private litLines: number[] = [];
  private lever!: THREE.Group;
  private buttons = new Map<THREE.Object3D, string>();
  private denom: number;
  lines = 5;
  coins = 1;
  private lastWin = 0;
  private credit = 0;
  private flash = 0;
  private ambient = 6 + Math.random() * 8;
  private theme: SlotTheme;
  /** Moving parts, hidden when you're far away. */
  private dynamic = new THREE.Group();
  private _p = new THREE.Vector3();

  constructor(seed: number, opts: { min?: number; max?: number } = {}) {
    super(seed);
    this.denom = Math.max(1, opts.min ?? 1);
    this.minBet = this.denom;
    this.maxBet = opts.max ?? this.denom * 15;
    this.theme = SLOT_THEMES[Math.floor(this.rng() * SLOT_THEMES.length)];
    this.name = `${this.theme.name} slots`;
    this.group.add(this.dynamic);
    this.build();
    this.stops = spin(this.rng);
    this.reels.forEach((r, i) => (r.rotation.x = angleFor(this.stops[i])));
    this.focus.set(0, 1.27, 0.2);
    this.surfaceY = 1.0;
    this.drawMeters();
  }

  private build(): void {
    const th = this.theme;
    const k = new Kit();
    // Pedestal and cabinet with a window cut-out for the reels.
    k.rbox(0.66, 0.72, 0.56, 0.03, 0x15151a, { y: 0.36 }, 'shiny');
    k.box(0.68, 0.04, 0.58, th.trim, { y: 0.72 }, 'shiny');
    k.rbox(0.72, 1.08, 0.5, 0.05, th.body, { y: 1.28, z: -0.06 }, 'shiny');
    // Front frame round the reel window (y 1.04..1.40).
    k.box(0.72, 0.28, 0.06, th.body, { y: 0.88, z: 0.22 }, 'shiny');
    k.box(0.72, 0.28, 0.06, th.body, { y: 1.69, z: 0.22 }, 'shiny');
    k.box(0.1, 0.52, 0.06, th.body, { x: -0.31, y: 1.29, z: 0.22 }, 'shiny');
    k.box(0.1, 0.52, 0.06, th.body, { x: 0.31, y: 1.29, z: 0.22 }, 'shiny');
    k.box(0.54, 0.02, 0.07, th.trim, { y: 1.545, z: 0.225 }, 'shiny');
    k.box(0.54, 0.02, 0.07, th.trim, { y: 1.405, z: 0.225 }, 'shiny');
    k.box(0.54, 0.02, 0.07, th.trim, { y: 1.035, z: 0.225 }, 'shiny');
    k.box(0.02, 0.52, 0.07, th.trim, { x: -0.27, y: 1.29, z: 0.225 }, 'shiny');
    k.box(0.02, 0.52, 0.07, th.trim, { x: 0.27, y: 1.29, z: 0.225 }, 'shiny');
    k.box(0.5, 0.13, 0.01, 0x05050a, { y: 1.475, z: 0.245 });
    k.box(0.52, 0.42, 0.02, 0x0a0a0c, { y: 1.22, z: -0.2 });
    // Sloped button deck with its buttons.
    k.box(0.72, 0.06, 0.24, 0x15151a, { y: 1.0, z: 0.34, rx: 0.12 }, 'shiny');
    k.box(0.09, 0.02, 0.04, 0x3fa0ff, { x: -0.25, y: 1.04, z: 0.36, rx: 0.12 }, 'glow');
    k.box(0.09, 0.02, 0.04, 0x7cff5a, { x: -0.14, y: 1.04, z: 0.36, rx: 0.12 }, 'glow');
    k.box(0.09, 0.02, 0.04, 0xffb020, { x: -0.03, y: 1.04, z: 0.36, rx: 0.12 }, 'glow');
    k.cyl(0.035, 0.035, 0.02, 0xff3b3b, { x: 0.17, y: 1.045, z: 0.36, rx: 0.12 }, 'glow', 16);
    // Top box with a candle light.
    k.rbox(0.74, 0.32, 0.5, 0.08, th.body, { y: 2.0, z: -0.06 }, 'shiny');
    k.box(0.76, 0.03, 0.52, th.trim, { y: 1.83, z: -0.06 }, 'shiny');
    k.cyl(0.05, 0.05, 0.16, parseInt(th.glow.slice(1), 16), { y: 2.24, z: -0.06 }, 'glow', 12);
    // Coin tray.
    k.box(0.42, 0.08, 0.14, 0x9aa1aa, { y: 0.62, z: 0.33 }, 'shiny');
    k.box(0.38, 0.02, 0.1, 0x30343a, { y: 0.66, z: 0.34 });
    stoolParts(k, 0, 0.78, Math.PI, 0x2a2a30);
    const cab = k.bake({ shadows: true });
    markStatic(cab);
    this.group.add(cab);
    // Printed glass: sign, paytable and button labels share one texture per theme.
    const mat = themeMaterial(th);
    const plane = (w: number, h: number, v0: number, v1: number, x: number, y: number, z: number, rx = 0) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i));
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      markStatic(m);
      this.group.add(m);
    };
    plane(0.66, 0.24, 0.72, 1.0, 0, 2.0, 0.195);
    plane(0.6, 0.26, 0.3, 0.7, 0, 1.68, 0.252);
    plane(0.6, 0.05, 0.0, 0.08, -0.02, 1.035, 0.42, -Math.PI / 2 + 0.12);
    // Reels (moving parts).
    const geo = drumGeometry();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, reelMaterial(i));
      m.position.set((i - 1) * 0.15, 1.22, 0.0);
      this.reels.push(m);
      this.dynamic.add(m);
    }
    // One live panel over the window and meters: credits, bet, win and lit paylines.
    this.live = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.5), new THREE.MeshBasicMaterial({ map: this.meters.texture, transparent: true, toneMapped: false, depthWrite: false }));
    this.live.position.set(0, 1.29, 0.256);
    this.live.renderOrder = 4;
    this.dynamic.add(this.live);
    // Invisible click targets for the buttons.
    const pick = (id: string, x: number, w: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.07), PICK_MAT);
      m.position.set(x, 1.04, 0.36);
      m.rotation.x = 0.12;
      this.group.add(m);
      this.pickables.push(m);
      this.buttons.set(m, id);
    };
    pick('lines', -0.25, 0.1);
    pick('bet', -0.14, 0.1);
    pick('max', -0.03, 0.1);
    pick('spin', 0.17, 0.09);
    // The handle on the right side.
    this.lever = new THREE.Group();
    const lk = new Kit();
    lk.cyl(0.05, 0.05, 0.06, 0x9aa1aa, { rz: Math.PI / 2 }, 'shiny', 16);
    lk.cyl(0.015, 0.015, 0.42, 0xd8dde4, { x: 0.04, y: 0.21 }, 'shiny', 8);
    lk.sphere(0.045, 0xe8132d, { x: 0.04, y: 0.44 }, 'shiny', 14, 10);
    this.lever.add(lk.bake({ shadows: true }));
    this.lever.position.set(0.39, 1.2, -0.02);
    this.dynamic.add(this.lever);
    const lp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), PICK_MAT);
    lp.position.set(0.43, 1.42, -0.02);
    this.group.add(lp);
    this.pickables.push(lp);
    this.buttons.set(lp, 'lever');
    this.seats.push({ x: 0, z: 0.78, yaw: Math.PI, who: null, eye: 1.2 });
  }

  private get bet(): number {
    return this.denom * this.coins * this.lines;
  }

  private drawMeters(): void {
    const g = this.meters.g;
    const W = this.meters.width;
    const H = this.meters.height;
    g.clearRect(0, 0, W, H);
    // LED meters along the top of the panel, lit paylines over the window below them.
    const top = H * 0.22;
    const wh = H - top;
    const colors = ['#ff3b3b', '#3fe0ff', '#7cff5a', '#ffd23d', '#ff3fa4'];
    for (const l of this.litLines) {
      const ln = LINES[l];
      g.strokeStyle = colors[l];
      g.shadowColor = colors[l];
      g.shadowBlur = 12;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(W * 0.06, top + wh * (0.2 + ln[0] * 0.3));
      ln.forEach((row, reel) => g.lineTo(W * (0.21 + reel * 0.29), top + wh * (0.2 + row * 0.3)));
      g.lineTo(W * 0.94, top + wh * (0.2 + ln[2] * 0.3));
      g.stroke();
      g.shadowBlur = 0;
    }
    const my = 0;
    g.fillStyle = '#05050a';
    g.fillRect(0, 0, W, top);
    const cell = (x: number, label: string, v: string) => {
      g.fillStyle = '#ffb020';
      g.font = '17px "Lilita One", Arial';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(label, x, my + 24);
      g.fillStyle = '#ff3b3b';
      g.shadowColor = '#ff3b3b';
      g.shadowBlur = 8;
      g.font = '34px "Lilita One", Arial';
      g.fillText(v, x, my + 64, 150);
      g.shadowBlur = 0;
    };
    cell(W * 0.17, 'CREDIT', money(this.host ? this.host.balance() : this.credit, true));
    cell(W * 0.5, `BET · ${this.lines} LINE${this.lines > 1 ? 'S' : ''}`, money(this.bet));
    cell(W * 0.83, 'WIN', money(this.lastWin, true));
    this.meters.update();
  }

  protected onEnter(): void {
    this.lastWin = 0;
    this.drawMeters();
    this.refreshOptions();
  }

  protected onExit(): void {
    this.litLines = [];
    this.drawMeters();
  }

  canLeave(): boolean {
    return !this.spinning;
  }

  private refreshOptions(): void {
    const h = this.host;
    if (!h) return;
    h.options.show({
      title: this.name.toUpperCase(),
      bet: this.bet,
      balance: h.balance(),
      hint: `$${this.denom} machine · ${this.coins} coin${this.coins > 1 ? 's' : ''} a line · click SPIN or pull the handle`,
      buttons: [
        { id: 'lines', label: `Lines ${this.lines}`, key: 'L', enabled: !this.spinning },
        { id: 'bet', label: `Coins ${this.coins}`, key: 'B', enabled: !this.spinning },
        { id: 'max', label: 'Max bet', key: 'M', enabled: !this.spinning },
        { id: 'spin', label: 'Spin', key: 'Space', primary: true, enabled: !this.spinning },
        { id: 'leave', label: 'Leave', key: 'Esc', danger: true },
      ],
    });
  }

  button(id: string): void {
    if (!this.host || this.spinning) return;
    if (id === 'lines') this.lines = (this.lines % 5) + 1;
    else if (id === 'bet') this.coins = (this.coins % 3) + 1;
    else if (id === 'max') {
      this.lines = 5;
      this.coins = 3;
      void this.spinOnce(false);
    } else if (id === 'spin') void this.spinOnce(false);
    else if (id === 'lever') void this.spinOnce(true);
    this.host?.sound('click', 0.4);
    this.drawMeters();
    this.refreshOptions();
  }

  click(_p: THREE.Vector3, button: number, object: THREE.Object3D): void {
    if (button !== 0) return;
    const id = this.buttons.get(object);
    if (id) this.button(id);
  }

  key(code: string): boolean {
    const map: Record<string, string> = { Space: 'spin', KeyL: 'lines', KeyB: 'bet', KeyM: 'max', Enter: 'spin' };
    if (!map[code]) return false;
    this.button(map[code]);
    return true;
  }

  private async spinOnce(lever: boolean, ambient = false): Promise<void> {
    if (this.spinning) return;
    const host = ambient ? null : this.host;
    if (!ambient) {
      if (!host) return;
      if (!host.take(this.bet)) {
        host.sound('error', 0.5);
        this.lastWin = 0;
        return;
      }
    }
    this.spinning = true;
    const bet = this.bet;
    this.lastWin = 0;
    this.litLines = [];
    this.drawMeters();
    this.refreshOptions();
    if (lever) {
      await tweens.run(0.25, (k) => (this.lever.rotation.x = k * 1.1), ease.out);
      void tweens.run(0.35, (k) => (this.lever.rotation.x = 1.1 * (1 - k)), ease.outBack);
    }
    host?.sound('spin', 0.8);
    const result = spin(this.rng);
    const w = evaluate(result, this.lines);
    // Anticipation: when the first two reels line up a paying symbol, the last one slows.
    const s0 = STRIPS[0][result[0]];
    const tease = !ambient && s0 !== SYM.BLANK && s0 === STRIPS[1][result[1]];
    const done: Promise<void>[] = [];
    for (let i = 0; i < 3; i++) {
      const start = this.reels[i].rotation.x;
      const spins = 3 + i * 1.5 + (tease && i === 2 ? 2.5 : 0);
      let target = angleFor(result[i]);
      while (target < start + spins * Math.PI * 2) target += Math.PI * 2;
      const dur = 1.0 + i * 0.45 + (tease && i === 2 ? 1.2 : 0);
      done.push(
        tweens
          .run(dur, (k) => (this.reels[i].rotation.x = start + (target - start) * k), (t) => 1 - Math.pow(1 - t, 3))
          .then(() => host?.sound('clack', 0.6)),
      );
    }
    await Promise.all(done);
    this.stops = result;
    const totalPays = w.reduce((a, x) => a + x.pays, 0);
    const win = totalPays * this.coins * this.denom;
    this.lastWin = win;
    if (host) {
      if (win > 0) host.give(win);
      host.record('slots', bet, win);
      this.showWins(w);
      if (win >= bet * 100) {
        host.celebrate('jackpot', win);
        this.flash = 6;
      } else if (win >= bet * 15) {
        host.celebrate('big', win);
        this.flash = 3;
      } else if (win > 0) {
        host.sound('win', 0.8);
        this.flash = 1.5;
      }
    } else if (win > 0) {
      this.showWins(w);
      this.flash = 1.2;
      this.seats[0].npc?.react(win > bet * 10 ? 'cheer' : 'clap', 'grin', 2);
    }
    this.spinning = false;
    this.drawMeters();
    this.refreshOptions();
  }

  private showWins(w: LineWin[]): void {
    this.litLines = w.map((x) => x.line);
    this.drawMeters();
  }

  protected sitPose(): 'sitSlot' {
    return 'sitSlot';
  }

  /** Hide the moving parts when the camera is far away. */
  updateLods(cam: THREE.Vector3): void {
    super.updateLods(cam);
    const d = this.group.getWorldPosition(this._p).distanceTo(cam);
    this.dynamic.visible = d < 14;
    this.lever.visible = d < 7;
  }

  tick(dt: number): void {
    if (this.flash > 0) {
      this.flash -= dt;
      const mat = this.live.material as THREE.MeshBasicMaterial;
      mat.opacity = this.flash <= 0 || Math.floor(this.flash * 8) % 2 === 0 ? 1 : 0.5;
    }
    // NPC players spin now and then (just life on the floor, no money changes hands).
    if (!this.host && this.seats[0].who === 'npc' && this.dynamic.visible) {
      this.ambient -= dt;
      if (this.ambient < 0) {
        this.ambient = 5 + this.rng() * 9;
        this.seats[0].npc?.react('pullLever', 'focused', 1);
        void this.spinOnce(this.rng() < 0.3, true);
      }
    }
  }

  /** The symbols on the middle line (for tests and debugging). */
  describe(): string {
    return this.stops.map((s, i) => SYMBOL_NAMES[STRIPS[i][s]]).join(' | ');
  }
}
