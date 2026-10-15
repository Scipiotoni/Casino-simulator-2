import { weaponDef } from './catalog';
import { CAMOS, CHARMS } from './attachments';
import { DEFAULT_CROSSHAIR, DEFAULT_LOADOUT, equip, partKey, partUnlocked, sanitizeArmory, sanitizeLoadout, slotOptions, type ArmorySave, type CrosshairSettings, type Loadout, type Slot } from './loadout';

/**
 * Your weapons: which you own, the parts you've bought, how each is built, knockouts per
 * weapon (for the earned camos), and your crosshair. The gunsmith changes it; combat reads it.
 * Listeners hear about every change (the held weapon is rebuilt when its loadout changes).
 */
export class Armory {
  owned: string[] = [];
  parts: string[] = [];
  loadouts: Record<string, Loadout> = {};
  kills: Record<string, number> = {};
  crosshair: CrosshairSettings = { ...DEFAULT_CROSSHAIR };
  private listeners: ((weapon: string | null) => void)[] = [];

  /** Hear about changes (the weapon id whose build changed, or null for anything else). */
  onChange(fn: (weapon: string | null) => void): void {
    this.listeners.push(fn);
  }

  private changed(weapon: string | null): void {
    for (const fn of this.listeners) fn(weapon);
  }

  owns(id: string): boolean {
    return this.owned.includes(id);
  }

  /** Add a weapon (bought, found or taken from the armory). */
  give(id: string): void {
    if (!this.owns(id)) this.owned.push(id);
    this.loadouts[id] ??= { ...DEFAULT_LOADOUT };
    this.changed(id);
  }

  loadout(id: string): Loadout {
    return this.loadouts[id] ?? DEFAULT_LOADOUT;
  }

  /** Is this part yours to fit on this weapon? */
  unlocked(weapon: string, slot: Slot | 'camo' | 'charm', id: string): boolean {
    return partUnlocked(this.state(), weapon, slot, id);
  }

  /** What a part costs (0 if you have it). */
  price(weapon: string, slot: Slot | 'camo' | 'charm', id: string): number {
    if (this.unlocked(weapon, slot, id)) return 0;
    if (slot === 'camo') return CAMOS.find((c) => c.id === id)?.price ?? 0;
    if (slot === 'charm') return CHARMS.find((c) => c.id === id)?.price ?? 0;
    return slotOptions(weaponDef(weapon), slot).find((o) => o.id === id)?.price ?? 0;
  }

  /** Record a bought part (the caller takes the money). */
  unlock(weapon: string, slot: Slot | 'camo' | 'charm', id: string): void {
    const k = partKey(weapon, slot, id);
    if (!this.parts.includes(k)) this.parts.push(k);
    this.changed(null);
  }

  /** Fit a part you have (null takes it off). Anything it pushes off comes off. */
  fit(weapon: string, slot: Slot, id: string | null): void {
    if (id !== null && !this.unlocked(weapon, slot, id)) return;
    this.loadouts[weapon] = equip(weapon, this.loadout(weapon), slot, id);
    this.changed(weapon);
  }

  /** Change the camo, charm or reticle. */
  dress(weapon: string, patch: Partial<Pick<Loadout, 'camo' | 'charm' | 'reticle' | 'reticleColor'>>): void {
    if (patch.camo && !this.unlocked(weapon, 'camo', patch.camo)) return;
    if (patch.charm && !this.unlocked(weapon, 'charm', patch.charm)) return;
    this.loadouts[weapon] = sanitizeLoadout(weapon, { ...this.loadout(weapon), ...patch });
    this.changed(weapon);
  }

  setCrosshair(c: Partial<CrosshairSettings>): void {
    this.crosshair = { ...this.crosshair, ...c };
    this.changed(null);
  }

  /** A knockout with a weapon (for the earned camos). */
  addKill(weapon: string): void {
    this.kills[weapon] = (this.kills[weapon] ?? 0) + 1;
  }

  state(): ArmorySave {
    return { owned: this.owned, parts: this.parts, loadouts: this.loadouts, kills: this.kills, crosshair: this.crosshair };
  }

  /** Load a save (older saves only had a list of weapon ids). */
  load(raw: unknown, legacyWeapons: string[] = []): void {
    const s = sanitizeArmory(raw, legacyWeapons);
    this.owned = s.owned;
    this.parts = s.parts;
    this.loadouts = s.loadouts;
    this.kills = s.kills;
    this.crosshair = s.crosshair;
    this.changed(null);
  }
}
