#!/usr/bin/env node
/**
 * CLI: postaví playlisty z rekordbox XML bez otevírání prohlížeče.
 *
 *   node cli.mjs --in fixtures/sample-collection.xml --preset key --size 20
 *   node cli.mjs --in export.xml --mode set --seed-track 42 --minutes 75 --out set.xml
 *   node cli.mjs --in export.xml --mode reorder --playlist "Techno peak" --out serazeno.xml
 *   node cli.mjs --in export.xml --mode report
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildFeatures, computeCollectionStats, normalizeText } from './src/lib/features.js';
import { buildM3u8, buildCsv, makeFolder, makePlaylist, parseRekordboxXml, serializeRekordboxXml } from './src/lib/parse.js';
import { DEFAULT_OPTIONS } from './src/lib/score.js';
import {
  autoCrates,
  buildBpmIndex,
  buildSet,
  describeTransitions,
  estimateTrackCount,
  MIX_STYLES,
  reorderPlaylist,
  resolveMixStyle,
  similarTracks,
  WEIGHT_PRESETS,
} from './src/lib/playlists.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split('=');
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) args[camel] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[camel] = argv[++i];
    else args[camel] = true;
  }
  return args;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usage() {
  console.log(`Použití: node cli.mjs --in <rekordbox.xml> [volby]

Režimy (--mode):
  crates   (výchozí) rozdělí celou kolekci na playlisty, které k sobě pasují
  set      postaví set z jednoho tracku (--seed-track <id> nebo náhodný start)
  reorder  přeřadí existující playlist z XML (--playlist "<název>")
  similar  vypíše tracky podobné zadanému (--seed-track <id>)
  report   jen statistiky a kontrola kolekce

Volby:
  --out <soubor.xml>      kam zapsat XML s playlisty (výchozí generated-playlists.xml)
  --folder "<název>"      složka v rekordboxu pro nové playlisty
  --preset <název>        ${Object.keys(WEIGHT_PRESETS).join(' | ')}
  --size <n>              cílová velikost cratu (výchozí 25)
  --min-size <n>          minimální velikost cratu (výchozí 6)
  --threshold <0-1>       od jakého skóre se tracky počítají jako "k sobě" (výchozí 0.62)
  --max-crates <n>
  --minutes <n>           délka setu v minutách
  --count <n>             počet tracků v setu
  --mix-style <${Object.keys(MIX_STYLES).join('|')}>   jak dlouho track v setu hraje (auto = podle žánru, DnB ≈ 2 min)
  --seconds-per-track <n>  ručně, kolik sekund mixu připadá na jeden track
  --genre "<název>"       pracuj jen s jedním žánrem (např. "Drum & Bass")
  --curve <${Object.keys({ arc: 1, peaktime: 1, warmup: 1, up: 1, down: 1, flat: 1 }).join('|')}>
  --bpm-jump <procenta>   maximální skok BPM mezi tracky (výchozí ${DEFAULT_OPTIONS.maxBpmJumpPct})
  --energy-jump <body>    maximální skok energie 0-100 (výchozí ${DEFAULT_OPTIONS.maxEnergyJump})
  --avoid-same-artist     zakáže dva tracky stejného interpreta za sebou
  --no-half-double        vypne půl/dvojnásobek tempa jako kompatibilní
  --overlap               crates se smí překrývat
  --replace               zahodí původní playlisty z XML (výchozí je zachová)
  --m3u8 <soubor>         zapíše i M3U8 export
  --csv <soubor>          zapíše CSV report přechodů
  --json <soubor>         zapíše JSON s výsledkem
  --quiet`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.in && !args._.length)) {
  usage();
  process.exit(args.help ? 0 : 1);
}
const inputPath = args.in || args._[0];
const log = args.quiet ? () => {} : (...values) => console.log(...values);

const mode = args.mode || 'crates';
const preset = WEIGHT_PRESETS[args.preset] || WEIGHT_PRESETS.balanced;
const weights = { ...preset.weights };
const scoreOptions = {
  ...DEFAULT_OPTIONS,
  maxBpmJumpPct: num(args.bpmJump, DEFAULT_OPTIONS.maxBpmJumpPct),
  maxEnergyJump: args.energyJump === 'none' ? null : num(args.energyJump, DEFAULT_OPTIONS.maxEnergyJump),
  allowHalfDouble: args.noHalfDouble ? false : DEFAULT_OPTIONS.allowHalfDouble,
  avoidSameArtist: Boolean(args.avoidSameArtist),
};

const parsed = parseRekordboxXml(readFileSync(inputPath, 'utf8'));
const { stats } = buildFeatures(parsed.tracks);
log(`Načteno ${parsed.tracks.length} tracků (${parsed.playlists.length} playlist uzlů) – ${inputPath}`);
log(
  `Kolekce: BPM ${stats.bpms ? `${stats.bpms.min}–${stats.bpms.max} (avg ${stats.bpms.avg})` : '?'}, ` +
    `klíč u ${stats.withKey}/${stats.count}, hodnocení u ${stats.rated}, celkem ${(stats.durationTotal / 3600).toFixed(1)} h`,
);
if (stats.genres.length) log(`Žánry: ${stats.genres.slice(0, 6).map(([g, c]) => `${g} (${c})`).join(', ')}`);

// Rozsah: celá kolekce, nebo jen zvolený žánr (třeba jen DnB)
let workingTracks = parsed.tracks;
if (args.genre) {
  const wanted = normalizeText(args.genre);
  workingTracks = parsed.tracks.filter((track) => normalizeText(track.genre) === wanted);
  if (!workingTracks.length) throw new Error(`V kolekci není žádný track se žánrem "${args.genre}".`);
  log(`Rozsah: jen žánr ${args.genre} (${workingTracks.length} tracků)`);
}

const mix = resolveMixStyle(args.mixStyle || 'auto', workingTracks);
const secondsPerTrack = args.secondsPerTrack ? Number(args.secondsPerTrack) : mix.seconds;
if (mode === 'set') {
  log(
    `Styl mixu: ${mix.auto ? 'automaticky – ' : ''}${mix.label} → ${estimateTrackCount(
      num(args.minutes, 60),
      secondsPerTrack,
      workingTracks,
    )} tracků na ${num(args.minutes, 60)} min`,
  );
}

const index = buildBpmIndex(workingTracks);
const generated = [];

if (mode === 'report') {
  const top = stats.keys.slice(0, 8).map(([k, c]) => `${k}:${c}`).join(' ');
  log(`Nejčastější klíče: ${top || '–'}`);
  const seedTrack = workingTracks[0];
  if (seedTrack) {
    log(`\nNejpodobnější k "${seedTrack.artist} – ${seedTrack.name}":`);
    for (const hit of similarTracks(workingTracks, seedTrack, { limit: 8, weights, options: scoreOptions, index })) {
      log(`  ${(hit.score * 100).toFixed(0)} %  ${hit.track.bpm} BPM ${hit.track.keyParsed.camelot || '?'}  ${hit.track.artist} – ${hit.track.name}`);
    }
  }
} else if (mode === 'similar') {
  const target = workingTracks.find((t) => String(t.id) === String(args.seedTrack)) || workingTracks[0];
  if (!target) throw new Error('Kolekce je prázdná.');
  log(`\nPodobné k "${target.artist} – ${target.name}" (${target.bpm} BPM, ${target.keyParsed.camelot || '?'}):`);
  for (const hit of similarTracks(workingTracks, target, { limit: num(args.limit, 20), weights, options: scoreOptions, index })) {
    log(
      `  ${(hit.score * 100).toFixed(0)} %  ${String(hit.track.bpm).padStart(6)} BPM  ${(hit.track.keyParsed.camelot || '–').padEnd(3)} ` +
        `${hit.track.artist} – ${hit.track.name}  (${hit.notes})`,
    );
  }
} else if (mode === 'set') {
  const playlist = buildSet(workingTracks, {
    seedId: args.seedTrack,
    minutes: args.count ? null : num(args.minutes, 60),
    count: args.count ? num(args.count, null) : null,
    curve: args.curve || (mix.key === 'quick' ? 'peaktime' : 'arc'),
    weights,
    options: scoreOptions,
    seed: num(args.seed, 7),
    index,
    secondsPerTrack: args.count ? null : secondsPerTrack,
  });
  generated.push(playlist);
  log(
    `\n${playlist.name} – ${playlist.stats.count} tracků, ${((playlist.stats.mixTime || playlist.stats.totalTime) / 60).toFixed(
      0,
    )} min mixu, průměrná shoda ${(playlist.stats.avgScore * 100).toFixed(0)} %`,
  );
  playlist.entries.forEach((entry, i) => {
    const t = entry.track;
    log(
      `  ${String(i + 1).padStart(3)}. ${String(t.bpm).padStart(6)} BPM  ${(t.keyParsed.camelot || '–').padEnd(3)} E${String(
        t.features.energy,
      ).padStart(3)}  ${t.artist} – ${t.name}${i ? `   [${(entry.score * 100).toFixed(0)} %] ${entry.notes}` : ''}`,
    );
  });
  if (playlist.stopped) log(`  (${playlist.stopped})`);
} else if (mode === 'reorder') {
  const wanted = args.playlist;
  const found = findPlaylist(parsed.playlists, wanted);
  if (!found) throw new Error(`Playlist "${wanted}" v XML nenalezena.`);
  const byId = new Map(parsed.tracks.map((t) => [t.id, t]));
  const list = found.trackIds.map((id) => byId.get(id)).filter(Boolean);
  const result = reorderPlaylist(list, { weights, options: scoreOptions });
  log(`\nPřeřazeno "${found.name}": průměrná shoda ${(result.before.average * 100).toFixed(0)} % → ${(result.after.average * 100).toFixed(0)} %`);
  generated.push({
    kind: 'set',
    name: `${found.name} (seřazeno)`,
    trackIds: result.tracks.map((t) => t.id),
    entries: result.tracks.map((t) => ({ track: t })),
    stats: {},
  });
  result.tracks.forEach((t, i) => {
    log(`  ${String(i + 1).padStart(3)}. ${String(t.bpm).padStart(6)} BPM  ${(t.keyParsed.camelot || '–').padEnd(3)}  ${t.artist} – ${t.name}`);
  });
} else {
  const crates = autoCrates(workingTracks, {
    targetSize: num(args.size, 25),
    minSize: num(args.minSize, 6),
    maxCrates: num(args.maxCrates, 40),
    threshold: num(args.threshold, 0.62),
    weights,
    options: scoreOptions,
    allowOverlap: Boolean(args.overlap),
    seed: num(args.seed, 11),
    index,
    namePrefix: args.folder || '',
  });
  generated.push(...crates);
  log(`\nVytvořeno ${crates.length} playlistů (preset: ${preset.label}):`);
  for (const crate of crates) {
    log(
      `  • ${crate.name} – ${crate.stats.count} tracků, ${(crate.stats.totalTime / 60).toFixed(0)} min, ` +
        `BPM ${crate.stats.bpmMin}–${crate.stats.bpmMax}, shoda ${(crate.stats.avgScore * 100).toFixed(0)} %`,
    );
  }
}

/* ------------------------------- zápis výstupů ---------------------------- */

if (generated.length) {
  const folder = makeFolder(args.folder || `Freebuff ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, generated.map((p) => makePlaylist(p.name, p.trackIds)));
  const tree = args.replace ? [folder] : [...parsed.playlists.map(toTree), folder];
  const out = args.out || 'generated-playlists.xml';
  writeFileSync(out, serializeRekordboxXml({ product: parsed.product, tracks: parsed.tracks, playlistTree: tree }), 'utf8');
  log(`\nZapsáno: ${out}  (${generated.length} playlistů ve složce "${folder.name}")`);

  if (args.m3u8) {
    writeFileSync(
      args.m3u8,
      buildM3u8(
        generated.map((p) => ({
          name: p.name,
          tracks: p.trackIds.map((id) => parsed.tracks.find((t) => t.id === id)).filter(Boolean),
        })),
      ),
      'utf8',
    );
    log(`Zapsáno: ${args.m3u8}`);
  }
  if (args.csv) {
    const rows = [];
    for (const playlist of generated) {
      for (const row of describeTransitions(playlist.entries || [], weights, scoreOptions)) {
        rows.push({
          playlist: playlist.name,
          poradi: row.index,
          z: row.from,
          na: row.to,
          bpm_z: row.bpmFrom ?? '',
          bpm_na: row.bpmTo ?? '',
          klice: `${row.keyFrom} → ${row.keyTo}`,
          skok_bpm_procent: row.bpmDelta != null ? Math.round(row.bpmDelta * 1000) / 10 : '',
          skore: Math.round(row.score * 1000) / 1000,
          poznámka: row.notes,
          chyba: row.hardFail ? row.failReason : '',
        });
      }
    }
    writeFileSync(args.csv, buildCsv(rows), 'utf8');
    log(`Zapsáno: ${args.csv}`);
  }
  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          source: inputPath,
          preset: args.preset || 'balanced',
          weights,
          scoreOptions,
          collection: computeCollectionStats(parsed.tracks),
          playlists: generated.map((p) => ({
            name: p.name,
            kind: p.kind,
            curve: p.curve || null,
            stats: p.stats,
            tracks: (p.entries || []).map((e) => ({
              id: e.track.id,
              artist: e.track.artist,
              name: e.track.name,
              bpm: e.track.bpm,
              key: e.track.keyParsed.camelot,
              energy: e.track.features ? e.track.features.energy : null,
              score: e.score,
              notes: e.notes,
            })),
          })),
        },
        null,
        2,
      ),
      'utf8',
    );
    log(`Zapsáno: ${args.json}`);
  }
}

function toTree(node) {
  return node.type === 'folder'
    ? { name: node.name, type: 'folder', nodeType: '0', children: (node.children || []).map(toTree) }
    : { name: node.name, type: 'playlist', nodeType: '1', keyType: '0', trackIds: (node.trackIds || []).slice() };
}

function findPlaylist(playlists, name) {
  for (const node of playlists) {
    if (node.type === 'playlist') {
      const full = node.path && node.path.length ? `${node.path.join(' / ')} / ${node.name}` : node.name;
      if (!name || node.name === name || full === name) return node;
      continue;
    }
    const hit = findPlaylist(node.children || [], name);
    if (hit) return hit;
  }
  return null;
}
