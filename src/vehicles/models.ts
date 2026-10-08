import * as THREE from 'three';
import { Kit } from '../render/kit';

/**
 * The vehicle catalog and the modeller. Bodies are side profiles extruded across the car
 * with rounded (bevelled) edges and real wheel arches cut into them; a narrower tinted
 * cabin sits on top with the roof panel in body colour; lights glow. Every car is three
 * merged meshes plus four wheels.
 */

export type VehicleClass = 'compact' | 'sedan' | 'sports' | 'muscle' | 'suv' | 'pickup' | 'van' | 'limo' | 'buggy' | 'super' | 'jeep' | 'tank' | 'police' | 'taxi' | 'convertible' | 'boat';

export interface VehicleDef {
  id: string;
  name: string;
  cls: VehicleClass;
  price: number;
  /** Length, width, body height (beltline), roof height, ground clearance, wheel radius. */
  L: number;
  W: number;
  belt: number;
  roof: number;
  clearance: number;
  wheelR: number;
  /** Cabin start/end as fractions of the length from the rear, and how raked the glass is. */
  cabin: [number, number];
  rake: [number, number];
  color: number;
  /** Top speed m/s, acceleration m/s², grip 0..1 (how much it resists sliding). */
  top: number;
  accel: number;
  grip: number;
  seats: number;
  engine: 'four' | 'v8' | 'sport' | 'diesel' | 'electric' | 'buggy' | 'tank';
  extras?: ('spoiler' | 'wing' | 'rack' | 'lightbar' | 'taxisign' | 'bullbar' | 'scoop' | 'bed' | 'cage' | 'stripes' | 'openTop' | 'turret' | 'snorkel')[];
  stripe?: number;
}

export const VEHICLES: VehicleDef[] = [
  { id: 'hatch', name: 'Bubble Hatch', cls: 'compact', price: 6500, L: 3.7, W: 1.72, belt: 0.92, roof: 1.48, clearance: 0.16, wheelR: 0.31, cabin: [0.12, 0.72], rake: [0.25, 0.45], color: 0x4fc3f7, top: 42, accel: 7, grip: 0.85, seats: 4, engine: 'four' },
  { id: 'sedan', name: 'Islander Sedan', cls: 'sedan', price: 14000, L: 4.6, W: 1.82, belt: 0.95, roof: 1.45, clearance: 0.16, wheelR: 0.33, cabin: [0.26, 0.7], rake: [0.35, 0.4], color: 0xe8e8ea, top: 48, accel: 7.5, grip: 0.82, seats: 4, engine: 'four' },
  { id: 'pickup', name: 'Sal’s Old Pickup', cls: 'pickup', price: 9000, L: 5.0, W: 1.9, belt: 1.05, roof: 1.75, clearance: 0.3, wheelR: 0.38, cabin: [0.48, 0.72], rake: [0.12, 0.35], color: 0xc8582f, top: 40, accel: 6, grip: 0.75, seats: 2, engine: 'v8', extras: ['bed'] },
  { id: 'convertible', name: 'Riviera Convertible', cls: 'convertible', price: 38000, L: 4.5, W: 1.85, belt: 0.88, roof: 1.2, clearance: 0.13, wheelR: 0.33, cabin: [0.3, 0.62], rake: [0.2, 0.55], color: 0xff6fae, top: 56, accel: 9, grip: 0.86, seats: 2, engine: 'v8', extras: ['openTop'] },
  { id: 'muscle', name: 'Thunder Muscle', cls: 'muscle', price: 52000, L: 4.8, W: 1.95, belt: 0.95, roof: 1.33, clearance: 0.13, wheelR: 0.35, cabin: [0.3, 0.6], rake: [0.4, 0.45], color: 0x1f1f24, top: 64, accel: 11, grip: 0.7, seats: 2, engine: 'v8', extras: ['scoop', 'stripes', 'spoiler'], stripe: 0xffd23d },
  { id: 'suv', name: 'Highroller SUV', cls: 'suv', price: 68000, L: 4.9, W: 2.0, belt: 1.15, roof: 1.9, clearance: 0.26, wheelR: 0.4, cabin: [0.1, 0.72], rake: [0.12, 0.35], color: 0x15151a, top: 50, accel: 8, grip: 0.8, seats: 6, engine: 'v8', extras: ['rack'] },
  { id: 'taxi', name: 'Island Cab', cls: 'taxi', price: 15000, L: 4.6, W: 1.82, belt: 0.95, roof: 1.45, clearance: 0.16, wheelR: 0.33, cabin: [0.26, 0.7], rake: [0.35, 0.4], color: 0xffcc1f, top: 48, accel: 7.5, grip: 0.82, seats: 4, engine: 'four', extras: ['taxisign'] },
  { id: 'van', name: 'Party Van', cls: 'van', price: 26000, L: 5.0, W: 2.0, belt: 1.15, roof: 2.15, clearance: 0.2, wheelR: 0.36, cabin: [0.02, 0.86], rake: [0.03, 0.35], color: 0x7b2ff7, top: 42, accel: 6, grip: 0.78, seats: 6, engine: 'diesel', extras: ['stripes'], stripe: 0x3fe0ff },
  { id: 'buggy', name: 'Dune Buggy', cls: 'buggy', price: 22000, L: 3.6, W: 1.85, belt: 0.85, roof: 1.6, clearance: 0.38, wheelR: 0.45, cabin: [0.2, 0.62], rake: [0.1, 0.3], color: 0xff7a1a, top: 50, accel: 10, grip: 0.9, seats: 2, engine: 'buggy', extras: ['cage', 'openTop'] },
  { id: 'sports', name: 'Viper GT', cls: 'sports', price: 145000, L: 4.5, W: 1.98, belt: 0.82, roof: 1.18, clearance: 0.11, wheelR: 0.34, cabin: [0.32, 0.6], rake: [0.45, 0.6], color: 0x2bd96b, top: 78, accel: 14, grip: 0.92, seats: 2, engine: 'sport', extras: ['wing'] },
  { id: 'limo', name: 'Jackpot Limo', cls: 'limo', price: 120000, L: 7.6, W: 1.98, belt: 0.98, roof: 1.5, clearance: 0.16, wheelR: 0.36, cabin: [0.16, 0.78], rake: [0.12, 0.25], color: 0xf4f4f6, top: 46, accel: 6, grip: 0.8, seats: 8, engine: 'v8' },
  { id: 'super', name: 'Golden Hypercar', cls: 'super', price: 900000, L: 4.6, W: 2.05, belt: 0.78, roof: 1.12, clearance: 0.1, wheelR: 0.36, cabin: [0.36, 0.62], rake: [0.5, 0.7], color: 0xf2c230, top: 95, accel: 18, grip: 0.95, seats: 2, engine: 'sport', extras: ['wing', 'scoop'] },
  { id: 'police', name: 'Interceptor', cls: 'police', price: 0, L: 4.8, W: 1.9, belt: 0.95, roof: 1.45, clearance: 0.16, wheelR: 0.34, cabin: [0.28, 0.7], rake: [0.35, 0.4], color: 0xf4f4f6, top: 62, accel: 11, grip: 0.86, seats: 4, engine: 'v8', extras: ['lightbar', 'bullbar'], stripe: 0x15151a },
  { id: 'jeep', name: 'Army Jeep', cls: 'jeep', price: 0, L: 4.0, W: 1.9, belt: 1.05, roof: 1.75, clearance: 0.32, wheelR: 0.4, cabin: [0.25, 0.65], rake: [0.02, 0.15], color: 0x5d6b3a, top: 46, accel: 8, grip: 0.82, seats: 4, engine: 'diesel', extras: ['openTop', 'snorkel'] },
  { id: 'speedboat', name: 'Sea Dart', cls: 'boat', price: 0, L: 6.4, W: 2.3, belt: 0.75, roof: 1.5, clearance: 0, wheelR: 0.3, cabin: [0.35, 0.62], rake: [0.3, 0.3], color: 0xff4f5a, top: 32, accel: 8, grip: 0.6, seats: 4, engine: 'sport' },
  { id: 'cruiser', name: 'Coral Cruiser', cls: 'boat', price: 0, L: 9.5, W: 3.2, belt: 1.0, roof: 2.6, clearance: 0, wheelR: 0.3, cabin: [0.3, 0.7], rake: [0.3, 0.3], color: 0xf4f4f6, top: 24, accel: 5, grip: 0.55, seats: 6, engine: 'diesel' },
  { id: 'tank', name: 'Rhino Tank', cls: 'tank', price: 0, L: 7.2, W: 3.4, belt: 1.5, roof: 2.4, clearance: 0.3, wheelR: 0.42, cabin: [0.3, 0.7], rake: [0.2, 0.2], color: 0x5d6b3a, top: 22, accel: 4, grip: 0.98, seats: 2, engine: 'tank', extras: ['turret'] },
];

export function vehicleDef(id: string): VehicleDef {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

function shade(c: number, k: number): number {
  return new THREE.Color(c).multiplyScalar(k).getHex();
}

/** Side profile of the lower body (below the beltline), with wheel arches. x = along, y = up. */
function lowerShape(d: VehicleDef, wheelX: [number, number]): THREE.Shape {
  const L = d.L;
  const h = d.belt;
  const c = d.clearance + 0.05;
  const r = d.wheelR + 0.07;
  const s = new THREE.Shape();
  const x0 = -L / 2;
  const x1 = L / 2;
  // Bottom, rear to front, with the two arches.
  s.moveTo(x0 + 0.15, c);
  for (const wx of wheelX) {
    s.lineTo(wx - r, c);
    s.absarc(wx, c, r, Math.PI, 0, true);
  }
  s.lineTo(x1 - 0.2, c);
  // Nose: rounded up to the hood.
  s.quadraticCurveTo(x1 + 0.02, c, x1, c + (h - c) * 0.5);
  s.quadraticCurveTo(x1 - 0.02, h - 0.04, x1 - 0.25, h);
  // Hood and deck along the beltline.
  s.lineTo(x0 + 0.25, h);
  s.quadraticCurveTo(x0 + 0.02, h - 0.03, x0, h - 0.18);
  s.quadraticCurveTo(x0 - 0.03, c + 0.05, x0 + 0.15, c);
  return s;
}

/** The glasshouse: from the beltline up to the roof, raked front and back. */
function cabinShape(d: VehicleDef): THREE.Shape {
  const L = d.L;
  const xs = -L / 2 + d.cabin[0] * L;
  const xe = -L / 2 + d.cabin[1] * L;
  const h0 = d.belt - 0.02;
  const h1 = d.roof;
  const rr = (h1 - h0) * d.rake[0] * 2.2;
  const rf = (h1 - h0) * d.rake[1] * 2.2;
  const s = new THREE.Shape();
  s.moveTo(xs, h0);
  s.lineTo(xe, h0);
  s.lineTo(xe - rf, h1 - 0.03);
  s.quadraticCurveTo(xe - rf - 0.05, h1, xe - rf - 0.15, h1);
  s.lineTo(xs + rr + 0.15, h1);
  s.quadraticCurveTo(xs + rr + 0.05, h1, xs + rr, h1 - 0.03);
  s.closePath();
  return s;
}

export interface BuiltVehicle {
  body: THREE.Group;
  wheels: THREE.Group[];
  /** Wheel positions (x along, z across) for physics and suspension. */
  wheelPos: [number, number][];
  lights: THREE.Mesh[];
  turret?: THREE.Group;
  barrel?: THREE.Object3D;
  /** Where the driver's head is (for first person and cutscenes). */
  driverEye: THREE.Vector3;
  seatsLocal: THREE.Vector3[];
}

const wheelCache = new Map<string, THREE.Group>();

function wheelModel(r: number, w: number, rim: number, tank = false): THREE.Group {
  const key = `${r}|${w}|${rim}|${tank}`;
  let g = wheelCache.get(key);
  if (!g) {
    const k = new Kit();
    // The axle runs along z.
    if (tank) {
      k.cyl(r, r, w, 0x2a2a28, { rx: Math.PI / 2 }, 'matte', 14);
      k.cyl(r * 0.5, r * 0.5, w + 0.02, 0x4a4a42, { rx: Math.PI / 2 }, 'shiny', 10);
    } else {
      // Tyre: a lathed profile with rounded shoulders, then a rim with spokes on the outside.
      const prof: [number, number][] = [[r * 0.62, -w / 2], [r * 0.92, -w / 2], [r, -w * 0.32], [r, w * 0.32], [r * 0.92, w / 2], [r * 0.62, w / 2]];
      k.lathe(prof, 0x1c1c20, { rx: Math.PI / 2 }, 'matte', 18);
      k.cyl(r * 0.64, r * 0.64, w * 0.92, rim, { rx: Math.PI / 2 }, 'shiny', 18);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.box(r * 0.14, r * 1.05, 0.02, shade(rim, 0.7), { z: w * 0.47, rz: a }, 'shiny');
      }
      k.cyl(r * 0.18, r * 0.18, w * 0.98, shade(rim, 0.6), { rx: Math.PI / 2 }, 'shiny', 10);
    }
    g = k.bake({ shadows: true });
    wheelCache.set(key, g);
  }
  return g.clone();
}

/**
 * A boat, in the same frame as the cars (+x forward, z across, y up) with the waterline at
 * y = 0: a pointed hull with a white deck and a stripe, a windscreen, seats and an outboard
 * motor; the cruiser gets a cabin with portholes and a flybridge rail.
 */
function buildBoat(d: VehicleDef, color: number): BuiltVehicle {
  const k = new Kit();
  const glow = new Kit();
  const L = d.L;
  const W = d.W;
  const big = d.id === 'cruiser';
  // Plan view of the hull: square stern, straight sides, a curved pointed bow.
  const plan = (s: number): THREE.Shape => {
    const sh = new THREE.Shape();
    const hw = (W / 2) * s;
    const x0 = -L / 2;
    const x1 = L / 2;
    sh.moveTo(x0, -hw);
    sh.lineTo(x0 + L * 0.5, -hw);
    sh.quadraticCurveTo(x1 - L * 0.08, -hw * 0.9, x1, 0);
    sh.quadraticCurveTo(x1 - L * 0.08, hw * 0.9, x0 + L * 0.5, hw);
    sh.lineTo(x0, hw);
    sh.closePath();
    return sh;
  };
  const up = { rx: -Math.PI / 2 };
  const hullTop = big ? 0.9 : 0.62;
  // Lower hull (narrower: a V-ish bottom), upper hull in the boat's colour, a stripe, the deck.
  k.extrude(plan(0.78), 0.4, shade(color, 0.7), { ...up, y: -0.3 }, 'shiny', 0, 12);
  k.extrude(plan(1), hullTop + 0.1, color, { ...up, y: (hullTop - 0.1) / 2 }, 'shiny', 0.04, 16);
  k.extrude(plan(1.012), 0.1, 0xffffff, { ...up, y: hullTop * 0.55 }, 'shiny', 0, 16);
  k.extrude(plan(0.94), 0.06, 0xf4efe6, { ...up, y: hullTop + 0.03 }, 'matte', 0, 16);
  // Rub rail and bow rail.
  k.box(L * 0.7, 0.05, 0.05, 0xd8dce4, { x: -L * 0.1, y: hullTop + 0.35, z: W / 2 - 0.12 }, 'shiny');
  k.box(L * 0.7, 0.05, 0.05, 0xd8dce4, { x: -L * 0.1, y: hullTop + 0.35, z: -W / 2 + 0.12 }, 'shiny');
  if (!big) {
    // Speedboat: windscreen, two rows of seats, an outboard on the transom.
    const wx = L * 0.08;
    k.box(0.06, 0.45, W * 0.8, 0x1a2a3c, { x: wx, y: hullTop + 0.28, rz: 0.5 }, 'glass');
    k.box(0.5, 0.35, W * 0.84, color, { x: wx + 0.25, y: hullTop + 0.12 }, 'shiny');
    for (const sx of [-0.6, -1.6]) {
      for (const sz of [-0.45, 0.45]) {
        k.rbox(0.55, 0.3, 0.6, 0.08, 0xf4f4f4, { x: sx, y: hullTop + 0.2, z: sz }, 'matte');
        k.rbox(0.15, 0.55, 0.6, 0.06, 0xf4f4f4, { x: sx - 0.3, y: hullTop + 0.4, z: sz }, 'matte');
      }
    }
    k.cyl(0.18, 0.18, 0.06, 0x2a2a2e, { x: wx - 0.35, y: hullTop + 0.55, z: -0.45, rz: 1.1 }, 'shiny', 14);
    k.rbox(0.5, 0.7, 0.45, 0.08, 0x2a2a2e, { x: -L / 2 - 0.2, y: hullTop + 0.05 }, 'shiny');
    k.box(0.12, 0.8, 0.15, 0x3a3a3e, { x: -L / 2 - 0.3, y: -0.2 }, 'shiny');
    k.rbox(0.42, 0.18, 0.3, 0.06, shade(color, 0.85), { x: -L / 2 - 0.2, y: hullTop + 0.45 }, 'shiny');
  } else {
    // Cruiser: a cabin with portholes, a flybridge on top with its rail, a swim platform.
    const cx0 = -L * 0.25;
    const cx1 = L * 0.18;
    k.rbox(cx1 - cx0, 1.0, W * 0.78, 0.15, 0xf4f4f6, { x: (cx0 + cx1) / 2, y: hullTop + 0.55 }, 'shiny');
    k.box(0.06, 0.7, W * 0.7, 0x1a2a3c, { x: cx1 + 0.05, y: hullTop + 0.6, rz: 0.45 }, 'glass');
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) glow.cyl(0.12, 0.12, 0.04, 0xbfe6ff, { x: cx0 + 0.6 + i * 0.9, y: hullTop + 0.6, z: s * W * 0.39, rx: Math.PI / 2 }, 'glow', 10);
      k.box(cx1 - cx0, 0.05, 0.05, 0xd8dce4, { x: (cx0 + cx1) / 2, y: hullTop + 1.55, z: s * W * 0.36 }, 'shiny');
    }
    k.box(cx1 - cx0, 0.08, W * 0.75, 0xe8e2d6, { x: (cx0 + cx1) / 2, y: hullTop + 1.08 }, 'matte');
    k.rbox(0.8, 0.5, 0.6, 0.08, 0x2a2a2e, { x: cx1 - 0.6, y: hullTop + 1.35 }, 'shiny');
    k.box(1.2, 0.1, W * 0.9, 0xc8a878, { x: -L / 2 - 0.5, y: 0.25 }, 'matte');
  }
  // Navigation lights: red to port (left: -z here), green to starboard.
  glow.sphere(0.06, 0xff3030, { x: L * 0.3, y: hullTop + 0.15, z: -W / 2 + 0.05 }, 'glow');
  glow.sphere(0.06, 0x30ff60, { x: L * 0.3, y: hullTop + 0.15, z: W / 2 - 0.05 }, 'glow');
  const body = new THREE.Group();
  body.add(k.bake({ shadows: true }));
  const gl = glow.bake();
  body.add(gl);
  const seatsLocal = big
    ? [new THREE.Vector3(L * 0.12, hullTop + 1.2, -0.3), new THREE.Vector3(L * 0.05, hullTop + 1.2, 0.4), new THREE.Vector3(-L * 0.35, hullTop + 0.1, -0.6), new THREE.Vector3(-L * 0.35, hullTop + 0.1, 0.6)]
    : [new THREE.Vector3(-0.6, hullTop + 0.1, -0.45), new THREE.Vector3(-0.6, hullTop + 0.1, 0.45), new THREE.Vector3(-1.6, hullTop + 0.1, -0.45), new THREE.Vector3(-1.6, hullTop + 0.1, 0.45)];
  const driverEye = new THREE.Vector3(seatsLocal[0].x - 0.1, seatsLocal[0].y + 0.75, seatsLocal[0].z);
  return { body, wheels: [], wheelPos: [], lights: gl.children as THREE.Mesh[], driverEye, seatsLocal };
}

export function buildVehicle(d: VehicleDef, color = d.color): BuiltVehicle {
  if (d.cls === 'boat') return buildBoat(d, color);
  const k = new Kit();
  const glow = new Kit();
  const L = d.L;
  const W = d.W;
  const wb = L * (d.cls === 'limo' ? 0.72 : 0.6);
  const wheelX: [number, number] = [-wb / 2 - (d.cls === 'van' ? 0.1 : 0), wb / 2];
  const paint = color;
  const dark = 0x1c1c22;
  const trim = 0xc8ccd2;
  const isTank = d.cls === 'tank';
  if (isTank) {
    // Hull, tracks, turret handled separately.
    k.rbox(L, 1.0, W - 0.9, 0.1, paint, { y: 1.05 }, 'matte');
    k.box(L * 0.9, 0.5, W - 0.4, shade(paint, 0.85), { y: 1.65 }, 'matte');
    for (const s of [-1, 1]) {
      k.rbox(L + 0.2, 0.9, 0.55, 0.3, 0x2a2a28, { y: 0.55, z: s * (W / 2 - 0.27) }, 'matte');
      k.box(L, 0.08, 0.6, shade(paint, 0.8), { y: 1.05, z: s * (W / 2 - 0.27) }, 'matte');
    }
  } else {
    // Lower body: the profile extruded across the car with rounded edges.
    const bev = 0.1;
    k.extrude(lowerShape(d, wheelX), W - bev * 2, paint, { rx: 0, ry: 0 }, 'shiny', bev, 10);
    // Cabin: narrower, tinted glass; roof panel in body colour (unless open top).
    const open = d.extras?.includes('openTop');
    if (!open) {
      k.extrude(cabinShape(d), W - 0.36, 0x1a2a3c, {}, 'glass', 0.05, 6);
      // Roof panel and pillars.
      const xs = -L / 2 + d.cabin[0] * L;
      const xe = -L / 2 + d.cabin[1] * L;
      const rr = (d.roof - d.belt) * d.rake[0] * 2.2;
      const rf = (d.roof - d.belt) * d.rake[1] * 2.2;
      k.rbox(xe - rf - (xs + rr) + 0.1, 0.06, W - 0.32, 0.03, paint, { x: (xe - rf + xs + rr) / 2, y: d.roof + 0.01 }, 'shiny');
      for (const s of [-1, 1]) {
        // A-pillars and C-pillars.
        const ha = d.roof - d.belt;
        const la = Math.hypot(rf, ha);
        k.box(0.07, la, 0.06, paint, { x: xe - rf / 2, y: d.belt + ha / 2, z: s * (W / 2 - 0.2), rz: Math.atan2(rf, ha) }, 'shiny');
        const lc = Math.hypot(rr, ha);
        k.box(0.09, lc, 0.06, paint, { x: xs + rr / 2, y: d.belt + ha / 2, z: s * (W / 2 - 0.2), rz: -Math.atan2(rr, ha) }, 'shiny');
      }
    } else {
      // Windscreen frame only.
      const xe = -L / 2 + d.cabin[1] * L;
      k.box(0.05, 0.38, W - 0.3, dark, { x: xe - 0.05, y: d.belt + 0.18, rz: 0.4 }, 'shiny');
      k.box(0.02, 0.32, W - 0.4, 0x9ccfe8, { x: xe - 0.02, y: d.belt + 0.16, rz: 0.4 }, 'glass');
      // Seats you can see into.
      for (const s of [-1, 1]) {
        k.rbox(0.5, 0.5, 0.48, 0.08, 0x3a2416, { x: -L / 2 + (d.cabin[0] + 0.12) * L, y: d.belt, z: s * 0.4 }, 'matte');
      }
    }
    // Bumpers, grille, lights.
    k.rbox(0.18, 0.18, W - 0.1, 0.06, dark, { x: L / 2 - 0.02, y: d.clearance + 0.22 }, 'shiny');
    k.rbox(0.18, 0.18, W - 0.1, 0.06, dark, { x: -L / 2 + 0.02, y: d.clearance + 0.22 }, 'shiny');
    k.box(0.04, 0.16, W * 0.45, 0x0f0f12, { x: L / 2 + 0.005, y: d.belt - 0.22 }, 'shiny');
    for (const s of [-1, 1]) {
      glow.add(new THREE.SphereGeometry(0.11, 10, 8), 0xfff4d8, { x: L / 2 - 0.04, y: d.belt - 0.18, z: s * (W / 2 - 0.28), sx: 0.4, sy: 0.7 }, 'glow');
      glow.box(0.04, 0.12, 0.26, 0xff2020, { x: -L / 2 + 0.01, y: d.belt - 0.14, z: s * (W / 2 - 0.25) }, 'glow');
      // Mirrors.
      if (!open) k.rbox(0.12, 0.08, 0.14, 0.03, paint, { x: -L / 2 + d.cabin[1] * L - 0.12, y: d.belt + 0.06, z: s * (W / 2 + 0.04) }, 'shiny');
      // Door shut line and handle.
      k.box(0.015, d.belt - d.clearance - 0.2, 0.012, shade(paint, 0.6), { x: -L / 2 + d.cabin[0] * L + 0.1, y: (d.belt + d.clearance) / 2 + 0.05, z: s * (W / 2 - 0.005) });
      k.box(0.12, 0.025, 0.02, trim, { x: -L / 2 + (d.cabin[0] + d.cabin[1]) * L * 0.5, y: d.belt - 0.12, z: s * (W / 2 - 0.005) }, 'shiny');
    }
    // Number plates.
    k.box(0.02, 0.11, 0.42, 0xf4f4f0, { x: L / 2 + 0.08, y: d.clearance + 0.24 });
    k.box(0.02, 0.11, 0.42, 0xf4f4f0, { x: -L / 2 - 0.08, y: d.clearance + 0.24 });
    // Exhausts.
    k.cyl(0.04, 0.04, 0.16, trim, { x: -L / 2 - 0.02, y: d.clearance + 0.12, z: -W / 4, rz: Math.PI / 2 }, 'shiny', 8);
    const ex = d.extras ?? [];
    if (ex.includes('stripes')) {
      for (const s of [-0.18, 0.18]) k.box(L * 0.98, 0.012, 0.16, d.stripe ?? 0xffffff, { y: d.belt + 0.003, z: s }, 'shiny');
    }
    if (ex.includes('spoiler')) k.rbox(0.25, 0.05, W - 0.2, 0.02, paint, { x: -L / 2 + 0.2, y: d.belt + 0.1 }, 'shiny');
    if (ex.includes('wing')) {
      k.rbox(0.32, 0.04, W - 0.1, 0.02, dark, { x: -L / 2 + 0.25, y: d.belt + 0.35 }, 'shiny');
      for (const s of [-1, 1]) k.box(0.06, 0.32, 0.04, dark, { x: -L / 2 + 0.28, y: d.belt + 0.17, z: s * (W / 2 - 0.35) });
    }
    if (ex.includes('scoop')) k.rbox(0.6, 0.12, 0.45, 0.05, dark, { x: L / 2 - 0.9, y: d.belt + 0.05 }, 'shiny');
    if (ex.includes('rack')) for (const s of [-1, 1]) k.box(L * 0.45, 0.04, 0.04, trim, { x: -0.1, y: d.roof + 0.1, z: s * (W / 2 - 0.3) }, 'shiny');
    if (ex.includes('bullbar')) k.box(0.08, 0.4, W * 0.7, dark, { x: L / 2 + 0.12, y: d.clearance + 0.35 }, 'shiny');
    if (ex.includes('lightbar')) {
      k.box(0.25, 0.08, W - 0.5, dark, { x: -0.1, y: d.roof + 0.08 });
      glow.box(0.2, 0.1, (W - 0.6) / 2, 0xff2a2a, { x: -0.1, y: d.roof + 0.12, z: -(W - 0.6) / 4 }, 'glow');
      glow.box(0.2, 0.1, (W - 0.6) / 2, 0x2a5aff, { x: -0.1, y: d.roof + 0.12, z: (W - 0.6) / 4 }, 'glow');
      // Black doors.
      for (const s of [-1, 1]) k.box(L * 0.4, d.belt - d.clearance - 0.15, 0.015, 0x15151a, { x: 0.05, y: (d.belt + d.clearance) / 2 + 0.05, z: s * (W / 2 - 0.0) });
    }
    if (ex.includes('taxisign')) {
      k.rbox(0.5, 0.18, 0.14, 0.04, 0xffffff, { x: -0.1, y: d.roof + 0.12 }, 'shiny');
      for (let i = 0; i < 6; i++) k.box(L * 0.06, 0.05, 0.01, i % 2 ? 0x111111 : 0xffffff, { x: -L * 0.15 + i * L * 0.06, y: d.belt - 0.08, z: W / 2 - 0.002 });
    }
    if (ex.includes('bed')) {
      const bx = -L / 2 + d.cabin[0] * L / 2;
      k.box(d.cabin[0] * L - 0.25, 0.04, W - 0.25, 0x2a2a2a, { x: bx, y: d.belt - 0.04 });
      k.box(0.1, 0.25, W - 0.2, shade(paint, 0.9), { x: -L / 2 + 0.06, y: d.belt + 0.1 }, 'shiny');
    }
    if (ex.includes('cage')) {
      for (const s of [-1, 1]) {
        k.cyl(0.035, 0.035, 0.85, dark, { x: -0.25, y: d.belt + 0.42, z: s * 0.7 }, 'shiny', 6);
        k.cyl(0.035, 0.035, 0.85, dark, { x: 0.45, y: d.belt + 0.42, z: s * 0.7, rz: 0.4 }, 'shiny', 6);
      }
      k.cyl(0.035, 0.035, 1.4, dark, { x: -0.25, y: d.belt + 0.84, rx: Math.PI / 2 }, 'shiny', 6);
    }
    if (ex.includes('snorkel')) k.cyl(0.05, 0.05, 0.9, dark, { x: L / 2 - 0.9, y: d.belt + 0.4, z: W / 2 - 0.05 }, 'shiny', 8);
  }
  const body = new THREE.Group();
  const bk = k.bake({ shadows: true });
  body.add(bk);
  const gl = glow.bake();
  body.add(gl);
  const lights = gl.children as THREE.Mesh[];
  // Wheels (tanks get road wheels hidden in the tracks).
  const wheels: THREE.Group[] = [];
  const wheelPos: [number, number][] = [];
  const rimC = d.cls === 'super' ? 0xf2c230 : d.cls === 'police' || d.cls === 'jeep' ? 0x2a2a2a : 0xd8dde4;
  const tw = W / 2 - (isTank ? 0.27 : 0.18);
  for (const wx of wheelX) {
    for (const s of [-1, 1]) {
      const w = wheelModel(d.wheelR, isTank ? 0.5 : 0.26, rimC, isTank);
      const holder = new THREE.Group();
      holder.position.set(wx, d.wheelR, s * tw);
      const spin = new THREE.Group();
      // Spokes face outwards on both sides.
      const flip = new THREE.Group();
      flip.add(w);
      if (s < 0) flip.rotation.y = Math.PI;
      spin.add(flip);
      holder.add(spin);
      wheels.push(holder);
      wheelPos.push([wx, s * tw]);
      body.add(holder);
    }
  }
  let turret: THREE.Group | undefined;
  let barrel: THREE.Object3D | undefined;
  if (isTank) {
    turret = new THREE.Group();
    const tk = new Kit();
    tk.rbox(2.6, 0.7, 2.2, 0.2, shade(d.color, 1.05), { y: 0.35 }, 'matte');
    tk.cyl(0.35, 0.35, 0.25, shade(d.color, 0.9), { x: -0.4, y: 0.8, z: 0.4 }, 'matte', 12);
    turret.add(tk.bake({ shadows: true }));
    const bk2 = new Kit();
    bk2.cyl(0.11, 0.13, 3.6, shade(d.color, 0.9), { x: 1.8, rz: Math.PI / 2 }, 'matte', 12);
    bk2.cyl(0.16, 0.16, 0.35, shade(d.color, 0.8), { x: 3.5, rz: Math.PI / 2 }, 'matte', 12);
    barrel = bk2.bake({ shadows: true });
    barrel.position.set(1.0, 0.4, 0);
    turret.add(barrel);
    turret.position.set(-0.3, 1.9, 0);
    body.add(turret);
  }
  // Seats: driver left (+z is the car's left when +x is forward? we drive along +x, left is -z).
  const seatsLocal: THREE.Vector3[] = [];
  const cabX = -L / 2 + ((d.cabin[0] + d.cabin[1]) / 2) * L;
  const rows = Math.max(1, Math.ceil(d.seats / 2));
  for (let i = 0; i < d.seats; i++) {
    const row = Math.floor(i / 2);
    const x = cabX + 0.25 - (row * (d.cabin[1] - d.cabin[0]) * L) / Math.max(1, rows);
    seatsLocal.push(new THREE.Vector3(x, d.clearance + 0.15, i % 2 === 0 ? -0.38 : 0.38));
  }
  const driverEye = new THREE.Vector3(seatsLocal[0].x - 0.1, d.belt + 0.32, seatsLocal[0].z);
  return { body, wheels, wheelPos, lights, turret, barrel, driverEye, seatsLocal };
}
