/**
 * Testy řazení: sloupcové řazení s chybějícími hodnotami, chytré režimy
 * (harmonické, energetické rampy, kvalita, plynulý řetězec) a kvalita pořadí.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySmartSort,
  energyRamp,
  harmonicOrder,
  orderQuality,
  qualityOrder,
  smoothChain,
  sortModeLabel,
  sortTracks,
} from '../src/lib/sorting.js';
import { buildFeatures } from '../src/lib/features.js';
import { DEFAULT_WEIGHTS } from '../src/lib/score.js';

function makeTracks() {
  const list = [
    { id: 1, name: 'Alpha', artist: 'Beta Band', genre: 'Techno', bpm: 138, key: '5A', rating: 102, year: 2020, totalTime: 300, comments: 'energy 8', location: 'file://localhost/C:/a/1.mp3' },
    { id: 2, name: 'Beta', artist: 'Alpha Band', genre: 'Deep House', bpm: 122, key: '8A', rating: 204, year: 2019, totalTime: 240, comments: 'energy 3', location: 'file://localhost/C:/a/2.mp3' },
    { id: 3, name: 'Gamma', artist: 'Gama', genre: 'Techno', bpm: null, key: '', rating: 0, year: null, totalTime: 0, comments: '', location: 'file://localhost/C:/a/3.mp3' },
    { id: 4, name: 'Delta', artist: 'Delta', genre: 'Techno', bpm: 140, key: '6A', rating: 51, year: 2022, totalTime: 320, comments: 'energy 9', location: 'file://localhost/C:/a/4.mp3' },
    { id: 5, name: 'Epsilon', artist: 'Epsilon', genre: 'Liquid', bpm: 174, key: '2A', rating: 153, year: 2021, totalTime: 280, comments: 'energy 5', location: 'file://localhost/C:/a/5.mp3' },
  ];
  buildFeatures(list);
  return list;
}

test('sortTracks řadí texty po česky a čísla číselně', () => {
  const tracks = makeTracks();
  const byName = sortTracks(tracks, { column: 'name', direction: 'asc' });
  assert.deepEqual(byName.map((t) => t.name), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);

  const byBpmDesc = sortTracks(tracks, { column: 'bpm', direction: 'desc' });
  const bpms = byBpmDesc.map((t) => t.bpm);
  assert.equal(bpms[0], 174);
  assert.equal(bpms[bpms.length - 1], null, 'track bez BPM musí být nakonec i u sestupného řazení');
});

test('sloupec key řadí podle Camelot čísla, ne textu', () => {
  const tracks = makeTracks();
  const sorted = sortTracks(tracks, { column: 'key', direction: 'asc' });
  const keys = sorted.map((t) => (t.keyParsed && t.keyParsed.camelot) || null);
  assert.deepEqual(keys, ['2A', '5A', '6A', '8A', null], '2A < 5A < 6A < 8A, bez klíče nakonec');
});

test('neznámý sloupec nespadne, jen se použije výchozí interpret', () => {
  const tracks = makeTracks();
  const sorted = sortTracks(tracks, { column: 'neco-jineho', direction: 'asc' });
  assert.equal(sorted.length, tracks.length);
  assert.equal(sorted[0].artist.toLowerCase() <= sorted[1].artist.toLowerCase(), true);
  assert.equal(sortModeLabel('neco-jineho'), sortModeLabel('artist'));
  assert.ok(sortModeLabel('harmonic').length > 0);
});

test('harmonické pořadí drží Camelot sousedy u sebe', () => {
  const tracks = makeTracks();
  const ordered = harmonicOrder(tracks);
  const withKey = ordered.filter((t) => t.keyParsed && t.keyParsed.number);
  assert.equal(withKey.length, 4, 'čtyři tracky mají klíč');
  // 2A → 5A → 6A → 8A: po wheelu to nesmí skákat o víc než 3 pozice
  for (let i = 1; i < withKey.length; i++) {
    const a = withKey[i - 1].keyParsed.number;
    const b = withKey[i].keyParsed.number;
    const diff = Math.abs(a - b);
    assert.ok(diff <= 3, `skok ${a} → ${b} je větší než 3`);
  }
  const withoutKey = ordered.filter((t) => !(t.keyParsed && t.keyParsed.number));
  assert.equal(withoutKey.length, 1, 'track bez klíče jde na konec');
  assert.equal(ordered[ordered.length - 1].id, 3);
});

test('energetická rampa řadí nahoru i dolů', () => {
  const tracks = makeTracks();
  const up = energyRamp(tracks, 'up');
  const energies = up.map((t) => t.features.energy);
  for (let i = 1; i < energies.length; i++) assert.ok(energies[i] >= energies[i - 1], 'energie musí růst');
  const down = energyRamp(tracks, 'down');
  const downEnergies = down.map((t) => t.features.energy);
  for (let i = 1; i < downEnergies.length; i++) assert.ok(downEnergies[i] <= downEnergies[i - 1], 'energie musí klesat');
  assert.equal(up[0].id, down[down.length - 1].id, 'oba směry = zrcadlové pořadí');
});

test('kvalitní pořadí dá nejlepší hodnocení první', () => {
  const tracks = makeTracks();
  const ordered = qualityOrder(tracks);
  assert.equal(ordered[0].rating, 204);
  assert.equal(ordered[1].rating, 153);
  const ratings = ordered.map((t) => t.rating);
  for (let i = 1; i < ratings.length; i++) assert.ok(ratings[i] <= ratings[i - 1]);
});

test('plynulý řetězec zachová všechny tracky a začíná klidně', () => {
  const tracks = makeTracks();
  const ordered = smoothChain(tracks, DEFAULT_WEIGHTS, {});
  assert.equal(ordered.length, tracks.length, 'žádný track se nesmí ztratit');
  assert.equal(new Set(ordered.map((t) => t.id)).size, tracks.length, 'žádné duplikace');
  assert.equal(ordered[0].id, 2, 'nejklidnější track (energy 3) je start');
  const quality = orderQuality(ordered, DEFAULT_WEIGHTS, {});
  assert.ok(quality.average > 0 && quality.average <= 1);
  assert.equal(quality.transitions, tracks.length - 1);
});

test('orderQuality hlásí nejhorší přechody (hardFail i nízké skóre)', () => {
  const tracks = makeTracks();
  const quality = orderQuality(tracks, DEFAULT_WEIGHTS, {});
  assert.ok(quality.transitions === tracks.length - 1);
  assert.ok(Array.isArray(quality.problems));
  for (const problem of quality.problems) {
    assert.ok(problem.index >= 1 && problem.index < tracks.length);
    assert.equal(typeof problem.reason, 'string');
    assert.ok(problem.score < 0.6, 'problém musí mít nízké skóre');
  }
  // shodné tracky vedle sebe = žádný problém
  const twin = [tracks[0], { ...tracks[0], id: 99 }, tracks[0]];
  const clean = orderQuality(twin, DEFAULT_WEIGHTS, {});
  assert.equal(clean.problems.length, 0);
});

test('applySmartSort pokryje všechny režimy a nezmění vstup', () => {
  const tracks = makeTracks();
  const copy = tracks.slice();
  for (const mode of ['harmonic', 'energyUp', 'energyDown', 'quality', 'smooth', 'shuffle', 'artist', 'bpm']) {
    const sorted = applySmartSort(tracks, mode, { weights: DEFAULT_WEIGHTS, options: {} });
    assert.equal(sorted.length, tracks.length, `režim ${mode} ztratil tracky`);
    assert.equal(new Set(sorted.map((t) => t.id)).size, tracks.length, `režim ${mode} udělal duplicity`);
  }
  assert.deepEqual(tracks, copy, 'vstupní pole se nesmí změnit');
  // neznámý režim = výchozí sloupcové řazení
  assert.equal(applySmartSort(tracks, 'not-a-mode', {}).length, tracks.length);
  // shuffle je deterministické se stejným seed
  const a = applySmartSort(tracks, 'shuffle', { randomSeed: 11 });
  const b = applySmartSort(tracks, 'shuffle', { randomSeed: 11 });
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
});
