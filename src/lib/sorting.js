/**
 * Řazení kolekce – robustní sloupce i chytré režimy pro DJingu.
 *
 * Běžné řazení podle sloupce musí zvládnout chybějící hodnoty (BPM bez čísla,
 * klíč bez zápisu) a české názvy. Chytré režimy jdou dál:
 *  - harmonic: projede Camelot wheel od nejklidnějšího klíče, takže sousedi sedí
 *  - energyUp/energyDown: energetická rampa nahoru (gradace) nebo dolů (after)
 *  - quality: nejlepší tracky první (hodnocení → energie → tempo)
 *  - smooth: řetězí tracky podle skóra přechodu (greedy, začne u nejklidnějšího)
 * Každý režim umí popsat, proč tracky skončily kde skončily, a zhodnotit
 * výsledné pořadí (průměrná shoda přechodů + nejhorší místa).
 */
import { scorePair } from './score.js';
import { normalizeText } from './features.js';

export const SORT_MODES = {
  artist: 'Interpret (A–Z)',
  name: 'Název (A–Z)',
  bpm: 'Tempo (BPM)',
  key: 'Klíč (Camelot)',
  energy: 'Energie',
  rating: 'Hodnocení',
  time: 'Délka',
  genre: 'Žánr',
  label: 'Label',
  year: 'Rok vydání',
  added: 'Datum přidání',
  harmonic: 'Harmonické pořadí (Camelot wheel)',
  energyUp: 'Energetická rampa ↑ (gradace)',
  energyDown: 'Energetická rampa ↓ (after / chillout)',
  quality: 'Nejlepší první (hodnocení → energie)',
  smooth: 'Plynulý mix (řetězec skóra přechodů)',
};

const TEXT = new Intl.Collator('cs');

const isNumber = (value) => Number.isFinite(value);

/** Klíč se bere jako Camelot číslo, aby 8A sedělo vedle 9A a ne vedle 1A. */
function keySortValue(track) {
  const parsed = track.keyParsed;
  if (!parsed || !isNumber(parsed.number)) return null;
  // A (moll) před B (dur) ve stejném čísle, čísla po kruhu od 1
  return parsed.number * 2 + (parsed.letter === 'B' ? 1 : 0);
}

function dateSortValue(track, field) {
  const raw = track[field];
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : null;
}

/**
 * Srovnávací funkce pro sloupce. Vrací fn(a, b, dir), kde dir je 1/-1.
 * Chybějící hodnoty vždy na konec (ať roste nebo klesá), texty po česky.
 */
const COMPARATORS = {
  artist: (a, b, dir) => dir * TEXT.compare(normalizeText(a.artist), normalizeText(b.artist)),
  name: (a, b, dir) => dir * TEXT.compare(normalizeText(a.name), normalizeText(b.name)),
  genre: (a, b, dir) => dir * TEXT.compare(normalizeText(a.genre), normalizeText(b.genre)),
  label: (a, b, dir) => dir * TEXT.compare(normalizeText(a.label), normalizeText(b.label)),
  bpm: (a, b, dir) => dir * ((a.bpm || 0) - (b.bpm || 0)),
  energy: (a, b, dir) => dir * (((a.features || {}).energy || 0) - ((b.features || {}).energy || 0)),
  rating: (a, b, dir) => dir * ((a.rating || 0) - (b.rating || 0)),
  time: (a, b, dir) => dir * ((a.totalTime || 0) - (b.totalTime || 0)),
  key: (a, b, dir) => {
    const ka = keySortValue(a);
    const kb = keySortValue(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1; // bez klíče vždycky nakonec
    if (kb == null) return -1;
    return dir * (ka - kb);
  },
  year: (a, b, dir) => dir * ((Number(a.year) || 0) - (Number(b.year) || 0)),
  added: (a, b, dir) => {
    const da = dateSortValue(a, 'dateAdded');
    const db = dateSortValue(b, 'dateAdded');
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return dir * (da - db);
  },
};

/** Náhodné (ale deterministické) pořadí pro režim „zamíchat“. */
function shuffle(list, seed = 7) {
  const out = list.slice();
  let state = (Number(seed) || 7) >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sloupcové řazení: bere { column, direction } jako v UI. Neznámý sloupec → interpret.
 * Sekundární klíč je vždy název, aby se pořadí u stejných hodnot nepromíchávalo.
 */
export function sortTracks(tracks, sort = {}) {
  const column = COMPARATORS[sort.column] ? sort.column : 'artist';
  const dir = sort.direction === 'desc' ? -1 : 1;
  const compare = COMPARATORS[column];
  return tracks
    .slice()
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const primary = compare(a.track, b.track, dir);
      if (primary !== 0) return primary;
      const byName = TEXT.compare(normalizeText(a.track.name), normalizeText(b.track.name));
      return byName !== 0 ? byName : a.index - b.index;
    })
    .map((entry) => entry.track);
}

/* ----------------------------- chytré režimy ------------------------------ */

function energyOf(track) {
  return Number.isFinite((track.features || {}).energy) ? track.features.energy : 50;
}

/**
 * Harmonické pořadí: projede Camelot wheel po číslech (1→12), uvnitř čísla
 * nejdřív moll (A) pak dur (B), takže sousedící tracky jsou vždy mixovatelné.
 * Začíná se u klíče s nejvyšším počtem tracků, aby se kolekce nerozpadla na dva půlky.
 */
export function harmonicOrder(tracks) {
  const withKey = tracks.filter((t) => t.keyParsed && isNumber(t.keyParsed.number));
  const withoutKey = tracks.filter((t) => !(t.keyParsed && isNumber(t.keyParsed.number)));
  if (!withKey.length) return tracks.slice();

  const counts = new Map();
  for (const track of withKey) {
    const { number, letter } = track.keyParsed;
    const slot = letter === 'B' ? number * 2 : number * 2 - 1;
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }
  const startSlot = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  const slotOf = (track) => {
    const { number, letter } = track.keyParsed;
    return letter === 'B' ? number * 2 : number * 2 - 1;
  };
  const ordered = withKey
    .slice()
    .map((track, index) => ({ track, index, slot: slotOf(track) }))
    .sort((a, b) => {
      // vzdálenost od startu po kruhu (24 položek: 12 čísel × A/B)
      const pa = (((a.slot - startSlot) % 24) + 24) % 24;
      const pb = (((b.slot - startSlot) % 24) + 24) % 24;
      if (pa !== pb) return pa - pb;
      const byEnergy = energyOf(a.track) - energyOf(b.track);
      return byEnergy !== 0 ? byEnergy : a.index - b.index;
    })
    .map((entry) => entry.track);
  // Bez klíče jdou na konec (stejně je nikam harmonicky nezařadíš)
  return [...ordered, ...withoutKey];
}

/** Energetická rampa: řadí podle energie, uvnitř stejné energie podle BPM. */
export function energyRamp(tracks, direction = 'up') {
  const dir = direction === 'down' ? -1 : 1;
  return tracks
    .slice()
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const ea = energyOf(a.track);
      const eb = energyOf(b.track);
      if (ea !== eb) return dir * (ea - eb);
      const ba = a.track.bpm || 0;
      const bb = b.track.bpm || 0;
      if (ba !== bb) return ba - bb;
      return a.index - b.index;
    })
    .map((entry) => entry.track);
}

/** Nejlepší první: hodnocení → energie → tempo (sestupně). */
export function qualityOrder(tracks) {
  return tracks
    .slice()
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      const ra = a.track.rating || 0;
      const rb = b.track.rating || 0;
      if (ra !== rb) return rb - ra;
      const ea = energyOf(a.track);
      const eb = energyOf(b.track);
      if (ea !== eb) return eb - ea;
      return (b.track.bpm || 0) - (a.track.bpm || 0) || a.index - b.index;
    })
    .map((entry) => entry.track);
}

/**
 * Plynulý mix: greedy řetězec podle skóra přechodu. Začíná u nejklidnějšího
 * tracku (rozjezd setu), postupně přidává nejlíp navazující track.
 * `maxTracks` omezuje výpočet na rozumný čas u velkých kolekcí.
 */
export function smoothChain(tracks, weights, options = {}, maxTracks = 400) {
  const pool = tracks.length > maxTracks ? tracks.slice(0, maxTracks) : tracks.slice();
  if (pool.length < 3) return pool;
  let cursor = pool.reduce((lowest, t) => (energyOf(t) < energyOf(lowest) ? t : lowest), pool[0]);
  const ordered = [cursor];
  const remaining = new Set(pool.filter((t) => t !== cursor));
  while (remaining.size) {
    let best = null;
    let bestValue = -Infinity;
    for (const candidate of remaining) {
      const result = scorePair(cursor, candidate, weights, options);
      // skóre + malá odměna za plynulou energii, tvrdé kolize trestáme
      const penalty = result.hardFail ? 1 : 0;
      const value = result.score * 0.85 + (1 - Math.abs(energyOf(candidate) - energyOf(cursor)) / 100) * 0.15 - penalty;
      if (value > bestValue) {
        bestValue = value;
        best = candidate;
      }
    }
    ordered.push(best);
    remaining.delete(best);
    cursor = best;
  }
  // Tracky mimo omezený pořadí doplníme nakonec, ať se neztratí
  const used = new Set(ordered);
  return [...ordered, ...tracks.filter((t) => !used.has(t))];
}

/**
 * Vyhodnotí kvalitu pořadí: průměrná shoda přechodů + nejhorší místa.
 * Vrací { average, transitions, problems } (problems jsou indexy výměn).
 */
export function orderQuality(tracks, weights, options = {}) {
  let sum = 0;
  let transitions = 0;
  const problems = [];
  for (let i = 1; i < tracks.length; i++) {
    const result = scorePair(tracks[i - 1], tracks[i], weights, options);
    const value = result.score * 0.85 + (1 - Math.abs(energyOf(tracks[i]) - energyOf(tracks[i - 1])) / 100) * 0.15;
    sum += result.hardFail ? 0 : value;
    transitions++;
    if (result.hardFail || result.score < 0.5) {
      problems.push({ index: i, score: result.score, reason: result.failReason || 'nízká shoda', hardFail: result.hardFail });
    }
  }
  return { average: transitions ? sum / transitions : 1, transitions, problems };
}

/**
 * Aplikuje chytrý režim na tracky. Vrací nové pole (puvodní se nemění).
 */
export function applySmartSort(tracks, mode, settings = {}) {
  const weights = settings.weights;
  const options = settings.options || {};
  switch (mode) {
    case 'harmonic':
      return harmonicOrder(tracks);
    case 'energyUp':
      return energyRamp(tracks, 'up');
    case 'energyDown':
      return energyRamp(tracks, 'down');
    case 'quality':
      return qualityOrder(tracks);
    case 'smooth':
      return smoothChain(tracks, weights, options, settings.maxChainTracks || 400);
    case 'shuffle':
      return shuffle(tracks, settings.randomSeed);
    default:
      return sortTracks(tracks, { column: mode, direction: 'asc' });
  }
}

/** Popisek režimu pro UI (hlavičku tabulky / toast). */
export function sortModeLabel(mode) {
  return SORT_MODES[mode] || SORT_MODES.artist;
}
