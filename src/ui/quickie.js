/**
 * Panel "Quickie import" – styl quickiemusic.com:
 * dropneš MP3/FLAC/WAV/M4A, aplikace vyčistí zmatené názvy, přečte tagy,
 * změří BPM a klíč z audia a rozdělí playlisty podle žánru (DnB podle subžánru).
 */
import { esc } from '../lib/format.js';

function finalBpm(item) {
  if (Number.isFinite(item.bpm)) return item.bpm;
  if (item.analyzed && Number.isFinite(item.analyzed.bpm)) return item.analyzed.bpm;
  return null;
}

function finalKey(item) {
  if (item.key) return item.key;
  if (item.analyzed && item.analyzed.camelot) return item.analyzed.camelot;
  return '';
}

function statusDot(item) {
  if (item.status === 'error') return `<span class="dot bad" title="${esc(item.error || 'Chyba')}">✕</span>`;
  if (item.status === 'analyzing') return '<span class="dot warn" title="Měřím BPM a klíč…">⋯</span>';
  if (item.analyzed) return '<span class="dot good" title="Změřeno z audia">◉</span>';
  if (finalBpm(item) && finalKey(item)) return '<span class="dot good" title="Metadata kompletní">◉</span>';
  return '<span class="dot warn" title="Chybí BPM nebo klíč – změř to">◌</span>';
}

export function quickiePanel(ctx) {
  const { store } = ctx;
  const quickie = store.state.quickie;
  const items = quickie.items;
  const progress = quickie.progress;
  const analysing = Boolean(progress && progress.done < progress.total);
  const withBpm = items.filter((i) => finalBpm(i)).length;
  const withKey = items.filter((i) => finalKey(i)).length;
  const hasDnb = items.some((i) => /drum/i.test(i.genre || '') || /dnb|jungle|neuro/i.test(i.genre || ''));

  const html = `
    <div class="card">
      <h2>Quickie import – pusť sem rovnou MP3 / FLAC / WAV / M4A</h2>
      <p class="hint">
        Žádné XML, žádný rekordbox. Aplikace přečte tagy (ID3v2, FLAC, M4A), vyčistí zmatené názvy
        (<span class="mono">01 - Artist_-_Track (320kbps) [www.site.com].mp3</span> → interpret a název),
        změří BPM a tóninu rovnou z audia a pak to rozdělí na playlisty podle žánru.
        Vše zůstává ve tvém počítači.
      </p>
      <div class="dropzone" id="quickie-drop">
        <div class="dz-icon">⇩</div>
        <div class="dz-text">Přetáhni soubory kamkoli do okna, nebo je vyber tady</div>
        <label class="btn primary file-btn">
          Vybrat soubory
          <input type="file" id="quickie-input" accept="audio/*,.mp3,.flac,.wav,.m4a,.aiff,.ogg,.opus" multiple />
        </label>
      </div>
      ${
        items.length
          ? `<div class="row-actions" style="margin-top:14px">
              <button class="btn primary" data-action="quickie-split" ${store.state.ui.busy ? 'disabled' : ''}>
                Rozdělit ${items.length} tracků na playlisty
              </button>
              <button class="btn" data-action="quickie-analyze" ${analysing || store.state.ui.busy ? 'disabled' : ''}>
                Změřit BPM a klíč z audia
              </button>
              <button class="btn ghost" data-action="quickie-clear">Vyčistit seznam</button>
              <span class="hint">${
                analysing
                  ? `Měřím ${progress.done} / ${progress.total}…`
                  : `${withBpm} s BPM · ${withKey} s klíčem${hasDnb ? ' · DnB detected' : ''}`
              }</span>
            </div>
            <div class="progress"><div class="progress-bar" style="width:${
              items.length ? Math.round(((analysing ? progress.done : items.length) / items.length) * 100) : 0
            }%"></div></div>
            <p class="hint" style="margin:10px 0 0">
              Rozdělení: <strong>žánr</strong>, u DnB ještě <strong>subžánr</strong> (Neurofunk, Deep, Jungle,
              Liquid, Jump Up, Rollers, Halftime) – ty se nemíchají mezi sebou.
              Zbytek kolekce (house, techno…) jde zvlášť.
            </p>
            <div class="table-wrap">
              <table class="quickie">
                <thead>
                  <tr><th></th><th>Interpret – název</th><th>Žánr</th><th>BPM</th><th>Klíč</th><th>Zdroj</th></tr>
                </thead>
                <tbody>
                  ${items
                    .map((item) => {
                      const bpm = finalBpm(item);
                      const key = finalKey(item);
                      const audioNote =
                        item.analyzed && Number.isFinite(item.analyzed.bpm) && item.analyzed.bpm !== item.bpm
                          ? ` · audio měřilo ${item.analyzed.bpm}`
                          : '';
                      return `<tr class="${item.status === 'error' ? 'row-bad' : ''}">
                        <td>${statusDot(item)}</td>
                        <td><strong>${esc(item.artist || '—')}</strong> – ${esc(item.title || '—')}
                            <span class="artist mono">${esc(item.fileName)}</span></td>
                        <td>${esc(item.genre || '—')}</td>
                        <td class="mono" title="z tagů/názvu${esc(audioNote)}">${bpm != null ? esc(String(bpm)) : '–'}${
                          item.analyzed ? '<span class="src">audio</span>' : ''
                        }</td>
                        <td class="mono">${key ? esc(key) : '–'}${
                          item.analyzed && item.analyzed.camelot ? '<span class="src">audio</span>' : ''
                        }</td>
                        <td class="mono">${esc(item.tagSource || '—')}</td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>
            <p class="hint" style="margin-top:8px">
              Proud teče: ${items.length} souborů → vyčištěné názvy → tagy → měření audia → playlisty.
              Tracky z quickie importu nemají cestu k souboru (prohlížeč ji neumí číst) – v rekordboxu je
              spáruj přes název a umístění, nebo je používej jen pro tvorbu playlistů.
            </p>
          </div>`
          : `<div class="empty">Zatím žádné soubory. Zkus to: <span class="mono">01 - Artist_-_Track (174bpm) [www.site.com].mp3</span></div>`
      }
    </div>`;

  return {
    html,
    mount(root) {
      const dz = root.querySelector('#quickie-drop');
      if (!dz) return;
      ['dragenter', 'dragover'].forEach((name) =>
        dz.addEventListener(name, (event) => {
          event.preventDefault();
          dz.classList.add('over');
        }),
      );
      ['dragleave', 'drop'].forEach((name) =>
        dz.addEventListener(name, (event) => {
          event.preventDefault();
          dz.classList.remove('over');
        }),
      );
      dz.addEventListener('drop', (event) => {
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) ctx.actions.importAudioFiles(Array.from(files));
      });
    },
  };
}