import * as THREE from 'three';
import { loadJSON, saveJSON } from '../core/storage';

export type Quality = 'low' | 'medium' | 'high';

/** Everything a graphics preset decides. "Low" is tuned for old laptops and integrated GPUs. */
export interface QualitySpec {
  /** Multiplier on the device pixel ratio (clamped). The adaptive scaler works below this. */
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  /** How far buildings, trees and props are drawn, in metres. */
  viewDistance: number;
  /** Where the haze is complete (the land itself is cheap, so it's drawn further). */
  fogFar: number;
  /** 0..1 share of trees and bushes drawn. */
  foliage: number;
  /** Pedestrians and traffic around the player. */
  crowd: number;
  traffic: number;
  /** Terrain mesh detail multiplier (1 = full). */
  terrain: number;
  /** Fake glow sprites around neon and lamps. */
  glow: boolean;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 0, viewDistance: 900, fogFar: 3400, foliage: 0.35, crowd: 10, traffic: 8, terrain: 0.5, glow: false },
  medium: { pixelRatio: 1, shadows: false, shadowSize: 0, viewDistance: 1500, fogFar: 4800, foliage: 0.7, crowd: 22, traffic: 16, terrain: 1, glow: true },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, viewDistance: 2200, fogFar: 6500, foliage: 1, crowd: 36, traffic: 26, terrain: 1, glow: true },
};

export interface GraphicsSettings {
  quality: Quality;
  /** Drop the resolution automatically when the frame rate sags. */
  adaptive: boolean;
  fov: number;
}

const SETTINGS_KEY = 'cs2.graphics';

/** Guess a sensible preset from what the browser tells us about the GPU. */
export function detectQuality(gl: WebGLRenderingContext | WebGL2RenderingContext | null): Quality {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 4;
    const mem = nav.deviceMemory ?? 4;
    let gpu = '';
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
    }
    const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
    if (/swiftshader|llvmpipe|software|microsoft basic/.test(gpu)) return 'low';
    if (mobile || cores <= 2 || mem <= 2) return 'low';
    if (/intel|hd graphics|uhd|mali|adreno|powervr|apple gpu/.test(gpu) || cores <= 4) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  settings: GraphicsSettings;
  spec: QualitySpec;
  /** Current adaptive scale on top of the preset (0.5..1). */
  private dynScale = 1;
  private fpsSamples: number[] = [];
  private lastAdjust = 0;
  fps = 60;
  private onResizeCbs: (() => void)[] = [];

  constructor(private container: HTMLElement) {
    const saved = loadJSON<GraphicsSettings>(SETTINGS_KEY);
    // Antialiasing has to be chosen when the context is made; skip it on the low preset.
    const probe = document.createElement('canvas');
    let detected: Quality = 'medium';
    try {
      detected = detectQuality(probe.getContext('webgl2') ?? probe.getContext('webgl'));
    } catch {
      /* ignore */
    }
    this.settings = saved && QUALITY[saved.quality] ? { ...{ adaptive: true, fov: 62 }, ...saved } : { quality: detected, adaptive: true, fov: 62 };
    this.spec = QUALITY[this.settings.quality];
    this.gl = new THREE.WebGLRenderer({
      antialias: this.settings.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.shadowMap.enabled = this.spec.shadows;
    this.gl.domElement.className = 'game-canvas';
    container.appendChild(this.gl.domElement);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.12, 14000);
    this.scene.fog = new THREE.Fog(0xbfd8ee, 300, this.spec.fogFar);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  onResize(cb: () => void): void {
    this.onResizeCbs.push(cb);
  }

  setQuality(q: Quality): void {
    this.settings.quality = q;
    this.spec = QUALITY[q];
    this.gl.shadowMap.enabled = this.spec.shadows;
    this.dynScale = 1;
    this.save();
    this.resize();
  }

  setFov(fov: number): void {
    this.settings.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.save();
  }

  save(): void {
    saveJSON(SETTINGS_KEY, this.settings);
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2) * this.spec.pixelRatio * this.dynScale;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(Math.max(0.4, Math.min(2, this.pixelRatio)));
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const cb of this.onResizeCbs) cb();
  }

  /**
   * Track the frame rate and nudge the resolution down when it stays under 30 fps (and back
   * up when there's headroom), so slow machines stay playable without touching settings.
   */
  trackFrame(dt: number, now: number): void {
    if (dt <= 0) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fps = avg;
    if (!this.settings.adaptive || now - this.lastAdjust < 2.5 || this.fpsSamples.length < 50) return;
    if (avg < 28 && this.dynScale > 0.55) {
      this.dynScale = Math.max(0.55, this.dynScale - 0.12);
      this.lastAdjust = now;
      this.resize();
    } else if (avg > 55 && this.dynScale < 1) {
      this.dynScale = Math.min(1, this.dynScale + 0.08);
      this.lastAdjust = now;
      this.resize();
    }
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }
}
