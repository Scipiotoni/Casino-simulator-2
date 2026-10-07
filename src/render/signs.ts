import * as THREE from 'three';

/** Canvas-drawn text for signs, plaques, shields and in-world displays. */

export interface LabelOpts {
  width?: number;
  height?: number;
  font?: string;
  size?: number;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  bg?: string | null;
  /** Neon glow around the letters. */
  glow?: string;
  /** Draw an interstate-style shield behind the text. */
  shield?: boolean;
  radius?: number;
  border?: string;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Fit text to a width by shrinking the font. */
export function fitFont(g: CanvasRenderingContext2D, text: string, family: string, size: number, maxW: number): number {
  let s = size;
  g.font = `${s}px "${family}"`;
  while (g.measureText(text).width > maxW && s > 8) {
    s -= 2;
    g.font = `${s}px "${family}"`;
  }
  return s;
}

export function drawLabel(g: CanvasRenderingContext2D, text: string, o: LabelOpts, W: number, H: number): void {
  const family = o.font ?? 'Lilita One';
  if (o.shield) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W * 0.08, H * 0.12);
    g.quadraticCurveTo(W * 0.5, H * 0.02, W * 0.92, H * 0.12);
    g.quadraticCurveTo(W * 0.98, H * 0.62, W * 0.5, H * 0.98);
    g.quadraticCurveTo(W * 0.02, H * 0.62, W * 0.08, H * 0.12);
    g.fill();
    g.fillStyle = o.bg ?? '#1d3f9e';
    g.beginPath();
    g.moveTo(W * 0.14, H * 0.32);
    g.lineTo(W * 0.86, H * 0.32);
    g.quadraticCurveTo(W * 0.9, H * 0.62, W * 0.5, H * 0.9);
    g.quadraticCurveTo(W * 0.1, H * 0.62, W * 0.14, H * 0.32);
    g.fill();
    g.fillStyle = o.stroke ?? '#c8202f';
    g.beginPath();
    g.moveTo(W * 0.12, H * 0.16);
    g.quadraticCurveTo(W * 0.5, H * 0.07, W * 0.88, H * 0.16);
    g.lineTo(W * 0.87, H * 0.29);
    g.lineTo(W * 0.13, H * 0.29);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.font = `${Math.round(H * 0.11)}px "${family}"`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('INTERSTATE', W / 2, H * 0.225);
    g.font = `${o.size ?? 110}px "${family}"`;
    g.fillStyle = o.color ?? '#fff';
    g.fillText(text.replace('I-', ''), W / 2, H * 0.6);
    return;
  }
  if (o.bg) {
    g.fillStyle = o.bg;
    roundRect(g, 0, 0, W, H, o.radius ?? 0);
    g.fill();
  }
  if (o.border) {
    g.strokeStyle = o.border;
    g.lineWidth = Math.max(4, H * 0.05);
    roundRect(g, g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth, o.radius ?? 0);
    g.stroke();
  }
  const lines = text.split('\n');
  const size = o.size ?? Math.floor(H * 0.6);
  let fs = size;
  for (const l of lines) fs = Math.min(fs, fitFont(g, l, family, size, W * 0.92));
  g.font = `${fs}px "${family}"`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = fs * 1.05;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    const y = y0 + i * lh;
    if (o.glow) {
      g.shadowColor = o.glow;
      g.shadowBlur = fs * 0.35;
    }
    if (o.stroke) {
      g.strokeStyle = o.stroke;
      g.lineWidth = o.strokeWidth ?? Math.max(3, fs * 0.12);
      g.lineJoin = 'round';
      g.strokeText(l, W / 2, y);
    }
    g.fillStyle = o.color ?? '#fff';
    g.fillText(l, W / 2, y);
    g.shadowBlur = 0;
  });
}

/** A texture with text on it. */
export function labelTexture(text: string, o: LabelOpts = {}): THREE.CanvasTexture {
  const W = o.width ?? 512;
  const H = o.height ?? 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  drawLabel(g, text, o, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A redrawable canvas texture (for screens and displays that change). */
export class CanvasScreen {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  constructor(readonly width: number, readonly height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  update(): void {
    this.texture.needsUpdate = true;
  }
}
