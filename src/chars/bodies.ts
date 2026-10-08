import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import maleUrl from './assets/body_m.glb?url';
import femaleUrl from './assets/body_f.glb?url';

/**
 * The character bodies modelled in Blender (tools/blender/build_characters.py): one
 * continuous, smoothly skinned surface per body type, a lower-detail copy, the face patch
 * the painted face goes on, and a skirt. They're loaded once at boot, re-indexed onto the
 * game's own skeleton (bones are matched by name) and shared by every character.
 */

export interface BodyParts {
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  skirt: THREE.BufferGeometry;
}

const parts: Partial<Record<'m' | 'f', BodyParts>> = {};

export function bodyParts(f: boolean): BodyParts {
  const p = parts[f ? 'f' : 'm'];
  if (!p) throw new Error('Character bodies are not loaded yet (call loadBodies first)');
  return p;
}

/** Load both bodies. `boneIndex` maps a bone name to the game skeleton's index. */
export async function loadBodies(boneIndex: (name: string) => number): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    ([['m', maleUrl], ['f', femaleUrl]] as const).map(async ([key, url]) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      const found: Record<string, THREE.BufferGeometry> = {};
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        found[m.name] = toModelSpace(m, boneIndex);
      });
      const need = ['Body', 'BodyLow', 'Face', 'Skirt'];
      for (const n of need) if (!found[n]) throw new Error(`body_${key}.glb has no ${n}`);
      parts[key] = { hi: found.Body, lo: found.BodyLow, face: found.Face, skirt: found.Skirt };
    }),
  );
}

/** A skinned mesh's geometry in the character's model space, with skin indices in game order. */
function toModelSpace(m: THREE.SkinnedMesh, boneIndex: (name: string) => number): THREE.BufferGeometry {
  const src = m.geometry;
  const g = new THREE.BufferGeometry();
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const mat = m.matrixWorld;
  const nm = new THREE.Matrix3().getNormalMatrix(mat);
  const v = new THREE.Vector3();
  const p = new Float32Array(pos.count * 3);
  const n = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mat);
    p.set([v.x, v.y, v.z], i * 3);
    v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    n.set([v.x, v.y, v.z], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  const uv = src.getAttribute('uv');
  if (uv) {
    // glTF stores v downwards; the painted face atlas (a canvas texture) expects it upwards.
    const t = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) t.set([uv.getX(i), 1 - uv.getY(i)], i * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(t, 2));
  }
  const map = m.skeleton.bones.map((b) => Math.max(0, boneIndex(b.name)));
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const idx = new Uint16Array(si.count * 4);
  const wts = new Float32Array(si.count * 4);
  for (let i = 0; i < si.count; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      idx[i * 4 + k] = map[si.getComponent(i, k)] ?? 0;
      wts[i * 4 + k] = sw.getComponent(i, k);
      sum += wts[i * 4 + k];
    }
    if (sum > 0) for (let k = 0; k < 4; k++) wts[i * 4 + k] /= sum;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  if (src.index) g.setIndex(src.index.clone());
  return g;
}
