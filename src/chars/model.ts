import * as THREE from 'three';
import { noise2 } from '../core/noise';
import { matrixOf, type Xf } from '../render/kit';
import { withRim } from '../render/materials';
import { expressionOffset, faceAtlas, type Expression } from './faces';
import { bodyParts } from './bodies';
import type { Appearance, Outfit } from './skins';

/**
 * Stylized hero characters. The whole body is ONE skinned mesh (plus a painted face decal):
 * smooth lathed limbs and torso whose vertices are weighted across neighbouring bones, so
 * elbows, knees and the spine bend smoothly like a real game character, while costing two
 * draw calls. Outfits are layers on top: jackets, vests, hoodies, armour, skirts, shoes,
 * hats, glasses and back bling, all baked into the same mesh with vertex colours.
 */

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', foreArmL: 'upperArmL', handL: 'foreArmL',
  upperArmR: 'chest', foreArmR: 'upperArmR', handR: 'foreArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

type V3 = [number, number, number];

/** Rest-pose bone positions in model space (character faces +z, its left is +x). */
function restPose(f: boolean): Record<BoneName, V3> {
  const sh = f ? 0.192 : 0.212;
  const hip = f ? 0.098 : 0.094;
  return {
    root: [0, 0, 0], hips: [0, 0.96, 0], spine: [0, 1.1, 0], chest: [0, 1.28, 0], neck: [0, 1.49, 0], head: [0, 1.57, 0.005],
    upperArmL: [sh, 1.43, 0], foreArmL: [sh + 0.02, 1.15, -0.005], handL: [sh + 0.035, 0.89, 0.01],
    upperArmR: [-sh, 1.43, 0], foreArmR: [-sh - 0.02, 1.15, -0.005], handR: [-sh - 0.035, 0.89, 0.01],
    thighL: [hip, 0.93, 0], shinL: [hip + 0.005, 0.51, 0.012], footL: [hip + 0.008, 0.085, -0.01],
    thighR: [-hip, 0.93, 0], shinR: [-hip - 0.005, 0.51, 0.012], footR: [-hip - 0.008, 0.085, -0.01],
  };
}

// ------------------------------------------------------------------ geometry builder

type ColorFn = (x: number, y: number, z: number) => number;

interface Chain {
  bones: number[];
  /** Model-space point where each pair hands over, along `dir`. */
  joints: V3[];
  dir: V3;
  r: number;
}

interface PartOpts {
  bone?: number;
  chain?: Chain;
  color: number | ColorFn;
  xf?: Xf;
  glow?: boolean;
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

class SkinBuilder {
  private slots: { pos: number[]; nor: number[]; col: number[]; si: number[]; sw: number[] }[] = [
    { pos: [], nor: [], col: [], si: [], sw: [] },
    { pos: [], nor: [], col: [], si: [], sw: [] },
  ];

  add(geo: THREE.BufferGeometry, o: PartOpts): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const m = matrixOf(o.xf ?? {}).clone();
    _nm.getNormalMatrix(m);
    const p = g.getAttribute('position');
    const nr = g.getAttribute('normal');
    const s = this.slots[o.glow ? 1 : 0];
    for (let i = 0; i < p.count; i++) {
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      _n.set(nr.getX(i), nr.getY(i), nr.getZ(i)).applyMatrix3(_nm).normalize();
      s.pos.push(_v.x, _v.y, _v.z);
      s.nor.push(_n.x, _n.y, _n.z);
      const col = typeof o.color === 'function' ? o.color(_v.x, _v.y, _v.z) : o.color;
      _c.setHex(col);
      s.col.push(_c.r, _c.g, _c.b);
      if (o.chain) {
        const [b0, b1, w1] = chainWeights(o.chain, _v.x, _v.y, _v.z);
        s.si.push(b0, b1, 0, 0);
        s.sw.push(1 - w1, w1, 0, 0);
      } else {
        s.si.push(o.bone ?? 0, 0, 0, 0);
        s.sw.push(1, 0, 0, 0);
      }
    }
    geo.dispose();
    if (g !== geo) g.dispose();
  }

  /**
   * Add a mesh that is already skinned (the Blender body): its own bone indices and weights,
   * coloured per vertex. `bulk` widens it round each bone (heavier or slimmer builds).
   */
  addSkinned(geo: THREE.BufferGeometry, color: (x: number, y: number, z: number, bone: number) => number, bulk: number, rest: Record<BoneName, V3>): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position');
    const nr = g.getAttribute('normal');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const s = this.slots[0];
    for (let i = 0; i < p.count; i++) {
      // The bone with the most say colours the vertex.
      let bone = si.getX(i);
      let best = sw.getX(i);
      for (let k = 1; k < 4; k++) {
        if (sw.getComponent(i, k) > best) {
          best = sw.getComponent(i, k);
          bone = si.getComponent(i, k);
        }
      }
      let x = p.getX(i);
      const y = p.getY(i);
      let z = p.getZ(i);
      if (bulk !== 1) {
        const r = rest[BONES[bone]];
        const ax = bone === B.root || bone === B.hips || bone === B.spine || bone === B.chest || bone === B.neck || bone === B.head ? 0 : r[0];
        x = ax + (x - ax) * bulk;
        z = r[2] + (z - r[2]) * (0.5 + bulk * 0.5);
      }
      s.pos.push(x, y, z);
      s.nor.push(nr.getX(i), nr.getY(i), nr.getZ(i));
      _c.setHex(color(x, y, z, bone));
      s.col.push(_c.r, _c.g, _c.b);
      for (let k = 0; k < 4; k++) {
        s.si.push(si.getComponent(i, k));
        s.sw.push(sw.getComponent(i, k));
      }
    }
    if (g !== geo) g.dispose();
  }

  build(): THREE.BufferGeometry {
    const [a, b] = this.slots;
    const pos = [...a.pos, ...b.pos];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([...a.nor, ...b.nor], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([...a.col, ...b.col], 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([...a.si, ...b.si], 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([...a.sw, ...b.sw], 4));
    const na = a.pos.length / 3;
    const nb = b.pos.length / 3;
    g.addGroup(0, na, 0);
    if (nb) g.addGroup(na, nb, 1);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.3);
    return g;
  }
}

function smooth01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Which two bones a vertex follows, and how much of the second (joints sorted along dir). */
function chainWeights(c: Chain, x: number, y: number, z: number): [number, number, number] {
  const [dx, dy, dz] = c.dir;
  const t = x * dx + y * dy + z * dz;
  for (let i = 0; i < c.joints.length; i++) {
    const [jx, jy, jz] = c.joints[i];
    const tj = jx * dx + jy * dy + jz * dz;
    if (t < tj - c.r) return [c.bones[i], c.bones[i], 0];
    if (t <= tj + c.r) return [c.bones[i], c.bones[i + 1], smooth01(tj - c.r, tj + c.r, t)];
  }
  const last = c.bones[c.bones.length - 1];
  return [last, last, 0];
}

// Geometry shorthands. LOW switches to the far-away version (fewer segments).
let LOW = false;
const seg = (n: number, min = 4) => (LOW ? Math.max(min, Math.round(n * 0.45)) : n);
/** Drop every other ring of a profile (keeping the ends) for the low-detail body. */
function thin(pts: [number, number][]): [number, number][] {
  if (!LOW || pts.length < 6) return pts;
  return pts.filter((_, i) => i === 0 || i === pts.length - 1 || i % 2 === 1);
}
const lathe = (pts: [number, number][], sg = 14, phiStart = 0, phiLength = Math.PI * 2) =>
  new THREE.LatheGeometry(thin(pts).map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), seg(sg, 6), phiStart, phiLength);
const sphere = (r: number, ws = 12, hs = 9) => new THREE.SphereGeometry(r, seg(ws, 5), seg(hs, 4));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, sg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg(sg, 5));
const cone = (r: number, h: number, sg = 8) => new THREE.ConeGeometry(r, h, seg(sg, 4));
const torus = (r: number, t: number, arc = Math.PI * 2, rs = 6, ts = 14) => new THREE.TorusGeometry(r, t, seg(rs, 3), seg(ts, 6), arc);
function rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  // A box with bevelled edges: an extruded rounded rectangle.
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const bev = Math.min(r, d / 2 - 0.0005) * 0.8;
  if (LOW) return new THREE.BoxGeometry(w, h, d);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - bev * 2), bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - bev * 2) / 2);
  return g;
}

/** Add rings just either side of colour boundaries so clothing edges are crisp. */
function shade(c: number, k: number): number {
  _c.setHex(c).multiplyScalar(k);
  return _c.getHex();
}

// ------------------------------------------------------------------ body parts

const HEAD_PROFILE: [number, number][] = [
  [0.0, -0.004], [0.05, 0.0], [0.082, 0.02], [0.101, 0.05], [0.112, 0.09], [0.117, 0.13],
  [0.116, 0.17], [0.108, 0.205], [0.09, 0.233], [0.056, 0.254], [0.0, 0.263],
];
const HEAD_Z = 1.06;

function headRadiusAt(y: number): number {
  for (let i = 0; i < HEAD_PROFILE.length - 1; i++) {
    const [r0, y0] = HEAD_PROFILE[i];
    const [r1, y1] = HEAD_PROFILE[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

/** The part of the head profile between two heights, pushed out by `grow`. */
function headSlice(y0: number, y1: number, grow: number, n = 8): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    pts.push([headRadiusAt(y) * grow + 0.002, y]);
  }
  return pts;
}

interface Built {
  geometry: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
}

const cache = new Map<string, Built>();

function camo(x: number, y: number, z: number, o: Outfit): number {
  const n = noise2(x * 22 + z * 9, y * 22 - z * 7);
  return n > 0.25 ? o.c2 : n < -0.3 ? 0x2a2a1e : o.c1;
}

function buildCharacter(a: Appearance): Built {
  LOW = false;
  const hi = buildBody(a);
  LOW = true;
  const lo = buildBody(a);
  LOW = false;
  lo.face.dispose();
  return { geometry: hi.geometry, low: lo.geometry, face: hi.face };
}

function buildBody(a: Appearance): { geometry: THREE.BufferGeometry; face: THREE.BufferGeometry } {
  const f = a.body === 'f';
  const R = restPose(f);
  const o = a.outfit;
  const sb = new SkinBuilder();
  const skin = a.skin;
  const bulk = a.build;
  const body = bodyParts(f);
  const torsoChain: Chain = { bones: [B.hips, B.spine, B.chest], joints: [[0, 1.02, 0], [0, 1.22, 0]], dir: [0, 1, 0], r: 0.06 };
  const zs = f ? 0.68 : 0.66;
  const skirted = o.top === 'dress' || o.bottom === 'skirt';
  const pantsTop = o.top === 'dress' ? 0 : 1.0;
  const sleeveEnd = sleeveLength(o);
  const pantsEnd = o.bottom === 'shorts' ? 0.57 : skirted ? 2 : 0.12;
  const topColor = (x: number, y: number, z: number): number => {
    if (y < pantsTop) return o.bottom === 'camo' ? camo(x, y, z, o) : o.pants;
    switch (o.top) {
      case 'hawaiian': {
        const n = noise2(x * 30 + 3, y * 30 + z * 20);
        return n > 0.35 ? o.c2 : n < -0.42 ? o.accent : o.c1;
      }
      case 'racing':
        return Math.abs(x) < 0.04 && z > 0 ? o.c2 : y > 1.3 && y < 1.36 ? o.c2 : o.c1;
      case 'military':
        return camo(x, y, z, o);
      case 'tank':
        return y > 1.44 && Math.abs(x) > 0.09 ? skin : o.c1;
      case 'dress':
        return y > 1.42 && (Math.abs(x) > 0.07 || z < -0.02) ? skin : o.c1;
      case 'suit':
      case 'tux':
      case 'vest':
        return 0xf7f7f7; // the shirt under the jacket
      case 'jacket':
      case 'coat':
        return o.c2;
      default:
        return o.c1;
    }
  };
  // Jackets, vests, hoodies and plate carriers are painted onto the body (no shells to gap).
  const layerColor = (x: number, y: number, z: number): number => {
    const front = z > 0.02;
    switch (o.top) {
      case 'suit':
      case 'tux': {
        // Jacket with a V of shirt, darker lapel edges and a row of buttons.
        const v = (y - 1.12) * 0.42;
        if (front && y > 1.12 && Math.abs(x) < v) return 0xf7f7f7;
        if (front && y > 1.12 && Math.abs(x) < v + 0.018) return o.top === 'tux' ? 0x111111 : shade(o.c1, 0.75);
        if (front && Math.abs(x) < 0.007 && y < 1.12 && y > 1.0) return o.accent;
        return o.c1;
      }
      case 'jacket':
      case 'coat': {
        // Open front: the tee shows down the middle, a zip on each edge.
        const open = 0.032 + (y - 1.0) * 0.05;
        if (front && Math.abs(x) < open) return o.c2;
        if (front && Math.abs(x) < open + 0.008) return o.accent;
        return o.c1;
      }
      case 'vest': {
        const v = (y - 1.1) * 0.38;
        if (front && y > 1.1 && Math.abs(x) < v) return 0xf7f7f7;
        return y > 1.47 ? 0xf7f7f7 : o.c2;
      }
      case 'hoodie':
        if (front && y > 1.03 && y < 1.12 && Math.abs(x) < 0.1) return shade(o.c1, 0.85);
        if (front && y > 1.31 && y < 1.44 && Math.abs(Math.abs(x) - 0.035) < 0.004) return o.accent;
        return o.c1;
      case 'military':
        // Plate carrier with a row of pouches over the camo shirt.
        if (y > 1.05 && y < 1.46) return front && y > 1.1 && y < 1.18 && Math.abs(x) < 0.11 ? shade(o.c2, 0.8) : o.c2;
        return topColor(x, y, z);
      default:
        return topColor(x, y, z);
    }
  };
  // The body itself: one continuous skinned surface from Blender, coloured by where each
  // vertex is (clothes are regions of the same skin, so nothing gaps at the joints).
  const color = (x: number, y: number, z: number, bone: number): number => {
    switch (bone) {
      case B.head:
      case B.neck:
        return y < 1.47 && o.top !== 'tank' && o.top !== 'dress' ? topColor(x, 1.46, z) : skin;
      case B.hips:
      case B.spine:
      case B.chest:
        if (y < 1.0 && skirted) return o.top === 'dress' ? o.c1 : o.pants;
        return y < pantsTop ? topColor(x, y, z) : layerColor(x, y, z);
      case B.upperArmL:
      case B.upperArmR:
      case B.foreArmL:
      case B.foreArmR:
        if (y > sleeveEnd) return o.top === 'jacket' || o.top === 'suit' || o.top === 'tux' || o.top === 'coat' || o.top === 'hoodie' ? o.c1 : sleeveColor(o, x, y, z, skin);
        return skin;
      case B.handL:
      case B.handR:
        return o.gloves ? o.c2 : skin;
      case B.footL:
      case B.footR:
        return o.shoe;
      default:
        // Thighs and shins.
        if (o.top === 'coat' && y > 0.62) return o.c1;
        if (o.shoes === 'boots' && y < 0.32) return o.shoe;
        if (y > pantsEnd) return o.bottom === 'camo' ? camo(x, y, z, o) : o.pants;
        return skin;
    }
  };
  sb.addSkinned(LOW ? body.lo : body.hi, color, bulk, R);
  if (skirted) sb.addSkinned(body.skirt, () => (o.top === 'dress' ? o.c1 : o.pants), bulk, R);

  // Face decal: the face patch from the model, its UVs scaled into one atlas cell.
  const faceGeo = body.face.clone();
  faceGeo.deleteAttribute('skinIndex');
  faceGeo.deleteAttribute('skinWeight');

  // ---- hair
  const hy = R.head[1] - 0.03;
  buildHair(sb, a, hy);
  buildHat(sb, a, hy);
  buildGlasses(sb, a, hy);

  // ---- arms: cuffs on long sleeves
  for (const side of [1, -1]) {
    const L = side > 0;
    const wr = R[L ? 'handL' : 'handR'];
    if (sleeveEnd < 1.0 && o.top !== 'armor') sb.add(cyl(0.041, 0.041, 0.035, 10), { bone: B[L ? 'foreArmL' : 'foreArmR'], color: shade(sleeveColor(o, 0, 1, 0, skin), 0.85), xf: { x: wr[0] - side * 0.003, y: wr[1] + 0.075, z: wr[2] } });
  }

  // ---- legs: pockets, pads, shoes
  for (const side of [1, -1]) {
    const L = side > 0;
    const th = R[L ? 'thighL' : 'thighR'];
    const kn = R[L ? 'shinL' : 'shinR'];
    const an = R[L ? 'footL' : 'footR'];
    // Cargo pockets.
    if (o.bottom === 'cargo' || o.bottom === 'camo') sb.add(rbox(0.03, 0.11, 0.09, 0.01), { bone: B[L ? 'thighL' : 'thighR'], color: shade(o.pants, 0.85), xf: { x: th[0] + side * 0.09, y: 0.68, z: 0.0 } });
    // Knee pads for the military look.
    if (o.top === 'military' || o.top === 'armor') sb.add(rbox(0.09, 0.09, 0.05, 0.02), { bone: B[L ? 'shinL' : 'shinR'], color: o.top === 'armor' ? o.c1 : 0x2a2a20, xf: { x: kn[0], y: kn[1], z: 0.06 } });
    buildShoe(sb, o, B[L ? 'footL' : 'footR'], an, skin);
  }

  // ---- outfit layers
  buildTop(sb, a, torsoChain, zs);
  buildNeck(sb, o, hy);
  buildBack(sb, o);

  const geometry = sb.build();
  return { geometry, face: faceGeo };
}

function sleeveLength(o: Outfit): number {
  switch (o.top) {
    case 'tank':
    case 'dress':
      return 9; // no sleeves
    case 'tee':
    case 'hawaiian':
    case 'military':
      return 1.27;
    default:
      return 0.95;
  }
}

function sleeveColor(o: Outfit, x: number, y: number, z: number, skin: number): number {
  switch (o.top) {
    case 'vest':
      return 0xf7f7f7;
    case 'racing':
      return Math.abs(z) < 0.012 && y > 1.0 ? o.c2 : o.c1;
    case 'military':
      return camo(x, y, z, o);
    case 'hawaiian': {
      const n = noise2(x * 30 + 3, y * 30 + z * 20);
      return n > 0.35 ? o.c2 : o.c1;
    }
    case 'tank':
    case 'dress':
      return skin;
    default:
      return o.c1;
  }
}

function buildShoe(sb: SkinBuilder, o: Outfit, bone: number, an: V3, skin: number): void {
  const [x, y, z] = an;
  const sole = o.shoes === 'sneakers' ? 0xf4f4f4 : o.shoes === 'boots' ? 0x2a1d14 : 0x1a1a1a;
  switch (o.shoes) {
    case 'sandals':
      sb.add(rbox(0.09, 0.022, 0.23, 0.01), { bone, color: 0x8a5a3a, xf: { x, y: 0.011, z: z + 0.045 } });
      sb.add(rbox(0.075, 0.05, 0.19, 0.022), { bone, color: skin, xf: { x, y: 0.045, z: z + 0.045 } });
      sb.add(box(0.08, 0.012, 0.03), { bone, color: o.shoe, xf: { x, y: 0.07, z: z + 0.07 } });
      break;
    case 'heels':
      sb.add(rbox(0.07, 0.07, 0.19, 0.025), { bone, color: o.shoe, xf: { x, y: 0.07, z: z + 0.05, rx: -0.25 } });
      sb.add(cyl(0.008, 0.012, 0.08, 6), { bone, color: o.shoe, xf: { x, y: 0.04, z: z - 0.035 } });
      break;
    case 'boots':
      sb.add(rbox(0.1, 0.1, 0.25, 0.03), { bone, color: o.shoe, xf: { x, y: 0.055, z: z + 0.05 } });
      sb.add(cyl(0.056, 0.05, 0.16, 10), { bone, color: o.shoe, xf: { x, y: y + 0.06, z } });
      sb.add(rbox(0.105, 0.03, 0.26, 0.01), { bone, color: sole, xf: { x, y: 0.015, z: z + 0.05 } });
      break;
    default: {
      // Chunky sneakers / loafers with a contrasting sole and a side stripe.
      sb.add(rbox(0.096, 0.085, 0.245, 0.035), { bone, color: o.shoe, xf: { x, y: 0.055, z: z + 0.048 } });
      sb.add(rbox(0.104, 0.03, 0.255, 0.012), { bone, color: sole, xf: { x, y: 0.016, z: z + 0.05 } });
      if (o.shoes === 'sneakers' && !LOW) {
        for (const s of [-1, 1]) sb.add(box(0.004, 0.025, 0.11), { bone, color: o.accent, xf: { x: x + s * 0.049, y: 0.06, z: z + 0.04, rx: 0.2 }, glow: o.glow });
      }
    }
  }
}

function buildTop(sb: SkinBuilder, a: Appearance, _chain: Chain, zs: number): void {
  const o = a.outfit;
  // The garments themselves are painted onto the body (see buildBody); these are the parts
  // that stand off it: collars, the hood, armour plates, the plate carrier's belt.
  switch (o.top) {
    case 'racing':
      sb.add(torus(0.062, 0.018, Math.PI * 2, 6, 16), { bone: B.chest, color: o.c2, xf: { y: 1.5, rx: Math.PI / 2 } });
      break;
    case 'coat':
      sb.add(torus(0.115, 0.04, Math.PI * 2, 6, 18), { bone: B.chest, color: o.accent, xf: { y: 1.48, rx: Math.PI / 2, sz: 0.75 } });
      break;
    case 'hoodie':
      // The hood resting on the shoulders.
      sb.add(torus(0.1, 0.05, Math.PI * 1.3, 8, 16), { bone: B.chest, color: o.c2, xf: { y: 1.49, z: -0.04, rx: Math.PI / 2 - 0.25, rz: -Math.PI * 0.15 + Math.PI, sx: 1.15 } });
      if (o.glow) sb.add(torus(0.17, 0.006, Math.PI * 2, 4, 24), { bone: B.spine, color: o.accent, xf: { y: 1.02, rx: Math.PI / 2, sz: 0.68 }, glow: true });
      break;
    case 'military':
      sb.add(box(0.37, 0.035, 0.25), { bone: B.hips, color: 0x2a2a20, xf: { y: 1.0, sz: 0.95 } });
      break;
    case 'armor': {
      sb.add(rbox(0.42, 0.27, 0.29, 0.07), { bone: B.chest, color: o.c1, xf: { y: 1.32, z: 0.012 } });
      sb.add(rbox(0.36, 0.14, 0.25, 0.05), { bone: B.spine, color: o.c2, xf: { y: 1.12, z: 0.008 } });
      for (const s of [-1, 1]) {
        sb.add(sphere(0.09, 10, 8), { bone: B[s > 0 ? 'upperArmL' : 'upperArmR'], color: o.c1, xf: { x: s * 0.215, y: 1.44, sy: 0.75 } });
        sb.add(box(0.012, 0.16, 0.012), { bone: B.chest, color: o.accent, xf: { x: s * 0.09, y: 1.32, z: 0.158 }, glow: true });
      }
      sb.add(torus(0.05, 0.01, Math.PI * 2, 6, 16), { bone: B.chest, color: o.accent, xf: { y: 1.34, z: 0.162 }, glow: true });
      break;
    }
    case 'dress':
      if (o.glow) sb.add(torus(0.27, 0.006, Math.PI * 2, 4, 28), { bone: B.hips, color: o.accent, xf: { y: 0.565, rx: Math.PI / 2, sy: 0.82 }, glow: true });
      break;
    default:
      break;
  }
  // Belt for trousers.
  if (o.top !== 'dress' && o.bottom !== 'skirt' && o.top !== 'military') {
    const br = (a.body === 'f' ? 0.178 : 0.172) * a.build * 1.04;
    sb.add(cyl(br, br, 0.036, 24), { bone: B.hips, color: 0x2a1d14, xf: { y: 1.0, sz: zs * 1.04 } });
    sb.add(box(0.04, 0.03, 0.01), { bone: B.hips, color: 0xd8b04a, xf: { y: 1.0, z: br * zs * 1.04 + 0.004 } });
  }
}

function buildNeck(sb: SkinBuilder, o: Outfit, hy: number): void {
  switch (o.neck) {
    case 'chain':
      sb.add(torus(0.085, 0.009, Math.PI * 2, 5, 18), { bone: B.chest, color: 0xf2c230, xf: { y: 1.47, z: 0.03, rx: Math.PI / 2 - 0.5, sx: 1.05 } });
      sb.add(sphere(0.018, 8, 6), { bone: B.chest, color: 0xf2c230, xf: { y: 1.4, z: 0.122 } });
      break;
    case 'bowtie':
      for (const s of [-1, 1]) sb.add(cone(0.025, 0.05, 4), { bone: B.neck, color: o.accent, xf: { x: s * 0.025, y: 1.49, z: 0.06, rz: s * Math.PI / 2 } });
      break;
    case 'tie':
      sb.add(box(0.035, 0.24, 0.008), { bone: B.chest, color: o.accent, xf: { y: 1.35, z: 0.128 } });
      break;
    case 'scarf':
      sb.add(torus(0.07, 0.03, Math.PI * 2, 6, 16), { bone: B.neck, color: o.accent, xf: { y: 1.5, rx: Math.PI / 2 } });
      sb.add(rbox(0.06, 0.16, 0.02, 0.01), { bone: B.chest, color: o.accent, xf: { x: 0.04, y: 1.4, z: 0.11, rz: 0.15 } });
      break;
    case 'mask':
      sb.add(lathe(headSlice(0.0, 0.085, 1.03, 6), 12, -1.3, 2.6), { bone: B.head, color: o.c2, xf: { y: hy, z: 0.01, sz: HEAD_Z * 1.02 } });
      sb.add(box(0.12, 0.006, 0.006), { bone: B.head, color: o.accent, xf: { y: hy + 0.07, z: 0.122 }, glow: o.glow });
      break;
    default:
      if (o.top === 'tee' || o.top === 'tank' || o.top === 'hawaiian') sb.add(torus(0.058, 0.012, Math.PI * 2, 5, 14), { bone: B.chest, color: shade(o.c1, 0.85), xf: { y: 1.5, rx: Math.PI / 2 } });
  }
}

function buildBack(sb: SkinBuilder, o: Outfit): void {
  const bone = B.chest;
  switch (o.back) {
    case 'backpack':
      sb.add(rbox(0.26, 0.32, 0.12, 0.05), { bone, color: o.c2, xf: { y: 1.27, z: -0.16 } });
      sb.add(rbox(0.2, 0.12, 0.05, 0.03), { bone, color: shade(o.c2, 0.85), xf: { y: 1.18, z: -0.23 } });
      for (const s of [-1, 1]) sb.add(box(0.03, 0.3, 0.02), { bone, color: 0x222222, xf: { x: s * 0.09, y: 1.33, z: 0.125, rx: -0.1 } });
      if (o.glow) sb.add(box(0.2, 0.012, 0.012), { bone, color: o.accent, xf: { y: 1.38, z: -0.225 }, glow: true });
      break;
    case 'surfboard':
      sb.add(new THREE.CapsuleGeometry(0.16, 1.2, 4, 10), { bone, color: o.accent, xf: { y: 1.2, z: -0.2, sx: 1, sz: 0.12, rz: 0.4 } });
      sb.add(box(0.03, 1.3, 0.03), { bone, color: 0xffffff, xf: { y: 1.2, z: -0.22, rz: 0.4 } });
      break;
    case 'dice':
      for (const [dx, dy, r] of [[-0.09, 1.32, 0.3], [0.1, 1.2, -0.4]] as const) {
        sb.add(rbox(0.16, 0.16, 0.16, 0.03), { bone, color: 0xffffff, xf: { x: dx, y: dy, z: -0.22, rz: r, rx: r } });
        sb.add(sphere(0.018, 6, 4), { bone, color: 0xd8202f, xf: { x: dx, y: dy, z: -0.14, rz: r } });
      }
      break;
    case 'chips':
      for (let i = 0; i < 5; i++) sb.add(cyl(0.09, 0.09, 0.025, 16), { bone, color: [0xd8202f, 0x111111, 0x2ecc71, 0x1e6bff, 0xf2c230][i], xf: { y: 1.12 + i * 0.03, z: -0.2, rx: Math.PI / 2 - 0.1 } });
      break;
    case 'wings':
      for (const s of [-1, 1]) {
        const sh = new THREE.Shape();
        sh.moveTo(0, 0);
        sh.quadraticCurveTo(0.3, 0.25, 0.55, 0.35);
        sh.quadraticCurveTo(0.4, 0.05, 0.5, -0.25);
        sh.quadraticCurveTo(0.2, -0.05, 0, 0);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: false, curveSegments: 6 });
        sb.add(g, { bone, color: o.accent, xf: { x: s * 0.05, y: 1.32, z: -0.18, ry: s > 0 ? -0.35 : Math.PI + 0.35 }, glow: true });
      }
      break;
    case 'cape': {
      const cape = lathe([[0.12, 1.48], [0.2, 1.3], [0.26, 0.9], [0.3, 0.45]], 14, Math.PI * 0.62, Math.PI * 0.76);
      sb.add(cape, { bone, color: (_x, y) => (y > 1.42 ? o.accent : 0xb8202f), xf: { sz: 0.8 } });
      break;
    }
    case 'guitar':
      sb.add(sphere(0.16, 12, 8), { bone, color: 0xb8662f, xf: { y: 1.05, z: -0.2, sz: 0.25 } });
      sb.add(box(0.05, 0.5, 0.03), { bone, color: 0x3a2416, xf: { y: 1.4, z: -0.2, rz: 0.3 } });
      break;
    default:
      break;
  }
}

function buildHair(sb: SkinBuilder, a: Appearance, hy: number): void {
  const c = a.hairColor;
  const head = B.head;
  const cap = (y0: number, grow: number, color = c) => sb.add(lathe(headSlice(y0, 0.266, grow, 7), 18), { bone: head, color, xf: { y: hy, z: 0.008, sz: HEAD_Z * grow } });
  const backHalf = (y0: number, y1: number, grow: number) => sb.add(lathe(headSlice(y0, y1, grow, 6), 16, Math.PI * 0.32, Math.PI * 1.36), { bone: head, color: c, xf: { y: hy, z: 0.008, sz: HEAD_Z * grow } });
  const blob = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
    sb.add(sphere(r, 10, 8), { bone: head, color: c, xf: { x, y: hy + y, z, sx, sy, sz, rx, rz } });
  switch (a.hair) {
    case 'bald':
      return;
    case 'buzz':
      cap(0.16, 1.025);
      backHalf(0.09, 0.17, 1.02);
      return;
    case 'short':
      cap(0.17, 1.06);
      backHalf(0.08, 0.18, 1.05);
      blob(0.06, 0.03, 0.225, 0.085, 1.4, 0.6, 0.8, 0.3, -0.3);
      return;
    case 'spiky':
      cap(0.16, 1.05);
      backHalf(0.08, 0.17, 1.04);
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * Math.PI * 2;
        sb.add(cone(0.045, 0.13, 6), { bone: head, color: c, xf: { x: Math.sin(ang) * 0.06, y: hy + 0.25, z: Math.cos(ang) * 0.06 + 0.01, rx: Math.cos(ang) * 0.6, rz: -Math.sin(ang) * 0.6 } });
      }
      return;
    case 'quiff':
      cap(0.17, 1.05);
      backHalf(0.08, 0.18, 1.04);
      blob(0.075, 0.0, 0.26, 0.06, 1.25, 0.75, 1.1, -0.4, 0);
      blob(0.055, 0.03, 0.28, 0.1, 1.1, 0.7, 1, -0.6, 0);
      return;
    case 'mohawk':
      cap(0.15, 1.015, shade(a.skin, 0.9));
      for (let i = 0; i < 6; i++) sb.add(box(0.035, 0.12, 0.05), { bone: head, color: c, xf: { y: hy + 0.25 + Math.sin((i / 5) * Math.PI) * 0.03, z: -0.09 + i * 0.04, rx: -0.3 + i * 0.12 } });
      return;
    case 'afro':
      blob(0.15, 0, 0.19, -0.01, 1.05, 0.95, 1.05);
      return;
    case 'long':
      cap(0.17, 1.06);
      backHalf(0.0, 0.18, 1.06);
      sb.add(rbox(0.2, 0.3, 0.06, 0.03), { bone: B.chest, color: c, xf: { y: 1.46, z: -0.11, rx: 0.12 } });
      for (const s of [-1, 1]) sb.add(rbox(0.05, 0.22, 0.05, 0.02), { bone: head, color: c, xf: { x: s * 0.095, y: hy + 0.07, z: 0.02 } });
      blob(0.06, -0.04, 0.22, 0.09, 1.5, 0.55, 0.8, 0.3, 0.3);
      return;
    case 'ponytail':
      cap(0.17, 1.05);
      backHalf(0.08, 0.18, 1.04);
      sb.add(new THREE.CapsuleGeometry(0.04, 0.2, 4, 8), { bone: head, color: c, xf: { y: hy + 0.12, z: -0.15, rx: 0.5 } });
      sb.add(sphere(0.035, 8, 6), { bone: head, color: 0xff4f7a, xf: { y: hy + 0.2, z: -0.12 } });
      return;
    case 'bun':
      cap(0.17, 1.045);
      backHalf(0.08, 0.18, 1.04);
      blob(0.065, 0, 0.27, -0.06);
      return;
    case 'bob':
      cap(0.17, 1.07);
      backHalf(0.02, 0.18, 1.08);
      for (const s of [-1, 1]) sb.add(rbox(0.04, 0.16, 0.09, 0.02), { bone: head, color: c, xf: { x: s * 0.1, y: hy + 0.09, z: 0.03 } });
      blob(0.07, 0.0, 0.22, 0.08, 1.5, 0.5, 0.7, 0.4, 0);
      return;
    case 'braids':
      cap(0.16, 1.05);
      backHalf(0.06, 0.17, 1.04);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 4; i++) sb.add(sphere(0.028, 8, 6), { bone: B.chest, color: c, xf: { x: s * 0.09, y: 1.5 - i * 0.055, z: 0.06 } });
      }
      return;
  }
}

function buildHat(sb: SkinBuilder, a: Appearance, hy: number): void {
  const o = a.outfit;
  const head = B.head;
  const top = hy + 0.266;
  switch (o.hat) {
    case 'cap':
      sb.add(lathe(headSlice(0.17, 0.266, 1.09, 6), 18), { bone: head, color: o.c2, xf: { y: hy, z: 0.008, sz: HEAD_Z * 1.09 } });
      sb.add(cyl(0.1, 0.1, 0.012, 16), { bone: head, color: o.c2, xf: { y: hy + 0.185, z: 0.12, sz: 0.7, rx: 0.12 } });
      break;
    case 'beanie':
      sb.add(lathe(headSlice(0.16, 0.266, 1.1, 6), 18), { bone: head, color: o.c2, xf: { y: hy, z: 0.008, sz: HEAD_Z * 1.1 } });
      sb.add(sphere(0.035, 8, 6), { bone: head, color: o.accent, xf: { y: top + 0.02 } });
      break;
    case 'tophat':
      sb.add(cyl(0.155, 0.155, 0.012, 20), { bone: head, color: 0x111111, xf: { y: top - 0.025 } });
      sb.add(cyl(0.095, 0.1, 0.2, 18), { bone: head, color: 0x111111, xf: { y: top + 0.07 } });
      sb.add(cyl(0.101, 0.101, 0.035, 18), { bone: head, color: o.accent, xf: { y: top + 0.0 } });
      break;
    case 'cowboy':
      sb.add(cyl(0.21, 0.21, 0.012, 20), { bone: head, color: 0x8a5a2b, xf: { y: top - 0.04, sz: 0.85 } });
      sb.add(cyl(0.085, 0.105, 0.12, 14), { bone: head, color: 0x8a5a2b, xf: { y: top + 0.01 } });
      break;
    case 'helmet':
      sb.add(lathe(headSlice(0.14, 0.266, 1.17, 6), 18), { bone: head, color: o.c2, xf: { y: hy, z: 0.0, sz: HEAD_Z * 1.15 } });
      sb.add(torus(0.125, 0.01, Math.PI * 2, 4, 20), { bone: head, color: shade(o.c2, 0.8), xf: { y: hy + 0.15, rx: Math.PI / 2, sy: 1.1 } });
      break;
    case 'fedora':
      sb.add(cyl(0.16, 0.16, 0.01, 20), { bone: head, color: 0x2a2a30, xf: { y: top - 0.03 } });
      sb.add(cyl(0.085, 0.1, 0.1, 14), { bone: head, color: 0x2a2a30, xf: { y: top + 0.02 } });
      sb.add(cyl(0.101, 0.101, 0.02, 14), { bone: head, color: o.accent, xf: { y: top - 0.015 } });
      break;
    case 'visor':
      sb.add(torus(0.105, 0.01, Math.PI * 2, 4, 18), { bone: head, color: o.c2, xf: { y: hy + 0.18, rx: Math.PI / 2, sy: 1.1 } });
      sb.add(cyl(0.09, 0.09, 0.01, 14), { bone: head, color: o.c2, xf: { y: hy + 0.18, z: 0.11, sz: 0.7, rx: 0.15 } });
      break;
    case 'beret':
      sb.add(sphere(0.12, 12, 6), { bone: head, color: 0x7a1020, xf: { x: 0.02, y: top - 0.035, sy: 0.32, rz: 0.2 } });
      break;
    case 'crown':
      sb.add(cyl(0.1, 0.095, 0.07, 14, ), { bone: head, color: 0xf2c230, xf: { y: top - 0.0 } });
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        sb.add(cone(0.022, 0.06, 4), { bone: head, color: 0xf2c230, xf: { x: Math.sin(ang) * 0.095, y: top + 0.06, z: Math.cos(ang) * 0.095 } });
        sb.add(sphere(0.012, 6, 4), { bone: head, color: [0xff2a3a, 0x3fa0ff, 0x2ecc71][i % 3], xf: { x: Math.sin(ang) * 0.1, y: top + 0.005, z: Math.cos(ang) * 0.1 }, glow: true });
      }
      break;
    case 'headset':
      sb.add(sphere(0.022, 8, 6), { bone: head, color: 0x111111, xf: { x: 0.105, y: hy + 0.12 } });
      sb.add(cyl(0.003, 0.003, 0.06, 4), { bone: head, color: 0x111111, xf: { x: 0.1, y: hy + 0.09, z: 0.04, rx: 1.2 } });
      break;
    case 'bandana':
      sb.add(lathe(headSlice(0.19, 0.266, 1.08, 5), 16), { bone: head, color: o.accent, xf: { y: hy, z: 0.008, sz: HEAD_Z * 1.08 } });
      break;
    default:
      break;
  }
}

function buildGlasses(sb: SkinBuilder, a: Appearance, hy: number): void {
  const o = a.outfit;
  const head = B.head;
  const y = hy + 0.122;
  const z = 0.138;
  switch (o.glasses) {
    case 'shades':
    case 'aviators':
      for (const s of [-1, 1]) sb.add(rbox(0.06, o.glasses === 'aviators' ? 0.045 : 0.035, 0.008, 0.012), { bone: head, color: o.glasses === 'aviators' ? 0x2a3a2a : 0x0c0c10, xf: { x: s * 0.043, y, z: z - Math.abs(s) * 0.004 } });
      sb.add(box(0.03, 0.006, 0.006), { bone: head, color: 0xc8a040, xf: { y: y + 0.01, z: z + 0.002 } });
      break;
    case 'round':
      for (const s of [-1, 1]) sb.add(torus(0.024, 0.004, Math.PI * 2, 4, 12), { bone: head, color: 0x2a2a2a, xf: { x: s * 0.038, y, z } });
      break;
    case 'visor':
      sb.add(lathe(headSlice(0.11, 0.155, 1.06, 4), 16, -1.0, 2.0), { bone: head, color: o.accent, xf: { y: hy, z: 0.008, sz: HEAD_Z * 1.06 }, glow: o.glow });
      break;
    case 'goggles':
      for (const s of [-1, 1]) sb.add(cyl(0.025, 0.025, 0.02, 12), { bone: head, color: 0x6fd0ff, xf: { x: s * 0.04, y, z: z - 0.002, rx: Math.PI / 2 } });
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ runtime model

export const BODY_MATERIAL = withRim(new THREE.MeshLambertMaterial({ vertexColors: true }), 1.0);
export const GLOW_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const BLOB_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const BLOB_GEO = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
const BLOB_MAT = new THREE.MeshBasicMaterial({ map: BLOB_TEX, transparent: true, depthWrite: false });

function appearanceKey(a: Appearance): string {
  return JSON.stringify([a.body, a.skin, a.hair, a.hairColor, a.outfit, a.build]);
}

export class CharacterModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones = {} as Record<BoneName, THREE.Bone>;
  readonly rest: Record<BoneName, V3>;
  readonly face: THREE.Mesh;
  private faceTex: THREE.Texture;
  readonly shadow: THREE.Mesh;
  expression: Expression = 'neutral';
  private blinkT = 2 + Math.random() * 3;
  private hiGeo: THREE.BufferGeometry;
  private loGeo: THREE.BufferGeometry;
  lod = 0;
  private exprHold = 0;
  private baseExpr: Expression = 'neutral';

  constructor(readonly appearance: Appearance) {
    const key = appearanceKey(appearance);
    let built = cache.get(key);
    if (!built) {
      built = buildCharacter(appearance);
      cache.set(key, built);
    }
    this.rest = restPose(appearance.body === 'f');
    const list: THREE.Bone[] = [];
    for (const name of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      const p = this.rest[name];
      const parent = PARENT[name];
      if (parent) {
        const pp = this.rest[parent];
        b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
        this.bones[parent].add(b);
      } else b.position.set(p[0], p[1], p[2]);
      this.bones[name] = b;
      list.push(b);
    }
    const inverses = BONES.map((n) => new THREE.Matrix4().makeTranslation(-this.rest[n][0], -this.rest[n][1], -this.rest[n][2]));
    const skeleton = new THREE.Skeleton(list, inverses);
    this.hiGeo = built.geometry;
    this.loGeo = built.low;
    this.mesh = new THREE.SkinnedMesh(built.geometry, [BODY_MATERIAL, GLOW_MATERIAL]);
    this.mesh.add(this.bones.root);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = true;
    const s = appearance.height;
    this.mesh.scale.setScalar(s);
    this.root.add(this.mesh);

    // The face decal rides on the head bone.
    this.faceTex = faceAtlas(appearance.eyes).clone();
    this.faceTex.needsUpdate = true;
    const faceMat = new THREE.MeshLambertMaterial({ map: this.faceTex, transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const fg = built.face.clone();
    const hp = this.rest.head;
    fg.translate(-hp[0], -hp[1], -hp[2]);
    this.face = new THREE.Mesh(fg, faceMat);
    this.face.renderOrder = 1;
    this.bones.head.add(this.face);
    this.setExpression('neutral');

    this.shadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    this.shadow.position.y = 0.03;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  setExpression(e: Expression, hold = 0): void {
    if (hold > 0) this.exprHold = hold;
    else this.baseExpr = e;
    if (this.exprHold > 0 && hold === 0) return;
    this.expression = e;
    const [u, v] = expressionOffset(e);
    this.faceTex.offset.set(u, v);
  }

  /** Blinking and timed expressions. */
  updateFace(dt: number): void {
    if (this.exprHold > 0) {
      this.exprHold -= dt;
      if (this.exprHold <= 0) this.setExpression(this.baseExpr);
    }
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      if (this.expression !== 'blink' && this.expression !== 'sleep') {
        const prev = this.expression;
        const [u, v] = expressionOffset('blink');
        this.faceTex.offset.set(u, v);
        setTimeout(() => {
          const [u2, v2] = expressionOffset(this.expression === prev ? prev : this.expression);
          this.faceTex.offset.set(u2, v2);
        }, 120);
      }
      this.blinkT = 2 + Math.random() * 4;
    }
  }

  /** Attach a prop (gun, cards, phone, drink) to a hand. */
  attach(obj: THREE.Object3D, bone: BoneName = 'handR'): void {
    this.bones[bone].add(obj);
  }

  /** Model-space position of a bone's rest point (for placing props). */
  restOf(bone: BoneName): V3 {
    return this.rest[bone];
  }

  /** Pick the detail level from the distance to the camera (and hide far ones). */
  updateLod(dist: number): void {
    const lod = dist < 9 ? 0 : dist < 70 ? 1 : 2;
    if (lod === this.lod) return;
    this.lod = lod;
    this.mesh.geometry = lod === 0 ? this.hiGeo : this.loGeo;
    this.mesh.visible = lod < 2;
    this.face.visible = lod < 2;
    this.shadow.visible = lod < 2;
  }

  setFaceVisible(v: boolean): void {
    this.face.visible = v;
  }

  dispose(): void {
    (this.face.material as THREE.Material).dispose();
    this.face.geometry.dispose();
    this.faceTex.dispose();
  }
}
