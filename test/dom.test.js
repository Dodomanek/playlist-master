/**
 * Test skutečného UI: index.html + src/main.js se spustí v jsdom a odkliká se
 * celý tok (demo data → playlisty → export). Ověřuje to i DOM wiring, který
 * jednotkové testy nepokrývají.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { parseRekordboxXml } from '../src/lib/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const fixtureText = readFileSync(resolve(root, 'fixtures', 'sample-collection.xml'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');

const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function click(element) {
  element.dispatchEvent(new element.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function bootApp() {
  const dom = new JSDOM(indexHtml, {
    url: 'http://localhost:3000/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const define = (name, value) => {
    try {
      globalThis[name] = value;
    } catch {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
  };
  define('window', window);
  define('document', window.document);
  define('HTMLElement', window.HTMLElement);
  define('MouseEvent', window.MouseEvent);
  define('Event', window.Event);
  define('localStorage', window.localStorage);
  define('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  window.fetch = globalThis.fetch = async (url) => {
    if (String(url).includes('demo-collection.xml')) {
      return { ok: true, status: 200, text: async () => fixtureText };
    }
    throw new Error(`Neočekávaný požadavek na ${url}`);
  };
  const downloads = [];
  const createObjectURL = (blob) => {
    downloads.push(blob);
    return 'blob:test';
  };
  globalThis.URL.createObjectURL = createObjectURL;
  globalThis.URL.revokeObjectURL = () => {};

  await import('../src/main.js');
  await tick();
  return { dom, window, downloads };
}

test('aplikace se nastartuje a odkliká celý tok: demo → playlisty → export', async () => {
  const { window, downloads } = await bootApp();
  const document = window.document;

  // 1) úvodní stav
  assert.match(document.getElementById('status').textContent, /Zatím není načtená/);
  assert.match(document.querySelector('.panel[data-panel="collection"]').innerHTML, /Nejdřív načteme kolekci/);

  // 2) demo data
  click(document.getElementById('demo-btn'));
  await tick(200);
  const status = document.getElementById('status').textContent;
  assert.match(status, /180 tracků/);
  const collectionHtml = document.querySelector('.panel[data-panel="collection"]').innerHTML;
  assert.match(collectionHtml, /Nejčastější styly/);
  assert.equal(document.querySelectorAll('.panel[data-panel="collection"] tbody tr').length, 180);

  // 3) proklik na track v tabulce → detail s navazujícími tracky
  const thirdRow = document.querySelectorAll('.panel[data-panel="collection"] tbody tr')[2];
  click(thirdRow);
  await tick();
  assert.match(document.querySelector('.side').innerHTML, /Nejlepší navazující tracky/);
  assert.ok(document.querySelectorAll('.side li[data-track-id]').length > 0, 'bez podobných tracků');

  // 4) tlačítko "Postavit set od tohoto tracku" přepne tab a nastaví seed
  click(document.querySelector('.panel[data-panel="collection"] [data-action="use-seed"]'));
  await tick();
  assert.ok(document.querySelector('.panel[data-panel="set"]').classList.contains('active'));

  // 5) postavíme set
  document.querySelector('#variants').value = '2';
  click(document.querySelector('.panel[data-panel="set"] [data-action="build-set"]'));
  await tick(400);
  const setHtml = document.querySelector('.panel[data-panel="set"]').innerHTML;
  assert.match(setHtml, /Postavené sety/);
  assert.ok(document.querySelectorAll('.panel[data-panel="set"] .playlist').length >= 1, 'set se nevykreslil');
  assert.match(document.getElementById('status').textContent, /1 playlistů/);

  // 6) auto playlisty z celé kolekce
  click(document.querySelector('#tabs .tab[data-tab="crates"]'));
  await tick();
  click(document.querySelector('.panel[data-panel="crates"] [data-action="build-crates"]'));
  await tick(1200);
  const cratesHtml = document.querySelector('.panel[data-panel="crates"]').innerHTML;
  assert.match(cratesHtml, /Vygenerované playlisty/);
  assert.ok(document.querySelectorAll('.panel[data-panel="crates"] .playlist').length >= 3, 'málo playlistů');

  // 7) export: XML se stáhne a jde naparsovat
  click(document.querySelector('#tabs .tab[data-tab="export"]'));
  await tick();
  const exportHtml = document.querySelector('.panel[data-panel="export"]').innerHTML;
  assert.match(exportHtml, /Stáhnout XML pro rekordbox/);
  assert.match(exportHtml, /Jak playlisty dostat do rekordboxu/);
  const exportButton = document.querySelector('.panel[data-panel="export"] [data-action="export-xml"]');
  assert.equal(exportButton.disabled, false, 'tlačítko exportu musí být aktivní');
  click(exportButton);
  await tick(200);
  assert.equal(downloads.length, 1, 'XML se nemělo stáhnout');
  const xml = await downloads[0].text();
  const parsed = parseRekordboxXml(xml);
  assert.equal(parsed.tracks.length, 180);
  const generated = parsed.playlists.find((n) => n.name.startsWith('Set Builder'));
  assert.ok(generated, 'chybí vygenerovaná složka');
  assert.ok(generated.children.length >= 4, `očekáváme aspoň 4 playlisty, je ${generated.children.length}`);
  const ids = new Set(parsed.tracks.map((t) => t.id));
  assert.ok(generated.children.every((p) => p.trackIds.every((id) => ids.has(id))));
  assert.ok(generated.children.every((p) => p.trackIds.length > 0));

  // 8) řazení playlistu (vygenerovaný playlist z nabídky)
  click(document.querySelector('#tabs .tab[data-tab="reorder"]'));
  await tick();
  click(document.querySelector('.panel[data-panel="reorder"] [data-action="do-reorder"]'));
  await tick(200);
  assert.match(document.querySelector('.panel[data-panel="reorder"]').innerHTML, /Shoda před/);
  click(document.querySelector('.panel[data-panel="reorder"] [data-action="save-reorder"]'));
  await tick(200);
  assert.match(document.getElementById('status').textContent, /playlistů/);

  // 9) filtr v kolekci a řazení podle BPM
  click(document.querySelector('#tabs .tab[data-tab="collection"]'));
  await tick();
  click(document.querySelector('.panel[data-panel="collection"] th[data-column="bpm"]'));
  await tick();
  const bpmCells = [...document.querySelectorAll('.panel[data-panel="collection"] tbody tr')].slice(0, 5).map((tr) =>
    Number(tr.children[3].textContent),
  );
  assert.ok(bpmCells.every((value, index) => index === 0 || value >= bpmCells[index - 1]), 'třídění podle BPM nefunguje');

  const search = document.querySelector('.panel[data-panel="collection"] #search');
  search.value = 'techno';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  search.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(450);
  const filtered = document.querySelectorAll('.panel[data-panel="collection"] tbody tr');
  assert.ok(filtered.length > 0 && filtered.length < 180, 'vyhledávání nefiltruje');

  // 10) přepnutí checkboxu u playlistu ovlivní export
  click(document.querySelector('#tabs .tab[data-tab="export"]'));
  await tick();
  const headings = () => [...document.querySelectorAll('.panel[data-panel="export"] h2')].map((h) => h.textContent);
  const selectionHeading = () => headings().find((text) => text.startsWith('Playlisty k exportu'));
  const parseHeading = (text) => text.match(/\((\d+) z (\d+)\)/).slice(1).map(Number);
  const [selectedBefore, totalBefore] = parseHeading(selectionHeading());
  assert.ok(totalBefore >= 4);

  const firstCheckbox = document.querySelector('.panel[data-panel="export"] tbody input[type="checkbox"]');
  assert.ok(firstCheckbox.checked);
  firstCheckbox.checked = false;
  firstCheckbox.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const [selectedAfter, totalAfter] = parseHeading(selectionHeading());
  assert.equal(selectedAfter, selectedBefore - 1, 'odebraný playlist se musí propustit z výběru pro export');
  assert.equal(totalAfter, totalBefore);
  assert.ok(document.querySelector('.panel[data-panel="export"] button[data-action="clear-collection"]'));

  // 11) DnB režim: hodinový set se počítá na ~29 tracků (rychlé mixování)
  click(document.querySelector('#tabs .tab[data-tab="set"]'));
  await tick();
  click(document.querySelector('.panel[data-panel="set"] [data-action="apply-dnb"]'));
  await tick();
  assert.equal(document.querySelector('#mix-style').value, 'quick');
  assert.equal(document.querySelector('#preset').value, 'dnb');
  assert.match(document.querySelector('.panel[data-panel="set"]').innerHTML, /29 tracků na 60 min/);

  // 12) rozsah: jen jeden playlist místo celé knihovny
  click(document.querySelector('#tabs .tab[data-tab="collection"]'));
  await tick();
  const searchAgain = document.querySelector('.panel[data-panel="collection"] #search');
  searchAgain.value = '';
  searchAgain.dispatchEvent(new window.Event('input', { bubbles: true }));
  searchAgain.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(450);
  assert.equal(document.querySelectorAll('.panel[data-panel="collection"] tbody tr').length, 180);

  const scopeChip = document.querySelector('[data-action="scope-toggle"][data-scope-key="import:Moje playlisty / Warm-up Deep"]');
  assert.ok(scopeChip, 'chybí přepínač rozsahu pro importovaný playlist');
  click(scopeChip);
  await tick();
  assert.equal(
    document.querySelectorAll('.panel[data-panel="collection"] tbody tr').length,
    6,
    'po zúžení na playlist má tabulka ukazovat jen jeho tracky',
  );
  assert.match(document.querySelector('.panel[data-panel="collection"]').innerHTML, /Pracuješ s <strong>6<\/strong>/);

  click(document.querySelector('[data-action="scope-all"]'));
  await tick();
  assert.equal(document.querySelectorAll('.panel[data-panel="collection"] tbody tr').length, 180);

  // 13) DnB demo + DnB režim: hodinový set se vejde do ~29 tracků
  click(document.getElementById('dnb-demo-btn'));
  await tick(250);
  assert.match(document.getElementById('status').textContent, /140 tracků/);
  assert.equal(document.querySelectorAll('.panel[data-panel="collection"] tbody tr').length, 140);
  assert.match(document.querySelector('.panel[data-panel="collection"]').innerHTML, /Pracuješ jen se žánrem/);

  click(document.querySelector('#tabs .tab[data-tab="set"]'));
  await tick();
  document.querySelector('.panel[data-panel="set"] #length-value').value = '60';
  document.querySelector('.panel[data-panel="set"] #length-value').dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  click(document.querySelector('.panel[data-panel="set"] [data-action="build-set"]'));
  await tick(700);
  const dnbSetHtml = document.querySelector('.panel[data-panel="set"]').innerHTML;
  assert.match(dnbSetHtml, /29 tracků/);
  assert.match(document.getElementById('status').textContent, /DnB demo/);
});

test('Quickie tab má dropzonu a Auto playlisty umí rozdělit DnB podle subžánru', async () => {
  // tab Quickie: dropzona, file input, tlačítka
  click(document.querySelector('#tabs .tab[data-tab="quickie"]'));
  await tick();
  const html = document.querySelector('.panel[data-panel="quickie"]').innerHTML;
  assert.match(html, /Quickie import/);
  assert.ok(document.querySelector('#quickie-drop'), 'chybí dropzona');
  assert.ok(document.querySelector('#quickie-input[multiple]'), 'chybí file input pro více souborů');
  assert.match(html, /vyčistí zmatené názvy/);
  assert.match(html, /Zatím žádné soubory/);

  // auto playlisty: přepínač rozdělení DnB je zapnutý ve výchozím nastavení
  click(document.getElementById('dnb-demo-btn'));
  await tick(250);
  click(document.querySelector('#tabs .tab[data-tab="crates"]'));
  await tick();
  const checkbox = document.querySelector('.panel[data-panel="crates"] input[data-setting="crates.splitByDnb"]');
  assert.ok(checkbox, 'chybí přepínač „Rozdělit DnB podle subžánru“');
  assert.equal(checkbox.checked, true, 'výchozí stav má být zapnutý');

  click(document.querySelector('.panel[data-panel="crates"] [data-action="build-crates"]'));
  await tick(900);
  const cratesHtml = document.querySelector('.panel[data-panel="crates"]').innerHTML;
  assert.match(cratesHtml, /Vygenerované playlisty/);
  assert.match(cratesHtml, /(Neurofunk|Jungle|Liquid|Jump Up|Rollers|Halftime)/, 'názvy playlistů mají nést subžánry DnB');
});
