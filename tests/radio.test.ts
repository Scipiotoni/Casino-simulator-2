import { describe, expect, it } from 'vitest';
import {
  FORM, SECTION_BARS, SONG_BARS, STEPS, barInfo, chordPcs, composeBar, fitToChord, nextStation, parseChord, parseProgression,
  seeded, songPlan, stationFromSave, swingTime, voicing,
} from '../src/activities/radio/music';
import { STATIONS } from '../src/activities/radio/stations';

const PITCHED = new Set(['tone', 'fm', 'mallet', 'pluck']);

describe('chords', () => {
  it('reads chord symbols', () => {
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, tones: [0, 4, 7, 11] });
    expect(parseChord('F#m7')).toMatchObject({ root: 6, tones: [0, 3, 7, 10] });
    expect(parseChord('Ebdim7')).toMatchObject({ root: 3, tones: [0, 3, 6, 9] });
    expect(parseChord('G7sus4')).toMatchObject({ root: 7, tones: [0, 5, 7, 10] });
    expect(() => parseChord('H7')).toThrow();
    expect(() => parseChord('Cwhatever')).toThrow();
  });

  it('voices chords closely inside an octave', () => {
    const v = voicing(parseChord('Dm9'), 52, true);
    expect(v.length).toBe(4);
    expect(Math.max(...v) - Math.min(...v)).toBeLessThan(12);
    for (const m of v) expect(m).toBeGreaterThanOrEqual(52);
  });

  it('bends a tune note onto a chord from outside the key', () => {
    const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
    expect(fitToChord(72, parseChord('A7'), C_MAJOR)).toBe(73); // C over A7 → C#
    expect(fitToChord(69, parseChord('Fm6'), C_MAJOR)).toBe(68); // A over Fm6 → Ab
    expect(fitToChord(71, parseChord('Bb7'), C_MAJOR)).toBe(70); // B over Bb7 → Bb
    expect(fitToChord(74, parseChord('G7'), C_MAJOR)).toBe(74); // D is the chord's own
    expect(fitToChord(69, parseChord('Cmaj7'), C_MAJOR)).toBe(69); // in the key: left alone
  });
});

describe('stations', () => {
  it('has four or five distinct stations with everything a card needs', () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(4);
    expect(STATIONS.length).toBeLessThanOrEqual(5);
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
    expect(new Set(STATIONS.map((s) => s.name)).size).toBe(STATIONS.length);
    for (const s of STATIONS) {
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.genre.length).toBeGreaterThan(2);
      expect(s.freq).toMatch(/^FM \d+\.\d$/);
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.bpm).toBeGreaterThan(60);
      expect(s.bpm).toBeLessThan(140);
    }
  });

  it('writes every progression as eight known chords', () => {
    for (const s of STATIONS) {
      for (const p of [...s.progA, ...s.progB]) expect(parseProgression(p)).toHaveLength(SECTION_BARS);
    }
  });

  it('plays the same bar the same way every time', () => {
    for (const s of STATIONS) {
      for (const bar of [0, 9, 17, 40, 63, 64, 1000, 123457]) expect(composeBar(s, bar)).toEqual(composeBar(s, bar));
    }
  });

  it('writes playable notes: in the bar, on the kit, in tune and not too many', () => {
    for (const s of STATIONS) {
      for (let bar = 0; bar < SONG_BARS * 2; bar++) {
        const notes = composeBar(s, bar);
        expect(notes.length).toBeGreaterThan(0);
        expect(notes.length).toBeLessThan(90);
        const bad = notes.filter((n, i) => {
          const inst = s.kit[n.inst];
          if (!inst || n.at < 0 || n.at >= STEPS || !(n.len > 0) || !(n.vel > 0) || n.vel > 1) return true;
          if (PITCHED.has(inst.kind) && (n.midi < 24 || n.midi > 100)) return true;
          return i > 0 && n.at < notes[i - 1].at;
        });
        expect(bad, `${s.id} bar ${bar}`).toEqual([]);
      }
    }
  }, 60000);

  it('keeps tunes in the key, or on the chord they are played over', () => {
    for (const s of STATIONS) {
      for (let bar = 0; bar < SONG_BARS * 3; bar++) {
        const b = barInfo(s, bar);
        for (const n of b.melody) {
          const pc = n.midi % 12;
          expect(b.song.scale.includes(pc) || chordPcs(b.chord).includes(pc), `${s.id} bar ${bar}`).toBe(true);
          expect(n.midi).toBeGreaterThanOrEqual(s.melody.lo - 1);
          expect(n.midi).toBeLessThanOrEqual(s.melody.hi + 1);
        }
      }
    }
  }, 60000);

  it('brings the verse tune back each verse, and gives the chorus its own', () => {
    for (const s of STATIONS) {
      const verses = FORM.map((k, i) => (k === 'A' ? i : -1)).filter((i) => i >= 0);
      const chorus = FORM.indexOf('B');
      for (let n = 0; n < SECTION_BARS; n++) {
        const first = barInfo(s, verses[0] * SECTION_BARS + n).melody;
        for (const v of verses.slice(1)) expect(barInfo(s, v * SECTION_BARS + n).melody).toEqual(first);
      }
      const verseTune = Array.from({ length: SECTION_BARS }, (_, n) => barInfo(s, verses[0] * SECTION_BARS + n).melody);
      const chorusTune = Array.from({ length: SECTION_BARS }, (_, n) => barInfo(s, chorus * SECTION_BARS + n).melody);
      expect(chorusTune).not.toEqual(verseTune);
      expect(verseTune.flat().length).toBeGreaterThan(6);
    }
  });

  it('varies from song to song: keys, progressions and tunes', () => {
    for (const s of STATIONS) {
      const plans = Array.from({ length: 12 }, (_, i) => songPlan(s, i));
      expect(new Set(plans.map((p) => p.tr)).size).toBeGreaterThan(1);
      expect(new Set(plans.map((p) => p.progA.map((c) => c.name).join(' '))).size).toBeGreaterThan(1);
      const tunes = new Set(plans.map((p) => JSON.stringify(barInfo(s, p.index * SONG_BARS + SECTION_BARS).melody)));
      expect(tunes.size).toBeGreaterThan(6);
    }
  });

  it('ends each song on its home chord', () => {
    for (const s of STATIONS) {
      for (const song of [0, 3, 7]) {
        const last = barInfo(s, song * SONG_BARS + SONG_BARS - 1);
        expect(last.last).toBe(true);
        expect(last.chord).toEqual(last.song.progA[0]);
        expect(barInfo(s, song * SONG_BARS + SONG_BARS - 2).next).toEqual(last.chord);
      }
    }
  });
});

describe('timing', () => {
  it('swings the off-beats and leaves the beats alone', () => {
    for (const at of [0, 4, 8, 12]) expect(swingTime(at, 0.66, 0.5)).toBeCloseTo(at);
    expect(swingTime(2, 0.66, 0.5)).toBeCloseTo(2.64);
    expect(swingTime(2, 0.5, 0.5)).toBeCloseTo(2);
    let prev = -1;
    for (let at = 0; at < 16; at += 0.25) {
      const t = swingTime(at, 0.64, 0.58);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('seeds the same numbers from the same parts', () => {
    const a = seeded(1, 2, 3);
    const b = seeded(1, 2, 3);
    const c = seeded(1, 2, 4);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
  });
});

describe('the dial', () => {
  it('steps through every station, then off, then round again', () => {
    const seen: number[] = [];
    let i = 0;
    for (let k = 0; k < STATIONS.length + 2; k++) {
      seen.push(i);
      i = nextStation(i, STATIONS.length);
    }
    expect(seen).toEqual([...STATIONS.map((_, j) => j), -1, 0]);
    expect(nextStation(-1, 5)).toBe(0);
    expect(nextStation(99, 5)).toBe(-1);
    expect(nextStation(0, 0)).toBe(-1);
  });

  it('remembers the station in a save, and ignores a bad one', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(stationFromSave({ station: ids[2] }, ids)).toBe(2);
    expect(stationFromSave({ station: 'off' }, ids)).toBe(-1);
    for (const bad of [null, undefined, 3, 'neon', [], {}, { station: 4 }, { station: 'kazoo' }, { station: null }]) expect(stationFromSave(bad, ids)).toBeNull();
  });
});
