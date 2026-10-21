/**
 * Tiny DOM helpers shared by every page's view code.
 * @module dom
 */

/** getElementById shorthand. */
export const $ = (id) => document.getElementById(id);

/** Escape text before putting it in innerHTML (database and AI text are not trusted). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Minimal, safe markdown for chat replies: escapes everything first, then turns **bold** into
 * <strong> and lines starting with "- " into a bullet list.
 */
export function mdLite(text) {
  const lines = esc(text).split('\n');
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${bullet[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim()) out.push(`<p>${line}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
