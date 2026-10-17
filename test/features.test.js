import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeatures,
  parseEnergyTag,
  parseTags,
  ratingToStars,
  starsToEnergy,
} from '../src/lib/features.js';

test('tagy z komentáře se rozsekají a normalizují', () => {
  assert.deepEqual(parseTags('#Deep #rolling, energy 8'), ['deep', 'rolling', 'energy 8']);
  assert.deepEqual(parseTags('Vocal | Funky / #Peak'), ['vocal', 'funky', 'peak']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(null), []);
});

test('energie z komentáře se pozná v několika zápisech', () => {
  assert.equal(parseEnergyTag('energy 7'), 7);
  assert.equal(parseEnergyTag('Energie: 9/10'), 9);
  assert.equal(parseEnergyTag('e=6'), 6);
  assert.equal(parseEnergyTag('intenzita 85'), 9);
  assert.equal(parseEnergyTag('něco jiného'), null);
});

test('hodnocení z rekordboxu (0-255) se převede na hvězdy', () => {
  assert.equal(ratingToStars(0), 0);
  assert.equal(ratingToStars(51), 1);
  assert.equal(ratingToStars(102), 2);
  assert.equal(ratingToStars(204), 4);
  assert.equal(ratingToStars(255), 5);
  assert.equal(ratingToStars(1000), 5);
  assert.equal(starsToEnergy(0), 0);
  assert.equal(starsToEnergy(5), 100);
});

test('buildFeatures doplní energii 0-100 a percentily', () => {
  const tracks = [
    { id: 1, bpm: 120, genre: 'Deep House', comments: 'energy 3', rating: 51, key: '8A' },
    { id: 2, bpm: 124, genre: 'Deep House', comments: '#warmup', rating: 102, key: '9A' },
    { id: 3, bpm: 140, genre: 'Techno', comments: '#peak energy 9', rating: 255, key: '8A' },
  ];
  const { stats } = buildFeatures(tracks);
  for (const track of tracks) {
    assert.ok(track.features.energy >= 0 && track.features.energy <= 100);
    assert.equal(typeof track.features.genre, 'string');
    assert.ok(Array.isArray(track.features.tags));
  }
  assert.ok(
    tracks[2].features.energy > tracks[0].features.energy,
    'peak techno musí mít vyšší energii než warm-up deep house',
  );
  assert.equal(stats.count, 3);
  assert.equal(stats.withKey, 3);
  assert.equal(stats.bpms.min, 120);
  assert.equal(stats.bpms.max, 140);
  assert.equal(stats.genres[0][0], 'deep house');
});

test('ruční energie z UI přepíše odhad', () => {
  const tracks = [{ id: 7, bpm: 128, genre: 'Techno', comments: '', rating: 0, key: '8A' }];
  buildFeatures(tracks, { energyOverrides: { 7: 95 } });
  assert.equal(tracks[0].features.energy, 95);
  assert.equal(tracks[0].features.energyManual, true);
});

test('když nejsou žádná data, energie spadne na neutrálních 50', () => {
  const tracks = [{ id: 1, bpm: null, genre: '', comments: '', rating: 0, key: '' }];
  buildFeatures(tracks);
  assert.equal(tracks[0].features.energy, 50);
});
