import * as THREE from 'three';

/**
 * The sea: one big plane that follows the camera, with a cheap shader. Depth comes from a
 * small texture baked from the island's height field, so the water goes turquoise over
 * the sand, deep blue offshore and gets a line of foam at the beach, all without a depth
 * pre-pass.
 */

const VERT = /* glsl */ `
#include <fog_pars_vertex>
uniform float time;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float time;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 deepColor;
uniform vec3 shallowColor;
uniform sampler2D depthTex;
uniform sampler2D noiseTex;
uniform vec4 depthBounds; // minX, minZ, sizeX, sizeZ
uniform float night;
varying vec3 vWorld;
void main() {
  vec2 uv = (vWorld.xz - depthBounds.xy) / depthBounds.zw;
  float depth = 1.0;
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) depth = texture2D(depthTex, uv).r;
  vec2 p = vWorld.xz;
  vec3 n1 = texture2D(noiseTex, p * 0.018 + vec2(time * 0.010, time * 0.006)).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(noiseTex, p * 0.047 - vec2(time * 0.013, -time * 0.009)).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(noiseTex, p * 0.0023 + vec2(-time * 0.002, time * 0.003)).rgb * 2.0 - 1.0;
  float calm = mix(0.35, 1.0, smoothstep(30.0, 400.0, length(cameraPosition.xz - vWorld.xz)));
  vec3 N = normalize(vec3((n1.x * 0.7 + n2.x * 0.5 + n3.x) * calm, 7.0, (n1.y * 0.7 + n2.y * 0.5 + n3.y) * calm));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  float dist = length(cameraPosition.xz - vWorld.xz);
  fres = mix(fres, 0.55, smoothstep(600.0, 4000.0, dist));
  vec3 water = mix(shallowColor, deepColor, smoothstep(0.0, 0.45, depth));
  vec3 col = mix(water, skyColor, clamp(fres, 0.0, 0.85));
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, sunDir), 0.0), 220.0) * 3.0 + pow(max(dot(R, sunDir), 0.0), 30.0) * 0.18;
  col += sunColor * spec * (1.0 - night * 0.7);
  // Surf: a band of foam where the water meets the sand, breaking in and out.
  float foamBand = 1.0 - smoothstep(0.0, 0.05, depth);
  float waveFoam = smoothstep(0.55, 0.9, n2.z * 0.5 + 0.5 + sin(time * 1.3 + depth * 90.0) * 0.25);
  col = mix(col, vec3(0.95), foamBand * (0.35 + waveFoam * 0.6));
  float alpha = mix(0.62, 0.97, smoothstep(0.0, 0.25, depth));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function noiseTexture(): THREE.DataTexture {
  // Tileable smooth noise in RG (normal x/z) and B (foam), built from summed sines of a
  // random lattice so it wraps cleanly.
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const waves: { kx: number; ky: number; ph: number; a: number }[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 18; i++) {
    waves.push({ kx: Math.floor(rnd() * 9) - 4, ky: Math.floor(rnd() * 9) - 4, ph: rnd() * 6.283, a: 0.4 + rnd() });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0;
      let dy = 0;
      let h = 0;
      for (const w of waves) {
        const arg = ((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.ph;
        h += Math.sin(arg) * w.a;
        dx += Math.cos(arg) * w.a * w.kx;
        dy += Math.cos(arg) * w.a * w.ky;
      }
      const i = (y * S + x) * 4;
      data[i] = Math.max(0, Math.min(255, 128 + dx * 9));
      data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 9));
      data[i + 2] = Math.max(0, Math.min(255, 128 + h * 22));
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class Water {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(depthTex: THREE.Texture, bounds: { minX: number; minZ: number; sizeX: number; sizeZ: number }) {
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xffffff) },
        skyColor: { value: new THREE.Color(0x9cc8ec) },
        deepColor: { value: new THREE.Color(0x0b4f7a) },
        shallowColor: { value: new THREE.Color(0x2fd0c8) },
        depthTex: { value: null },
        noiseTex: { value: null },
        depthBounds: { value: new THREE.Vector4() },
        night: { value: 0 },
      },
    ]);
    this.uniforms.depthTex.value = depthTex;
    this.uniforms.noiseTex.value = noiseTexture();
    (this.uniforms.depthBounds.value as THREE.Vector4).set(bounds.minX, bounds.minZ, bounds.sizeX, bounds.sizeZ);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      fog: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(36000, 36000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  update(time: number, camera: THREE.Camera, sunDir: THREE.Vector3, sunColor: THREE.Color, skyColor: THREE.Color, night: number): void {
    this.uniforms.time.value = time;
    (this.uniforms.sunDir.value as THREE.Vector3).copy(sunDir);
    (this.uniforms.sunColor.value as THREE.Color).copy(sunColor);
    (this.uniforms.skyColor.value as THREE.Color).copy(skyColor);
    (this.uniforms.deepColor.value as THREE.Color).setRGB(0.04, 0.3, 0.48).multiplyScalar(1 - night * 0.75);
    (this.uniforms.shallowColor.value as THREE.Color).setRGB(0.18, 0.78, 0.74).multiplyScalar(1 - night * 0.75);
    this.uniforms.night.value = night;
    this.mesh.position.set(Math.round(camera.position.x / 50) * 50, 0, Math.round(camera.position.z / 50) * 50);
  }
}
