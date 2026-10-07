import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bake everything marked static under `root` into one mesh per material. A casino floor
 * full of machines and tables collapses from hundreds of draw calls to a handful; only the
 * moving parts (reels, cards, wheels, people) stay separate.
 */

export function markStatic(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.static = true;
  });
}

export function mergeStatic(root: THREE.Object3D, into: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(into.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shadows = new Map<THREE.Material, boolean>();
  const victims: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.userData.static || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (Array.isArray(m.material)) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    let list = byMat.get(m.material);
    if (!list) byMat.set(m.material, (list = []));
    list.push(g);
    shadows.set(m.material, (shadows.get(m.material) ?? false) || m.castShadow);
    victims.push(m);
  });
  let n = 0;
  for (const [mat, list] of byMat) {
    // Geometries must share attribute sets to merge; split by signature.
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const g of list) {
      const sig = Object.keys(g.attributes).sort().join(',');
      let a = groups.get(sig);
      if (!a) groups.set(sig, (a = []));
      a.push(g);
    }
    for (const gs of groups.values()) {
      const merged = mergeGeometries(gs, false);
      gs.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows.get(mat) ?? false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.merged = true;
      into.add(mesh);
      n++;
    }
  }
  for (const v of victims) v.removeFromParent();
  return n;
}
