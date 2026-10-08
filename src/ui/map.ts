import type { Terrain } from '../world/terrain';
import { CELL } from '../world/terrain';
import { DOMAIN } from '../world/layout';
import { el } from './dom';

/**
 * The island map: painted once from the heightfield (sea depth, beaches, hills, roads,
 * city blocks), then reused by the corner minimap and the full-screen map.
 */

export interface MapMarker {
  x: number;
  z: number;
  /** Emoji or a single letter. */
  icon: string;
  color: string;
  label?: string;
  /** Drawn bigger and always on top. */
  big?: boolean;
}

const PX = 4; // cells per map pixel

export class IslandMap {
  readonly base: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;

  constructor(t: Terrain) {
    this.w = Math.floor(t.nx / PX);
    this.h = Math.floor(t.nz / PX);
    this.base = document.createElement('canvas');
    this.base.width = this.w;
    this.base.height = this.h;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(this.w, this.h);
    const d = img.data;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const cx = x * PX;
        const cz = y * PX;
        const hh = t.heights[cz * t.nx + cx];
        const he = t.heights[cz * t.nx + Math.min(t.nx - 1, cx + 1)];
        const shade = Math.max(0.7, Math.min(1.25, 1 + (he - hh) * 0.04));
        const s = t.surface[cz * t.nx + cx];
        let r: number, gg: number, b: number;
        if (hh < 0) {
          const k = Math.min(1, -hh / 60);
          r = 70 - 50 * k;
          gg = 200 - 110 * k;
          b = 230 - 80 * k;
        } else if (s === 1 || s === 2 || s === 5) {
          r = 214; gg = 214; b = 222;
        } else if (s === 3) {
          r = 196; gg = 160; b = 110;
        } else if (hh < 2.5) {
          r = 246; gg = 226; b = 166;
        } else if (hh > 330) {
          r = 150 + (hh - 330) * 0.2; gg = 120; b = 110;
        } else {
          r = 96 + hh * 0.12;
          gg = 178 - hh * 0.08;
          b = 92;
          if (s === 4) {
            r = 138; gg = 196; b = 120;
          }
        }
        const i = (y * this.w + x) * 4;
        d[i] = Math.min(255, r * shade);
        d[i + 1] = Math.min(255, gg * shade);
        d[i + 2] = Math.min(255, b * shade);
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // City lots as building footprints.
    g.fillStyle = 'rgba(120, 128, 160, 0.55)';
    for (const l of t.lots) {
      const a = this.toMap(l.x0 + 3, l.z0 + 3);
      const b2 = this.toMap(l.x1 - 3, l.z1 - 3);
      g.fillRect(a.x, a.y, Math.max(1, b2.x - a.x), Math.max(1, b2.y - a.y));
    }
  }

  /** World to base-canvas pixels. */
  toMap(x: number, z: number): { x: number; y: number } {
    return { x: (x - DOMAIN.minX) / CELL / PX, y: (z - DOMAIN.minZ) / CELL / PX };
  }

  toWorld(px: number, py: number): { x: number; z: number } {
    return { x: DOMAIN.minX + px * CELL * PX, z: DOMAIN.minZ + py * CELL * PX };
  }

  /** Metres per base pixel. */
  get scale(): number {
    return CELL * PX;
  }
}

/** The round minimap in the corner: north-up, centred on you, with markers clamped to the rim. */
export class Minimap {
  readonly root: HTMLDivElement;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private t = 0;
  /** Metres from the centre to the rim. */
  range = 260;

  constructor(parent: HTMLElement, private map: IslandMap) {
    this.root = el('div', 'minimap');
    this.c = document.createElement('canvas');
    this.c.width = this.c.height = 176;
    this.g = this.c.getContext('2d')!;
    this.root.appendChild(this.c);
    this.root.appendChild(el('div', 'mm-n', 'N'));
    parent.appendChild(this.root);
  }

  update(dt: number, px: number, pz: number, heading: number, markers: MapMarker[], speed = 0): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 15;
    // Zoom out at speed.
    const want = 220 + Math.min(1, speed / 40) * 260;
    this.range += (want - this.range) * 0.15;
    const g = this.g;
    const S = this.c.width;
    const R = S / 2;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2a7fb8';
    g.fillRect(0, 0, S, S);
    const m = this.map;
    const c = m.toMap(px, pz);
    const k = R / (this.range / m.scale); // canvas px per base px
    g.imageSmoothingEnabled = true;
    g.drawImage(m.base, R - c.x * k, R - c.y * k, m.w * k, m.h * k);
    // Markers.
    for (const mk of markers) {
      let dx = (mk.x - px) / this.range;
      let dz = (mk.z - pz) / this.range;
      const d = Math.hypot(dx, dz);
      if (d > 0.88) {
        if (!mk.big) continue;
        dx = (dx / d) * 0.88;
        dz = (dz / d) * 0.88;
      }
      drawMarker(g, R + dx * R, R + dz * R, mk, mk.big ? 15 : 11);
    }
    g.restore();
    // You: an arrow pointing where you face.
    g.save();
    g.translate(R, R);
    g.rotate(Math.PI - heading);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0b1a3a';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 7);
    g.lineTo(0, 3);
    g.lineTo(-7, 7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}

export function drawMarker(g: CanvasRenderingContext2D, x: number, y: number, mk: MapMarker, size: number): void {
  g.fillStyle = mk.color;
  g.strokeStyle = 'rgba(10, 16, 40, 0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, size / 2 + 2, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `${Math.round(size * 0.8)}px "Nunito", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(mk.icon, x, y + 1);
}
