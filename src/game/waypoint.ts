import * as THREE from 'three';
import { el, esc } from '../ui/dom';

/**
 * The objective marker: a tall golden beam of light you can see from across the island,
 * plus an on-screen marker with the distance that clings to the edge of the screen when
 * the target is behind you.
 */
export class Waypoint {
  readonly beam: THREE.Mesh;
  private marker: HTMLDivElement;
  target: THREE.Vector3 | null = null;
  label = '';
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, parent: HTMLElement) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,210,61,0)');
    gr.addColorStop(0.6, 'rgba(255,210,61,0.45)');
    gr.addColorStop(1, 'rgba(255,240,170,0.9)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 400, 12, 1, true), mat);
    this.beam.visible = false;
    this.beam.renderOrder = 6;
    scene.add(this.beam);
    this.marker = el('div', 'wp-marker');
    parent.appendChild(this.marker);
  }

  set(x: number, y: number, z: number, label: string): void {
    this.target = new THREE.Vector3(x, y, z);
    this.label = label;
    this.beam.position.set(x, y + 200, z);
    this.beam.visible = true;
  }

  clear(): void {
    this.target = null;
    this.beam.visible = false;
    this.marker.style.display = 'none';
  }

  /** Distance from a point to the target (Infinity when there's none). */
  distance(p: THREE.Vector3): number {
    if (!this.target) return Infinity;
    return Math.hypot(this.target.x - p.x, this.target.z - p.z);
  }

  update(camera: THREE.PerspectiveCamera, from: THREE.Vector3, visible: boolean): void {
    if (!this.target || !visible) {
      this.marker.style.display = 'none';
      return;
    }
    const d = this.distance(from);
    // The beam fades in close so it doesn't block the view.
    (this.beam.material as THREE.MeshBasicMaterial).opacity = Math.min(1, Math.max(0.15, (d - 8) / 60));
    this.tmp.copy(this.target).setY(this.target.y + 2.5);
    this.tmp.project(camera);
    const behind = this.tmp.z > 1;
    let x = this.tmp.x;
    let y = this.tmp.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
    if (edge) {
      const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 0.0001);
      x /= k;
      y /= k;
      if (behind) y = -0.86;
    }
    const sx = ((x + 1) / 2) * window.innerWidth;
    const sy = ((1 - y) / 2) * window.innerHeight;
    this.marker.style.display = 'block';
    this.marker.style.transform = `translate(${sx}px, ${sy}px)`;
    const dist = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    this.marker.innerHTML = `<div class="pin ${edge ? 'edge' : ''}"></div><div class="lbl">${esc(this.label)}<b>${dist}</b></div>`;
  }
}
