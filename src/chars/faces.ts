import * as THREE from 'three';

/**
 * Painted faces in a clean game-character style (almond eyes with a catch-light, shaped
 * brows, a simple mouth), drawn into an atlas of expressions (one atlas per eye colour). Each character's face decal picks its
 * expression by shifting the texture offset, so a smile or a blink costs nothing.
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
function eye(g: CanvasRenderingContext2D, side: number, iris: string, open: number, lookX: number): void {
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
  // A soft lower lid.
  g.strokeStyle = 'rgba(90,45,35,0.35)';
  g.lineWidth = sy(0.9);
  g.beginPath();
  g.moveTo(px(inner + side * 2), py(cy - 1.5));
  g.quadraticCurveTo(px(cx), py(cy - down * 1.45), px(outer - side * 1.5), py(cy + 0.8));
  g.stroke();
}

function brow(g: CanvasRenderingContext2D, side: number, lift: number, tilt: number): void {
  const y = 1706 + lift;
  const inner = side * 17;
  const outer = side * 51;
  g.fillStyle = BROW;
  g.beginPath();
  g.moveTo(px(inner), py(y - tilt + 2.6));
  g.quadraticCurveTo(px(side * 36), py(y + 5.5), px(outer), py(y + 0.5));
  g.quadraticCurveTo(px(side * 36), py(y + 2.2), px(inner), py(y - tilt - 2.2));
  g.closePath();
  g.fill();
}

function mouth(g: CanvasRenderingContext2D, kind: Look['mouth']): void {
  const y = 1594;
  const w = 17;
  const lip = 'rgba(160,70,62,0.55)';
  g.lineCap = 'round';
  g.strokeStyle = '#5a2620';
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
  if (kind === 'flat' || kind === 'smile' || kind === 'smirk' || kind === 'sad') {
    g.fillStyle = lip;
    g.beginPath();
    g.ellipse(px(0), py(y - 3), sx(w * 0.62), sy(2.4), 0, 0, Math.PI * 2);
    g.fill();
  }
}

function drawFace(g: CanvasRenderingContext2D, x: number, y: number, e: Expression, iris: string): void {
  g.save();
  g.translate(x, y);
  const l = look(e);
  eye(g, 1, iris, l.open * l.leftOpen, l.lookX);
  eye(g, -1, iris, l.open, l.lookX);
  brow(g, 1, l.browY, l.browTilt);
  brow(g, -1, l.browY, l.browTilt);
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
  mouth(g, l.mouth);
  g.restore();
}

const atlases = new Map<string, THREE.CanvasTexture>();

/** The expression atlas for an eye colour. */
export function faceAtlas(eyeColor: string): THREE.CanvasTexture {
  const hit = atlases.get(eyeColor);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = COLS * CELL;
  c.height = ROWS * CELL;
  const g = c.getContext('2d')!;
  EXPRESSIONS.forEach((e, i) => drawFace(g, (i % COLS) * CELL, Math.floor(i / COLS) * CELL, e, EYE_COLORS[eyeColor] ?? EYE_COLORS.brown));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(1 / COLS, 1 / ROWS);
  atlases.set(eyeColor, t);
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
