import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import type { MapMarker } from '../../ui/map';
import { BRIDGE } from '../../world/bridge';
import './style.css';
import { loadJSON } from '../../core/storage';
import { btn } from '../../ui/panel';
import { el, esc } from '../../ui/dom';
import { audio } from '../../core/audio';

/**
 * Interstate 15 is the road between the two games. Its far end is the mainland, where the
 * first game (Jackpot Tycoon) is played. While the bridge is closed for repairs the barrier
 * offers a trip over there anyway; once the story reopens it, driving off the mainland end
 * of the bridge does. The first game links back from the end of its own Interstate 15.
 */

/** The first game. `?mainland=<url>` overrides it (for local testing). */
export const MAINLAND_URL = pageUrl('mainland') ?? 'https://scipiotoni.github.io/Casino-simulator/';

/** Where the first game keeps its save (same site, so the same browser storage). */
const MAINLAND_SAVE = 'jackpot-tycoon:save:v1';

function pageUrl(param: string): string | null {
  try {
    const v = new URLSearchParams(location.search).get(param);
    return v && /^https?:\/\//i.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Did the player arrive across the bridge from the first game (?from=mainland)? Clears the flag from the URL. */
export function arrivedFromMainland(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('from') !== 'mainland') return false;
    q.delete('from');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    return true;
  } catch {
    return false;
  }
}

/** The player's name in the first game, if they've played it in this browser. */
export function mainlandName(): string | null {
  const s = loadJSON<{ player?: { name?: unknown } }>(MAINLAND_SAVE);
  const n = s?.player?.name;
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 24) : null;
}

/** Save, fade out and drive on to the first game. */
export function goToMainland(g: Game): void {
  g.save();
  audio.play('whoosh');
  const url = new URL(MAINLAND_URL, location.href);
  url.searchParams.set('from', 'island');
  // A plain link too, for hosts that don't let a page navigate itself.
  const fade = el('div', 'crossing', `<div class="t1">INTERSTATE 15</div><div class="t2">To the mainland · Casino Simulator: Jackpot Tycoon</div><a class="go" href="${esc(url.toString())}" target="_blank" rel="noopener">Continue to the mainland ▸</a>`);
  g.uiRoot.appendChild(fade);
  requestAnimationFrame(() => fade.classList.add('on'));
  setTimeout(() => {
    try {
      location.assign(url.toString());
    } catch {
      // Blocked: the link stays on screen.
    }
  }, 1400);
}

export class Crossover implements Activity {
  readonly id = 'crossover';
  /** Inside a trigger zone (offer once per visit). */
  private inZone = false;
  private barrierX = BRIDGE.x1 - 260;

  constructor(readonly game: Game) {}

  /** The zone in front of the barrier (closed), or the mainland end of the bridge (open). */
  private zone(x: number, z: number): boolean {
    if (Math.abs(z - BRIDGE.z) > BRIDGE.width / 2 + 2) return false;
    return this.game.story.finished ? x > BRIDGE.x1 + 20 && x < BRIDGE.mainland + 400 : x > this.barrierX - 26 && x < this.barrierX + 2;
  }

  update(_dt: number): void {
    const g = this.game;
    if (g.mode !== 'play' || g.director.playing) return;
    const v = g.vehicles.driving;
    const p = v ? v.pos : g.player.pos;
    const inside = this.zone(p.x, p.z) && (v ? true : g.player.mode === 'walk');
    if (inside && !this.inZone) this.offer();
    this.inZone = inside;
  }

  private offer(): void {
    const g = this.game;
    const open = g.story.finished;
    const p = g.ui.panel({ title: 'Interstate 15', subtitle: open ? 'The mainland' : 'Closed for repairs', accent: '#1e6bff' });
    const back = mainlandName();
    p.body.appendChild(el('div', 'ptext', esc(open
      ? 'The bridge is open again. Over on the mainland is the desert strip where it all started: Jackpot Tycoon, the first Casino Simulator.'
      : 'The bridge is closed to traffic, but the road crew will wave you through to the mainland: the desert strip of Jackpot Tycoon, the first Casino Simulator.')));
    p.body.appendChild(el('div', 'ptext dim', esc(`${back ? `Your tycoon ${back} is waiting over there. ` : ''}Your island game is saved; drive back across Interstate 15 any time.`)));
    if (g.vehicles.driving) g.vehicles.driving.speed = 0;
    p.footer.append(
      btn('Stay on the island', '', () => p.close()),
      btn('Cross to the mainland ▸', 'primary', () => {
        p.close();
        goToMainland(g);
      }),
    );
  }

  markers(full: boolean): MapMarker[] {
    if (!full) return [];
    const x = this.game.story.finished ? BRIDGE.x1 : this.barrierX;
    return [{ x, z: BRIDGE.z, icon: '🌉', color: '#1e6bff', label: 'Interstate 15 · Mainland', big: true }];
  }
}

