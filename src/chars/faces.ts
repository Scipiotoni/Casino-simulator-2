import * as THREE from 'three';

/**
 * Painted faces: big expressive eyes with highlights, bold brows and a mouth, drawn into an
 * atlas of expressions (one atlas per eye colour). Each character's face decal picks its
 * expression by shifting the texture offset, so a smile or a blink costs nothing.
 */

export const EXPRESSIONS = ['neutral', 'happy', 'grin', 'sad', 'angry', 'surprised', 'blink', 'smirk', 'focused', 'wink', 'shout', 'sleep'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const COLS = 4;
const ROWS = 3;
const CELL = 128;

export const EYE_COLORS: Record<string, string> = {
  brown: '#6b3e1f',
  hazel: '#8a6a2a',
  blue: '#2f7fd8',
  green: '#3b9a4c',
  grey: '#6f7f8f',
  amber: '#c98a1a',
  violet: '#8a4fd8',
};

function eye(g: CanvasRenderingContext2D, cx: number, cy: number, iris: string, open: number, lookX = 0, lash = true, right = false): void {
  const w = 19;
  const h = 20 * open;
  if (open < 0.15) {
    // Closed: a curved lash line.
    g.strokeStyle = '#1b1210';
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - w, cy);
    g.quadraticCurveTo(cx, cy + 7, cx + w, cy);
    g.stroke();
    return;
  }
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.clip();
  // Iris with a darker rim, pupil and two highlights.
  const ix = cx + lookX * 5;
  const ir = 12.5;
  const grad = g.createRadialGradient(ix, cy + 2, 2, ix, cy, ir);
  grad.addColorStop(0, iris);
  grad.addColorStop(0.75, iris);
  grad.addColorStop(1, '#1a1410');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(ix, cy + 1, ir, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0d0a08';
  g.beginPath();
  g.arc(ix, cy + 1, 5.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(ix - 4, cy - 4, 3.6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(ix + 4, cy + 5, 1.6, 0, Math.PI * 2);
  g.fill();
  // Upper lid shadow.
  g.fillStyle = 'rgba(80,40,30,0.18)';
  g.fillRect(cx - w, cy - h, w * 2, h * 0.35);
  g.restore();
  // Upper lid line and a flick of lashes.
  g.strokeStyle = '#1b1210';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.ellipse(cx, cy, w + 0.5, h + 0.5, 0, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  if (lash) {
    const s = right ? 1 : -1;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + s * (w - 2), cy - h * 0.55);
    g.lineTo(cx + s * (w + 6), cy - h * 0.9);
    g.stroke();
  }
}

function brow(g: CanvasRenderingContext2D, cx: number, cy: number, angle: number, right: boolean, color: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(right ? -angle : angle);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-19, 4);
  g.quadraticCurveTo(0, -8, 19, -1);
  g.lineTo(18, 5);
  g.quadraticCurveTo(0, 0, -18, 10);
  g.closePath();
  g.fill();
  g.restore();
}

function mouth(g: CanvasRenderingContext2D, kind: string, cx: number, cy: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const lip = '#6e2a22';
  switch (kind) {
    case 'smile':
      g.strokeStyle = lip;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(cx - 14, cy - 2);
      g.quadraticCurveTo(cx, cy + 9, cx + 14, cy - 2);
      g.stroke();
      break;
    case 'grin': {
      g.fillStyle = '#5a1c18';
      g.beginPath();
      g.moveTo(cx - 17, cy - 4);
      g.quadraticCurveTo(cx, cy + 20, cx + 17, cy - 4);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(cx - 15, cy - 3);
      g.quadraticCurveTo(cx, cy + 3, cx + 15, cy - 3);
      g.lineTo(cx + 13, cy + 1);
      g.quadraticCurveTo(cx, cy + 5, cx - 13, cy + 1);
      g.closePath();
      g.fill();
      g.fillStyle = '#e8737a';
      g.beginPath();
      g.ellipse(cx, cy + 9, 7, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'sad':
      g.strokeStyle = lip;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(cx - 12, cy + 5);
      g.quadraticCurveTo(cx, cy - 4, cx + 12, cy + 5);
      g.stroke();
      break;
    case 'flat':
      g.strokeStyle = lip;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(cx - 10, cy + 1);
      g.lineTo(cx + 10, cy);
      g.stroke();
      break;
    case 'o':
      g.fillStyle = '#5a1c18';
      g.beginPath();
      g.ellipse(cx, cy + 3, 7, 9, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'shout':
      g.fillStyle = '#5a1c18';
      g.beginPath();
      g.ellipse(cx, cy + 4, 13, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(cx - 10, cy - 4, 20, 4);
      break;
    case 'smirk':
      g.strokeStyle = lip;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(cx - 10, cy + 2);
      g.quadraticCurveTo(cx + 4, cy + 4, cx + 14, cy - 4);
      g.stroke();
      break;
    case 'grit':
      g.fillStyle = '#ffffff';
      g.strokeStyle = lip;
      g.lineWidth = 2.5;
      g.beginPath();
      g.rect(cx - 12, cy - 3, 24, 8);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(cx - 12, cy + 1);
      g.lineTo(cx + 12, cy + 1);
      g.stroke();
      break;
  }
}

function drawFace(g: CanvasRenderingContext2D, x: number, y: number, e: Expression, iris: string): void {
  g.save();
  g.translate(x, y);
  // Eyes sit a little above the middle of the cell, mouth below.
  const ex = 31;
  const ey = 62;
  const my = 104;
  const browC = '#3a2416';
  const o = (n: number) => n;
  let open = 1;
  let browA = 0;
  let browY = 0;
  let m = 'smile';
  let lookX = 0;
  let leftOpen = 1;
  switch (e) {
    case 'neutral': m = 'flat'; break;
    case 'happy': m = 'smile'; browY = -3; break;
    case 'grin': m = 'grin'; browY = -4; open = 0.85; break;
    case 'sad': m = 'sad'; browA = -0.35; browY = 0; open = 0.8; break;
    case 'angry': m = 'grit'; browA = 0.42; browY = 4; open = 0.75; break;
    case 'surprised': m = 'o'; browY = -8; open = 1.15; break;
    case 'blink': m = 'flat'; open = 0; break;
    case 'smirk': m = 'smirk'; browA = 0.12; open = 0.85; lookX = 0.6; break;
    case 'focused': m = 'flat'; browA = 0.2; browY = 2; open = 0.7; break;
    case 'wink': m = 'grin'; leftOpen = 0; browY = -2; break;
    case 'shout': m = 'shout'; browA = 0.35; browY = 2; open = 0.95; break;
    case 'sleep': m = 'flat'; open = 0; break;
  }
  void o;
  eye(g, 64 - ex, ey, iris, open * leftOpen, lookX, true, false);
  eye(g, 64 + ex, ey, iris, open, lookX, true, true);
  brow(g, 64 - ex, ey - 31 + browY, browA, false, browC);
  brow(g, 64 + ex, ey - 31 + browY, browA, true, browC);
  // Soft cheek blush and a hint of a nose.
  g.fillStyle = 'rgba(230,110,100,0.16)';
  g.beginPath();
  g.ellipse(64 - 42, 88, 12, 7, 0, 0, Math.PI * 2);
  g.ellipse(64 + 42, 88, 12, 7, 0, 0, Math.PI * 2);
  g.fill();
  mouth(g, m, 64, my);
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
