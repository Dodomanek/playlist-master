/** Panel "Export a nastavení": zápis do rekordboxu, váhy, ruční energie, projekt. */
import { DEFAULT_OPTIONS, DEFAULT_WEIGHTS, WEIGHT_LABELS } from '../lib/score.js';
import { WEIGHT_PRESETS } from '../lib/playlists.js';
import { esc, formatDuration, pct } from '../lib/format.js';

export function exportPanel(ctx) {
  const { store } = ctx;
  const collection = store.state.collection;
  const settings = store.settings;
  const selected = store.selectedPlaylists();
  const all = store.state.playlists;
  const importedPlaylists = collection ? countImported(collection.playlists) : 0;

  return {
    html: `
      ${
        collection
          ? ''
          : `<div class="alert info">Kolekce zatím není načtená – můžeš si ale nastavit váhy a tolerance a pak se vrátit do tabu <strong>Kolekce</strong>.</div>`
      }
      <div class="card">
        <h2>Export do rekordboxu</h2>
        <p class="hint">
          Vygenerované playlisty se zapíšou do XML ve formátu, kterému rekordbox rozumí. V XML je i celá kolekce,
          takže si rekordbox tracky spolehlivě spáruje podle cest k souborům.
        </p>
        <div class="grid cols-2">
          <div class="field">
            <label for="folder-name">Složka v rekordboxu</label>
            <input id="folder-name" type="text" placeholder="např. Set Builder 17. 10." value="${esc(
              settings.export.folderName,
            )}" data-setting="export.folderName" />
          </div>
          <div class="field" style="justify-content:flex-end">
            <label class="check">
              <input type="checkbox" data-setting="export.preserveExisting" ${settings.export.preserveExisting ? 'checked' : ''} />
              Zachovat playlisty z načteného XML (${importedPlaylists})
            </label>
          </div>
        </div>
        <div class="row-actions" style="margin:14px 0">
          <button class="btn primary" data-action="export-xml" ${selected.length ? '' : 'disabled'}>
            Stáhnout XML pro rekordbox (${selected.length})
          </button>
          <button class="btn" data-action="export-m3u8" ${selected.length ? '' : 'disabled'}>M3U8</button>
          <button class="btn" data-action="export-csv" ${selected.length ? '' : 'disabled'}>CSV report</button>
          <button class="btn" data-action="export-json" ${selected.length ? '' : 'disabled'}>Projekt (JSON)</button>
          <label class="btn file-btn">
            Načíst projekt
            <input type="file" id="project-input" accept=".json,application/json" />
          </label>
        </div>
        <details class="settings" open>
          <summary>Jak playlisty dostat do rekordboxu</summary>
          <ol class="hint" style="padding-left:18px;margin:0">
            <li>V aplikaci klikni na <strong>Stáhnout XML pro rekordbox</strong>.</li>
            <li>V rekordboxu: <strong>Preferences → Advanced → rekordbox xml</strong> a nastav cestu ke staženému souboru.</li>
            <li>
              V levém stromu se objeví uzel <strong>rekordbox xml</strong> – rozbal ho, najdi složku s vygenerovanými
              playlisty a přetáhni si playlisty do svých playlistů.
            </li>
            <li>Hotovo – tracky i pořadí zůstanou, jak je aplikace poskládala.</li>
          </ol>
        </details>
      </div>

      <div class="card">
        <h2>Playlisty k exportu (${selected.length} z ${all.length})</h2>
        ${
          all.length
            ? `<div class="row-actions" style="margin-bottom:10px">
                <button class="btn small" data-action="select-all-playlists">Vybrat všechny</button>
                <button class="btn small ghost" data-action="deselect-all-playlists">Odznačit všechny</button>
              </div>
              <div class="table-wrap" style="max-height:320px">
                <table class="mini-table">
                  <thead><tr><th>Export</th><th>Název</th><th>Typ</th><th class="num">Tracků</th><th class="num">Délka</th><th class="num">Shoda</th></tr></thead>
                  <tbody>
                    ${all
                      .map(
                        (p) => `<tr>
                          <td><input type="checkbox" data-action="toggle-playlist" data-playlist-id="${esc(p.id)}" ${
                            p.selected === false ? '' : 'checked'
                          } /></td>
                          <td>${esc(p.name)}</td>
                          <td>${p.kind === 'crate' ? 'auto playlist' : 'set'}</td>
                          <td class="num">${p.trackIds.length}</td>
                          <td class="num">${formatDuration((p.stats || {}).totalTime || 0)}</td>
                          <td class="num">${p.stats && p.stats.avgScore != null ? pct(p.stats.avgScore) : '–'}</td>
                        </tr>`,
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
            : '<div class="empty">Zatím nic k exportu. Postav set nebo vygeneruj playlisty.</div>'
        }
      </div>

      <div class="card">
        <h2>Jak se počítá shoda</h2>
        <p class="hint">
          Skóre dvou tracků je vážený průměr dílčích shod. Čím víc váhy dáš některé složce, tím víc podle ní
          aplikace vybírá.
        </p>
        <div class="row-actions" style="margin-bottom:12px">
          ${Object.entries(WEIGHT_PRESETS)
            .map(
              ([key, p]) =>
                `<button class="btn small ${
                  settings.setPreset === key || settings.cratePreset === key ? '' : 'ghost'
                }" data-action="apply-preset-both" data-preset-key="${key}">${esc(p.label)}</button>`,
            )
            .join('')}
        </div>
        <div class="grid cols-2">
          ${Object.keys(DEFAULT_WEIGHTS)
            .map(
              (key) => `
            <div class="field">
              <label for="w-${key}">${esc(WEIGHT_LABELS[key] || key)}</label>
              <div class="range-row">
                <input id="w-${key}" type="range" min="0" max="50" step="1" value="${settings.weights[key]}" data-weight="${key}" />
                <output>${settings.weights[key]}</output>
              </div>
            </div>`,
            )
            .join('')}
        </div>
        <h3 style="margin-top:18px">Tvrdá pravidla</h3>
        <div class="grid cols-2">
          <div class="field">
            <label for="opt-bpm">Max. skok BPM mezi tracky (%)</label>
            <div class="range-row">
              <input id="opt-bpm" type="range" min="1" max="25" step="0.5" value="${settings.options.maxBpmJumpPct}" data-option="maxBpmJumpPct" />
              <output>${settings.options.maxBpmJumpPct}</output>
            </div>
          </div>
          <div class="field">
            <label for="opt-energy">Max. skok energie (0–100)</label>
            <div class="range-row">
              <input id="opt-energy" type="range" min="10" max="100" step="5" value="${settings.options.maxEnergyJump}" data-option="maxEnergyJump" />
              <output>${settings.options.maxEnergyJump}</output>
            </div>
          </div>
          <div class="field">
            <label for="opt-key">Minimální shoda klíče (0 = povolit vše)</label>
            <div class="range-row">
              <input id="opt-key" type="range" min="0" max="0.9" step="0.05" value="${settings.options.minKeyScore}" data-option="minKeyScore" />
              <output>${settings.options.minKeyScore}</output>
            </div>
          </div>
          <div class="field" style="justify-content:flex-end">
            <label class="check">
              <input type="checkbox" data-option="allowHalfDouble" ${settings.options.allowHalfDouble ? 'checked' : ''} />
              Půl/dvojnásobek tempa je kompatibilní
            </label>
            <label class="check">
              <input type="checkbox" data-option="avoidSameArtist" ${settings.options.avoidSameArtist ? 'checked' : ''} />
              Neopakovat interpreta za sebou
            </label>
          </div>
        </div>
        <div class="row-actions" style="margin-top:14px">
          <button class="btn small ghost" data-action="reset-settings">Vrátit výchozí nastavení</button>
        </div>
      </div>

      <div class="card">
        <h2>Ruční energie (${Object.keys(settings.energyOverrides).length})</h2>
        <p class="hint">
          Energie se odhaduje z komentářů („energy 7“), hodnocení a tempa. Kde to nesedí, přepiš ji v detailu
          tracku v tabu Kolekce – tady je přehled.
        </p>
        ${
          Object.keys(settings.energyOverrides).length
            ? `<div class="table-wrap" style="max-height:280px">
                <table class="mini-table">
                  <thead><tr><th>Track</th><th class="num">Energie</th><th></th></tr></thead>
                  <tbody>
                    ${Object.entries(settings.energyOverrides)
                      .map(([id, value]) => {
                        const track = store.trackById(id);
                        return `<tr>
                          <td>${esc(track ? `${track.artist} – ${track.name}` : `track #${id} (není v kolekci)`)}</td>
                          <td class="num"><input type="number" min="0" max="100" value="${esc(value)}" style="width:80px" data-energy-for="${esc(id)}" /></td>
                          <td><button class="btn ghost small" data-action="reset-energy" data-track-id="${esc(id)}">Zrušit</button></td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
            : '<div class="empty">Žádné ruční zásahy – energie se bere z odhadu.</div>'
        }
      </div>

      <div class="card">
        <h2>Data</h2>
        <div class="row-actions">
          <button class="btn ghost" data-action="clear-collection" ${collection ? '' : 'disabled'}>Odstranit načtenou kolekci</button>
        </div>
        <p class="hint" style="margin-top:10px">
          Nastavení a ruční energie se ukládají do tohoto prohlížeče (localStorage). Samotný XML soubor se nikam
          neposílá – všechno se počítá u tebe v prohlížeči.
        </p>
      </div>`,
    mount() {},
  };
}

function countImported(playlists) {
  let count = 0;
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === 'folder') walk(node.children);
      else count++;
    }
  };
  walk(playlists);
  return count;
}

export { DEFAULT_OPTIONS };
