import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

/**
 * Procedural building facades. Each style is one tiling texture covering BAYS window bays
 * by FLOORS floors, plus a matching emissive map where a random share of the windows are
 * lit at night (warm lamps, cool TV glow). Buildings pick a random tile offset so the lit
 * pattern never lines up between neighbours.
 */

export type FacadeStyle = 'glassBlue' | 'glassTeal' | 'office' | 'brick' | 'stucco' | 'deco' | 'warehouse' | 'house' | 'hotel';

export const BAYS = 8;
export const FLOORS = 8;
/** Metres per bay / per floor for each style. */
export const MODULE: Record<FacadeStyle, { bay: number; floor: number }> = {
  glassBlue: { bay: 3.2, floor: 3.8 },
  glassTeal: { bay: 3.2, floor: 3.8 },
  office: { bay: 3.6, floor: 3.9 },
  brick: { bay: 3.4, floor: 3.4 },
  stucco: { bay: 3.6, floor: 3.3 },
  deco: { bay: 3.4, floor: 3.5 },
  warehouse: { bay: 6, floor: 5 },
  house: { bay: 3.4, floor: 3.1 },
  hotel: { bay: 3.0, floor: 3.2 },
};

const PX = 64;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

interface Painter {
  wall(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number): void;
  window: { x: number; y: number; w: number; h: number };
  glass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number): void;
  frame?: string;
  lit: number;
}

function noiseFill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, amount: number, r: () => number): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 6; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${amount * r()})`;
    g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5);
  }
}

function skyGlass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, bottom: string): void {
  const gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  // A diagonal sheen.
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(x + w * 0.15, y);
  g.lineTo(x + w * 0.45, y);
  g.lineTo(x + w * 0.1, y + h);
  g.lineTo(x - w * 0.2, y + h);
  g.closePath();
  g.fill();
}

const PAINTERS: Record<FacadeStyle, Painter> = {
  glassBlue: {
    wall: (g, x, y, w, h) => {
      g.fillStyle = '#2b3d55';
      g.fillRect(x, y, w, h);
    },
    window: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#9fd2ff', '#3a6fb8'),
    lit: 0.32,
  },
  glassTeal: {
    wall: (g, x, y, w, h) => {
      g.fillStyle = '#21423f';
      g.fillRect(x, y, w, h);
    },
    window: { x: 0.05, y: 0.1, w: 0.9, h: 0.8 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#a8f0e0', '#2e8a86'),
    lit: 0.3,
  },
  office: {
    wall: (g, x, y, w, h, r) => noiseFill(g, x, y, w, h, '#d9d4c8', 0.12, r),
    window: { x: 0.0, y: 0.3, w: 1.0, h: 0.5 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#8fb6d6', '#355a7c'),
    frame: '#5c6670',
    lit: 0.36,
  },
  brick: {
    wall: (g, x, y, w, h, r) => {
      noiseFill(g, x, y, w, h, '#a2523d', 0.15, r);
      g.strokeStyle = 'rgba(60,30,20,0.35)';
      g.lineWidth = 1;
      for (let yy = y; yy < y + h; yy += 5) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + w, yy);
        g.stroke();
      }
    },
    window: { x: 0.24, y: 0.22, w: 0.52, h: 0.58 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#a9c4d6', '#3d4f62'),
    frame: '#efe6d8',
    lit: 0.42,
  },
  stucco: {
    wall: (g, x, y, w, h, r) => noiseFill(g, x, y, w, h, '#f4efe6', 0.08, r),
    window: { x: 0.22, y: 0.24, w: 0.56, h: 0.5 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#b7e0f0', '#4a7c96'),
    frame: '#ffffff',
    lit: 0.4,
  },
  deco: {
    wall: (g, x, y, w, h, r) => {
      noiseFill(g, x, y, w, h, '#f6f0e4', 0.06, r);
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(x, y + h * 0.86, w, h * 0.14);
    },
    window: { x: 0.18, y: 0.2, w: 0.64, h: 0.56 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#c0f2ff', '#3f8fae'),
    frame: '#e0f6ff',
    lit: 0.38,
  },
  warehouse: {
    wall: (g, x, y, w, h) => {
      g.fillStyle = '#b8b9b4';
      g.fillRect(x, y, w, h);
      for (let xx = x; xx < x + w; xx += 4) {
        g.fillStyle = (xx / 4) % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
        g.fillRect(xx, y, 2, h);
      }
    },
    window: { x: 0.1, y: 0.62, w: 0.8, h: 0.16 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#c6d6df', '#6f8794'),
    lit: 0.2,
  },
  house: {
    wall: (g, x, y, w, h, r) => {
      noiseFill(g, x, y, w, h, '#f7f2ea', 0.06, r);
      g.strokeStyle = 'rgba(0,0,0,0.07)';
      for (let yy = y; yy < y + h; yy += 6) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + w, yy);
        g.stroke();
      }
    },
    window: { x: 0.2, y: 0.24, w: 0.6, h: 0.48 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#cfe6f2', '#56788c'),
    frame: '#ffffff',
    lit: 0.5,
  },
  hotel: {
    wall: (g, x, y, w, h, r) => noiseFill(g, x, y, w, h, '#f1ece2', 0.07, r),
    window: { x: 0.08, y: 0.18, w: 0.84, h: 0.62 },
    glass: (g, x, y, w, h) => skyGlass(g, x, y, w, h, '#a8e4ff', '#2d6c9c'),
    frame: '#d8c79a',
    lit: 0.45,
  },
};

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

const cache = new Map<FacadeStyle, FacadeTextures>();

export function facadeTextures(style: FacadeStyle): FacadeTextures {
  const hit = cache.get(style);
  if (hit) return hit;
  const p = PAINTERS[style];
  const r = mulberry32(style.length * 977 + style.charCodeAt(0));
  const W = BAYS * PX;
  const H = FLOORS * PX;
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  for (let fy = 0; fy < FLOORS; fy++) {
    for (let bx = 0; bx < BAYS; bx++) {
      const x = bx * PX;
      const y = fy * PX;
      p.wall(g, x, y, PX, PX, r);
      const wx = x + p.window.x * PX;
      const wy = y + p.window.y * PX;
      const ww = p.window.w * PX;
      const wh = p.window.h * PX;
      p.glass(g, wx, wy, ww, wh, r);
      if (p.frame) {
        g.strokeStyle = p.frame;
        g.lineWidth = 3;
        g.strokeRect(wx, wy, ww, wh);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(wx + ww / 2, wy);
        g.lineTo(wx + ww / 2, wy + wh);
        g.stroke();
      }
      if (style === 'glassBlue' || style === 'glassTeal') {
        // Mullions and spandrel lines.
        g.fillStyle = 'rgba(20,30,45,0.9)';
        g.fillRect(x, y, 2, PX);
        g.fillRect(x, y + PX - 5, PX, 5);
      }
      // Lit windows: warm lamps mostly, some cool screens; blinds half drawn on some.
      if (r() < p.lit) {
        const k = r();
        ge.fillStyle = k < 0.7 ? '#ffd890' : k < 0.88 ? '#fff4d8' : '#9fd0ff';
        const blind = r() < 0.3 ? wh * (0.2 + r() * 0.4) : 0;
        ge.fillRect(wx + 2, wy + 2 + blind, ww - 4, wh - 4 - blind);
      }
    }
  }
  const out = { map: tex(c), emissive: tex(ce) };
  cache.set(style, out);
  return out;
}

/** Plain roof gravel / concrete. */
export function roofTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = mulberry32(5);
  noiseFill(g, 0, 0, 128, 128, '#c2beb6', 0.18, r);
  return tex(c);
}

/** Shopfront band for ground floors: glass, frames and an awning shadow. */
export function shopfrontTexture(): FacadeTextures {
  const [c, g] = canvas(256, 64);
  const [ce, ge] = canvas(256, 64);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 256, 64);
  g.fillStyle = '#3b3f46';
  g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 4; i++) {
    const x = i * 64;
    skyGlass(g, x + 4, 10, 56, 50, '#c8e4f2', '#36536a');
    g.fillStyle = '#d8d8d8';
    g.fillRect(x, 0, 4, 64);
    ge.fillStyle = i % 2 ? '#ffe2a8' : '#fff6e0';
    ge.fillRect(x + 6, 12, 52, 46);
  }
  return { map: tex(c), emissive: tex(ce) };
}
