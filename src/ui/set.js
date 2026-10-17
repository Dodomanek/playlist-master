/** Panel "Set z tracku": postaví set od vybraného tracku podle křivky energie. */
import { bpm, esc, pct } from '../lib/format.js';
import {
  CURVES,
  curvePoints,
  estimateTrackCount,
  MIX_STYLES,
  resolveMixStyle,
  targetEnergyAt,
  WEIGHT_PRESETS,
} from '../lib/playlists.js';
import { playlistCard } from './playlistCard.js';

function sparklineHtml(curve) {
  const points = curvePoints(curve, 40);
  const width = 300;
  const height = 54;
  const step = width / (points.length - 1);
  const path = points
    .map((value, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - (value / 100) * (height - 8) - 4).toFixed(1)}`)
    .join(' ');
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" fill="none" stroke="#a78bfa" stroke-width="2.5" />
    </svg>`;
}

function seedPicker(store) {
  const seedId = store.settings.set.seedId;
  const seed = seedId != null ? store.trackById(seedId) : null;
  const search = store.state.ui.seedSearch || '';
  let results = [];
  if (search.trim().length >= 2) {
    const needle = search.trim().toLowerCase();
    results = store.tracks
      .filter((t) => `${t.artist} ${t.name} ${t.genre} ${t.key}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }
  return `
    <div class="field">
      <label for="seed-search">Startovní track (nech prázdné = vyberu sám)</label>
      <input id="seed-search" type="search" placeholder="hledej interpreta nebo název…" value="${esc(search)}" />
    </div>
    ${
      seed
        ? `<div class="alert info" style="margin-top:10px">
            Start: <strong>${esc(seed.artist)} – ${esc(seed.name)}</strong>
            <span class="mono">· ${bpm(seed.bpm)} BPM · ${esc(
              (seed.keyParsed && seed.keyParsed.camelot) || '–',
            )} · E ${seed.features.energy}</span>
            <button class="btn ghost small" data-action="clear-seed" style="margin-left:8px">Zrušit</button>
          </div>`
        : ''
    }
    ${
      results.length
        ? `<div class="table-wrap" style="max-height:230px;margin-top:10px">
            <table class="mini-table">
              <tbody>
                ${results
                  .map(
                    (t) => `<tr data-action="pick-seed" data-track-id="${t.id}">
                      <td>${esc(t.artist)}</td>
                      <td>${esc(t.name)}</td>
                      <td class="num">${bpm(t.bpm)}</td>
                      <td><span class="pill key">${esc((t.keyParsed && t.keyParsed.camelot) || '–')}</span></td>
                      <td class="num">E ${t.features.energy}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : search.trim().length >= 2
          ? '<p class="hint" style="margin-top:8px">Nic nenalezeno.</p>'
          : ''
    }`;
}

export function setPanel(ctx) {
  const { store } = ctx;
  if (!store.state.collection) {
    return {
      html: '<div class="card"><p class="hint">Nejdřív načti kolekci v tabu <strong>Kolekce</strong>.</p></div>',
      mount() {},
    };
  }
  const settings = store.settings;
  const config = settings.set;
  const preset = WEIGHT_PRESETS[settings.setPreset] || WEIGHT_PRESETS.balanced;
  const scopedTracks = store.scopedTracks();
  const mix = resolveMixStyle(config.mixStyle, scopedTracks);
  const estimate =
    config.lengthMode === 'minutes'
      ? `${estimateTrackCount(Number(config.minutes) || 60, mix.seconds, scopedTracks)} tracků na ${
          Number(config.minutes) || 60
        } min`
      : `≈ ${Math.round(
          ((Number(config.count) || 30) * (mix.seconds || 300)) / 60,
        )} min mixu`;

  const html = `
    <div class="card">
      <h2>Set z jednoho tracku</h2>
      <p class="hint">
        Vyber track, od kterého chceš začít. Aplikace pak vybírá další tracky tak, aby seděl klíč (Camelot wheel),
        tempo a energie kopírovala zvolenou křivku setu.
      </p>
      <div class="grid cols-2">
        <div>
          ${seedPicker(store)}
          <div class="grid cols-2" style="margin-top:12px">
            <div class="field">
              <label for="length-mode">Délka setu podle</label>
              <select id="length-mode" data-setting="set.lengthMode">
                <option value="minutes" ${config.lengthMode === 'minutes' ? 'selected' : ''}>minut</option>
                <option value="count" ${config.lengthMode === 'count' ? 'selected' : ''}>počtu tracků</option>
              </select>
            </div>
            <div class="field">
              <label for="length-value">${config.lengthMode === 'minutes' ? 'Minuty' : 'Počet tracků'}</label>
              <input id="length-value" type="number" min="3" max="400" step="1"
                data-setting="${config.lengthMode === 'minutes' ? 'set.minutes' : 'set.count'}"
                value="${config.lengthMode === 'minutes' ? config.minutes : config.count}" />
            </div>
          </div>
          <div class="grid cols-2" style="margin-top:12px">
            <div class="field">
              <label for="curve">Křivka energie</label>
              <select id="curve" data-setting="set.curve">
                ${Object.entries(CURVES)
                  .map(([key, label]) => `<option value="${key}" ${config.curve === key ? 'selected' : ''}>${esc(label)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="preset">Co má hrát prim</label>
              <select id="preset" data-preset="set">
                ${Object.entries(WEIGHT_PRESETS)
                  .map(
                    ([key, p]) =>
                      `<option value="${key}" ${settings.setPreset === key ? 'selected' : ''}>${esc(p.label)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
          </div>
          <div class="grid cols-2" style="margin-top:12px">
            <div class="field">
              <label for="mix-style">Jak dlouho track v setu hraje</label>
              <select id="mix-style" data-setting="set.mixStyle">
                ${Object.entries(MIX_STYLES)
                  .map(
                    ([key, style]) =>
                      `<option value="${key}" ${config.mixStyle === key ? 'selected' : ''}>${esc(style.label)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="field" style="justify-content:flex-end">
              <div class="alert info" style="margin:0">
                <strong>${esc(estimate)}</strong>
                <span class="hint" style="display:block;margin-top:2px">
                  ${mix.auto ? 'automaticky podle žánru' : esc(mix.label)} ·
                  ${mix.seconds ? `${mix.seconds} s na track` : 'podle skutečné délky tracků'}
                </span>
              </div>
            </div>
          </div>
          ${sparklineHtml(config.curve)}
          <div class="grid cols-2" style="margin-top:12px">
            <div class="field">
              <label for="variants">Kolik variant zkusit</label>
              <div class="range-row">
                <input id="variants" type="range" min="1" max="15" step="1" value="${config.variants}" data-setting="set.variants" />
                <output>${config.variants}</output>
              </div>
            </div>
            <div class="field">
              <label for="random-seed">Semínko náhody</label>
              <input id="random-seed" type="text" value="${esc(config.randomSeed)}" data-setting="set.randomSeed" />
            </div>
          </div>
          <div class="row-actions" style="margin-top:14px">
            <button class="btn primary" data-action="build-set" ${store.state.ui.busy ? 'disabled' : ''}>
              Postavit set
            </button>
            <button class="btn" data-action="apply-dnb" title="DnB váhy + rychlé mixování + peak-time křivka">
              DnB režim
            </button>
            <span class="hint">${store.state.ui.busy ? 'Počítám…' : `Preset: ${esc(preset.label)}`}</span>
          </div>
          <p class="hint" style="margin:10px 0 0">
            Rozsah: pracuješ s <strong>${scopedTracks.length}</strong> tracky${
              scopedTracks.length !== store.tracks.length ? ` z ${store.tracks.length}` : ''
            } – rozsah změníš v tabu Kolekce.
          </p>
        </div>
        <div>
          <details class="settings">
            <summary>Tolerance a detailní nastavení</summary>
            <div class="grid cols-2">
              <div class="field">
                <label for="max-bpm">Max. skok BPM (%)</label>
                <div class="range-row">
                  <input id="max-bpm" type="range" min="1" max="20" step="0.5" value="${settings.options.maxBpmJumpPct}" data-option="maxBpmJumpPct" />
                  <output>${settings.options.maxBpmJumpPct}</output>
                </div>
              </div>
              <div class="field">
                <label for="max-energy">Max. skok energie</label>
                <div class="range-row">
                  <input id="max-energy" type="range" min="10" max="100" step="5" value="${settings.options.maxEnergyJump}" data-option="maxEnergyJump" />
                  <output>${settings.options.maxEnergyJump}</output>
                </div>
              </div>
              <div class="field">
                <label for="fit-weight">Jak moc držet křivku energie</label>
                <div class="range-row">
                  <input id="fit-weight" type="range" min="0" max="0.8" step="0.05" value="${config.fitWeight}" data-setting="set.fitWeight" />
                  <output>${config.fitWeight}</output>
                </div>
              </div>
              <div class="field">
                <label for="temperature">Rozmanitost výběru</label>
                <div class="range-row">
                  <input id="temperature" type="range" min="0" max="0.1" step="0.005" value="${config.temperature}" data-setting="set.temperature" />
                  <output>${config.temperature}</output>
                </div>
              </div>
            </div>
            <div class="grid cols-2" style="margin-top:10px">
              <label class="check">
                <input type="checkbox" data-option="allowHalfDouble" ${settings.options.allowHalfDouble ? 'checked' : ''} />
                Půl/dvojnásobek tempa bere jako kompatibilní
              </label>
              <label class="check">
                <input type="checkbox" data-option="avoidSameArtist" ${settings.options.avoidSameArtist ? 'checked' : ''} />
                Neopakovat stejného interpreta za sebou
              </label>
            </div>
          </details>
          <div class="card" style="background:var(--panel-2)">
            <h3>Co se počítá</h3>
            <p class="hint" style="margin-bottom:10px">
              Váhy složek skóre (klíč, BPM, energie, styl, tagy…) najdeš v tabu <strong>Export a nastavení</strong>.
              Aktuálně platí preset <strong>${esc(preset.label)}</strong>.
            </p>
            <div class="score-parts">
              ${Object.entries(preset.weights)
                .map(
                  ([key, value]) => `<div class="part">${esc(weightLabel(key))}: <strong>${value}</strong></div>`,
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
    ${setsHtml(ctx)}`;

  const mount = (root) => {
    const seedSearch = root.querySelector('#seed-search');
    if (seedSearch) {
      seedSearch.addEventListener('input', (event) => {
        store.setUi({ seedSearch: event.target.value }, { silent: true });
      });
      seedSearch.addEventListener('change', () => store.notify());
      seedSearch.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') store.notify();
      });
    }
  };

  return { html, mount };
}

function weightLabel(key) {
  const labels = {
    key: 'klíč',
    bpm: 'BPM',
    energy: 'energie',
    genre: 'styl',
    tags: 'tagy',
    rating: 'hodnocení',
    meta: 'label/artist',
  };
  return labels[key] || key;
}

function setsHtml(ctx) {
  const { store } = ctx;
  const sets = store.state.playlists.filter((p) => p.kind === 'set');
  if (!sets.length) {
    return `<div class="card"><div class="empty">Zatím žádný set. Postav první – nebo si vyber track v tabu Kolekce a klikni na „Postavit set od tohoto tracku“.</div></div>`;
  }
  return `
    <div class="card">
      <h2>Postavené sety (${sets.length})</h2>
      <p class="hint">Zaškrtnutím „exportovat“ rozhoduješ, co se zapíše do XML pro rekordbox.</p>
      ${sets.map((p) => playlistCard(ctx, p)).join('')}
    </div>`;
}

export { targetEnergyAt };
