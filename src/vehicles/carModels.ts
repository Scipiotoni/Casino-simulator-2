import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHINY_VCOL } from '../render/kit';
import { VCOL, phong, withRim } from '../render/materials';
import carsUrl from './assets/cars.glb?url';
import type { BuiltVehicle, VehicleDef } from './models';

/**
 * The cars modelled in Blender (tools/blender/build_cars.py): every car's high and low detail
 * body, its front and rear wheel and any moving parts, with its wheels, seats and driver's eye
 * in the node's extras. Loaded once at boot; each body is merged into a handful of draw calls
 * (matte, shiny, paint, glass and lamps), the paint taking each car's own colour.
 */

/** Which surfaces are matte, which glossy, which see-through and which glow. */
const MATTE = new Set(['black', 'interior', 'seat', 'grille', 'plate', 'tyre', 'wall', 'liner', 'gap', 'canvas', 'track']);
const GLOW = new Set(['head', 'tail', 'amber', 'sign', 'red', 'blue']);
type Slot = 'matte' | 'shiny' | 'paint' | 'glass' | 'glow';
const SLOTS: Slot[] = ['matte', 'shiny', 'paint', 'glass', 'glow'];

interface Meta {
  wheels: [number, number, number, 'f' | 'r'][];
  wheelR: [number, number];
  seats: [number, number, number][];
  eye: [number, number, number];
  dims: [number, number, number];
  color: number;
}

interface CarAsset {
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
  wheels: Partial<Record<'f' | 'r', THREE.BufferGeometry>>;
  parts: Map<string, THREE.BufferGeometry>;
  meta: Meta;
}

const assets = new Map<string, CarAsset>();

export function carAsset(id: string): CarAsset | undefined {
  return assets.get(id);
}

/**
 * Load the modelled cars (or leave the procedural ones in place if the file can't be read).
 * Each def's length, width and wheel size are set from its model so the physics fit it.
 */
export async function loadCars(defs: VehicleDef[]): Promise<void> {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(carsUrl);
  } catch (e) {
    console.warn('Cars could not be loaded; using the simple ones', e);
    return;
  }
  gltf.scene.updateMatrixWorld(true);
  // Nodes by their name in the file (three renames objects to keep names unique).
  const nodes = new Map<string, THREE.Object3D>();
  gltf.scene.traverse((o) => {
    const n = o.userData?.name;
    if (typeof n === 'string' && !nodes.has(n)) nodes.set(n, o);
  });
  for (const d of defs) {
    const node = nodes.get(d.id);
    const raw = node?.userData?.car;
    if (!node || typeof raw !== 'string') continue;
    let meta: Meta;
    try {
      meta = JSON.parse(raw) as Meta;
    } catch {
      continue;
    }
    const lo = nodes.get(`${d.id}_lo`);
    const hi = merged(node);
    if (!hi) continue;
    const wheels: CarAsset['wheels'] = {};
    for (const k of ['f', 'r'] as const) {
      const w = nodes.get(`${d.id}_w${k}`);
      const g = w && merged(w, true);
      if (g) wheels[k] = g;
    }
    const parts = new Map<string, THREE.BufferGeometry>();
    for (const [name, o] of nodes) {
      if (!name.startsWith(`${d.id}_`) || name === `${d.id}_lo` || /_w[fr]$/.test(name)) continue;
      const g = merged(o);
      if (g) parts.set(name.slice(d.id.length + 1), g);
    }
    assets.set(d.id, { hi, lo: (lo && merged(lo)) || hi, wheels, parts, meta });
    // The physics follow the model.
    d.L = meta.dims[0];
    d.W = meta.dims[1];
    d.wheelR = meta.wheelR[0];
  }
}

/**
 * One node's meshes (one per material, in glTF) merged into a single geometry in the node's
 * own space, with a vertex colour per surface and one group per slot (or plain, for a wheel).
 */
function merged(node: THREE.Object3D, plain = false): THREE.BufferGeometry | null {
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const bySlot: Record<Slot, THREE.BufferGeometry[]> = { matte: [], shiny: [], paint: [], glass: [], glow: [] };
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // Only this node's own meshes (its primitives), not another node's.
    for (let p: THREE.Object3D | null = m; p && p !== node; p = p.parent) if (typeof p.userData?.name === 'string') return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const mat = mats[0] as THREE.MeshStandardMaterial;
    const region = (mat?.name ?? '').replace(/\.\d+$/, '');
    let g = m.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const c = mat?.color ?? new THREE.Color(0x888888);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const slot: Slot = plain ? 'matte' : region === 'paint' ? 'paint' : region === 'glass' ? 'glass' : GLOW.has(region) ? 'glow' : MATTE.has(region) ? 'matte' : 'shiny';
    bySlot[slot].push(g);
  });
  const list: THREE.BufferGeometry[] = [];
  const groups: [number, number, number][] = [];
  let start = 0;
  SLOTS.forEach((s, i) => {
    if (!bySlot[s].length) return;
    const g = bySlot[s].length === 1 ? bySlot[s][0] : mergeGeometries(bySlot[s], false);
    if (!g) return;
    const count = g.getAttribute('position').count;
    list.push(g);
    groups.push([start, count, i]);
    start += count;
  });
  if (!list.length) return null;
  const out = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (!out) return null;
  out.clearGroups();
  if (!plain) for (const [s, c, i] of groups) out.addGroup(s, c, i);
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------- materials

const GLASS = withRim(new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.62, shininess: 120, specular: 0xbbbbbb, depthWrite: false }), 0.4);
const LAMPS = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const paints = new Map<number, THREE.Material>();

/** A glossy clear-coat paint in one colour (shared by every car painted it). */
function paint(color: number): THREE.Material {
  let m = paints.get(color);
  if (!m) {
    m = withRim(phong(color, 90, 0x9a9a9a), 0.5);
    paints.set(color, m);
  }
  return m;
}

function materials(color: number): THREE.Material[] {
  return [VCOL, SHINY_VCOL, paint(color), GLASS, LAMPS];
}

/** A modelled car as the game's vehicle model: the body (close and far), wheels that spin and steer. */
export function buildModelled(d: VehicleDef, color: number): BuiltVehicle | null {
  const a = assets.get(d.id);
  if (!a) return null;
  const mats = materials(color);
  const body = new THREE.Group();
  const lod = new THREE.LOD();
  const near = new THREE.Group();
  const hi = new THREE.Mesh(a.hi, mats);
  hi.castShadow = true;
  hi.receiveShadow = true;
  near.add(hi);
  const lo = new THREE.Mesh(a.lo, mats);
  lo.castShadow = true;
  lod.addLevel(near, 0);
  lod.addLevel(lo, 38);
  body.add(lod);
  // Wheels: rear pair first, then the front pair (which steers), like the simple cars.
  const wheels: THREE.Group[] = [];
  const wheelPos: [number, number][] = [];
  const order = [...a.meta.wheels].sort((p, q) => (p[3] === q[3] ? 0 : p[3] === 'r' ? -1 : 1));
  for (const [x, y, z, k] of order) {
    const geo = a.wheels[k] ?? a.wheels.f;
    if (!geo) continue;
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    const spin = new THREE.Group();
    const flip = new THREE.Group();
    const w = new THREE.Mesh(geo, SHINY_VCOL);
    w.castShadow = true;
    flip.add(w);
    // The left wheels (−z) turn round so their spokes face out.
    if (z < 0) flip.rotation.y = Math.PI;
    spin.add(flip);
    holder.add(spin);
    near.add(holder);
    wheels.push(holder);
    wheelPos.push([x, z]);
  }
  let turret: THREE.Group | undefined;
  let barrel: THREE.Object3D | undefined;
  const tg = a.parts.get('turret');
  if (tg) {
    turret = new THREE.Group();
    turret.add(new THREE.Mesh(tg, mats));
    const bg = a.parts.get('barrel');
    if (bg) {
      barrel = new THREE.Mesh(bg, mats);
      turret.add(barrel);
    }
    body.add(turret);
  }
  // Seats are where the hips go; the game seats a character 0.32 m below that.
  const seatsLocal = a.meta.seats.map(([x, y, z]) => new THREE.Vector3(x, y - 0.32, z));
  const driverEye = new THREE.Vector3(...a.meta.eye);
  return { body, wheels, wheelPos, lights: [], turret, barrel, driverEye, seatsLocal };
}
