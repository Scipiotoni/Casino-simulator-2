/**
 * Things you can walk up to and use: doors, seats, shop counters, for-sale signs, cars.
 * The nearest one you're facing shows a prompt; pressing E (or tapping the prompt) runs it.
 */

export interface Interactable {
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  label: string | (() => string);
  /** Shown under the label (price, hint). */
  sub?: string | (() => string);
  enabled?: () => boolean;
  action: () => void;
  /** Only usable on foot (default) or also from a car. */
  inVehicle?: boolean;
  /** Higher wins when two are equally close. */
  priority?: number;
}

export class Interactions {
  private items = new Map<string, Interactable>();
  private grid = new Map<number, Set<Interactable>>();
  private static CELL = 24;

  private key(x: number, z: number): number {
    return Math.floor(x / Interactions.CELL) * 100000 + Math.floor(z / Interactions.CELL);
  }

  add(i: Interactable): Interactable {
    this.remove(i.id);
    this.items.set(i.id, i);
    const k = this.key(i.x, i.z);
    let s = this.grid.get(k);
    if (!s) this.grid.set(k, (s = new Set()));
    s.add(i);
    return i;
  }

  remove(id: string): void {
    const i = this.items.get(id);
    if (!i) return;
    this.items.delete(id);
    this.grid.get(this.key(i.x, i.z))?.delete(i);
  }

  removePrefix(prefix: string): void {
    for (const id of [...this.items.keys()]) if (id.startsWith(prefix)) this.remove(id);
  }

  get(id: string): Interactable | undefined {
    return this.items.get(id);
  }

  /** Move an interactable (e.g. one attached to a car). */
  move(id: string, x: number, y: number, z: number): void {
    const i = this.items.get(id);
    if (!i) return;
    const k0 = this.key(i.x, i.z);
    const k1 = this.key(x, z);
    i.x = x;
    i.y = y;
    i.z = z;
    if (k0 !== k1) {
      this.grid.get(k0)?.delete(i);
      let s = this.grid.get(k1);
      if (!s) this.grid.set(k1, (s = new Set()));
      s.add(i);
    }
  }

  /** The best interactable for someone at (x, y, z) facing `yaw`. */
  find(x: number, y: number, z: number, yaw: number, inVehicle = false): Interactable | null {
    const C = Interactions.CELL;
    const ci = Math.floor(x / C);
    const cj = Math.floor(z / C);
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const s = this.grid.get(i * 100000 + j);
        if (!s) continue;
        for (const it of s) {
          if (inVehicle && !it.inVehicle) continue;
          if (it.enabled && !it.enabled()) continue;
          const dx = it.x - x;
          const dz = it.z - z;
          const d = Math.hypot(dx, dz);
          if (d > it.radius || Math.abs(it.y - y) > 3) continue;
          // Prefer things in front of you.
          const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
          const score = d * (1.6 - facing * 0.6) - (it.priority ?? 0);
          if (score < bestScore) {
            bestScore = score;
            best = it;
          }
        }
      }
    }
    return best;
  }
}

export function labelOf(i: Interactable): string {
  return typeof i.label === 'function' ? i.label() : i.label;
}

export function subOf(i: Interactable): string {
  if (!i.sub) return '';
  return typeof i.sub === 'function' ? i.sub() : i.sub;
}
