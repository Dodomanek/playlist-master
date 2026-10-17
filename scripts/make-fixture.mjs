/**
 * Vygeneruje demo kolekci ve formátu rekordbox XML (fixtures/sample-collection.xml).
 * Slouží pro testy i pro tlačítko "Vyzkoušet na demo datech" v aplikaci.
 *
 *   node scripts/make-fixture.mjs [pocetTracku]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '../src/lib/rng.js';
import { makeFolder, makePlaylist, pathToLocation, serializeRekordboxXml } from '../src/lib/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const rng = createRng(20261017);

const GENRES = [
  { name: 'Techno', bpm: [132, 141], tags: ['peak', 'driving', 'warehouse', 'industrial'], keys: ['8A', '9A', '8B', '7A', '10A', '2A', '9B'] },
  { name: 'Melodic Techno', bpm: [120, 127], tags: ['melodic', 'emotive', 'rolling', 'afterhours'], keys: ['8A', '9A', '11A', '6A', '5B', '8B'] },
  { name: 'Deep House', bpm: [117, 124], tags: ['deep', 'warmup', 'groove', 'soulful'], keys: ['5A', '6A', '4A', '12A', '8B', '9B'] },
  { name: 'House', bpm: [122, 128], tags: ['groove', 'vocal', 'funky'], keys: ['6A', '7A', '1B', '11B', '9A'] },
  { name: 'Minimal / Deep Tech', bpm: [124, 130], tags: ['rolling', 'trippy', 'groove', 'peak'], keys: ['7A', '8A', '9A', '3A', '11A'] },
  { name: 'Nu Disco', bpm: [110, 120], tags: ['chill', 'funk', 'vocal', 'lounge'], keys: ['4A', '9B', '10B', '3B', '6A'] },
  { name: 'Progressive House', bpm: [126, 131], tags: ['melodic', 'rolling', 'mainstage'], keys: ['8A', '9A', '10A', '5B', '12B'] },
  { name: 'Drum & Bass', bpm: [172, 176], tags: ['peak', 'banger', 'liquid'], keys: ['2A', '11A', '8A', '9A'] },
  { name: 'Trance', bpm: [136, 141], tags: ['mainstage', 'emotive', 'peak'], keys: ['8A', '9A', '10A', '11A', '8B'] },
];

const FIRST = ['Neon', 'Dark', 'Velvet', 'Static', 'Midnight', 'Paper', 'Solar', 'Ghost', 'Copper', 'Liquid', 'Hidden', 'Glass'];
const SECOND = ['Pulse', 'Orbit', 'Garden', 'Signal', 'Cruise', 'Machine', 'Tape', 'Ritual', 'Motion', 'Skyline', 'Theory', 'Bloom'];
const ARTIST_A = ['Kova', 'Nero', 'Lumen', 'Verti', 'Mala', 'Oska', 'Terra', 'Runa', 'Kask', 'Orbi', 'Duna', 'Saba'];
const ARTIST_B = ['cz', 'kov', 'sen', 'mix', 'wave', 'ton', 'ko', 'vik'];

function pickBpm(range, spread = 0) {
  const [lo, hi] = range;
  const value = rng.range(lo, hi);
  return Math.round(value * 2) / 2 - (spread ? 0 : 0);
}

function buildTracks(count) {
  const tracks = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i++) {
    const genre = GENRES[i % GENRES.length];
    let name;
    do {
      name = `${rng.pick(FIRST)} ${rng.pick(SECOND)}`;
    } while (usedNames.has(name) && usedNames.size < FIRST.length * SECOND.length);
    usedNames.add(name);
    const artist = `${rng.pick(ARTIST_A)}${rng.pick(ARTIST_B)}`;
    const key = rng.pick(genre.keys);
    const bpm = pickBpm(genre.bpm);
    const stars = Math.max(0, Math.min(5, Math.round(rng.range(0.8, 5))));
    const month = 1 + Math.floor(rng.range(1, 13));
    const day = 1 + Math.floor(rng.range(1, 28));
    const year = Math.round(rng.range(2017, 2026));
    tracks.push({
      id: i + 1,
      name,
      artist,
      album: `${rng.pick(FIRST)} EP`,
      genre: genre.name,
      kind: 'MP3 File',
      size: Math.round(rng.range(6, 14) * 1024 * 1024),
      totalTime: Math.round(rng.range(270, 480)),
      trackNumber: (i % 4) + 1,
      discNumber: 1,
      year,
      bpm,
      dateAdded: `${2026}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      bitRate: 320,
      sampleRate: 44100,
      comments: `#${genre.tags[Math.floor(rng.range(0, genre.tags.length))]} #${
        genre.tags[Math.floor(rng.range(0, genre.tags.length))]
      }, energy ${Math.round(rng.range(4, 10))}`,
      playCount: Math.floor(rng.range(0, 40)),
      rating: stars * 51,
      location: pathToLocation(`C:/Music/${genre.name.replace(/[^\w]+/g, '_')}/${artist} - ${name}.mp3`),
      remixer: '',
      key,
      label: `${rng.pick(FIRST)} Records`,
      mix: '',
      _attrs: {},
      _children: [],
    });
  }
  return tracks;
}

const count = Number(process.argv[2]) || 180;
const tracks = buildTracks(count);

// Pár "uživatelských" playlistů, ať je vidět, že je aplikace umí zachovat
const existing = makeFolder('Moje playlisty', [
  makePlaylist('Warm-up Deep', tracks.filter((t) => t.genre === 'Deep House').slice(0, 6).map((t) => t.id)),
  makePlaylist('Techno peak', tracks.filter((t) => t.genre === 'Techno').slice(0, 7).map((t) => t.id)),
]);

const xml = serializeRekordboxXml({
  product: { name: 'rekordbox', version: '6.8.2', company: 'AlphaTheta' },
  tracks,
  playlistTree: [existing],
});

const out = resolve(here, '..', 'fixtures', 'sample-collection.xml');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml, 'utf8');
console.log(`Zapsáno ${tracks.length} tracků do ${out}`);

// stejný soubor servírujeme i aplikaci jako demo kolekci (public/ se kopíruje do buildu)
const demo = resolve(here, '..', 'public', 'demo-collection.xml');
mkdirSync(dirname(demo), { recursive: true });
writeFileSync(demo, xml, 'utf8');
console.log(`Zapsáno do ${demo} (demo data v aplikaci)`);
