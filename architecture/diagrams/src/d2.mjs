import { C, svg, title, box, rect, arrow, label, footer, text, tint } from './svg-kit.mjs';
const W = 1560, H = 1110, o = [];
o.push(title(44, 56, 'ThreadLens — how one email becomes one chat bubble',
  'Message lifecycle across the four runtime contexts, including the on-demand inline-image round trip'));

const P = [
  { x: 200, c: 320, name: 'Mail page DOM', sub: 'Gmail · Outlook', color: C.blue },
  { x: 470, c: 590, name: 'incremental-reader', sub: 'content script', color: C.blue },
  { x: 740, c: 860, name: 'service worker', sub: 'MV3 background', color: C.orange },
  { x: 1010, c: 1130, name: 'offscreen parser', sub: 'extension document', color: C.green },
  { x: 1280, c: 1400, name: 'side panel', sub: 'React UI', color: C.purple },
];
const rows = [
  [200, 130, 'Detect', C.blue], [330, 110, 'Snapshot', C.blue],
  [440, 170, 'Parse & reconcile', C.green], [610, 150, 'Store & broadcast', C.orange],
  [760, 80, 'Render', C.purple], [840, 140, 'Inline image · on demand', C.gold],
];
for (const [y, h, name, color] of rows) {
  o.push(rect(30, y, 1500, h, { r: 8, fill: tint(color, 0.06), stroke: tint(color, 0.28), sw: 1 }));
  o.push(text(44, y + 24, name.toUpperCase(), { size: 11, weight: 700, fill: color, spacing: 0.9 }));
}
for (const p of P) {
  o.push(box(p.x, 112, 240, 58, p.name, [p.sub], p.color));
  o.push(`<line x1="${p.c}" y1="172" x2="${p.c}" y2="1000" stroke="${tint(p.color, 0.5)}" stroke-width="2" stroke-dasharray="5 5"/>`);
}
const send = (a, b, y, msg, opt = {}) => {
  const from = P[a].c, to = P[b].c, dir = to > from ? -6 : 6;
  o.push(arrow(`M${from} ${y} H${to + dir}`, { color: opt.color ?? C.slate, sw: 2, dash: opt.dash }));
  o.push(label((from + to) / 2, y - 11, msg, { fill: opt.color ?? C.slate }));
};
const self = (i, y, msg, color = C.slate) => {
  const x = P[i].c, left = i >= 3;
  o.push(arrow(left ? `M${x} ${y} h-26 v20 H${x - 6}` : `M${x} ${y} h26 v20 H${x + 6}`, { color, sw: 2 }));
  o.push(label(left ? x - 38 : x + 38, y + 16, msg, { fill: color, anchor: left ? 'end' : 'start' }));
};
/* Detect */
send(0, 1, 235, 'MutationObserver record  ·  childList, characterData, watched attributes', { color: C.blue });
self(1, 266, 'classify: body replaced / body edited / header only  →  dirty.set(el, bodyDirty)', C.blue);
self(1, 302, '250 ms debounce, deferred again while the user is scrolling  →  flush()', C.blue);
/* Snapshot */
send(1, 0, 366, 'read the thread’s own DOM order, then snapshot(el) inside requestIdleCallback', { color: C.blue });
self(1, 396, 'unchanged html + message + imageSources  →  nothing is sent', C.blue);
/* Parse */
send(1, 2, 472, 'SNAPSHOT_BATCH  { threadId, session, subject, ≤ 4 snapshots }', { color: C.orange });
send(2, 3, 506, 'ensureParser()  →  PARSER_BATCH  (one serial queue per tab)', { color: C.orange });
self(3, 536, 'parseSnapshot: inert DOM  →  own body  +  recovered history', C.green);
self(3, 574, 'threadCache.update  →  mergeMessages  →  one ordered thread', C.green);
/* Store */
send(3, 2, 642, 'ThreadData  { messages, participants, participation }', { color: C.green });
send(2, 1, 676, 'the parsed thread returns as the SNAPSHOT_BATCH response', { color: C.green });
send(1, 2, 710, 'THREAD_PARSED  { data }', { color: C.orange });
self(2, 736, "storage.session['thread:<tabId>'] = data", C.orange);
/* Render */
send(2, 4, 790, 'THREAD_UPDATED  { data, tabId }  ·  ignored by a panel on another tab', { color: C.purple });
self(4, 812, 'participant filter → search → bubbles', C.purple);
/* Image */
send(4, 2, 876, 'READ_PAGE_IMAGE  { tabId, blob: url }', { color: C.gold, dash: '6 4' });
send(2, 0, 910, 'READ_BLOB_IMAGE  →  fetch(blob:) inside the page that owns it', { color: C.gold, dash: '6 4' });
send(0, 4, 946, 'data: URL  ·  raster mime only, ≤ 8 MB, at most two fetches at a time', { color: C.gold, dash: '6 4' });

o.push(rect(30, 998, 1500, 74, { r: 10, fill: '#ffffff', stroke: '#d7e0ec' }));
o.push(text(46, 1026, 'Invalidation', { size: 13, weight: 700, fill: C.ink }));
o.push(text(150, 1026, 'hashchange · popstate · a new thread id  →  revision++, snapshot WeakMap dropped, CLEAR_THREAD sent.    Tab navigating  →  session entry removed, THREAD_CLEARED.', { size: 12, fill: C.dim }));
o.push(text(150, 1048, 'Tab closed  →  PARSER_DROP evicts the parser cache.    A batch that fails is re-queued at most twice, and nothing partial is ever cached or shown.', { size: 12, fill: C.dim }));
o.push(footer(44, 1092, 'Everything above happens inside the browser. The only outbound requests are to the provider and image hosts, made by the panel on the user’s behalf.'));
process.stdout.write(svg(W, H, o.join('\n')));
