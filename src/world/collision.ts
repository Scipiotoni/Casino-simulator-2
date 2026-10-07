/**
 * Static collision for the open world: axis-aligned boxes (buildings, walls, furniture),
 * circles (trees, posts) and walkable floors (bridge deck, building floors, ramps), all in
 * a uniform spatial hash. Characters and cars are circles pushed out of whatever they
 * overlap; the camera casts rays against the boxes.
 */

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  /** Cars ignore boxes marked `walkOnly` (e.g. low walls along a pavement they can't reach anyway). */
  tag?: string;
  /** Does it block the camera? */
  cam?: boolean;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  minY: number;
  maxY: number;
  tag?: string;
}

export interface Floor {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the floor at a point (flat floors return a constant). */
  y: (x: number, z: number) => number;
  tag?: string;
}

const CELL = 32;

function key(i: number, j: number): number {
  return (i + 4096) * 8192 + (j + 4096);
}

export class Collision {
  private boxes = new Map<number, Box[]>();
  private circles = new Map<number, Circle[]>();
  private floors = new Map<number, Floor[]>();
  private stamp = 0;
  private seen = new WeakMap<object, number>();

  private cells(minX: number, maxX: number, minZ: number, maxZ: number, fn: (k: number) => void): void {
    const i0 = Math.floor(minX / CELL);
    const i1 = Math.floor(maxX / CELL);
    const j0 = Math.floor(minZ / CELL);
    const j1 = Math.floor(maxZ / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(key(i, j));
  }

  private add<T>(map: Map<number, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.cells(minX, maxX, minZ, maxZ, (k) => {
      let arr = map.get(k);
      if (!arr) map.set(k, (arr = []));
      arr.push(item);
    });
  }

  private remove<T>(map: Map<number, T[]>, item: T, minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.cells(minX, maxX, minZ, maxZ, (k) => {
      const arr = map.get(k);
      if (!arr) return;
      const i = arr.indexOf(item);
      if (i >= 0) arr.splice(i, 1);
    });
  }

  addBox(b: Box): Box {
    this.add(this.boxes, b, b.minX, b.maxX, b.minZ, b.maxZ);
    return b;
  }

  removeBox(b: Box): void {
    this.remove(this.boxes, b, b.minX, b.maxX, b.minZ, b.maxZ);
  }

  addCircle(c: Circle): Circle {
    this.add(this.circles, c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r);
    return c;
  }

  removeCircle(c: Circle): void {
    this.remove(this.circles, c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r);
  }

  addFloor(f: Floor): Floor {
    this.add(this.floors, f, f.minX, f.maxX, f.minZ, f.maxZ);
    return f;
  }

  removeFloor(f: Floor): void {
    this.remove(this.floors, f, f.minX, f.maxX, f.minZ, f.maxZ);
  }

  /** Remove everything with a tag (e.g. a building being rebuilt). */
  removeTagged(tag: string): void {
    for (const map of [this.boxes, this.circles, this.floors] as Map<number, { tag?: string }[]>[]) {
      for (const [k, arr] of map) {
        const keep = arr.filter((x) => x.tag !== tag);
        if (keep.length !== arr.length) map.set(k, keep);
      }
    }
  }

  /** The highest floor under (x, z) that's no more than `step` above `y`, or null. */
  floorAt(x: number, z: number, y: number, step = 0.7): number | null {
    const arr = this.floors.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best: number | null = null;
    for (const f of arr) {
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      const fy = f.y(x, z);
      if (fy <= y + step && (best === null || fy > best)) best = fy;
    }
    return best;
  }

  /** Is there any floor at all over this spot (for things that snap to the highest one)? */
  topFloorAt(x: number, z: number): number | null {
    const arr = this.floors.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!arr) return null;
    let best: number | null = null;
    for (const f of arr) {
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      const fy = f.y(x, z);
      if (best === null || fy > best) best = fy;
    }
    return best;
  }

  /**
   * Push a circle (radius r, standing from y to y+h) out of everything it overlaps.
   * Returns true if it hit something. `pos` is modified in place.
   */
  resolve(pos: { x: number; z: number }, r: number, y: number, h: number, ignoreTag?: string): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.stamp++;
      this.cells(pos.x - r, pos.x + r, pos.z - r, pos.z + r, (k) => {
        const bs = this.boxes.get(k);
        if (bs) {
          for (const b of bs) {
            if (this.seen.get(b) === this.stamp) continue;
            this.seen.set(b, this.stamp);
            if (ignoreTag && b.tag === ignoreTag) continue;
            if (y + h <= b.minY || y >= b.maxY - 0.35) continue;
            const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
            const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
            let dx = pos.x - cx;
            let dz = pos.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 < 1e-8) {
              // Centre inside the box: push out the shortest way.
              const l = pos.x - b.minX;
              const rr = b.maxX - pos.x;
              const t = pos.z - b.minZ;
              const bb = b.maxZ - pos.z;
              const m = Math.min(l, rr, t, bb);
              if (m === l) pos.x = b.minX - r;
              else if (m === rr) pos.x = b.maxX + r;
              else if (m === t) pos.z = b.minZ - r;
              else pos.z = b.maxZ + r;
            } else {
              const d = Math.sqrt(d2);
              dx /= d;
              dz /= d;
              pos.x = cx + dx * r;
              pos.z = cz + dz * r;
            }
            moved = hit = true;
          }
        }
        const cs = this.circles.get(k);
        if (cs) {
          for (const c of cs) {
            if (this.seen.get(c) === this.stamp) continue;
            this.seen.set(c, this.stamp);
            if (ignoreTag && c.tag === ignoreTag) continue;
            if (y + h <= c.minY || y >= c.maxY - 0.35) continue;
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const rr = r + c.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 0.001;
            pos.x = c.x + (dx / d) * rr;
            pos.z = c.z + (dz / d) * rr;
            moved = hit = true;
          }
        }
      });
      if (!moved) break;
    }
    return hit;
  }

  /** Does a circle overlap anything solid (no pushing)? */
  blocked(x: number, z: number, r: number, y: number, h: number): boolean {
    const p = { x, z };
    return this.resolve(p, r, y, h) && Math.hypot(p.x - x, p.z - z) > 0.01;
  }

  /**
   * Distance along a ray (from o in direction d, normalised) to the first box that blocks
   * the camera, or maxDist if nothing does.
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, camOnly = true): number {
    let best = maxDist;
    this.stamp++;
    const ex = ox + dx * maxDist;
    const ez = oz + dz * maxDist;
    this.cells(Math.min(ox, ex), Math.max(ox, ex), Math.min(oz, ez), Math.max(oz, ez), (k) => {
      const bs = this.boxes.get(k);
      if (!bs) return;
      for (const b of bs) {
        if (this.seen.get(b) === this.stamp) continue;
        this.seen.set(b, this.stamp);
        if (camOnly && b.cam === false) continue;
        const t = rayBox(ox, oy, oz, dx, dy, dz, b);
        if (t !== null && t < best) best = t;
      }
    });
    return best;
  }

  /** Everything within r of a point (for interactions and AI). */
  boxesNear(x: number, z: number, r: number): Box[] {
    const out: Box[] = [];
    this.stamp++;
    this.cells(x - r, x + r, z - r, z + r, (k) => {
      const bs = this.boxes.get(k);
      if (!bs) return;
      for (const b of bs) {
        if (this.seen.get(b) === this.stamp) continue;
        this.seen.set(b, this.stamp);
        out.push(b);
      }
    });
    return out;
  }
}

/** Slab test: distance along the ray to the box, or null. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, b.minY, b.maxY],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
