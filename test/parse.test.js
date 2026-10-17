import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildCsv,
  buildM3u8,
  locationToPath,
  makeFolder,
  makePlaylist,
  parseRekordboxXml,
  pathToLocation,
  playlistTreeFromParsed,
  serializeRekordboxXml,
} from '../src/lib/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(here, '..', 'fixtures', 'sample-collection.xml'), 'utf8');
const parsed = parseRekordboxXml(fixture);

test('naparsuje kolekci z XML', () => {
  assert.ok(parsed.tracks.length >= 100, `očekáváme demo kolekci, je ${parsed.tracks.length}`);
  assert.equal(parsed.tracks.length, parsed.declaredEntries);
  const track = parsed.tracks[0];
  assert.ok(track.id > 0);
  assert.ok(track.name.length > 0);
  assert.ok(track.bpm > 0);
  assert.ok(track.keyParsed.camelot, 'klíč musí jít přečíst');
  assert.ok(track.path.endsWith('.mp3'));
  assert.ok(!track.path.startsWith('file://'));
  assert.ok(track.rating >= 0 && track.rating <= 255);
});

test('naparsuje i strom playlistů', () => {
  assert.ok(parsed.playlists.length >= 1);
  const folder = parsed.playlists.find((p) => p.type === 'folder');
  assert.ok(folder, 'chybí složka s playlisty');
  const playlists = folder.children.filter((c) => c.type === 'playlist');
  assert.equal(playlists.length, 2);
  assert.ok(playlists[0].trackIds.length > 0);
});

test('zachová původní data při zápisu zpět (round-trip)', () => {
  const tree = playlistTreeFromParsed(parsed);
  tree.push(makeFolder('Nové', [makePlaylist('Test set', parsed.tracks.slice(0, 5).map((t) => t.id))]));
  const xml = serializeRekordboxXml({ product: parsed.product, tracks: parsed.tracks, playlistTree: tree });
  const re = parseRekordboxXml(xml);
  assert.equal(re.tracks.length, parsed.tracks.length);
  assert.deepEqual(
    re.tracks.map((t) => t.id),
    parsed.tracks.map((t) => t.id),
  );
  assert.deepEqual(
    re.tracks.map((t) => t.location),
    parsed.tracks.map((t) => t.location),
    'cesty k souborům musí zůstat stejné, jinak rekordbox tracky nespáruje',
  );
  assert.deepEqual(
    re.tracks.slice(0, 20).map((t) => [t.name, t.artist, t.bpm, t.rating, t.key, t.comments, t.label]),
    parsed.tracks.slice(0, 20).map((t) => [t.name, t.artist, t.bpm, t.rating, t.key, t.comments, t.label]),
  );
  const folder = re.playlists.find((p) => p.name === 'Nové');
  assert.equal(folder.children[0].trackIds.length, 5);
  assert.deepEqual(folder.children[0].trackIds, parsed.tracks.slice(0, 5).map((t) => t.id));
});

test('klíčové atributy zůstanou po zápisu v XML', () => {
  const track = parsed.tracks[3];
  const xml = serializeRekordboxXml({ product: parsed.product, tracks: [track], playlistTree: [] });
  assert.match(xml, /<DJ_PLAYLISTS Version="1\.0\.0">/);
  assert.match(xml, /<COLLECTION Entries="1">/);
  assert.match(xml, new RegExp(`TrackID="${track.id}"`));
  assert.match(xml, /<PLAYLISTS>/);
  assert.match(xml, /<NODE Type="0" Name="ROOT" Count="0">/);
  assert.match(xml, new RegExp(`Location="${track.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('cesta a file:// localhost se převádí obousměrně', () => {
  assert.equal(locationToPath('file://localhost/C:/Music/a%20b.mp3'), 'C:/Music/a b.mp3');
  assert.equal(locationToPath('file:///Users/dj/Music/x.flac'), '/Users/dj/Music/x.flac');
  assert.equal(locationToPath(''), '');
  assert.equal(locationToPath(pathToLocation('C:/Music/a b.mp3')), 'C:/Music/a b.mp3');
});

test('escapování v názvech nepokazí XML', () => {
  const track = {
    id: 999,
    name: 'Rock & Roll <3',
    artist: 'A "B"',
    genre: '',
    totalTime: 200,
    bpm: 128,
    rating: 0,
    location: pathToLocation('C:/Music/a&b.mp3'),
    key: '8A',
    label: '',
    comments: "5'4\" & more",
    _attrs: {},
    _children: [],
  };
  const xml = serializeRekordboxXml({ tracks: [track], playlistTree: [] });
  const re = parseRekordboxXml(xml);
  assert.equal(re.tracks[0].name, 'Rock & Roll <3');
  assert.equal(re.tracks[0].artist, 'A "B"');
  assert.equal(re.tracks[0].comments, "5'4\" & more");
  assert.equal(re.tracks[0].path, 'C:/Music/a&b.mp3');
});

test('XML z jiného programu ohlásí srozumitelnou chybu', () => {
  assert.throws(() => parseRekordboxXml('<foo><bar/></foo>'), /rekordbox/);
});

/* --------------------- import jen jednoho playlistu --------------------- */

const playlistOnlyXml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.8.2" Company="AlphaTheta"/>
  <COLLECTION Entries="0"/>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="DnB vyběr" Type="1" KeyType="0" Entries="3">
        <TRACK Key="1" Name="Warm Up" Artist="Kdo" AverageBpm="174.00" Tonality="8A" TotalTime="300" Rating="153" Location="file://localhost/C:/dnb/a.mp3" Comments="#liquid energy 4"/>
        <TRACK Key="2" Name="Peak" Artist="Kdo" AverageBpm="174.00" Tonality="8B" TotalTime="280" Rating="255" Location="file://localhost/C:/dnb/b.mp3" Comments="#neurofunk energy 9"/>
        <TRACK Key="3" Name="Roller" Artist="Jiny" AverageBpm="175.00" Tonality="9A" TotalTime="310" Rating="102" Location="file://localhost/C:/dnb/c.mp3" Comments="#rollers energy 6"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>`;

test('playlist-only XML (bez kolekce) se načte z metadat v playlistu', () => {
  const parsed = parseRekordboxXml(playlistOnlyXml);
  assert.equal(parsed.tracks.length, 3);
  assert.ok(parsed.tracks.every((t) => t.synthetic), 'tracky musí být označené jako dopočítané');
  assert.equal(parsed.playlists.length, 1);
  assert.equal(parsed.playlists[0].name, 'DnB vyběr');
  assert.deepEqual(parsed.playlists[0].trackIds, [1, 2, 3]);

  const first = parsed.tracks[0];
  assert.equal(first.name, 'Warm Up');
  assert.equal(first.artist, 'Kdo');
  assert.equal(first.bpm, 174);
  assert.equal(first.keyParsed.camelot, '8A');
  assert.equal(first.path, 'C:/dnb/a.mp3');
  assert.equal(first.rating, 153);
  assert.equal(first.totalTime, 300);
});

test('playlist-only XML jde zase zapsat a načíst (round-trip)', () => {
  const parsed = parseRekordboxXml(playlistOnlyXml);
  const xml = serializeRekordboxXml({
    product: parsed.product,
    tracks: parsed.tracks,
    playlistTree: playlistTreeFromParsed(parsed),
  });
  const again = parseRekordboxXml(xml);
  assert.equal(again.tracks.length, 3);
  assert.deepEqual(again.playlists[0].trackIds, [1, 2, 3]);
  assert.deepEqual(
    again.tracks.map((t) => [t.name, t.artist, t.bpm, t.key]),
    parsed.tracks.map((t) => [t.name, t.artist, t.bpm, t.key]),
  );
});

test('playlist s metadaty se nevytvoří duplicitně, když track v kolekci je', () => {
  const withCollection = playlistOnlyXml.replace(
    '<COLLECTION Entries="0"/>',
    '<COLLECTION Entries="1"><TRACK TrackID="1" Name="Warm Up" Artist="Kdo" AverageBpm="174.00" Tonality="8A" TotalTime="300" Location="file://localhost/C:/dnb/a.mp3"/></COLLECTION>',
  );
  const parsed = parseRekordboxXml(withCollection);
  assert.equal(parsed.tracks.length, 3, 'track 1 už v kolekci je, jen 2 a 3 se dopočítají');
  assert.equal(parsed.tracks.filter((t) => t.id === 1).length, 1);
  assert.deepEqual(parsed.playlists[0].trackIds, [1, 2, 3]);
});

test('XML jen s prázdnými playlisty poradí, co udělat', () => {
  const xml = `<DJ_PLAYLISTS Version="1.0.0"><PLAYLISTS><NODE Type="0" Name="ROOT"><NODE Name="X" Type="1"><TRACK Key="5"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>`;
  assert.throws(() => parseRekordboxXml(xml), /Export Collection/);
});

test('M3U8 a CSV export vypadají rozumně', () => {
  const tracks = parsed.tracks.slice(0, 3);
  const m3u = buildM3u8([{ name: 'Test', tracks }]);
  const lines = m3u.trim().split('\n');
  assert.equal(lines[0], '#EXTM3U');
  assert.equal(lines[1], '#PLAYLIST:Test');
  assert.equal(lines.length, 2 + tracks.length * 2);
  assert.match(lines[2], /^#EXTINF:\d+,/);

  const csv = buildCsv([{ a: 'x,y', b: 'hele "to"', c: 1 }]);
  assert.equal(csv.split('\n')[0], 'a,b,c');
  assert.equal(csv.split('\n')[1], '"x,y","hele ""to""",1');
});
