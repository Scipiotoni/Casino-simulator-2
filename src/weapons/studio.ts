import * as THREE from 'three';
import { DEFAULT_LOADOUT } from './loadout';
import { buildWeapon } from './standin';

/**
 * A small renderer of its own for weapons on a plain backdrop: the gunsmith's live preview
 * (its canvas sits in the gunsmith) and the icons on shop cards and the weapon wheel
 * (rendered once each into a render target, read back and cached as images).
 */

let studio: Studio | null = null;

export function getStudio(): Studio {
  return (studio ??= new Studio());
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 2, 0.01, 50);
  private icons = new Map<string, string>();
  private queue: { id: string; done: ((url: string) => void)[] }[] = [];
  private busy = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3020, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(2, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x9ac8ff, 1.4);
    rim.position.set(-2, 1, -2);
    this.scene.add(key, rim);
  }

  /** Point the camera at an object from its right side (+x), muzzle to the right, filling the frame. */
  frame(obj: THREE.Object3D, aspect: number, margin = 1.12, from = new THREE.Vector3(1, 0.12, 0.05)): void {
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.camera.aspect = aspect;
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const w = Math.max(size.z, size.x) * margin;
    const h = size.y * margin;
    const dist = Math.max(w / 2 / Math.tan(hf / 2), h / 2 / Math.tan(vf / 2)) + Math.max(size.x, 0.05);
    this.camera.position.copy(c).addScaledVector(from.clone().normalize(), dist);
    this.camera.near = dist / 50;
    this.camera.far = dist * 10;
    this.camera.lookAt(c);
    this.camera.updateProjectionMatrix();
  }

  /** A cached icon for a weapon (its default build), or null while it renders; `done` hears when it's ready. */
  icon(id: string, done?: (url: string) => void): string | null {
    const hit = this.icons.get(id);
    if (hit) return hit;
    let q = this.queue.find((x) => x.id === id);
    if (!q) this.queue.push((q = { id, done: [] }));
    if (done) q.done.push(done);
    this.pump();
    return null;
  }

  /** An <img> that fills in when the icon is ready. */
  iconImg(id: string, cls = 'wicon'): HTMLImageElement {
    const img = document.createElement('img');
    img.className = cls;
    img.alt = '';
    img.draggable = false;
    const url = this.icon(id, (u) => (img.src = u));
    if (url) img.src = url;
    return img;
  }

  private pump(): void {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    // One icon per frame so a shelf of cards doesn't stall the game.
    requestAnimationFrame(() => {
      const q = this.queue.shift()!;
      let url = '';
      try {
        url = this.renderIcon(q.id);
      } catch {
        url = '';
      }
      this.icons.set(q.id, url);
      for (const fn of q.done) fn(url);
      this.busy = false;
      this.pump();
    });
  }

  private renderIcon(id: string, W = 256, H = 112): string {
    const b = buildWeapon(id, DEFAULT_LOADOUT);
    this.scene.add(b.root);
    this.frame(b.root, W / H, 1.04, new THREE.Vector3(1, 0, 0));
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const px = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.scene.remove(b.root);
    b.dispose();
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    // Render targets read bottom-up.
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
}
