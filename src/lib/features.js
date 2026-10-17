/**
 * Odvozené vlastnosti tracku: energie, tagy, žánr, percentily BPM.
 *
 * rekordbox v XML neexportuje "energii", takže ji odhadujeme z toho, co k dispozici je:
 *  1) explicitní energie v komentáři ("energy 7", "E:8", "#peak")
 *  2) hodnocení (rating = hvězdičky, rekordbox ho exportuje jako 0–255)
 *  3) percentil BPM v rámci kolekce (rychlejší track = obvykle více energie)
 * Cokoli z toho jde v aplikaci ručně přepsat.
 */

import { parseKey } from './keys.js';

export function normalizeText(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const VIBE_ENERGY = {
  chill: 20,
  lounge: 25,
  deep: 30,
  warmup: 30,
  'warm up': 30,
  melodic: 45,
  groove: 50,
  rolling: 55,
  peak: 85,
  'peak time': 85,
  peaktime: 85,
  mainstage: 95,
  banger: 95,
  hard: 90,
  dark: 70,
  trippy: 70,
  closing: 40,
  after: 45,
};

/** Rozseká komentář na tagy (oddělovače , ; | / a #tagy). */
export function parseTags(comments) {
  const raw = String(comments == null ? '' : comments);
  const parts = raw
    .split(/[,;|/\n]+|\s#/)
    .map((p) => p.replace(/^#+/, '').trim())
    .filter((p) => p.length > 1 && p.length < 40);
  const out = [];
  for (const p of parts) {
    const norm = normalizeText(p);
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out.slice(0, 16);
}

/** Zkusí najít číslo energie (0–10) v komentáři. */
export function parseEnergyTag(comments) {
  const text = normalizeText(comments);
  if (!text) return null;
  const direct = /(?:energy|energie|nrg|intenzita)\s*[:=]?\s*(\d{1,2})(?:\s*\/\s*10)?/.exec(text);
  if (direct) {
    const value = Number(direct[1]);
    if (value >= 0 && value <= 10) return value;
    if (value > 10 && value <= 100) return Math.round(value / 10);
  }
  const short = /(?:^|\s)e\s*[:=]?\s*(\d{1,2})(?:\s*\/\s*10)?(?:\s|$)/.exec(text);
  if (short) {
    const value = Number(short[1]);
    if (value >= 0 && value <= 10) return value;
  }
  // vibe slova v komentáři
  for (const [word, energy] of Object.entries(VIBE_ENERGY)) {
    if (text.includes(word)) return Math.round(energy / 10);
  }
  return null;
}

/** rekordbox rating v XML je 0–255 (0, 51, 102, 153, 204, 255). */
export function ratingToStars(rating) {
  const value = Number(rating) || 0;
  if (value <= 0) return 0;
  return Math.max(0, Math.min(5, Math.round(value / 51)));
}

const STARS_TO_ENERGY = [0, 25, 45, 65, 85, 100];

export function starsToEnergy(stars) {
  return STARS_TO_ENERGY[Math.max(0, Math.min(5, Math.round(stars || 0)))];
}

function percentile(values, value) {
  if (!values.length) return null;
  let below = 0;
  for (const v of values) if (v < value) below++;
  return below / values.length;
}

/**
 * Doplní každému tracku `features` (bpm, klíč, energie, tagy, styl, percentily).
 * @param {Array} tracks výstup z parseRekordboxXml
 * @param {Object} [options] { energyOverrides: { [trackId]: 0..100 } }
 */
export function buildFeatures(tracks, options = {}) {
  const overrides = options.energyOverrides || {};
  const bpms = tracks.map((t) => t.bpm).filter((b) => Number.isFinite(b) && b > 0).sort((a, b) => a - b);
  const byGenre = new Map();
  for (const t of tracks) {
    const genre = normalizeText(t.genre) || 'neuvedeno';
    if (!byGenre.has(genre)) byGenre.set(genre, []);
    if (Number.isFinite(t.bpm) && t.bpm > 0) byGenre.get(genre).push(t.bpm);
  }
  for (const [, list] of byGenre) list.sort((a, b) => a - b);

  const durationAvg = (() => {
    const times = tracks.map((t) => t.totalTime).filter((s) => Number.isFinite(s) && s > 0);
    if (!times.length) return 360;
    return times.reduce((a, b) => a + b, 0) / times.length;
  })();

  for (const track of tracks) {
    track.artistKey = normalizeText(track.artist);
    if (!track.keyParsed) track.keyParsed = parseKey(track.key);
    const tags = parseTags(track.comments);
    const energyTag = parseEnergyTag(track.comments);
    const stars = ratingToStars(track.rating);
    const bpmPct = Number.isFinite(track.bpm) && track.bpm > 0 ? percentile(bpms, track.bpm) : null;
    const genre = normalizeText(track.genre) || 'neuvedeno';
    const genreBpms = byGenre.get(genre) || [];
    const genrePct =
      Number.isFinite(track.bpm) && track.bpm > 0 && genreBpms.length > 1
        ? percentile(genreBpms, track.bpm)
        : bpmPct;

    const parts = [];
    if (energyTag != null) parts.push({ value: energyTag * 10, weight: 3 });
    if (stars > 0) parts.push({ value: starsToEnergy(stars), weight: 2 });
    if (genrePct != null) parts.push({ value: 20 + genrePct * 65, weight: 1.2 });
    else if (bpmPct != null) parts.push({ value: 20 + bpmPct * 65, weight: 0.8 });

    let energy = 50;
    if (parts.length) {
      const wsum = parts.reduce((a, p) => a + p.weight, 0);
      energy = parts.reduce((a, p) => a + p.value * p.weight, 0) / wsum;
    }
    const override = overrides[track.id] ?? overrides[String(track.id)];
    if (Number.isFinite(Number(override))) energy = Number(override);

    track.features = {
      artistKey: track.artistKey,
      bpm: Number.isFinite(track.bpm) ? track.bpm : null,
      key: track.key,
      keyParsed: track.keyParsed,
      genre,
      tags,
      energyTag,
      stars,
      energy: Math.round(Math.max(0, Math.min(100, energy))),
      energyManual: Number.isFinite(Number(override)),
      bpmPercentile: bpmPct,
      genrePercentile: genrePct,
    };
  }

  return { tracks, stats: computeCollectionStats(tracks, durationAvg) };
}

export function computeCollectionStats(tracks, durationAvg) {
  const bpms = tracks.map((t) => t.bpm).filter((b) => Number.isFinite(b) && b > 0);
  const keys = new Map();
  const genres = new Map();
  let duration = 0;
  let withBpm = 0;
  let withKey = 0;
  let rated = 0;
  for (const t of tracks) {
    if (Number.isFinite(t.bpm) && t.bpm > 0) withBpm++;
    if (t.keyParsed && t.keyParsed.camelot) withKey++;
    if (t.features && t.features.stars > 0) rated++;
    if (Number.isFinite(t.totalTime)) duration += t.totalTime;
    if (t.keyParsed && t.keyParsed.camelot) keys.set(t.keyParsed.camelot, (keys.get(t.keyParsed.camelot) || 0) + 1);
    const genre = normalizeText(t.genre) || 'neuvedeno';
    genres.set(genre, (genres.get(genre) || 0) + 1);
  }
  return {
    count: tracks.length,
    withBpm,
    withKey,
    rated,
    bpms: bpms.length
      ? {
          min: Math.round(Math.min(...bpms) * 10) / 10,
          max: Math.round(Math.max(...bpms) * 10) / 10,
          avg: Math.round((bpms.reduce((a, b) => a + b, 0) / bpms.length) * 10) / 10,
        }
      : null,
    durationTotal: duration,
    durationAvg: durationAvg || 360,
    keys: [...keys.entries()].sort((a, b) => b[1] - a[1]),
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]),
  };
}
