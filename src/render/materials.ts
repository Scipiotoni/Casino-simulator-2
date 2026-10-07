import * as THREE from 'three';

/**
 * Shared materials. Everything uses cheap Lambert / Phong shading with a soft rim light
 * patched in, which reads as the bright, chunky "stylized hero" look on any GPU. No PBR,
 * no post-processing: old integrated graphics chips run it fine.
 */

/** Uniforms shared by every patched material (updated once per frame by the sky). */
export const RIM = {
  color: { value: new THREE.Color(0xffffff) },
  strength: { value: 0.32 },
};

/** Add a view-dependent rim light (bright edges, like a stylized hero shot) to a material. */
export function withRim<T extends THREE.Material>(m: T, strength = 1): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.rimColor = RIM.color;
    shader.uniforms.rimStrength = { value: RIM.strength.value * strength };
    shader.uniforms.rimGlobal = RIM.strength;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimGlobal;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vDir = normalize(vViewPosition);
          float rim = 1.0 - max(dot(normal, -vDir), 0.0);
          rim = smoothstep(0.45, 1.0, rim);
          outgoingLight += rimColor * rim * rimStrength * (rimGlobal / 0.32) * diffuseColor.rgb;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `rim${strength}`;
  return m;
}

const lamCache = new Map<string, THREE.MeshLambertMaterial>();

export interface LamOpts {
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  rim?: number;
  flat?: boolean;
}

/** A cached Lambert material. Same arguments, same instance, so meshes batch well. */
export function lam(color: number, o: LamOpts = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${o.emissive ?? 0}|${o.emissiveIntensity ?? 1}|${o.side ?? 0}|${o.transparent ? 1 : 0}|${o.opacity ?? 1}|${o.rim ?? 0}|${o.flat ? 1 : 0}`;
  let m = lamCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: o.emissive ?? 0,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      flatShading: o.flat ?? false,
    });
    if (o.rim) withRim(m, o.rim);
    lamCache.set(key, m);
  }
  return m;
}

/** Vertex-coloured Lambert (most merged scenery uses this). */
export const VCOL = withRim(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.6);
export const VCOL_FLAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const VCOL_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

const phongCache = new Map<string, THREE.MeshPhongMaterial>();
/** Shiny things: car paint, chrome, glass, polished stone. */
export function phong(color: number, shininess = 60, specular = 0x666666, o: { transparent?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshPhongMaterial {
  const key = `${color}|${shininess}|${specular}|${o.transparent ? 1 : 0}|${o.opacity ?? 1}|${o.emissive ?? 0}`;
  let m = phongCache.get(key);
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, shininess, specular, transparent: o.transparent ?? false, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0 });
    phongCache.set(key, m);
  }
  return m;
}

const glowCache = new Map<number, THREE.MeshBasicMaterial>();
/** Unlit, always-bright colour for neon tubes, screens and lamps. */
export function glow(color: number): THREE.MeshBasicMaterial {
  let m = glowCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    glowCache.set(color, m);
  }
  return m;
}

export const GOLD = phong(0xe8b030, 90, 0xffe7a0);
export const CHROME = phong(0xd8dde4, 120, 0xffffff);
export const BLACK_GLOSS = phong(0x16161c, 80, 0x888888);
export const GLASS = phong(0x9ccfe8, 120, 0xffffff, { transparent: true, opacity: 0.35 });
export const DARK_GLASS = phong(0x1c2a3a, 120, 0xbbbbbb, { transparent: true, opacity: 0.7 });
