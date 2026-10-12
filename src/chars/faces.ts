import * as THREE from 'three';
import type { Beard, Brows, FaceStyle, Lips, Marks } from './skins';

/**
 * Painted faces in a clean game-character style (almond eyes with a catch-light, shaped
 * brows, a simple mouth), drawn into an atlas of expressions (one atlas per eye colour). Each character's face decal picks its
 * expression by shifting the texture offset, so a smile or a blink costs nothing. A custom
 * face (brows, facial hair, lipstick, lashes, freckles and the like) gets an atlas of its own.
 */

export const EXPRESSIONS = ['neutral', 'happy', 'grin', 'sad', 'angry', 'surprised', 'blink', 'smirk', 'focused', 'wink', 'shout', 'sleep'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const COLS = 4;
const ROWS = 3;
const CELL = 160;

export const EYE_COLORS: Record<string, string> = {
  brown: '#6b3e1f',
  hazel: '#8a6a2a',
  blue: '#2f7fd8',
  green: '#3b9a4c',
  grey: '#6f7f8f',
  amber: '#c98a1a',
  violet: '#8a4fd8',
};

/**
 * The face patch on the modelled head spans x -100..100 mm and y 1535..1790 mm (heights
 * above the ground in the rest pose), so features are placed in millimetres on the real
 * head: eyes on the 1676 line, brows at 1706, the mouth at 1594.
 */
const X0 = -100;
const X1 = 100;
const Y0 = 1535;
const Y1 = 1790;
const px = (x: number) => ((x - X0) / (X1 - X0)) * CELL;
const py = (y: number) => ((Y1 - y) / (Y1 - Y0)) * CELL;
/** Millimetres to pixels (horizontally / vertically: the patch is taller than it is wide). */
const sx = (mm: number) => (mm / (X1 - X0)) * CELL;
const sy = (mm: number) => (mm / (Y1 - Y0)) * CELL;

const INK = '#1b1210';
const BROW = '#3a2416';

interface Look {
  open: number;
  leftOpen: number;
  lookX: number;
  /** Brow lift (mm) and tilt (mm the inner end drops; negative raises it, sad). */
  browY: number;
  browTilt: number;
  mouth: 'flat' | 'smile' | 'grin' | 'sad' | 'o' | 'smirk' | 'grit' | 'shout';
}

function look(e: Expression): Look {
  const l: Look = { open: 1, leftOpen: 1, lookX: 0, browY: 0, browTilt: 0, mouth: 'flat' };
  switch (e) {
    case 'happy': return { ...l, mouth: 'smile', browY: 1.5 };
    case 'grin': return { ...l, mouth: 'grin', browY: 2, open: 0.85 };
    case 'sad': return { ...l, mouth: 'sad', browTilt: -3.5, open: 0.8 };
    case 'angry': return { ...l, mouth: 'grit', browTilt: 4.5, browY: -1.5, open: 0.75 };
    case 'surprised': return { ...l, mouth: 'o', browY: 5, open: 1.25 };
    case 'blink': return { ...l, open: 0 };
    case 'smirk': return { ...l, mouth: 'smirk', browTilt: 1, open: 0.85, lookX: 0.5 };
    case 'focused': return { ...l, browTilt: 2, browY: -1, open: 0.62 };
    case 'wink': return { ...l, mouth: 'grin', leftOpen: 0, browY: 1 };
    case 'shout': return { ...l, mouth: 'shout', browTilt: 3.5, open: 0.95 };
    case 'sleep': return { ...l, open: 0 };
    default: return l;
  }
}

/** One eye: an almond of white, the iris and pupil with a catch-light, a dark lash line. */
function eye(g: CanvasRenderingContext2D, side: number, iris: string, open: number, lookX: number, lashes = false): void {
  const cx = side * 34;
  const cy = 1676;
  const hw = 17;
  const inner = cx - side * hw;
  const outer = cx + side * hw;
  const up = 11 * open;
  const down = 6.5 * Math.min(1, open);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (open < 0.12) {
    g.strokeStyle = INK;
    g.lineWidth = sy(2.2);
    g.beginPath();
    g.moveTo(px(inner), py(cy));
    g.quadraticCurveTo(px(cx), py(cy - 3.5), px(outer), py(cy + 0.5));
    g.stroke();
    return;
  }
  const almond = () => {
    g.beginPath();
    g.moveTo(px(inner), py(cy - 0.5));
    g.quadraticCurveTo(px(cx - side * 2), py(cy + up * 1.5), px(outer), py(cy + 1.5));
    g.quadraticCurveTo(px(cx + side * 1), py(cy - down * 1.5), px(inner), py(cy - 0.5));
    g.closePath();
  };
  g.save();
  almond();
  g.fillStyle = '#fbf8f4';
  g.fill();
  g.clip();
  // Iris, pupil and the highlight, tucked a little under the upper lid.
  const ix = cx + lookX * 3.2;
  const iy = cy + 0.5;
  g.fillStyle = iris;
  g.beginPath();
  g.ellipse(px(ix), py(iy), sx(7.4), sy(7.4), 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.ellipse(px(ix), py(iy + 2.5), sx(7.4), sy(3.8), 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0d0907';
  g.beginPath();
  g.ellipse(px(ix), py(iy), sx(3.2), sy(3.2), 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(px(ix - 2.2), py(iy + 2.6), sx(1.8), sy(1.8), 0, 0, Math.PI * 2);
  g.fill();
  // Lid shadow across the top of the eye.
  g.fillStyle = 'rgba(80,40,30,0.18)';
  g.fillRect(px(Math.min(inner, outer)), py(cy + up * 1.6), sx(hw * 2), sy(2.5));
  g.restore();
  // Upper lash line, heavier at the outer corner with a small flick.
  g.strokeStyle = INK;
  g.lineWidth = sy(2.1);
  g.beginPath();
  g.moveTo(px(inner), py(cy - 0.5));
  g.quadraticCurveTo(px(cx - side * 2), py(cy + up * 1.5), px(outer), py(cy + 1.5));
  g.lineTo(px(outer + side * 2.5), py(cy + 3.2));
  g.stroke();
  if (lashes) {
    // Three flicks off the outer half of the lid.
    g.lineWidth = sy(1.5);
    for (let i = 0; i < 3; i++) {
      const t = 0.55 + i * 0.2;
      const lx = inner + (outer - inner) * t;
      const ly = cy + up * 1.5 * (1 - (2 * t - 1) * (2 * t - 1)) * 0.75 + 0.8;
      g.beginPath();
      g.moveTo(px(lx), py(ly));
      g.lineTo(px(lx + side * (2 + i * 1.2)), py(ly + 3.2 + i * 0.4));
      g.stroke();
    }
  }
  // A soft lower lid.
  g.strokeStyle = 'rgba(90,45,35,0.35)';
  g.lineWidth = sy(0.9);
  g.beginPath();
  g.moveTo(px(inner + side * 2), py(cy - 1.5));
  g.quadraticCurveTo(px(cx), py(cy - down * 1.45), px(outer - side * 1.5), py(cy + 0.8));
  g.stroke();
}

/** Brow shapes: the top and bottom of the middle, and the half-thickness at the inner end (mm). */
const BROW_SHAPES: Record<Brows, { top: number; bottom: number; inner: number; outer: number }> = {
  soft: { top: 5.5, bottom: 2.2, inner: 2.4, outer: 0.5 },
  thick: { top: 9.5, bottom: 0, inner: 4.6, outer: 1.6 },
  thin: { top: 4.2, bottom: 3.3, inner: 0.8, outer: 0.8 },
  arched: { top: 11, bottom: 7, inner: 2, outer: -2 },
  straight: { top: 3.2, bottom: -0.6, inner: 2.2, outer: 0.6 },
};

function brow(g: CanvasRenderingContext2D, side: number, lift: number, tilt: number, kind: Brows = 'soft', color = BROW): void {
  const y = 1706 + lift;
  const inner = side * 17;
  const outer = side * 51;
  const sh = BROW_SHAPES[kind];
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(px(inner), py(y - tilt + sh.inner + 0.2));
  g.quadraticCurveTo(px(side * 36), py(y + sh.top), px(outer), py(y + sh.outer));
  g.quadraticCurveTo(px(side * 36), py(y + sh.bottom), px(inner), py(y - tilt - sh.inner));
  g.closePath();
  g.fill();
}

/** A seeded random so the stubble and freckles are the same on every frame of the atlas. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The outline of each kind of facial hair, in millimetres on the face. */
function beardPath(g: CanvasRenderingContext2D, kind: Beard): void {
  const P = (x: number, y: number) => [px(x), py(y)] as const;
  const moveTo = (x: number, y: number) => g.moveTo(...P(x, y));
  const lineTo = (x: number, y: number) => g.lineTo(...P(x, y));
  const quad = (cx: number, cy: number, x: number, y: number) => g.quadraticCurveTo(...P(cx, cy), ...P(x, y));
  const moustache = () => {
    moveTo(-27, 1590);
    quad(-16, 1622, 0, 1617);
    quad(16, 1622, 27, 1590);
    quad(14, 1603, 0, 1601);
    quad(-14, 1603, -27, 1590);
    g.closePath();
  };
  g.beginPath();
  switch (kind) {
    case 'moustache':
      moustache();
      break;
    case 'goatee':
      moustache();
      moveTo(-15, 1586);
      quad(0, 1590, 15, 1586);
      quad(17, 1554, 0, 1543);
      quad(-17, 1554, -15, 1586);
      g.closePath();
      break;
    case 'chinstrap':
      moveTo(-76, 1652);
      quad(-72, 1568, 0, 1536);
      quad(72, 1568, 76, 1652);
      lineTo(60, 1652);
      quad(54, 1590, 0, 1556);
      quad(-54, 1590, -60, 1652);
      g.closePath();
      break;
    default:
      // A full beard (and the stubble's area): up the jaw to the sideburns, round the mouth.
      moveTo(-76, 1652);
      quad(-72, 1566, 0, 1536);
      quad(72, 1566, 76, 1652);
      lineTo(60, 1650);
      quad(48, 1622, 27, 1612);
      quad(14, 1620, 0, 1616);
      quad(-14, 1620, -27, 1612);
      quad(-48, 1622, -60, 1650);
      g.closePath();
  }
}

function beard(g: CanvasRenderingContext2D, kind: Beard, color: string): void {
  if (kind === 'none') return;
  const r = rand(17);
  g.save();
  beardPath(g, kind);
  if (kind === 'stubble') {
    g.globalAlpha = 0.3;
    g.fillStyle = color;
    g.fill();
    g.clip();
    g.globalAlpha = 0.18;
    for (let i = 0; i < 260; i++) g.fillRect(px(-80 + r() * 160), py(1535 + r() * 120), 1, 1);
  } else {
    g.fillStyle = color;
    g.fill();
    g.clip();
    // Strands: short darker and lighter strokes following the growth downwards.
    g.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
      const x = -80 + r() * 160;
      const y = 1535 + r() * 120;
      g.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.moveTo(px(x), py(y));
      g.lineTo(px(x + (x > 0 ? -1 : 1) * r() * 1.5), py(y - 3 - r() * 3));
      g.stroke();
    }
  }
  g.restore();
  // Leave the lips clear (the skin shows through), so the mouth still reads.
  if (kind === 'full' || kind === 'goatee' || kind === 'stubble') {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(px(0), py(1593), sx(kind === 'full' ? 21 : 19), sy(kind === 'full' ? 8.5 : 6.5), 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

const LIP_COLORS: Record<Lips, string> = {
  natural: 'rgba(160,70,62,0.55)',
  nude: 'rgba(196,122,104,0.9)',
  pink: '#e8679a',
  red: '#c8202f',
  plum: '#7a2a5a',
  black: '#262026',
};

function marks(g: CanvasRenderingContext2D, kind: Marks): void {
  const r = rand(5);
  switch (kind) {
    case 'freckles':
      g.fillStyle = 'rgba(140,70,40,0.5)';
      for (let i = 0; i < 28; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side * (6 + r() * 48);
        const y = 1628 + r() * 26 - Math.abs(x) * 0.06;
        g.beginPath();
        g.ellipse(px(x), py(y), sx(1.4 + r() * 0.9), sy(1.4 + r() * 0.9), 0, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'blush':
      g.fillStyle = 'rgba(240,90,115,0.32)';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(px(s * 44), py(1640), sx(14), sy(8), 0, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'beauty':
      g.fillStyle = '#2a1612';
      g.beginPath();
      g.ellipse(px(27), py(1612), sx(1.8), sy(1.8), 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'scar': {
      g.strokeStyle = 'rgba(190,110,105,0.85)';
      g.lineCap = 'round';
      g.lineWidth = sy(2.2);
      g.beginPath();
      g.moveTo(px(-52), py(1722));
      g.lineTo(px(-26), py(1648));
      g.stroke();
      g.lineWidth = sy(1.2);
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const x = -52 + 26 * t;
        const y = 1722 - 74 * t;
        g.beginPath();
        g.moveTo(px(x - 4), py(y - 1.4));
        g.lineTo(px(x + 4), py(y + 1.4));
        g.stroke();
      }
      break;
    }
    case 'star': {
      g.fillStyle = '#ffd23d';
      g.strokeStyle = '#b8860b';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 4.6 : 10.5;
        const x = 40 + Math.cos(a) * rr;
        const y = 1648 - Math.sin(a) * rr;
        if (i === 0) g.moveTo(px(x), py(y));
        else g.lineTo(px(x), py(y));
      }
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    case 'warpaint':
      g.fillStyle = 'rgba(24,20,28,0.85)';
      for (const s of [-1, 1]) {
        for (const yy of [1652, 1641]) {
          g.beginPath();
          g.moveTo(px(s * 30), py(yy + 2));
          g.lineTo(px(s * 64), py(yy + 3));
          g.lineTo(px(s * 64), py(yy - 2));
          g.lineTo(px(s * 30), py(yy - 1));
          g.closePath();
          g.fill();
        }
      }
      break;
    default:
  }
}

function mouth(g: CanvasRenderingContext2D, kind: Look['mouth'], lips: Lips = 'natural'): void {
  const y = 1594;
  const w = 17;
  const lip = LIP_COLORS[lips];
  const painted = lips !== 'natural';
  g.lineCap = 'round';
  // Painted lips under the line: a cupid's bow on top and a fuller lower lip.
  if (painted && (kind === 'flat' || kind === 'smile' || kind === 'smirk' || kind === 'sad')) {
    const lift = kind === 'smile' ? 2.5 : kind === 'sad' ? -2.5 : 0;
    const lw = w + 1.5;
    g.fillStyle = lip;
    g.beginPath();
    g.moveTo(px(-lw), py(y + lift));
    g.quadraticCurveTo(px(-9), py(y + 7.5), px(0), py(y + 4.5));
    g.quadraticCurveTo(px(9), py(y + 7.5), px(lw), py(y + lift));
    g.quadraticCurveTo(px(0), py(y - 11 + lift * 0.3), px(-lw), py(y + lift));
    g.fill();
    // A soft shine on the lower lip.
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.ellipse(px(3), py(y - 4.5), sx(5), sy(1.4), 0, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = painted ? shadeCss(lip) : '#5a2620';
  g.lineWidth = sy(1.8);
  const curve = (lift: number, w2 = w) => {
    g.beginPath();
    g.moveTo(px(-w2), py(y + lift));
    g.quadraticCurveTo(px(0), py(y - lift), px(w2), py(y + lift));
    g.stroke();
  };
  const open = (top: number, bottom: number, w2: number, teeth: boolean) => {
    g.fillStyle = '#5a1f1a';
    g.beginPath();
    g.moveTo(px(-w2), py(y + top * 0.3));
    g.quadraticCurveTo(px(0), py(y + top), px(w2), py(y + top * 0.3));
    g.quadraticCurveTo(px(0), py(y - bottom), px(-w2), py(y + top * 0.3));
    g.fill();
    if (teeth) {
      g.save();
      g.clip();
      g.fillStyle = '#fbf8f4';
      g.fillRect(px(-w2), py(y + top + 1), sx(w2 * 2), sy(top + 1.5));
      g.restore();
    }
  };
  switch (kind) {
    case 'smile':
      curve(3);
      break;
    case 'grin':
      open(2.5, 7, w + 1, true);
      break;
    case 'sad':
      curve(-2.8, w - 2);
      break;
    case 'o':
      g.fillStyle = '#5a1f1a';
      g.beginPath();
      g.ellipse(px(0), py(y - 2), sx(6), sy(7), 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'smirk':
      g.beginPath();
      g.moveTo(px(-w + 3), py(y));
      g.quadraticCurveTo(px(4), py(y - 1), px(w), py(y + 3.5));
      g.stroke();
      break;
    case 'grit':
      g.fillStyle = '#fbf8f4';
      g.fillRect(px(-w + 3), py(y + 2.5), sx(2 * w - 6), sy(5));
      g.strokeStyle = '#5a2620';
      g.strokeRect(px(-w + 3), py(y + 2.5), sx(2 * w - 6), sy(5));
      break;
    case 'shout':
      open(4, 12, w - 2, true);
      break;
    default:
      curve(0.6);
  }
  // Lips: a touch of colour under the line.
  if (!painted && (kind === 'flat' || kind === 'smile' || kind === 'smirk' || kind === 'sad')) {
    g.fillStyle = lip;
    g.beginPath();
    g.ellipse(px(0), py(y - 3), sx(w * 0.62), sy(2.4), 0, 0, Math.PI * 2);
    g.fill();
  }
}

/** A darker version of a CSS colour (for the line between painted lips). */
function shadeCss(c: string): string {
  const col = new THREE.Color().setStyle(c);
  col.multiplyScalar(0.55);
  return `#${col.getHexString()}`;
}

interface FacePaint {
  style: FaceStyle | null;
  /** Brow and facial-hair colours (CSS). */
  brow: string;
  hair: string;
}

function drawFace(g: CanvasRenderingContext2D, x: number, y: number, e: Expression, iris: string, paint: FacePaint): void {
  g.save();
  g.translate(x, y);
  const l = look(e);
  const st = paint.style;
  if (st) marks(g, st.marks);
  eye(g, 1, iris, l.open * l.leftOpen, l.lookX, st?.lashes);
  eye(g, -1, iris, l.open, l.lookX, st?.lashes);
  brow(g, 1, l.browY, l.browTilt, st?.brows, paint.brow);
  brow(g, -1, l.browY, l.browTilt, st?.brows, paint.brow);
  // Shading under the (modelled) nose, and the nostrils.
  g.fillStyle = 'rgba(110,50,35,0.16)';
  g.beginPath();
  g.ellipse(px(0), py(1627), sx(9), sy(3), 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(70,30,25,0.35)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(px(s * 4.5), py(1630), sx(1.6), sy(1.1), 0, 0, Math.PI * 2);
    g.fill();
  }
  // Cheeks.
  g.fillStyle = 'rgba(225,105,95,0.12)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(px(s * 44), py(1638), sx(11), sy(7), 0, 0, Math.PI * 2);
    g.fill();
  }
  if (st) beard(g, st.beard, paint.hair);
  mouth(g, l.mouth, st?.lips);
  g.restore();
}

const atlases = new Map<string, THREE.CanvasTexture>();

/** Brow colour from the hair: a little darker, so blonde and white brows still read. */
function browColor(hair: number): string {
  const c = new THREE.Color(hair);
  c.lerp(new THREE.Color(0x1b1210), 0.3);
  return `#${c.getHexString()}`;
}

/**
 * The expression atlas for an eye colour, and for a custom face its style and hair colour
 * (brows and facial hair take the hair's colour). Custom atlases beyond a few dozen are let
 * go oldest first; the faces already wearing one keep it.
 */
export function faceAtlas(eyeColor: string, style?: FaceStyle, hairColor = 0x3a2416): THREE.CanvasTexture {
  const key = style ? `${eyeColor}|${style.brows}|${style.beard}|${style.lips}|${style.marks}|${style.lashes ? 1 : 0}|${hairColor}` : eyeColor;
  const hit = atlases.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = COLS * CELL;
  c.height = ROWS * CELL;
  const g = c.getContext('2d')!;
  const paint: FacePaint = style ? { style, brow: browColor(hairColor), hair: `#${new THREE.Color(hairColor).getHexString()}` } : { style: null, brow: BROW, hair: BROW };
  EXPRESSIONS.forEach((e, i) => drawFace(g, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, e, EYE_COLORS[eyeColor] ?? EYE_COLORS.brown, paint));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(1 / COLS, 1 / ROWS);
  if (style) {
    const custom = [...atlases.keys()].filter((k) => k.includes('|'));
    if (custom.length >= 32) atlases.delete(custom[0]);
  }
  atlases.set(key, t);
  return t;
}

/** Texture offset (for map.offset) that shows an expression. */
export function expressionOffset(e: Expression): [number, number] {
  const i = EXPRESSIONS.indexOf(e);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // Canvas rows go down; texture v goes up.
  return [col / COLS, 1 - (row + 1) / ROWS];
}
