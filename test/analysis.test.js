/**
 * Testy rozboru kolekce: BPM pásma, energetické zóny, Camelot wheel,
 * duplicity/varianty, zdraví metadata a akční insights.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCollection,
  artistStats,
  bpmBands,
  duplicateKey,
  energyZones,
  eraStats,
  findDuplicates,
  keyWheel,
  metadataHealth,
  normalizeTitle,
} from '../src/lib/analysis.js';
import { buildFeatures } from '../src/lib/features.js';

function makeTracks() {
  const list = [
    { id: 1, name: 'Rain', artist: 'Kovasen', genre: 'Deep House', bpm: 122, key: '8A', rating: 102, year: 2019, label: 'Deeprec', comments: '#deep', totalTime: 300, location: 'file://localhost/C:/a/1.mp3' },
    { id: 2, name: 'Rain (Radio Edit)', artist: 'Kovasen', genre: 'Deep House', bpm: 122, key: '8A', rating: 51, year: 2019, label: 'Deeprec', comments: '', totalTime: 180, location: 'file://localhost/C:/a/2.mp3' },
    { id: 3, name: 'Pressure', artist: 'Nocturnal', genre: 'Techno', bpm: 138, key: '5A', rating: 204, year: 2021, label: 'Tresor', comments: '#peak energy 9', totalTime: 420, location: 'file://localhost/C:/a/3.mp3' },
    { id: 4, name: 'Signal', artist: 'Kilo', genre: 'Techno', bpm: 140, key: '5A', rating: 0, year: null, label: '', comments: '', totalTime: 360, location: 'file://localhost/C:/a/4.mp3' },
    { id: 5, name: 'Dreams (feat. Eva)', artist: 'Liquid', genre: 'Liquid', bpm: 174, key: '2A', rating: 153, year: 2023, label: 'Hospital', comments: '#melodic energy 4', totalTime: 330, location: 'file://localhost/C:/a/5.mp3' },
    { id: 6, name: 'Dreams', artist: 'Liquid', genre: 'Liquid', bpm: 174, key: '2A', rating: 153, year: 2023, label: 'Hospital', comments: '', totalTime: 330, location: 'file://localhost/C:/a/6.mp3' },
  ];
  buildFeatures(list);
  return list;
}

test('normalizeTitle vyhodí feat., verze a diakritiku', () => {
  assert.equal(normalizeTitle('Dreams (feat. Eva)'), 'dreams');
  assert.equal(normalizeTitle('Rain (Radio Edit)'), 'rain');
  assert.equal(normalizeTitle('Pressure – Club Mix'), 'pressure');
  assert.equal(normalizeTitle('Kovasen [Extended Mix]'), 'kovasen');
  assert.equal(normalizeTitle('Cesta [Original]'), 'cesta');
});

test('bpmBands najde dominantní pásmo a pokrytí', () => {
  const tracks = makeTracks();
  const report = bpmBands(tracks, 4);
  assert.equal(report.size, 4);
  assert.ok(report.bands.length >= 3, 'čtyři různá tempa = aspoň tři pásma');
  assert.ok(report.dominant.count >= 1);
  const total = report.bands.reduce((sum, band) => sum + band.count, 0);
  assert.equal(total, tracks.length, 'pásma musejí pokrýt všechny tracky s BPM');
  assert.ok(report.dominant.to - report.dominant.from === 4);
  // prázdná kolekce nesmí spadnout
  const empty = bpmBands([], 4);
  assert.equal(empty.bands.length, 0);
  assert.equal(empty.dominant, null);
});

test('energyZones rozdělí tracky do zón a spočítá průměr', () => {
  const tracks = makeTracks();
  const report = energyZones(tracks);
  const sum = report.zones.reduce((acc, zone) => acc + zone.count, 0);
  assert.equal(sum, tracks.length);
  assert.ok(Number.isFinite(report.avg) && report.avg >= 0 && report.avg <= 100);
  assert.ok(Number.isFinite(report.median));
  const shares = report.zones.reduce((acc, zone) => acc + zone.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, 'součet podílů musí být 1');
});

test('keyWheel zná 24 políček a hlásí chybějící klíče', () => {
  const tracks = makeTracks();
  const wheel = keyWheel(tracks);
  assert.equal(wheel.total, 24);
  assert.equal(wheel.known, 6, 'všech šest tracků má klíč');
  assert.equal(wheel.counts['8A'], 2);
  assert.equal(wheel.counts['5A'], 2);
  assert.equal(wheel.counts['2A'], 2);
  assert.equal(wheel.filled, 3);
  assert.ok(wheel.missing.includes('1A') && wheel.missing.includes('12B'));
  assert.equal(wheel.top[0].count, 2, 'žebříček je seřazený sestupně');
});

test('findDuplicates odliší skutečné duplicity od verzí', () => {
  const tracks = makeTracks();
  const report = findDuplicates(tracks);
  // Dreams a Dreams (feat. Eva) = tutéž nahrávka bez featu v základu
  const keys = [...report.duplicates, ...report.variants].map((g) => g.key);
  assert.ok(keys.some((key) => key.includes('dreams')), `čekám Dreams ve skupinách: ${keys}`);
  // Rain vs Rain (Radio Edit) = varianta, ne úplná duplicita
  assert.ok(
    report.duplicates.length + report.variants.length >= 2,
    'Rain i Dreams mají mít skupinu',
  );
  assert.ok(report.duplicateCount >= 0 && report.variantCount >= 0);
  assert.equal(duplicateKey(tracks[5]), duplicateKey(tracks[4]), 'feat. nemění klíč duplicit');
  // úplně prázdná kolekce
  const none = findDuplicates([]);
  assert.equal(none.duplicates.length, 0);
});

test('metadataHealth boduje podle váhy pole a hlásí nejslabší', () => {
  const tracks = makeTracks();
  const report = metadataHealth(tracks);
  assert.ok(report.score > 50 && report.score <= 100);
  const bpmField = report.coverage.find((f) => f.key === 'bpm');
  assert.equal(bpmField.count, 6);
  const yearField = report.coverage.find((f) => f.key === 'year');
  assert.equal(yearField.count, 5, 'rok chybí u jednoho tracku');
  assert.ok(report.weakest.length >= 1);
  // skóre plné kolekce = 100
  const full = metadataHealth([
    { genre: 'Techno', bpm: 130, key: '8A', rating: 51, year: 2020, label: 'X', comments: '#a' },
  ]);
  assert.equal(full.score, 100);
});

test('eraStats počítá dekády a neznámé roky', () => {
  const tracks = makeTracks();
  const eras = eraStats(tracks);
  assert.equal(eras.unknown, 1);
  const decades = Object.fromEntries(eras.decades.map((d) => [d.decade, d.count]));
  assert.equal(decades[2010], 2);
  assert.equal(decades[2020], 3);
});

test('artistStats seřadí interprety podle počtu tracků', () => {
  const tracks = makeTracks();
  const artists = artistStats(tracks, 5);
  assert.equal(artists[0].artist, 'kovasen');
  assert.equal(artists[0].count, 2);
  assert.ok(Number.isFinite(artists[0].avgBpm));
  assert.ok(artists[0].avgEnergy >= 0 && artists[0].avgEnergy <= 100);
  assert.ok(artists.length <= 5);
});

test('analyzeCollection složí report s insights v češtině', () => {
  const tracks = makeTracks();
  const report = analyzeCollection(tracks);
  assert.equal(report.count, 6);
  assert.ok(Array.isArray(report.insights) && report.insights.length >= 3);
  for (const line of report.insights) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 10, `insight je podezřele krátký: ${line}`);
  }
  assert.ok(report.insights.some((line) => line.includes('BPM')), 'insight o tempu chybí');
  // prázdná kolekce nesmí spadnout a nemá insights
  const empty = analyzeCollection([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.insights.length, 0);
  assert.equal(empty.health.score, 0);
});
