import type { MapMarker } from '../ui/map';

/**
 * A side activity (shoplifting, the docks, hidden packages, races, taxi jobs…). Each lives
 * in its own folder under src/activities and plugs into the game through this interface:
 * the game calls update() every frame once you're past the title screen, asks for map markers,
 * and saves/loads whatever state it returns.
 */
export interface Activity {
  /** Stable key for saves. */
  readonly id: string;
  /** Every frame while the game is running (not on the title screen). */
  update(dt: number): void;
  /** Markers for the minimap (full = false) or the big map (full = true). */
  markers?(full: boolean): MapMarker[];
  /** JSON-safe state to save, and to restore on load. */
  save?(): unknown;
  load?(data: unknown): void;
}
