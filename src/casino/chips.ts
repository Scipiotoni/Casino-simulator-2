import * as THREE from 'three';

/**
 * Casino chips in the standard colours, drawn with edge spots and an inlay with the value.
 * A ChipLayer holds every chip on one table as instanced meshes (one draw call per
 * denomination), and lays bets out as neat stacks.
 */

export interface Denom {
  value: number;
  color: string;
  edge: string;
  text: string;
  label: string;
}

export const DENOMS: Denom[] = [
  { value: 1, color: '#f4f4f0', edge: '#2f6fd8', text: '#2f6fd8', label: '1' },
  { value: 5, color: '#d8202f', edge: '#ffffff', text: '#ffffff', label: '5' },
  { value: 25, color: '#1f9a4c', edge: '#ffffff', text: '#ffffff', label: '25' },
  { value: 100, color: '#18181c', edge: '#ffffff', text: '#ffffff', label: '100' },
  { value: 500, color: '#6a2fb8', edge: '#ffd23d', text: '#ffd23d', label: '500' },
  { value: 1000, color: '#f2c230', edge: '#18181c', text: '#18181c', label: '1K' },
  { value: 5000, color: '#8a5a2b', edge: '#ffe0a0', text: '#ffe0a0', label: '5K' },
  { value: 25000, color: '#ff6fae', edge: '#ffffff', text: '#ffffff', label: '25K' },
  { value: 100000, color: '#3fc0f0', edge: '#0b1530', text: '#0b1530', label: '100K' },
];

export const CHIP_R = 0.0195;
export const CHIP_H = 0.0034;

function chipCanvas(d: Denom, kind: 'top' | 'side'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  if (kind === 'side') {
    c.width = 128;
    c.height = 8;
    const g = c.getContext('2d')!;
    g.fillStyle = d.color;
    g.fillRect(0, 0, 128, 8);
    g.fillStyle = d.edge;
    for (let i = 0; i < 8; i++) g.fillRect(i * 16 + 3, 0, 7, 8);
    return c;
  }
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = d.color;
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.fill();
  // Edge spots.
  g.fillStyle = d.edge;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.save();
    g.translate(64, 64);
    g.rotate(a);
    g.fillRect(-9, -64, 18, 16);
    g.restore();
  }
  // Inlay ring and value.
  g.strokeStyle = d.edge;
  g.lineWidth = 3;
  g.setLineDash([6, 5]);
  g.beginPath();
  g.arc(64, 64, 40, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.arc(64, 64, 36, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = d.text;
  g.font = `bold ${d.label.length > 3 ? 26 : 34}px "Lilita One", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(d.label, 64, 66);
  return c;
}

interface ChipMats {
  side: THREE.MeshLambertMaterial;
  top: THREE.MeshLambertMaterial;
}
const mats = new Map<number, ChipMats>();

export function chipMaterials(d: Denom): THREE.Material[] {
  let m = mats.get(d.value);
  if (!m) {
    const st = new THREE.CanvasTexture(chipCanvas(d, 'side'));
    st.colorSpace = THREE.SRGBColorSpace;
    st.wrapS = THREE.RepeatWrapping;
    const tt = new THREE.CanvasTexture(chipCanvas(d, 'top'));
    tt.colorSpace = THREE.SRGBColorSpace;
    tt.anisotropy = 4;
    m = { side: new THREE.MeshLambertMaterial({ map: st }), top: new THREE.MeshLambertMaterial({ map: tt }) };
    mats.set(d.value, m);
  }
  return [m.side, m.top, m.top];
}

let chipGeo: THREE.CylinderGeometry | null = null;
export function chipGeometry(): THREE.CylinderGeometry {
  if (!chipGeo) chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 20, 1);
  return chipGeo;
}

/** Break an amount into chips, biggest first (at most `max` chips). */
export function breakdown(amount: number, max = 60): Denom[] {
  const out: Denom[] = [];
  let left = Math.round(amount);
  for (let i = DENOMS.length - 1; i >= 0 && left > 0; i--) {
    const d = DENOMS[i];
    while (left >= d.value && out.length < max) {
      out.push(d);
      left -= d.value;
    }
  }
  return out;
}

/** The biggest chips that make up an amount, grouped into stacks of one colour. */
export function stacksFor(amount: number): { denom: Denom; count: number }[] {
  const chips = breakdown(amount);
  const out: { denom: Denom; count: number }[] = [];
  for (const d of chips) {
    const last = out[out.length - 1];
    if (last && last.denom === d && last.count < 20) last.count++;
    else out.push({ denom: d, count: 1 });
  }
  return out;
}

export interface ChipPile {
  id: string;
  x: number;
  y: number;
  z: number;
  amount: number;
}

/** Every chip on a table, drawn as one instanced mesh per denomination. */
export class ChipLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.InstancedMesh>();
  readonly piles = new Map<string, ChipPile>();
  private dirty = true;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3(1, 1, 1);
  private _e = new THREE.Euler();

  constructor(private capacity = 400) {
    for (const d of DENOMS) {
      const m = new THREE.InstancedMesh(chipGeometry(), chipMaterials(d), capacity);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.meshes.set(d.value, m);
      this.group.add(m);
    }
  }

  set(id: string, x: number, y: number, z: number, amount: number): void {
    if (amount <= 0) {
      if (this.piles.delete(id)) this.dirty = true;
      return;
    }
    const p = this.piles.get(id);
    if (p && p.amount === amount && p.x === x && p.z === z && p.y === y) return;
    this.piles.set(id, { id, x, y, z, amount });
    this.dirty = true;
  }

  get(id: string): number {
    return this.piles.get(id)?.amount ?? 0;
  }

  clear(): void {
    if (this.piles.size) this.dirty = true;
    this.piles.clear();
  }

  /** Slide a pile somewhere else (paying out, sweeping to the dealer). */
  move(id: string, x: number, z: number): void {
    const p = this.piles.get(id);
    if (!p) return;
    p.x = x;
    p.z = z;
    this.dirty = true;
  }

  rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const counts = new Map<number, number>();
    for (const p of this.piles.values()) {
      const stacks = stacksFor(p.amount);
      // Several colours side by side: a little cluster.
      stacks.forEach((s, si) => {
        const ox = (si % 3) * CHIP_R * 2.15 - (Math.min(stacks.length, 3) - 1) * CHIP_R * 1.07;
        const oz = Math.floor(si / 3) * CHIP_R * 2.15;
        for (let c = 0; c < s.count; c++) {
          const m = this.meshes.get(s.denom.value)!;
          const i = counts.get(s.denom.value) ?? 0;
          if (i >= this.capacity) continue;
          const jitter = ((c * 7919 + si * 31) % 13) / 13 - 0.5;
          this._p.set(p.x + ox + jitter * 0.0012, p.y + CHIP_H / 2 + c * CHIP_H, p.z + oz + jitter * 0.001);
          this._e.set(0, c * 0.7, 0);
          this._q.setFromEuler(this._e);
          this._m.compose(this._p, this._q, this._s);
          m.setMatrixAt(i, this._m);
          counts.set(s.denom.value, i + 1);
        }
      });
    }
    for (const [v, m] of this.meshes) {
      m.count = counts.get(v) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}

/** A canvas image of a chip (for the options bar). */
export function chipDataUrl(d: Denom, size = 64): string {
  const c = chipCanvas(d, 'top');
  const o = document.createElement('canvas');
  o.width = o.height = size;
  o.getContext('2d')!.drawImage(c, 0, 0, size, size);
  return o.toDataURL();
}
