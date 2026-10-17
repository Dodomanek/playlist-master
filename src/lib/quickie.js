/**
 * Quickie import – "clean your tracks".
 *
 * Umožňuje pustit do aplikace rovnou MP3/FLAC/WAV/M4A soubory (bez rekordbox XML):
 *   1) vyčistí zmatené názvy souborů (číslování, "320kbps", "www.site.com"…),
 *   2) přečte vložené tagy (ID3v2, Vorbis comment, QuickTime ilst, RIFF INFO),
 *   3) vytáhne nápovědy z textu (BPM, klíč, žánr).
 *
 * Vše lokálně, bez závislostí – čte se jen hlavička souboru, ne celá hudba.
 */

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'flac', 'wav', 'm4a', 'aac', 'aiff', 'aif', 'ogg', 'opus', 'wma', 'alac', 'ape', 'wv',
]);

export function isAudioFile(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

/* ------------------------------ čtení souboru ----------------------------- */

export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function ascii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    const c = bytes[offset + i];
    if (c == null) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function u32be(bytes, o) {
  return ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
}
function u32le(bytes, o) {
  return (bytes[o] + (bytes[o + 1] << 8) + (bytes[o + 2] << 16) + ((bytes[o + 3] << 24) >>> 0)) >>> 0;
}
function u24be(bytes, o) {
  return (bytes[o] << 16) + (bytes[o + 1] << 8) + bytes[o + 2];
}
function u16le(bytes, o) {
  return bytes[o] + (bytes[o + 1] << 8);
}
function syncsafe(bytes, o) {
  return ((bytes[o] & 0x7f) << 21) | ((bytes[o + 1] & 0x7f) << 14) | ((bytes[o + 2] & 0x7f) << 7) | (bytes[o + 3] & 0x7f);
}

function decodeText(bytes) {
  if (!bytes || !bytes.length) return '';
  const enc = bytes[0];
  const body = bytes.subarray(1);
  const tryDecode = (label) => {
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      return null;
    }
  };
  if (enc === 3) return (tryDecode('utf-8') || '').replace(/\0+$/, '');
  if (enc === 0) {
    // Latin1; tagy často píší česky ve windows-1250/1252 – zkusíme, pak windows-1252
    const latin = Array.from(body, (b) => String.fromCharCode(b)).join('');
    const win = tryDecode('windows-1252');
    if (win && /[áčďéěíňóřšťúůýž]/i.test(win)) return win.replace(/\0+$/, '');
    return latin.replace(/\0+$/, '');
  }
  if (enc === 1 || enc === 2) {
    let le = true;
    let data = body;
    if (enc === 1) {
      if (body[0] === 0xff && body[1] === 0xfe) data = body.subarray(2);
      else if (body[0] === 0xfe && body[1] === 0xff) {
        le = false;
        data = body.subarray(2);
      }
    } else {
      le = false;
    }
    try {
      if (le) return new TextDecoder('utf-16le').decode(data).replace(/\0+$/, '');
      const be = new Uint8Array(data.length);
      for (let i = 0; i + 1 < data.length; i += 2) {
        be[i] = data[i + 1];
        be[i + 1] = data[i];
      }
      return new TextDecoder('utf-16be').decode(be).replace(/\0+$/, '');
    } catch {
      return Array.from(body, (b) => (b ? String.fromCharCode(b) : '')).join('').replace(/\0+$/, '');
    }
  }
  return '';
}

/** ID3 COMM frame: encoding + jazyk + popis + text. */
function decodeComment(data) {
  if (!data || data.length < 5) return '';
  const enc = data[0];
  const rest = data.subarray(4); // po 3 písmenech jazyka
  if (enc === 1 || enc === 2) {
    const term = enc === 1 ? [0, 0] : [0, 0];
    let i = 0;
    while (i + 1 < rest.length && !(rest[i] === term[0] && rest[i + 1] === term[1])) i += 2;
    return decodeText(rest.subarray(Math.min(i + 2, rest.length - 1)));
  }
  let i = 0;
  while (i < rest.length && rest[i] !== 0) i++;
  return decodeText(rest.subarray(Math.min(i + 1, rest.length)));
}

/* --------------------------------- ID3 ----------------------------------- */

const ID3_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop',
  'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game',
  'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial',
  'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz',
  'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock', 'Folk', 'Folk-Rock', 'National Folk',
  'Swing', 'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass', 'Avantgarde',
  'Gothic Rock', 'Progressive Rock', 'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band',
  'Chorus', 'Easy Listening', 'Acoustic', 'Humour', 'Speech', 'Chanson', 'Opera', 'Chamber Music',
  'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam', 'Club',
  ' Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle', 'Duet',
  'Punk Rock', 'Drum Solo', 'A capella', 'Euro-House', 'Dance Hall', 'Drum & Bass', 'Club-House',
  'Hardcore', 'Terror', 'Indie', 'BritPop', 'Negerpunk', 'Polsk Punk', 'Beat',
  'Christian Gangsta Rap', 'Heavy Metal', 'Black Metal', 'Crossover', 'Contemporary Christian',
  'Christian Rock', 'Merengue', 'Salsa', 'Thrash Metal', 'Anime', 'JPop', 'SynthPop',
];

function readId3v2(bytes) {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 20) return null;
  const version = bytes[3];
  const flags = bytes[5];
  const tagSize = syncsafe(bytes, 6);
  let offset = 10;
  const end = Math.min(10 + tagSize, bytes.length);
  if (flags & 0x40) offset += syncsafe(bytes, 10); // extended header

  const textFrames = new Map();
  const comments = [];
  while (offset + 10 <= end) {
    if (bytes[offset] === 0) break;
    const id = ascii(bytes, offset, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version >= 4 ? syncsafe(bytes, offset + 4) : u32be(bytes, offset + 4);
    if (size <= 0 || offset + 10 + size > end) break;
    const data = bytes.subarray(offset + 10, offset + 10 + size);
    if (id === 'COMM') comments.push(decodeComment(data));
    else if (id[0] === 'T') textFrames.set(id, decodeText(data));
    else if (id === 'POPM') {
      const pop = { rating: data.length > 1 ? data[1] : 0 };
      textFrames.set('POPM', pop);
    }
    offset += 10 + size;
  }
  return { version, textFrames, comments };
}

function readId3v1(bytes) {
  if (bytes.length < 128) return null;
  const tail = bytes.subarray(bytes.length - 128);
  if (ascii(tail, 0, 3) !== 'TAG') return null;
  const cut = (o, len) => decodeText(new Uint8Array([0, ...tail.subarray(o, o + len)])).replace(/\0+$/, '').trim();
  return {
    title: cut(3, 30),
    artist: cut(33, 30),
    album: cut(63, 30),
    year: cut(93, 4),
    comments: cut(97, 30),
    genre: ID3_GENRES[tail[127]] || '',
  };
}

/* --------------------------------- FLAC ---------------------------------- */

function readVorbisComments(data, base, out) {
  let o = base;
  const vendorLen = u32le(data, o);
  o += 4 + vendorLen;
  const count = u32le(data, o);
  o += 4;
  for (let i = 0; i < count && o + 4 <= data.length; i++) {
    const len = u32le(data, o);
    o += 4;
    if (o + len > data.length) break;
    const text = new TextDecoder('utf-8').decode(data.subarray(o, o + len));
    o += len;
    const eq = text.indexOf('=');
    if (eq <= 0) continue;
    const key = text.slice(0, eq).toUpperCase();
    const value = text.slice(eq + 1);
    if (!out[key]) out[key] = value;
  }
}

function readFlac(bytes) {
  if (ascii(bytes, 0, 4) !== 'fLaC') return null;
  const fields = {};
  let o = 4;
  let last = false;
  let guard = 0;
  while (!last && o + 4 <= bytes.length && guard++ < 100) {
    const head = bytes[o];
    last = Boolean(head & 0x80);
    const type = head & 0x7f;
    const len = u24be(bytes, o + 1);
    if (type === 4) readVorbisComments(bytes, o + 4, fields);
    o += 4 + len;
}
  return { fields };
}

/* --------------------------------- M4A ----------------------------------- */

const M4A_ITEM_MAP = {
  '©nam': 'title', '©ART': 'artist', '©alb': 'album', '©gen': 'genre', 'gnre': 'genreId',
  '©cmt': 'comments', '©day': 'year', 'desc': 'comments',
};

function readAtom(field, data, out) {
  let o = 0;
  while (o + 8 <= data.length) {
    const size = u32be(data, o);
    const type = ascii(data, o + 4, 4);
    if (size < 8 || o + size > data.length) break;
    if (type === 'data' && size > 16) {
      const payload = data.subarray(o + 16, o + size);
      if (field === 'genreId') {
        // gnre = číslo z ID3 žánrové tabulky (u16be)
        const id = payload.length >= 2 ? (payload[0] << 8) | payload[1] : payload[0] || 0;
        if (!out.genre) out.genre = ID3_GENRES[id] || '';
      } else {
        const text = new TextDecoder('utf-8').decode(payload).replace(/\0+$/, '');
        if (text && !out[field]) out[field] = text;
      }
    }
    o += size;
  }
}

function walkAtom(bytes, start, end, sink, depth = 0) {
  let o = start;
  while (o + 8 <= end && depth < 8) {
    let size = u32be(bytes, o);
    const type = ascii(bytes, o + 4, 4);
    let headerSize = 8;
    if (size === 1 && o + 16 <= end) {
      size = Number(new DataView(bytes.buffer, bytes.byteOffset + o + 8, 8).getBigUint64());
      headerSize = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < headerSize || o + size > end + 0) break;
    if (/^(moov|udta|trak|mdia|minf|stbl|ilst|meta)$/.test(type)) {
      const inner = type === 'meta' ? o + headerSize + 4 : o + headerSize; // meta má 4 B flags
      walkAtom(bytes, inner, o + size, sink, depth + 1);
    } else if (M4A_ITEM_MAP[type]) {
      readAtom(M4A_ITEM_MAP[type], bytes.subarray(o + headerSize, o + size), sink);
    }
    o += size;
  }
}

function readM4a(bytes) {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null;
  const out = {};
  walkAtom(bytes, 0, bytes.length, out);
  return out;
}

/* --------------------------------- WAV ----------------------------------- */

function readWav(bytes) {
  if (ascii(bytes, 0, 4) !== 'RIFF') return null;
  const out = {};
  let o = 12;
  const end = Math.min(bytes.length, u32le(bytes, 4) + 8);
  let guard = 0;
  while (o + 8 <= end && guard++ < 256) {
    const id = ascii(bytes, o, 4);
    const size = u32le(bytes, o + 4);
    if (size === 0 || size > bytes.length) break;
    if (id === 'LIST' && ascii(bytes, o + 8, 4) === 'INFO') {
      let s = o + 12;
      while (s + 8 <= o + 8 + size) {
        const sid = ascii(bytes, s, 4);
        const slen = u32le(bytes, s + 4);
        if (slen === 0 || s + 8 + slen > bytes.length) break;
        const text = decodeText(new Uint8Array([0, ...bytes.subarray(s + 8, s + 8 + slen)]))
          .replace(/\0+$/, '').trim();
        const field = { INAM: 'title', IART: 'artist', IPRD: 'album', IGNR: 'genre', ICMT: 'comments', ICRD: 'year' }[sid];
        if (field && text) out[field] = text;
        s += 8 + slen;
      }
    }
    o += 8 + size + (size % 2);
  }
  return out;
}

/* ------------------------------ nápovědy z textu -------------------------- */

/** "01 - Artist_-_Title (320kbps) [www.site.com].mp3" → čistý název. */
export function cleanTrackName(fileName) {
  let name = String(fileName || '');
  const dot = name.lastIndexOf('.');
  if (dot > 0) name = name.slice(0, dot);
  try {
    name = decodeURIComponent(name);
  } catch { /* necháme původní */ }

  // šum z release portálů a uploadů
  name = name
    .replace(/\((?:[^()]{0,60}?)\)/g, (m) => (NOISE_RE.test(m.slice(1, -1)) ? ' ' : m))
    .replace(/\[(?:[^\][]{0,60}?)\]/g, (m) => (NOISE_RE.test(m.slice(1, -1)) ? ' ' : m))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/\([0-9]{2,3}\s?(?:kbps|kbs|kb)\)/gi, ' ')
    .replace(/\s*[-–—]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // číslování: "01 - ", "01.", "01_", "12) "
  name = name.replace(/^[\s(_]*\d{1,3}[\s._\-–—:)]+(?=\D)/, '').trim();

  return name || String(fileName || '').trim();
}

const NOISE_RE =
  /kbps|kbs|\bkb\b|bit\s*rate|download|www\.|https?:|\br(?:ip|x)\b|\blossless\b|\bflac\b|\bmp3\b|\bwav\b|\bpromo\b|\bfree\b|\bexplicit\b|\bofficial\b(?!.*(video|audio|remix))|\blive\b.*\bset\b|\d{3}\s?k/i;

/** Vytáhne interpreta a název z očištěného názvu souboru. */
export function splitArtistTitle(cleaned) {
  const text = String(cleaned || '').trim();
  const isDash = (part) => /^[-–—_.*]+$/.test(part);
  const parts = text.split(/\s+[-–—]\s+|_+| \|\| | \/ /).map((p) => p.trim()).filter((p) => p.length);
  const meaningful = parts.filter((p, i) => i === 0 || !isDash(p));
  if (meaningful.length >= 2) {
    const artist = meaningful[0].replace(/^[-–—\s]+/, '').replace(/[-–—\s]+$/, '').trim();
    const title = meaningful
      .slice(1)
      .join(' - ')
      .replace(/^[-–—\s]+/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (artist && title) return { artist, title };
  }
  return { artist: '', title: text };
}

/** Nápovědy z textu: BPM, klíč, žánr. */
export function hintsFromText(text) {
  const raw = String(text || '');
  const out = { bpm: null, key: null, genre: null };
  const bpmExplicit = /(\d{2,3}(?:[.,]\d)?)\s?bpm/i.exec(raw);
  const bpmWrapped = /[([]\s*(\d{2,3}(?:[.,]\d)?)\s*[)\]]/.exec(raw);
  const bpmMatch = bpmExplicit || bpmWrapped;
  if (bpmMatch) {
    const value = Number(bpmMatch[1].replace(',', '.'));
    if (value >= 50 && value <= 300) out.bpm = Math.round(value * 10) / 10;
  }

  const camelot = /(?:^|[\s(\[/_|\-–—])((?:1[0-2]|[1-9])\s?[ABab])(?=$|[\s)\]])/.exec(raw);
  if (camelot) {
    const c = camelot[1].replace(/\s+/g, '').toUpperCase();
    out.key = c;
    return out;
  }
  const musical = /(?:^|[\s(\[/_|\-–—])([A-G][#♯b♭]?(?:m|min|maj|M|major|minor))(?=$|[\s)\]])/.exec(raw);
  if (musical) {
    out.key = musical[1].replace('♯', '#').replace('♭', 'b');
    return out;
  }
  out.genre = guessGenre(raw);
  return out;
}

const GENRE_PATTERNS = [
  ['Neurofunk', /neurofunk|\bneuro\b|techstep|crossbreed|darkstep/i],
  ['Jump Up', /jump[\s\-_]?up/i],
  ['Halftime', /half[\s\-_]?time/i],
  ['Rollers', /rollers?|rolling/i],
  ['Liquid Drum & Bass', /liquid[\s\-_]?(?:dnb|drum|bass|funk)/i],
  ['Jungle', /jungle|ragga|oldskool/i],
  ['Drum & Bass', /\bdnb\b|d\s*&\s*b|drum\s*(?:and|&)\s*bass/i],
  ['Dubstep', /dubstep|riddim|brostep/i],
  ['Hardstyle', /hardstyle|rawstyle|happy\s*hardcore/i],
  ['Hardcore', /hardcore|gabber|uptempo|hakken/i],
  ['Techno', /techno|\bminimal\b|\bmelodic\b/],
  ['House', /\bhouse\b|deep[\s\-_]?house|tech[\s\-_]?house|afro|disco/i],
  ['Trance', /trance|psytrance/i],
  ['Garage', /garage|\bug\b|breaks?\b/i],
  ['Hip-Hop', /hip[\s\-_]?hop|\brap\b|\btrap\b|grime/i],
  ['Reggaeton', /reggaeton|dembow/i],
  ['Lo-Fi', /lofi|lo[\s\-_]?fi|chillhop/i],
  ['Ambient', /ambient|downtempo|cinematic/i],
  ['Funk / Disco', /funk|disco|nu\s*disco/i],
];

export function guessGenre(text) {
  // Oddělovače z názvů souborů (jump_up, neuro-funk…) bereme jako mezery, aby \b fungovalo.
  const raw = String(text || '').replace(/[_\-.+|]+/g, ' ');
  for (const [label, pattern] of GENRE_PATTERNS) {
    if (pattern.test(raw)) return label;
  }
  return null;
}

/* ------------------------------- hlavní čtení ----------------------------- */

/**
 * Přečte všechna dostupná metadata ze souboru (tagy + nápovědy z názvu).
 * @param {File|{name:string}} file
 * @returns {Promise<Object>} { artist, title, album, genre, year, comments, rating, bpm, key, tagSource }
 */
export async function readTrackFile(file) {
  const bytes = await readFileBytes(file);
  const base = {
    fileName: file.name,
    artist: '',
    title: '',
    album: '',
    genre: '',
    year: null,
    comments: '',
    rating: 0,
    bpm: null,
    key: '',
    tagSource: null,
  };

  // 1) tagy podle formátu
  let tags = null;
  if (ascii(bytes, 0, 3) === 'ID3') {
    const v2 = readId3v2(bytes);
    const f = (v2 && v2.textFrames) || new Map();
    const popm = f.get('POPM');
    tags = {
      title: f.get('TIT2') || '',
      artist: f.get('TPE1') || f.get('TPE2') || f.get('TPE3') || '',
      album: f.get('TALB') || '',
      genre: stripId3Genre(f.get('TCON') || ''),
      year: (f.get('TDRC') || f.get('TYER') || '').match(/\d{4}/)?.[0] || null,
      comments: [f.get('TCOM'), ...(v2.comments || [])].filter(Boolean).join('; '),
      bpm: numberOrNull(f.get('TBPM')),
      key: (f.get('TKEY') || '').trim(),
      rating: popm ? starsFromPopm(popm.rating) : 0,
      trackNumber: f.get('TRCK') || '',
      tagSource: 'ID3v2',
    };
    if (!tags.title && !tags.artist) {
      const v1 = readId3v1(bytes);
      if (v1 && (v1.title || v1.artist)) {
        tags = { ...v1, bpm: null, key: '', rating: 0, tagSource: 'ID3v1', comments: v1.comments };
      }
    }
  } else if (ascii(bytes, 0, 4) === 'fLaC') {
    const { fields } = readFlac(bytes);
    tags = {
      title: fields.TITLE || '',
      artist: fields.ARTIST || fields.ALBUMARTIST || '',
      album: fields.ALBUM || '',
      genre: fields.GENRE || '',
      year: (fields.DATE || fields.YEAR || '').match(/\d{4}/)?.[0] || null,
      comments: [fields.COMMENT, fields.DESCRIPTION].filter(Boolean).join('; '),
      bpm: numberOrNull(fields.BPM || fields.BPM_),
      key: (fields.KEY || fields.INITIALKEY || '').trim(),
      rating: Number(fields.RATING) || 0,
      tagSource: 'Vorbis comment',
    };
  } else if (bytes.length > 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const f = readM4a(bytes) || {};
    tags = {
      title: f.title || '',
      artist: f.artist || '',
      album: f.album || '',
      genre: f.genre || '',
      year: (f.year || '').match(/\d{4}/)?.[0] || null,
      comments: f.comments || '',
      bpm: numberOrNull(f.bpm),
      key: (f.key || '').trim(),
      rating: 0,
      tagSource: 'QuickTime ilst',
    };
  } else if (ascii(bytes, 0, 4) === 'RIFF') {
    const f = readWav(bytes) || {};
    tags = {
      title: f.title || '', artist: f.artist || '', album: f.album || '', genre: f.genre || '',
      year: (f.year || '').match(/\d{4}/)?.[0] || null, comments: f.comments || '',
      bpm: null, key: '', rating: 0, tagSource: 'RIFF INFO',
    };
  } else {
    // OGG/APE/WMA – tagy tady nečteme, spolehneme se na název
    const v1 = readId3v1(bytes);
    if (v1) tags = { ...v1, title: v1.title, bpm: null, key: '', rating: 0, tagSource: 'ID3v1' };
  }

  const cleaned = cleanTrackName(file.name);
  const nameHints = hintsFromText(cleaned);
  const fromName = splitArtistTitle(cleaned);

  const result = {
    ...base,
    artist: (tags && tags.artist) || fromName.artist,
    title: (tags && tags.title) || fromName.title,
    album: (tags && tags.album) || '',
    genre: (tags && tags.genre) || nameHints.genre || '',
    year: (tags && tags.year) || null,
    comments: (tags && tags.comments) || '',
    rating: (tags && tags.rating) || 0,
    // BPM/klíč: tagy mají přednost, název je záloha
    bpm: (tags && tags.bpm) || nameHints.bpm,
    key: (tags && tags.key) || (nameHints.key ? normalizeKeyText(nameHints.key) : ''),
    tagSource: tags ? tags.tagSource : 'název souboru',
    hadTags: Boolean(tags),
    cleanedName: cleaned,
  };
  if (!result.title) result.title = cleaned;
  if (!result.genre) result.genre = guessGenre(result.cleanedName) || '';
  return result;
}

function numberOrNull(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripId3Genre(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  // v2.4: slovní žánr; v2.3 často "(17)" nebo "(17) Drum & Bass"
  const numeric = /^\((\d{1,3})\)/.exec(text) || /^\s*\d{1,3}$/.exec(text);
  if (numeric) {
    const id = Number((numeric[1] || numeric[0]).replace(/\D/g, ''));
    return ID3_GENRES[id] || (text.match(/\)\s*(.+)$/) ? text.match(/\)\s*(.+)$/)[1].trim() : '');
  }
  return text;
}

function starsFromPopm(rating) {
  const r = Number(rating) || 0;
  if (r >= 248) return 5;
  if (r >= 196) return 4;
  if (r >= 128) return 3;
  if (r >= 64) return 2;
  if (r > 0) return 1;
  return 0;
}

function normalizeKeyText(key) {
  return String(key || '').replace(/\s+/g, '').replace('♯', '#').trim();
}