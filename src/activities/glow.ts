import * as THREE from 'three';

/**
 * Glowing marker materials shared by the activities' rings (the taxi's pickups, the courier's
 * drop-offs): an unlit, additive, see-through material and the soft gradients it's drawn with.
 */

/** A glowing, unlit, see-through material. */
export function additive(color: number, opacity: number, map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: map ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** A soft glow: radial (bright rim) for the ring's floor, vertical (fading upwards) for its curtain. */
export function glowTexture(radial: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = radial ? g.createRadialGradient(32, 32, 0, 32, 32, 32) : g.createLinearGradient(0, 0, 0, 64);
  if (radial) {
    gr.addColorStop(0, 'rgba(255,255,255,0.06)');
    gr.addColorStop(0.75, 'rgba(255,255,255,0.3)');
    gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(255,255,255,0.85)');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
