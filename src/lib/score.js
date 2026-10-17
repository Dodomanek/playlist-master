/**
 * Skórování kompatibility dvou tracků – jádro celé aplikace.
 * Každá složka vrací 0..1, výsledek je vážený průměr.
 */
import { keyCompatibility, parseKey } from './keys.js';
import { normalizeText } from './features.js';

export const DEFAULT_WEIGHTS = {
  key: 30,
  bpm: 25,
  energy: 20,
  genre: 10,
  tags: 8,
  rating: 4,
  meta: 3,
};

export const WEIGHT_LABELS = {
  key: 'Harmonie klíče',
  bpm: 'Blízkost BPM',
  energy: 'Plynulost energie',
  genre: 'Žánr',
  tags: 'Tagy / komentář',
  rating: 'Hodnocení a rok',
  meta: 'Label / artist / album',
};

export const DEFAULT_OPTIONS = {
  maxBpmJumpPct: 6, // max. relativní skok BPM mezi dvěma tracky (%)
  allowHalfDouble: true, // půl/dvojnásobek BPM bere jako kompatibilní
  avoidSameArtist: false, // zakázat dva tracky od stejného interpreta za sebou
  maxEnergyJump: 45, // max. skok energie (0-100) mezi tracky
  minKeyScore: 0, // 0 = povolit vše, 0.4 = jen kompatibilní klíče
};

export function relativeBpmDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / Math.min(a, b);
}

/** Relativní odchylka od přesného půl/dvojnásobku tempa (0 = přesně 2×). */
export function foldedBpmDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const doubled = lo * 2;
  return Math.abs(hi - doubled) / Math.min(hi, doubled);
}

const BPM_TABLE = [
  [0.005, 1],
  [0.01, 0.97],
  [0.02, 0.9],
  [0.04, 0.75],
  [0.06, 0.55],
  [0.09, 0.3],
  [0.14, 0.12],
];

function lookupBpm(rel) {
  for (const [limit, value] of BPM_TABLE) if (rel <= limit) return value;
  return 0.05;
}

export function bpmScore(a, b, options = {}) {
  const { allowHalfDouble = true } = options;
  const direct = relativeBpmDelta(a, b);
  if (direct == null) return 0.5;
  let score = lookupBpm(direct);
  if (allowHalfDouble) {
    const folded = foldedBpmDelta(a, b);
    // půl/dvojnásobek je o něco horší než stejné tempo
    if (folded != null) score = Math.max(score, lookupBpm(folded) * 0.85);
  }
  return score;
}

export function energyScore(a, b) {
  const diff = Math.abs((a ?? 50) - (b ?? 50));
  return Math.max(0, 1 - diff / 60);
}

export function genreScore(a, b) {
  const ga = normalizeText(a);
  const gb = normalizeText(b);
  if (!ga || !gb) return 0.5;
  if (ga === gb) return 1;
  const ta = new Set(ga.split(/[\s/-]+/).filter(Boolean));
  const tb = new Set(gb.split(/[\s/-]+/).filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  if (!union) return 0.5;
  const jaccard = inter / union;
  if (ga.includes(gb) || gb.includes(ga)) return Math.max(0.75, jaccard);
  return 0.25 + jaccard * 0.7; // částečná shoda (např. "house" vs "deep house")
}

export function tagScore(a, b) {
  const ta = a && a.length ? a : null;
  const tb = b && b.length ? b : null;
  if (!ta || !tb) return 0.5;
  const setB = new Set(tb);
  let inter = 0;
  for (const t of ta) if (setB.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0.5;
}

export function ratingScore(a, b) {
  const ra = a ?? null;
  const rb = b ?? null;
  if (ra == null && rb == null) return 0.5;
  if (ra == null || rb == null) return 0.7;
  return Math.max(0, 1 - Math.abs(ra - rb) / 5);
}

export function metaScore(a, b) {
  const signals = [];
  const push = (x, y) => {
    if (x && y) signals.push(normalizeText(x) === normalizeText(y) ? 1 : 0);
  };
  push(a.label, b.label);
  push(a.artist, b.artist);
  push(a.album, b.album);
  if (a.year && b.year) signals.push(Math.abs(Number(a.year) - Number(b.year)) <= 1 ? 1 : 0);
  if (!signals.length) return 0.5;
  return signals.reduce((x, y) => x + y, 0) / signals.length;
}

/**
 * Ohodnotí dvojici tracků. Vrací { score, parts, hardFail, failReason }.
 * `parts` je rozpad 0..1 pro jednotlivé složky (pro UI).
 */
export function scorePair(from, to, weights = DEFAULT_WEIGHTS, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const a = from.features || {};
  const b = to.features || {};
  const keyParsedA = from.keyParsed || parseKey(from.key);
  const keyParsedB = to.keyParsed || parseKey(to.key);

  const parts = {
    key: keyCompatibility(keyParsedA, keyParsedB),
    bpm: bpmScore(a.bpm, b.bpm, opts),
    energy: energyScore(a.energy, b.energy),
    genre: genreScore(a.genre, b.genre),
    tags: tagScore(a.tags, b.tags),
    rating: ratingScore(a.stars, b.stars),
    meta: metaScore(from, to),
  };

  // Tvrdá pravidla
  let hardFail = false;
  let failReason = null;

  // Skok BPM se měří i proti půl/dvojnásobku, takže 174 → 83 už neprojde jako 174 → 87.
  const direct = relativeBpmDelta(a.bpm, b.bpm);
  const folded = opts.allowHalfDouble ? foldedBpmDelta(a.bpm, b.bpm) : null;
  const rel = direct == null ? null : Math.min(direct, folded ?? direct);
  if (rel != null && rel * 100 > opts.maxBpmJumpPct) {
    hardFail = true;
    failReason = `BPM skok ${(rel * 100).toFixed(1)} %`;
  }
  if (!hardFail && opts.avoidSameArtist && a.artistKey && a.artistKey === b.artistKey) {
    hardFail = true;
    failReason = 'stejný interpret';
  }
  if (!hardFail && opts.maxEnergyJump != null && Math.abs(a.energy - b.energy) > opts.maxEnergyJump) {
    hardFail = true;
    failReason = 'velký skok energie';
  }
  if (!hardFail && opts.minKeyScore > 0 && parts.key < opts.minKeyScore) {
    hardFail = true;
    failReason = 'nekompatibilní klíč';
  }

  let wsum = 0;
  let acc = 0;
  for (const [key, weight] of Object.entries(weights || DEFAULT_WEIGHTS)) {
    const w = Number(weight) || 0;
    if (w <= 0) continue;
    const value = parts[key];
    if (value == null) continue;
    acc += value * w;
    wsum += w;
  }
  const score = wsum > 0 ? acc / wsum : 0;
  return { score, parts, hardFail, failReason };
}

/** Český popis nejsilnějších a nejslabších složek přechodu. */
export function explainPair(from, to, result) {
  const notes = [];
  const keyA = (from.keyParsed && from.keyParsed.camelot) || '?';
  const keyB = (to.keyParsed && to.keyParsed.camelot) || '?';
  if (result.parts.key >= 0.9) notes.push(`klíče ${keyA} → ${keyB} sedí`);
  else if (result.parts.key >= 0.7) notes.push(`klíče ${keyA} → ${keyB} hrají spolu`);
  else if (result.parts.key < 0.4) notes.push(`klíče ${keyA} → ${keyB} jsou mimo`);

  const da = (from.features || {}).bpm;
  const db = (to.features || {}).bpm;
  if (Number.isFinite(da) && Number.isFinite(db)) {
    const rel = relativeBpmDelta(da, db);
    const folded = foldedBpmDelta(da, db);
    if (folded != null && folded <= 0.06 && rel > 0.1) notes.push(`půl/dvojnásobek tempa (${da} → ${db})`);
    else if (rel * 100 <= 2) notes.push(`tempo skoro stejné (${da} → ${db})`);
    else if (rel * 100 > 6) notes.push(`tempo uskočilo o ${(rel * 100).toFixed(1)} %`);
  }

  const ea = (from.features || {}).energy;
  const eb = (to.features || {}).energy;
  if (Number.isFinite(ea) && Number.isFinite(eb)) {
    const diff = eb - ea;
    if (diff >= 12) notes.push('energie nahoru');
    else if (diff <= -12) notes.push('energie dolů');
  }

  const shared = ((from.features || {}).tags || []).filter((t) => ((to.features || {}).tags || []).includes(t));
  if (shared.length) notes.push(`společné tagy: ${shared.slice(0, 3).join(', ')}`);

  return notes.join(' · ');
}
