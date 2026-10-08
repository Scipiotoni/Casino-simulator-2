import * as THREE from 'three';
import { noise2 } from '../core/noise';
import { matrixOf, type Xf } from '../render/kit';
import { withRim } from '../render/materials';
import { expressionOffset, faceAtlas, type Expression } from './faces';
import { bodyParts, frontAt } from './bodies';
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

type ColorFn = (x: number, y: number, z: number, region: number) => number;

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
    // Modelled pieces carry their colour regions in the u of their UVs.
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      _n.set(nr.getX(i), nr.getY(i), nr.getZ(i)).applyMatrix3(_nm).normalize();
      s.pos.push(_v.x, _v.y, _v.z);
      s.nor.push(_n.x, _n.y, _n.z);
      const col = typeof o.color === 'function' ? o.color(_v.x, _v.y, _v.z, uv ? Math.floor(uv.getX(i)) : 0) : o.color;
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
   * coloured per face by the region in its UVs. `bulk` widens it round each bone (heavier or
   * slimmer builds).
   */
  addSkinned(geo: THREE.BufferGeometry, color: ColorFn, bulk: number, rest: Record<BoneName, V3>): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position');
    const nr = g.getAttribute('normal');
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    const uv = g.getAttribute('uv');
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
      _c.setHex(color(x, y, z, uv ? Math.floor(uv.getX(i)) : 0));
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
/** Where the old lathed head pieces (mask, visor) are measured from. */
const R_HEAD_Y = 1.54;

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

/**
 * The body's colour regions, as cut in Blender (tools/blender/build_characters.py, REGIONS):
 * every face of the body belongs to one, so an outfit is a colour per region with clean edges.
 */
const REGION = {
  head: 0, neck: 1, vneck: 2, chest: 3, placket: 4, belly: 5, belt: 6, pelvis: 7,
  shoulder: 8, upperarm: 9, forearm: 10, hand: 11, thigh: 12, lowthigh: 13, shin: 14, calf: 15, foot: 16, sole: 17,
} as const;

/** The white shirt under suits, tuxedos and waistcoats. */
const SHIRT = 0xf7f7f7;
const SOLES: Record<Outfit['shoes'], number> = { sneakers: 0xf4f4f4, boots: 0x2a1d14, heels: 0x1a1a1a, sandals: 0x8a5a3a, loafers: 0x1a1a1a };

function camo(x: number, y: number, z: number, o: Outfit): number {
  const n = noise2(x * 22 + z * 9, y * 22 - z * 7);
  return n > 0.25 ? o.c2 : n < -0.3 ? 0x2a2a1e : o.c1;
}

/** How far down the arms a top's sleeves go: 0 none, 1 short, 3 to the wrist. */
function sleeves(o: Outfit): number {
  switch (o.top) {
    case 'tank':
    case 'dress':
      return 0;
    case 'tee':
    case 'hawaiian':
    case 'military':
      return 1;
    default:
      return 3;
  }
}

/** How far down the legs the bottoms go: 0 bare legs (skirts and dresses), 1 shorts, 4 to the ankle. */
function legs(o: Outfit): number {
  if (o.top === 'dress' || o.bottom === 'skirt') return 0;
  return o.bottom === 'shorts' ? 1 : 4;
}

function mix(a: number, b: number, t: number): number {
  return _c.setHex(a).lerp(new THREE.Color(b), t).getHex();
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
  const body = bodyParts(f);
  const sl = sleeves(o);
  const lg = legs(o);
  const pants = (x: number, y: number, z: number): number => (o.bottom === 'camo' ? camo(x, y, z, o) : o.pants);
  // The top's own fabric, prints included.
  const fabric = (x: number, y: number, z: number): number => {
    switch (o.top) {
      case 'hawaiian': {
        const n = noise2(x * 30 + 3, y * 30 + z * 20);
        return n > 0.35 ? o.c2 : n < -0.42 ? o.accent : o.c1;
      }
      case 'military':
        return camo(x, y, z, o);
      case 'vest':
        return o.c2;
      default:
        return o.c1;
    }
  };
  const sleeve = (x: number, y: number, z: number): number => (o.top === 'vest' ? SHIRT : o.top === 'suit' || o.top === 'tux' || o.top === 'jacket' || o.top === 'coat' ? o.c1 : fabric(x, y, z));
  const color = (x: number, y: number, z: number, r: number): number => {
    switch (r) {
      case REGION.head:
      case REGION.neck:
        return skin;
      case REGION.vneck:
        // The opening at the front: the shirt under a jacket, the tee under an open one,
        // bare skin for a V-neck dress or an open-collared holiday shirt.
        switch (o.top) {
          case 'suit':
          case 'tux':
          case 'vest':
            return SHIRT;
          case 'jacket':
          case 'coat':
          case 'military':
            return o.c2;
          case 'hawaiian':
          case 'dress':
            return skin;
          default:
            return fabric(x, y, z);
        }
      case REGION.chest:
      case REGION.belly:
        // A plate carrier over the camo shirt.
        return o.top === 'military' ? o.c2 : fabric(x, y, z);
      case REGION.placket:
        switch (o.top) {
          case 'jacket':
          case 'coat':
          case 'racing':
          case 'military':
            return o.c2;
          case 'hoodie':
            return shade(o.c1, 0.78);
          default:
            return fabric(x, y, z);
        }
      case REGION.belt:
        if (o.top === 'dress') return o.c1;
        if (o.bottom === 'skirt') return o.pants;
        return o.top === 'military' ? 0x2a2a20 : 0x2a1d14;
      case REGION.pelvis:
        return o.top === 'dress' ? o.c1 : pants(x, y, z);
      case REGION.shoulder:
        return sl >= 1 ? sleeve(x, y, z) : skin;
      case REGION.upperarm:
        return sl >= 2 ? sleeve(x, y, z) : skin;
      case REGION.forearm:
        return sl >= 3 ? sleeve(x, y, z) : skin;
      case REGION.hand:
        return o.gloves ? o.c2 : skin;
      case REGION.thigh:
        return o.top === 'coat' ? o.c1 : lg >= 1 ? pants(x, y, z) : skin;
      case REGION.lowthigh:
        return o.top === 'coat' ? o.c1 : lg >= 2 ? pants(x, y, z) : skin;
      case REGION.shin:
        return lg >= 3 ? pants(x, y, z) : skin;
      case REGION.calf:
        return o.shoes === 'boots' ? o.shoe : lg >= 4 ? pants(x, y, z) : skin;
      case REGION.foot:
        return o.shoes === 'sandals' ? skin : o.shoe;
      case REGION.sole:
        return o.shoes === 'heels' ? shade(o.shoe, 0.55) : SOLES[o.shoes];
      default:
        return skin;
    }
  };
  // The body itself: one continuous skinned surface from Blender, coloured by region.
  sb.addSkinned(LOW ? body.lo : body.hi, color, a.build, R);
  if (o.top === 'dress' || o.bottom === 'skirt') sb.addSkinned(body.skirt, () => (o.top === 'dress' ? o.c1 : o.pants), a.build, R);

  // Face decal: the face patch from the model, its UVs scaled into one atlas cell.
  const faceGeo = body.face.clone();
  faceGeo.deleteAttribute('skinIndex');
  faceGeo.deleteAttribute('skinWeight');

  const hy = R.head[1] - 0.03;
  buildHair(sb, a);
  buildHat(sb, a);
  buildGlasses(sb, a, hy);

  // ---- legs: pockets, pads, shoes
  for (const side of [1, -1]) {
    const L = side > 0;
    const th = R[L ? 'thighL' : 'thighR'];
    const kn = R[L ? 'shinL' : 'shinR'];
    const an = R[L ? 'footL' : 'footR'];
    // Cargo pockets.
    if (o.bottom === 'cargo' || o.bottom === 'camo') sb.add(rbox(0.03, 0.11, 0.09, 0.01), { bone: B[L ? 'thighL' : 'thighR'], color: shade(o.pants, 0.85), xf: { x: th[0] + side * 0.092, y: 0.68, z: 0.0 } });
    // Knee pads for the military look.
    if (o.top === 'military' || o.top === 'armor') sb.add(rbox(0.09, 0.09, 0.05, 0.02), { bone: B[L ? 'shinL' : 'shinR'], color: o.top === 'armor' ? o.c1 : 0x2a2a20, xf: { x: kn[0], y: kn[1], z: 0.07 } });
    buildShoe(sb, o, B[L ? 'footL' : 'footR'], an);
  }

  // ---- outfit layers
  buildTop(sb, a);
  buildNeck(sb, a);
  buildBack(sb, o);

  const geometry = sb.build();
  return { geometry, face: faceGeo };
}

/** The modelled body's foot is a trainer; heels and sandals add a few pieces to it. */
function buildShoe(sb: SkinBuilder, o: Outfit, bone: number, an: V3): void {
  const [x, , z] = an;
  switch (o.shoes) {
    case 'sandals':
      sb.add(box(0.1, 0.012, 0.03), { bone, color: o.shoe, xf: { x, y: 0.07, z: z + 0.07 } });
      sb.add(box(0.1, 0.012, 0.025), { bone, color: o.shoe, xf: { x, y: 0.1, z: z + 0.0 } });
      break;
    case 'heels':
      sb.add(cyl(0.007, 0.011, 0.06, 6), { bone, color: shade(o.shoe, 0.55), xf: { x, y: 0.03, z: z - 0.06 } });
      break;
    default:
      break;
  }
}

function buildTop(sb: SkinBuilder, a: Appearance): void {
  const o = a.outfit;
  const f = a.body === 'f';
  // The garments themselves are regions of the body (see buildBody); these are the parts
  // that stand off it: collars, the hood, armour plates, the plate carrier's belt.
  switch (o.top) {
    case 'racing':
      sb.add(torus(0.07, 0.016, Math.PI * 2, 6, 16), { bone: B.chest, color: o.c2, xf: { y: 1.5, rx: Math.PI / 2 } });
      break;
    case 'coat':
      sb.add(torus(0.115, 0.04, Math.PI * 2, 6, 18), { bone: B.chest, color: o.accent, xf: { y: 1.48, rx: Math.PI / 2, sz: 0.75 } });
      break;
    case 'hoodie':
      // The hood resting on the shoulders.
      sb.add(torus(0.105, 0.05, Math.PI * 1.3, 8, 16), { bone: B.chest, color: o.c2, xf: { y: 1.49, z: -0.045, rx: Math.PI / 2 - 0.25, rz: -Math.PI * 0.15 + Math.PI, sx: 1.15 } });
      if (o.glow) sb.add(torus(0.17, 0.006, Math.PI * 2, 4, 24), { bone: B.spine, color: o.accent, xf: { y: 1.02, rx: Math.PI / 2, sz: 0.68 }, glow: true });
      break;
    case 'armor': {
      sb.add(rbox(0.42, 0.27, 0.29, 0.07), { bone: B.chest, color: o.c1, xf: { y: 1.32, z: 0.012 } });
      sb.add(rbox(0.36, 0.14, 0.25, 0.05), { bone: B.spine, color: o.c2, xf: { y: 1.12, z: 0.008 } });
      for (const s of [-1, 1]) {
        sb.add(sphere(0.095, 10, 8), { bone: B[s > 0 ? 'upperArmL' : 'upperArmR'], color: o.c1, xf: { x: s * 0.215, y: 1.44, sy: 0.75 } });
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
  // A buckle on the waistband of trousers.
  if (o.top !== 'dress' && o.bottom !== 'skirt') sb.add(rbox(0.045, 0.03, 0.01, 0.004), { bone: B.hips, color: 0xd8b04a, xf: { y: 0.982, z: frontAt(f, 0, 0.982) * (0.5 + a.build * 0.5) + 0.002 } });
}

function buildNeck(sb: SkinBuilder, a: Appearance): void {
  const o = a.outfit;
  const f = a.body === 'f';
  const front = (x: number, y: number) => frontAt(f, x, y) * (0.5 + a.build * 0.5);
  switch (o.neck) {
    case 'chain':
      sb.add(torus(0.088, 0.009, Math.PI * 2, 5, 18), { bone: B.chest, color: 0xf2c230, xf: { y: 1.47, z: 0.03, rx: Math.PI / 2 - 0.5, sx: 1.05 } });
      sb.add(sphere(0.018, 8, 6), { bone: B.chest, color: 0xf2c230, xf: { y: 1.4, z: front(0, 1.4) + 0.012 } });
      break;
    case 'bowtie':
      for (const s of [-1, 1]) sb.add(cone(0.025, 0.05, 4), { bone: B.neck, color: o.accent, xf: { x: s * 0.025, y: 1.495, z: front(0, 1.495) + 0.01, rz: s * Math.PI / 2 } });
      break;
    case 'tie': {
      // A strip laid down the shirt front, following the chest.
      const ys = [1.47, 1.42, 1.37, 1.32, 1.27, 1.23];
      const pos: number[] = [];
      for (let i = 0; i < ys.length - 1; i++) {
        const [y0, y1] = [ys[i], ys[i + 1]];
        const w0 = 0.014 + i * 0.004;
        const w1 = 0.014 + (i + 1) * 0.004;
        const z0 = front(0, y0) + 0.004;
        const z1 = front(0, y1) + 0.004;
        pos.push(-w0, y0, z0, -w1, y1, z1, w1, y1, z1, -w0, y0, z0, w1, y1, z1, w0, y0, z0);
      }
      const zt = front(0, 1.21) + 0.004;
      pos.push(-0.034, 1.23, zt, 0, 1.19, zt, 0.034, 1.23, zt);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      sb.add(g, { bone: B.chest, color: o.accent });
      sb.add(rbox(0.04, 0.03, 0.02, 0.006), { bone: B.chest, color: shade(o.accent, 0.85), xf: { y: 1.485, z: front(0, 1.485) + 0.008 } });
      break;
    }
    case 'scarf':
      sb.add(torus(0.075, 0.032, Math.PI * 2, 6, 16), { bone: B.neck, color: o.accent, xf: { y: 1.5, rx: Math.PI / 2 } });
      sb.add(rbox(0.06, 0.16, 0.02, 0.01), { bone: B.chest, color: o.accent, xf: { x: 0.04, y: 1.4, z: front(0.04, 1.4) + 0.012, rz: 0.15 } });
      break;
    case 'mask':
      sb.add(lathe(headSlice(0.0, 0.085, 1.1, 6), 12, -1.3, 2.6), { bone: B.head, color: o.c2, xf: { y: R_HEAD_Y, z: 0.012, sz: HEAD_Z * 1.08 } });
      sb.add(box(0.12, 0.006, 0.006), { bone: B.head, color: o.accent, xf: { y: R_HEAD_Y + 0.07, z: 0.132 }, glow: o.glow });
      break;
    default:
      break;
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

/** Hats that cover the crown: tall hairstyles go flat under them. */
const CROWN_HATS = new Set(['cap', 'beanie', 'tophat', 'cowboy', 'helmet', 'fedora', 'beret', 'bandana']);
const TALL_HAIR = new Set(['spiky', 'quiff', 'mohawk', 'afro', 'bun']);

/** A hairstyle or hat modelled in Blender (tools/blender/hair_hats.py), at the current detail level. */
function headPiece(f: boolean, name: string): THREE.BufferGeometry | null {
  const extras = bodyParts(f).extras;
  return (LOW ? extras.get(`${name}_lo`) : null) ?? extras.get(name) ?? null;
}

function buildHair(sb: SkinBuilder, a: Appearance): void {
  if (a.hair === 'bald') return;
  const style = CROWN_HATS.has(a.outfit.hat) && TALL_HAIR.has(a.hair) ? 'short' : a.hair;
  const geo = headPiece(a.body === 'f', `Hair_${style}`);
  if (!geo) return;
  const c = a.hairColor;
  // Regions: the hair, its ties and bands, and the shaved sides of a mohawk.
  const shaved = mix(a.skin, c, 0.35);
  sb.add(geo.clone(), { bone: B.head, color: (_x, _y, _z, r) => (r === 1 || r === 2 ? a.outfit.accent : r === 3 ? shaved : c) });
}

function buildHat(sb: SkinBuilder, a: Appearance): void {
  const o = a.outfit;
  if (o.hat === 'none') return;
  const geo = headPiece(a.body === 'f', `Hat_${o.hat}`);
  if (!geo) return;
  // Colours for the hat's regions: the hat, its band or brim, and its accent (button, pom-pom, jewels, mic).
  let main = o.c2;
  let band = shade(o.c2, 0.8);
  let accent = o.accent;
  switch (o.hat) {
    case 'tophat':
      main = 0x111111;
      band = o.accent;
      break;
    case 'cowboy':
      main = 0x8a5a2b;
      band = 0x3a2414;
      break;
    case 'helmet':
      band = shade(o.c2, 0.7);
      break;
    case 'fedora':
      main = 0x2a2a30;
      band = o.accent;
      break;
    case 'beret':
      main = band = 0x7a1020;
      break;
    case 'crown':
      main = band = 0xf2c230;
      break;
    case 'headset':
      main = band = 0x1a1a1a;
      break;
    case 'bandana':
      main = band = accent = o.accent;
      break;
    case 'visor':
      band = o.c2;
      break;
    default:
      break;
  }
  const jewels = [0xff2a3a, 0x3fa0ff, 0x2ecc71];
  sb.add(geo.clone(), {
    bone: B.head,
    color: (x, _y, z, r) => (r === 0 ? main : r === 1 ? band : o.hat === 'crown' ? jewels[Math.round(((Math.atan2(x, z) / Math.PI) * 3 + 6)) % 3] : accent),
  });
}

function buildGlasses(sb: SkinBuilder, a: Appearance, hy: number): void {
  const o = a.outfit;
  const head = B.head;
  const y = hy + 0.136;
  const z = 0.134;
  switch (o.glasses) {
    case 'shades':
    case 'aviators':
      for (const s of [-1, 1]) sb.add(rbox(0.062, o.glasses === 'aviators' ? 0.046 : 0.036, 0.008, 0.012), { bone: head, color: o.glasses === 'aviators' ? 0x2a3a2a : 0x0c0c10, xf: { x: s * 0.044, y, z: z - Math.abs(s) * 0.004 } });
      sb.add(box(0.03, 0.006, 0.006), { bone: head, color: 0xc8a040, xf: { y: y + 0.01, z: z + 0.002 } });
      for (const s of [-1, 1]) sb.add(box(0.005, 0.005, 0.12), { bone: head, color: 0x111111, xf: { x: s * 0.118, y: y + 0.008, z: z - 0.062 } });
      break;
    case 'round':
      for (const s of [-1, 1]) sb.add(torus(0.025, 0.004, Math.PI * 2, 4, 12), { bone: head, color: 0x2a2a2a, xf: { x: s * 0.04, y, z } });
      break;
    case 'visor':
      sb.add(lathe(headSlice(0.12, 0.165, 1.12, 4), 16, -1.0, 2.0), { bone: head, color: o.accent, xf: { y: hy, z: 0.012, sz: HEAD_Z * 1.1 }, glow: o.glow });
      break;
    case 'goggles':
      for (const s of [-1, 1]) sb.add(cyl(0.026, 0.026, 0.022, 12), { bone: head, color: 0x6fd0ff, xf: { x: s * 0.042, y, z: z - 0.002, rx: Math.PI / 2 } });
      sb.add(torus(0.125, 0.008, Math.PI * 2, 4, 20), { bone: head, color: 0x2a2a2a, xf: { y, z: 0.0, rx: Math.PI / 2, sy: 1.0 } });
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
