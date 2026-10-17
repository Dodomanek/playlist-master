/** Hlavní controller: stav, DOM události a překreslování panelů. */
import { WEIGHT_PRESETS } from './lib/playlists.js';
import { createStore } from './ui/store.js';
import { createActions } from './ui/actions.js';
import { collectionPanel } from './ui/collection.js';
import { setPanel } from './ui/set.js';
import { cratesPanel } from './ui/crates.js';
import { reorderPanel } from './ui/reorder.js';
import { exportPanel } from './ui/exportPanel.js';

const store = createStore();
const panels = {
  collection: collectionPanel,
  set: setPanel,
  crates: cratesPanel,
  reorder: reorderPanel,
  export: exportPanel,
};
const actions = createActions(store, { refresh: () => render() });

const panelScroll = {};
let toastTimer = null;

function render() {
  const { tab } = store.state.ui;

  for (const button of document.querySelectorAll('#tabs .tab')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  const exportTab = document.querySelector('#tabs .tab[data-tab="export"]');
  if (exportTab) {
    exportTab.textContent = 'Export a nastavení';
    const count = store.state.playlists.length;
    if (count) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(count);
      exportTab.appendChild(badge);
    }
  }

  const panelFn = panels[tab] || collectionPanel;
  const panel = panelFn({ store, actions });
  const container = document.querySelector(`.panel[data-panel="${tab}"]`);
  if (!container) return;
  const previousScroll = panelScroll[tab] || 0;
  container.innerHTML = panel.html;
  container.classList.add('active');
  for (const other of document.querySelectorAll('.panel')) {
    if (other !== container) other.classList.remove('active');
  }
  if (typeof panel.mount === 'function') panel.mount(container);
  const scroller = container.querySelector('.table-wrap');
  if (scroller && previousScroll) scroller.scrollTop = previousScroll;

  const collection = store.state.collection;
  const status = document.getElementById('status');
  if (status) {
    status.textContent = collection
      ? `${collection.source} · ${collection.tracks.length} tracků · ${store.state.playlists.length} playlistů`
      : 'Zatím není načtená žádná kolekce';
  }
  const demoButton = document.getElementById('demo-btn');
  if (demoButton) demoButton.textContent = collection ? 'Nahrát demo znovu' : 'Demo data';

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  const oldToast = document.querySelector('.toast');
  if (oldToast) oldToast.remove();
  const message = store.state.ui.message;
  if (message && Date.now() - message.at < 6000) {
    const toast = document.createElement('div');
    toast.className = `toast ${message.kind}`;
    toast.textContent = message.text;
    toast.style.borderColor =
      message.kind === 'error' ? 'var(--bad)' : message.kind === 'warn' ? 'var(--warn)' : 'var(--accent)';
    document.body.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), 5200);
  }
}

store.subscribe(render);

/* ------------------------------ události --------------------------------- */

document.addEventListener('click', (event) => {
  const tabButton = event.target.closest('#tabs .tab');
  if (tabButton) {
    store.setUi({ tab: tabButton.dataset.tab });
    return;
  }
  if (event.target.closest('#demo-btn')) {
    actions.loadDemo();
    return;
  }
  if (event.target.closest('#dnb-demo-btn')) {
    actions.loadDnbDemo();
    return;
  }

  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    switch (action) {
      case 'sort':
        actions.sort(actionEl.dataset.column);
        return;
      case 'load-demo':
        actions.loadDemo();
        return;
      case 'pick-seed': {
        const row = actionEl.closest('[data-track-id]');
        if (row) actions.pickSeed(row.dataset.trackId);
        return;
      }
      case 'clear-seed':
        actions.clearSeed();
        return;
      case 'use-seed':
        actions.useSeed(actionEl.dataset.trackId);
        return;
      case 'reset-energy':
        actions.resetEnergy(actionEl.dataset.trackId);
        return;
      case 'build-set':
        actions.buildSet();
        return;
      case 'build-crates':
        actions.buildCrates();
        return;
      case 'apply-dnb':
        actions.applyDnbMode();
        return;
      case 'scope-all':
        actions.showAllTracks();
        return;
      case 'scope-toggle':
        actions.toggleScope(actionEl.dataset.scopeKey);
        return;
      case 'do-reorder':
        actions.doReorder();
        return;
      case 'save-reorder':
        actions.saveReorder();
        return;
      case 'toggle-playlist':
        return; // checkbox má vlastní change event
      case 'remove-playlist':
        actions.removePlaylist(actionEl.dataset.playlistId);
        return;
      case 'rename-playlist': {
        const playlist = store.findPlaylist(actionEl.dataset.playlistId);
        const name = window.prompt('Nový název playlistu:', playlist ? playlist.name : '');
        if (name != null) actions.renamePlaylist(actionEl.dataset.playlistId, name);
        return;
      }
      case 'reorder-playlist':
        actions.reorderPlaylistAction(actionEl.dataset.playlistId);
        return;
      case 'select-all-playlists':
        actions.selectAllPlaylists();
        return;
      case 'deselect-all-playlists':
        actions.deselectAllPlaylists();
        return;
      case 'remove-crates':
        actions.removeCrates();
        return;
      case 'export-xml':
        actions.exportXml();
        return;
      case 'export-m3u8':
        actions.exportM3u8();
        return;
      case 'export-csv':
        actions.exportCsv();
        return;
      case 'export-json':
        actions.exportJson();
        return;
      case 'reset-settings':
        actions.resetSettings();
        return;
      case 'clear-collection':
        actions.clearCollection();
        return;
      case 'apply-preset-both':
        actions.applyPresetBoth(actionEl.dataset.presetKey);
        return;
      default:
        break;
    }
  }

  const tableRow = event.target.closest('tbody tr[data-track-id]');
  if (tableRow && !event.target.closest('.playlist')) {
    actions.selectTrack(tableRow.dataset.trackId);
    return;
  }
  const sideRow = event.target.closest('.side li[data-track-id]');
  if (sideRow) actions.selectTrack(sideRow.dataset.trackId);
});

document.addEventListener('change', (event) => {
  const target = event.target;

  if (target.id === 'file-input' && target.files && target.files[0]) {
    actions.importXml(target.files[0]);
    target.value = '';
    return;
  }
  if (target.id === 'project-input' && target.files && target.files[0]) {
    actions.importProject(target.files[0]);
    target.value = '';
    return;
  }

  if (target.dataset.action === 'toggle-playlist') {
    actions.togglePlaylist(target.dataset.playlistId);
    return;
  }

  if (target.dataset.scopeGenre !== undefined) {
    actions.setGenreScope(target.value);
    return;
  }

  if (target.dataset.energyFor) {
    actions.setEnergy(target.dataset.energyFor, target.value);
    return;
  }

  if (target.dataset.weight) {
    store.setSettings((settings) => {
      settings.weights[target.dataset.weight] = Number(target.value);
    });
    return;
  }

  if (target.dataset.option) {
    const key = target.dataset.option;
    const value = target.type === 'checkbox' ? target.checked : Number(target.value);
    store.setSettings((settings) => {
      settings.options[key] = value;
    });
    return;
  }

  if (target.dataset.preset) {
    const scope = target.dataset.preset;
    store.setSettings((settings) => {
      const preset = WEIGHT_PRESETS[target.value] || WEIGHT_PRESETS.balanced;
      if (scope === 'crates') settings.cratePreset = target.value;
      else settings.setPreset = target.value;
      settings.weights = { ...preset.weights };
    });
    return;
  }

  if (target.dataset.setting) {
    const path = target.dataset.setting.split('.');
    const value =
      target.type === 'checkbox'
        ? target.checked
        : target.type === 'number' || target.type === 'range'
          ? Number(target.value)
          : target.value;
    store.setSettings((settings) => {
      let cursor = settings;
      for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
      cursor[path[path.length - 1]] = value;
    });
  }
});

// Živé hodnoty u posuvníků – bez překreslení, ať neztratí fokus.
document.addEventListener('input', (event) => {
  const target = event.target;
  const setDeep = (path, value) => {
    store.setSettings((settings) => {
      let cursor = settings;
      for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
      cursor[path[path.length - 1]] = value;
    }, { silent: true });
  };

  if (target.type === 'range') {
    const output = target.parentElement.querySelector('output');
    if (output) output.textContent = target.value;
    if (target.dataset.weight) {
      store.setSettings((settings) => {
        settings.weights[target.dataset.weight] = Number(target.value);
      }, { silent: true });
      return;
    }
    if (target.dataset.option) {
      store.setSettings((settings) => {
        settings.options[target.dataset.option] = Number(target.value);
      }, { silent: true });
      return;
    }
    if (target.dataset.setting) setDeep(target.dataset.setting.split('.'), Number(target.value));
    return;
  }
  if (target.dataset.setting) setDeep(target.dataset.setting.split('.'), target.value);
});

// Scroll tabulek si pamatujeme, ať po překreslení neuskočí.
document.addEventListener(
  'scroll',
  (event) => {
    const wrap = event.target && event.target.closest ? event.target.closest('.table-wrap') : null;
    if (wrap) {
      const panel = wrap.closest('.panel');
      if (panel) panelScroll[panel.dataset.panel] = wrap.scrollTop;
    }
  },
  true,
);

// Přetažení XML/JSON souboru kamkoli do okna.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.json')) actions.importProject(file);
  else actions.importXml(file);
});

render();

if (import.meta.env && import.meta.env.DEV) {
  window.__setBuilder = { store, actions };
  console.info('Rekordbox Set Builder: window.__setBuilder pro ladění.');
}
