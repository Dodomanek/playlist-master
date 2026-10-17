/** Panel "Kolekce": statistiky, rozbor, filtr, tabulka a detail tracku s podobnými tracky. */
import { bpm, debounce, esc, formatDuration, formatTime, pct, scoreClass } from '../lib/format.js';
import { computeCollectionStats } from '../lib/features.js';
import { analyzeCollection } from '../lib/analysis.js';
import { applySmartSort, orderQuality, sortModeLabel, SORT_MODES } from '../lib/sorting.js';
import { explainPair, scorePair } from '../lib/score.js';

// Chytré režimy řazení (sloupcové slouží dál přes hlavičky tabulky)
const SMART_SORTS = ['harmonic', 'energyUp', 'energyDown', 'quality', 'smooth', 'shuffle'];

// Rozbor se přepočítává jen když se změní kolekce/rozsah/filtr/energie, ne při každém renderu.
let analysisCache = { collection: null, signature: null, report: null };

function analysisFor(store, tracks) {
  const overrides = store.settings.energyOverrides || {};
  const overrideSum = Object.values(overrides).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const signature = [
    store.scopeSignature(),
    tracks.length,
    store.state.ui.search,
    store.state.ui.genre,
    store.state.ui.key,
    Object.keys(overrides).length,
    overrideSum,
  ].join('|');
  if (analysisCache.collection === store.state.collection && analysisCache.signature === signature) {
    return analysisCache.report;
  }
  const report = analyzeCollection(tracks);
  analysisCache = { collection: store.state.collection, signature, report };
  return report;
}

/** Mini graf „label – lišta – počet“ pro pásma/žebříčky. */
function meterHtml(label, value, max, suffix = '') {
  const share = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<div class="meter">
    <span class="meter-label">${esc(label)}</span>
    <span class="meter-track"><i style="width:${share}%"></i></span>
    <span class="meter-value">${value}${suffix}</span>
  </div>`;
}

/** Mapa Camelot wheelu: 24 políčka (A nahoře, B dole), intenzita podle počtu. */
function wheelHtml(wheel) {
  const max = wheel.top.length ? wheel.top[0].count : 1;
  const row = (letter) =>
    Array.from({ length: 12 }, (_, i) => {
      const camelot = `${i + 1}${letter}`;
      const count = wheel.counts[camelot] || 0;
      const level = count ? Math.min(4, 1 + Math.floor((count / max) * 3.99)) : 0;
      return `<span class="wheel-cell ${count ? '' : 'empty'} lv${level}" title="${camelot}: ${count} tracků">${
        i + 1
      }${letter}<b>${count || ''}</b></span>`;
    }).join('');
  return `<div class="wheel">
    <div class="wheel-row">${row('A')}</div>
    <div class="wheel-row">${row('B')}</div>
  </div>`;
}

/** Karta „Rozbor kolekce“ – tempo, energie, wheel, zdraví metadat, duplicity, insights. */
function analysisCard(report) {
  if (!report || !report.count) return '';
  const { bpm: bpmReport, energy, wheel, health, duplicates, eras } = report;

  const bands = bpmReport.bands
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const bandMax = bands.length ? bands[0].count : 1;
  const tempoHtml = bands.length
    ? bands.map((band) => meterHtml(`${band.from}–${band.to}`, band.count, bandMax)).join('')
    : '<p class="hint">Žádná BPM v kolekci.</p>';

  const zoneMax = Math.max(1, ...energy.zones.map((z) => z.count));
  const energyHtml = energy.zones
    .map((zone) => meterHtml(zone.label, zone.count, zoneMax, ` (${Math.round(zone.share * 100)} %)`))
    .join('');

  const weakest = health.weakest.slice(0, 3);
  const healthHtml = `<div class="health-head">
      <span class="pill ${health.score >= 80 ? 'good' : health.score >= 55 ? 'warn' : 'bad'}">${health.score}/100</span>
      <span class="hint">úplnost metadat</span>
    </div>
    ${weakest.map((field) => meterHtml(field.label, field.count, report.count, ` (${Math.round(field.share * 100)} %)`)).join('') || '<p class="hint">Všechna klíčová pole doplněná.</p>'}`;

  const dupHtml = `
    <div class="chips" style="margin-bottom:8px">
      <span class="pill ${duplicates.duplicateCount ? 'bad' : 'good'}">${duplicates.duplicates.length} skupin duplicit</span>
      <span class="pill ${duplicates.variantCount ? 'warn' : ''}">${duplicates.variants.length} sad verzí</span>
    </div>
    ${duplicates.duplicates
      .slice(0, 3)
      .map(
        (group) => `<div class="dup-group">
          <span class="who">${esc(group.tracks[0].artist)} <span class="artist">– ${esc(group.tracks[0].name)}</span></span>
          <span class="mono">${group.tracks.length}× · ${group.tracks
            .map((t) => bpm(t.bpm))
            .join('/')} BPM · ${group.tracks.map((t) => esc((t.keyParsed && t.keyParsed.camelot) || '–')).join('/')}</span>
        </div>`,
      )
      .join('')}
    ${duplicates.duplicates.length > 3 ? `<p class="hint">… a ${duplicates.duplicates.length - 3} dalších skupin.</p>` : ''}`;

  const decadesHtml = eras.decades.length
    ? eras.decades
        .slice(0, 5)
        .map((entry) => meterHtml(`${entry.decade}. léta`, entry.count, eras.decades[0].count))
        .join('') + (eras.unknown ? `<p class="hint">Bez roku: ${eras.unknown} tracků.</p>` : '')
    : '';

  return `
    <div class="card">
      <h3>Rozbor kolekce</h3>
      <p class="hint">Rozsah, ve kterém pracuješ, rozsekaný na kusy, které se dají použít při výběru a řazení.</p>
      <div class="grid cols-3 analysis-grid">
        <div class="stat">
          <div class="label">Nejčastější tempa</div>
          <div class="sub">${tempoHtml}</div>
        </div>
        <div class="stat">
          <div class="label">Energetické zóny</div>
          <div class="sub">${energyHtml}${
            energy.avg != null ? `<p class="hint">průměr ${energy.avg} · medián ${energy.median} · rozsah ${energy.spread}</p>` : ''
          }</div>
        </div>
        <div class="stat">
          <div class="label">Camelot wheel</div>
          <div class="sub">${wheelHtml(wheel)}
            <p class="hint">${wheel.filled}/${wheel.total} klíčů zastoupeno${
              wheel.missing.length ? ` · chybí ${wheel.missing.slice(0, 4).join(', ')}` : ''
            }</p>
          </div>
        </div>
      </div>
      <div class="grid cols-3 analysis-grid" style="margin-top:10px">
        <div class="stat">
          <div class="label">Zdraví metadat</div>
          <div class="sub">${healthHtml}</div>
        </div>
        <div class="stat">
          <div class="label">Duplicity a varianty</div>
          <div class="sub">${dupHtml}</div>
        </div>
        <div class="stat">
          <div class="label">Dekády vydání</div>
          <div class="sub">${decadesHtml || '<p class="hint">Roky nejsou k dispozici.</p>'}</div>
        </div>
      </div>
      ${
        report.insights.length
          ? `<div class="insights"><div class="label">Co z toho plyne</div><ul>${report.insights
              .map((line) => `<li>${esc(line)}</li>`)
              .join('')}</ul></div>`
          : ''
      }
    </div>`;
}

/** Lišta chytrého řazení: výběr režimu, kvalita pořadí a uložení jako playlist. */
function sortBarHtml(ui, quality) {
  const current = ui.sort.column;
  const options = Object.entries(SORT_MODES)
    .map(([mode, label]) => `<option value="${mode}" ${mode === current ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
  const qualityLine = quality
    ? `<span class="pill ${scoreClass(quality.average)}">shoda přechodů ${pct(quality.average)}</span>
       <span class="hint">${
         quality.problems.length
           ? `nejhorší místa: ${quality.problems
               .slice(0, 2)
               .map((p) => `#${p.index} ${esc(p.reason)}`)
               .join(' · ')}`
           : 'žádné tvrdé kolize v pořadí'
       }</span>`
    : '';
  return `
    <div class="sort-bar">
      <div class="field" style="max-width:320px">
        <label for="sort-mode">Řazení kolekce</label>
        <select id="sort-mode">${options}</select>
      </div>
      <div class="row-actions">
        <button class="btn ghost small" id="sort-direction" title="Obrátit směr">${
          ui.sort.direction === 'desc' ? '↓ sestupně' : '↑ rostoucí'
        }</button>
        <button class="btn primary small" id="save-order" title="Uložit aktuální pořadí jako playlist pro export">Uložit pořadí jako playlist</button>
      </div>
      ${qualityLine ? `<div class="sort-quality">${qualityLine}</div>` : ''}
    </div>`;
}

function emptyState() {
  return `
    <div class="card">
      <h2>Nejdřív načteme kolekci z rekordboxu</h2>
      <p class="hint">
        V rekordboxu otevři <strong>File → Export Collection in xml format</strong> a vyexportuj svou kolekci
        (nebo rovnou <code>rekordbox.xml</code>, který používáš jako most do jiných aplikací). Výsledný soubor
        načti tlačítkem „Načíst rekordbox XML“ nahoře. Data zůstávají jen u tebe v prohlížeči.
      </p>
      <div class="row-actions">
        <button class="btn primary" data-action="load-demo">Vyzkoušet na demo datech (180 tracků)</button>
      </div>
    </div>
    <div class="card">
      <h3>Co aplikace umí</h3>
      <div class="grid cols-3">
        <div class="stat">
          <div class="label">Set z tracku</div>
          <div class="sub">Vybereš track a on postaví set podle harmonie klíčů, tempa a křivky energie.</div>
        </div>
        <div class="stat">
          <div class="label">Auto playlisty</div>
          <div class="sub">Rozseká celou kolekci na playlisty, které k sobě stylově a hudebně pasují.</div>
        </div>
        <div class="stat">
          <div class="label">Uspořádání playlistu</div>
          <div class="sub">Přeřadí existující playlist tak, aby přechody mezi tracky seděly.</div>
        </div>
      </div>
    </div>`;
}

function statsCards(stats, store) {
  const keys = stats.keys.slice(0, 5).map(([k, c]) => `${k} (${c})`).join(' · ');
  const genres = stats.genres.slice(0, 4).map(([g, c]) => `${g} (${c})`).join(' · ');
  return `
    <div class="grid cols-4">
      <div class="stat">
        <div class="label">Tracků v rozsahu</div>
        <div class="value">${stats.count}</div>
        <div class="sub">${formatDuration(stats.durationTotal)} hudby${
          stats.count !== store.tracks.length ? ` (z ${store.tracks.length} v kolekci)` : ''
        }</div>
      </div>
      <div class="stat">
        <div class="label">BPM</div>
        <div class="value">${stats.bpms ? `${bpm(stats.bpms.min)}–${bpm(stats.bpms.max)}` : '–'}</div>
        <div class="sub">průměr ${stats.bpms ? bpm(stats.bpms.avg) : '–'}</div>
      </div>
      <div class="stat">
        <div class="label">Klíč znám u</div>
        <div class="value">${stats.withKey}/${stats.count}</div>
        <div class="sub">${esc(keys || 'žádné klíče')}</div>
      </div>
      <div class="stat">
        <div class="label">Nejčastější styly</div>
        <div class="value" style="font-size:15px">${esc(genres || '–')}</div>
        <div class="sub">hodnocení u ${stats.rated} tracků</div>
      </div>
    </div>`;
}

function rowHtml(track, selected, transition) {
  const f = track.features || {};
  return `
    <tr data-track-id="${track.id}" class="${selected ? 'selected' : ''}">
      <td title="${esc(track.album)}">${esc(track.artist)}</td>
      <td title="${esc(track.comments)}">${esc(track.name)}</td>
      <td>${esc(track.genre || '–')}</td>
      <td class="num">${bpm(track.bpm)}</td>
      <td><span class="pill key">${esc((track.keyParsed && track.keyParsed.camelot) || '–')}</span></td>
      <td class="num">${f.energy != null ? f.energy : '–'}</td>
      <td class="num">${f.stars ? '★'.repeat(f.stars) : '–'}</td>
      <td class="num">${formatTime(track.totalTime)}</td>
      <td>${esc(track.label || '')}</td>
      <td>${
        transition
          ? `<span class="pill ${scoreClass(transition.score)}" title="${esc(transition.notes || '')}">${pct(transition.score)}</span>`
          : '<span class="hint">start</span>'
      }</td>
    </tr>`;
}

function detailHtml(ctx) {
  const { store } = ctx;
  const track = store.trackById(store.state.ui.selectedTrackId);
  if (!track) {
    return `<div class="empty">Klikni na track v tabulce – uvidíš detail a tracky, které se k němu hodí.</div>`;
  }
  const f = track.features || {};
  const similar = store.state.ui.similar || [];
  const override = store.settings.energyOverrides[track.id];
  return `
    <div class="card">
      <h3>Detail tracku</h3>
      <h2>${esc(track.name)}</h2>
      <p class="hint">${esc(track.artist)}${track.album ? ` · ${esc(track.album)}` : ''}${
        track.year ? ` · ${esc(track.year)}` : ''
      }</p>
      <div class="chips" style="margin-bottom:12px">
        <span class="pill">${bpm(track.bpm)} BPM</span>
        <span class="pill key">${esc((track.keyParsed && track.keyParsed.camelot) || 'bez klíče')}</span>
        <span class="pill">E ${f.energy}</span>
        <span class="pill">${formatTime(track.totalTime)}</span>
        ${f.stars ? `<span class="pill">${'★'.repeat(f.stars)}</span>` : ''}
        ${f.energyManual ? '<span class="pill warn">energie ručně</span>' : ''}
      </div>
      ${f.tags && f.tags.length ? `<p class="hint">Tagy: ${esc(f.tags.join(' · '))}</p>` : ''}
      ${track.comments ? `<p class="hint">Komentář: ${esc(track.comments)}</p>` : ''}
      <div class="grid cols-2" style="margin:10px 0 12px">
        <div class="field">
          <label for="energy-override">Energie (0–100, přepíše odhad)</label>
          <div class="range-row">
            <input id="energy-override" type="range" min="0" max="100" step="1" value="${f.energy}" data-energy-for="${
              track.id
            }" />
            <output>${f.energy}</output>
          </div>
        </div>
        <div class="row-actions" style="align-items:flex-end">
          <button class="btn primary small" data-action="use-seed" data-track-id="${track.id}">Postavit set od tohoto tracku</button>
          ${
            override != null
              ? `<button class="btn ghost small" data-action="reset-energy" data-track-id="${track.id}">Zrušit ruční energii</button>`
              : ''
          }
        </div>
      </div>
      <h3 style="margin-top:16px">Nejlepší navazující tracky</h3>
      ${
        similar.length
          ? `<ul class="tracklist">${similar
              .map(
                (hit, i) => `
        <li data-track-id="${hit.track.id}" title="Kliknutím vybereš tento track">
          <span class="idx">${i + 1}</span>
          <span class="who">${esc(hit.track.artist)} <span class="artist">– ${esc(hit.track.name)}</span></span>
          <span class="tags">
            <span class="pill ${scoreClass(hit.score)}">${pct(hit.score)}</span>
            <span class="mono">${bpm(hit.track.bpm)} BPM · ${esc(
              (hit.track.keyParsed && hit.track.keyParsed.camelot) || '–',
            )} · E ${hit.track.features.energy}</span>
          </span>
          <span class="notes">${esc(hit.notes)}</span>
        </li>`,
              )
              .join('')}</ul>`
          : '<div class="empty">Vyber track a uvidíš, co na něj navazuje.</div>'
      }
    </div>`;
}

function scopeCard(store) {
  const scopes = store.availableScopes();
  const { mode, keys } = store.state.scope;
  const selected = new Set(keys);
  const scoped = store.scopedTracks();
  return `
    <div class="card">
      <h3>Rozsah práce</h3>
      <p class="hint">
        Nemusíš počítat s celou knihovnou. Klikni na playlist a aplikace bude pracovat jen s jeho tracky –
        import, hledání podobných i generování setů.
      </p>
      <div class="chips">
        <button class="chip ${mode === 'all' ? 'active' : ''}" data-action="scope-all">
          Celá kolekce (${store.tracks.length})
        </button>
        ${scopes
          .map(
            (scope) => `<button class="chip ${selected.has(scope.key) ? 'active' : ''}" data-action="scope-toggle" data-scope-key="${esc(
              scope.key,
            )}" title="${esc(scope.label)}">${esc(scope.label)} (${scope.count})</button>`,
          )
          .join('')}
      </div>
      ${
        scopes.length
          ? ''
          : '<p class="hint" style="margin:10px 0 0">Playlisty se tu objeví, když načteš XML s playlisty nebo něco vygeneruješ v tabech Set / Auto playlisty.</p>'
      }
      <div class="field" style="max-width:340px;margin-top:12px">
        <label for="scope-genre">… nebo jen jeden žánr (třeba Drum &amp; Bass)</label>
        <select id="scope-genre" data-scope-genre>
          <option value="">— celá kolekce / vybrané playlisty —</option>
          ${store.state.collection.stats.genres
            .map(
              ([genre, count]) =>
                `<option value="${esc(genre)}" ${mode === 'genre' && keys[0] === genre ? 'selected' : ''}>${esc(
                  genre,
                )} (${count})</option>`,
            )
            .join('')}
        </select>
      </div>
      ${
        mode === 'playlists' && keys.length
          ? `<p class="hint" style="margin:10px 0 0">Pracuješ s <strong>${scoped.length}</strong> tracky z ${store.tracks.length} – všechny výpočty (a i export) se týkají jen jich.</p>`
          : ''
      }
      ${
        mode === 'genre' && keys[0]
          ? `<p class="hint" style="margin:10px 0 0">Pracuješ jen se žánrem <strong>${esc(
              keys[0],
            )}</strong> – <strong>${scoped.length}</strong> tracků z ${store.tracks.length}.</p>`
          : ''
      }
    </div>`;
}

export function collectionPanel(ctx) {
  const { store } = ctx;
  const collection = store.state.collection;
  if (!collection) return { html: emptyState(), mount() {} };

  const ui = store.state.ui;
  const isSmart = SMART_SORTS.includes(ui.sort.column);
  const tracks = isSmart
    ? applySmartSort(store.visibleTracks(), ui.sort.column, store.settings)
    : store.visibleTracks();
  const shown = tracks.slice(0, ui.tableLimit);
  const scopedStats = computeCollectionStats(store.scopedTracks());
  const report = analysisFor(store, store.scopedTracks());
  // Kvalitu pořadí řešíme jen u chytrých režimů (u sloupcového řazení je to jen abeceda)
  const quality = isSmart ? orderQuality(shown, store.settings.weights, store.settings.options) : null;
  // Skóre přechodu pro každý řádek (kolik track sedí s tím předchozím v pořadí)
  const transitions = (() => {
    const out = [];
    for (let i = 1; i < shown.length; i++) {
      const pair = scorePair(shown[i - 1], shown[i], store.settings.weights, store.settings.options);
      out.push({ score: pair.score, notes: explainPair(shown[i - 1], shown[i], pair) });
    }
    return out;
  })();
  const genres = scopedStats.genres.map(([g]) => g);
  const keys = scopedStats.keys.map(([k]) => k);
  const columns = [
    ['artist', 'Interpret'],
    ['name', 'Název'],
    ['genre', 'Žánr'],
    ['bpm', 'BPM'],
    ['key', 'Klíč'],
    ['energy', 'E'],
    ['rating', '★'],
    ['time', 'Čas'],
    ['label', 'Label'],
  ];

  const html = `
    ${scopeCard(store)}
    ${statsCards(scopedStats, store)}
    ${analysisCard(report)}
    <div class="split">
      <div>
        <div class="card">
          ${sortBarHtml(ui, quality)}
          <div class="grid cols-3" style="margin-bottom:12px">
            <div class="field">
              <label for="search">Hledat (interpret, název, label, komentář)</label>
              <input id="search" type="search" placeholder="např. techno, deep, 128…" value="${esc(ui.search)}" />
            </div>
            <div class="field">
              <label for="genre-filter">Styl</label>
              <select id="genre-filter">
                <option value="">všechny</option>
                ${genres
                  .map((g) => `<option value="${esc(g)}" ${g === ui.genre ? 'selected' : ''}>${esc(g)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="key-filter">Klíč (Camelot)</label>
              <select id="key-filter">
                <option value="">všechny</option>
                ${keys
                  .map((k) => `<option value="${esc(k)}" ${k === ui.key ? 'selected' : ''}>${esc(k)}</option>`)
                  .join('')}
              </select>
            </div>
          </div>
          <div class="hint" style="margin-bottom:8px">
            ${tracks.length} tracků odpovídá filtru${tracks.length > shown.length ? ` – zobrazeno prvních ${shown.length}` : ''}
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  ${columns
                    .map(
                      ([column, label]) =>
                        `<th data-action="sort" data-column="${column}">${label}${
                          ui.sort.column === column ? (ui.sort.direction === 'asc' ? ' ▲' : ' ▼') : ''
                        }</th>`,
                    )
                    .join('')}
                  <th title="Kolikrát track sedí s předchozím v aktuálním pořadí">Navazuje</th>
                </tr>
              </thead>
              <tbody>
                ${shown
                  .map((t, i) =>
                    rowHtml(
                      t,
                      String(t.id) === String(ui.selectedTrackId),
                      i > 0 ? transitions[i - 1] : null,
                    ),
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="side">${detailHtml(ctx)}</div>
    </div>`;

  const mount = (root) => {
    const search = root.querySelector('#search');
    if (search) {
      search.addEventListener('input', (event) => {
        store.setUi({ search: event.target.value, tableLimit: 300 }, { silent: true });
      });
      search.addEventListener(
        'change',
        debounce(() => store.notify(), 200),
      );
      search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') store.notify();
      });
    }
    const genre = root.querySelector('#genre-filter');
    if (genre) genre.addEventListener('change', (e) => store.setUi({ genre: e.target.value }));
    const key = root.querySelector('#key-filter');
    if (key) key.addEventListener('change', (e) => store.setUi({ key: e.target.value }));

    const sortMode = root.querySelector('#sort-mode');
    if (sortMode) {
      sortMode.addEventListener('change', (event) => {
        store.setUi({ sort: { column: event.target.value, direction: 'asc' }, tableLimit: 300 });
      });
    }
    const sortDirection = root.querySelector('#sort-direction');
    if (sortDirection) {
      sortDirection.addEventListener('click', () => {
        const sort = store.state.ui.sort;
        store.setUi({ sort: { column: sort.column, direction: sort.direction === 'asc' ? 'desc' : 'asc' } });
      });
    }
    const saveOrder = root.querySelector('#save-order');
    if (saveOrder) {
      saveOrder.addEventListener('click', () => {
        const isSmartMode = SMART_SORTS.includes(store.state.ui.sort.column);
        const base = store.visibleTracks();
        const ordered = isSmartMode
          ? applySmartSort(base, store.state.ui.sort.column, store.settings)
          : base;
        if (ordered.length < 3) {
          store.toast('Aspoň 3 tracky, ať z toho jde udělat playlist.', 'warn');
          return;
        }
        const entries = ordered.map((track, index) => {
          if (index === 0) return { track, score: 1, notes: 'start setu' };
          const pair = scorePair(ordered[index - 1], track, store.settings.weights, store.settings.options);
          return { track, score: pair.score, notes: explainPair(ordered[index - 1], track, pair) };
        });
        const avg = entries.slice(1).reduce((sum, entry) => sum + entry.score, 0) / Math.max(1, entries.length - 1);
        const label = sortModeLabel(store.state.ui.sort.column);
        const added = store.addPlaylists([
          {
            id: `order-${Date.now().toString(36)}`,
            kind: 'order',
            name: `${label} (${ordered.length} tracků)`,
            entries,
            tracks: ordered,
            trackIds: ordered.map((t) => t.id),
            stats: {
              count: entries.length,
              totalTime: ordered.reduce((sum, t) => sum + (t.totalTime || 0), 0),
              avgScore: avg,
              keys: [],
            },
          },
        ]);
        store.toast(`Uloženo jako „${added[0].name}“ – najdeš to v Exportu.`, 'info');
      });
    }

    const energy = root.querySelector('#energy-override');
    if (energy) {
      energy.addEventListener('input', (event) => {
        const output = event.target.parentElement.querySelector('output');
        if (output) output.textContent = event.target.value;
      });
      energy.addEventListener('change', (event) => {
        ctx.actions.setEnergy(event.target.dataset.energyFor, event.target.value);
      });
    }
  };

  return { html, mount };
}
