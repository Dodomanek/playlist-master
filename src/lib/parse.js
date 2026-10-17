/**
 * Čtení a zápis rekordbox XML (formát DJ_PLAYLISTS).
 *
 * Aplikace nikdy nesahá do master.db, pracuje s XML exportem – je to oficiální
 * obousměrný most rekordboxu a nedá se v něm nic rozbít.
 */
import { attrString, childNodes, decodeEntities, escapeXml, findAll, firstChild, indent, parseXml } from './xml.js';
import { parseKey } from './keys.js';

export const XML_VERSION = '1.0.0';

/** Pořadí atributů, které píšeme u tracku (rekordbox je zvládá v libovolném pořadí). */
const TRACK_ATTR_ORDER = [
  'TrackID',
  'Name',
  'Artist',
  'Composer',
  'Album',
  'Grouping',
  'Genre',
  'Kind',
  'Size',
  'TotalTime',
  'DiscNumber',
  'TrackNumber',
  'Year',
  'AverageBpm',
  'DateAdded',
  'BitRate',
  'SampleRate',
  'Comments',
  'PlayCount',
  'Rating',
  'Location',
  'Remixer',
  'Tonality',
  'Label',
  'Mix',
];

/** `file://localhost/C:/Music/a.mp3` → `C:/Music/a.mp3` */
export function locationToPath(location) {
  let path = String(location || '').replace(/^file:\/\/[^/]*/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    /* ponecháme původní */
  }
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return path;
}

export function pathToLocation(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  return `file://localhost/${encodeURI(normalized).replace(/#/g, '%23')}`;
}

function parseTrack(node) {
  const a = node.attrs;
  const num = (key) => {
    const value = Number(a[key]);
    return Number.isFinite(value) ? value : null;
  };
  const tempoNode = firstChild(node, 'TEMPO');
  const bpm = num('AverageBpm') ?? (tempoNode ? Number(tempoNode.attrs.Bpm) : null);
  const key = a.Tonality || '';
  return {
    id: Number(a.TrackID),
    name: a.Name || '',
    artist: a.Artist || '',
    artistKey: '',
    composer: a.Composer || '',
    album: a.Album || '',
    grouping: a.Grouping || '',
    genre: a.Genre || '',
    kind: a.Kind || '',
    size: num('Size'),
    totalTime: num('TotalTime') || 0,
    discNumber: num('DiscNumber'),
    trackNumber: num('TrackNumber'),
    year: a.Year ? Number(a.Year) || a.Year : null,
    bpm: Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 100) / 100 : null,
    dateAdded: a.DateAdded || '',
    bitRate: num('BitRate'),
    sampleRate: num('SampleRate'),
    comments: a.Comments || '',
    playCount: num('PlayCount') || 0,
    rating: num('Rating') || 0,
    location: a.Location || '',
    path: locationToPath(a.Location || ''),
    remixer: a.Remixer || '',
    key,
    keyParsed: parseKey(key),
    label: a.Label || '',
    mix: a.Mix || '',
    cueCount: findAll(node, 'POSITION_MARK').length,
    // Původní atributy + potomky držíme kvůli věrnému zápisu zpět do XML
    _attrs: { ...a },
    _children: node.children.slice(),
  };
}

function nodeToPlaylist(node, path) {
  const tracks = findAll(node, 'TRACK').map((t) => ({
    trackId: Number(t.attrs.Key),
    key: Number(t.attrs.Key),
  }));
  const subNodes = childNodes(node, 'NODE');
  if (subNodes.length) {
    const folderPath = path.concat(node.attrs.Name || 'Složka');
    return {
      name: node.attrs.Name || 'Složka',
      type: 'folder',
      nodeType: node.attrs.Type,
      path,
      children: subNodes.map((child) => nodeToPlaylist(child, folderPath)),
    };
  }
  return {
    name: node.attrs.Name || 'Playlist',
    type: 'playlist',
    nodeType: node.attrs.Type,
    keyType: node.attrs.KeyType,
    path,
    trackIds: tracks.map((t) => t.trackId).filter((id) => Number.isFinite(id)),
  };
}

export function parseRekordboxXml(text) {
  const doc = parseXml(text);
  const root = doc.children.find((c) => c.name === 'DJ_PLAYLISTS');
  if (!root) {
    throw new Error('Toto není XML z rekordboxu – chybí uzel <DJ_PLAYLISTS>.');
  }
  const productNode = firstChild(root, 'PRODUCT');
  const collectionNode = firstChild(root, 'COLLECTION');
  const tracks = collectionNode ? findAll(collectionNode, 'TRACK').map(parseTrack) : [];

  const playlistsNode = firstChild(root, 'PLAYLISTS');
  let playlistNodes = playlistsNode ? childNodes(playlistsNode, 'NODE') : [];
  // rekordbox obaluje všechno do jediného uzlu ROOT – v aplikaci ho odbalíme
  if (playlistNodes.length === 1 && (playlistNodes[0].attrs.Name || '').toUpperCase() === 'ROOT') {
    playlistNodes = childNodes(playlistNodes[0], 'NODE');
  }

  // Některé nástroje umí vyexportovat jen playlist (bez <COLLECTION>). Když track
  // v playlistu nese vlastní metadata (Name/Location/BPM), dopočítáme ho jako track.
  const knownIds = new Set(tracks.map((t) => Number(t.id)).filter(Number.isFinite));
  let nextSyntheticId = knownIds.size ? Math.max(...knownIds) + 1 : 1;
  const collectPlaylistTracks = (node) => {
    for (const child of node.children || []) {
      if (child.name === 'NODE') {
        collectPlaylistTracks(child);
        continue;
      }
      if (child.name !== 'TRACK') continue;
      const hasMetadata = Boolean(child.attrs.Name || child.attrs.Location || child.attrs.Artist);
      const key = Number(child.attrs.Key);
      const known = Number.isFinite(key) ? knownIds.has(key) : false;
      if (!hasMetadata || known) continue;
      const id = Number.isFinite(key) && key > 0 && !knownIds.has(key) ? key : nextSyntheticId++;
      if (id >= nextSyntheticId) nextSyntheticId = id + 1;
      const attrs = { ...child.attrs, TrackID: String(id) };
      delete attrs.Key;
      const track = parseTrack({ name: 'TRACK', attrs, children: child.children.slice(), text: '' });
      track.synthetic = true;
      tracks.push(track);
      knownIds.add(id);
      // playlist musí odkazovat na stejné ID, jaké jsme tracku právě dali
      child.attrs.Key = String(id);
    }
  };
  for (const node of playlistNodes) collectPlaylistTracks(node);

  const playlists = playlistNodes.map((node) => nodeToPlaylist(node, []));

  if (!tracks.length) {
    const onlyPlaylists = playlistNodes.some((node) => findAll(node, 'TRACK').length > 0);
    if (onlyPlaylists) {
      throw new Error(
        'XML obsahuje jen playlisty bez metadat tracků (chybí <COLLECTION> s názvy, BPM a klíči). ' +
          'Vyexportuj kolekci: File → Export Collection in xml format, nebo použij XML, které tracky obsahuje.',
      );
    }
  }

  return {
    version: root.attrs.Version || XML_VERSION,
    product: {
      name: (productNode && productNode.attrs.Name) || 'rekordbox',
      version: (productNode && productNode.attrs.Version) || '6.0',
      company: (productNode && productNode.attrs.Company) || 'AlphaTheta',
    },
    declaredEntries: collectionNode ? Number(collectionNode.attrs.Entries) || tracks.length : tracks.length,
    tracks,
    playlists,
  };
}

/* ------------------------------- zápis XML ------------------------------- */

function serializeTrack(track, level) {
  const pad = indent(level);
  const attrs = {};
  const source = { ...(track._attrs || {}) };
  const derived = {
    TrackID: track.id,
    Name: track.name,
    Artist: track.artist,
    Genre: track.genre,
    TotalTime: track.totalTime,
    Year: track.year || '',
    AverageBpm: track.bpm != null ? track.bpm.toFixed(2) : '',
    Comments: track.comments,
    Rating: track.rating,
    Location: track.location,
    Tonality: track.key,
    Label: track.label,
  };
  for (const key of TRACK_ATTR_ORDER) {
    if (source[key] !== undefined) attrs[key] = source[key];
    else if (derived[key] !== undefined && derived[key] !== '') attrs[key] = derived[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in attrs)) attrs[key] = value;
  }
  const hasChildren = (track._children || []).length > 0;
  if (!hasChildren) return `${pad}<TRACK${attrString(attrs)}/>`;
  const lines = [`${pad}<TRACK${attrString(attrs)}>`];
  for (const child of track._children) lines.push(serializeNode(child, level + 1));
  lines.push(`${pad}</TRACK>`);
  return lines.join('\n');
}

function serializeNode(node, level) {
  const pad = indent(level);
  const attrs = attrString(node.attrs || {});
  const hasChildren = (node.children || []).length > 0;
  const text = node.text && node.text.trim() ? escapeXml(node.text.trim()) : '';
  if (!hasChildren && !text) return `${pad}<${node.name}${attrs}/>`;
  if (!hasChildren) return `${pad}<${node.name}${attrs}>${text}</${node.name}>`;
  const lines = [`${pad}<${node.name}${attrs}>`];
  for (const child of node.children) lines.push(serializeNode(child, level + 1));
  lines.push(`${pad}</${node.name}>`);
  return lines.join('\n');
}

function serializePlaylistNode(node, level) {
  const pad = indent(level);
  if (node.type === 'folder' || (node.children && node.children.length)) {
    const children = node.children || [];
    const lines = [
      `${pad}<NODE Name="${escapeXml(node.name)}" Type="${node.nodeType || '0'}" Count="${
        node.count != null ? node.count : children.length
      }">`,
    ];
    for (const child of children) lines.push(serializePlaylistNode(child, level + 1));
    lines.push(`${pad}</NODE>`);
    return lines.join('\n');
  }
  const ids = node.trackIds || [];
  const lines = [
    `${pad}<NODE Name="${escapeXml(node.name)}" Type="1" KeyType="${node.keyType || '0'}" Entries="${ids.length}">`,
  ];
  for (const id of ids) lines.push(`${indent(level + 1)}<TRACK Key="${id}"/>`);
  lines.push(`${pad}</NODE>`);
  return lines.join('\n');
}

/**
 * Vytvoří XML ve formátu rekordboxu.
 * @param {Object} data { product, tracks, playlistTree }
 * @param {Object} [options] { collectionName }
 */
export function serializeRekordboxXml(data, options = {}) {
  const product = data.product || { name: 'rekordbox', version: '6.0', company: 'AlphaTheta' };
  const tracks = data.tracks || [];
  const tree = data.playlistTree || [];
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<DJ_PLAYLISTS Version="${options.version || XML_VERSION}">`);
  lines.push(
    `  <PRODUCT Name="${escapeXml(product.name)}" Version="${escapeXml(product.version)}" Company="${escapeXml(
      product.company,
    )}"/>`,
  );
  lines.push(`  <COLLECTION Entries="${tracks.length}">`);
  for (const track of tracks) lines.push(serializeTrack(track, 2));
  lines.push('  </COLLECTION>');
  lines.push('  <PLAYLISTS>');
  lines.push(`    <NODE Type="0" Name="ROOT" Count="${tree.length}">`);
  for (const node of tree) lines.push(serializePlaylistNode(node, 3));
  lines.push('    </NODE>');
  lines.push('  </PLAYLISTS>');
  lines.push('</DJ_PLAYLISTS>');
  return lines.join('\n') + '\n';
}

/** Strom playlistů z naparsovaného souboru (zachová původní playlisty). */
export function playlistTreeFromParsed(parsed) {
  const convert = (node) =>
    node.type === 'folder'
      ? {
          name: node.name,
          type: 'folder',
          nodeType: '0',
          children: (node.children || []).map(convert),
        }
      : { name: node.name, type: 'playlist', nodeType: '1', keyType: '0', trackIds: (node.trackIds || []).slice() };
  return (parsed.playlists || []).map(convert);
}

export function makeFolder(name, children) {
  return { name, type: 'folder', nodeType: '0', count: children.length, children };
}

export function makePlaylist(name, trackIds) {
  return { name, type: 'playlist', nodeType: '1', keyType: '0', trackIds: trackIds.slice() };
}

/* ------------------------------ další exporty ----------------------------- */

export function buildM3u8(playlists) {
  const lines = ['#EXTM3U'];
  for (const playlist of playlists) {
    if (playlist.name) lines.push(`#PLAYLIST:${playlist.name}`);
    for (const track of playlist.tracks || []) {
      const seconds = Math.round(track.totalTime || 0);
      lines.push(`#EXTINF:${seconds},${track.artist ? `${track.artist} - ` : ''}${track.name}`);
      lines.push(track.path || locationToPath(track.location));
    }
  }
  return lines.join('\n') + '\n';
}

export function buildCsv(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const escapeCell = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => escapeCell(row[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Jednoduchý převod textu souboru, kde se můžou objevit entity. */
export function cleanText(value) {
  return decodeEntities(String(value || ''));
}
