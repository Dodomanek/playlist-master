/**
 * Generátory playlistů: set z jednoho tracku, automatické crates z celé kolekce,
 * hledání podobných tracků a řazení playlistu podle harmonického toku.
 */
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, explainPair, scorePair, relativeBpmDelta } from './score.js';
import { normalizeText } from './features.js';
import { createRng, seedFromString } from './rng.js';

export const WEIGHT_PRESETS = {
  balanced: { label: 'Vyvážené', weights: { ...DEFAULT_WEIGHTS } },
  key: {
    label: 'Harmonické (klíč)',
    weights: { key: 45, bpm: 22, energy: 14, genre: 7, tags: 5, rating: 4, meta: 3 },
  },
  bpm: {
    label: 'Tempo (BPM)',
    weights: { bpm: 42, energy: 22, key: 16, genre: 9, tags: 5, rating: 4, meta: 2 },
  },
  genre: {
    label: 'Žánr / styl',
    weights: { genre: 34, tags: 16, bpm: 16, key: 14, energy: 10, rating: 5, meta: 5 },
  },
  mood: {
    label: 'Nálada (tagy)',
    weights: { tags: 30, energy: 26, genre: 14, key: 14, bpm: 10, rating: 4, meta: 2 },
  },
  energy: {
    label: 'Energie',
    weights: { energy: 36, bpm: 24, key: 14, genre: 10, tags: 8, rating: 5, meta: 3 },
  },
  discovery: {
    label: 'Objevování (různorodé)',
    weights: { genre: 24, tags: 16, energy: 18, bpm: 14, key: 10, rating: 2, meta: 2 },
  },
  dnb: {
    // U DnB je tempo skoro vždy 174, takže rozhoduje harmonie, energie a subžánr (liquid/neurofunk/jump up)
    label: 'DnB set (klíč + energie + subžánr)',
    weights: { key: 32, bpm: 12, energy: 24, genre: 10, tags: 14, rating: 5, meta: 3 },
  },
};

/**
 * Jak dlouho track v setu skutečně hraje – DJ nemixuje celé tracky.
 * DnB se mixuje rychle (cca 2 minuty na track), takže hodinový set má ~30 tracků,
 * i když jsou tracky samy o sobě 5 minut dlouhé.
 */
export const MIX_STYLES = {
  auto: { label: 'Automaticky (podle žánru)', seconds: null },
  quick: { label: 'Rychlé mixování – DnB / hard (≈2 min na track)', seconds: 125 },
  standard: { label: 'Standard – house / techno (≈3 min na track)', seconds: 180 },
  long: { label: 'Pomalejší mixování (≈4 min na track)', seconds: 240 },
  full: { label: 'Celé tracky (podle skutečné délky)', seconds: null },
};

const DNB_GENRE = /(drum\s*&?\s*bass|dnb|jungle|neurofunk|liquid\s*(dnb|funk)?|halftime|jump\s*up|rollers|ragga)/i;

export function isDnbTrack(track) {
  return DNB_GENRE.test(`${track.genre || ''} ${track.comments || ''}`);
}

/** Podíl DnB tracků v sadě – používá se pro automatickou volbu stylu mixu. */
export function dnbShare(tracks) {
  if (!tracks.length) return 0;
  const count = tracks.filter(isDnbTrack).length;
  return count / tracks.length;
}

/**
 * Vrátí, kolik sekund mixu připadá na jeden track.
 * @param {'auto'|'quick'|'standard'|'long'|'full'} mode
 */
export function resolveMixStyle(mode, tracks = []) {
  const chosen = MIX_STYLES[mode] ? mode : 'auto';
  if (chosen === 'auto') {
    const share = dnbShare(tracks);
    if (share >= 0.3) return { key: 'quick', ...MIX_STYLES.quick, auto: true };
    return { key: 'standard', ...MIX_STYLES.standard, auto: true };
  }
  if (chosen === 'full') return { key: 'full', ...MIX_STYLES.full, auto: false };
  return { key: chosen, ...MIX_STYLES[chosen], auto: false };
}

/** Kolik tracků se zhruba vejde do setu dané délky. */
export function estimateTrackCount(minutes, secondsPerTrack, tracks = []) {
  const seconds = secondsPerTrack || (tracks.length ? averageTrackSeconds(tracks) : 300);
  return Math.max(1, Math.round((Math.max(1, minutes) * 60) / seconds));
}

export const CURVES = {
  arc: 'Klasický set (rozjezd → peak → dojezd)',
  peaktime: 'Peak time (rychle nahoru, drží, spadne na konci)',
  warmup: 'Warm-up (postupné nabíhání)',
  up: 'Jen nahoru (gradace)',
  down: 'Jen dolů (chillout/after)',
  flat: 'Rovná energie (stálý vibe)',
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Průběh energie 0–100 podle fáze setu a zvolené křivky. */
export function targetEnergyAt(progress, curve = 'arc') {
  const p = clamp(progress, 0, 1);
  switch (curve) {
    case 'up':
      return 30 + 65 * p;
    case 'down':
      return 95 - 65 * p;
    case 'warmup':
      return 25 + 45 * p;
    case 'flat':
      return 70;
    case 'peaktime':
      if (p < 0.2) return 42 + (p / 0.2) * 43;
      if (p < 0.8) return 85 + ((p - 0.2) / 0.6) * 10;
      return 95 - ((p - 0.8) / 0.2) * 55;
    case 'arc':
    default:
      return 28 + 64 * Math.sin(Math.PI * Math.pow(p, 0.9));
  }
}

export function curvePoints(curve, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => targetEnergyAt(i / steps, curve));
}

/* ------------------------- index pro rychlé hledání ------------------------ */

const BUCKET_SIZE = 4;

export function buildBpmIndex(tracks) {
  const buckets = new Map();
  for (let i = 0; i < tracks.length; i++) {
    const bpm = tracks[i].bpm;
    const key = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm / BUCKET_SIZE) : 'x';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  return { buckets, size: tracks.length };
}

/** Vrátí kandidáty blízké danému tracku (podle BPM bucketu), případně celou kolekci. */
export function candidatesFor(index, tracks, track, span = 3) {
  if (!index || tracks.length <= 400) return tracks;
  const bpm = track.bpm;
  if (!Number.isFinite(bpm) || bpm <= 0) return tracks;
  const center = Math.round(bpm / BUCKET_SIZE);
  const out = [];
  for (let offset = -span; offset <= span; offset++) {
    const list = index.buckets.get(center + offset);
    if (!list) continue;
    for (const i of list) out.push(tracks[i]);
  }
  return out.length >= 6 ? out : tracks;
}

/* ------------------------- podobné tracky (UI) ---------------------------- */

export function similarTracks(tracks, track, options = {}) {
  const { limit = 15, weights = DEFAULT_WEIGHTS, options: scoreOptions = {}, index = null } = options;
  const pool = candidatesFor(index, tracks, track, options.span || 4);
  const results = [];
  for (const candidate of pool) {
    if (candidate.id === track.id) continue;
    const result = scorePair(track, candidate, weights, scoreOptions);
    if (result.hardFail) continue;
    results.push({
      track: candidate,
      score: result.score,
      parts: result.parts,
      notes: explainPair(track, candidate, result),
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/* ------------------------------ stavba setu ------------------------------- */

export function averageTrackSeconds(tracks) {
  const times = tracks.map((t) => t.totalTime).filter((s) => Number.isFinite(s) && s > 0);
  if (!times.length) return 360;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

/**
 * Postaví set tak, aby na sebe tracky hudebně navazovaly a energie kopírovala křivku.
 */
export function buildSet(tracks, options = {}) {
  const {
    seedId = null,
    minutes = 60,
    count = null,
    curve = 'arc',
    weights = DEFAULT_WEIGHTS,
    options: scoreOptions = {},
    fitWeight = 0.35,
    temperature = 0.02,
    seed = 1,
    index: providedIndex = null,
    allowRepeats = false,
    maxDurationOverrun = 1.15,
    // Kolik sekund mixu připadá na jeden track (DnB ≈ 125 s). null = skutečná délka tracků.
    secondsPerTrack = null,
  } = options;

  const rng = createRng(typeof seed === 'string' ? seedFromString(seed) : seed);
  const index = providedIndex || buildBpmIndex(tracks);
  const used = new Set();
  const avgSeconds = (Number.isFinite(secondsPerTrack) && secondsPerTrack > 0 ? secondsPerTrack : null) ||
    averageTrackSeconds(tracks);
  const targetCount = count || Math.max(3, Math.round((minutes * 60) / avgSeconds));
  // Hlídáme délku jen když se staví podle minut; při zadaném počtu tracků ne
  const durationLimitSeconds =
    count || !minutes ? null : minutes * 60 * maxDurationOverrun;

  let current = null;
  if (seedId != null) current = tracks.find((t) => String(t.id) === String(seedId)) || null;
  if (!current) current = pickAutoSeed(tracks, index, weights, scoreOptions, rng);

  const entries = [];
  let stopped = null;
  let totalTime = 0; // odehrané minuty mixu (ne délka celých tracků)

  if (current) {
    used.add(current.id);
    totalTime += avgSeconds;
    entries.push({ track: current, score: 1, parts: null, notes: 'start setu', targetEnergy: null });
  }

  while (entries.length < targetCount) {
    const position = entries.length;
    const progress = targetCount > 1 ? position / (targetCount - 1) : 0;
    const desiredEnergy = targetEnergyAt(progress, curve);
    const currentBpm = current && current.bpm ? current.bpm : null;
    const desiredBpm = currentBpm
      ? currentBpm * (1 + ((desiredEnergy - 50) / 50) * 0.05)
      : null;

    const pool = candidatesFor(index, tracks, current || tracks[0] || {}, 4);
    let best = null;

    for (const candidate of pool) {
      if (!candidate || !candidate.features) continue;
      if (!allowRepeats && used.has(candidate.id)) continue;
      const result = scorePair(current, candidate, weights, scoreOptions);
      if (result.hardFail) continue;
      const energyFit = clamp(1 - Math.abs(candidate.features.energy - desiredEnergy) / 55, 0, 1);
      let bpmFit = 0.6;
      if (desiredBpm && candidate.bpm) {
        const tolerance = Math.max(5, desiredBpm * 0.06);
        bpmFit = clamp(1 - Math.abs(candidate.bpm - desiredBpm) / tolerance, 0, 1);
      } else if (!candidate.bpm) {
        bpmFit = 0.5;
      }
      const fit = 0.6 * energyFit + 0.4 * bpmFit;
      const artistPenalty =
        current && current.features && current.features.artistKey === candidate.features.artistKey && candidate.artist
          ? 0.12
          : 0;
      const albumPenalty = current && current.album && normalizeText(current.album) === normalizeText(candidate.album) ? 0.05 : 0;
      const total =
        (1 - fitWeight) * result.score +
        fitWeight * fit +
        rng.jitter(temperature) -
        artistPenalty -
        albumPenalty;
      if (!best || total > best.total) {
        best = { candidate, result, total, energyFit, bpmFit, desiredEnergy, desiredBpm };
      }
    }

    if (!best) {
      stopped = 'Došly tracky, které na sebe navazují – zkus zvýšit tolerance (BPM skok, energie).';
      break;
    }
    if (durationLimitSeconds != null && totalTime >= durationLimitSeconds) {
      stopped = 'Dosažena požadovaná délka setu.';
      break;
    }

    used.add(best.candidate.id);
    totalTime += avgSeconds;
    entries.push({
      track: best.candidate,
      score: best.result.score,
      parts: best.result.parts,
      notes: explainPair(current, best.candidate, best.result),
      targetEnergy: Math.round(best.desiredEnergy),
      energyFit: best.energyFit,
      bpmFit: best.bpmFit,
    });
    current = best.candidate;
  }

  const template = entries.map((e) => e.track);
  const playlist = {
    id: `set-${entries.length}-${seed || 1}-${Date.now().toString(36)}`,
    kind: 'set',
    name: crateName(template, { prefix: 'Set' }),
    curve,
    entries,
    tracks: template,
    trackIds: template.map((t) => t.id),
    stats: {
      ...summarizeEntries(entries),
      mixTime: Math.round(totalTime),
      secondsPerTrack: Math.round(avgSeconds),
    },
    stopped,
    seedId: entries.length ? entries[0].track.id : null,
  };
  return playlist;
}

function pickAutoSeed(tracks, index, weights, scoreOptions, rng) {
  if (!tracks.length) return null;
  // Vybereme track s dobrou obslužností (hodně kompatibilních sousedů), ale ne ten nejrychlejší
  const sample = tracks.length > 400 ? rng.shuffle(tracks).slice(0, 120) : tracks;
  let best = null;
  for (const track of sample) {
    if (!track.features) continue;
    const pool = candidatesFor(index, tracks, track, 2);
    let good = 0;
    let evaluated = 0;
    for (const candidate of pool) {
      if (candidate.id === track.id) continue;
      evaluated++;
      if (evaluated > 120) break;
      const result = scorePair(track, candidate, weights, scoreOptions);
      if (!result.hardFail && result.score > 0.7) good++;
    }
    const energyFit = clamp(1 - Math.abs(track.features.energy - 40) / 60, 0, 1);
    const total = good / Math.max(1, evaluated) + energyFit * 0.25 + rng.jitter(0.02);
    if (!best || total > best.total) best = { track, total };
  }
  return best ? best.track : tracks[0];
}

function summarizeEntries(entries) {
  const tracks = entries.map((e) => e.track);
  const bpms = tracks.map((t) => t.bpm).filter((b) => Number.isFinite(b));
  const keys = new Map();
  for (const t of tracks) {
    const key = (t.keyParsed && t.keyParsed.camelot) || '–';
    keys.set(key, (keys.get(key) || 0) + 1);
  }
  const transitions = entries.filter((e) => e.parts).map((e) => e.score);
  const energies = entries.map((e) => (e.track.features ? e.track.features.energy : 50));
  const totalTime = tracks.reduce((a, t) => a + (t.totalTime || 0), 0);
  const bad = entries
    .filter((e) => e.parts && e.score < 0.55)
    .map((e) => `${e.track.artist} – ${e.track.name}`);
  return {
    count: tracks.length,
    totalTime,
    bpmMin: bpms.length ? Math.min(...bpms) : null,
    bpmMax: bpms.length ? Math.max(...bpms) : null,
    energyMin: energies.length ? Math.min(...energies) : null,
    energyMax: energies.length ? Math.max(...energies) : null,
    energyAvg: energies.length ? Math.round(energies.reduce((a, b) => a + b, 0) / energies.length) : null,
    avgScore: transitions.length ? transitions.reduce((a, b) => a + b, 0) / transitions.length : 1,
    minScore: transitions.length ? Math.min(...transitions) : 1,
    keys: [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    weakTransitions: bad.slice(0, 5),
  };
}

/* --------------------- automatické crates z celé kolekce ------------------- */

/**
 * Rozseká celou kolekci na playlisty, které drží pohromadě.
 */
export function autoCrates(tracks, options = {}) {
  const {
    targetSize = 25,
    minSize = 6,
    maxCrates = 40,
    threshold = 0.62,
    weights = DEFAULT_WEIGHTS,
    options: scoreOptions = {},
    seed = 1,
    allowOverlap = false,
    keepSmall = false,
    index: providedIndex = null,
    namePrefix = '',
  } = options;

  const rng = createRng(typeof seed === 'string' ? seedFromString(seed) : seed);
  const scored = tracks.filter((t) => t.features);
  const index = providedIndex || buildBpmIndex(scored);
  const usage = new Map();
  const assigned = new Set();
  const crates = [];

  const scoreOf = (a, b) => scorePair(b, a, weights, scoreOptions); // skóre tracku vůči cratu

  // Kolik má kdo dobrých sousedů – vzácné tracky řešíme první, ať nezůstanou na ocet
  const neighborCount = new Map();
  for (const track of scored) {
    const pool = candidatesFor(index, scored, track, 1);
    let count = 0;
    for (const candidate of pool) {
      if (candidate.id === track.id) continue;
      const result = scorePair(track, candidate, weights, scoreOptions);
      if (!result.hardFail && result.score >= threshold) count++;
      if (count > 30) break;
    }
    neighborCount.set(track.id, count);
  }

  const order = scored.slice().sort((a, b) => {
    const na = neighborCount.get(a.id) || 0;
    const nb = neighborCount.get(b.id) || 0;
    if (na !== nb) return na - nb;
    return (b.features.energy || 0) - (a.features.energy || 0);
  });

  while (crates.length < maxCrates) {
    const seedTrack = order.find((t) => !assigned.has(t.id));
    if (!seedTrack) break;
    const members = [seedTrack];
    assigned.add(seedTrack.id);
    usage.set(seedTrack.id, (usage.get(seedTrack.id) || 0) + 1);

    // Kandidáty hledáme jen v BPM okolí cratu a skóre si držíme průběžně (výkon)
    const byId = new Map(scored.map((t) => [t.id, t]));
    const stats = new Map();
    const ensure = (track) => {
      let entry = stats.get(track.id);
      if (entry) return entry;
      entry = { sum: 0, strong: 0 };
      for (const member of members) {
        const result = scoreOf(track, member);
        if (result.hardFail) continue;
        entry.sum += result.score;
        if (result.score >= threshold) entry.strong++;
      }
      stats.set(track.id, entry);
      return entry;
    };
    const registerMember = (member) => {
      for (const [id, entry] of stats) {
        if (id === member.id) continue;
        const track = byId.get(id);
        if (!track) continue;
        const result = scoreOf(track, member);
        if (result.hardFail) continue;
        entry.sum += result.score;
        if (result.score >= threshold) entry.strong++;
      }
    };

    while (members.length < targetSize) {
      const meanBpm = members.reduce((a, m) => a + (m.bpm || 0), 0) / members.length;
      const pool = candidatesFor(index, scored, { bpm: meanBpm }, 3);
      let best = null;
      for (const candidate of pool) {
        if (members.some((m) => m.id === candidate.id)) continue;
        if (!allowOverlap && assigned.has(candidate.id)) continue;
        let entry = stats.get(candidate.id);
        if (!entry) entry = ensure(candidate);
        const n = members.length;
        if (entry.strong === 0 && n > 1) continue;
        const avg = entry.sum / n;
        const weakLink = entry.strong / n;
        const usagePenalty = allowOverlap ? (usage.get(candidate.id) || 0) * 0.03 : 0;
        const total = avg * 0.7 + weakLink * 0.3 - usagePenalty + rng.jitter(0.01);
        if (!best || total > best.total) best = { candidate, total, avg };
      }
      if (!best) break;
      members.push(best.candidate);
      registerMember(best.candidate);
      if (!allowOverlap) assigned.add(best.candidate.id);
      usage.set(best.candidate.id, (usage.get(best.candidate.id) || 0) + 1);
    }

    if (members.length < minSize && !keepSmall && crates.length) {
      // připojíme drobek k nejpodobnějšímu cratu
      const target = crates.reduce((acc, crate) => {
        const score = averageLink(members, crate.members, weights, scoreOptions);
        return !acc || score > acc.score ? { crate, score } : acc;
      }, null);
      if (target) {
        target.crate.members.push(...members);
        continue;
      }
    }

    crates.push({ members });
  }

  // Finální podoba: seřadíme do plynulého toku a spočítáme statistiky až teď,
  // aby seděly i tracky, které se na konci přilepily do většího cratu.
  const finalCrates = crates.map((crate, index) => {
    const ordered = reorderPlaylist(crate.members, { weights, options: scoreOptions }).tracks;
    const entries = ordered.map((track, i) => {
      if (i === 0) return { track, score: 1, parts: null, notes: 'start setu' };
      const result = scorePair(ordered[i - 1], track, weights, scoreOptions);
      return {
        track,
        score: result.score,
        parts: result.parts,
        notes: explainPair(ordered[i - 1], track, result),
      };
    });
    return {
      id: `crate-${index + 1}-${seed}`,
      kind: 'crate',
      name: crateName(ordered, { prefix: namePrefix }),
      tracks: ordered,
      entries,
      trackIds: ordered.map((t) => t.id),
      stats: summarizeEntries(entries),
    };
  });

  finalCrates.sort((a, b) => b.stats.avgScore - a.stats.avgScore);
  return finalCrates;
}

function averageLink(groupA, groupB, weights, scoreOptions) {
  let sum = 0;
  let n = 0;
  for (const a of groupA) {
    for (const b of groupB) {
      const result = scorePair(a, b, weights, scoreOptions);
      if (!result.hardFail) {
        sum += result.score;
        n++;
      }
    }
  }
  return n ? sum / n : 0;
}

/* --------------------------- řazení playlistu ----------------------------- */

/** Skóre celého pořadí – součet přechodů + plynulost energie. */
export function playlistScore(tracks, weights = DEFAULT_WEIGHTS, scoreOptions = {}) {
  let sum = 0;
  let transitions = 0;
  let bad = [];
  for (let i = 1; i < tracks.length; i++) {
    const result = scorePair(tracks[i - 1], tracks[i], weights, scoreOptions);
    const energyDelta = Math.abs(tracks[i].features.energy - tracks[i - 1].features.energy) / 100;
    const value = result.score * 0.85 + (1 - energyDelta) * 0.15;
    sum += value;
    transitions++;
    if (result.hardFail || result.score < 0.5) {
      bad.push({
        index: i,
        score: result.score,
        reason: result.failReason || 'nízká shoda',
        hardFail: result.hardFail,
      });
    }
  }
  return { total: sum, average: transitions ? sum / transitions : 1, transitions, problems: bad };
}

/**
 * Přeřadí playlist tak, aby na sebe tracky navazovaly (greedy + 2-opt).
 */
export function reorderPlaylist(tracks, options = {}) {
  const { weights = DEFAULT_WEIGHTS, options: scoreOptions = {}, start = 'auto' } = options;
  if (tracks.length < 3) {
    return { tracks: tracks.slice(), before: playlistScore(tracks, weights, scoreOptions), after: playlistScore(tracks, weights, scoreOptions) };
  }
  const before = playlistScore(tracks, weights, scoreOptions);

  const startTrack = (() => {
    if (start === 'lowest') return tracks.reduce((a, b) => (b.features.energy < a.features.energy ? b : a));
    if (start === 'highest') return tracks.reduce((a, b) => (b.features.energy > a.features.energy ? b : a));
    return tracks.reduce((a, b) => (b.features.energy < a.features.energy ? b : a));
  })();

  const remaining = tracks.filter((t) => t !== startTrack);
  const ordered = [startTrack];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const result = scorePair(last, remaining[i], weights, scoreOptions);
      const energyDelta = Math.abs(remaining[i].features.energy - last.features.energy) / 100;
      const value = result.score * 0.85 + (1 - energyDelta) * 0.15;
      if (value > bestScore) {
        bestScore = value;
        bestIndex = i;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }

  // Lokální vylepšení: přesuny jednoho tracku (drží směr energie lépe než obraty)
  if (ordered.length <= 80) {
    let improved = true;
    let guard = 0;
    while (improved && guard < 40) {
      improved = false;
      guard++;
      let currentTotal = playlistScore(ordered, weights, scoreOptions).total;
      for (let i = 1; i < ordered.length - 1; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const candidate = ordered.slice();
          const [moved] = candidate.splice(i, 1);
          candidate.splice(j, 0, moved);
          const total = playlistScore(candidate, weights, scoreOptions).total;
          if (total > currentTotal + 1e-6) {
            ordered.splice(0, ordered.length, ...candidate);
            currentTotal = total;
            improved = true;
          }
        }
      }
    }
  } else {
    // dlouhé playlisty: jen výměny sousedů, ať to netrvá věčnost
    let improved = true;
    let guard = 0;
    while (improved && guard < 30) {
      improved = false;
      guard++;
      for (let i = 0; i < ordered.length - 1; i++) {
        const swapped = ordered.slice();
        [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
        const total = playlistScore(swapped, weights, scoreOptions).total;
        if (total > playlistScore(ordered, weights, scoreOptions).total + 1e-6) {
          ordered.splice(0, ordered.length, ...swapped);
          improved = true;
        }
      }
    }
  }

  const after = playlistScore(ordered, weights, scoreOptions);
  return { tracks: ordered, before, after, improved: after.total > before.total + 1e-6 };
}

/* ------------------------------ názvy cratů ------------------------------- */

const ENERGY_WORDS = [
  [32, 'warm-up'],
  [48, 'deep / groove'],
  [62, 'rolling'],
  [78, 'peak'],
  [101, 'peak time'],
];

export function crateName(tracks, options = {}) {
  if (!tracks.length) return options.prefix ? `${options.prefix} (prázdný)` : 'Prázdný playlist';
  const genres = new Map();
  const keys = new Map();
  const bpms = [];
  let energy = 0;
  for (const track of tracks) {
    const genre = normalizeText(track.genre);
    if (genre && genre !== 'neuvedeno') genres.set(genre, (genres.get(genre) || 0) + 1);
    const key = (track.keyParsed && track.keyParsed.camelot) || null;
    if (key) keys.set(key, (keys.get(key) || 0) + 1);
    if (Number.isFinite(track.bpm)) bpms.push(track.bpm);
    energy += track.features ? track.features.energy : 50;
  }
  const topGenre = [...genres.entries()].sort((a, b) => b[1] - a[1])[0];
  const topKey = [...keys.entries()].sort((a, b) => b[1] - a[1])[0];
  const avgEnergy = energy / tracks.length;
  const energyWord = (ENERGY_WORDS.find(([limit]) => avgEnergy < limit) || [101, 'peak time'])[1];
  const genre = topGenre ? topGenre[0].replace(/\b\w/g, (c) => c.toUpperCase()) : 'Mix';
  const bpmPart = bpms.length
    ? `${Math.round(Math.min(...bpms))}–${Math.round(Math.max(...bpms))} BPM`
    : 'BPM ?';
  const keyPart = topKey && topKey[1] >= Math.max(2, tracks.length * 0.25) ? ` · ${topKey[0]}` : '';
  const prefix = options.prefix ? `${options.prefix} · ` : '';
  return `${prefix}${genre} · ${bpmPart}${keyPart} · ${energyWord}`;
}

/** Přehled přechodů pro UI/CLI report. */
export function describeTransitions(entries, weights = DEFAULT_WEIGHTS, scoreOptions = {}) {
  const rows = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1].track || entries[i - 1];
    const next = entries[i].track || entries[i];
    const result = scorePair(prev, next, weights, scoreOptions);
    rows.push({
      index: i,
      from: `${prev.artist} – ${prev.name}`,
      to: `${next.artist} – ${next.name}`,
      bpmFrom: prev.bpm,
      bpmTo: next.bpm,
      bpmDelta: relativeBpmDelta(prev.bpm, next.bpm),
      keyFrom: (prev.keyParsed && prev.keyParsed.camelot) || '–',
      keyTo: (next.keyParsed && next.keyParsed.camelot) || '–',
      score: result.score,
      hardFail: result.hardFail,
      failReason: result.failReason,
      notes: explainPair(prev, next, result),
    });
  }
  return rows;
}
