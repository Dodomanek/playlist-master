/**
 * Testy uživatelského toku bez prohlížeče: načtení kolekce → panely → generátory
 * → řazení → export XML, který se hned zase naparsuje (co se stáhne, to musí jít do rekordboxu).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseRekordboxXml } from '../src/lib/parse.js';
import { createStore } from '../src/ui/store.js';
import { createActions } from '../src/ui/actions.js';
import { collectionPanel } from '../src/ui/collection.js';
import { quickiePanel } from '../src/ui/quickie.js';
import { setPanel } from '../src/ui/set.js';
import { cratesPanel } from '../src/ui/crates.js';
import { reorderPanel } from '../src/ui/reorder.js';
import { exportPanel } from '../src/ui/exportPanel.js';
import { WEIGHT_PRESETS } from '../src/lib/playlists.js';

const WEIGHTS_DNB = WEIGHT_PRESETS.dnb.weights;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureText = readFileSync(resolve(here, '..', 'fixtures', 'sample-collection.xml'), 'utf8');
const panels = {
  collection: collectionPanel,
  quickie: quickiePanel,
  set: setPanel,
  crates: cratesPanel,
  reorder: reorderPanel,
  export: exportPanel,
};

function setup() {
  const store = createStore();
  const actions = createActions(store, { refresh: () => {} });
  return { store, actions };
}

function renderPanel(store, actions, tab) {
  const panel = panels[tab]({ store, actions });
  assert.equal(typeof panel.html, 'string');
  assert.ok(panel.html.length > 50, `panel ${tab} je prázdný`);
  assert.ok(!panel.html.includes('undefined'), `panel ${tab} obsahuje "undefined"`);
  // mount nesmí spadnout ani bez skutečného DOM
  panel.mount({ querySelector: () => null });
  return panel.html;
}

test('bez kolekce ukážou panely návod, ne chybu', () => {
  const { store, actions } = setup();
  for (const tab of Object.keys(panels)) renderPanel(store, actions, tab);
  const html = renderPanel(store, actions, 'collection');
  assert.match(html, /Nejdřív načteme kolekci/);
});

test('načtení kolekce, filtr, detail a podobné tracky', () => {
  const { store, actions } = setup();
  const parsed = parseRekordboxXml(fixtureText);
  store.loadCollection(parsed, 'fixture');
  assert.equal(store.tracks.length, 180);
  assert.equal(store.state.collection.stats.count, 180);

  const html = renderPanel(store, actions, 'collection');
  assert.match(html, /Tracků/);
  assert.match(html, /Nejčastější styly/);
  assert.match(html, /techno/);

  actions.selectTrack(store.tracks[0].id);
  assert.equal(store.state.ui.selectedTrackId, store.tracks[0].id);
  assert.ok(store.state.ui.similar.length > 0, 'bez podobných tracků');
  const detailHtml = renderPanel(store, actions, 'collection');
  assert.match(detailHtml, /Nejlepší navazující tracky/);

  // filtr podle stylu
  store.setUi({ genre: 'Techno' }, { silent: true });
  assert.ok(store.visibleTracks().every((t) => t.genre === 'Techno'));
  store.setUi({ genre: '', key: '8A' }, { silent: true });
  assert.ok(store.visibleTracks().every((t) => t.keyParsed.camelot === '8A'));
  store.setUi({ key: '', search: 'kovasen' }, { silent: true });
  assert.ok(store.visibleTracks().length >= 1);
  store.setUi({ search: '' }, { silent: true });
});

test('ruční energie z UI se propíše do skórování', () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  const track = store.tracks[0];
  actions.setEnergy(track.id, 100);
  assert.equal(store.trackById(track.id).features.energy, 100);
  assert.equal(store.trackById(track.id).features.energyManual, true);
  actions.resetEnergy(track.id);
  assert.equal(store.trackById(track.id).features.energyManual, false);
});

test('generátor playlistů z UI vytvoří playlisty a ty se vykreslí', async () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  store.setSettings((settings) => {
    settings.crates.targetSize = 20;
    settings.crates.randomSeed = 'test';
  });
  const added = await actions.buildCrates();
  assert.ok(added.length >= 3, `málo playlistů: ${added.length}`);
  assert.ok(added.every((p) => p.kind === 'crate' && p.trackIds.length > 0));
  const html = renderPanel(store, actions, 'crates');
  assert.match(html, /Vygenerované playlisty/);
  assert.match(html, /BPM/);

  // vyřazení jednoho playlistu z exportu
  actions.togglePlaylist(added[0].id);
  assert.equal(store.selectedPlaylists().length, added.length - 1);

  actions.removeCrates();
  assert.equal(store.state.playlists.length, 0);
});

test('set z tracku se postaví i z UI akce', async () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  const seedTrack = store.tracks.find((t) => t.genre === 'Drum & Bass');
  actions.pickSeed(seedTrack.id);
  store.setSettings((settings) => {
    settings.set.lengthMode = 'count';
    settings.set.count = 12;
    settings.set.variants = 3;
    settings.set.randomSeed = 'ui-test';
  });
  const playlist = await actions.buildSet();
  assert.ok(playlist, 'set se nepostavil');
  assert.equal(playlist.kind, 'set');
  assert.equal(playlist.entries.length, 12);
  assert.equal(playlist.entries[0].track.id, seedTrack.id);
  assert.ok(playlist.stats.avgScore > 0.6);
  assert.equal(store.state.ui.tab, 'set');
  const html = renderPanel(store, actions, 'set');
  assert.match(html, /Postavené sety/);
  assert.match(html, /exportovat/);
});

test('přeřazení playlistu z načteného XML a uložení', () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  store.setUi({ reorderSourceRef: 'import:Moje playlisty / Techno peak' });
  const result = actions.doReorder();
  assert.ok(result, 'přeřazení neproběhlo');
  assert.equal(result.tracks.length, 7);
  assert.ok(result.after.average >= result.before.average);
  assert.ok(result.scores.length === 7 && result.notes.length === 7);
  const html = renderPanel(store, actions, 'reorder');
  assert.match(html, /Shoda před/);
  assert.match(html, /Uložit jako nový playlist/);

  const saved = actions.saveReorder();
  assert.match(saved.name, /seřazeno/);
  assert.equal(saved.trackIds.length, 7);
  assert.equal(store.state.playlists.length, 1);
  assert.equal(store.state.ui.tab, 'export');
});

test('export do rekordboxu vyrobí XML, které jde načíst zpět', () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  store.set((state) => {
    state.playlists = [
      {
        id: 'p1',
        kind: 'set',
        name: 'Páteční peak',
        trackIds: store.tracks.slice(0, 12).map((t) => t.id),
      },
      {
        id: 'p2',
        kind: 'crate',
        name: 'Deep warm-up',
        trackIds: store.tracks.slice(40, 60).map((t) => t.id),
      },
    ];
  });
  store.setSettings((settings) => {
    settings.export.folderName = 'Test Export';
  });

  const captured = [];
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  globalThis.document = {
    createElement: () => ({
      href: '',
      download: '',
      style: {},
      click() {},
      remove() {},
    }),
    body: { appendChild() {} },
  };
  URL.createObjectURL = (blob) => {
    captured.push(blob);
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};

  let result = null;
  let m3u = null;
  try {
    result = actions.exportXml();
    assert.ok(result, 'export nic nevrátil');
    assert.equal(result.playlistCount, 2);
    m3u = actions.exportM3u8();
  } finally {
    globalThis.document = previousDocument;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }

  assert.equal(captured.length, 2, 'má se stáhnout XML i M3U8');
  const reimported = parseRekordboxXml(result.xml);
  assert.equal(reimported.tracks.length, 180, 'v exportu musí být celá kolekce');
  assert.deepEqual(
    reimported.tracks.map((t) => t.location),
    store.tracks.map((t) => t.location),
    'cesty musí zůstat stejné, jinak je rekordbox nespáruje',
  );
  const folder = reimported.playlists.find((n) => n.name === 'Test Export');
  assert.ok(folder, 'chybí složka s vygenerovanými playlisty');
  assert.equal(folder.children.length, 2);
  const names = folder.children.map((c) => c.name);
  assert.deepEqual(names, ['Páteční peak', 'Deep warm-up']);
  const ids = new Set(reimported.tracks.map((t) => t.id));
  const expected = [
    store.tracks.slice(0, 12).map((t) => t.id),
    store.tracks.slice(40, 60).map((t) => t.id),
  ];
  folder.children.forEach((playlist, index) => {
    assert.deepEqual(playlist.trackIds, expected[index], 'pořadí tracků se musí v XML zachovat');
    assert.ok(playlist.trackIds.every((id) => ids.has(id)), 'playlist odkazuje na neexistující track');
  });
  // původní playlisty z načteného XML zůstaly
  assert.ok(reimported.playlists.some((n) => n.name === 'Moje playlisty'));

  // a M3U8 se taky vyrobí
  assert.match(m3u, /^#EXTM3U/);
  assert.match(m3u, /#PLAYLIST:Páteční peak/);
});

test('projekt (JSON) se dá uložit a načíst zpět', () => {
  const first = setup();
  first.store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  first.actions.pickSeed(first.store.tracks[3].id);
  first.store.setSettings((settings) => {
    settings.weights.key = 42;
  });
  first.actions.setEnergy(first.store.tracks[5].id, 88);
  first.store.set((state) => {
    state.playlists = [
      {
        id: 'p9',
        kind: 'set',
        name: 'Uložený set',
        trackIds: first.store.tracks.slice(0, 8).map((t) => t.id),
      },
    ];
  });
  const project = first.actions.buildProject();

  const second = setup();
  second.store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  const info = second.actions.applyProject(JSON.parse(JSON.stringify(project)));
  assert.equal(info.playlists, 1);
  assert.equal(info.missing, 0);
  assert.equal(second.store.settings.weights.key, 42);
  assert.equal(second.store.state.playlists[0].trackIds.length, 8);
  assert.equal(second.store.trackById(second.store.tracks[5].id).features.energy, 88);
  assert.ok(second.store.settings.set.seedId != null);

  // cizí JSON se odmítne
  assert.throws(() => second.actions.applyProject({ app: 'neco-jineho' }), /projekt/);
});

test('rozsah: pracuje se jen s vybraným playlistem nebo žánrem', () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');

  actions.toggleScope('import:Moje playlisty / Techno peak');
  assert.equal(store.state.scope.mode, 'playlists');
  assert.equal(store.scopedTracks().length, 7);
  assert.equal(store.visibleTracks().length, 7);
  const html = renderPanel(store, actions, 'collection');
  assert.match(html, /Rozsah práce/);
  assert.match(html, /Pracuješ s <strong>7<\/strong>/);
  assert.match(html, /Tracků v rozsahu/);

  actions.setGenreScope('Drum & Bass');
  assert.equal(store.state.scope.mode, 'genre');
  assert.equal(store.scopedTracks().length, 20);
  assert.ok(store.scopedTracks().every((t) => t.genre === 'Drum & Bass'));

  actions.showAllTracks();
  assert.equal(store.state.scope.mode, 'all');
  assert.equal(store.scopedTracks().length, 180);
});

test('generátory respektují rozsah a neutečou mimo něj', async () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  actions.setGenreScope('Drum & Bass');
  const scopedIds = new Set(store.scopedTracks().map((t) => t.id));

  const crates = await actions.buildCrates();
  assert.ok(crates.length >= 1);
  assert.ok(crates.every((c) => c.trackIds.every((id) => scopedIds.has(id))), 'playlist obsahuje track mimo rozsah');

  const set = await actions.buildSet();
  assert.ok(set.trackIds.length > 0);
  assert.ok(set.trackIds.every((id) => scopedIds.has(id)), 'set obsahuje track mimo rozsah');
  assert.ok(set.entries.every((e) => e.track.genre === 'Drum & Bass'));
});

test('DnB režim: hodinový set počítá ~29 tracků podle rychlého mixování', async () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  actions.applyDnbMode();
  assert.equal(store.settings.setPreset, 'dnb');
  assert.equal(store.settings.set.mixStyle, 'quick');
  assert.equal(store.settings.set.curve, 'peaktime');
  assert.deepEqual(store.settings.weights, { ...WEIGHTS_DNB });

  const html = renderPanel(store, actions, 'set');
  assert.match(html, /DnB režim/);
  assert.match(html, /29 tracků na 60 min/);

  store.setSettings((settings) => {
    settings.set.variants = 1;
  });
  actions.setGenreScope('Drum & Bass');
  const set = await actions.buildSet();
  assert.ok(set.entries.length > 5);
  assert.equal(set.stats.secondsPerTrack, 125);
  assert.ok(Math.abs(set.stats.mixTime - set.entries.length * 125) < 5);
  assert.ok(set.entries.every((e) => e.track.genre === 'Drum & Bass'));
});

test('DnB demo: hodinový set má ~29 tracků z DnB tracků', async () => {
  const { store, actions } = setup();
  actions.loadDnbDemo();
  assert.equal(store.tracks.length, 140);
  assert.equal(store.state.scope.mode, 'genre');
  assert.equal(store.scopedTracks().length, 140);
  assert.ok(store.tracks.every((t) => t.genre === 'Drum & Bass'));
  assert.ok(store.availableScopes().some((s) => s.label.includes('Liquid warm-up')), 'chybí demo playlisty');

  const scopes = store.availableScopes().map((s) => s.label);
  assert.ok(scopes.includes('DnB demo sady / Neurofunk peak'));

  // automatika sama pozná DnB a zvolí rychlé mixování
  store.setSettings((settings) => {
    settings.set.variants = 1;
  });
  const set = await actions.buildSet();
  assert.ok(set.entries.length >= 27 && set.entries.length <= 31, `hodinový set má ${set.entries.length} tracků`);
  assert.equal(set.stats.secondsPerTrack, 125);
  assert.ok(Math.abs(set.stats.mixTime - 3600) < 400);
  assert.ok(set.entries.every((e) => e.track.genre === 'Drum & Bass'));

  // a přes playlist se dá pracovat s menším rozsahem
  const neuroScope = store.availableScopes().find((s) => s.label.includes('Neurofunk peak'));
  assert.ok(neuroScope && neuroScope.count > 5, 'playlist Neurofunk peak je prázdný');
  actions.toggleScope(neuroScope.key);
  assert.equal(store.state.scope.mode, 'playlists');
  assert.equal(store.scopedTracks().length, neuroScope.count);
  const neuro = await actions.buildSet();
  assert.ok(neuro.trackIds.length > 3 && neuro.trackIds.length <= neuroScope.count);
  const scopeIds = new Set(store.scopedTracks().map((t) => t.id));
  assert.ok(neuro.trackIds.every((id) => scopeIds.has(id)));
});

test('panely Export a nastavení vypíšou playlisty i ruční energie', async () => {
  const { store, actions } = setup();
  store.loadCollection(parseRekordboxXml(fixtureText), 'fixture');
  await actions.buildCrates();
  actions.setEnergy(store.tracks[1].id, 70);
  const html = renderPanel(store, actions, 'export');
  assert.match(html, /Export do rekordboxu/);
  assert.match(html, /Jak playlisty dostat do rekordboxu/);
  assert.match(html, /Ruční energie \(1\)/);
  assert.match(html, /Stáhnout XML pro rekordbox/);
  actions.resetSettings();
  assert.equal(store.settings.options.maxBpmJumpPct, 6);
});

/** Malé ID3v2.4 MP3 – jméno zmatené, tagy pěkné. */
function quickieFile() {
  const synchsafe = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
  const frame = (id, text) => {
    const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    return Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(synchsafe(body.length)), Buffer.from([0, 0]), body]);
  };
  const body = Buffer.concat([
    frame('TIT2', 'Rollercoaster'),
    frame('TPE1', 'Internoise'),
    frame('TCON', 'Neurofunk'),
    frame('TBPM', '174'),
    frame('TKEY', '8A'),
  ]);
  const header = Buffer.concat([
    Buffer.from('ID3'),
    Buffer.from([4, 0, 0]),
    Buffer.from(synchsafe(body.length)),
  ]);
  const buf = Buffer.concat([header, body, Buffer.alloc(64)]);
  return { name: '01 - Internoise_-_Roller [www.site.com].mp3', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
}

test('Quickie import udělá playlisty přímo ze souborů (bez XML)', async () => {
  const { store, actions } = setup();
  const html = renderPanel(store, actions, 'quickie');
  assert.match(html, /Quickie import/);
  assert.match(html, /drop/i);

  const added = await actions.importAudioFiles([quickieFile(), { name: 'poznámky.txt' }]);
  assert.equal(added, 1, 'textový soubor se má odmítnout');
  const item = store.state.quickie.items[0];
  assert.equal(item.artist, 'Internoise');
  assert.equal(item.title, 'Rollercoaster');
  assert.equal(item.genre, 'Neurofunk');
  assert.equal(item.bpm, 174);
  assert.equal(item.key, '8A');

  const playlists = await actions.quickieSplit();
  assert.ok(playlists.length >= 1, 'aspoň jeden playlist');
  assert.equal(store.tracks.length, 1);
  const track = store.tracks[0];
  assert.equal(track.quickie, true);
  assert.ok(track.features && Number.isFinite(track.features.energy), 'energie se dopočítá');
  assert.ok(playlists[0].trackIds.includes(track.id));
  assert.equal(store.state.ui.tab, 'crates', 'po rozdělení se jde na playlisty');

  // Knižuj jen knihovně, seznam souborů se dá vyčistit
  actions.clearQuickie();
  assert.equal(store.state.quickie.items.length, 0);
  assert.equal(store.tracks.length, 1, 'knihovna zůstane');

  // Stejný soubor znovu se nepřidá podruhé
  await actions.importAudioFiles([quickieFile()]);
  const again = await actions.quickieSplit();
  assert.equal(again.length, 0, 'duplicitní soubor se nesmí přidat');
  assert.equal(store.tracks.length, 1);
});
