/**
 * DnB demo kolekce – generuje se přímo v prohlížeči, aby si šel DnB set vyzkoušet
 * bez exportu vlastního XML. Subžánry (liquid, rollers, neurofunk, jump up, halftime,
 * jungle) mají různé energie a klíče, takže se na tom dá ověřit harmonické mixování.
 */
import { createRng } from './rng.js';
import { makeFolder, makePlaylist, pathToLocation } from './parse.js';

const SUBGENRES = [
  { name: 'Liquid', tags: ['liquid', 'melodic', 'soulful'], bpm: [172, 176], energy: [3, 6] },
  { name: 'Rollers', tags: ['rollers', 'rolling', 'groove'], bpm: [172, 175], energy: [5, 7] },
  { name: 'Neurofunk', tags: ['neurofunk', 'techy', 'dark'], bpm: [172, 176], energy: [7, 10] },
  { name: 'Jump Up', tags: ['jump up', 'banger', 'peak'], bpm: [174, 176], energy: [8, 10] },
  { name: 'Halftime', tags: ['halftime', 'dark', 'trippy'], bpm: [170, 174], energy: [4, 7] },
  { name: 'Jungle', tags: ['jungle', 'ragga', 'amen'], bpm: [168, 174], energy: [6, 9] },
];

const KEYS = ['8A', '8B', '9A', '9B', '10A', '10B', '7A', '7B', '11A', '11B', '2A', '3A', '5A', '6A'];
const FIRST = ['Iron', 'Neon', 'Cold', 'Deep', 'Broken', 'Midnight', 'Static', 'Golden', 'Lost', 'Hidden', 'Frozen', 'Wild'];
const SECOND = ['Circuit', 'Rain', 'Pressure', 'System', 'Jungle', 'Signal', 'Machine', 'Dreams', 'Rollers', 'Tape', 'Horizon', 'Science'];
const ARTIST_A = ['Sub', 'Noctur', 'Liquid', 'Kilo', 'Rusko', 'Polar', 'Vict', 'Zeta', 'Astra', 'Night', 'Raven', 'Odyss'];
const ARTIST_B = ['stance', 'nal', 'k', 'flip', 'id', 'e', 'or', 'ko', 'wave', 'crew', 'a', ''];

export function buildDnbCollection(count = 140, seed = 20261017) {
  const rng = createRng(seed);
  const tracks = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i++) {
    const genre = SUBGENRES[i % SUBGENRES.length];
    let name;
    do {
      name = `${rng.pick(FIRST)} ${rng.pick(SECOND)}`;
    } while (usedNames.has(name) && usedNames.size < FIRST.length * SECOND.length);
    usedNames.add(name);
    const artist = `${rng.pick(ARTIST_A)}${rng.pick(ARTIST_B)}`.trim();
    const bpm = Math.round(rng.range(genre.bpm[0], genre.bpm[1]) * 2) / 2;
    const energy = Math.round(rng.range(genre.energy[0], genre.energy[1]));
    const stars = Math.max(1, Math.min(5, Math.round(rng.range(2, 5.2))));
    const month = 1 + Math.floor(rng.range(1, 13));
    const day = 1 + Math.floor(rng.range(1, 28));
    const tag = rng.pick(genre.tags);
    tracks.push({
      id: i + 1,
      name,
      artist,
      album: `${rng.pick(FIRST)} EP`,
      grouping: '',
      genre: 'Drum & Bass',
      kind: 'MP3 File',
      size: Math.round(rng.range(7, 14) * 1024 * 1024),
      totalTime: Math.round(rng.range(260, 360)),
      trackNumber: (i % 4) + 1,
      discNumber: 1,
      year: Math.round(rng.range(2016, 2026)),
      bpm,
      dateAdded: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      bitRate: 320,
      sampleRate: 44100,
      comments: `#${tag} #${rng.pick(genre.tags)}, energy ${energy}`,
      playCount: Math.floor(rng.range(0, 60)),
      rating: stars * 51,
      location: pathToLocation(`C:/Music/DnB/${genre.name}/${artist} - ${name}.mp3`),
      remixer: '',
      key: rng.pick(KEYS),
      label: `${genre.name} Records`,
      mix: '',
      _attrs: {},
      _children: [],
    });
  }

  const byTag = (tag) => tracks.filter((t) => t.comments.includes(`#${tag}`)).slice(0, 18).map((t) => t.id);
  const playlists = [
    makeFolder('DnB demo sady', [
      makePlaylist('Liquid warm-up', byTag('liquid')),
      makePlaylist('Neurofunk peak', byTag('neurofunk')),
      makePlaylist('Rollers', byTag('rollers')),
      makePlaylist('Jump up bangers', byTag('banger')),
    ]),
  ];

  return {
    parsed: {
      version: '1.0.0',
      product: { name: 'rekordbox', version: '6.8.2', company: 'AlphaTheta' },
      declaredEntries: tracks.length,
      tracks,
      playlists,
    },
    source: `DnB demo kolekce (${tracks.length} tracků)`,
  };
}
