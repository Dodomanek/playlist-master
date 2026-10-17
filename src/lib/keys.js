/**
 * Hudební klíče a Camelot wheel.
 *
 * rekordbox umí exportovat tóninu buď jako Camelot ("8A"), nebo jako klasický
 * název ("Am", "F#m", "C", "Cmaj"). Umíme obojí a převedeme to na Camelot.
 */

// Camelot číslo + B pro durové tóniny
const MAJOR_TO_CAMELOT = {
  B: 1,
  'C#': 2,
  DB: 3,
  D: 10,
  'D#': 5,
  EB: 5,
  E: 12,
  F: 7,
  'F#': 2,
  GB: 2,
  G: 9,
  'G#': 4,
  AB: 4,
  A: 11,
  'A#': 6,
  BB: 6,
  C: 8,
  H: 1, // německy H = B
};

// Camelot číslo + A pro mollové tóniny
const MINOR_TO_CAMELOT = {
  'G#': 1,
  AB: 1,
  'D#': 2,
  EB: 2,
  'A#': 3,
  BB: 3,
  F: 4,
  C: 5,
  G: 6,
  D: 7,
  A: 8,
  E: 9,
  B: 10,
  'F#': 11,
  GB: 11,
  'C#': 12,
  DB: 12,
};

/** Sloučí dvě čísla Camelotu (1–12) po kruhu – vrací 0..6. */
export function wheelDistance(a, b) {
  const diff = Math.abs((((a - b) % 12) + 12) % 12);
  return Math.min(diff, 12 - diff);
}

export function parseKey(raw) {
  const original = raw == null ? '' : String(raw).trim();
  const result = { raw: original, camelot: null, number: null, letter: null, root: null, isMinor: null };
  if (!original) return result;

  const cleaned = original
    .replace(/[♯]/g, '#')
    .replace(/[♭]/g, 'b')
    .replace(/\s+/g, '')
    .replace(/(maj|major|dur)$/i, 'M')
    .replace(/(min|minor|moll|mol)$/i, 'm');

  // Už je to Camelot ("8A", "12b")
  const camelot = /^(\d{1,2})([ABab])$/.exec(cleaned);
  if (camelot) {
    const num = parseInt(camelot[1], 10);
    if (num >= 1 && num <= 12) {
      result.number = num;
      result.letter = camelot[2].toUpperCase();
      result.camelot = `${num}${result.letter}`;
      result.isMinor = result.letter === 'A';
    }
    return result;
  }

  // Klasický název: C, Cm, C#m, CM, Cmin, Dbm, Hb...
  const named = /^([A-Ha-h])([#b]?)(.*)$/.exec(cleaned);
  if (!named) return result;

  const root = (named[1].toUpperCase() + (named[2] || '')).toUpperCase();
  // Po normalizaci výše zbývá v suffixu jen "m" (moll) nebo "M" (dur)
  const suffix = (named[3] || '').trim();
  if (suffix !== '' && suffix !== 'm' && suffix !== 'M') {
    // něco jako "haha" nebo "minorka" klíč není
    result.root = (named[1] + (named[2] || '')).toUpperCase();
    return result;
  }
  const isMinor = suffix === 'm';

  const table = isMinor ? MINOR_TO_CAMELOT : MAJOR_TO_CAMELOT;
  const num = table[root];
  if (!num) {
    // Neznámý kořen (např. "Cb") – necháme prázdné, ať track nespadne
    result.root = root;
    return result;
  }
  result.root = root;
  result.number = num;
  result.letter = isMinor ? 'A' : 'B';
  result.camelot = `${num}${result.letter}`;
  result.isMinor = isMinor;
  return result;
}

/**
 * Jak dobře jdou dva klíče přes sebe (0..1). Vychází z klasických pravidel
 * harmonického mixování na Camelot wheelu.
 */
export function keyCompatibility(keyA, keyB) {
  const a = typeof keyA === 'string' ? parseKey(keyA) : keyA;
  const b = typeof keyB === 'string' ? parseKey(keyB) : keyB;
  if (!a || !b || !a.number || !b.number) return 0.5; // neznámo = neutrální
  const d = wheelDistance(a.number, b.number);
  const sameLetter = a.letter === b.letter;
  if (d === 0) return sameLetter ? 1 : 0.92; // stejný klíč / paralelní dur-moll
  if (d === 1) return sameLetter ? 0.88 : 0.8; // soused / diagonála
  if (d === 2) return sameLetter ? 0.7 : 0.55; // +2 energy boost
  if (d === 3) return sameLetter ? 0.4 : 0.3; // -3 mood change
  if (d === 4) return 0.18;
  if (d === 5) return 0.1;
  return 0.05; // tritón
}

export function keyLabel(raw) {
  const parsed = typeof raw === 'string' ? parseKey(raw) : raw;
  if (!parsed || !parsed.camelot) return '–';
  return parsed.camelot;
}

/** Sousedé na wheelu – používané v UI pro nápovědu. */
export function keyNeighbors(raw) {
  const parsed = typeof raw === 'string' ? parseKey(raw) : raw;
  if (!parsed || !parsed.number) return [];
  const { number, letter } = parsed;
  const other = letter === 'A' ? 'B' : 'A';
  const wrap = (n) => ((((n - 1) % 12) + 12) % 12) + 1;
  return [
    { camelot: `${number}${letter}`, relation: 'stejný', score: 1 },
    { camelot: `${number}${other}`, relation: 'paralelní', score: 0.92 },
    { camelot: `${wrap(number + 1)}${letter}`, relation: '+1', score: 0.88 },
    { camelot: `${wrap(number - 1)}${letter}`, relation: '-1', score: 0.88 },
    { camelot: `${wrap(number + 2)}${letter}`, relation: '+2 boost', score: 0.7 },
  ];
}
