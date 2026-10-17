/**
 * Quickie import: čištění zmatených názvů, čtení tagů z MP3/FLAC,
 * nápovědy z textu a měření BPM/klíče z audia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBpm, detectKey } from '../src/lib/audio.js';
import {
  cleanTrackName,
  guessGenre,
  hintsFromText,
  isAudioFile,
  readTrackFile,
  splitArtistTitle,
} from '../src/lib/quickie.js';

function fakeFile(name, bytes) {
  const buf = Buffer.from(bytes);
  return { name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

function synchsafe(n) {
  return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
}

function id3Frame(id, text) {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
  return Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(synchsafe(body.length)), Buffer.from([0, 0]), body]);
}

function makeMp3(name, frames) {
  const body = Buffer.concat(frames);
  const header = Buffer.concat([
    Buffer.from('ID3'),
    Buffer.from([4, 0, 0]),
    Buffer.from(synchsafe(body.length)),
  ]);
  return fakeFile(name, Buffer.concat([header, body, Buffer.alloc(64)]));
}

function flacFile(name, fields) {
  const vendor = Buffer.from('test', 'utf8');
  const entries = fields.map(([key, value]) => {
    const entry = Buffer.from(`${key}=${value}`, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(entry.length);
    return Buffer.concat([len, entry]);
  });
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendor.length);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(fields.length);
  const commentBlock = Buffer.concat([vendorLen, vendor, count, ...entries]);
  const head = Buffer.from([
    0x84, // last block + type 4 (VORBIS_COMMENT)
    (commentBlock.length >> 16) & 0xff,
    (commentBlock.length >> 8) & 0xff,
    commentBlock.length & 0xff,
  ]);
  return fakeFile(name, Buffer.concat([Buffer.from('fLaC'), head, commentBlock]));
}

test('vyčistí zmatený název souboru', () => {
  assert.equal(cleanTrackName('01 - Internoise_-_Roller (174bpm) [www.free-dnb.com].mp3'), 'Internoise_-_Roller (174bpm)');
  assert.equal(cleanTrackName('02. Some Artist - Some Track [FLAC].flac'), 'Some Artist - Some Track');
  assert.equal(cleanTrackName('Artist_-_Track (320kbps).mp3'), 'Artist_-_Track');
  assert.equal(cleanTrackName('http://x.cz/Artist.mp3.mp3.mp3') !== '', true);
  assert.equal(isAudioFile('a.MP3'), true);
  assert.equal(isAudioFile('a.flac'), true);
  assert.equal(isAudioFile('a.txt'), false);
});

test('interpret a název z názvu souboru', () => {
  assert.deepEqual(splitArtistTitle('Internoise_-_Roller (174bpm)'), { artist: 'Internoise', title: 'Roller (174bpm)' });
  assert.deepEqual(splitArtistTitle('Artist - Title'), { artist: 'Artist', title: 'Title' });
  assert.deepEqual(splitArtistTitle('Jen jeden název'), { artist: '', title: 'Jen jeden název' });
});

test('nápovědy BPM, klíč a žánr z textu', () => {
  assert.equal(hintsFromText('Track (174bpm)').bpm, 174);
  assert.equal(hintsFromText('Track 128 bpm mix').bpm, 128);
  assert.equal(hintsFromText('(165) something').bpm, 165);
  assert.equal(hintsFromText('bez čísla').bpm, null);
  assert.equal(hintsFromText('mix (8A)').key, '8A');
  assert.equal(hintsFromText('Track [C#m]').key, 'C#m');
  assert.equal(hintsFromText('a_neurofunk_banger').genre, 'Neurofunk');
  assert.equal(guessGenre('some jungle cut'), 'Jungle');
  assert.equal(guessGenre('drum and bass mix'), 'Drum & Bass');
  assert.equal(guessGenre('promo of something'), null);
});

test('přečte tagy ID3v2 z MP3', async () => {
  const file = makeMp3('01 whatever.mp3', [
    id3Frame('TIT2', 'Rollercoaster'),
    id3Frame('TPE1', 'Internoise'),
    id3Frame('TALB', 'Rave It'),
    id3Frame('TCON', 'Neurofunk'),
    id3Frame('TBPM', '174'),
    id3Frame('TKEY', '8A'),
    id3Frame('TDRC', '2024'),
  ]);
  const meta = await readTrackFile(file);
  assert.equal(meta.artist, 'Internoise');
  assert.equal(meta.title, 'Rollercoaster');
  assert.equal(meta.album, 'Rave It');
  assert.equal(meta.genre, 'Neurofunk');
  assert.equal(meta.bpm, 174);
  assert.equal(meta.key, '8A');
  assert.equal(meta.year, '2024');
  assert.equal(meta.tagSource, 'ID3v2');
  assert.equal(meta.hadTags, true);
});

test('přečte Vorbis comment z FLAC', async () => {
  const file = flacFile('track.flac', [
    ['TITLE', 'Deep Dive'],
    ['ARTIST', 'Basslayer'],
    ['GENRE', 'Deep DnB'],
    ['BPM', '172'],
    ['KEY', '9A'],
    ['DATE', '2023'],
  ]);
  const meta = await readTrackFile(file);
  assert.equal(meta.artist, 'Basslayer');
  assert.equal(meta.title, 'Deep Dive');
  assert.equal(meta.genre, 'Deep DnB');
  assert.equal(meta.bpm, 172);
  assert.equal(meta.key, '9A');
  assert.equal(meta.year, '2023');
  assert.equal(meta.tagSource, 'Vorbis comment');
});

test('bez tagů použije vyčištěný název souboru', async () => {
  const file = fakeFile('01 - Nobody_-_Neuro Roller (168bpm) [download].mp3', Buffer.alloc(256));
  const meta = await readTrackFile(file);
  assert.equal(meta.hadTags, false);
  assert.equal(meta.artist, 'Nobody');
  assert.equal(meta.title, 'Neuro Roller (168bpm)');
  assert.equal(meta.bpm, 168);
  assert.equal(meta.genre, 'Neurofunk');
  assert.equal(meta.tagSource, 'název souboru');
});

test('BPM detekce z klikového signálu napříč spektrem', () => {
  const sr = 44100;
  const makeClicks = (bpm) => {
    const buf = new Float32Array(sr * 45);
    for (let t = 0; t < buf.length; t++) {
      const phase = (t / sr) * (bpm / 60);
      if (phase % 1 < 0.02) buf[t] += 0.8 * Math.exp(-((phase % 1) * 40));
    }
    return buf;
  };
  // včetně hodnot, kde dřív selhávala oktavová korekce (87↔174) a hrany pásma (195)
  for (const bpm of [70, 74, 80, 84, 87, 90, 95, 100, 110, 120, 124, 130, 140, 150, 155, 160, 165, 170, 172, 174, 176, 180, 190, 195]) {
    const result = detectBpm(makeClicks(bpm), sr);
    assert.ok(result.bpm != null, `nepodařilo se změřit ${bpm}`);
    assert.ok(Math.abs(result.bpm - bpm) <= 1.5, `změřeno ${result.bpm} místo ${bpm}`);
    assert.ok(result.confidence > 0.3, `nízká důvěryhodnost u ${bpm}`);
  }
});

test('klíč z akordu se přepočítá na Camelot', () => {
  const sr = 44100;
  const chord = (freqs) => {
    const buf = new Float32Array(sr * 5);
    for (let i = 0; i < buf.length; i++) {
      const t = i / sr;
      for (const f of freqs) buf[i] += Math.sin(2 * Math.PI * f * t) / freqs.length;
    }
    return buf;
  };
  const aMinor = detectKey(chord([440, 523.25, 659.25]), sr);
  assert.equal(aMinor.key, 'Am');
  assert.equal(aMinor.camelot, '8A');
  const dMinor = detectKey(chord([293.66, 349.23, 440]), sr);
  assert.equal(dMinor.camelot, '7A', `naměřeno ${dMinor.key}`);
  const eMajor = detectKey(chord([329.63, 415.3, 493.88]), sr); // E G# B
  assert.equal(eMajor.camelot, '12B', `naměřeno ${eMajor.key}`);
});