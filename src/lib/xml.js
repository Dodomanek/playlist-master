/**
 * Minimalistický XML parser + serializér.
 *
 * Záměrně bez závislostí (funguje v prohlížeči i v Node), protože zpracováváme
 * jen jednoduchý formát, který exportuje rekordbox (DJ_PLAYLISTS).
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

export function decodeEntities(str) {
  return String(str).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code)) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

export function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function parseAttributes(chunk) {
  const attrs = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(chunk))) {
    attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  }
  return attrs;
}

/**
 * Naparsuje XML do stromu: { name, attrs, children, text }
 * Deklarace, komentáře, DOCTYPE a CDATA sekce přeskočí.
 */
export function parseXml(text) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const chunk = text.slice(last, m.index);
    last = re.lastIndex;
    if (chunk.trim()) {
      const top = stack[stack.length - 1];
      top.text += decodeEntities(chunk);
    }
    if (m[0].startsWith('<?') || m[0].startsWith('<!')) continue;
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[1]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[2]) {
      const node = { name: m[2], attrs: parseAttributes(m[3] || ''), children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  return root;
}

export function childNodes(node, name) {
  if (!node) return [];
  return node.children.filter((c) => !name || c.name === name);
}

export function firstChild(node, name) {
  if (!node) return null;
  return node.children.find((c) => c.name === name) || null;
}

export function findAll(node, name) {
  if (!node) return [];
  return node.children.filter((c) => c.name === name);
}

/** Serializuje atributy do tvaru ` A="1" B="x"` (včetně escapování). */
export function attrString(attrs) {
  let out = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    out += ` ${key}="${escapeXml(value)}"`;
  }
  return out;
}

export function indent(level) {
  return '  '.repeat(level);
}
