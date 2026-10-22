import { CLASS_NAMES, WEAPONS, type StatKey, type Thread, type WeaponClass, type WeaponDef, type WeaponStats } from './catalog';
import { ATTACHMENTS, type Attachment } from './attachments';
import { SLOT_NAMES, type Loadout, type Slot } from './loadout';

/**
 * What the gunsmith says about parts that don't fit, and how it shows stats. Pure, so the
 * reasons are unit-tested (tests/gunsmith.test.ts).
 */

const THREAD_NAMES: Record<Thread, string> = { pistol: 'a pistol thread', smg: 'an SMG thread', '556': '5.56', '762': '7.62', '50': '.50', shotgun: 'a shotgun thread', none: 'none' };

/** Short plural class names for "X only". */
const SHORT: Record<WeaponClass, string> = {
  pistol: 'Pistols', smg: 'SMGs', rifle: 'Rifles', marksman: 'marksman rifles', sniper: 'Snipers', shotgun: 'shotguns', lmg: 'machine guns', launcher: 'launchers', special: 'special weapons',
};

function classList(classes: WeaponClass[]): string {
  const names = classes.map((c, i) => (i === 0 ? SHORT[c][0].toUpperCase() + SHORT[c].slice(1) : SHORT[c].toLowerCase()));
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function barrelSuppressor(w: WeaponDef, l: Loadout): string | null {
  const b = w.barrels.find((v) => v.id === l.barrel);
  if (b?.suppressor) {
    const short = /\(SD\)/.test(b.name) ? 'SD barrel' : b.name.toLowerCase();
    return `The ${short} has a suppressor built in`;
  }
  return null;
}

/** Why a generic attachment can't go on this weapon as it's built (null: it fits). */
export function whyNot(w: WeaponDef, a: Attachment, l: Loadout): string | null {
  switch (a.slot) {
    case 'optic':
      if (w.optic === 'none') return w.builtInZoom ? 'It has its own fixed sight: no optic mount' : 'No optic mount: iron sights only';
      if (a.classes && !a.classes.includes(w.cls)) return `${classList(a.classes)} only`;
      if (!a.mounts?.includes(w.optic)) return w.optic === 'pistol' ? 'Needs a rail' : 'Needs a pistol slide cut';
      return null;
    case 'muzzle':
      if (w.integralSuppressor) return 'It has a suppressor built in';
      if (w.thread === 'none') return 'No threaded muzzle';
      if (a.classes && !a.classes.includes(w.cls)) return `${classList(a.classes)} only`;
      if (!a.threads?.includes(w.thread)) return `Wrong thread: needs ${a.threads!.map((t) => THREAD_NAMES[t]).join(' or ')}`;
      return barrelSuppressor(w, l);
    case 'underbarrel':
      if (!w.underRail) return 'Needs a rail under the barrel';
      if (a.classes && !a.classes.includes(w.cls)) return `${classList(a.classes)} only`;
      return null;
    case 'laser':
      if (!w.sideRail) return 'Needs a side rail';
      if (a.classes && !a.classes.includes(w.cls)) return `${classList(a.classes)} only`;
      return null;
  }
}

/** Attachments for a generic slot that don't fit, with the reason. */
export function misfits(w: WeaponDef, slot: Slot, l: Loadout): { a: Attachment; reason: string }[] {
  if (slot === 'barrel' || slot === 'magazine' || slot === 'stock') return [];
  return ATTACHMENTS.filter((a) => a.slot === slot)
    .map((a) => ({ a, reason: whyNot(w, a, l) }))
    .filter((x): x is { a: Attachment; reason: string } => !!x.reason);
}

/** Why a slot is closed on this weapon (null: it has options). */
export function slotClosed(w: WeaponDef, slot: Slot): string | null {
  switch (slot) {
    case 'optic':
      return w.optic === 'none' ? (w.builtInZoom ? 'Fixed sight' : 'No optic mount') : null;
    case 'muzzle':
      return w.integralSuppressor ? 'Suppressor built in' : w.thread === 'none' ? 'No muzzle thread' : null;
    case 'underbarrel':
      return w.underRail ? null : 'No under rail';
    case 'laser':
      return w.sideRail ? null : 'No side rail';
    case 'barrel':
      return w.barrels.length > 1 ? null : 'One barrel only';
    case 'magazine':
      return w.mags.length > 1 ? null : 'One magazine only';
    case 'stock':
      return w.stocks.length > 1 ? null : w.stocks.length ? 'One stock only' : 'No stock';
  }
}

export { SLOT_NAMES };

// ------------------------------------------------------------------ stats for people

export const STAT_LABELS: Record<StatKey, string> = {
  damage: 'Damage', pellets: 'Pellets', rate: 'Fire rate', mag: 'Magazine', reload: 'Reload time', range: 'Range', hipSpread: 'Hip-fire spread',
  adsSpread: 'Aimed spread', recoilV: 'Vertical recoil', recoilH: 'Horizontal recoil', adsTime: 'Aim-down-sights time', move: 'Movement speed',
  splash: 'Blast radius', velocity: 'Projectile speed', spinUp: 'Spin-up time',
};

/** Shown in this order in the full stats panel. */
export const STAT_ORDER: StatKey[] = ['damage', 'pellets', 'rate', 'mag', 'reload', 'range', 'hipSpread', 'adsSpread', 'recoilV', 'recoilH', 'adsTime', 'move', 'splash', 'velocity', 'spinUp'];

/** A stat in its unit (fire rate in rounds per minute, times in seconds). */
export function fmtStat(k: StatKey, v: number): string {
  switch (k) {
    case 'rate': return `${Math.round(v * 60)} rpm`;
    case 'reload': case 'adsTime': case 'spinUp': return `${v.toFixed(2)} s`;
    case 'range': case 'splash': return `${Math.round(v)} m`;
    case 'velocity': return `${Math.round(v)} m/s`;
    case 'hipSpread': case 'adsSpread': return `${(v * 57.2958).toFixed(2)}°`;
    case 'recoilV': case 'recoilH': return `${(v * 57.2958).toFixed(2)}°`;
    case 'move': return `${Math.round(v * 100)}%`;
    case 'damage': return v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
    default: return String(Math.round(v));
  }
}

/** The change between two values: "+10%", "−0.12 s", "+10" for magazines. */
export function fmtDelta(k: StatKey, from: number, to: number): string {
  const d = to - from;
  const sign = d > 0 ? '+' : '−';
  if (k === 'mag' || k === 'pellets') return `${sign}${Math.abs(Math.round(d))}`;
  if (from === 0) return `${sign}${fmtStat(k, Math.abs(d))}`;
  return `${sign}${Math.abs(Math.round((d / from) * 100))}%`;
}

const LOWER_BETTER: StatKey[] = ['reload', 'hipSpread', 'adsSpread', 'recoilV', 'recoilH', 'adsTime', 'spinUp'];

/** Each stat's spread over the whole catalog (zeros left out), for the bars. */
const RANGES = (() => {
  const out = {} as Record<StatKey, { lo: number; hi: number }>;
  for (const k of STAT_ORDER) {
    const vs = WEAPONS.map((w) => (k === 'damage' ? w.stats.damage * w.stats.pellets : w.stats[k])).filter((v) => v > 0);
    out[k] = k === 'move' ? { lo: Math.min(...vs) * 0.96, hi: Math.max(...vs) * 1.03 } : { lo: Math.min(...vs) * 0.7, hi: Math.max(...vs) * 1.3 };
  }
  return out;
})();

/** 0..1 for a bar, on a log scale over the catalog; higher is always better. */
export function statScore(k: StatKey, v: number): number {
  const r = RANGES[k];
  if (!r || !(r.hi > 0)) return 0;
  if (v <= 0) return LOWER_BETTER.includes(k) ? 1 : 0;
  const t = (Math.log(Math.max(r.lo, Math.min(r.hi, v))) - Math.log(r.lo)) / (Math.log(r.hi) - Math.log(r.lo));
  return LOWER_BETTER.includes(k) ? 1 - t : t;
}

/** The five headline bars on a shop card: damage, fire rate, range, accuracy, mobility. */
export function keyBars(s: WeaponStats): { label: string; v: number }[] {
  return [
    { label: 'Damage', v: statScore('damage', s.damage * s.pellets) },
    { label: 'Fire rate', v: statScore('rate', s.rate) },
    { label: 'Range', v: statScore('range', s.range) },
    { label: 'Accuracy', v: (statScore('hipSpread', s.hipSpread) + statScore('adsSpread', s.adsSpread) + statScore('recoilV', s.recoilV)) / 3 },
    { label: 'Mobility', v: (statScore('move', s.move) + statScore('adsTime', s.adsTime)) / 2 },
  ];
}

/** The class names, re-exported for the UI. */
export { CLASS_NAMES };
