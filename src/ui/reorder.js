/** Panel "Uspořádat playlist": přeřadí playlist tak, aby na sebe tracky navazovaly. */
import { esc, formatDuration, pct, scoreClass } from '../lib/format.js';
import { trackRowHtml } from './playlistCard.js';

function sourceOptions(store) {
  const imported = [];
  const walk = (nodes, path) => {
    for (const node of nodes || []) {
      if (node.type === 'folder') walk(node.children, [...path, node.name]);
      else imported.push({ value: `import:${[...path, node.name].join(' / ')}`, label: `Import: ${[...path, node.name].join(' / ')}` });
    }
  };
  if (store.state.collection) walk(store.state.collection.playlists, []);
  const generated = store.state.playlists.map((p) => ({ value: `gen:${p.id}`, label: `Vygenerovaný: ${p.name} (${p.trackIds.length})` }));
  return [...generated, ...imported];
}

export function reorderPanel(ctx) {
  const { store } = ctx;
  if (!store.state.collection) {
    return {
      html: '<div class="card"><p class="hint">Nejdřív načti kolekci v tabu <strong>Kolekce</strong>.</p></div>',
      mount() {},
    };
  }
  const options = sourceOptions(store);
  const current = store.state.ui.reorderSourceRef || (options[0] ? options[0].value : '');
  const result = store.state.ui.reorderResult;

  return {
    html: `
      <div class="card">
        <h2>Uspořádat playlist podle harmonie</h2>
        <p class="hint">
          Vyber playlist (z načteného XML nebo vygenerovaný v této aplikaci) a aplikace ho přeřadí tak, aby na sebe
          tracky plynule navazovaly – od nejklidnějšího tracku dál, s ohledem na klíč, tempo a energii.
        </p>
        <div class="grid cols-2">
          <div class="field">
            <label for="reorder-source">Playlist</label>
            <select id="reorder-source">
              ${options
                .map((o) => `<option value="${esc(o.value)}" ${o.value === current ? 'selected' : ''}>${esc(o.label)}</option>`)
                .join('')}
            </select>
          </div>
          <div class="row-actions" style="align-items:flex-end">
            <button class="btn primary" data-action="do-reorder">Přeřadit</button>
            ${result ? '<button class="btn" data-action="save-reorder">Uložit jako nový playlist</button>' : ''}
          </div>
        </div>
        ${options.length ? '' : '<p class="hint" style="margin-top:10px">V XML nejsou žádné playlisty a nic jsme ještě nevygenerovali.</p>'}
      </div>
      ${result ? resultHtml(result) : ''}`,
    mount() {},
  };
}

function resultHtml(result) {
  const before = result.before || { average: 0, problems: [] };
  const after = result.after || { average: 0, problems: [] };
  const better = after.average > before.average + 0.001;
  return `
    <div class="card">
      <h2>${esc(result.name)}</h2>
      <div class="grid cols-4">
        <div class="stat">
          <div class="label">Shoda před</div>
          <div class="value">${pct(before.average)}</div>
          <div class="sub">${before.problems.length} slabých přechodů</div>
        </div>
        <div class="stat">
          <div class="label">Shoda po</div>
          <div class="value" style="color:${better ? 'var(--good)' : 'var(--text)'}">${pct(after.average)}</div>
          <div class="sub">${after.problems.length} slabých přechodů</div>
        </div>
        <div class="stat">
          <div class="label">Tracků</div>
          <div class="value">${result.tracks.length}</div>
          <div class="sub">${formatDuration(result.tracks.reduce((a, t) => a + (t.totalTime || 0), 0))}</div>
        </div>
        <div class="stat">
          <div class="label">Zlepšení</div>
          <div class="value" style="color:${better ? 'var(--good)' : 'var(--muted)'}">
            ${better ? '+' : ''}${((after.average - before.average) * 100).toFixed(1)} pb
          </div>
          <div class="sub">${result.improved === false ? 'původní pořadí už bylo dobré' : 'nové pořadí'}</div>
        </div>
      </div>
      ${
        after.problems.length
          ? `<div class="alert warn" style="margin-top:12px">I po přeřazení zbývají slabší místa: ${after.problems
              .slice(0, 4)
              .map((p) => `#${p.index + 1} (${esc(p.reason)})`)
              .join(', ')}. Zkus vyhodit track s nekompatibilním klíčem nebo změnit váhy.</div>`
          : '<div class="alert info" style="margin-top:12px">Všechny přechody v playlistu teď mají slušnou shodu.</div>'
      }
      <ul class="tracklist" style="margin-top:10px">
        ${result.tracks
          .map((track, index) =>
            trackRowHtml(
              {
                track,
                score: index === 0 ? null : result.scores[index],
                notes: result.notes[index],
              },
              index,
            ),
          )
          .join('')}
      </ul>
      <p class="hint">
        Barevné hodnocení u každého tracku je shoda s předchozím trackem. Po uložení playlist najdeš v tabu
        <strong>Export a nastavení</strong>.
      </p>
    </div>`;
}

export { scoreClass };
