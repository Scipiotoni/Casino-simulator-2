import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { RIM } from './materials';
import { mulberry32 } from '../core/noise';

/**
 * Sky dome, sun, moon, stars, clouds and the day/night lighting. One cheap shader for the
 * dome (gradient + sun glow + hashed stars), billboard clouds, a hemisphere light for the
 * fill and one directional light for the sun (or moon) that can cast shadows on "high".
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 moonDir;
uniform float stars;
uniform float time;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(horizonColor, topColor, pow(smoothstep(0.0, 0.62, h), 0.75)) : mix(horizonColor, bottomColor, smoothstep(0.0, -0.25, h));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6);
  col += sunColor * smoothstep(0.9993, 0.99965, s) * 4.0;
  float m = max(dot(d, moonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9998, m) * 1.6 * stars;
  col += vec3(0.3, 0.35, 0.5) * pow(m, 40.0) * 0.25 * stars;
  if (stars > 0.01 && h > 0.0) {
    vec3 cell = floor(d * 420.0);
    float n = hash(cell);
    float tw = 0.65 + 0.35 * sin(time * 2.0 + n * 40.0);
    col += vec3(smoothstep(0.9965, 1.0, n)) * stars * tw * smoothstep(0.0, 0.25, h) * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface SkyKey {
  t: number;
  top: number;
  horizon: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  fog: number;
}

// Colour keys through the day (hours).
const KEYS: SkyKey[] = [
  { t: 0, top: 0x060b1e, horizon: 0x16213f, sun: 0x9fb4ff, sunI: 0.32, hemiSky: 0x3a4c80, hemiGround: 0x141820, hemiI: 0.55, fog: 0x141c34 },
  { t: 5, top: 0x0b1430, horizon: 0x2a3150, sun: 0x9fb4ff, sunI: 0.28, hemiSky: 0x3a4c80, hemiGround: 0x141820, hemiI: 0.55, fog: 0x1d2440 },
  { t: 6, top: 0x3b5d9a, horizon: 0xf2a070, sun: 0xffb070, sunI: 0.9, hemiSky: 0x9fb0d8, hemiGround: 0x4a3a30, hemiI: 0.7, fog: 0xd8a888 },
  { t: 8, top: 0x3d82d8, horizon: 0xb8daf2, sun: 0xfff0d8, sunI: 1.6, hemiSky: 0xbfdcff, hemiGround: 0x6a5a40, hemiI: 0.95, fog: 0xbcd8ee },
  { t: 13, top: 0x2f78d6, horizon: 0xb4d8f4, sun: 0xffffff, sunI: 1.85, hemiSky: 0xc4e0ff, hemiGround: 0x706048, hemiI: 1.0, fog: 0xbcdaf2 },
  { t: 17.5, top: 0x3a76c8, horizon: 0xe8c8a0, sun: 0xffe0b0, sunI: 1.5, hemiSky: 0xbfd0ee, hemiGround: 0x6a5040, hemiI: 0.9, fog: 0xe0ccb0 },
  { t: 19.3, top: 0x35477e, horizon: 0xff8a5a, sun: 0xff8040, sunI: 0.95, hemiSky: 0x8a80b0, hemiGround: 0x4a3030, hemiI: 0.7, fog: 0xd88a6a },
  { t: 20.5, top: 0x101a3c, horizon: 0x3a3060, sun: 0x9fb4ff, sunI: 0.3, hemiSky: 0x40508a, hemiGround: 0x181820, hemiI: 0.58, fog: 0x262a4a },
  { t: 24, top: 0x060b1e, horizon: 0x16213f, sun: 0x9fb4ff, sunI: 0.32, hemiSky: 0x3a4c80, hemiGround: 0x141820, hemiI: 0.55, fog: 0x141c34 },
];

const _a = new THREE.Color();
const _b = new THREE.Color();
function lerpHex(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  _a.setHex(a);
  _b.setHex(b);
  return out.copy(_a).lerp(_b, t);
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const r = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const x = 40 + r() * 176;
    const y = 50 + r() * 40 - Math.abs(x - 128) * 0.12;
    const rad = 18 + r() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1.6);
  readonly hemi = new THREE.HemisphereLight(0xc4e0ff, 0x706048, 1);
  private uniforms: Record<string, THREE.IUniform>;
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshBasicMaterial;
  private cloudData: { x: number; z: number; y: number; s: number; v: number }[] = [];
  /** 0 by day, 1 at night: drives window lights, neon and street lamps. */
  night = 0;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly fogColor = new THREE.Color();
  private shadowsOn = false;
  /** 0 outdoors, 1 inside a building: warm, even interior light whatever the time. */
  indoor = 0;

  constructor(private scene: THREE.Scene) {
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      bottomColor: { value: new THREE.Color(0x1a3a5a) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      stars: { value: 0 },
      time: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10000, 32, 16), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    scene.add(this.sun, this.sun.target, this.hemi);

    // A field of soft billboard clouds high over the island.
    const geo = new THREE.PlaneGeometry(1, 0.5);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    const N = 70;
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMat, N);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    const r = mulberry32(99);
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2;
      const d = 900 + r() * 6500;
      this.cloudData.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 650 + r() * 500, s: 500 + r() * 900, v: 2 + r() * 3 });
    }
    scene.add(this.clouds);
  }

  setShadows(on: boolean, size: number): void {
    this.shadowsOn = on;
    this.sun.castShadow = on;
    if (on) {
      this.sun.shadow.mapSize.set(size, size);
      const c = this.sun.shadow.camera;
      c.left = -60;
      c.right = 60;
      c.top = 60;
      c.bottom = -60;
      c.near = 10;
      c.far = 600;
      c.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
    }
  }

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();

  /** `hours` is the game clock (0..24); `focus` is where the camera is. */
  update(hours: number, focus: THREE.Vector3, camera: THREE.Camera, dt: number, elapsed: number): void {
    const h = ((hours % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= h) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[i + 1];
    const t = clamp((h - k0.t) / Math.max(0.001, k1.t - k0.t), 0, 1);
    const u = this.uniforms;
    lerpHex(k0.top, k1.top, t, u.topColor.value as THREE.Color);
    lerpHex(k0.horizon, k1.horizon, t, u.horizonColor.value as THREE.Color);
    lerpHex(k0.sun, k1.sun, t, u.sunColor.value as THREE.Color);
    lerpHex(k0.fog, k1.fog, t, this.fogColor);
    (u.bottomColor.value as THREE.Color).copy(this.fogColor).multiplyScalar(0.55);

    // Sun path: rises in the east (+x) at 6:00, sets in the west at 20:00, tilted south.
    const dayT = (h - 6) / 14;
    const ang = dayT * Math.PI;
    const sx = Math.cos(ang);
    const sy = Math.sin(ang);
    this.sunDir.set(sx, sy * 0.92 + 0.0, 0.38).normalize();
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    const moonAng = ((h + 12 - 6) / 14) * Math.PI;
    const moonDir = new THREE.Vector3(Math.cos(moonAng), Math.sin(moonAng) * 0.9, -0.3).normalize();
    (u.moonDir.value as THREE.Vector3).copy(moonDir);

    const dayLight = smoothstep(-0.08, 0.18, this.sunDir.y);
    this.night = 1 - smoothstep(-0.12, 0.12, this.sunDir.y);
    u.stars.value = this.night;
    u.time.value = elapsed;

    // The key light follows the sun by day and the moon at night.
    const lightDir = dayLight > 0.02 ? this.sunDir : moonDir;
    this.sun.color.copy(u.sunColor.value as THREE.Color);
    this.sun.intensity = lerp(k0.sunI, k1.sunI, t) * (dayLight > 0.02 ? Math.max(0.25, dayLight) : 0.6);
    this.hemi.color.copy(lerpHex(k0.hemiSky, k1.hemiSky, t, _a.clone()));
    this.hemi.groundColor.copy(lerpHex(k0.hemiGround, k1.hemiGround, t, _b.clone()));
    this.hemi.intensity = lerp(k0.hemiI, k1.hemiI, t);
    if (this.indoor > 0) {
      const k = this.indoor;
      this.hemi.color.lerp(_indoorSky, k);
      this.hemi.groundColor.lerp(_indoorGround, k);
      this.hemi.intensity += (1.25 - this.hemi.intensity) * k;
      this.sun.intensity *= 1 - 0.55 * k;
      this.sun.color.lerp(_indoorSun, k);
    }
    RIM.color.value.copy(this.hemi.color).lerp(new THREE.Color(0xffffff), 0.3);
    RIM.strength.value = 0.22 + 0.18 * dayLight;

    const shadowDist = 250;
    // Snap the shadow camera to texels so shadows don't shimmer as you walk.
    const snap = this.shadowsOn ? 120 / this.sun.shadow.mapSize.x : 1;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * shadowDist, focus.y + Math.max(0.15, lightDir.y) * shadowDist, fz + lightDir.z * shadowDist);

    this.dome.position.copy(camera.position);

    // Clouds drift west and take the colour of the light.
    const cc = this.cloudMat.color;
    cc.copy(this.hemi.color).lerp(u.sunColor.value as THREE.Color, 0.35).multiplyScalar(0.5 + dayLight * 0.75);
    if (this.night > 0.5) cc.multiplyScalar(0.5);
    this.cloudMat.opacity = 0.55 + dayLight * 0.35;
    for (let j = 0; j < this.cloudData.length; j++) {
      const c = this.cloudData[j];
      c.x -= c.v * dt;
      if (c.x < -8000) c.x += 16000;
      this._p.set(c.x, c.y, c.z);
      // Face the camera (yaw only, so they stay level).
      const yaw = Math.atan2(camera.position.x - c.x, camera.position.z - c.z);
      this._q.setFromAxisAngle(_up, yaw);
      this._s.set(c.s, c.s, 1);
      this._m.compose(this._p, this._q, this._s);
      this.clouds.setMatrixAt(j, this._m);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _indoorSky = new THREE.Color(0xfff0dc);
const _indoorGround = new THREE.Color(0x8a6a50);
const _indoorSun = new THREE.Color(0xffe6c0);
