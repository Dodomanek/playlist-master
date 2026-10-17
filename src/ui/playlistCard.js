/** Sdílená karta playlistu (set i crate) s tracklistou a hodnocením přechodů. */
import { bpm, esc, formatDuration, pct, scoreClass } from '../lib/format.js';

export function playlistSummary(playlist) {
  const stats = playlist.stats || {};
  const parts = [];
  if (stats.count) parts.push(`${stats.count} tracků`);
  if (stats.mixTime) parts.push(`${formatDuration(stats.mixTime)} mixu`);
  else if (stats.totalTime) parts.push(formatDuration(stats.totalTime));
  if (stats.secondsPerTrack && stats.mixTime) parts.push(`${Math.round(stats.secondsPerTrack)} s/track`);
  if (stats.bpmMin) parts.push(`${bpm(stats.bpmMin)}–${bpm(stats.bpmMax)} BPM`);
  if (Number.isFinite(stats.avgScore)) parts.push(`shoda ${pct(stats.avgScore)}`);
  if (Number.isFinite(stats.energyMin)) parts.push(`energie ${stats.energyMin}–${stats.energyMax}`);
  return parts.join(' · ');
}

export function trackRowHtml(entry, index, options = {}) {
  const track = entry.track || entry;
  const features = track.features || {};
  const score = Number.isFinite(entry.score) && index > 0 ? entry.score : null;
  const weak = score != null && (score < 0.55 || (entry.parts && entry.parts.key < 0.4));
  const energyDelta =
    Number.isFinite(entry.targetEnergy) && Number.isFinite(features.energy) ? features.energy - entry.targetEnergy : null;
  return `
    <li class="${weak ? 'weak' : ''}" data-track-id="${track.id}">
      <span class="idx">${index + 1}</span>
      <span class="who">${esc(track.artist)} <span class="artist">– ${esc(track.name)}</span></span>
      <span class="tags">
        ${score != null ? `<span class="pill ${scoreClass(score)}">${pct(score)}</span>` : '<span class="pill">start</span>'}
        <span class="mono">${bpm(track.bpm)} BPM · ${esc((track.keyParsed && track.keyParsed.camelot) || '–')} · E ${
          features.energy != null ? features.energy : '–'
        }${energyDelta != null ? ` (plán ${entry.targetEnergy}, ${energyDelta >= 0 ? '+' : ''}${energyDelta})` : ''}</span>
      </span>
      ${options.showNotes !== false && entry.notes ? `<span class="notes">${esc(entry.notes)}</span>` : ''}
    </li>`;
}

export function playlistCard(ctx, playlist, options = {}) {
  const entries = playlist.entries && playlist.entries.length ? playlist.entries : playlist.tracks.map((t) => ({ track: t }));
  const stats = playlist.stats || {};
  const open = entries.length <= 25 ? 'open' : '';
  const weakCount = entries.filter((e) => Number.isFinite(e.score) && e.score < 0.55 && e !== entries[0]).length;
  return `
    <div class="playlist" data-playlist-id="${esc(playlist.id)}">
      <div class="playlist-head">
        <div>
          <h4>${esc(playlist.name)}</h4>
          <div class="meta">${esc(playlistSummary(playlist))}</div>
        </div>
        <div class="row-actions">
          <label class="check" title="Zařadit do exportu pro rekordbox">
            <input type="checkbox" data-action="toggle-playlist" data-playlist-id="${esc(playlist.id)}" ${
              playlist.selected === false ? '' : 'checked'
            } />
            exportovat
          </label>
          ${
            options.allowReorder !== false
              ? `<button class="btn ghost small" data-action="reorder-playlist" data-playlist-id="${esc(
                  playlist.id,
                )}">Přeřadit</button>`
              : ''
          }
          <button class="btn ghost small" data-action="rename-playlist" data-playlist-id="${esc(playlist.id)}">Přejmenovat</button>
          <button class="btn ghost small" data-action="remove-playlist" data-playlist-id="${esc(playlist.id)}">Odebrat</button>
        </div>
      </div>
      ${
        weakCount
          ? `<div class="hint" style="padding:8px 14px 0">Pozor: ${weakCount} ${
              weakCount === 1 ? 'přechod má' : 'přechodů má'
            } slabší shodu – zkus jinou variantu, jinou křivku nebo mírnější tolerance.</div>`
          : ''
      }
      ${
        stats.keys && stats.keys.length
          ? `<div class="hint" style="padding:8px 14px 0">Převažující klíče: ${esc(
              stats.keys.map(([k, c]) => `${k} ×${c}`).join(', '),
            )}</div>`
          : ''
      }
      <details ${open}>
        <summary style="cursor:pointer;padding:10px 14px;color:var(--accent-soft);font-size:13.5px">
          Zobrazit tracklist (${entries.length})
        </summary>
        <ul class="tracklist">
          ${entries.map((entry, index) => trackRowHtml(entry, index, options)).join('')}
        </ul>
      </details>
    </div>`;
}
