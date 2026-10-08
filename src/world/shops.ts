import * as THREE from 'three';
import { Kit } from '../render/kit';
import { labelTexture } from '../render/signs';
import { lotFrontPoint, type Lot } from './layout';
import type { Game } from '../game/game';
import { Vehicle } from '../vehicles/vehicle';

/**
 * The story's shops and services on their fixed lots: Bullseye Guns, Island Motors (with
 * cars on the forecourt), Paradise Realty, the Drip Locker clothing store, Mercy Island
 * Hospital and the police station. Each is a storefront building with a lit sign and a
 * counter you walk up to (no interior: the menu is the shop).
 */

interface ShopDef {
  key: string;
  name: string;
  sign: string;
  color: number;
  neon: string;
  floors: number;
  icon: string;
  label: string;
  sub: string;
  action: (g: Game) => void;
}

const DEFS: ShopDef[] = [
  { key: 'gunShop', name: 'Bullseye Guns', sign: 'BULLSEYE GUNS', color: 0x4a3a2a, neon: '#ff5a6a', floors: 1, icon: '🔫', label: 'Browse Bullseye Guns', sub: 'Pistols, rifles, shotguns', action: (g) => g.ui.gunShop() },
  { key: 'carDealer', name: 'Island Motors', sign: 'ISLAND MOTORS', color: 0xe8ecf2, neon: '#3aa7ff', floors: 1, icon: '🚗', label: 'Buy a car', sub: 'Island Motors showroom', action: (g) => g.ui.carDealer() },
  { key: 'realEstate', name: 'Paradise Realty', sign: 'PARADISE REALTY', color: 0xf4efe2, neon: '#3ddc84', floors: 2, icon: '🏢', label: 'Talk to Rosa at Paradise Realty', sub: 'Every lot for sale on the island', action: (g) => g.ui.realtyPanel() },
  { key: 'clothing', name: 'Drip Locker', sign: 'DRIP LOCKER', color: 0x2a1a3a, neon: '#d68bff', floors: 1, icon: '👕', label: 'Shop at Drip Locker', sub: 'Outfits', action: (g) => g.ui.wardrobe(true) },
  { key: 'hospital', name: 'Mercy Island Hospital', sign: 'MERCY HOSPITAL', color: 0xf4f4f4, neon: '#ff6b6b', floors: 4, icon: '➕', label: 'Hospital', sub: 'Free check-up', action: (g) => g.ui.hospital() },
  { key: 'police', name: 'Police Station', sign: 'POLICE', color: 0xd8dce4, neon: '#3a7bd5', floors: 2, icon: '🚓', label: 'Turn yourself in', sub: 'Clears your wanted level, for a fine', action: (g) => g.turnIn() },
];

export interface ShopSite {
  key: string;
  name: string;
  icon: string;
  door: THREE.Vector3;
  yaw: number;
  lot: Lot;
}

export function buildShops(g: Game): ShopSite[] {
  const out: ShopSite[] = [];
  for (const def of DEFS) {
    const lot = g.world.terrain.lots.find((l) => l.special === def.key);
    if (!lot) continue;
    const y = g.world.terrain.lotY.get(lot.id) ?? 6;
    const site = storefront(g, def, lot, y);
    out.push(site);
    g.interactions.add({ id: `shop:${def.key}`, x: site.door.x, y, z: site.door.z, radius: 3.2, label: def.label, sub: def.sub, action: () => def.action(g) });
  }
  return out;
}

function storefront(g: Game, def: ShopDef, lot: Lot, y: number): ShopSite {
  const fp = lotFrontPoint(lot);
  const group = new THREE.Group();
  const lw = lot.front === 'N' || lot.front === 'S' ? lot.x1 - lot.x0 : lot.z1 - lot.z0;
  const ld = lot.front === 'N' || lot.front === 'S' ? lot.z1 - lot.z0 : lot.x1 - lot.x0;
  const W = Math.min(lw - 6, def.key === 'hospital' ? 60 : 30);
  const D = Math.min(ld - 12, def.key === 'hospital' ? 40 : 20);
  const setback = def.key === 'carDealer' ? 18 : 6;
  // Local frame: x across the front, -z into the lot; the front wall sits at z = 0.
  group.position.set(fp.x - Math.sin(fp.yaw) * setback, 0, fp.z - Math.cos(fp.yaw) * setback);
  group.rotation.y = fp.yaw;
  const k = new Kit();
  const glow = new Kit();
  const H = 4.4 + (def.floors - 1) * 3.6;
  const c = def.color;
  // Body and roof.
  k.box(W, H, D, c, { y: y + H / 2, z: -D / 2 });
  k.box(W + 0.6, 0.5, D + 0.6, 0x5a5a5e, { y: y + H + 0.25, z: -D / 2 });
  // Shop window band and door.
  const glass = 0x7ab8d8;
  k.box(W - 2, 3, 0.12, glass, { y: y + 1.7, z: 0.06 }, 'glass');
  k.box(W - 1.6, 0.3, 0.3, 0x2a2a2e, { y: y + 3.35, z: 0.1 }, 'shiny');
  for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 3) k.box(0.14, 3.2, 0.2, 0x2a2a2e, { x, y: y + 1.6, z: 0.1 }, 'shiny');
  k.box(2.4, 2.6, 0.14, 0x1a1a1a, { y: y + 1.3, z: 0.12 }, 'shiny');
  // Upper floors' windows.
  for (let f = 1; f < def.floors; f++) {
    for (let x = -W / 2 + 2.5; x <= W / 2 - 2.5; x += 3.2) glow.box(1.8, 1.6, 0.1, 0xfff1c8, { x, y: y + 4.4 + (f - 1) * 3.6 + 1.6, z: 0.06 }, 'glow');
  }
  // Awning in the shop colour.
  const neon = new THREE.Color(def.neon).getHex();
  k.box(W - 1, 0.18, 2.2, neon, { y: y + 3.7, z: 1.1, rx: 0.12 });
  glow.box(W - 1, 0.08, 0.08, neon, { y: y + 3.58, z: 2.2 }, 'glow');
  // Interior glow behind the glass so it reads as open.
  glow.box(W - 2.4, 2.6, 0.05, 0xfff4dc, { y: y + 1.6, z: -0.5 }, 'glow');
  // A counter and shelves visible through the window.
  k.box(4, 1.1, 0.8, 0x3a2a1a, { x: -W / 4, y: y + 0.55, z: -2.2 }, 'shiny');
  for (let i = 0; i < 3; i++) k.box(1.6, 2, 0.5, 0xd8d8da, { x: W / 4 - 2 + i * 2, y: y + 1, z: -3 });
  if (def.key === 'hospital') {
    // Red cross and an ambulance bay canopy.
    glow.box(3, 0.9, 0.1, 0xff3b3b, { y: y + H - 1.6, z: 0.08 }, 'glow');
    glow.box(0.9, 3, 0.1, 0xff3b3b, { y: y + H - 1.6, z: 0.08 }, 'glow');
    k.box(10, 0.3, 6, 0xf4f4f4, { x: W / 2 - 7, y: y + 4.2, z: 3 });
    for (const s of [-1, 1]) k.cyl(0.15, 0.15, 4.2, 0xd0d0d0, { x: W / 2 - 7 + s * 4.6, y: y + 2.1, z: 5.6 }, 'shiny', 8);
  }
  if (def.key === 'police') {
    for (const s of [-1, 1]) glow.box(0.4, 0.4, 0.4, s < 0 ? 0x3a7bd5 : 0xff3b3b, { x: s * 2.2, y: y + 3.1, z: 0.4 }, 'glow');
    k.box(1.2, 0.8, 0.8, 0xd8d2c0, { x: -3, y: y + 0.4, z: 2.4 });
    k.box(1.2, 0.8, 0.8, 0xd8d2c0, { x: 3, y: y + 0.4, z: 2.4 });
  }
  if (def.key === 'carDealer') {
    // Glass showroom front and a forecourt with flags.
    k.box(W, 0.06, setback - 2, 0xd8d8dc, { y: y + 0.03, z: (setback - 2) / 2 + 0.5 });
    for (let x = -W / 2; x <= W / 2; x += W / 4) {
      k.cyl(0.05, 0.05, 6, 0xd0d0d0, { x, y: y + 3, z: setback - 2 }, 'shiny', 6);
      k.box(1.2, 0.8, 0.02, [0x3aa7ff, 0xffd23d, 0xff5a6a][Math.abs(Math.round(x)) % 3], { x: x + 0.62, y: y + 5.5, z: setback - 2 });
    }
  }
  group.add(k.bake({ shadows: true }), glow.bake());
  // The sign on the parapet.
  const tex = labelTexture(def.sign, { width: 1024, height: 160, color: '#ffffff', glow: def.neon, stroke: def.neon, strokeWidth: 5, size: 110, font: 'Bungee' });
  const sw = Math.min(W - 2, 18);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.16), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  sign.position.set(0, y + H + 1.4, 0.2);
  group.add(sign);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x2a2a2e }));
  pole.position.set(0, y + H + 0.55, 0.2);
  group.add(pole);
  g.renderer.scene.add(group);
  group.updateMatrixWorld(true);
  // Collision for the building.
  const corners = [new THREE.Vector3(-W / 2, 0, 0), new THREE.Vector3(W / 2, 0, 0), new THREE.Vector3(-W / 2, 0, -D), new THREE.Vector3(W / 2, 0, -D)].map((v) => group.localToWorld(v));
  g.world.collision.addBox({ minX: Math.min(...corners.map((p) => p.x)), maxX: Math.max(...corners.map((p) => p.x)), minZ: Math.min(...corners.map((p) => p.z)), maxZ: Math.max(...corners.map((p) => p.z)), minY: y - 1, maxY: y + H + 0.5, tag: `shop:${def.key}` });
  const door = group.localToWorld(new THREE.Vector3(0, y, 1.6));
  door.y = y;
  // Display cars on the dealer's forecourt (not drivable: they're for sale).
  if (def.key === 'carDealer') {
    ['sports', 'convertible', 'muscle', 'suv'].forEach((id, i) => {
      const v = new Vehicle(id, undefined, `display${i}`);
      const p = group.localToWorld(new THREE.Vector3(-W / 2 + 4 + i * ((W - 8) / 3), 0, setback * 0.55));
      v.scripted = true;
      v.place(p.x, p.z, fp.yaw + 0.5, g.world);
      g.renderer.scene.add(v.root);
      g.world.collision.addCircle({ x: p.x, z: p.z, r: 2.2, minY: y - 1, maxY: y + 1.5, tag: 'shop:display' });
    });
  }
  return { key: def.key, name: def.name, icon: def.icon, door, yaw: fp.yaw, lot };
}
