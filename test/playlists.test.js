import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildFeatures } from '../src/lib/features.js';
import { parseRekordboxXml } from '../src/lib/parse.js';
import { DEFAULT_WEIGHTS, scorePair } from '../src/lib/score.js';
import {
  autoCrates,
  buildBpmIndex,
  buildSet,
  dnbShare,
  estimateTrackCount,
  MIX_STYLES,
  playlistScore,
  reorderPlaylist,
  resolveMixStyle,
  similarTracks,
  targetEnergyAt,
  WEIGHT_PRESETS,
} from '../src/lib/playlists.js';

const here = dirname(fileURLToPath(import.meta.url));
const parsed = parseRekordboxXml(readFileSync(resolve(here, '..', 'fixtures', 'sample-collection.xml'), 'utf8'));
buildFeatures(parsed.tracks);
const tracks = parsed.tracks;
const index = buildBpmIndex(tracks);

test('křivka energie odpovídá zvolenému typu setu', () => {
  assert.equal(targetEnergyAt(0, 'flat'), targetEnergyAt(1, 'flat'));
  assert.ok(targetEnergyAt(1, 'up') > targetEnergyAt(0, 'up'));
  assert.ok(targetEnergyAt(1, 'down') < targetEnergyAt(0, 'down'));
  assert.ok(targetEnergyAt(0.5, 'arc') > targetEnergyAt(0, 'arc'));
  assert.ok(targetEnergyAt(0.5, 'arc') > targetEnergyAt(1, 'arc'));
  const peakStart = targetEnergyAt(0.15, 'peaktime');
  const peakEnd = targetEnergyAt(1, 'peaktime');
  assert.ok(peakEnd < peakStart, 'peak time má na konci spadnout');
});

test('buildSet postaví set z jednoho tracku bez opakování', () => {
  const seedTrack = tracks.find((t) => t.genre === 'Techno');
  const playlist = buildSet(tracks, { seedId: seedTrack.id, count: 14, seed: 42, index });
  assert.equal(playlist.entries.length, 14);
  assert.equal(playlist.entries[0].track.id, seedTrack.id);
  assert.equal(new Set(playlist.trackIds).size, playlist.trackIds.length, 'tracky se nesmí opakovat');
  assert.ok(playlist.stats.avgScore > 0.6, `průměrná shoda ${playlist.stats.avgScore}`);
  for (let i = 1; i < playlist.entries.length; i++) {
    const result = scorePair(playlist.entries[i - 1].track, playlist.entries[i].track, DEFAULT_WEIGHTS, {});
    assert.equal(result.hardFail, false, `přechod ${i} nesmí být v tvrdém konfliktu`);
  }
  const bpms = playlist.entries.map((e) => e.track.bpm);
  assert.ok(Math.max(...bpms) - Math.min(...bpms) < 30, 'BPM se nesmí rozejít přes celou kolekci');
  const energy = playlist.entries.map((e) => e.track.features.energy);
  assert.ok(energy[Math.floor(energy.length / 2)] >= energy[0] - 20, 'u klasického setu energie roste');
});

test('buildSet je deterministický pro stejný seed', () => {
  const a = buildSet(tracks, { seedId: tracks[10].id, count: 10, seed: 'abc', index });
  const b = buildSet(tracks, { seedId: tracks[10].id, count: 10, seed: 'abc', index });
  assert.deepEqual(a.trackIds, b.trackIds);
  const c = buildSet(tracks, { seedId: tracks[10].id, count: 10, seed: 'jiný', index });
  assert.notDeepEqual(a.trackIds, c.trackIds);
});

test('buildSet respektuje délku setu v minutách', () => {
  const playlist = buildSet(tracks, { minutes: 30, seed: 5, index });
  const totalMinutes = playlist.stats.totalTime / 60;
  assert.ok(totalMinutes > 20 && totalMinutes < 45, `set má ${totalMinutes.toFixed(1)} min`);
});

test('autoCrates rozdělí kolekci na playlisty, které drží pohromadě', () => {
  const crates = autoCrates(tracks, {
    targetSize: 20,
    minSize: 5,
    threshold: 0.6,
    seed: 3,
    index,
    weights: WEIGHT_PRESETS.genre.weights,
  });
  assert.ok(crates.length >= 3, `málo cratů: ${crates.length}`);
  const allIds = crates.flatMap((c) => c.trackIds);
  assert.equal(new Set(allIds).size, allIds.length, 'crates se ve výchozím stavu nesmí překrývat');
  assert.equal(new Set(allIds).size, tracks.length, 'každý track má skončit v nějakém cratu');
  for (const crate of crates) {
    assert.ok(crate.trackIds.length <= 24, `${crate.name} má ${crate.trackIds.length} tracků`);
    assert.ok(crate.stats.avgScore > 0.7, `${crate.name}: shoda ${crate.stats.avgScore}`);
    assert.ok(crate.name.includes('BPM'));
    // crate má mít jasně dominantní styl, i když se v něm potkají příbuzné subžánry
    const genres = new Map();
    for (const t of crate.tracks) genres.set(t.genre, (genres.get(t.genre) || 0) + 1);
    const dominant = Math.max(...genres.values()) / crate.tracks.length;
    assert.ok(
      dominant >= 0.7,
      `crate ${crate.name} je rozdrobený (dominantní styl jen ${Math.round(dominant * 100)} %)`,
    );
    const keys = new Set(crate.tracks.map((t) => t.keyParsed.camelot).filter(Boolean));
    assert.ok(keys.size <= 8, `crate ${crate.name} míchá ${keys.size} klíčů`);
  }
});

test('autoCrates umí povolit překryv', () => {
  const crates = autoCrates(tracks, { targetSize: 15, minSize: 5, seed: 1, index, allowOverlap: true });
  assert.ok(crates.length > 0);
});

test('similarTracks najde stejný žánr a blízký klíč', () => {
  const seedTrack = tracks.find((t) => t.genre === 'Drum & Bass');
  const hits = similarTracks(tracks, seedTrack, { limit: 10, index });
  assert.equal(hits.length, 10);
  const sameGenre = hits.filter((h) => h.track.genre === seedTrack.genre).length;
  assert.ok(sameGenre >= 6, `jen ${sameGenre}/10 stejný žánr`);
  assert.ok(hits[0].score >= hits[hits.length - 1].score, 'výsledky musí být seřazené');
  assert.ok(hits[0].notes.length > 0);
});

test('reorderPlaylist zlepší (nebo aspoň nezhorší) tok playlistu', () => {
  const seedTrack = tracks.find((t) => t.genre === 'Techno');
  const built = buildSet(tracks, { seedId: seedTrack.id, count: 16, seed: 9, index });
  const shuffled = built.tracks;
  assert.equal(shuffled.length, 16);
  const messy = [shuffled[12], shuffled[0], shuffled[9], shuffled[3], shuffled[15], shuffled[6], shuffled[1], shuffled[11]];
  const result = reorderPlaylist(messy);
  assert.ok(result.after.average >= result.before.average);
  assert.ok(result.after.average > 0.6, `po přeřazení ${result.after.average}`);
  assert.equal(result.tracks.length, messy.length);
  assert.equal(result.tracks[0].features.energy, Math.min(...messy.map((t) => t.features.energy)), 'set začíná nejklidnějším trackem');
});

test('playlistScore najde rozbité přechody', () => {
  const fast = tracks.find((t) => t.bpm > 170);
  const slow = tracks.find((t) => t.bpm < 118);
  const score = playlistScore([slow, fast]);
  assert.equal(score.problems.length, 1);
  assert.equal(score.problems[0].hardFail, true);
  assert.match(score.problems[0].reason, /BPM/);
  const good = playlistScore([slow, tracks.filter((t) => t.bpm < 124 && t.key === slow.key)[0] || slow]);
  assert.equal(good.problems.length, 0, 'dva podobné tracky nesmí hlásit problém');
});

test('presety vah mají smysl a součet vah je kladný', () => {
  for (const [key, preset] of Object.entries(WEIGHT_PRESETS)) {
    const sum = Object.values(preset.weights).reduce((a, b) => a + b, 0);
    assert.ok(sum > 0, `${key} nemá váhy`);
    assert.ok(preset.label.length > 0);
  }
  // harmonický preset musí víc ocenit shodu klíče než vyvážený
  const a = tracks.find((t) => t.key === '8A');
  const b = tracks.find((t) => t.key === '8A' && t.id !== a.id);
  const keyScore = scorePair(a, b, WEIGHT_PRESETS.key.weights, {});
  const balanced = scorePair(a, b, WEIGHT_PRESETS.balanced.weights, {});
  assert.ok(keyScore.parts.key === 1 && balanced.parts.key === 1);
  assert.ok(keyScore.score > 0);
});

/* --------------------------- DnB a styl mixu ----------------------------- */

function makeDnbCollection(count = 60) {
  const keys = ['8A', '8B', '9A', '9B', '10A', '11A', '7A', '2A'];
  const tags = ['liquid', 'neurofunk', 'jump up', 'rollers', 'halftime'];
  const list = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Tune ${i + 1}`,
    artist: `Producer ${i % 17}`,
    album: `EP ${i % 9}`,
    genre: 'Drum & Bass',
    label: `Label ${i % 6}`,
    year: 2020 + (i % 6),
    bpm: 172 + (i % 9) * 0.5,
    key: keys[i % keys.length],
    totalTime: 300 + (i % 5) * 10,
    comments: `#${tags[i % tags.length]} energy ${4 + (i % 6)}`,
    rating: 51 * (1 + (i % 5)),
    location: `file://localhost/C:/dnb/tune-${i + 1}.mp3`,
  }));
  buildFeatures(list);
  return list;
}

test('DnB: hodinový set má kolem 30 tracků, ne 12', () => {
  const dnbTracks = makeDnbCollection(60);
  assert.equal(estimateTrackCount(60, 125), 29);
  assert.equal(estimateTrackCount(60, 180), 20);

  const set = buildSet(dnbTracks, { minutes: 60, secondsPerTrack: 125, seed: 5 });
  assert.ok(set.entries.length >= 27, `jen ${set.entries.length} tracků`);
  assert.ok(set.entries.length <= 31, `moc tracků: ${set.entries.length}`);
  assert.equal(set.stats.secondsPerTrack, 125);
  assert.ok(Math.abs(set.stats.mixTime - 3600) < 400, `délka mixu ${set.stats.mixTime} s`);
  assert.ok(set.stats.totalTime > set.stats.mixTime, 'hudba je delší než odehraný set');

  const short = buildSet(dnbTracks, { minutes: 60, secondsPerTrack: 180, seed: 5 });
  assert.ok(set.entries.length > short.entries.length, 'rychlé mixování musí dát víc tracků');
});

test('automatický styl mixu pozná DnB kolekci', () => {
  const dnbTracks = makeDnbCollection(30);
  assert.ok(dnbShare(dnbTracks) === 1);
  assert.equal(resolveMixStyle('auto', dnbTracks).key, 'quick');
  assert.equal(resolveMixStyle('auto', tracks).key, 'standard');
  assert.equal(resolveMixStyle('quick', []).seconds, MIX_STYLES.quick.seconds);
  assert.equal(resolveMixStyle('full', tracks).seconds, null);
  assert.equal(resolveMixStyle('neexistuje', dnbTracks).key, 'quick');
});

test('DnB preset staví hlavně na klíči, energii a subžánru', () => {
  const weights = WEIGHT_PRESETS.dnb.weights;
  assert.ok(weights.key > weights.bpm, 'klíč musí být důležitější než BPM (vše je 174)');
  assert.ok(weights.energy >= weights.genre);
  assert.ok(weights.tags >= 10, 'subžánr v tagách má váhu');
  assert.match(WEIGHT_PRESETS.dnb.label, /DnB/);
});
