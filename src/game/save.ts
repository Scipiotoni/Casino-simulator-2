import { loadJSON, saveJSON, removeKey } from '../core/storage';
import type { Appearance } from '../chars/skins';

/**
 * Everything that persists. Version 2 of the game starts everyone from zero: this is a new
 * key, nothing is read from the first game's saves.
 */

export const SAVE_KEY = 'cs2.save.v1';

export interface OwnedVehicle {
  id: string;
  def: string;
  color: number;
  x: number;
  z: number;
  heading: number;
}

export interface PlacedItemSave {
  kind: string;
  x: number;
  z: number;
  yaw: number;
  level: number;
}

export interface BusinessSave {
  lot: string;
  type: string;
  name: string;
  level: number;
  /** Cash taken in over its life and today. */
  earned: number;
  today: number;
  /** Casino floor items. */
  items: PlacedItemSave[];
  staff: number;
  style: number;
  builtAt: number;
  /** Seconds left on construction (0 = open). */
  building: number;
  xp: number;
}

export interface SaveData {
  version: 1;
  name: string;
  appearance: Appearance;
  ownedSkins: string[];
  money: number;
  day: number;
  hours: number;
  pos: { x: number; y: number; z: number; yaw: number };
  story: { chapter: number; step: number; flags: Record<string, number> };
  businesses: BusinessSave[];
  vehicles: OwnedVehicle[];
  weapons: string[];
  stats: Record<string, number>;
  settings: { music: number; sfx: number; sensitivity: number; invertY: boolean };
  savedAt: number;
}

export function newSave(name: string, appearance: Appearance): SaveData {
  return {
    version: 1,
    name,
    appearance,
    ownedSkins: ['rookie', 'rookieF'],
    money: 0,
    day: 1,
    hours: 19.1,
    pos: { x: 6200, y: 10, z: -300, yaw: -Math.PI / 2 },
    story: { chapter: 0, step: 0, flags: {} },
    businesses: [],
    vehicles: [],
    weapons: [],
    stats: {},
    settings: { music: 0.45, sfx: 0.9, sensitivity: 1, invertY: false },
    savedAt: Date.now(),
  };
}

export function loadSave(): SaveData | null {
  const s = loadJSON<SaveData>(SAVE_KEY);
  if (!s || s.version !== 1 || !s.appearance) return null;
  // Fill anything an older build didn't write.
  s.ownedSkins ??= ['rookie', 'rookieF'];
  s.businesses ??= [];
  s.vehicles ??= [];
  s.weapons ??= [];
  s.stats ??= {};
  s.story ??= { chapter: 0, step: 0, flags: {} };
  s.story.flags ??= {};
  s.settings ??= { music: 0.45, sfx: 0.9, sensitivity: 1, invertY: false };
  if (!Number.isFinite(s.money)) s.money = 0;
  return s;
}

export function writeSave(s: SaveData): boolean {
  s.savedAt = Date.now();
  return saveJSON(SAVE_KEY, s);
}

export function deleteSave(): void {
  removeKey(SAVE_KEY);
}
