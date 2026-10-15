import { loadJSON, saveJSON, removeKey } from '../core/storage';
import { appearanceFromSkin, sanitizeAppearance, type Appearance } from '../chars/skins';

/**
 * Everything that persists. Everyone starts the same way (some cash, no home, no car): this
 * is a new key, nothing is read from the first game's saves.
 */

export const SAVE_KEY = 'cs2.save.v1';

/** Cash in your pocket on day one: enough for a small lot and a first casino (or a home). */
export const START_MONEY = 30000;

/** The flat in Palm Court, for sale on day one. */
export const FLAT_PRICE = 8000;

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

export interface SavedLook {
  name: string;
  a: Appearance;
}

/** How many looks the wardrobe keeps. */
export const MAX_LOOKS = 8;

export interface SaveData {
  version: 1;
  name: string;
  appearance: Appearance;
  ownedSkins: string[];
  money: number;
  day: number;
  hours: number;
  pos: { x: number; y: number; z: number; yaw: number };
  businesses: BusinessSave[];
  vehicles: OwnedVehicle[];
  weapons: string[];
  stats: Record<string, number>;
  /** Side-activity state, by activity id. */
  activities?: Record<string, unknown>;
  /** Looks saved in the wardrobe. */
  looks?: SavedLook[];
  /** Do you own the flat in Palm Court? (Saves from before homes were sold had it.) */
  flat?: boolean;
  settings: { music: number; sfx: number; sensitivity: number; invertY: boolean };
  savedAt: number;
}

export function newSave(name: string, appearance: Appearance): SaveData {
  return {
    version: 1,
    name,
    appearance,
    ownedSkins: ['rookie', 'rookieF'],
    money: START_MONEY,
    day: 1,
    hours: 19.1,
    pos: { x: 6200, y: 10, z: -300, yaw: -Math.PI / 2 },
    businesses: [],
    vehicles: [],
    weapons: [],
    stats: {},
    flat: false,
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
  if (typeof s.flat !== 'boolean') s.flat = true;
  s.settings ??= { music: 0.45, sfx: 0.9, sensitivity: 1, invertY: false };
  if (!Number.isFinite(s.money)) s.money = 0;
  s.appearance = sanitizeAppearance(s.appearance, appearanceFromSkin('rookie'));
  s.looks = Array.isArray(s.looks)
    ? s.looks.slice(0, MAX_LOOKS).map((l, i) => ({ name: typeof l?.name === 'string' ? l.name.slice(0, 20) : `Look ${i + 1}`, a: sanitizeAppearance(l?.a, s.appearance) }))
    : [];
  return s;
}

export function writeSave(s: SaveData): boolean {
  s.savedAt = Date.now();
  return saveJSON(SAVE_KEY, s);
}

export function deleteSave(): void {
  removeKey(SAVE_KEY);
}
