/** Panel "Kolekce": statistiky, filtr, tabulka a detail tracku s podobnými tracky. */
import { bpm, debounce, esc, formatDuration, formatTime, pct, scoreClass } from '../lib/format.js';
import { computeCollectionStats } from '../lib/features.js';

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

function rowHtml(track, selected) {
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
  const tracks = store.visibleTracks();
  const shown = tracks.slice(0, ui.tableLimit);
  const scopedStats = computeCollectionStats(store.scopedTracks());
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
    <div class="split">
      <div>
        <div class="card">
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
                </tr>
              </thead>
              <tbody>
                ${shown.map((t) => rowHtml(t, String(t.id) === String(ui.selectedTrackId))).join('')}
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
