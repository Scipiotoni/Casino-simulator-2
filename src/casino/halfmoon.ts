import * as THREE from 'three';
import { Kit } from '../render/kit';
import { markStatic } from '../render/mergeStatic';
import { stoolParts, type TableBase } from './table';

/**
 * The classic half-moon card table (baccarat, three card poker): a felt half disc with a
 * padded rail, the dealer's straight edge with a chip float, a shoe, stools round the
 * curve. Returns the seat angles and a polar helper so the games can lay out their spots.
 */

export const HM = { cx: 0, cz: -0.35, R: 1.15 };

export function hmPolar(r: number, a: number): [number, number] {
  return [HM.cx + Math.sin(a) * r, HM.cz + Math.cos(a) * r];
}

const FELT_MATS = new Map<string, THREE.MeshLambertMaterial>();

export function buildHalfMoon(t: TableBase, key: string, drawFelt: (g: CanvasRenderingContext2D, W: number, H: number, s: number) => void, color: string, angles: number[]): { felt: THREE.Mesh; shoe: THREE.Object3D } {
  const y = t.surfaceY;
  const R = HM.R;
  const C = HM;
  let mat = FELT_MATS.get(key + color);
  if (!mat) {
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    drawFelt(g, W, H, W / 2 / R);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mat = new THREE.MeshLambertMaterial({ map: tex });
    FELT_MATS.set(key + color, mat);
  }
  const pos: number[] = [C.cx, y, C.cz];
  const uv: number[] = [0.5, 1];
  const idx: number[] = [];
  const seg = 48;
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI;
    const x = C.cx + Math.sin(a) * R;
    const z = C.cz + Math.cos(a) * R;
    pos.push(x, y, z);
    uv.push((x + R) / (2 * R), 1 - (z - C.cz) / R);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const felt = new THREE.Mesh(g, mat);
  felt.receiveShadow = true;
  markStatic(felt);
  t.group.add(felt);
  t.pickables.push(felt);
  const k = new Kit();
  k.add(new THREE.TorusGeometry(R + 0.02, 0.055, 10, 40, Math.PI), 0x1a1214, { x: C.cx, y: y + 0.01, z: C.cz, rx: -Math.PI / 2, rz: -Math.PI / 2 }, 'shiny');
  k.add(new THREE.CylinderGeometry(R + 0.09, R + 0.09, 0.08, 40, 1, false, -Math.PI / 2, Math.PI), 0x6b3a1e, { x: C.cx, y: y - 0.05, z: C.cz }, 'shiny');
  k.box(2 * R + 0.18, 0.08, 0.12, 0x6b3a1e, { x: 0, y: y - 0.05, z: C.cz - 0.05 }, 'shiny');
  k.add(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.5, 30, 1, false, -Math.PI / 2, Math.PI), 0x2a1a12, { x: C.cx, y: y - 0.34, z: C.cz });
  k.box(0.62, 0.035, 0.16, 0x111114, { x: 0, y: y + 0.018, z: C.cz + 0.1 }, 'shiny');
  for (let i = 0; i < 8; i++) {
    const col = [0xf4f4f0, 0xd8202f, 0x1f9a4c, 0x18181c, 0x6a2fb8, 0xf2c230, 0xd8202f, 0x1f9a4c][i];
    k.cyl(0.0195, 0.0195, 0.12, col, { x: -0.27 + i * 0.077, y: y + 0.045, z: C.cz + 0.1, rz: Math.PI / 2 }, 'matte', 14);
  }
  // Shoe.
  k.push({ x: 0.78, y, z: C.cz + 0.14, ry: -0.6 });
  k.box(0.13, 0.09, 0.2, 0x1b1b20, { y: 0.045 }, 'shiny');
  k.box(0.11, 0.06, 0.17, 0xf2efe6, { y: 0.07, z: -0.01 });
  k.box(0.13, 0.02, 0.06, 0x1b1b20, { y: 0.06, z: 0.11, rx: -0.5 }, 'shiny');
  k.pop();
  // Display stand.
  k.box(0.44, 0.15, 0.02, 0x111114, { x: -0.46, y: y + 0.1, z: C.cz + 0.01, rx: -0.35, ry: 0.25 }, 'shiny');
  for (const a of angles) {
    const [x, z] = hmPolar(1.52, a);
    stoolParts(k, x, z, a + Math.PI);
    t.seats.push({ x, z, yaw: a + Math.PI, who: null, eye: 1.24 });
  }
  const body = k.bake({ shadows: true });
  markStatic(body);
  t.group.add(body);
  t.display.mesh.position.set(-0.46, y + 0.17, C.cz + 0.02);
  t.display.mesh.rotation.set(-0.35, 0.25, 0);
  t.group.add(t.display.mesh);
  const shoe = new THREE.Object3D();
  shoe.position.set(0.78, y + 0.08, C.cz + 0.24);
  t.group.add(shoe);
  return { felt, shoe };
}

/** Text along an arc at radius r (felt canvas coordinates; the centre is the top middle). */
export function feltArcLabel(g: CanvasRenderingContext2D, text: string, cx: number, r: number, a: number, size: number, color: string): void {
  g.save();
  g.translate(cx + Math.sin(a) * r, Math.cos(a) * r);
  g.rotate(-a);
  g.fillStyle = color;
  g.font = `${size}px "Lilita One", Arial`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 0);
  g.restore();
}
