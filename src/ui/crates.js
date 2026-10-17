/** Panel "Auto playlisty": rozdělí celou kolekci na playlisty, které drží pohromadě. */
import { esc } from '../lib/format.js';
import { computeCollectionStats } from '../lib/features.js';
import { WEIGHT_PRESETS } from '../lib/playlists.js';
import { playlistCard } from './playlistCard.js';

export function cratesPanel(ctx) {
  const { store } = ctx;
  if (!store.state.collection) {
    return {
      html: '<div class="card"><p class="hint">Nejdřív načti kolekci v tabu <strong>Kolekce</strong>.</p></div>',
      mount() {},
    };
  }
  const settings = store.settings;
  const config = settings.crates;
  const preset = WEIGHT_PRESETS[settings.cratePreset] || WEIGHT_PRESETS.genre;

  const html = `
    <div class="card">
      <h2>Automatické playlisty z celé kolekce</h2>
      <p class="hint">
        Aplikace projde kolekci a poskládá playlisty z tracků, které k sobě pasují (klíč, tempo, energie, styl).
        Každý playlist se nakonec seřadí do plynulého toku.
      </p>
      <div class="grid cols-4">
        <div class="field">
          <label for="crate-preset">Co má hrát prim</label>
          <select id="crate-preset" data-preset="crates">
            ${Object.entries(WEIGHT_PRESETS)
              .map(
                ([key, p]) =>
                  `<option value="${key}" ${settings.cratePreset === key ? 'selected' : ''}>${esc(p.label)}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div class="field">
          <label for="target-size">Cílová velikost playlistu</label>
          <div class="range-row">
            <input id="target-size" type="range" min="5" max="80" step="1" value="${config.targetSize}" data-setting="crates.targetSize" />
            <output>${config.targetSize}</output>
          </div>
        </div>
        <div class="field">
          <label for="min-size">Minimální velikost</label>
          <div class="range-row">
            <input id="min-size" type="range" min="2" max="25" step="1" value="${config.minSize}" data-setting="crates.minSize" />
            <output>${config.minSize}</output>
          </div>
        </div>
        <div class="field">
          <label for="threshold">Práh shody</label>
          <div class="range-row">
            <input id="threshold" type="range" min="0.3" max="0.85" step="0.01" value="${config.threshold}" data-setting="crates.threshold" />
            <output>${config.threshold}</output>
          </div>
        </div>
      </div>
      <div class="grid cols-3" style="margin-top:12px">
        <label class="check">
          <input type="checkbox" data-setting="crates.allowOverlap" ${config.allowOverlap ? 'checked' : ''} />
          Playlisty se smí překrývat
        </label>
        <label class="check">
          <input type="checkbox" data-setting="crates.keepSmall" ${config.keepSmall ? 'checked' : ''} />
          Nechávat i malé playlisty
        </label>
        <label class="check" title="Kolekce obsahuje aspoň 25 % DnB → rozdělí se samostatně na Neurofunk, Deep DnB, Jungle, Liquid… a zbytek kolekce jde zvlášť.">
          <input type="checkbox" data-setting="crates.splitByDnb" ${config.splitByDnb !== false ? 'checked' : ''} />
          Rozdělit DnB podle subžánru
        </label>
        <div class="field">
          <label for="crate-seed">Semínko (stejné = stejný výsledek)</label>
          <input id="crate-seed" type="text" value="${esc(config.randomSeed)}" data-setting="crates.randomSeed" />
        </div>
      </div>
      <div class="row-actions" style="margin-top:14px">
        <button class="btn primary" data-action="build-crates" ${store.state.ui.busy ? 'disabled' : ''}>
          Rozdělit kolekci na playlisty
        </button>
        <button class="btn" data-action="apply-dnb" title="DnB váhy + rychlé mixování">DnB režim</button>
        <span class="hint">${store.state.ui.busy ? 'Počítám…' : `Preset: ${esc(preset.label)} · ${esc(statsLabel(store))}`}</span>
      </div>
      ${
        store.state.scope.mode === 'playlists' && store.state.scope.keys.length
          ? `<p class="hint" style="margin:8px 0 0">Rozsah: jen ${store.scopedTracks().length} tracků z vybraných playlistů (celkem ${store.tracks.length}).</p>`
          : ''
      }
      <p class="hint" style="margin:10px 0 0">
        Tip: pro stylově čisté playlisty nech preset <strong>Žánr / styl</strong> a zvyš práh shody.
        Když chceš naopak pestřejší „crates“ napříč žánry, přepni na <strong>Vyvážené</strong> nebo
        <strong>Objevování</strong>.
      </p>
    </div>
    ${cratesHtml(ctx)}`;

  return { html, mount() {} };
}

function statsLabel(store) {
  const stats = computeCollectionStats(store.scopedTracks());
  return `${stats.count} tracků, ${stats.bpms ? `${Math.round(stats.bpms.min)}–${Math.round(stats.bpms.max)} BPM` : 'bez BPM'}`;
}

function cratesHtml(ctx) {
  const { store } = ctx;
  const crates = store.state.playlists.filter((p) => p.kind === 'crate');
  if (!crates.length) {
    return `<div class="card"><div class="empty">Zatím žádné playlisty. Klikni na „Rozdělit kolekci na playlisty“.</div></div>`;
  }
  const covered = new Set(crates.flatMap((c) => c.trackIds));
  const missing = store.tracks.filter((t) => !covered.has(t.id));
  return `
    <div class="card">
      <h2>Vygenerované playlisty (${crates.length})</h2>
      <p class="hint">
        Pokryto ${covered.size} z ${store.tracks.length} tracků.${
          missing.length
            ? ` Mimo playlisty zůstalo ${missing.length} tracků (nejčastěji kvůli prahu shody nebo malé velikosti playlistu).`
            : ' Každý track je někde zařazený.'
        }
      </p>
      <div class="row-actions" style="margin-bottom:12px">
        <button class="btn small" data-action="select-all-playlists">Vybrat všechny k exportu</button>
        <button class="btn small ghost" data-action="deselect-all-playlists">Odznačit všechny</button>
        <button class="btn small ghost" data-action="remove-crates">Zahodit vygenerované playlisty</button>
      </div>
      ${crates
        .map((crate) =>
          playlistCard(ctx, crate, {
            showNotes: false,
            extra:
              missing.length && crate.trackIds.length
                ? ''
                : '',
          }),
        )
        .join('')}
      ${
        missing.length
          ? `<details class="settings"><summary>Tracky, které nikam nepropadly (${missing.length})</summary>
              <ul class="tracklist">${missing
                .slice(0, 60)
                .map(
                  (t, i) =>
                    `<li><span class="idx">${i + 1}</span><span class="who">${esc(t.artist)} <span class="artist">– ${esc(
                      t.name,
                    )}</span></span><span class="tags mono">${esc(t.genre)} · ${t.bpm} BPM · ${esc(
                      (t.keyParsed && t.keyParsed.camelot) || '–',
                    )}</span></li>`,
                )
                .join('')}</ul>
            </details>`
          : ''
      }
    </div>`;
}
