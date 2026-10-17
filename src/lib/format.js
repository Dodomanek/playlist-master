/** Drobné pomocníky pro UI (formátování, stahování souborů). */

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function pct(value, digits = 0) {
  if (!Number.isFinite(value)) return '–';
  return `${(value * 100).toFixed(digits)} %`;
}

export function bpm(value) {
  if (!Number.isFinite(value)) return '–';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function scoreClass(value) {
  if (!Number.isFinite(value)) return '';
  if (value >= 0.78) return 'good';
  if (value >= 0.6) return 'warn';
  return 'bad';
}

export function download(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}`;
}

export function safeFileName(name) {
  return String(name || 'playlisty')
    .replace(/[^\w\s.()-]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Soubor se nepodařilo přečíst.'));
    reader.readAsText(file);
  });
}

export function debounce(fn, delay = 160) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
