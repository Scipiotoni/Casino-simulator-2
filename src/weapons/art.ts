import type { Camo, Reticle } from './attachments';
import type { CrosshairSettings } from './loadout';
import { mulberry32 } from '../core/noise';

/**
 * 2D drawings for the gunsmith and the HUD: camo swatches (from each camo's pattern and
 * colours), optic reticles and the crosshair. Plain canvas, no three.js.
 */

export const hexCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function drawCamo(ctx: CanvasRenderingContext2D, c: Camo, w: number, h: number, factory = 0x2a2b30): void {
  const col = c.colors.length ? c.colors.map(hexCss) : [hexCss(factory)];
  const r = mulberry32(c.id.length * 977 + c.id.charCodeAt(0));
  ctx.save();
  ctx.fillStyle = col[0];
  ctx.fillRect(0, 0, w, h);
  const blobs = (n: number, size: number, from = 1) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = col[from + (i % Math.max(1, col.length - from))] ?? col[0];
      ctx.beginPath();
      const x = r() * w;
      const y = r() * h;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = size * (0.5 + r() * 0.7);
        ctx.lineTo(x + Math.cos(a) * rr * 1.4, y + Math.sin(a) * rr);
      }
      ctx.fill();
    }
  };
  switch (c.pattern) {
    case 'solid':
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, 0, w, h / 2);
      break;
    case 'woodland':
    case 'arctic':
      blobs(26, w / 7);
      break;
    case 'tiger':
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = col[1 + (i % (col.length - 1))];
        ctx.beginPath();
        const x = (i / 14) * w * 1.2 - w * 0.1;
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + w * 0.08, h * 0.3, x - w * 0.06, h * 0.6, x + w * 0.04, h);
        ctx.lineTo(x + w * 0.07, h);
        ctx.bezierCurveTo(x, h * 0.6, x + w * 0.12, h * 0.3, x + w * 0.05, 0);
        ctx.fill();
      }
      break;
    case 'digital': {
      const s = Math.max(3, Math.round(w / 16));
      for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
        const v = r();
        if (v < 0.55) continue;
        ctx.fillStyle = col[1 + Math.floor(r() * (col.length - 1))];
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case 'carbon': {
      const s = Math.max(4, Math.round(w / 12));
      for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
        const g = ctx.createLinearGradient(x, y, x + s, y + s);
        const odd = ((x + y) / s) % 2;
        g.addColorStop(0, odd ? col[1] : col[0]);
        g.addColorStop(1, odd ? col[0] : col[1]);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case 'hex': {
      ctx.strokeStyle = col[1];
      ctx.lineWidth = Math.max(1, w / 90);
      const s = w / 9;
      for (let y = 0; y < h + s; y += s * 0.87) for (let x = 0; x < w + s; x += s * 1.5) {
        const ox = (Math.round(y / (s * 0.87)) % 2) * s * 0.75;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) ctx.lineTo(x + ox + Math.cos((k / 6) * Math.PI * 2) * s * 0.45, y + Math.sin((k / 6) * Math.PI * 2) * s * 0.45);
        ctx.stroke();
      }
      break;
    }
    case 'damascus':
      ctx.lineWidth = Math.max(1, w / 60);
      for (let i = -10; i < 30; i++) {
        ctx.strokeStyle = col[1 + (i & 1)];
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) ctx.lineTo(x, (i / 20) * h + Math.sin(x / (w / 6) + i * 0.7) * h * 0.08);
        ctx.stroke();
      }
      break;
    case 'gold':
    case 'diamond': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, col[2] ?? col[0]);
      g.addColorStop(0.45, col[1]);
      g.addColorStop(0.55, col[0]);
      g.addColorStop(1, col[2] ?? col[0]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (c.pattern === 'diamond') {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 18; i++) {
          ctx.beginPath();
          ctx.moveTo(r() * w, r() * h);
          ctx.lineTo(r() * w, r() * h);
          ctx.lineTo(r() * w, r() * h);
          ctx.closePath();
          ctx.stroke();
        }
      }
      break;
    }
    case 'darkmatter': {
      const g = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.7);
      g.addColorStop(0, col[1]);
      g.addColorStop(0.5, col[2]);
      g.addColorStop(1, col[0]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 30; i++) ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
      break;
    }
    case 'cards':
    case 'chips': {
      const s = w / 5;
      ctx.font = `${Math.round(s * 0.8)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = s / 2, j = 0; y < h + s; y += s, j++) for (let x = s / 2, i = 0; x < w + s; x += s, i++) {
        if (c.pattern === 'cards') {
          ctx.fillStyle = (i + j) % 2 ? col[2] : col[1];
          ctx.fillText('♠♥♦♣'[(i + j * 3) % 4], x, y);
        } else {
          ctx.fillStyle = col[1];
          ctx.beginPath();
          ctx.arc(x, y, s * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = col[2];
          ctx.setLineDash([s * 0.12, s * 0.12]);
          ctx.lineWidth = s * 0.08;
          ctx.beginPath();
          ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      break;
    }
    case 'neon':
      ctx.lineWidth = w / 16;
      for (let i = -6; i < 12; i++) {
        ctx.strokeStyle = col[1 + (i & 1)];
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo((i / 6) * w, 0);
        ctx.lineTo((i / 6) * w + h, h);
        ctx.stroke();
      }
      break;
    case 'flames':
      for (let i = 0; i < 7; i++) {
        const x = (i / 6) * w;
        ctx.fillStyle = col[1];
        ctx.beginPath();
        ctx.moveTo(x - w * 0.1, h);
        ctx.quadraticCurveTo(x - w * 0.12, h * 0.4, x + w * 0.05, h * 0.05);
        ctx.quadraticCurveTo(x, h * 0.5, x + w * 0.1, h);
        ctx.fill();
        ctx.fillStyle = col[2];
        ctx.beginPath();
        ctx.moveTo(x - w * 0.05, h);
        ctx.quadraticCurveTo(x - w * 0.05, h * 0.6, x + w * 0.03, h * 0.35);
        ctx.quadraticCurveTo(x + w * 0.02, h * 0.7, x + w * 0.06, h);
        ctx.fill();
      }
      break;
  }
  ctx.restore();
}

/** A reticle in an optic lens of radius `s` centred on (cx, cy). */
export function drawReticle(ctx: CanvasRenderingContext2D, shape: Reticle, color: number, cx: number, cy: number, s: number): void {
  ctx.save();
  const c = hexCss(color);
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.shadowColor = c;
  ctx.shadowBlur = s * 0.12;
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  const dot = (r: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (shape) {
    case 'dot':
      dot(s * 0.08);
      break;
    case 'circleDot':
      dot(s * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'chevron':
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.3, cy + s * 0.25);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + s * 0.3, cy + s * 0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.3);
      ctx.lineTo(cx, cy + s * 0.8);
      ctx.stroke();
      break;
    case 'cross':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * s * 0.12, cy + dy * s * 0.12);
        ctx.lineTo(cx + dx * s * 0.8, cy + dy * s * 0.8);
        ctx.stroke();
      }
      break;
    case 'ring':
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'spade':
      ctx.font = `${Math.round(s * 0.5)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♠', cx, cy);
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.18);
      ctx.lineTo(cx + s * 0.16, cy + s * 0.12);
      ctx.lineTo(cx - s * 0.16, cy + s * 0.12);
      ctx.closePath();
      ctx.fill();
      break;
    case 'mil':
      ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(cx - s, cy);
      ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx, cy + s);
      ctx.stroke();
      for (let i = -4; i <= 4; i++) {
        if (!i) continue;
        ctx.beginPath();
        ctx.arc(cx + i * s * 0.18, cy, s * 0.025, 0, Math.PI * 2);
        ctx.arc(cx, cy + i * s * 0.18, s * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }
  ctx.restore();
}

/** An optic's lens with its reticle, for the gunsmith. */
export function drawLens(ctx: CanvasRenderingContext2D, shape: Reticle, color: number, w: number, h: number): void {
  const s = Math.min(w, h) / 2 - 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, s * 0.2, w / 2, h / 2, s);
  g.addColorStop(0, '#3a4a5a');
  g.addColorStop(1, '#0e141c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.stroke();
  drawReticle(ctx, shape, color, w / 2, h / 2, s * 0.9);
}

/**
 * The HUD crosshair centred on (cx, cy). `spread` is how far the arms open, in pixels on
 * top of the gap (it widens as you move and fire).
 */
export function drawCrosshair(ctx: CanvasRenderingContext2D, c: CrosshairSettings, cx: number, cy: number, spread: number, scale = 1): void {
  if (c.style === 'none') return;
  ctx.save();
  const col = hexCss(c.color);
  const sz = c.size * scale;
  const gap = (3 + c.gap * 5) * scale + spread;
  const len = 7 * sz;
  const th = Math.max(1.5, 2 * sz);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  const stroke = (fn: () => void) => {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = th + 2;
    fn();
    ctx.strokeStyle = col;
    ctx.lineWidth = th;
    fn();
  };
  const dot = (r: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (c.style) {
    case 'classic':
      stroke(() => {
        line(cx - gap - len, cy, cx - gap, cy);
        line(cx + gap, cy, cx + gap + len, cy);
        line(cx, cy - gap - len, cx, cy - gap);
        line(cx, cy + gap, cx, cy + gap + len);
      });
      break;
    case 'cross':
      stroke(() => {
        line(cx - gap - len, cy, cx - gap, cy);
        line(cx + gap, cy, cx + gap + len, cy);
        line(cx, cy - gap - len, cx, cy - gap);
        line(cx, cy + gap, cx, cy + gap + len);
      });
      dot(th * 0.7);
      break;
    case 'tee':
      stroke(() => {
        line(cx - gap - len, cy, cx - gap, cy);
        line(cx + gap, cy, cx + gap + len, cy);
        line(cx, cy + gap, cx, cy + gap + len);
      });
      break;
    case 'dot':
      dot(2.2 * sz);
      break;
    case 'circle':
      stroke(() => {
        ctx.beginPath();
        ctx.arc(cx, cy, gap + len * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      });
      dot(th * 0.6);
      break;
    case 'chevron':
      stroke(() => {
        ctx.beginPath();
        ctx.moveTo(cx - len, cy + gap + len * 0.6);
        ctx.lineTo(cx, cy + gap * 0.4);
        ctx.lineTo(cx + len, cy + gap + len * 0.6);
        ctx.stroke();
      });
      break;
  }
  ctx.restore();
}
