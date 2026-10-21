import type { Game } from '../../game/game';
import type { Activity } from '../activity';
import { audio } from '../../core/audio';
import { el, esc } from '../../ui/dom';
import { STEPS, nextStation, stationFromSave, stepTime, type StationDef } from './music';
import { STATIONS } from './stations';
import { LOOKAHEAD, TICK_MS, StationPlayer, livePosition, renderStation, tuningStatic, type Level } from './synth';
import './style.css';

/**
 * The car radio. In a car or a boat it plays one of five stations of music made on the spot
 * (see stations.ts), each one "live": it keeps playing while you're away, so you tune in mid-song.
 * N (or the round button on touch screens) steps through the stations and Off, with a burst of
 * static and a station card. The radio plays on the music bus, under the music and master
 * volume, and holds the casino's lounge music while it plays. It fades in when you get in and
 * out when you get out, and stays silent on the title screen and in cutscenes.
 */

/** Getting in or out: the radio fades in or out over this long (s). */
const FADE = 0.5;
/** Changing station: the old one fades this fast, the new one comes in over this long (s). */
const SWITCH_OUT = 0.15;
const SWITCH_IN = 0.35;
/** How long the station card stays up (ms). */
const CARD_MS = 3000;

const RADIO_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 9 17 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '<rect x="3" y="9" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<circle cx="8.5" cy="14.5" r="2.6" fill="currentColor"/><path d="M14 12.5h4M14 16.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

export class Radio implements Activity {
  readonly id = 'radio';
  /** The dial: a station (index into STATIONS), or -1 for off. */
  station = 0;
  /** Notes scheduled since the game started (for checking it plays, and stops). */
  scheduled = 0;
  private ctx: AudioContext | null = null;
  /** The radio's own fader, into the music bus. */
  private master: GainNode | null = null;
  private player: StationPlayer | null = null;
  /** Playing (or fading in). */
  private live = false;
  private timer: number | null = null;
  private stopTimer: number | null = null;
  /** Holding the lounge music, and whether it was on. */
  private holding = false;
  private musicWas = false;
  /** The dial was just turned: play a burst of static. */
  private tuning = false;
  private wasIn = false;
  private cardUntil = 0;
  private card: HTMLDivElement;
  private cardFreq: HTMLSpanElement;
  private cardName: HTMLDivElement;
  private cardGenre: HTMLDivElement;
  private cardDots: HTMLDivElement;
  private cardHint: HTMLDivElement;
  private btn: HTMLButtonElement;

  constructor(readonly game: Game) {
    this.card = el(
      'div',
      'radio-card',
      '<div class="rdc-top"><span class="rdc-freq"></span><span class="rdc-eq"><i></i><i></i><i></i><i></i><i></i></span></div>' +
        '<div class="rdc-name"></div><div class="rdc-genre"></div><div class="rdc-dots"></div><div class="rdc-hint"></div>',
    );
    this.cardFreq = this.card.querySelector('.rdc-freq')!;
    this.cardName = this.card.querySelector('.rdc-name')!;
    this.cardGenre = this.card.querySelector('.rdc-genre')!;
    this.cardDots = this.card.querySelector('.rdc-dots')!;
    this.cardHint = this.card.querySelector('.rdc-hint')!;
    this.btn = el('button', 'radio-btn', RADIO_ICON);
    this.btn.type = 'button';
    this.btn.setAttribute('aria-label', 'Change radio station');
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.inCar()) this.cycle();
    });
    game.uiRoot.append(this.card, this.btn);
    document.addEventListener('visibilitychange', () => this.refresh());
  }

  update(_dt: number): void {
    const g = this.game;
    const inCar = this.inCar();
    if (inCar && g.mode === 'play' && !g.hud.dialogOpen && g.input.pressed('KeyN')) this.cycle();
    if (inCar && !this.wasIn && this.station >= 0) this.showCard();
    this.wasIn = inCar;
    this.refresh();
    this.pump();
    // The card fades after a while (or as soon as you're out of the car); the button is for touch screens.
    if (this.cardUntil && (performance.now() > this.cardUntil || !inCar)) {
      this.cardUntil = 0;
      this.card.classList.remove('on');
    }
    this.btn.classList.toggle('on', inCar && g.mode === 'play' && g.input.touchMode);
  }

  /** Turn the dial: the next station, or off after the last one. */
  cycle(): void {
    this.station = nextStation(this.station, STATIONS.length);
    this.tuning = true;
    this.showCard();
    this.refresh();
    this.tuning = false;
  }

  save(): unknown {
    return { station: this.station >= 0 ? STATIONS[this.station].id : 'off' };
  }

  load(data: unknown): void {
    const s = stationFromSave(data, STATIONS.map((st) => st.id));
    if (s !== null) this.station = s;
  }

  /** What the radio is doing (dev checks). */
  status(): { station: string; live: boolean; context: string; scheduled: number; fader: number; lounge: boolean } {
    return {
      station: this.station >= 0 ? STATIONS[this.station].id : 'off',
      live: this.live,
      context: this.ctx?.state ?? audio.ctx?.state ?? 'none',
      scheduled: this.scheduled,
      fader: this.master ? this.master.gain.value : 0,
      lounge: audio.musicPlaying,
    };
  }

  /** Dev check: render every station offline for `seconds` (from bar `bar`) and measure how loud it is. */
  async measure(seconds = 8, bar?: number): Promise<Level[]> {
    const out: Level[] = [];
    for (const st of STATIONS) out.push(await renderStation(st, seconds, bar));
    return out;
  }

  // ---------------------------------------------------------------- playing

  /** In a car or a boat, in the game proper (not a cutscene or the title screen). */
  private inCar(): boolean {
    const g = this.game;
    return !!g.vehicles.driving && (g.mode === 'play' || g.mode === 'menu') && !g.director.playing;
  }

  /** Start or stop to match the dial, the car and the music volume. */
  private refresh(): void {
    const want = this.inCar() && !document.hidden && this.station >= 0 && this.game.settings.music > 0.01;
    if (want) this.start();
    else if (this.live) this.stop();
  }

  private start(): void {
    const ctx = audio.ctx;
    const bus = audio.musicOut;
    if (!ctx || !bus || ctx.state === 'closed') return;
    if (ctx !== this.ctx) {
      this.teardown();
      this.ctx = ctx;
    }
    const st = STATIONS[this.station];
    if (this.live && this.player?.st === st) {
      this.holdMusic();
      return;
    }
    if (this.stopTimer !== null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(bus);
    }
    this.holdMusic();
    if (!this.live) {
      this.live = true;
      ramp(this.master.gain, 1, FADE, ctx.currentTime);
      if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
    if (this.player?.st !== st) this.tune(st);
  }

  /** Switch the player over to `st`, mid-song as if it had been playing all along. */
  private tune(st: StationDef): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const old = this.player;
    if (old) {
      old.fade(0, SWITCH_OUT, now);
      window.setTimeout(() => old.dispose(), (SWITCH_OUT + 0.25) * 1000);
    }
    if (this.tuning && ctx.state === 'running') tuningStatic(ctx, this.master!, now);
    const p = new StationPlayer(ctx, st, this.master!);
    p.out.gain.value = 0;
    p.fade(1, SWITCH_IN, now + (this.tuning ? 0.12 : 0));
    // Join at the next sixteenth of the station's "live" position.
    const step = stepTime(st);
    const pos = livePosition(st, Date.now() / 1000);
    let from = Math.ceil(pos.step);
    let bar = pos.bar;
    const t0 = now + 0.05 + (from - pos.step) * step;
    if (from >= STEPS) {
      from = 0;
      bar++;
    }
    p.start(t0, bar, from);
    this.player = p;
    this.pump();
  }

  private stop(): void {
    this.live = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const ctx = this.ctx;
    if (ctx && this.master) {
      if (this.tuning && ctx.state === 'running') tuningStatic(ctx, this.master, ctx.currentTime, 0.18);
      ramp(this.master.gain, 0, FADE, ctx.currentTime);
    }
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = null;
      this.teardown();
    }, FADE * 1000 + 80);
  }

  /** Let go of everything and give the lounge music back. */
  private teardown(): void {
    this.live = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.player?.dispose();
    this.player = null;
    this.master?.disconnect();
    this.master = null;
    this.releaseMusic();
  }

  /** The scheduler's heartbeat (also run every frame). */
  private tick(): void {
    if (!this.inCar() || document.hidden) {
      this.refresh();
      return;
    }
    this.pump();
  }

  private pump(): void {
    const ctx = this.ctx;
    const p = this.player;
    if (!ctx || !p || !this.live || ctx.state !== 'running') return;
    const before = p.notes;
    p.pump(ctx.currentTime + LOOKAHEAD, ctx.currentTime);
    this.scheduled += p.notes - before;
  }

  /** Hold the lounge music while the radio plays (and again if the settings switched it back on). */
  private holdMusic(): void {
    if (!this.holding) {
      this.holding = true;
      this.musicWas = audio.musicPlaying;
    }
    if (audio.musicPlaying) {
      this.musicWas = true;
      audio.setMusic(false);
    }
  }

  private releaseMusic(): void {
    if (!this.holding) return;
    this.holding = false;
    if (this.musicWas && this.game.settings.music > 0.01) audio.setMusic(true);
  }

  // ---------------------------------------------------------------- the card

  private showCard(): void {
    const st = this.station >= 0 ? STATIONS[this.station] : null;
    const c = this.card;
    c.style.setProperty('--accent', st?.color ?? '#8a93a8');
    c.style.setProperty('--beat', `${st ? (60 / st.bpm).toFixed(3) : 1}s`);
    this.btn.style.setProperty('--accent', st?.color ?? '#8a93a8');
    c.classList.toggle('off', !st);
    this.btn.classList.toggle('off', !st);
    this.cardFreq.textContent = st ? st.freq : 'RADIO';
    this.cardName.textContent = st ? st.name : 'Radio off';
    this.cardGenre.textContent = st ? st.genre : 'Just the engine';
    this.cardDots.innerHTML =
      STATIONS.map((s, i) => `<i class="${i === this.station ? 'on' : ''}" title="${esc(s.name)}"></i>`).join('') + `<i class="x ${st ? '' : 'on'}"></i>`;
    this.cardHint.innerHTML = this.game.input.touchMode ? 'Tap the radio button for the next station' : '<b>N</b> next station';
    // Restart the pop-in.
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
    this.cardUntil = performance.now() + CARD_MS;
  }
}

/** Ramp an audio param from wherever it is now. */
function ramp(p: AudioParam, to: number, secs: number, at: number): void {
  p.cancelScheduledValues(at);
  p.setValueAtTime(p.value, at);
  p.linearRampToValueAtTime(to, at + secs);
}
