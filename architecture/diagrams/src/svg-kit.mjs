/** Small SVG kit: boxes, panels, arrows, notes — shared by every ThreadLens diagram. */
export const C = {
  ink: '#16222e', dim: '#4a5a6e', line: '#8fa0b4', paper: '#f5f8fc', card: '#ffffff',
  blue: '#3f74b0', orange: '#c4663f', green: '#3f8f74', purple: '#7a55a6', gold: '#a8822c',
  red: '#b4453f', slate: '#5a6a7d',
};
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
export function text(x, y, s, o = {}) {
  const { size = 13, weight = 400, fill = C.ink, anchor = 'start', mono = false, spacing = 0, opacity = 1 } = o;
  const family = mono ? "ui-monospace,'SF Mono',Menlo,Consolas,monospace" : "'Helvetica Neue',Helvetica,Arial,sans-serif";
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ''}${opacity !== 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
}
export function rect(x, y, w, h, o = {}) {
  const { r = 10, fill = C.card, stroke = '#cbd7e5', sw = 1.4, dash } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}
/** A component card: colour-keyed left bar, bold title, detail lines. */
export function box(x, y, w, h, title, lines = [], color = C.slate, o = {}) {
  const out = [rect(x, y, w, h, { fill: o.fill ?? C.card, stroke: tint(color, 0.55), sw: 1.5 })];
  out.push(`<path d="M${x + 1.5} ${y + 11} a9.5 9.5 0 0 1 9.5 -9.5 h0 v${h - 3} h0 a9.5 9.5 0 0 1 -9.5 -9.5 z" fill="${color}"/>`);
  out.push(`<rect x="${x + 1.5}" y="${y + 1.5}" width="6" height="${h - 3}" fill="${color}" opacity="0.9"/>`);
  out.push(text(x + 18, y + 22, title, { size: o.titleSize ?? 14, weight: 700, fill: C.ink }));
  lines.forEach((l, i) => out.push(text(x + 18, y + 42 + i * 17, l, { size: 12.5, fill: C.dim, mono: !!o.mono })));
  return out.join('');
}
/** A dashed trust/runtime boundary around several cards. */
export function panel(x, y, w, h, label, color = C.slate, o = {}) {
  return [
    rect(x, y, w, h, { fill: tint(color, 0.05), stroke: tint(color, 0.45), sw: 1.4, dash: '7 5', r: 14 }),
    text(x + 16, y + 24, label.toUpperCase(), { size: 11.5, weight: 700, fill: color, spacing: 1.1 }),
    o.note ? text(x + w - 16, y + 24, o.note, { size: 11.5, fill: tint(color, 0.85), anchor: 'end' }) : '',
  ].join('');
}
export function label(x, y, s, o = {}) {
  const size = o.size ?? 11.5;
  const w = s.length * size * 0.56 + 12;
  const anchor = o.anchor ?? 'middle';
  const rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return rect(rx, y - size + 1, w, size + 8, { r: 5, fill: '#ffffffee', stroke: 'none', sw: 0 })
    + text(x, y + 3.5, s, { size, fill: o.fill ?? C.slate, anchor, weight: o.weight ?? 600 });
}
export function arrow(path, o = {}) {
  const { color = C.line, sw = 1.8, dash, head = 'end' } = o;
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"${head === 'end' || head === 'both' ? ` marker-end="url(#a-${color.slice(1)})"` : ''}${head === 'both' || head === 'start' ? ` marker-start="url(#b-${color.slice(1)})"` : ''}/>`;
}
export function svg(w, h, body, o = {}) {
  const colors = [C.line, C.blue, C.orange, C.green, C.purple, C.gold, C.red, C.slate];
  const defs = colors.map(c => `
  <marker id="a-${c.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>
  <marker id="b-${c.slice(1)}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M10 0 L0 5 L10 10 z" fill="${c}"/></marker>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>${defs}</defs>
<rect width="${w}" height="${h}" fill="${o.bg ?? C.paper}"/>
${body}
</svg>`;
}
export function title(x, y, main, sub) {
  return text(x, y, main, { size: 27, weight: 700, fill: C.ink })
    + (sub ? text(x, y + 25, sub, { size: 13.5, fill: C.dim }) : '');
}
export function footer(x, y, s) { return text(x, y, s, { size: 11.5, fill: '#93a3b6' }); }
