/** Všechny akce aplikace (mimo DOM wiring) – dají se tak testovat i bez prohlížeče. */
import { buildFeatures } from '../lib/features.js';
import {
  buildCsv,
  buildM3u8,
  makeFolder,
  makePlaylist,
  parseRekordboxXml,
  playlistTreeFromParsed,
  serializeRekordboxXml,
} from '../lib/parse.js';
import {
  autoCrates,
  buildBpmIndex,
  buildSet,
  describeTransitions,
  reorderPlaylist,
  resolveMixStyle,
  similarTracks,
  WEIGHT_PRESETS,
} from '../lib/playlists.js';
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, explainPair, scorePair } from '../lib/score.js';
import { buildDnbCollection } from '../lib/demo.js';
import { download, readFileText, safeFileName, timestamp } from '../lib/format.js';
import { DEFAULT_SETTINGS } from './store.js';

const nextFrame = () =>
  typeof requestAnimationFrame === 'function'
    ? new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    : Promise.resolve();

function findImportedByPath(nodes, path, prefix = []) {
  for (const node of nodes || []) {
    const current = [...prefix, node.name];
    if (node.type === 'folder') {
      const hit = findImportedByPath(node.children, path, current);
      if (hit) return hit;
    } else if (current.join(' / ') === path) {
      return node;
    }
  }
  return null;
}

function playlistEntries(tracks, weights, options) {
  const scores = [null];
  const notes = ['start setu'];
  for (let i = 1; i < tracks.length; i++) {
    const pair = scorePair(tracks[i - 1], tracks[i], weights, options);
    scores.push(pair.score);
    notes.push(explainPair(tracks[i - 1], tracks[i], pair));
  }
  return {
    scores,
    notes,
    entries: tracks.map((track, index) => ({
      track,
      score: index === 0 ? 1 : scores[index],
      notes: notes[index],
    })),
  };
}

/**
 * @param {Object} store stav aplikace
 * @param {Object} [hooks] { refresh } – zavolá se před dlouhým výpočtem, ať jde ukázat "Počítám…"
 */
export function createActions(store, hooks = {}) {
  const refresh = hooks.refresh || (() => {});

  /** BPM index pro aktuální rozsah (celá kolekce / vybrané playlisty). */
  const getIndex = () => {
    const tracks = store.scopedTracks();
    if (!tracks.length) return null;
    const signature = `${store.scopeSignature()}|${tracks.length}`;
    const cache = store.state._indexCache;
    if (cache && cache.signature === signature) return cache.index;
    const index = buildBpmIndex(tracks);
    store.state._indexCache = { signature, index };
    return index;
  };

  const weightPreset = (key, scope) => {
    const preset = WEIGHT_PRESETS[key] || WEIGHT_PRESETS.balanced;
    store.setSettings((settings) => {
      if (scope === 'crates') settings.cratePreset = key;
      else if (scope === 'set') settings.setPreset = key;
      else {
        settings.cratePreset = key;
        settings.setPreset = key;
      }
      settings.weights = { ...preset.weights };
    });
  };

  const resolvePlaylistRef = (ref) => {
    const collection = store.state.collection;
    let reference = ref || '';
    if (!reference) {
      const first = store.state.playlists[0];
      if (!first) return null;
      reference = `gen:${first.id}`;
    }
    if (reference.startsWith('gen:')) {
      const playlist = store.findPlaylist(reference.slice(4));
      if (!playlist) return null;
      return {
        name: playlist.name,
        tracks: playlist.trackIds.map((id) => store.trackById(id)).filter(Boolean),
      };
    }
    if (reference.startsWith('import:') && collection) {
      const path = reference.slice('import:'.length);
      const node = findImportedByPath(collection.playlists, path);
      if (!node) return null;
      return {
        name: node.name,
        tracks: (node.trackIds || []).map((id) => store.trackById(id)).filter(Boolean),
      };
    }
    return null;
  };

  const actions = {
    setTab(tab) {
      store.setUi({ tab });
    },

    async loadDemo() {
      try {
        const response = await fetch('/demo-collection.xml');
        if (!response.ok) throw new Error(`Demo se nepodařilo načíst (HTTP ${response.status}).`);
        const parsed = parseRekordboxXml(await response.text());
        store.loadCollection(parsed, 'demo kolekce');
        store.toast(`Načteno ${parsed.tracks.length} demo tracků. Zkus tab „Auto playlisty“.`, 'info');
      } catch (error) {
        store.toast(error.message, 'error');
      }
    },

    /** DnB demo – rovnou se přepne rozsah na žánr Drum & Bass. */
    loadDnbDemo() {
      const { parsed, source } = buildDnbCollection(140);
      store.loadCollection(parsed, source);
      store.setGenreScope('Drum & Bass');
      store.toast(
        'DnB demo: 140 tracků (liquid, rollers, neurofunk, jump up, halftime, jungle). Rozsah je nastavený na Drum & Bass – klikni na DnB režim a postav set.',
        'info',
      );
      return parsed;
    },

    async importXml(file) {
      try {
        const text = await readFileText(file);
        const parsed = parseRekordboxXml(text);
        if (!parsed.tracks.length) {
          throw new Error('V XML nejsou žádné tracky – vyexportuj i kolekci, ne jen playlisty.');
        }
        store.loadCollection(parsed, file.name);
        const stats = store.state.collection.stats;
        const synthetic = parsed.tracks.filter((t) => t.synthetic).length;
        store.toast(
          `Načteno ${parsed.tracks.length} tracků · klíč u ${stats.withKey} · BPM ${
            stats.bpms ? `${Math.round(stats.bpms.min)}–${Math.round(stats.bpms.max)}` : '?'
          }.${synthetic ? ` ${synthetic} tracků přišlo jen z metadat v playlistu.` : ''}`,
          'info',
        );
      } catch (error) {
        store.toast(`Chyba: ${error.message}`, 'error');
      }
    },

    clearCollection() {
      store.set((state) => {
        state.collection = null;
        state.playlists = [];
        state.scope = { mode: 'all', keys: [] };
        state._indexCache = null;
        state.ui.selectedTrackId = null;
        state.ui.similar = null;
        state.ui.reorderResult = null;
      });
      store.toast('Kolekce odstraněna z aplikace.', 'info');
    },

    toggleScope(key) {
      store.toggleScope(key);
    },

    showAllTracks() {
      store.clearScope();
    },

    setGenreScope(genre) {
      store.setGenreScope(genre);
    },

    sort(column) {
      const { sort } = store.state.ui;
      store.setUi({
        sort: { column, direction: sort.column === column && sort.direction === 'asc' ? 'desc' : 'asc' },
      });
    },

    pickSeed(id) {
      const trackId = Number(id);
      store.setSettings((settings) => {
        settings.set.seedId = trackId;
      }, { silent: true });
      store.setUi({ seedSearch: '' });
    },

    clearSeed() {
      store.setSettings((settings) => {
        settings.set.seedId = null;
      });
    },

    useSeed(id) {
      actions.pickSeed(id);
      actions.setTab('set');
      store.toast('Track je nastavený jako start setu.', 'info');
    },

    setEnergy(trackId, value) {
      store.setEnergyOverride(trackId, value);
    },

    resetEnergy(trackId) {
      store.setEnergyOverride(trackId, null);
    },

    selectTrack(id) {
      const track = store.trackById(id);
      if (!track) return;
      const similar = similarTracks(store.scopedTracks(), track, {
        limit: 14,
        weights: store.settings.weights,
        options: store.settings.options,
        index: getIndex(),
      });
      store.setUi({ selectedTrackId: track.id, similar });
    },

    async buildSet() {
      const collection = store.state.collection;
      if (!collection) return null;
      const settings = store.settings;
      const config = settings.set;
      const tracks = store.scopedTracks();
      if (!tracks.length) {
        store.toast('Vybraný rozsah neobsahuje žádné tracky.', 'warn');
        return null;
      }
      const mix = resolveMixStyle(config.mixStyle, tracks);
      store.setUi({ busy: true }, { silent: true });
      refresh();
      await nextFrame();
      try {
        const variants = Math.max(1, Math.min(15, Number(config.variants) || 1));
        const results = [];
        for (let i = 0; i < variants; i++) {
          results.push(
            buildSet(tracks, {
              seedId: config.seedId,
              minutes: config.lengthMode === 'minutes' ? Number(config.minutes) || 60 : null,
              count: config.lengthMode === 'count' ? Number(config.count) || 30 : null,
              curve: config.curve,
              weights: settings.weights,
              options: settings.options,
              fitWeight: Number(config.fitWeight),
              temperature: Number(config.temperature),
              seed: `${config.randomSeed || 'seed'}:${i}`,
              index: getIndex(),
              // U DnB hraje track v setu ~2 minuty, takže hodinový set má ~30 tracků
              secondsPerTrack: config.lengthMode === 'minutes' ? mix.seconds : null,
            }),
          );
        }
        const weakCount = (playlist) => playlist.entries.filter((e) => e.parts && e.score < 0.55).length;
        const rank = (playlist) => playlist.stats.avgScore - weakCount(playlist) * 0.02;
        results.sort((a, b) => rank(b) - rank(a));
        const best = results[0];
        const added = store.addPlaylists([best]);
        store.setUi({ busy: false, tab: 'set' }, { silent: true });
        store.toast(
          `Set hotový: ${best.stats.count} tracků, ${Math.round((best.stats.mixTime || 0) / 60)} min mixu, shoda ${Math.round(
            best.stats.avgScore * 100,
          )} %${results.length > 1 ? ` (nejlepší z ${results.length} variant)` : ''}.`,
          'info',
        );
        if (best.stopped) store.toast(best.stopped, 'warn');
        store.notify();
        return added[0];
      } catch (error) {
        store.setUi({ busy: false }, { silent: true });
        store.toast(`Chyba při stavbě setu: ${error.message}`, 'error');
        return null;
      }
    },

    async buildCrates() {
      const collection = store.state.collection;
      if (!collection) return [];
      const settings = store.settings;
      const config = settings.crates;
      const tracks = store.scopedTracks();
      if (!tracks.length) {
        store.toast('Vybraný rozsah neobsahuje žádné tracky.', 'warn');
        return [];
      }
      store.setUi({ busy: true }, { silent: true });
      refresh();
      await nextFrame();
      try {
        const crates = autoCrates(tracks, {
          targetSize: Number(config.targetSize) || 20,
          minSize: Number(config.minSize) || 5,
          threshold: Number(config.threshold) || 0.6,
          keepSmall: Boolean(config.keepSmall),
          allowOverlap: Boolean(config.allowOverlap),
          weights: settings.weights,
          options: settings.options,
          seed: config.randomSeed || 'kolekce',
          index: getIndex(),
        });
        store.state.playlists = store.state.playlists.filter((p) => p.kind !== 'crate');
        store.setUi({ busy: false }, { silent: true });
        if (!crates.length) {
          store.toast('Nepodařilo se poskládat ani jeden playlist – zkus nižší práh shody.', 'warn');
          store.notify();
          return [];
        }
        const added = store.addPlaylists(crates);
        const covered = new Set(crates.flatMap((c) => c.trackIds)).size;
        store.toast(`${added.length} playlistů pokrývá ${covered} z ${tracks.length} tracků v rozsahu.`, 'info');
        return added;
      } catch (error) {
        store.setUi({ busy: false }, { silent: true });
        store.toast(`Chyba při generování playlistů: ${error.message}`, 'error');
        return [];
      }
    },

    doReorder() {
      const resolved = resolvePlaylistRef(store.state.ui.reorderSourceRef);
      if (!resolved || resolved.tracks.length < 3) {
        store.toast('Vyber playlist s aspoň 3 tracky.', 'warn');
        return null;
      }
      const settings = store.settings;
      const result = reorderPlaylist(resolved.tracks, { weights: settings.weights, options: settings.options });
      const { scores, notes } = playlistEntries(result.tracks, settings.weights, settings.options);
      const payload = {
        name: resolved.name,
        tracks: result.tracks,
        before: result.before,
        after: result.after,
        improved: result.improved,
        scores,
        notes,
      };
      store.setUi({ reorderResult: payload });
      store.toast(
        `Shoda přechodů ${Math.round(result.before.average * 100)} % → ${Math.round(result.after.average * 100)} %.`,
        'info',
      );
      return payload;
    },

    saveReorder() {
      const result = store.state.ui.reorderResult;
      if (!result) return null;
      const entries = result.tracks.map((track, index) => ({
        track,
        score: index === 0 ? 1 : result.scores[index],
        notes: result.notes[index],
      }));
      const added = store.addPlaylists([
        {
          id: `set-reorder-${Date.now().toString(36)}`,
          kind: 'set',
          name: `${result.name} (seřazeno)`,
          curve: null,
          entries,
          tracks: result.tracks,
          trackIds: result.tracks.map((t) => t.id),
          stats: {
            count: entries.length,
            totalTime: result.tracks.reduce((a, t) => a + (t.totalTime || 0), 0),
            avgScore: result.after.average,
            keys: [],
          },
        },
      ]);
      actions.setTab('export');
      store.toast(`Uloženo jako „${added[0].name}“ – najdeš to v Exportu.`, 'info');
      return added[0];
    },

    togglePlaylist(id) {
      store.togglePlaylist(id);
    },

    removePlaylist(id) {
      const playlist = store.findPlaylist(id);
      store.removePlaylist(id);
      store.toast(`Playlist „${playlist ? playlist.name : id}“ odebrán.`, 'info');
    },

    removeCrates() {
      store.set((state) => {
        state.playlists = state.playlists.filter((p) => p.kind !== 'crate');
      }, { silent: true });
      store.notify();
      store.toast('Vygenerované playlisty zahozeny.', 'info');
    },

    renamePlaylist(id, name) {
      const playlist = store.findPlaylist(id);
      if (!playlist) return;
      const next = name != null ? String(name).trim() : window.prompt('Nový název playlistu:', playlist.name);
      if (!next) return;
      store.updatePlaylist(id, { name: next });
    },

    reorderPlaylistAction(id) {
      const playlist = store.findPlaylist(id);
      if (!playlist) return null;
      const tracks = playlist.trackIds.map((trackId) => store.trackById(trackId)).filter(Boolean);
      if (tracks.length < 3) {
        store.toast('Playlist je moc krátký na přeřazení.', 'warn');
        return null;
      }
      const settings = store.settings;
      const result = reorderPlaylist(tracks, { weights: settings.weights, options: settings.options });
      const { entries } = playlistEntries(result.tracks, settings.weights, settings.options);
      store.updatePlaylist(id, {
        tracks: result.tracks,
        entries,
        trackIds: result.tracks.map((t) => t.id),
        stats: { ...playlist.stats, avgScore: result.after.average, count: entries.length },
      });
      store.toast(
        `Přeřazeno: shoda ${Math.round(result.before.average * 100)} % → ${Math.round(result.after.average * 100)} %.`,
        'info',
      );
      return result;
    },

    selectAllPlaylists() {
      store.set((state) => {
        state.playlists = state.playlists.map((p) => ({ ...p, selected: true }));
      });
    },

    deselectAllPlaylists() {
      store.set((state) => {
        state.playlists = state.playlists.map((p) => ({ ...p, selected: false }));
      });
    },

    /** Postaví XML pro rekordbox (vrací i obsah, ať jde snadno otestovat). */
    buildExportXml() {
      const collection = store.state.collection;
      if (!collection) return null;
      const selected = store.selectedPlaylists();
      if (!selected.length) return null;
      const settings = store.settings;
      const folderName =
        (settings.export.folderName || '').trim() || `Set Builder ${new Date().toLocaleDateString('cs-CZ')}`;
      const nodes = [];
      if (settings.export.preserveExisting) nodes.push(...playlistTreeFromParsed(collection));
      nodes.push(makeFolder(folderName, selected.map((p) => makePlaylist(p.name, p.trackIds))));
      return {
        folderName,
        xml: serializeRekordboxXml({
          product: collection.product,
          tracks: collection.tracks,
          playlistTree: nodes,
          version: collection.version,
        }),
        playlistCount: selected.length,
      };
    },

    exportXml() {
      const result = actions.buildExportXml();
      if (!result) {
        store.toast('Nemáš vybraný žádný playlist k exportu.', 'warn');
        return null;
      }
      download(`rekordbox-${safeFileName(result.folderName)}.xml`, result.xml, 'application/xml');
      store.toast(
        `XML s ${result.playlistCount} playlisty stažen. Nastav ho v rekordboxu jako „rekordbox xml“.`,
        'info',
      );
      return result;
    },

    exportM3u8() {
      const selected = store.selectedPlaylists();
      if (!selected.length) return null;
      const content = buildM3u8(
        selected.map((p) => ({
          name: p.name,
          tracks: p.trackIds.map((id) => store.trackById(id)).filter(Boolean),
        })),
      );
      download(`playlisty-${timestamp()}.m3u8`, content, 'audio/x-mpegurl');
      store.toast('M3U8 staženo (hodí se pro jiné přehrávače).', 'info');
      return content;
    },

    buildCsvRows() {
      const settings = store.settings;
      const rows = [];
      for (const playlist of store.selectedPlaylists()) {
        for (const row of describeTransitions(playlist.entries || [], settings.weights, settings.options)) {
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
            poznamka: row.notes,
            chyba: row.hardFail ? row.failReason : '',
          });
        }
      }
      return rows;
    },

    exportCsv() {
      const rows = actions.buildCsvRows();
      if (!rows.length) return null;
      download(`prechody-${timestamp()}.csv`, buildCsv(rows), 'text/csv');
      store.toast(`CSV s ${rows.length} přechody staženo.`, 'info');
      return rows;
    },

    buildProject() {
      const collection = store.state.collection;
      const settings = store.settings;
      return {
        app: 'rekordbox-set-builder',
        version: 1,
        savedAt: new Date().toISOString(),
        source: collection ? collection.source : null,
        settings: {
          weights: settings.weights,
          options: settings.options,
          set: settings.set,
          crates: settings.crates,
          export: settings.export,
          setPreset: settings.setPreset,
          cratePreset: settings.cratePreset,
        },
        energyOverrides: settings.energyOverrides,
        playlists: store.state.playlists.map((p) => ({
          name: p.name,
          kind: p.kind,
          curve: p.curve || null,
          stats: p.stats || null,
          trackIds: p.trackIds,
        })),
      };
    },

    exportJson() {
      const project = actions.buildProject();
      download(`projekt-${timestamp()}.json`, JSON.stringify(project, null, 2), 'application/json');
      store.toast('Projekt uložen (nastavení + playlisty).', 'info');
      return project;
    },

    applyProject(project) {
      if (!project || project.app !== 'rekordbox-set-builder') {
        throw new Error('Tohle není projekt z této aplikace.');
      }
      store.setSettings((settings) => {
        Object.assign(settings, project.settings || {});
        settings.weights = { ...DEFAULT_WEIGHTS, ...((project.settings || {}).weights || {}) };
        settings.options = { ...DEFAULT_OPTIONS, ...((project.settings || {}).options || {}) };
        settings.energyOverrides = project.energyOverrides || {};
      }, { silent: true });

      if (!store.state.collection) {
        store.notify();
        store.toast('Nastavení z projektu načteno. Teď nahraj XML kolekci, ať se playlisty dopočítají.', 'warn');
        return { playlists: 0, missing: 0 };
      }

      buildFeatures(store.tracks, { energyOverrides: store.settings.energyOverrides });
      const playlists = [];
      let missing = 0;
      for (const item of project.playlists || []) {
        const tracks = (item.trackIds || []).map((id) => store.trackById(id)).filter(Boolean);
        missing += (item.trackIds || []).length - tracks.length;
        if (!tracks.length) continue;
        playlists.push({
          id: `set-${Math.random().toString(36).slice(2, 8)}`,
          kind: item.kind || 'set',
          name: item.name,
          curve: item.curve || null,
          entries: tracks.map((track, index) => ({ track, score: index === 0 ? 1 : null })),
          tracks,
          trackIds: tracks.map((t) => t.id),
          stats: item.stats || { count: tracks.length },
          selected: true,
        });
      }
      store.set((state) => {
        state.playlists = playlists;
      }, { silent: true });
      store.notify();
      store.toast(
        `Projekt načten: ${playlists.length} playlistů${missing ? `, ${missing} odkazů na tracky chybí` : ''}.`,
        missing ? 'warn' : 'info',
      );
      return { playlists: playlists.length, missing };
    },

    async importProject(file) {
      try {
        return actions.applyProject(JSON.parse(await readFileText(file)));
      } catch (error) {
        store.toast(`Chyba: ${error.message}`, 'error');
        return null;
      }
    },

    /** Jeden klik na DnB režim: DnB váhy, rychlé mixování a peak-time křivka. */
    applyDnbMode() {
      store.setSettings((settings) => {
        settings.setPreset = 'dnb';
        settings.weights = { ...WEIGHT_PRESETS.dnb.weights };
        settings.set.mixStyle = 'quick';
        settings.set.curve = 'peaktime';
        settings.set.lengthMode = 'minutes';
        if (!settings.set.minutes) settings.set.minutes = 60;
      });
      store.toast('DnB režim zapnutý: ≈2 min na track, peak-time křivka a váhy pro DnB.', 'info');
    },

    applyPresetBoth(key) {
      weightPreset(key, 'both');
      store.toast(`Preset „${WEIGHT_PRESETS[key].label}“ nastaven pro sety i playlisty.`, 'info');
    },

    resetSettings() {
      store.setSettings((settings) => {
        settings.weights = { ...DEFAULT_WEIGHTS };
        settings.options = { ...DEFAULT_OPTIONS };
        settings.set = { ...DEFAULT_SETTINGS.set };
        settings.crates = { ...DEFAULT_SETTINGS.crates };
        settings.export = { ...DEFAULT_SETTINGS.export };
      });
      store.toast('Nastavení vráceno na výchozí hodnoty.', 'info');
    },
  };

  return actions;
}
