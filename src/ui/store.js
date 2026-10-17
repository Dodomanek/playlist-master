/** Stav aplikace + uložení nastavení do localStorage. */
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS } from '../lib/score.js';
import { buildFeatures, normalizeText } from '../lib/features.js';

const STORAGE_KEY = 'rekordbox-set-builder:v1';

export const DEFAULT_SETTINGS = {
  setPreset: 'balanced',
  cratePreset: 'genre',
  weights: { ...DEFAULT_WEIGHTS },
  options: { ...DEFAULT_OPTIONS },
  set: {
    seedId: null,
    lengthMode: 'minutes',
    minutes: 60,
    count: 30,
    curve: 'arc',
    // DnB se mixuje rychleji – hodinový set má ~30 tracků, ne 12
    mixStyle: 'auto',
    variants: 3,
    fitWeight: 0.35,
    temperature: 0.02,
    randomSeed: 'pátek',
  },
  crates: {
    targetSize: 20,
    minSize: 5,
    threshold: 0.6,
    keepSmall: false,
    allowOverlap: false,
    randomSeed: 'kolekce',
    // DnB rozdělit samostatně na neuro/deep/jungle/… – liquid se neplete s neurofunk
    splitByDnb: true,
  },
  export: {
    folderName: '',
    preserveExisting: true,
  },
  energyOverrides: {},
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const parsed = JSON.parse(raw);
    if (!parsed.energyOverrides) parsed.energyOverrides = {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      weights: { ...DEFAULT_SETTINGS.weights, ...(parsed.weights || {}) },
      options: { ...DEFAULT_SETTINGS.options, ...(parsed.options || {}) },
      set: { ...DEFAULT_SETTINGS.set, ...(parsed.set || {}) },
      crates: { ...DEFAULT_SETTINGS.crates, ...(parsed.crates || {}),
        splitByDnb: parsed.crates && parsed.crates.splitByDnb != null ? parsed.crates.splitByDnb : true },
      export: { ...DEFAULT_SETTINGS.export, ...(parsed.export || {}) },
      energyOverrides: parsed.energyOverrides || {},
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
}

function findImported(nodes, path, prefix = []) {
  for (const node of nodes || []) {
    const current = [...prefix, node.name];
    if (node.type === 'folder') {
      const hit = findImported(node.children, path, current);
      if (hit) return hit;
    } else if (current.join(' / ') === path) {
      return node;
    }
  }
  return null;
}

export function createStore() {
  const settings = loadSettings();
  const state = {
    collection: null, // { tracks, product, playlists, stats, source }
    playlists: [], // vygenerované playlisty
    // Rozsah práce: celá kolekce, nebo jen vybrané playlisty (importované i vygenerované)
    scope: { mode: 'all', keys: [] },
    // Quickie import – soubory načtené rovnou z disku (bez rekordbox XML)
    quickie: { items: [], busy: false, progress: null },
    settings,
    ui: {
      tab: 'collection',
      search: '',
      genre: '',
      key: '',
      sort: { column: 'artist', direction: 'asc' },
      selectedTrackId: null,
      similar: null,
      tableLimit: 300,
      reorderSource: 'import',
      reorderPlaylistName: '',
      reorderResult: null,
      message: null,
      busy: false,
    },
  };

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());
  const persist = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          weights: state.settings.weights,
          options: state.settings.options,
          set: state.settings.set,
          crates: state.settings.crates,
          export: state.settings.export,
          setPreset: state.settings.setPreset,
          cratePreset: state.settings.cratePreset,
          energyOverrides: state.settings.energyOverrides,
        }),
      );
    } catch {
      /* soukromý režim – prostě se neukládá */
    }
  };

  const store = {
    state,
    get tracks() {
      return state.collection ? state.collection.tracks : [];
    },
    get settings() {
      return state.settings;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify,
    /** Změna stavu + překreslení. */
    set(mutator, { silent = false } = {}) {
      if (typeof mutator === 'function') mutator(state);
      else Object.assign(state, mutator);
      if (!silent) notify();
    },
    /** Změna nastavení (uloží se do localStorage). */
    setSettings(mutator, { silent = false } = {}) {
      if (typeof mutator === 'function') mutator(settings);
      else Object.assign(settings, mutator);
      persist();
      if (!silent) notify();
    },
    setUi(patch, { silent = false } = {}) {
      Object.assign(state.ui, patch);
      if (!silent) notify();
    },
    toast(text, kind = 'info') {
      state.ui.message = { text, kind, at: Date.now() };
      notify();
    },
    loadCollection(parsed, source) {
      const { stats } = buildFeatures(parsed.tracks, { energyOverrides: state.settings.energyOverrides });
      state.collection = { ...parsed, stats, source };
      state.playlists = [];
      state.scope = { mode: 'all', keys: [] };
      state.ui.selectedTrackId = null;
      state.ui.similar = null;
      state.ui.reorderResult = null;
      state.ui.reorderPlaylistName = '';
      notify();
    },
    setEnergyOverride(trackId, energy) {
      const overrides = state.settings.energyOverrides;
      if (energy == null || energy === '') delete overrides[trackId];
      else overrides[trackId] = Number(energy);
      const tracks = store.tracks;
      buildFeatures(tracks, { energyOverrides: overrides });
      persist();
      notify();
    },
    trackById(id) {
      return store.tracks.find((t) => String(t.id) === String(id)) || null;
    },
    /** Playlisty, ze kterých jde udělat rozsah práce. */
    availableScopes() {
      const result = [];
      const walk = (nodes, path) => {
        for (const node of nodes || []) {
          if (node.type === 'folder') {
            walk(node.children, [...path, node.name]);
            continue;
          }
          result.push({
            key: `import:${[...path, node.name].join(' / ')}`,
            label: [...path, node.name].join(' / '),
            count: (node.trackIds || []).length,
            kind: 'import',
          });
        }
      };
      if (state.collection) walk(state.collection.playlists, []);
      for (const playlist of state.playlists) {
        result.push({
          key: `gen:${playlist.id}`,
          label: playlist.name,
          count: (playlist.trackIds || []).length,
          kind: 'generated',
        });
      }
      return result;
    },
    /** Tracky, se kterými se právě pracuje (celá kolekce, vybrané playlisty nebo jeden žánr). */
    scopedTracks() {
      const all = store.tracks;
      if (state.scope.mode === 'genre') {
        const genre = normalizeText(state.scope.keys[0] || '');
        if (!genre) return all;
        return all.filter((track) => normalizeText(track.genre) === genre);
      }
      if (state.scope.mode !== 'playlists' || !state.scope.keys.length) return all;
      const ids = new Set();
      for (const key of state.scope.keys) {
        if (key.startsWith('gen:')) {
          const playlist = store.findPlaylist(key.slice(4));
          for (const id of (playlist && playlist.trackIds) || []) ids.add(id);
        } else if (key.startsWith('import:') && state.collection) {
          const node = findImported(state.collection.playlists, key.slice('import:'.length));
          for (const id of (node && node.trackIds) || []) ids.add(id);
        }
      }
      return all.filter((t) => ids.has(t.id));
    },
    scopeSignature() {
      return `${state.scope.mode}|${state.scope.keys.slice().sort().join('|')}`;
    },
    toggleScope(key) {
      const selected = new Set(state.scope.keys);
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      state.scope = { mode: selected.size ? 'playlists' : 'all', keys: [...selected] };
      store._clearSelection();
      notify();
    },
    setScopeMode(mode) {
      state.scope = { mode, keys: mode === 'all' ? [] : state.scope.keys };
      store._clearSelection();
      notify();
    },
    setGenreScope(genre) {
      state.scope = genre ? { mode: 'genre', keys: [genre] } : { mode: 'all', keys: [] };
      store._clearSelection();
      notify();
    },
    clearScope() {
      state.scope = { mode: 'all', keys: [] };
      store._clearSelection();
      notify();
    },
    _clearSelection() {
      state.ui.selectedTrackId = null;
      state.ui.similar = null;
    },
    findPlaylist(id) {
      return state.playlists.find((p) => p.id === id) || null;
    },
    addPlaylists(list) {
      const existing = new Set(state.playlists.map((p) => p.name));
      const added = [];
      for (const item of list) {
        let name = item.name;
        let counter = 2;
        while (existing.has(name)) name = `${item.name} (${counter++})`;
        existing.add(name);
        added.push({ ...item, name, selected: true });
      }
      state.playlists = [...state.playlists, ...added];
      notify();
      return added;
    },
    updatePlaylist(id, patch) {
      state.playlists = state.playlists.map((p) => (p.id === id ? { ...p, ...patch } : p));
      notify();
    },
    removePlaylist(id) {
      state.playlists = state.playlists.filter((p) => p.id !== id);
      notify();
    },
    togglePlaylist(id) {
      state.playlists = state.playlists.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p));
      notify();
    },
    selectedPlaylists() {
      return state.playlists.filter((p) => p.selected !== false);
    },
    /** Filtrované a seřazené tracky pro tabulku kolekce. */
    visibleTracks() {
      const { search, genre, key, sort } = state.ui;
      const needle = search.trim().toLowerCase();
      let list = store.scopedTracks();
      if (needle) {
        list = list.filter((t) =>
          `${t.artist} ${t.name} ${t.album} ${t.label} ${t.comments} ${t.genre}`.toLowerCase().includes(needle),
        );
      }
      if (genre) list = list.filter((t) => t.genre === genre);
      if (key) list = list.filter((t) => (t.keyParsed && t.keyParsed.camelot) === key);
      const dir = sort.direction === 'asc' ? 1 : -1;
      const value = (track) => {
        switch (sort.column) {
          case 'bpm':
            return track.bpm || 0;
          case 'energy':
            return track.features ? track.features.energy : 50;
          case 'key':
            return (track.keyParsed && track.keyParsed.number) || 0;
          case 'genre':
            return track.genre.toLowerCase();
          case 'rating':
            return track.rating;
          case 'time':
            return track.totalTime;
          case 'name':
            return track.name.toLowerCase();
          default:
            return `${track.artist}`.toLowerCase();
        }
      };
      return list
        .slice()
        .sort((a, b) => {
          const va = value(a);
          const vb = value(b);
          if (va === vb) return String(a.name).localeCompare(String(b.name), 'cs');
          return va > vb ? dir : -dir;
        });
    },
  };

  return store;
}
