import * as THREE from 'three';
import { DEFAULT_FACE, type Beard, type Brows, type EyeShape, type FaceStyle, type LipShape, type Lips, type Makeup, type Marks } from './skins';

/**
 * Painted faces in a stylised hero-shooter look: big expressive eyes (a lid line and a crease,
 * an iris with a dark limbal ring and catch-lights, softly shaded whites), brows built up from
 * hair strokes, a shaded nose and shaped lips. Everything is drawn in millimetres on the
 * modelled head into an atlas of the 12 expressions (one per eye colour for crowds; a custom
 * face with its brows, make-up, lips, stubble and marks gets its own), and a face picks its
 * expression by shifting the texture offset, so a smile or a blink costs nothing. The skin's
 * shading is painted as see-through tints over the real skin, so an atlas suits every skin
 * tone. Modelled facial hair (Beard_*) sits on top; the paint adds the shadow under it.
 */

export const EXPRESSIONS = ['neutral', 'happy', 'grin', 'sad', 'angry', 'surprised', 'blink', 'smirk', 'focused', 'wink', 'shout', 'sleep'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const COLS = 4;
const ROWS = 3;
/** Cell size in pixels: the face patch is 200 x 255 mm, so about 1.28 px per mm (less on the low preset). */
let CW = 256;
let CH = 320;

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
 * above the ground in the rest pose): features are placed in millimetres on the real head,
 * the eyes on the 1675 line, the brows about 1708 and the mouth at 1594.
 */
interface Win {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const PATCH: Win = { x0: -100, x1: 100, y0: 1535, y1: 1790 };

type Pt = [number, number];

const INK = 0x1a110e;
const BROW = 0x3a2416;
/** Samples along an eyelid or a lip. */
const N = 20;
const EYE_X = 39;
const EYE_Y = 1675;
const MOUTH_Y = 1594;

// ------------------------------------------------------------------ colour and drawing helpers

/** Faces are painted on the CPU (quick to draw, and read back for the texture). */
const CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true };

const rgb = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
function rgba(h: number, a = 1): string {
  const [r, g, b] = rgb(h);
  return `rgba(${r},${g},${b},${a})`;
}
function mixHex(a: number, b: number, t: number): number {
  const [r0, g0, b0] = rgb(a);
  const [r1, g1, b1] = rgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (m(r0, r1) << 16) | (m(g0, g1) << 8) | m(b0, b1);
}
function shadeHex(h: number, k: number): number {
  const [r, g, b] = rgb(h);
  const m = (x: number) => Math.max(0, Math.min(255, Math.round(x * k)));
  return (m(r) << 16) | (m(g) << 8) | m(b);
}
const cssHex = (c: string): number => parseInt(c.slice(1), 16);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Draw in face millimetres (y up) into a w x h box at (x, y) of the canvas, showing `win` of the face. */
function toMm(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, win: Win = PATCH): void {
  const kx = w / (win.x1 - win.x0);
  const ky = h / (win.y1 - win.y0);
  g.setTransform(kx, 0, 0, -ky, x - win.x0 * kx, y + win.y1 * ky);
}

function poly(g: CanvasRenderingContext2D, pts: Pt[], close = true): void {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

/** A soft round spot: a radial gradient squashed into an ellipse. */
function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: number, a: number, rot = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(0.5, rgba(color, a * 0.6));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 1, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function fill(g: CanvasRenderingContext2D, style: string | CanvasGradient, path: () => void): void {
  g.fillStyle = style;
  path();
  g.fill();
}

/** Stroke a line several times, wider and fainter each time: a soft-edged line. */
function softStroke(g: CanvasRenderingContext2D, pts: Pt[], width: number, color: number, a: number, steps = 4): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = rgba(color, a / steps);
  for (let k = 1; k <= steps; k++) {
    g.lineWidth = (width * k) / steps;
    poly(g, pts, false);
    g.stroke();
  }
  g.restore();
}

/** A seeded random so the hairs, freckles and stubble are the same on every frame of the atlas. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A tapered, slightly curled stroke (a lash or a brow hair), from (x, y) along (dx, dy). */
function hair(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number, w: number, curl: number): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const nx = -uy;
  const ny = ux;
  const tx = x + ux * len + nx * curl;
  const ty = y + uy * len + ny * curl;
  const mx = x + ux * len * 0.5 + nx * curl * 0.7;
  const my = y + uy * len * 0.5 + ny * curl * 0.7;
  g.beginPath();
  g.moveTo(x + nx * w * 0.5, y + ny * w * 0.5);
  g.quadraticCurveTo(mx + nx * w * 0.25, my + ny * w * 0.25, tx, ty);
  g.quadraticCurveTo(mx - nx * w * 0.25, my - ny * w * 0.25, x - nx * w * 0.5, y - ny * w * 0.5);
  g.closePath();
  g.fill();
}

// ------------------------------------------------------------------ expressions

type Mouth = 'flat' | 'smile' | 'grin' | 'sad' | 'o' | 'smirk' | 'grit' | 'shout';

interface Look {
  open: number;
  /** The character's left eye (for a wink). */
  leftOpen: number;
  lookX: number;
  lookY: number;
  /** Brow lift (mm) and tilt (mm the inner ends drop; negative raises them, sad). */
  browY: number;
  browTilt: number;
  /** Extra lift on the left brow (a raised eyebrow). */
  browL: number;
  /** Cheeks pushing the lower lids up (smiling), 0..1. */
  squint: number;
  mouth: Mouth;
}

function look(e: Expression): Look {
  const l: Look = { open: 1, leftOpen: 1, lookX: 0, lookY: 0, browY: 0, browTilt: 0, browL: 0, squint: 0, mouth: 'flat' };
  switch (e) {
    case 'happy': return { ...l, mouth: 'smile', browY: 1.2, squint: 0.4 };
    case 'grin': return { ...l, mouth: 'grin', browY: 1.8, open: 0.9, squint: 0.6 };
    case 'sad': return { ...l, mouth: 'sad', browTilt: -4, open: 0.82, lookY: -1.2 };
    case 'angry': return { ...l, mouth: 'grit', browTilt: 5, browY: -1.8, open: 0.8 };
    case 'surprised': return { ...l, mouth: 'o', browY: 5, open: 1.2 };
    case 'blink': return { ...l, open: 0 };
    case 'smirk': return { ...l, mouth: 'smirk', browTilt: 1, browL: 2.6, open: 0.86, lookX: 0.45, squint: 0.15 };
    case 'focused': return { ...l, browTilt: 2.4, browY: -1, open: 0.64 };
    case 'wink': return { ...l, mouth: 'grin', leftOpen: 0, browY: 1, squint: 0.5 };
    case 'shout': return { ...l, mouth: 'shout', browTilt: 4, open: 0.98 };
    case 'sleep': return { ...l, open: 0, browY: -0.5 };
    default: return l;
  }
}

// ------------------------------------------------------------------ eyes

interface EyeForm {
  /** Half-width, the upper and lower lids' reach (mm), how much higher the outer corner sits. */
  hw: number;
  up: number;
  down: number;
  tilt: number;
  /** Where along the upper lid it peaks (0 inner corner .. 1 outer). */
  peak: number;
  /** Crease height over the lid, and a heavy fold over it (hooded). */
  crease: number;
  hood: number;
  iris: number;
}

const EYE_FORMS: Record<EyeShape, EyeForm> = {
  almond: { hw: 23.5, up: 14, down: 7.4, tilt: 2.6, peak: 0.44, crease: 6, hood: 0, iris: 10.6 },
  round: { hw: 22, up: 16.5, down: 10, tilt: 0.5, peak: 0.5, crease: 6.8, hood: 0, iris: 11.2 },
  narrow: { hw: 24.5, up: 10.2, down: 5.4, tilt: 4.2, peak: 0.47, crease: 5, hood: 0, iris: 10 },
  hooded: { hw: 23.5, up: 11.8, down: 7.2, tilt: 0.7, peak: 0.42, crease: 2.5, hood: 1, iris: 10.6 },
};

interface EyeGeo {
  up: Pt[];
  dn: Pt[];
  /** The upper lid fully open (the crease follows it, whatever the lid is doing). */
  rest: Pt[];
  inner: Pt;
  outer: Pt;
  cx: number;
  cy: number;
}

function eyeGeo(side: number, f: EyeForm, open: number, squint: number): EyeGeo {
  const cx = side * EYE_X;
  const cy = EYE_Y;
  const xi = cx - side * f.hw;
  const xo = cx + side * f.hw;
  const yi = cy - f.tilt * 0.5 - 0.4;
  const yo = cy + f.tilt * 0.5;
  const ku = Math.log(0.5) / Math.log(f.peak);
  const kd = Math.log(0.5) / Math.log(0.56);
  const up: Pt[] = [];
  const dn: Pt[] = [];
  const rest: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = xi + (xo - xi) * t;
    const base = yi + (yo - yi) * t;
    const bu = Math.pow(Math.sin(Math.PI * Math.pow(t, ku)), 0.72);
    const bd = Math.pow(Math.sin(Math.PI * Math.pow(t, kd)), 0.85);
    up.push([x, base + f.up * open * (1 - 0.1 * squint) * bu]);
    dn.push([x, base - f.down * Math.min(1, open) * (1 - 0.5 * squint) * bd]);
    rest.push([x, base + f.up * bu]);
  }
  return { up, dn, rest, inner: [xi, yi], outer: [xo, yo], cx, cy };
}

/** The crease: over the resting lid, tapering in at the corners and running a little past the outer one. */
function creasePts(e: EyeGeo, f: EyeForm, side: number, extra = 0): Pt[] {
  return e.rest.map(([x, y], i) => {
    const t = i / N;
    const k = Math.sin(Math.PI * (0.06 + t * 0.9));
    return [x + side * t * 1.8, y + (f.crease + extra) * (0.3 + 0.7 * k) - (1 - k) * 0.6];
  });
}

interface EyePaint {
  iris: number;
  lashes: boolean;
  makeup: Makeup;
  makeupColor: number;
  form: EyeForm;
}

/** The lid area between the lash line and the crease, tinted (make-up), fading towards the crease. */
function lidTint(g: CanvasRenderingContext2D, lower: Pt[], upper: Pt[], color: number, a0: number, a1: number): void {
  const y0 = Math.min(...lower.map((p) => p[1]));
  const y1 = Math.max(...upper.map((p) => p[1]));
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, rgba(color, a0));
  gr.addColorStop(1, rgba(color, a1));
  fill(g, gr, () => poly(g, [...lower, ...[...upper].reverse()]));
}

/** Lash line along the upper lid: heavier towards the outer corner, ending in a flick (or a wing). */
function lashLine(g: CanvasRenderingContext2D, pts: Pt[], outer: Pt, side: number, weight: number, wing: number, wingUp: number, color = INK): void {
  const top: Pt[] = pts.map(([x, y], i) => [x, y + (0.45 + 1.75 * Math.pow(i / N, 1.25)) * weight]);
  const bot: Pt[] = pts.map(([x, y]) => [x, y - 0.5]);
  g.fillStyle = rgba(color);
  g.beginPath();
  g.moveTo(bot[0][0], bot[0][1]);
  for (const p of bot) g.lineTo(p[0], p[1]);
  const tip: Pt = [outer[0] + side * wing, outer[1] + wingUp];
  g.quadraticCurveTo(outer[0] + side * wing * 0.55, outer[1] + wingUp * 0.25, tip[0], tip[1]);
  g.quadraticCurveTo(outer[0] + side * wing * 0.3, outer[1] + wingUp * 0.9, top[N][0], top[N][1]);
  for (let i = N; i >= 0; i--) g.lineTo(top[i][0], top[i][1]);
  g.closePath();
  g.fill();
}

/** The iris: a gradient with a dark limbal ring and fine fibres, the pupil, and the light catching it. */
function iris(g: CanvasRenderingContext2D, ix: number, iy: number, R: number, c: number): void {
  const gr = g.createRadialGradient(ix, iy - R * 0.12, 0, ix, iy, R);
  gr.addColorStop(0, rgba(mixHex(mixHex(c, 0xffffff, 0.3), 0xd9a441, 0.18)));
  gr.addColorStop(0.4, rgba(mixHex(c, 0xffffff, 0.16)));
  gr.addColorStop(0.72, rgba(c));
  gr.addColorStop(0.88, rgba(shadeHex(c, 0.55)));
  gr.addColorStop(1, rgba(shadeHex(c, 0.2)));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(ix, iy, R, 0, Math.PI * 2);
  g.fill();
  // Fibres: fine light and dark spokes.
  const r = rand(7);
  g.lineWidth = R * 0.07;
  g.lineCap = 'round';
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2 + r() * 0.15;
    g.strokeStyle = k % 2 ? rgba(mixHex(c, 0xffffff, 0.5), 0.2) : rgba(shadeHex(c, 0.5), 0.16);
    g.beginPath();
    g.moveTo(ix + Math.cos(a) * R * 0.42, iy + Math.sin(a) * R * 0.42);
    g.lineTo(ix + Math.cos(a) * R * (0.78 + r() * 0.1), iy + Math.sin(a) * R * (0.78 + r() * 0.1));
    g.stroke();
  }
  // Light passing through the lower iris, opposite the catch-light.
  blob(g, ix + R * 0.12, iy - R * 0.46, R * 0.58, R * 0.34, mixHex(c, 0xffffff, 0.55), 0.38);
  // The pupil.
  const pr = R * 0.4;
  const pg = g.createRadialGradient(ix, iy, 0, ix, iy, pr * 1.15);
  pg.addColorStop(0, 'rgba(6,4,4,1)');
  pg.addColorStop(0.82, 'rgba(10,7,6,1)');
  pg.addColorStop(1, 'rgba(10,7,6,0)');
  g.fillStyle = pg;
  g.beginPath();
  g.arc(ix, iy, pr * 1.15, 0, Math.PI * 2);
  g.fill();
}

function eye(g: CanvasRenderingContext2D, side: number, p: EyePaint, open: number, l: Look, wink = false): void {
  const f = p.form;
  const e = eyeGeo(side, f, Math.max(open, 0.001), l.squint);
  const crease = creasePts(e, f, side);
  const shut = open < 0.12;
  // The closed lid: relaxed (curving down) or a happy wink (curving up).
  const lid: Pt[] = shut
    ? e.up.map(([x], i) => {
        const t = i / N;
        const base = e.inner[1] + (e.outer[1] - e.inner[1]) * t;
        return [x, base + (wink ? 2.6 : -2.2) * Math.sin(Math.PI * t) + (wink ? 0 : 0.6)];
      })
    : e.up;
  // Shading round the eye: the socket by the nose, the lid under the crease, beneath the eye.
  blob(g, e.inner[0] + side * 1, e.inner[1] + 3, 7, 6, 0x5a2a20, 0.1);
  lidTint(g, lid, crease, 0x6a3024, 0.1, 0.02);
  blob(g, e.cx + side * 1, e.cy - f.down - 4.5, f.hw * 0.8, 3.2, 0x5a2a28, 0.07);
  // Eye make-up on the lid.
  if (p.makeup === 'smoky') {
    const up = creasePts(e, f, side, 2.2).map(([x, y], i): Pt => [x + side * Math.pow(i / N, 3) * 5, y + Math.pow(i / N, 3) * 1.5]);
    lidTint(g, lid, up, 0x231a22, 0.85, 0.15);
    softStroke(g, e.dn.slice(5).map(([x, y]): Pt => [x, y - 0.5]), 3.4, 0x231a22, 0.7);
  } else if (p.makeup === 'shadow') {
    const up = creasePts(e, f, side, 1.4).map(([x, y], i): Pt => [x + side * Math.pow(i / N, 3) * 3.5, y + Math.pow(i / N, 3) * 1]);
    lidTint(g, lid, up, p.makeupColor, 0.85, 0.2);
    blob(g, e.cx - side * 1, e.cy + f.up * 0.9, 6, 2.6, 0xffffff, shut ? 0.1 : 0.2);
    blob(g, e.inner[0] + side * 1.2, e.inner[1] + 1, 2.4, 2, 0xffffff, 0.35);
  }
  // The crease: a soft line, darker in the middle.
  if (f.hood) {
    // A heavy fold resting on the lid.
    lidTint(g, lid.map(([x, y]): Pt => [x, y + 0.4]), creasePts(e, f, side, 1.6), 0x5a2820, 0.3, 0.05);
  }
  const cg = g.createLinearGradient(e.inner[0], 0, e.outer[0] + side * 2, 0);
  cg.addColorStop(0, 'rgba(80,34,26,0)');
  cg.addColorStop(0.35, `rgba(80,34,26,${f.hood ? 0.42 : 0.36})`);
  cg.addColorStop(0.8, `rgba(80,34,26,${f.hood ? 0.36 : 0.3})`);
  cg.addColorStop(1, 'rgba(80,34,26,0)');
  g.strokeStyle = cg;
  g.lineWidth = f.hood ? 1.1 : 0.85;
  g.lineCap = 'round';
  poly(g, crease.slice(2), false);
  g.stroke();
  const weight = p.makeup === 'liner' ? 1.75 : p.lashes ? 1.25 : 1;
  const wing = p.makeup === 'liner' ? 8 : p.makeup === 'smoky' ? 4 : 2.4;
  const wingUp = p.makeup === 'liner' ? 5.4 : p.makeup === 'smoky' ? 2.6 : 2;
  if (shut) {
    // Lashes resting on the cheek, then the line of the closed lid.
    g.fillStyle = rgba(INK, 0.9);
    if (p.lashes) {
      for (let k = 0; k < 6; k++) {
        const t = 0.35 + k * 0.12;
        const i = Math.min(N, Math.round(t * N));
        hair(g, lid[i][0], lid[i][1], side * (0.4 + k * 0.12), wink ? 1 : -1, 2.4 + k * 0.3, 0.8, side * (wink ? -0.6 : 0.6));
      }
    }
    lashLine(g, lid, [e.outer[0], lid[N][1]], side, weight * 0.75, wing * 0.6, p.makeup === 'liner' ? 3 : wink ? 0.6 : -0.4);
    return;
  }
  // The eye itself.
  g.save();
  poly(g, [...e.up, ...[...e.dn].reverse()]);
  const wg = g.createRadialGradient(e.cx, e.cy + 1, 0, e.cx, e.cy, f.hw * 1.05);
  wg.addColorStop(0, '#fdfaf6');
  wg.addColorStop(0.6, '#f1ebe6');
  wg.addColorStop(1, '#c9bfbb');
  g.fillStyle = wg;
  g.fill();
  g.clip();
  const R = f.iris;
  const ix = e.cx + l.lookX * 3.5;
  const iy = e.cy + 0.6 + l.lookY;
  iris(g, ix, iy, R, p.iris);
  // The lid's shadow over the top of the eye, and the pink inner corner.
  softStroke(g, e.up, 6, 0x2a1414, 0.55);
  blob(g, e.inner[0] + side * 1.6, e.inner[1] + 0.2, 2.6, 2.2, 0xd88a86, 0.75);
  // Catch-lights: a big one to the upper left of both eyes and a small one opposite.
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(ix - R * 0.36, iy + R * 0.34, R * 0.24, R * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(ix + R * 0.34, iy - R * 0.36, R * 0.1, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Lower lid: a soft line (darker towards the outer corner) and a light rim under it.
  const lg = g.createLinearGradient(e.inner[0], 0, e.outer[0], 0);
  lg.addColorStop(0, 'rgba(110,52,44,0)');
  lg.addColorStop(0.35, 'rgba(110,52,44,0.45)');
  lg.addColorStop(1, 'rgba(70,30,26,0.7)');
  g.strokeStyle = lg;
  g.lineWidth = 0.8;
  poly(g, e.dn.slice(2), false);
  g.stroke();
  g.strokeStyle = 'rgba(255,236,226,0.14)';
  g.lineWidth = 0.7;
  poly(g, e.dn.slice(4, N - 1).map(([x, y]): Pt => [x, y - 0.9]), false);
  g.stroke();
  if (p.makeup === 'liner') {
    // A fine line under the outer half too.
    g.fillStyle = rgba(INK, 0.85);
    g.beginPath();
    const lo = e.dn.slice(N / 2);
    g.moveTo(lo[0][0], lo[0][1]);
    for (const [x, y] of lo) g.lineTo(x, y + 0.1);
    for (let i = lo.length - 1; i >= 0; i--) g.lineTo(lo[i][0], lo[i][1] - 0.25 - (i / lo.length) * 0.6);
    g.fill();
  }
  // Lashes, then the lash line over them.
  g.fillStyle = rgba(INK);
  if (p.lashes) {
    for (let k = 0; k < 6; k++) {
      const t = 0.34 + k * 0.12;
      const i = Math.min(N, Math.round(t * N));
      const [x, y] = e.up[i];
      const out = 0.25 + k * 0.22;
      hair(g, x, y + 1, side * out, 1, 2.6 + k * 0.45, 0.95, side * -0.9);
    }
    for (let k = 0; k < 3; k++) {
      const i = Math.round((0.66 + k * 0.13) * N);
      const [x, y] = e.dn[i];
      hair(g, x, y - 0.3, side * (0.4 + k * 0.3), -1, 1.2 + k * 0.3, 0.55, side * 0.3);
    }
  }
  lashLine(g, e.up, e.outer, side, weight, wing, wingUp);
}

// ------------------------------------------------------------------ brows

interface BrowForm {
  /** Arch height and where it peaks, thickness at the head, body and tail (mm), length, hairs. */
  arch: number;
  peak: number;
  head: number;
  body: number;
  tail: number;
  len: number;
  hairs: number;
  lift: number;
}

const BROW_FORMS: Record<Brows, BrowForm> = {
  soft: { arch: 3, peak: 0.6, head: 4.8, body: 4.3, tail: 1.2, len: 50, hairs: 170, lift: 0 },
  thick: { arch: 2.6, peak: 0.58, head: 7.2, body: 6.6, tail: 2.4, len: 52, hairs: 260, lift: 0 },
  thin: { arch: 3.4, peak: 0.6, head: 2.6, body: 2.3, tail: 0.7, len: 48, hairs: 100, lift: 0.6 },
  arched: { arch: 7.5, peak: 0.56, head: 4.2, body: 3.6, tail: 0.9, len: 49, hairs: 150, lift: 0 },
  straight: { arch: 0.7, peak: 0.7, head: 5, body: 4.6, tail: 1.8, len: 51, hairs: 180, lift: -0.6 },
};

function brow(g: CanvasRenderingContext2D, side: number, lift: number, tilt: number, kind: Brows, color: number): void {
  const f = BROW_FORMS[kind];
  const x0 = side * 13;
  const k = Math.log(0.5) / Math.log(f.peak);
  const at = (t: number): { x: number; y: number; th: number } => {
    const y = 1705 + f.lift + lift + f.arch * Math.sin(Math.PI * Math.pow(t, k)) - tilt * Math.pow(1 - t, 1.6) - t * 2;
    const th = t < 0.2 ? f.head * (0.8 + t) + (f.body - f.head) * (t / 0.2) : f.body + (f.tail - f.body) * Math.pow((t - 0.2) / 0.8, 1.4);
    return { x: x0 + side * f.len * t, y, th };
  };
  // The brow's shape, softer at the head, solid through the body; then hairs over it.
  const top: Pt[] = [];
  const bot: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const s = at(i / N);
    top.push([s.x, s.y + s.th * 0.55]);
    bot.push([s.x, s.y - s.th * 0.45]);
  }
  const base = g.createLinearGradient(x0, 0, x0 + side * f.len, 0);
  base.addColorStop(0, rgba(color, 0.35));
  base.addColorStop(0.18, rgba(color, 0.85));
  base.addColorStop(1, rgba(color, 0.8));
  fill(g, base, () => poly(g, [...top, ...bot.reverse()]));
  const r = rand(side > 0 ? 11 : 23);
  for (let i = 0; i < f.hairs; i++) {
    const t = Math.pow(r(), 0.9);
    const s = at(t);
    const u = r() - 0.5;
    const n = at(Math.min(1, t + 0.02));
    // Upright at the head, turning to lie along the brow (rising a little) by the tail.
    const along = Math.atan2(n.y - s.y, Math.abs(n.x - s.x));
    const turn = smooth(0.02, 0.35, t);
    const a = Math.PI / 2 - turn * (Math.PI / 2 - along - 0.32);
    const shade = r();
    g.fillStyle = rgba(shade < 0.45 ? shadeHex(color, 0.7) : shade < 0.8 ? color : mixHex(color, 0xffffff, 0.12), 0.5 + r() * 0.45);
    const len = (2.2 + r() * 1.8) * (0.75 + 0.25 * Math.min(1.4, s.th / 4));
    hair(g, s.x - side * Math.cos(a) * len * 0.5, s.y + u * s.th - Math.sin(a) * len * 0.45, side * Math.cos(a), Math.sin(a), len, 0.55, side * 0.25);
  }
}

// ------------------------------------------------------------------ mouth

interface MouthForm {
  w: number;
  /** The line between closed lips, or the top and bottom edges of an open mouth (mm above the mouth line, by x). */
  line?: (x: number) => number;
  top?: (x: number) => number;
  bot?: (x: number) => number;
  teeth?: 'top' | 'both' | 'clench';
}

function mouthForm(kind: Mouth): MouthForm {
  const u = (x: number, w: number) => Math.min(1, Math.abs(x) / w);
  switch (kind) {
    case 'smile':
      return { w: 26.5, line: (x) => 4.8 * Math.pow(u(x, 26.5), 2.3) - 0.8 };
    case 'sad':
      return { w: 22, line: (x) => -3.4 * Math.pow(u(x, 22), 1.8) + 0.5 };
    case 'smirk':
      return { w: 24.5, line: (x) => (x > 0 ? 5 * Math.pow(u(x, 24.5), 2.2) : 0.5 * Math.pow(u(x, 24.5), 2)) - 0.3 };
    case 'grin':
      return {
        w: 26.5,
        top: (x) => 1.4 + 3.4 * Math.pow(u(x, 26.5), 2.2),
        bot: (x) => 1.4 + 3.4 * Math.pow(u(x, 26.5), 2.2) - 11.5 * Math.pow(1 - u(x, 26.5) ** 2, 0.85),
        teeth: 'top',
      };
    case 'shout':
      return {
        w: 19.5,
        top: (x) => 2 + 2.8 * Math.pow(1 - u(x, 19.5) ** 2, 0.6),
        bot: (x) => 2 - 16 * Math.pow(1 - u(x, 19.5) ** 2, 0.62),
        teeth: 'top',
      };
    case 'o':
      return { w: 8, top: (x) => -1.2 + 7.2 * Math.sqrt(1 - u(x, 8) ** 2), bot: (x) => -1.2 - 8.2 * Math.sqrt(1 - u(x, 8) ** 2) };
    case 'grit':
      return { w: 22, top: (x) => 3.2 * Math.pow(1 - u(x, 22) ** 8, 0.3) - 0.2, bot: (x) => -3.8 * Math.pow(1 - u(x, 22) ** 8, 0.3) - 0.2, teeth: 'clench' };
    default:
      return { w: 24.5, line: (x) => 0.9 * Math.pow(u(x, 24.5), 2) - 0.2 };
  }
}

const LIP_COLORS: Record<Lips, number> = {
  natural: 0xa8504a,
  nude: 0xc98272,
  pink: 0xe8679a,
  red: 0xc8202f,
  plum: 0x7a2a5a,
  black: 0x262026,
};
const LIP_SIZE: Record<LipShape, number> = { thin: 0.7, medium: 1, full: 1.35 };

/** The upper lip's height across it (0..1): a cupid's bow in the middle, thinning to the corners. */
function upperLip(u: number): number {
  return Math.pow(1 - u * u, 0.55) * (1 - 0.26 * Math.exp(-((u / 0.11) ** 2)) + 0.12 * Math.exp(-(((u - 0.28) / 0.13) ** 2)));
}
function lowerLip(u: number): number {
  return Math.pow(1 - u * u, 0.7) * (1 + 0.05 * Math.exp(-((u / 0.3) ** 2)));
}

/** The shape of the lips round the mouth, for the stubble to stay clear of. */
function mouthOutline(kind: Mouth, size: LipShape): Pt[] {
  const m = mouthForm(kind);
  const F = LIP_SIZE[size];
  const w = m.w + 2;
  const top: Pt[] = [];
  const bot: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const x = -w + (2 * w * i) / N;
    const u = Math.min(1, Math.abs(x) / m.w);
    const hi = m.line ? m.line(x) + 5.2 * F * upperLip(u) : m.top!(x) + 4.2 * F * upperLip(u);
    const lo = m.line ? m.line(x) - 6.8 * F * lowerLip(u) : m.bot!(x) - 5 * F * lowerLip(u);
    top.push([x, MOUTH_Y + hi + 1.6]);
    bot.push([x, MOUTH_Y + lo - 1.8]);
  }
  return [...top, ...bot.reverse()];
}

function mouth(g: CanvasRenderingContext2D, kind: Mouth, lips: Lips, size: LipShape): void {
  const m = mouthForm(kind);
  const y = MOUTH_Y;
  const F = LIP_SIZE[size];
  const w = m.w * (size === 'full' ? 1.04 : size === 'thin' ? 0.97 : 1);
  const painted = lips !== 'natural';
  const lipC = LIP_COLORS[lips];
  const xs = (k: number) => -w + (2 * w * k) / N;
  const uOf = (x: number) => Math.min(1, Math.abs(x) / w);
  const sc = (f: (x: number) => number) => (x: number) => f((x * m.w) / w);
  const upA = painted ? 0.94 : 0.58;
  const loA = painted ? 0.92 : 0.48;
  const upC = painted ? lipC : 0x8a3434;
  const loC = painted ? lipC : 0xa8504a;
  const lineC = painted ? shadeHex(lipC, 0.45) : 0x3c1612;
  if (m.line) {
    const line = sc(m.line);
    const uh = 5.2 * F;
    const lh = 6.8 * F;
    // Shadow under the lower lip.
    blob(g, 0, y + line(0) - lh - 1.8, w * 0.55, 2.6, 0x5a281e, 0.16);
    // Upper lip, and a light line along its border.
    const lineP: Pt[] = [];
    const upP: Pt[] = [];
    const loP: Pt[] = [];
    for (let k = 0; k <= N; k++) {
      const x = xs(k);
      const u = uOf(x);
      lineP.push([x, y + line(x)]);
      upP.push([x, y + line(x) + uh * upperLip(u)]);
      loP.push([x, y + line(x) - lh * lowerLip(u)]);
    }
    g.strokeStyle = 'rgba(255,238,228,0.16)';
    g.lineWidth = 0.8;
    poly(g, upP.slice(3, N - 2).map(([x, yy]): Pt => [x, yy + 0.6]), false);
    g.stroke();
    fill(g, rgba(upC, upA), () => poly(g, [...lineP, ...[...upP].reverse()]));
    fill(g, rgba(loC, loA), () => poly(g, [...lineP, ...[...loP].reverse()]));
    // Gloss on the lower lip.
    blob(g, w * 0.08, y + line(0) - lh * 0.45, w * 0.32, lh * 0.22, 0xffffff, painted ? 0.32 : 0.14);
    if (painted) blob(g, -w * 0.25, y + line(-w * 0.25) + uh * 0.5, w * 0.12, uh * 0.15, 0xffffff, 0.18);
    // The line between the lips, finest at the corners, and the corners themselves.
    g.fillStyle = rgba(lineC, painted ? 0.9 : 0.85);
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const x = xs(k);
      const t = 0.25 + 0.75 * Math.pow(1 - uOf(x) ** 2, 0.5);
      if (k === 0) g.moveTo(x, y + line(x) + 0.55 * t);
      else g.lineTo(x, y + line(x) + 0.55 * t);
    }
    for (let k = N; k >= 0; k--) {
      const x = xs(k);
      const t = 0.25 + 0.75 * Math.pow(1 - uOf(x) ** 2, 0.5);
      g.lineTo(x, y + line(x) - 0.55 * t);
    }
    g.fill();
    const up = kind === 'smile' || kind === 'smirk';
    g.strokeStyle = 'rgba(70,28,22,0.4)';
    g.lineWidth = 0.6;
    for (const s of [-1, 1]) {
      if (kind === 'smirk' && s < 0) continue;
      const cx = s * (w + 0.4);
      const cy = y + line(s * w);
      g.beginPath();
      g.moveTo(cx - s * 1.2, cy + (up ? -0.4 : 0.2));
      g.quadraticCurveTo(cx + s * 0.8, cy + (up ? 0.4 : 0), cx + s * 0.6, cy + (up ? 2.2 : -1.6));
      g.stroke();
    }
    return;
  }
  // Open: the inside, teeth and tongue, then the lips round it.
  const top = sc(m.top!);
  const bot = sc(m.bot!);
  const topP: Pt[] = [];
  const botP: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const x = xs(k);
    topP.push([x, y + top(x)]);
    botP.push([x, y + bot(x)]);
  }
  const yb = Math.min(...botP.map((p) => p[1]));
  blob(g, 0, yb - 4.5 * F - 1.8, w * 0.6, 2.8, 0x5a281e, 0.16);
  g.save();
  poly(g, [...topP, ...[...botP].reverse()]);
  const ig = g.createLinearGradient(0, y + top(0), 0, yb);
  ig.addColorStop(0, '#2a0b0b');
  ig.addColorStop(1, '#5a1b1a');
  g.fillStyle = ig;
  g.fill();
  g.clip();
  if (kind !== 'o' && kind !== 'grit') blob(g, 0, yb + 1.2, w * 0.62, 4.2, 0xc04a50, 0.95);
  const toothC = '#f7f3ee';
  if (m.teeth) {
    const th = m.teeth === 'clench' ? 6 : kind === 'shout' ? 3.8 : 3.4;
    g.fillStyle = toothC;
    g.beginPath();
    for (let k = 0; k <= N; k++) {
      const x = xs(k);
      const yy = y + top(x) + 0.8;
      if (k === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    for (let k = N; k >= 0; k--) {
      const x = xs(k);
      g.lineTo(x, y + top(x) - th * (0.75 + 0.25 * Math.pow(1 - uOf(x) ** 2, 0.4)));
    }
    g.fill();
    if (m.teeth === 'clench') {
      g.strokeStyle = 'rgba(80,50,50,0.5)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(-w, y - 0.4);
      g.quadraticCurveTo(0, y - 0.9, w, y - 0.4);
      g.stroke();
    }
    // A hint of the gaps between teeth, and shade towards the corners.
    g.strokeStyle = 'rgba(120,90,90,0.18)';
    g.lineWidth = 0.35;
    for (const x of [-7.5, -3.6, 0, 3.6, 7.5]) {
      g.beginPath();
      g.moveTo(x, y + top(x));
      g.lineTo(x, y + top(x) - th);
      g.stroke();
    }
    const sg = g.createLinearGradient(-w, 0, w, 0);
    sg.addColorStop(0, 'rgba(60,20,20,0.55)');
    sg.addColorStop(0.25, 'rgba(60,20,20,0)');
    sg.addColorStop(0.75, 'rgba(60,20,20,0)');
    sg.addColorStop(1, 'rgba(60,20,20,0.55)');
    g.fillStyle = sg;
    g.fillRect(-w, yb - 2, w * 2, y + top(0) - yb + 6);
  }
  g.restore();
  // Lips round the opening (stretched thinner).
  const uh = 4.2 * F;
  const lh = 5 * F;
  const upP: Pt[] = topP.map(([x, yy]): Pt => [x, yy + uh * upperLip(uOf(x))]);
  const loP: Pt[] = botP.map(([x, yy]): Pt => [x, yy - lh * lowerLip(uOf(x))]);
  fill(g, rgba(upC, upA), () => poly(g, [...topP, ...[...upP].reverse()]));
  fill(g, rgba(loC, loA), () => poly(g, [...botP, ...[...loP].reverse()]));
  blob(g, w * 0.06, yb - lh * 0.45, w * 0.3, lh * 0.2, 0xffffff, painted ? 0.3 : 0.12);
  g.strokeStyle = rgba(lineC, 0.7);
  g.lineWidth = 0.6;
  poly(g, [...topP, ...[...botP].reverse()]);
  g.stroke();
}

// ------------------------------------------------------------------ skin, nose, marks

/** The skin's shading (cheeks, nose, chin): see-through tints that suit any skin tone. */
function skinShade(g: CanvasRenderingContext2D, blush: boolean): void {
  for (const s of [-1, 1]) blob(g, s * 50, 1637, 18, 12, 0xe0645e, blush ? 0.34 : 0.13);
  // Nose: soft sides, the tip catching the light, the shadow under it, the nostrils.
  for (const s of [-1, 1]) blob(g, s * 10, 1647, 8, 15, 0x6a2e22, 0.035);
  blob(g, 0.4, 1640, 4.2, 4, 0xfff0e0, 0.08);
  blob(g, 0, 1629.5, 11, 4.2, 0x5a2618, 0.22);
  for (const s of [-1, 1]) {
    blob(g, s * 5.4, 1631.6, 2.4, 1.4, 0x3a1410, 0.5, s * -0.35);
    softLine(g, [[s * 9.4, 1637], [s * 11, 1633.5], [s * 10.2, 1630.6], [s * 8.4, 1629.4]], 0.7, 0x642c22, 0.08);
  }
  // Under the lower lip.
  blob(g, 0, 1581, 9, 2.6, 0x5a281e, 0.05);
}

/** A soft line: spots run along a polyline. */
function softLine(g: CanvasRenderingContext2D, pts: Pt[], w: number, color: number, a: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (w * 0.6)));
    for (let k = 0; k < n; k++) blob(g, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, w, w, color, a);
  }
}

/** Smile lines: short soft creases curving round the corners of the mouth. */
function folds(g: CanvasRenderingContext2D, kind: Mouth): void {
  const k = kind === 'smile' || kind === 'grin' ? 0.16 : kind === 'shout' || kind === 'grit' ? 0.1 : kind === 'smirk' ? 0.1 : 0;
  if (!k) return;
  const w = mouthForm(kind).w;
  for (const s of [-1, 1]) {
    if (kind === 'smirk' && s < 0) continue;
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = -0.9 + (i / 8) * 1.7;
      pts.push([s * (w + 1 + Math.cos(a) * 4.5), MOUTH_Y + 4 + Math.sin(a) * 7]);
    }
    softLine(g, pts, 1.6, 0x642c22, k * 0.35);
  }
}

/** Natural freckles: lots of small irregular spots over the nose and cheeks, densest across the middle. */
function freckles(g: CanvasRenderingContext2D): void {
  const r = rand(5);
  const placed: Pt[] = [];
  for (let i = 0; i < 1400 && placed.length < 150; i++) {
    const x = (r() - 0.5) * 120;
    const y = 1626 + r() * 42;
    const ax = Math.abs(x);
    // A band from cheek to cheek over the bridge of the nose, thinning out at the edges.
    const band = Math.exp(-(((y - 1650 + ax * 0.06) / 10) ** 2));
    const across = ax < 12 ? 0.75 : Math.exp(-(((ax - 30) / 22) ** 2));
    if (r() > band * across) continue;
    if (ax > 18 && y > 1663 - (ax - 18) * 0.08) continue;
    if (placed.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < 2.6)) continue;
    placed.push([x, y]);
    const s = 0.45 + r() * r() * 1.1;
    const c = mixHex(0x9a5a34, 0x6a3418, r());
    g.fillStyle = rgba(c, 0.2 + r() * 0.3);
    g.beginPath();
    g.ellipse(x, y, s, s * (0.75 + r() * 0.35), r() * Math.PI, 0, Math.PI * 2);
    g.fill();
    if (r() < 0.3) {
      g.beginPath();
      g.ellipse(x + (r() - 0.5) * s, y + (r() - 0.5) * s, s * 0.6, s * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/**
 * A stroke of paint with a dry-brush finish: a band through `pts` (half-width by t), tapered
 * at the ends, with streaks dragged along it. Drawn on its own canvas so the streaks only
 * take paint away.
 */
function brush(g: CanvasRenderingContext2D, pts: Pt[], width: (t: number) => number, color: number, seed: number): void {
  const t0 = g.getTransform();
  const cv = document.createElement('canvas');
  cv.width = g.canvas.width;
  cv.height = g.canvas.height;
  const b = cv.getContext('2d', CPU)!;
  b.setTransform(t0);
  const r = rand(seed);
  const n = pts.length - 1;
  const side = (k: number, s: number): Pt => {
    const a = pts[Math.max(0, k - 1)];
    const c = pts[Math.min(n, k + 1)];
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const w = width(k / n) * (0.92 + r() * 0.16);
    return [pts[k][0] - (dy / l) * w * s, pts[k][1] + (dx / l) * w * s];
  };
  const up = pts.map((_, k) => side(k, 1));
  const dn = pts.map((_, k) => side(k, -1));
  b.fillStyle = rgba(color, 0.9);
  poly(b, [...up, ...dn.reverse()]);
  b.fill();
  b.globalCompositeOperation = 'destination-out';
  b.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const k0 = Math.floor(r() * n * 0.6);
    const k1 = Math.min(n, k0 + 2 + Math.floor(r() * n * 0.5));
    const off = (r() - 0.5) * 1.8;
    b.strokeStyle = `rgba(0,0,0,${0.25 + r() * 0.5})`;
    b.lineWidth = 0.3 + r() * 0.5;
    b.beginPath();
    for (let k = k0; k <= k1; k++) {
      const a = pts[Math.max(0, k - 1)];
      const c = pts[Math.min(n, k + 1)];
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const w = width(k / n) * off;
      const x = pts[k][0] - (dy / l) * w;
      const y = pts[k][1] + (dx / l) * w;
      if (k === k0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    b.stroke();
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cv, 0, 0);
  g.restore();
}

/** A tapered brush stroke's width: full in the middle, fading to a point at the ends. */
const taper = (w: number, a = 0.18, b = 0.25) => (t: number) => w * Math.min(1, t / a, (1 - t) / b) ** 0.6;
function line(x0: number, y0: number, x1: number, y1: number, n = 14): Pt[] {
  return Array.from({ length: n + 1 }, (_, i): Pt => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
}

/** Marks under the features: freckles, blush and war paint. */
function marksUnder(g: CanvasRenderingContext2D, kind: Marks, paint: number): void {
  switch (kind) {
    case 'freckles':
      freckles(g);
      break;
    case 'warpaint':
      // Two stripes under each eye.
      for (const s of [-1, 1]) {
        brush(g, line(s * 26, 1653, s * 66, 1656), taper(2.6), paint, s > 0 ? 3 : 4);
        brush(g, line(s * 28, 1641, s * 64, 1643), taper(2.4), paint, s > 0 ? 5 : 6);
      }
      break;
    case 'warband':
      // A band across both eyes, temple to temple.
      brush(g, Array.from({ length: 25 }, (_, i): Pt => {
        const x = -76 + i * (152 / 24);
        return [x, 1676 + 0.0016 * x * x - 1];
      }), (t) => 11 * Math.min(1, t / 0.06, (1 - t) / 0.06) ** 0.4, paint, 9);
      break;
    case 'claws':
      // Three claw marks down one cheek.
      for (let i = 0; i < 3; i++) brush(g, line(-30 - i * 9, 1668 - i * 2, -42 - i * 9, 1618 - i * 3), taper(1.9, 0.12, 0.45), paint, 12 + i);
      break;
    default:
  }
}

/** Marks over the features: a scar through the brow, a beauty mark, a star. */
function marksOver(g: CanvasRenderingContext2D, kind: Marks): void {
  switch (kind) {
    case 'scar': {
      // Through the brow and on down the cheek, with the stitch marks either side.
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(214,150,140,0.95)';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(-47, 1724);
      g.quadraticCurveTo(-40, 1695, -36.5, 1690);
      g.stroke();
      g.beginPath();
      g.moveTo(-34, 1663);
      g.quadraticCurveTo(-30, 1648, -27, 1640);
      g.stroke();
      g.strokeStyle = 'rgba(255,230,220,0.45)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(-46.4, 1723);
      g.quadraticCurveTo(-39.6, 1695, -36.2, 1690.5);
      g.stroke();
      g.strokeStyle = 'rgba(150,80,74,0.7)';
      g.lineWidth = 0.7;
      for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const x = -47 + 9.5 * t;
        const y = 1724 - 33 * t;
        g.beginPath();
        g.moveTo(x - 2.4, y - 0.6);
        g.lineTo(x + 2.4, y + 0.6);
        g.stroke();
      }
      break;
    }
    case 'beauty':
      blob(g, 27, 1611, 1.9, 1.9, 0x2a1612, 0.95);
      break;
    case 'star': {
      g.save();
      g.translate(44, 1647);
      g.rotate(0.2);
      const path = () => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? 4.4 : 10;
          g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        g.closePath();
      };
      const sg = g.createLinearGradient(0, 10, 0, -10);
      sg.addColorStop(0, '#fff09a');
      sg.addColorStop(1, '#f2b81c');
      path();
      g.fillStyle = sg;
      g.fill();
      g.strokeStyle = '#a8740a';
      g.lineWidth = 0.8;
      g.lineJoin = 'round';
      g.stroke();
      blob(g, -2, 3.5, 3, 2, 0xffffff, 0.5);
      g.restore();
      break;
    }
    default:
  }
}

// ------------------------------------------------------------------ facial hair (painted)

/** The front face's jaw line: how low the face comes at a distance from the middle (mm). */
function jawY(ax: number): number {
  return 1537 + 0.0034 * ax * ax + (ax > 60 ? (ax - 60) ** 2 * 0.06 : 0);
}
/** Where a full beard stops on the cheek. */
function cheekY(ax: number): number {
  if (ax < 24) return 1624 - ax * 0.05;
  if (ax < 34) return 1623 - (ax - 24) * 1.1;
  return 1612 + (ax - 34) * 0.62 + Math.max(0, ax - 55) * 0.35;
}

/** How thickly a style of facial hair grows at a point of the face (0..1), with soft edges. */
export function beardMask(kind: Beard, x: number, y: number): number {
  if (kind === 'none') return 0;
  const ax = Math.abs(x);
  const jaw = jawY(ax);
  const lips = Math.max(0, 1 - ((x / 27.5) ** 2 + ((y - MOUTH_Y + 0.5) / 10) ** 2));
  const clearLips = 1 - smooth(0, 0.25, lips);
  const below = (top: number, soft: number) => smooth(top + soft * 0.4, top - soft, y);
  const moustache = () => {
    const top = 1624.5 - 0.004 * x * x;
    const bottom = 1602 - Math.max(0, ax - 19) * 0.9;
    return smooth(34, 29, ax) * below(top, 2.4) * smooth(bottom - 1, bottom + 1.5, y);
  };
  switch (kind) {
    case 'moustache':
      return moustache() * clearLips;
    case 'goatee': {
      const chin = smooth(23, 18, ax + Math.max(0, 1588 - y) * 0.12) * smooth(jaw - 4, jaw + 1, y) * below(1590, 2);
      const sides = smooth(33, 28, ax) * smooth(20, 23, ax) * below(1604, 3) * smooth(1578, 1584, y);
      return Math.max(moustache(), chin, sides) * clearLips;
    }
    case 'chinstrap': {
      const band = smooth(jaw - 5, jaw + 0.5, y) * below(jaw + 10 + Math.max(0, ax - 50) * 0.5, 2.5);
      return band * smooth(100, 86, ax + Math.max(0, y - 1650) * 2);
    }
    default: {
      // Full, short and stubble: up the jaw to the sideburns, round the mouth.
      const m = below(cheekY(ax), kind === 'stubble' ? 8 : 4) * smooth(jaw - 6, jaw + 1, y) * clearLips;
      return m * (0.7 + 0.3 * smooth(1640, 1575, y)) * smooth(97, 80, ax);
    }
  }
}

/** Fill a canvas box per pixel (the stubble's speckle needs no paths). */
function pixels(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, win: Win, fn: (x: number, y: number, h: number) => [number, number]): void {
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let j = 0; j < h; j++) {
    const y = win.y1 - ((j + 0.5) / h) * (win.y1 - win.y0);
    for (let i = 0; i < w; i++) {
      const x = win.x0 + ((i + 0.5) / w) * (win.x1 - win.x0);
      // A hash per pixel, for the speckle.
      let s = (i * 374761393 + j * 668265263) ^ 0x5bd1e995;
      s = Math.imul(s ^ (s >>> 13), 1274126177);
      const [c, a] = fn(x, y, ((s ^ (s >>> 16)) >>> 0) / 4294967296);
      if (a <= 0) continue;
      const k = (j * w + i) * 4;
      const ia = d[k + 3] / 255;
      const oa = a + ia * (1 - a);
      const [r, gg, b] = rgb(c);
      d[k] = (r * a + d[k] * ia * (1 - a)) / oa;
      d[k + 1] = (gg * a + d[k + 1] * ia * (1 - a)) / oa;
      d[k + 2] = (b * a + d[k + 2] * ia * (1 - a)) / oa;
      d[k + 3] = oa * 255;
    }
  }
  g.putImageData(img, x0, y0);
}

/**
 * Stubble (or the shadow round modelled facial hair): a tint where it grows and a speckle of
 * short hairs, thickest on the chin and jaw, fading out at the edges.
 */
function stubble(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, win: Win, kind: Beard, color: number): void {
  const modelled = kind !== 'stubble';
  const dark = shadeHex(color, 0.8);
  pixels(g, x0, y0, w, h, win, (x, y, n) => {
    const m = beardMask(modelled ? kind : 'stubble', x, y);
    if (m <= 0.01) return [0, 0];
    const dot = n < 0.12 + 0.3 * m ? 0.4 + n : 0;
    return [dark, m * (modelled ? 0.3 : 0.2) + dot * m * (modelled ? 0.3 : 0.26)];
  });
}

/** Smooth value noise (0..1). */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = x - xi;
  const v = y - yi;
  const h = (a: number, b: number) => {
    let s = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    s = Math.imul(s ^ (s >>> 13), 1274126177);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * su;
  const b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * su;
  return a + (b - a) * sv;
}

/** Painted facial hair for the option thumbnails: the modelled styles' shape with a strand texture. */
function paintedBeard(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, win: Win, kind: Beard, color: number): void {
  const dark = shadeHex(color, 0.62);
  const light = mixHex(color, 0xffffff, 0.14);
  pixels(g, x0, y0, w, h, win, (x, y) => {
    const m = beardMask(kind, x, y);
    if (m <= 0.02) return [0, 0];
    // Strands hang down: noise stretched along y, a little wavy.
    const sx = x + Math.sin(y * 0.12) * 1.5;
    const strand = vnoise(sx * 0.9, y * 0.08) * 0.65 + vnoise(sx * 2.2, y * 0.2 + 7) * 0.35;
    return [mixHex(dark, light, Math.min(1, strand * 1.2) * (0.5 + 0.5 * m)), Math.min(1, m * 1.8)];
  });
}

// ------------------------------------------------------------------ the whole face

interface FacePaint {
  style: FaceStyle;
  custom: boolean;
  /** Brow and facial-hair colours. */
  brow: number;
  hair: number;
  iris: number;
}

/** The parts that don't change with the expression, drawn once per atlas. */
interface Layers {
  under: HTMLCanvasElement;
  hair: HTMLCanvasElement | null;
}

function layers(p: FacePaint, w: number, h: number, win: Win): Layers {
  const st = p.style;
  const under = document.createElement('canvas');
  under.width = w;
  under.height = h;
  const g = under.getContext('2d', CPU)!;
  toMm(g, 0, 0, w, h, win);
  skinShade(g, st.marks === 'blush');
  marksUnder(g, st.marks, st.paintColor);
  let hair: HTMLCanvasElement | null = null;
  if (st.beard !== 'none') {
    hair = document.createElement('canvas');
    hair.width = w;
    hair.height = h;
    stubble(hair.getContext('2d', CPU)!, 0, 0, w, h, win, st.beard, p.hair);
  }
  return { under, hair };
}

function drawFace(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, e: Expression, p: FacePaint, ly: Layers, win: Win = PATCH): void {
  const l = look(e);
  const st = p.style;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(ly.under, x, y);
  toMm(g, x, y, w, h, win);
  if (ly.hair) {
    // The stubble stays off the lips.
    g.save();
    g.beginPath();
    g.rect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);
    const lips = mouthOutline(l.mouth, st.lipShape);
    g.moveTo(lips[0][0], lips[0][1]);
    for (const q of lips) g.lineTo(q[0], q[1]);
    g.closePath();
    g.clip('evenodd');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(ly.hair, x, y);
    g.restore();
  }
  toMm(g, x, y, w, h, win);
  folds(g, l.mouth);
  const ep: EyePaint = { iris: p.iris, lashes: st.lashes, makeup: st.makeup, makeupColor: st.makeupColor, form: EYE_FORMS[st.eyeShape] };
  eye(g, 1, ep, l.open * l.leftOpen, l, l.leftOpen === 0);
  eye(g, -1, ep, l.open, l);
  brow(g, 1, l.browY + l.browL, l.browTilt, st.brows, p.brow);
  brow(g, -1, l.browY, l.browTilt, st.brows, p.brow);
  marksOver(g, st.marks);
  mouth(g, l.mouth, st.lips, st.lipShape);
  g.restore();
}

// ------------------------------------------------------------------ atlases

const atlases = new Map<string, THREE.Texture>();
/** Custom atlases kept for re-use beyond the ones being worn (the wardrobe makes one per change). */
const KEEP_CUSTOM = 10;

/** Brow colour from the hair: a little darker, so blonde and white brows still read. */
function browColor(hair: number): number {
  return mixHex(hair, 0x1b1210, 0.3);
}

function facePaint(eyeColor: string, style: FaceStyle | undefined, hairColor: number): FacePaint {
  const iris = cssHex(EYE_COLORS[eyeColor] ?? EYE_COLORS.brown);
  if (!style) return { style: DEFAULT_FACE, custom: false, brow: BROW, hair: BROW, iris };
  return { style: { ...DEFAULT_FACE, ...style }, custom: true, brow: browColor(hairColor), hair: mixHex(hairColor, 0x1b1210, 0.12), iris };
}

/**
 * Lower the faces' resolution (the low graphics preset) or restore it. Faces made from now on
 * use it; the ones already out keep theirs.
 */
export function setFaceDetail(low: boolean): void {
  const w = low ? 192 : 256;
  if (w === CW) return;
  CW = w;
  CH = Math.round(w * 1.25);
  atlases.clear();
}

/**
 * The expression atlas for an eye colour, and for a custom face its style and hair colour
 * (brows and facial hair take the hair's colour). Custom atlases beyond a few are let go
 * oldest first; the faces already wearing one keep it.
 */
export function faceAtlas(eyeColor: string, style?: FaceStyle, hairColor = 0x3a2416): THREE.Texture {
  const p = facePaint(eyeColor, style, hairColor);
  const key = style ? `${eyeColor}|${JSON.stringify(p.style)}|${hairColor}` : eyeColor;
  const hit = atlases.get(key);
  if (hit) {
    atlases.delete(key);
    atlases.set(key, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = COLS * CW;
  c.height = ROWS * CH;
  const g = c.getContext('2d', CPU)!;
  const ly = layers(p, CW, CH, PATCH);
  EXPRESSIONS.forEach((e, i) => drawFace(g, (i % COLS) * CW, Math.floor(i / COLS) * CH, CW, CH, e, p, ly));
  // The see-through pixels take a skin-like colour (a canvas leaves them black), so the soft
  // edges and the smaller mipmaps of faraway faces don't darken.
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) continue;
    d[i] = 168;
    d[i + 1] = 118;
    d[i + 2] = 96;
  }
  const t = new THREE.Texture(img);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(1 / COLS, 1 / ROWS);
  if (style) {
    const custom = [...atlases.keys()].filter((k) => k.includes('|'));
    if (custom.length >= KEEP_CUSTOM) atlases.delete(custom[0]);
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

// ------------------------------------------------------------------ previews for the editor

export type FacePart = 'eyeShape' | 'makeup' | 'lashes' | 'brows' | 'lips' | 'lipShape' | 'beard' | 'marks';

/** What each kind of preview shows of the face (mm). */
const THUMB_WIN: Record<FacePart, Win> = {
  eyeShape: { x0: -66, x1: -6, y0: 1652, y1: 1718 },
  makeup: { x0: -66, x1: -6, y0: 1652, y1: 1718 },
  lashes: { x0: -66, x1: -6, y0: 1652, y1: 1718 },
  brows: { x0: -66, x1: -6, y0: 1652, y1: 1718 },
  lips: { x0: -30, x1: 30, y0: 1572, y1: 1618 },
  lipShape: { x0: -30, x1: 30, y0: 1572, y1: 1618 },
  beard: { x0: -96, x1: 96, y0: 1528, y1: 1700 },
  marks: { x0: -88, x1: 88, y0: 1600, y1: 1740 },
};

/**
 * A small painted preview of one face option on the wearer's own skin, eyes and hair (for the
 * editor's option chips): the eye for eye shapes and make-up, the mouth for lips, the lower
 * face for facial hair, the upper face for marks.
 */
export function faceThumb(part: FacePart, style: FaceStyle, skin: number, eyeColor: string, hairColor: number, w = 72, h = 54): HTMLCanvasElement {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  const pw = Math.round(w * ratio);
  const ph = Math.round(h * ratio);
  c.width = pw;
  c.height = ph;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext('2d', CPU)!;
  const win0 = THUMB_WIN[part];
  // Keep the face's proportions: widen the window to the thumbnail's shape.
  const cxw = (win0.x0 + win0.x1) / 2;
  const cyw = (win0.y0 + win0.y1) / 2;
  const hh = (win0.y1 - win0.y0) / 2;
  const hw = Math.max((win0.x1 - win0.x0) / 2, hh * (w / h));
  const hv = hw * (h / w);
  const win: Win = { x0: cxw - hw, x1: cxw + hw, y0: cyw - hv, y1: cyw + hv };
  toMm(g, 0, 0, pw, ph, win);
  // The skin, lit from above like the head (a rounded face for the wider views).
  const lit = mixHex(skin, 0xffffff, 0.12);
  const dim = shadeHex(skin, 0.78);
  if (part === 'beard' || part === 'marks') {
    g.fillStyle = '#1d2433';
    g.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);
    const sg = g.createRadialGradient(-10, 1700, 10, 0, 1650, 140);
    sg.addColorStop(0, rgba(lit));
    sg.addColorStop(1, rgba(dim));
    g.fillStyle = sg;
    g.beginPath();
    g.ellipse(0, 1662, 96, 128, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    const sg = g.createLinearGradient(0, win.y1, 0, win.y0);
    sg.addColorStop(0, rgba(lit));
    sg.addColorStop(1, rgba(dim));
    g.fillStyle = sg;
    g.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);
  }
  const p = facePaint(eyeColor, style, hairColor);
  const st = p.style;
  const ly = layers({ ...p, style: { ...st, beard: part === 'beard' && st.beard !== 'stubble' ? 'none' : st.beard } }, pw, ph, win);
  drawFace(g, 0, 0, pw, ph, part === 'lips' || part === 'lipShape' ? 'happy' : 'neutral', p, ly, win);
  if (part === 'beard' && st.beard !== 'none' && st.beard !== 'stubble') {
    g.setTransform(1, 0, 0, 1, 0, 0);
    paintedBeard(g, 0, 0, pw, ph, win, st.beard, p.hair);
  }
  return c;
}
