/**
 * Rozbor kolekce – co ti řekne, jak je knihovna poskládaná a co v ní chybí.
 *
 * Samotný rekordbox umí jen základní statistiky. Tady počítáme víc:
 *  - BPM pásma (kde se tvoje kolekce reálně pohybuje, ne jen min–max)
 *  - energetické zóny (chill / warm-up / groove / peak)
 *  - pokrytí Camelot wheelu (které klíče máš a které ti chybí)
 *  - duplicity a varianty (Radio Edit vs Club Mix, feat. v názvu…)
 *  - zdraví metadata (co v rekordboxu nedoplněné)
 *  - dekády a nejproduktivnější interpreti
 * Všechno se dá zabalit do `analyzeCollection()` včetně českých insights.
 */
import { normalizeText } from './features.js';
import { parseKey } from './keys.js';

const round1 = (value) => Math.round(value * 10) / 10;

/* ------------------------------- BPM pásma ------------------------------- */

/**
 * Rozseká kolekci do pásem (výchozí 4 BPM). Vrací pásma s počty, dominantní
 * pásmo a pokrytí – abys viděl, jestli máš 174 jen jako ostrov, nebo široký záběr.
 */
export function bpmBands(tracks, bandSize = 4) {
  const size = Number(bandSize) > 0 ? Number(bandSize) : 4;
  const withBpm = tracks.filter((t) => Number.isFinite(t.bpm) && t.bpm > 0);
  if (!withBpm.length) return { bands: [], dominant: null, covered: 0, size };

  const counts = new Map();
  for (const track of withBpm) {
    const from = Math.floor(track.bpm / size) * size;
    counts.set(from, (counts.get(from) || 0) + 1);
  }
  const bands = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, count]) => ({
      from,
      to: round1(from + size),
      count,
      share: count / withBpm.length,
    }));
  const dominant = bands.reduce((best, band) => (band.count > best.count ? band : best), bands[0]);
  return { bands, dominant, covered: bands.length, size };
}

/* ----------------------------- energetické zóny ---------------------------- */

export const ENERGY_ZONES = [
  { key: 'chill', label: 'Chill / after', max: 35 },
  { key: 'warmup', label: 'Warm-up', max: 55 },
  { key: 'groove', label: 'Groove', max: 75 },
  { key: 'peak', label: 'Peak', max: 101 },
];

/** Rozdělení kolekce do energetických zón + průměr/medián/rozptyl. */
export function energyZones(tracks) {
  const values = tracks
    .map((t) => (t.features ? t.features.energy : null))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!values.length) {
    return { zones: ENERGY_ZONES.map((z) => ({ ...z, count: 0, share: 0 })), avg: null, median: null, spread: null };
  }
  const counts = Object.fromEntries(ENERGY_ZONES.map((z) => [z.key, 0]));
  for (const value of values) {
    const zone = ENERGY_ZONES.find((z) => value < z.max) || ENERGY_ZONES[ENERGY_ZONES.length - 1];
    counts[zone.key]++;
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const median = values[Math.floor(values.length / 2)];
  const spread = values[values.length - 1] - values[0];
  return {
    zones: ENERGY_ZONES.map((z) => ({ ...z, count: counts[z.key], share: counts[z.key] / values.length })),
    avg: Math.round(avg),
    median,
    spread,
  };
}

/* ------------------------------ Camelot wheel ------------------------------ */

export const CAMELOT_CELLS = (() => {
  const cells = [];
  for (let number = 1; number <= 12; number++) {
    cells.push(`${number}A`);
    cells.push(`${number}B`);
  }
  return cells;
})();

/** Kolik tracků máš v každém z 24 políček Camelot wheelu + chybějící klíče. */
export function keyWheel(tracks) {
  const counts = Object.fromEntries(CAMELOT_CELLS.map((cell) => [cell, 0]));
  let known = 0;
  for (const track of tracks) {
    const camelot = track.keyParsed && track.keyParsed.camelot;
    if (!camelot || !(camelot in counts)) continue;
    counts[camelot]++;
    known++;
  }
  const top = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([camelot, count]) => ({ camelot, count }));
  const missing = CAMELOT_CELLS.filter((cell) => counts[cell] === 0);
  return { counts, top, missing, known, filled: top.length, total: CAMELOT_CELLS.length };
}

/* --------------------------- duplicity a varianty -------------------------- */

/**
 * Verze názvu („Radio Edit“, „Club Mix“, „VIP“…) – prázdné, když jde o základní mix.
 * Slouží k rozlišení „tutéž nahrávku máš 2×“ od „máš dvě různé verze“.
 */
export function titleVersion(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const match = /[([{]\s*(original mix|radio edit|club mix|extended mix|extended|dub mix|dub|vip|rmx|remix|edit|mix|version|live|instrumental)\s*[)\]}]|[-–—]\s*(radio edit|club mix|extended mix|dub mix|vip|rmx|remix|edit|mix|version)\s*$/.exec(
    text,
  );
  return match ? match[1] || match[2] || '' : '';
}

/**
 * Normalizace názvu pro porovnání: bez diakritiky, feat., verzí a závorek.
 * "Kovasen – Rain (feat. Eva) [Club Mix]" → "kovasen rain".
 */
export function normalizeTitle(value) {
  return normalizeText(value)
    .replace(/\((?:feat|ft|featuring)\b[^)]*\)/g, ' ')
    .replace(/\[(?:feat|ft|featuring)\b[^\]]*\]/g, ' ')
    .replace(
      /[([{]\s*(?:original mix|original|radio edit|club mix|extended mix|extended|dub mix|dub|vip|rmx|remix|edit|mix|version|live|instrumental)\s*[)\]}]/g,
      ' ',
    )
    .replace(/[-–—]\s*(?:original mix|original|radio edit|club mix|extended mix|extended|dub mix|vip|rmx|remix|edit|mix|version)\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Klíč pro hledání duplicit: interpret + základ názvu. */
export function duplicateKey(track) {
  return `${normalizeText(track.artist)}|${normalizeTitle(track.name)}`;
}

/**
 * Najde skupiny, kde jde o tutéž nahrávku:
 *  - `duplicates`: stejný interpret i základ názvu (skutečné dvojice)
 *  - `variants`: stejný základ, ale jiná verze (Radio Edit / Club Mix…)
 */
export function findDuplicates(tracks) {
  const byKey = new Map();
  for (const track of tracks) {
    const key = duplicateKey(track);
    if (!key || key === '|') continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(track);
  }
  const duplicates = [];
  const variants = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    // stejná verze (nebo žádná) = duplicita, různé verze = sada verzí
    const versions = group.map((track) => titleVersion(track.name));
    const entry = { key, tracks: group, versions: [...new Set(versions)] };
    if (new Set(versions).size === 1) duplicates.push(entry);
    else variants.push(entry);
  }
  const bySize = (a, b) => b.tracks.length - a.tracks.length || a.key.localeCompare(b.key);
  duplicates.sort(bySize);
  variants.sort(bySize);
  return {
    duplicates,
    variants,
    duplicateCount: duplicates.reduce((sum, group) => sum + group.tracks.length - 1, 0),
    variantCount: variants.reduce((sum, group) => sum + group.tracks.length - 1, 0),
  };
}

/* ----------------------------- zdraví metadata ----------------------------- */

// Klíč umíme odvodit i z čerstvě parsed tracku (keyParsed ještě nemusí být)
const hasKey = (track) => Boolean((track.keyParsed && track.keyParsed.camelot) || parseKey(track.key).camelot);

export const HEALTH_FIELDS = [
  { key: 'bpm', label: 'BPM', weight: 25, test: (t) => Number.isFinite(t.bpm) && t.bpm > 0 },
  { key: 'key', label: 'Klíč', weight: 25, test: hasKey },
  { key: 'rating', label: 'Hodnocení', weight: 10, test: (t) => Number(t.rating) > 0 },
  { key: 'genre', label: 'Žánr', weight: 10, test: (t) => Boolean(normalizeText(t.genre)) },
  { key: 'year', label: 'Rok', weight: 10, test: (t) => Boolean(t.year) },
  { key: 'label', label: 'Label', weight: 10, test: (t) => Boolean(normalizeText(t.label)) },
  { key: 'comments', label: 'Komentář / tagy', weight: 10, test: (t) => Boolean(normalizeText(t.comments)) },
];

/**
 * Pokrytí klíčových polí a skóre zdraví 0–100 (BPM a klíč váží nejvíc,
 * proto bez nich nejde harmonické mixování).
 */
export function metadataHealth(tracks) {
  const total = tracks.length;
  const coverage = HEALTH_FIELDS.map((field) => {
    const count = tracks.reduce((sum, track) => sum + (field.test(track) ? 1 : 0), 0);
    return { ...field, count, share: total ? count / total : 0 };
  });
  const score = total
    ? Math.round(coverage.reduce((sum, field) => sum + field.share * field.weight, 0))
    : 0;
  const weakest = coverage
    .filter((field) => field.share < 0.9)
    .sort((a, b) => a.share - b.share || b.weight - a.weight);
  return { coverage, score, weakest };
}

/* --------------------------------- dekády --------------------------------- */

/** Počty tracků po dekádách vydání (+ kolik nemá rok). */
export function eraStats(tracks) {
  const byDecade = new Map();
  let unknown = 0;
  for (const track of tracks) {
    const year = Number(track.year);
    if (!Number.isFinite(year) || year < 1900 || year > 2200) {
      unknown++;
      continue;
    }
    const decade = Math.floor(year / 10) * 10;
    byDecade.set(decade, (byDecade.get(decade) || 0) + 1);
  }
  const decades = [...byDecade.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([decade, count]) => ({ decade, count }));
  return { decades, unknown };
}

/* ------------------------------- interpreti -------------------------------- */

/** Nejproduktivnější interpreti: počet tracků, průměrná energie a tempo. */
export function artistStats(tracks, limit = 8) {
  const byArtist = new Map();
  for (const track of tracks) {
    const artistKey = track.artistKey || normalizeText(track.artist);
    const name = normalizeText(track.artist) || 'neuvedeno';
    if (!byArtist.has(artistKey)) byArtist.set(artistKey, { artist: name, count: 0, energySum: 0, bpmSum: 0, bpmCount: 0 });
    const entry = byArtist.get(artistKey);
    entry.count++;
    if (track.features && Number.isFinite(track.features.energy)) entry.energySum += track.features.energy;
    if (Number.isFinite(track.bpm) && track.bpm > 0) {
      entry.bpmSum += track.bpm;
      entry.bpmCount++;
    }
  }
  return [...byArtist.values()]
    .sort((a, b) => b.count - a.count || a.artist.localeCompare(b.artist))
    .slice(0, limit)
    .map((entry) => ({
      artist: entry.artist,
      count: entry.count,
      avgEnergy: entry.count ? Math.round(entry.energySum / entry.count) : null,
      avgBpm: entry.bpmCount ? round1(entry.bpmSum / entry.bpmCount) : null,
    }));
}

/* -------------------------------- insights --------------------------------- */

function buildInsights(report) {
  const insights = [];
  if (!report.count) return insights;
  const { bpm, energy, wheel, duplicates, health, eras } = report;

  if (bpm.dominant) {
    insights.push(
      `Tempo se drží hlavně v pásmu ${bpm.dominant.from}–${bpm.dominant.to} BPM (${Math.round(
        bpm.dominant.share * 100,
      )} % kolekce${bpm.covered > 1 ? `, dalších ${bpm.covered - 1} pásem` : ''}).`,
    );
  }

  const peak = energy.zones.find((z) => z.key === 'peak');
  const chill = energy.zones.find((z) => z.key === 'chill');
  if (peak && chill && peak.share > 0.5 && chill.count > 0) {
    insights.push(
      `Většina kolekce je peak (${Math.round(peak.share * 100)} %) – na začátek setu máš ${chill.count} chill tracků.`,
    );
  } else if (peak && chill && chill.share > 0.5) {
    insights.push(
      `Kolekce je spíš klidná (${Math.round(chill.share * 100)} % chill/after) – pro peak budeš potřebovat přitvrdit.`,
    );
  }

  const noKey = health.coverage.find((f) => f.key === 'key');
  if (noKey && noKey.count > 0 && noKey.share < 0.95) {
    insights.push(
      `Bez klíče je ${noKey.count} tracků – v rekordboxu doplň Tonality, ať jdou harmonicky řadit.`,
    );
  }
  if (duplicates.duplicateCount > 0 && duplicates.variantCount > 0) {
    insights.push(
      `Našel jsem ${duplicates.duplicates.length} skupin duplicit (${duplicates.duplicateCount} přebývajících tracků) a ${duplicates.variants.length} sad verzí (Radio/Club edit…).`,
    );
  } else if (duplicates.duplicateCount > 0) {
    insights.push(
      `${duplicates.duplicates.length} skupin duplicit (${duplicates.duplicateCount} přebývajících tracků) – vyber si jednu verzi a zbytek z kolekce vyhoď.`,
    );
  } else if (duplicates.variantCount > 0) {
    insights.push(
      `${duplicates.variants.length} sad verzí (Radio/Club edit, feat.…) – jestli mixuješ, ber raději delší mix.`,
    );
  }
  if (wheel.missing.length && wheel.known) {
    const near = wheel.top.slice(0, 2).map((entry) => entry.camelot);
    insights.push(
      `Wheel pokrýváš ${wheel.filled}/${wheel.total} klíči${near.length ? ` (nejvíc ${near.join(', ')})` : ''} – nejvíc chybí ${wheel.missing
        .slice(0, 3)
        .join(', ')}.`,
    );
  }
  if (eras.unknown > eras.decades.reduce((sum, d) => sum + d.count, 0) * 0.5 && eras.unknown > 0) {
    insights.push(`Rok vydání chybí u ${eras.unknown} tracků – žebříčky podle dekád proto ber s rezervou.`);
  }
  if (health.score < 70 && health.weakest.length) {
    insights.push(`Zdraví metadat ${health.score}/100 – nejvíc chybí ${health.weakest.slice(0, 2).map((f) => f.label).join(', ')}.`);
  }
  return insights;
}

/**
 * Složí celý rozbor kolekce do jednoho objektu (pro UI kartu „Rozbor“).
 */
export function analyzeCollection(tracks, options = {}) {
  const list = Array.isArray(tracks) ? tracks : [];
  const report = {
    count: list.length,
    bpm: bpmBands(list, options.bandSize),
    energy: energyZones(list),
    wheel: keyWheel(list),
    duplicates: findDuplicates(list),
    health: metadataHealth(list),
    eras: eraStats(list),
    artists: artistStats(list, options.artistLimit || 8),
  };
  report.insights = buildInsights(report);
  return report;
}
