import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { TerrainMesh } from '../world/terrainMesh';
import { Sky } from '../render/sky';
import { Water } from '../render/water';
import type { Renderer } from '../render/renderer';
import { Collision } from '../world/collision';
import { RoadMesh } from '../world/roadMesh';
import { CityBuildings } from '../world/buildings';
import { Vegetation } from '../world/vegetation';
import { Bridge, mainlandY } from '../world/bridge';
import { buildVenues } from '../world/venues';
import type { Venue } from '../casino/venue';

export type Progress = (fraction: number, message: string) => Promise<void>;

/** Everything static about the island, plus the sky and the sea. */
export class World {
  readonly group = new THREE.Group();
  terrain!: Terrain;
  terrainMesh!: TerrainMesh;
  sky!: Sky;
  water!: Water;
  readonly collision = new Collision();
  roads!: RoadMesh;
  city!: CityBuildings;
  vegetation!: Vegetation;
  bridge!: Bridge;
  venues: Venue[] = [];
  elapsed = 0;

  constructor(private r: Renderer) {
    r.scene.add(this.group);
  }

  async build(progress: Progress): Promise<void> {
    await progress(0.05, 'Raising the island from the sea');
    this.terrain = new Terrain();
    await progress(0.35, 'Shaping the hills');
    this.terrainMesh = new TerrainMesh(this.terrain);
    this.terrainMesh.setDetail(this.r.spec.terrain);
    this.terrainMesh.shadows = this.r.spec.shadows;
    this.group.add(this.terrainMesh.group);
    this.terrainMesh.update(0, 0, 40);
    await progress(0.5, 'Filling the ocean');
    const { tex, bounds } = this.terrainMesh.depthTexture();
    this.water = new Water(tex, bounds);
    this.group.add(this.water.mesh);
    await progress(0.55, 'Paving the roads');
    this.roads = new RoadMesh(this.terrain);
    this.group.add(this.roads.group);
    this.bridge = new Bridge(this.collision, this.roads.material);
    this.group.add(this.bridge.group);
    await progress(0.65, 'Building the city');
    this.city = new CityBuildings(this.terrain, this.collision);
    this.group.add(this.city.group);
    await progress(0.74, 'Opening the casinos');
    this.venues = buildVenues(this.terrain, this.collision);
    for (const v of this.venues) this.group.add(v.group);
    await progress(0.8, 'Planting palm trees');
    this.vegetation = new Vegetation(this.terrain, this.collision, this.r.spec.foliage);
    this.group.add(this.vegetation.group);
    this.sky = new Sky(this.r.scene);
    this.sky.setShadows(this.r.spec.shadows, this.r.spec.shadowSize);
  }

  /** Ground under a point: the terrain, or a floor (bridge deck, building floor) you can step onto. */
  groundY(x: number, z: number, fromY = Infinity): number {
    const t = this.terrain.heightAt(x, z);
    const f = fromY === Infinity ? this.collision.topFloorAt(x, z) : this.collision.floorAt(x, z, fromY);
    if (f !== null && f > t) return f;
    if (x > 6150) return Math.max(t, mainlandY(x, z));
    return t;
  }

  /** The venue a point is inside, if any. */
  venueAt(x: number, z: number): Venue | null {
    for (const v of this.venues) if (v.contains(x, z)) return v;
    return null;
  }

  update(dt: number, hours: number, focus: THREE.Vector3): void {
    this.elapsed += dt;
    const cam = this.r.camera;
    const inside = this.venueAt(focus.x, focus.z);
    this.sky.indoor += ((inside ? 1 : 0) - this.sky.indoor) * Math.min(1, dt * 4);
    // Indoors the walls hide the trees anyway: skip drawing them.
    this.vegetation.group.visible = !inside;
    for (const v of this.venues) {
      const d = Math.hypot((v.bounds.minX + v.bounds.maxX) / 2 - focus.x, (v.bounds.minZ + v.bounds.maxZ) / 2 - focus.z);
      v.update(this.sky.night, d < 140);
      const seen = d < 70;
      for (const t of v.tables) {
        if (seen) t.table.updateLods(cam.position);
        t.table.update(dt, seen);
      }
    }
    this.terrainMesh.update(cam.position.x, cam.position.z);
    this.sky.update(hours, focus, cam, dt, this.elapsed);
    this.water.update(this.elapsed, cam, this.sky.sunDir, this.sky.sun.color, this.sky.fogColor, this.sky.night);
    const spec = this.r.spec;
    this.roads.update(cam.position.x, cam.position.z, spec.fogFar);
    this.city.update(cam.position.x, cam.position.z, this.sky.night, spec.viewDistance, spec.fogFar);
    this.bridge.update(this.sky.night);
    this.vegetation.update(cam.position.x, cam.position.z, Math.min(spec.fogFar * 0.5, spec.viewDistance * 1.2));
    const fog = this.r.scene.fog as THREE.Fog;
    fog.far = this.r.spec.fogFar;
    fog.near = fog.far * 0.06;
  }
}
