/**
 * Analýza audia v prohlížeči (bez závislostí):
 *   - BPM z obálky signálu (autokorelace onsetů)
 *   - tónina z chromagramu (FFT → pitch classes → Krumhansl-Schmuckler profily → Camelot)
 *
 * Detektory jsou čisté funkce nad Float32Array, takže se dají testovat i v Node.
 * Web Audio (decodeAudioData) používá jen prohlížeč.
 */
import { parseKey } from './keys.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl-Schmuckler tóninové profily (váhy stupnic C dur / A moll)
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/* --------------------------------- BPM ----------------------------------- */

/**
 * Odhadne BPM z obálky signálu (autokorelace onsetů).
 * @param {Float32Array} samples mono vzorky
 * @param {number} sampleRate
 * @returns {{bpm:number|null, confidence:number}}
 */
export function detectBpm(samples, sampleRate, options = {}) {
  const minBpm = options.minBpm || 65;
  const maxBpm = options.maxBpm || 195;
  const hop = options.hop || 64;
  const maxSeconds = options.maxSeconds || 45;
  if (!samples || samples.length < sampleRate * 1.5) return { bpm: null, confidence: 0 };

  const n = Math.min(samples.length, Math.floor(maxSeconds * sampleRate));
  const envLen = Math.floor(n / hop);
  if (envLen < 32) return { bpm: null, confidence: 0 };

  // 1) energie po krocích
  const env = new Float32Array(envLen);
  for (let i = 0; i < envLen; i++) {
    let sum = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j++) sum += Math.abs(samples[base + j]);
    env[i] = sum / hop;
  }

  // 2) diferenciační obálka (onsety)
  const d = new Float32Array(envLen - 1);
  let mean = 0;
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.max(0, env[i + 1] - env[i]);
    mean += d[i];
  }
  mean /= d.length;

  const rate = sampleRate / hop; // Hz obálky
  // mírný margin, ať hodnoty na okraji pásma (třeba přesně 195) nevypadnou
  const lagMin = Math.max(2, Math.ceil((rate * 60) / (maxBpm * 1.03)));
  const lagMax = Math.min(d.length - 2, Math.floor((rate * 60) / (minBpm * 0.97)));
  if (lagMax <= lagMin) return { bpm: null, confidence: 0 };

  // 3) autokorelace (normalizovaná na nulový lag)
  const den0 = (() => {
    let s = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i] - mean;
      s += v * v;
    }
    return s;
  })();
  if (den0 <= 1e-12) return { bpm: null, confidence: 0 };

  const count = d.length;
  const ac = new Float32Array(lagMax + 2);
  for (let lag = 1; lag <= lagMax; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < count; i++) sum += (d[i] - mean) * (d[i + lag] - mean);
    ac[lag] = sum / (den0 * (1 - lag / count)); // mírná korekce zkrácením okna
  }

  // 4) nejlepší lag s bonusem za harmonické špičky (l/2 a 2×l)
  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let extra = 0;
    if (lag + lag <= lagMax) extra = Math.max(extra, ac[lag * 2] * 0.4);
    if (Math.round(lag / 2) >= lagMin) extra = Math.max(extra, ac[Math.round(lag / 2)] * 0.3);
    const score = ac[lag] + extra;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return { bpm: null, confidence: 0 };

  // 5) oktavová nejednoznačnost: mřížka půlouzového lagu (= dvojnásobné tempo)
  // taky sedí → volíme vyšší tempo (DnB se počítá na 174, ne 87).
  let chosenLag = bestLag;
  const half = Math.round(bestLag / 2);
  let bestHalfLag = -1;
  let bestHalfAc = -Infinity;
  for (const cand of [half - 1, half, half + 1]) {
    if (cand < 3 || cand >= ac.length) continue;
    if (ac[cand] > bestHalfAc) {
      bestHalfAc = ac[cand];
      bestHalfLag = cand;
    }
  }
  if (bestHalfLag > 0) {
    const fastBpm = (60 * rate) / bestHalfLag;
    if (fastBpm <= maxBpm * 1.03 && fastBpm >= minBpm * 0.97 && bestHalfAc >= 0.6 * ac[bestLag]) {
      chosenLag = bestHalfLag;
    }
  }

  // 6) parabolická interpolace – pod-lag přesnost kolem vybraného lagu
  const y0 = ac[chosenLag];
  const ym = ac[chosenLag - 1] || 0;
  const yp = ac[chosenLag + 1] || 0;
  let lag = chosenLag;
  const denom = ym - 2 * y0 + yp;
  if (Math.abs(denom) > 1e-12) {
    const delta = (0.5 * (ym - yp)) / denom;
    if (Math.abs(delta) <= 1) lag = chosenLag + delta;
  }

  const bpm = Math.round(((60 * rate) / lag) * 10) / 10;
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) return { bpm: null, confidence: 0 };
  return { bpm, confidence: Math.max(0, Math.min(1, (y0 * 2.5) || 0)) };
}

/* --------------------------------- klíč ---------------------------------- */

function fftMagnitudes(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
        const vIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
  const mags = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

function pearson(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da <= 0 || db <= 0) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * Odhadne tóninu z chromagramu a přepočítá ji na Camelot.
 * @returns {{key:string|null, camelot:string|null, root:string|null, mode:string|null, confidence:number}}
 */
export function detectKey(samples, sampleRate, options = {}) {
  const frame = options.frame || 4096;
  const hop = options.hop || 2048;
  const maxSeconds = options.maxSeconds || 75;
  if (!samples || samples.length < sampleRate * 0.5) {
    return { key: null, camelot: null, root: null, mode: null, confidence: 0 };
  }
  const n = Math.min(samples.length, Math.floor(maxSeconds * sampleRate));

  const chroma = new Float64Array(12);
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  const hann = new Float64Array(frame);
  for (let i = 0; i < frame; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));

  const binMin = Math.max(2, Math.round((40 * frame) / sampleRate)); // ~40 Hz
  const binMax = Math.min(frame / 2 - 1, Math.round((4000 * frame) / sampleRate)); // ~4 kHz

  let framesUsed = 0;
  for (let start = 0; start + frame <= n; start += hop) {
    // RMS okna – ticho vynecháme
    let rms = 0;
    for (let i = 0; i < frame; i++) {
      const v = samples[start + i];
      rms += v * v;
    }
    rms = Math.sqrt(rms / frame);
    if (rms < 1e-3) continue;

    for (let i = 0; i < frame; i++) re[i] = samples[start + i] * hann[i];
    im.fill(0);
    const mags = fftMagnitudes(re, im);

    // každá frekvence → pitch class
    for (let b = binMin; b <= binMax; b++) {
      const mag = mags[b];
      if (mag <= 0) continue;
      const freq = (b * sampleRate) / frame;
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      if (midi < 36 || midi > 96) continue;
      chroma[((midi % 12) + 12) % 12] += Math.sqrt(mag);
    }
    framesUsed++;
    if (framesUsed > 3000) break;
  }

  const total = chroma.reduce((a, b) => a + b, 0);
  if (total <= 0) return { key: null, camelot: null, root: null, mode: null, confidence: 0 };

  let best = { key: null, camelot: null, root: null, mode: null, score: -Infinity };
  let bestScore = -Infinity;
  for (let rootOffset = 0; rootOffset < 12; rootOffset++) {
    for (const [mode, profile] of [['major', PROFILE_MAJOR], ['minor', PROFILE_MINOR]]) {
      const shifted = new Float64Array(12);
      for (let pc = 0; pc < 12; pc++) shifted[pc] = profile[((pc - rootOffset) % 12 + 12) % 12];
      const r = pearson(chroma, shifted);
      if (r > bestScore) {
        bestScore = r;
        const note = NOTE_NAMES[rootOffset];
        const key = mode === 'minor' ? `${note}m` : note;
        const parsed = parseKey(key);
        best = { key, camelot: parsed.camelot, root: note, mode, score: r };
      }
    }
  }

  return { ...best, confidence: Math.max(0, Math.min(1, (bestScore + 1) / 2)), score: undefined };
}

/* ------------------------------ prohlížeč -------------------------------- */

/**
 * Načte zvukový soubor přes Web Audio a změří BPM a klíč.
 * Vratí i délku tracku (sekundy).
 */
export async function analyzeAudioFile(file) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx || typeof file.arrayBuffer !== 'function') {
    return { supported: false, bpm: null, camelot: null, key: null, duration: null };
  }
  let ctx = null;
  try {
    ctx = new Ctx({ sampleRate: 44100 });
    const arrayBuffer = await file.arrayBuffer();
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
    const duration = audio.duration;
    // mono + usekáme analýzu na rozumnou délku, ať vykreslení nezdrží
    const maxSeconds = 90;
    const length = Math.min(audio.length, Math.floor(maxSeconds * audio.sampleRate));
    const mono = new Float32Array(length);
    const channels = Math.min(audio.numberOfChannels, 2);
    for (let c = 0; c < channels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    // pokud je stream jiného vzorkování (AudioContext si může přenastavit), použij data.sampleRate
    const sr = audio.sampleRate;
    const bpmResult = detectBpm(mono, sr);
    const keyResult = detectKey(mono, sr);
    return {
      supported: true,
      bpm: bpmResult && bpmResult.bpm,
      bpmConfidence: bpmResult ? bpmResult.confidence : 0,
      key: keyResult.key,
      camelot: keyResult.camelot,
      keyConfidence: keyResult.confidence,
      duration: Math.round(duration) || null,
    };
  } catch (error) {
    return { supported: true, error: error && error.message ? error.message : String(error), bpm: null, camelot: null, key: null, duration: null };
  } finally {
    if (ctx && typeof ctx.close === 'function') ctx.close().catch(() => {});
  }
}