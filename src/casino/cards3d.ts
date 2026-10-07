import * as THREE from 'three';
import type { Card } from './types';
import { tweens, ease } from '../core/tween';

/**
 * Real-looking playing cards for the tables: one atlas with all 52 faces (proper pip
 * layouts, court cards, a decorated ace of spades) and a patterned back, and 3D cards that
 * fly from the shoe, slide and flip like a dealer's.
 */

const CW = 128;
const CH = 180;
const COLS = 13;
const ROWS = 5; // 4 suits + a row for backs
export const CARD_W = 0.063;
export const CARD_H = 0.088;

const SUIT_CHARS = ['♠', '♥', '♦', '♣'];
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function suitPath(g: CanvasRenderingContext2D, suit: number, x: number, y: number, s: number, flip = false): void {
  // Draw the suit as a vector shape so it's crisp and font-independent.
  g.save();
  g.translate(x, y);
  if (flip) g.rotate(Math.PI);
  g.scale(s / 100, s / 100);
  g.beginPath();
  switch (suit) {
    case 0: // spade
      g.moveTo(0, -50);
      g.bezierCurveTo(30, -20, 52, -2, 44, 20);
      g.bezierCurveTo(38, 36, 14, 36, 6, 22);
      g.quadraticCurveTo(10, 40, 22, 50);
      g.lineTo(-22, 50);
      g.quadraticCurveTo(-10, 40, -6, 22);
      g.bezierCurveTo(-14, 36, -38, 36, -44, 20);
      g.bezierCurveTo(-52, -2, -30, -20, 0, -50);
      break;
    case 1: // heart
      g.moveTo(0, 46);
      g.bezierCurveTo(-30, 18, -52, 0, -48, -22);
      g.bezierCurveTo(-44, -46, -10, -50, 0, -26);
      g.bezierCurveTo(10, -50, 44, -46, 48, -22);
      g.bezierCurveTo(52, 0, 30, 18, 0, 46);
      break;
    case 2: // diamond
      g.moveTo(0, -50);
      g.quadraticCurveTo(18, -20, 38, 0);
      g.quadraticCurveTo(18, 20, 0, 50);
      g.quadraticCurveTo(-18, 20, -38, 0);
      g.quadraticCurveTo(-18, -20, 0, -50);
      break;
    default: // club
      g.arc(0, -24, 22, 0, Math.PI * 2);
      g.moveTo(24, 8);
      g.arc(24, 8, 22, 0, Math.PI * 2);
      g.moveTo(-2, 8);
      g.arc(-24, 8, 22, 0, Math.PI * 2);
      g.moveTo(6, 10);
      g.quadraticCurveTo(10, 40, 22, 50);
      g.lineTo(-22, 50);
      g.quadraticCurveTo(-10, 40, -6, 10);
      g.closePath();
  }
  g.fill();
  g.restore();
}

// Pip positions (in a 0..1 box) for 2..10.
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0.15], [0.5, 0.85]],
  3: [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85]],
  4: [[0.25, 0.15], [0.75, 0.15], [0.25, 0.85], [0.75, 0.85]],
  5: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.5], [0.25, 0.85], [0.75, 0.85]],
  6: [[0.25, 0.15], [0.75, 0.15], [0.25, 0.5], [0.75, 0.5], [0.25, 0.85], [0.75, 0.85]],
  7: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.33], [0.25, 0.5], [0.75, 0.5], [0.25, 0.85], [0.75, 0.85]],
  8: [[0.25, 0.15], [0.75, 0.15], [0.5, 0.33], [0.25, 0.5], [0.75, 0.5], [0.5, 0.67], [0.25, 0.85], [0.75, 0.85]],
  9: [[0.25, 0.12], [0.75, 0.12], [0.25, 0.38], [0.75, 0.38], [0.5, 0.5], [0.25, 0.62], [0.75, 0.62], [0.25, 0.88], [0.75, 0.88]],
  10: [[0.25, 0.12], [0.75, 0.12], [0.5, 0.25], [0.25, 0.38], [0.75, 0.38], [0.25, 0.62], [0.75, 0.62], [0.5, 0.75], [0.25, 0.88], [0.75, 0.88]],
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawFace(g: CanvasRenderingContext2D, x0: number, y0: number, rank: number, suit: number): void {
  const red = suit === 1 || suit === 2;
  const ink = red ? '#c8102e' : '#15151c';
  g.save();
  g.translate(x0, y0);
  g.fillStyle = '#fbfaf4';
  roundRect(g, 1, 1, CW - 2, CH - 2, 10);
  g.fill();
  g.strokeStyle = '#d8d4c8';
  g.lineWidth = 2;
  g.stroke();
  // Corner indices (top-left and rotated bottom-right).
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const idx = (flip: boolean) => {
    g.save();
    if (flip) {
      g.translate(CW, CH);
      g.rotate(Math.PI);
    }
    g.font = `bold ${rank === 9 ? 26 : 30}px Georgia, "Times New Roman", serif`;
    g.fillText(RANK_LABEL[rank], 17, 22);
    suitPath(g, suit, 17, 46, 18);
    g.restore();
  };
  idx(false);
  idx(true);
  const bx = 30;
  const by = 22;
  const bw = CW - 60;
  const bh = CH - 44;
  if (rank === 0) {
    // Ace: one big pip (the ace of spades gets a flourish).
    suitPath(g, suit, CW / 2, CH / 2, suit === 0 ? 62 : 46);
    if (suit === 0) {
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(CW / 2, CH / 2, 40, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (rank >= 10) {
    // Court cards: a framed, two-headed portrait panel.
    g.fillStyle = red ? '#fbe3c8' : '#e3ecf8';
    g.fillRect(bx - 4, by - 2, bw + 8, bh + 4);
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.strokeRect(bx - 4, by - 2, bw + 8, bh + 4);
    const robe = red ? '#c8102e' : '#1d3f9e';
    const trim = '#e8b030';
    for (const flip of [false, true]) {
      g.save();
      if (flip) {
        g.translate(CW, CH);
        g.rotate(Math.PI);
      }
      const cx = CW / 2;
      const top = by + 6;
      // Crown or cap.
      g.fillStyle = trim;
      if (rank === 12) {
        g.beginPath();
        g.moveTo(cx - 16, top + 18);
        g.lineTo(cx - 16, top + 4);
        g.lineTo(cx - 8, top + 12);
        g.lineTo(cx, top);
        g.lineTo(cx + 8, top + 12);
        g.lineTo(cx + 16, top + 4);
        g.lineTo(cx + 16, top + 18);
        g.fill();
      } else if (rank === 11) {
        g.beginPath();
        g.arc(cx, top + 14, 14, Math.PI, 0);
        g.fill();
        for (let i = -1; i <= 1; i++) {
          g.beginPath();
          g.arc(cx + i * 9, top + 2, 3, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        g.fillStyle = robe;
        g.fillRect(cx - 14, top + 4, 28, 12);
        g.fillStyle = trim;
        g.fillRect(cx - 16, top + 14, 32, 4);
      }
      // Face.
      g.fillStyle = '#f6d7b8';
      g.beginPath();
      g.arc(cx, top + 28, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#15151c';
      g.fillRect(cx - 5, top + 26, 3, 3);
      g.fillRect(cx + 2, top + 26, 3, 3);
      if (rank === 12) {
        g.fillStyle = '#7a4a2a';
        g.beginPath();
        g.arc(cx, top + 38, 9, 0, Math.PI);
        g.fill();
      }
      // Robe with a sash and the suit on the chest.
      g.fillStyle = robe;
      g.beginPath();
      g.moveTo(cx - 24, CH / 2);
      g.lineTo(cx - 18, top + 40);
      g.lineTo(cx + 18, top + 40);
      g.lineTo(cx + 24, CH / 2);
      g.fill();
      g.fillStyle = trim;
      g.fillRect(cx - 18, top + 44, 36, 4);
      g.fillStyle = '#fff';
      suitPath(g, suit, cx + 13, top + 56, 14);
      g.fillStyle = ink;
      suitPath(g, suit, cx + 13, top + 56, 12);
      g.restore();
    }
    g.strokeStyle = ink;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx - 4, CH / 2);
    g.lineTo(bx + bw + 4, CH / 2);
    g.stroke();
  } else {
    const n = rank + 1;
    for (const [px, py] of PIPS[n]) suitPath(g, suit, bx + px * bw, by + py * bh, 28, py > 0.55);
  }
  g.restore();
}

function drawBack(g: CanvasRenderingContext2D, x0: number, y0: number, color: string): void {
  g.save();
  g.translate(x0, y0);
  g.fillStyle = '#fbfaf4';
  roundRect(g, 1, 1, CW - 2, CH - 2, 10);
  g.fill();
  g.fillStyle = color;
  roundRect(g, 9, 9, CW - 18, CH - 18, 6);
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  g.lineWidth = 2;
  for (let i = -CH; i < CW + CH; i += 10) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + CH, CH);
    g.moveTo(i + CH, 0);
    g.lineTo(i, CH);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#fbfaf4';
  g.lineWidth = 3;
  roundRect(g, 16, 16, CW - 32, CH - 32, 6);
  g.stroke();
  g.fillStyle = '#fbfaf4';
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('J', CW / 2, CH / 2 - 14);
  g.fillText('I', CW / 2, CH / 2 + 18);
  g.restore();
}

let atlas: THREE.CanvasTexture | null = null;
export const BACK_COLORS = ['#b3122e', '#1d3f9e', '#127a3e', '#5a1fa0'];

export function cardAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = COLS * CW;
  c.height = ROWS * CH;
  const g = c.getContext('2d')!;
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) drawFace(g, r * CW, s * CH, r, s);
  BACK_COLORS.forEach((col, i) => drawBack(g, i * CW, 4 * CH, col));
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlas.generateMipmaps = true;
  return atlas;
}

const W = COLS * CW;
const H = ROWS * CH;
function cellUV(col: number, row: number): [number, number, number, number] {
  const pad = 1;
  const u0 = (col * CW + pad) / W;
  const u1 = ((col + 1) * CW - pad) / W;
  const v1 = 1 - (row * CH + pad) / H;
  const v0 = 1 - ((row + 1) * CH - pad) / H;
  return [u0, v0, u1, v1];
}

let cardMat: THREE.MeshLambertMaterial | null = null;
export function cardMaterial(): THREE.MeshLambertMaterial {
  if (!cardMat) cardMat = new THREE.MeshLambertMaterial({ map: cardAtlas(), alphaTest: 0.5, transparent: false });
  return cardMat;
}

/** A card as a thin two-sided plate lying flat (face up when rotation.x = 0). */
export class Card3D {
  readonly mesh: THREE.Mesh;
  card: Card | null;
  faceUp = false;

  constructor(card: Card | null, backColor = 0) {
    this.card = card;
    const g = new THREE.BufferGeometry();
    const hw = CARD_W / 2;
    const hh = CARD_H / 2;
    const t = 0.0004;
    const f = card ? cellUV(card.rank, card.suit) : cellUV(backColor, 4);
    const b = cellUV(backColor, 4);
    // Face on top (+y), back underneath (-y). Long side along -z (towards the dealer).
    const pos = [
      -hw, t, hh, hw, t, hh, hw, t, -hh, -hw, t, -hh,
      -hw, -t, hh, -hw, -t, -hh, hw, -t, -hh, hw, -t, hh,
    ];
    const uv = [
      f[0], f[1], f[2], f[1], f[2], f[3], f[0], f[3],
      b[2], b[1], b[2], b[3], b[0], b[3], b[0], b[1],
    ];
    const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.mesh = new THREE.Mesh(g, cardMaterial());
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 3;
  }

  /** Reveal a card that was dealt face down (sets the face UVs). */
  setCard(card: Card): void {
    this.card = card;
    const f = cellUV(card.rank, card.suit);
    const uv = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    uv.setXY(0, f[0], f[1]);
    uv.setXY(1, f[2], f[1]);
    uv.setXY(2, f[2], f[3]);
    uv.setXY(3, f[0], f[3]);
    uv.needsUpdate = true;
  }

  /** Fly from where it is to a spot on the table (local to the table group), maybe flipping. */
  async dealTo(x: number, y: number, z: number, rotY: number, faceUp: boolean, dur = 0.42, group = ''): Promise<void> {
    const m = this.mesh;
    const sx = m.position.x;
    const sy = m.position.y;
    const sz = m.position.z;
    const sr = m.rotation.y;
    const sf = m.rotation.z;
    const ef = faceUp ? 0 : Math.PI;
    const spin = (Math.random() - 0.5) * 0.4;
    await tweens.run(
      dur,
      (k) => {
        m.position.set(sx + (x - sx) * k, sy + (y - sy) * k + Math.sin(k * Math.PI) * 0.06, sz + (z - sz) * k);
        m.rotation.y = sr + (rotY - sr) * k + spin * Math.sin(k * Math.PI);
        m.rotation.z = sf + (ef - sf) * k;
      },
      ease.out,
      group,
    );
    this.faceUp = faceUp;
  }

  /** Turn over where it lies. */
  async flip(faceUp = true, dur = 0.3, group = ''): Promise<void> {
    const m = this.mesh;
    const s = m.rotation.z;
    const e = faceUp ? 0 : Math.PI;
    const y0 = m.position.y;
    await tweens.run(
      dur,
      (k) => {
        m.rotation.z = s + (e - s) * k;
        m.position.y = y0 + Math.sin(k * Math.PI) * 0.04;
      },
      ease.inOut,
      group,
    );
    this.faceUp = faceUp;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

export function cardName(c: Card): string {
  return `${RANK_LABEL[c.rank]}${SUIT_CHARS[c.suit]}`;
}
