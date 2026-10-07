import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { VCOL, VCOL_GLOW, withRim } from './materials';

/**
 * A modelling kit: add primitives with a colour and a transform, then bake everything into
 * one geometry per material slot. Props, machines, vehicles and buildings are all built
 * this way, so a detailed model still costs only a couple of draw calls.
 */

export type Slot = 'matte' | 'glow' | 'shiny' | 'glass';

export const SHINY_VCOL = withRim(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x8a8a8a }), 0.5);
export const GLASS_VCOL = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 110, specular: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false });

export const SLOT_MATERIALS: Record<Slot, THREE.Material> = {
  matte: VCOL,
  glow: VCOL_GLOW,
  shiny: SHINY_VCOL,
  glass: GLASS_VCOL,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export interface Xf {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export function matrixOf(t: Xf): THREE.Matrix4 {
  _e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  _s.set(t.sx ?? 1, t.sy ?? t.sx ?? 1, t.sz ?? t.sx ?? 1);
  return _m.compose(_p, _q, _s);
}

function colorize(g: THREE.BufferGeometry, color: number | THREE.Color, keepUv: boolean): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv')) out.deleteAttribute(name);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (typeof color === 'number') _c.setHex(color);
  else _c.copy(color);
  const n = out.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  out = out as THREE.BufferGeometry;
  return out;
}

export class Kit {
  private parts: Record<Slot, THREE.BufferGeometry[]> = { matte: [], glow: [], shiny: [], glass: [] };
  /** Applied to everything added (push/pop a frame for sub-assemblies). */
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  push(t: Xf): this {
    const top = this.stack[this.stack.length - 1].clone();
    top.multiply(matrixOf(t).clone());
    this.stack.push(top);
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Add any geometry (consumed) with a colour, in the current frame. */
  add(g: THREE.BufferGeometry, color: number | THREE.Color, t: Xf = {}, slot: Slot = 'matte'): this {
    const c = colorize(g, color, false);
    c.applyMatrix4(matrixOf(t));
    c.applyMatrix4(this.stack[this.stack.length - 1]);
    this.parts[slot].push(c);
    return this;
  }

  box(w: number, h: number, d: number, color: number, t: Xf = {}, slot: Slot = 'matte'): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, t, slot);
  }

  /** Box sitting on y (its bottom at t.y). */
  block(w: number, h: number, d: number, color: number, t: Xf = {}, slot: Slot = 'matte'): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, { ...t, y: (t.y ?? 0) + h / 2 }, slot);
  }

  rbox(w: number, h: number, d: number, r: number, color: number, t: Xf = {}, slot: Slot = 'matte', seg = 2): this {
    const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
    return this.add(new RoundedBoxGeometry(w, h, d, seg, Math.max(0.001, rr)), color, t, slot);
  }

  cyl(rt: number, rb: number, h: number, color: number, t: Xf = {}, slot: Slot = 'matte', seg = 12, open = false): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, t, slot);
  }

  sphere(r: number, color: number, t: Xf = {}, slot: Slot = 'matte', ws = 12, hs = 8): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs), color, t, slot);
  }

  cone(r: number, h: number, color: number, t: Xf = {}, slot: Slot = 'matte', seg = 10): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, t, slot);
  }

  torus(r: number, tube: number, color: number, t: Xf = {}, slot: Slot = 'matte', arc = Math.PI * 2, rs = 6, ts = 18): this {
    return this.add(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, t, slot);
  }

  lathe(pts: [number, number][], color: number, t: Xf = {}, slot: Slot = 'matte', seg = 14): this {
    return this.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, t, slot);
  }

  /** Extrude a 2D outline (x, y) along z by `depth`, centred on z. */
  extrude(shape: THREE.Shape, depth: number, color: number, t: Xf = {}, slot: Slot = 'matte', bevel = 0, curveSegments = 8): this {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 2,
      curveSegments,
    });
    g.translate(0, 0, -depth / 2);
    return this.add(g, color, t, slot);
  }

  plane(w: number, h: number, color: number, t: Xf = {}, slot: Slot = 'matte'): this {
    return this.add(new THREE.PlaneGeometry(w, h), color, t, slot);
  }

  isEmpty(): boolean {
    return Object.values(this.parts).every((a) => a.length === 0);
  }

  /** Bake into merged geometries, one per slot used. */
  bakeGeometries(): Partial<Record<Slot, THREE.BufferGeometry>> {
    const out: Partial<Record<Slot, THREE.BufferGeometry>> = {};
    for (const slot of Object.keys(this.parts) as Slot[]) {
      const list = this.parts[slot];
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      this.parts[slot] = [];
      if (g) {
        g.computeBoundingSphere();
        g.computeBoundingBox();
        out[slot] = g;
      }
    }
    return out;
  }

  /** Bake into a group of meshes (one per slot). */
  bake(opts: { shadows?: boolean; materials?: Partial<Record<Slot, THREE.Material>> } = {}): THREE.Group {
    const group = new THREE.Group();
    const geos = this.bakeGeometries();
    for (const slot of Object.keys(geos) as Slot[]) {
      const m = new THREE.Mesh(geos[slot]!, opts.materials?.[slot] ?? SLOT_MATERIALS[slot]);
      m.castShadow = !!opts.shadows && slot !== 'glow' && slot !== 'glass';
      m.receiveShadow = !!opts.shadows && slot !== 'glow';
      if (slot === 'glass') m.renderOrder = 2;
      m.name = slot;
      group.add(m);
    }
    return group;
  }
}

/** A rounded-rectangle 2D shape (for extrusions). */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
