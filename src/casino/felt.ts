/** Shared drawing for table felts: the cloth itself, arc lettering, bet boxes. */

export function feltCanvas(w: number, h: number, color: string): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  // Fine cloth grain and a soft vignette so it doesn't look like flat paint.
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, 'rgba(255,255,255,0.05)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return { canvas, g };
}

/** Letters along an arc centred on (cx, cy), reading left to right along the bottom of the circle. */
export function arcText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, size: number, font: string, color: string): void {
  g.save();
  g.font = `${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = Math.PI / 2 + total / r / 2;
  for (let i = 0; i < text.length; i++) {
    const w = widths[i];
    a -= w / r / 2;
    g.save();
    g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.rotate(a - Math.PI / 2);
    g.fillText(text[i], 0, 0);
    g.restore();
    a -= w / r / 2;
  }
  g.restore();
}

/** A labelled rectangle on the felt (bet boxes for baccarat, craps, roulette outside bets). */
export function feltBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, opts: { line?: string; fill?: string; text?: string; size?: number; font?: string; lineWidth?: number } = {}): void {
  if (opts.fill) {
    g.fillStyle = opts.fill;
    g.fillRect(x, y, w, h);
  }
  g.strokeStyle = opts.line ?? '#ffffff';
  g.lineWidth = opts.lineWidth ?? 3;
  g.strokeRect(x, y, w, h);
  if (label) {
    g.fillStyle = opts.text ?? '#ffffff';
    g.font = `${opts.size ?? 22}px ${opts.font ?? '"Lilita One", Arial'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = label.split('\n');
    const lh = (opts.size ?? 22) * 1.05;
    lines.forEach((l, i) => g.fillText(l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * lh, w - 6));
  }
}
