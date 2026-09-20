import { C, svg, title, panel, box, arrow, label, footer, text } from './svg-kit.mjs';
const W = 1600, H = 1330, o = [];
o.push(title(44, 56, 'ThreadLens — reconciling copies and ordering the thread',
  'src/content/message-reconciliation.ts · mergeMessages() runs over every direct email and every recovered copy in the session'));
const h = n => 42 + (n - 1) * 17 + 14;
/** Stack cards down a column, sizing each to its own line count. */
function stack(x, w, top, gap, items, color, opt = {}) {
  let y = top; const placed = [];
  for (const [t, lines, c] of items) {
    const ch = h(lines.length);
    o.push(box(x, y, w, ch, t, lines, c ?? color));
    placed.push([y, ch]);
    y += ch + gap;
  }
  if (opt.arrows) for (let i = 0; i < placed.length - 1; i++)
    o.push(arrow(`M${x + w / 2} ${placed[i][0] + placed[i][1] + 1} V${placed[i + 1][0] - 2}`, { color: opt.arrowColor ?? C.line, sw: opt.arrows === 'bold' ? 2 : 1.6 }));
  return y - gap;
}

o.push(panel(40, 100, 480, 930, 'A · mergeMessages() — the pipeline', C.blue));
stack(60, 440, 150, 30, [
  ['1 · votedOffsets()', ['group copies whose core text is identical', '(≥ 24 chars) and whose gap is offset-shaped', 'bank each gap to the quarter hour; it counts', 'once two pairs agree, or one body ≥ 160 chars']],
  ['2 · reconcile() — first pass', ['direct emails first, quoted copies after', 'same id → combine, else match() every survivor', 'exactly one candidate merges; two or more keep', 'both, unless one gap is the thread’s own offset']],
  ['3 · reconcile() — second pass', ['an offset proven by a long duplicate in pass 1', 'is fed back in, so the short copies resolve too']],
  ['4 · placeUnread()', ['a direct email whose clock could not be read', 'keeps the place the mailbox gave it: its time is', 'interpolated between readable neighbours and', 'stays flagged as an estimate, not as exact']],
  ['5 · sequence()', ['quotedBy edges → a topological order; of the', 'messages nothing blocks, the earliest clock goes', 'next; a cycle falls back to the clock alone', 'nesting that overruled a clock → orderedByQuote']],
  ['6 · resolveNamedSenders()', ['a name-only author takes the address the thread', 'shows for it: one they wrote from, one a To/Cc', 'line carries, or — for a lone first name — the', 'one person it opens. Ambiguity keeps them apart.']],
], C.blue, { arrows: 'bold', arrowColor: C.blue });

o.push(panel(550, 100, 560, 930, 'B · match(a, b) — are these one email?', C.green, { note: 'top to bottom; the first answer wins' }));
stack(570, 520, 150, 16, [
  ['same id?', ['yes → combine them'], C.green],
  ['both are direct provider emails?', ['yes → never merged on content'], C.red],
  ['sameAuthor()?', ['no → keep separate'], C.red],
  ['core() of each is non-empty?', ['the comparable text: banners, sign-off', 'and clipping notices removed'], C.green],
  ['exact?', ['identical, or one is the other’s prefix', 'and the provider said “[Message clipped]”'], C.green],
  ['imagesConflict() — and not exact ≥ 40?', ['yes → keep separate: the pictures they', 'do hold disagree'], C.red],
  ['clocks agree?', ['within 5 min when exact, else 60 s;', 'an estimated clock passes only for a body ≥ 100', '→ merge if exact, else nearCopy() decides'], C.green],
  ['gap shaped like a timezone offset?', ['exact  →  ≥ 12 chars on an offset this thread', '          has already proven', '          ≥ 40 against a provider-dated email', '          ≥ 160 otherwise', 'near-copy →  anchored clock and ≥ 160 (or ≥ 40', '          on an offset already proven)'], C.green],
  ['both dates estimated?', ['same month, day, hour and minute,', 'then nearCopy() decides'], C.green],
], C.green, { arrows: true });
o.push(text(596, 1012, 'nothing matched  →  the copies stay two separate messages', { size: 12, weight: 700, fill: C.red }));

o.push(panel(1140, 100, 420, 930, 'C · The evidence it is allowed to use', C.gold));
stack(1160, 380, 150, 16, [
  ['core(body) — what is compared', ['provider chrome removed: External email', 'banners, Caution lines, [Image: …] captions,', '“Image removed by sender”', 'everything from the sign-off onward trimmed', '(Regards · Thanks & Regards · Sent from my …)', 'NFKC, smart quotes, spacing and case folded']],
  ['imageKeys() — what a picture is', ['proxy URL ending in the original → that URL', 'data: payload → the payload itself', 'cid: → the content id', 'blob: or a bare proxy token → “?”, matches all', 'anything else → origin + path, query dropped']],
  ['Conflict, not inequality', ['one client keeps six signature logos and the', 'next keeps four, so an unequal count proves', 'nothing. Copies conflict only when the shorter', 'list is not the longer one with some missing.']],
  ['Clocks', ['SKEW = 5 min: a quoted “Sent:” is the sender’s', 'machine, a provider header is the server', 'a real offset is a quarter-hour multiple from', '14 minutes to 14 hours — nothing else counts', 'anchored = provider-dated, timezone known']],
  ['Thresholds', ['CONFIRMED 12 · EXACT 24 · SPECIFIC 40 · LONG 160', 'nearCopy(): ≥ 160 chars, ≥ 85 % of the words', 'shared, insertions only — a changed number, a', 'negation or a substitution is never a near copy']],
  ['combine() keeps the best of both', ['richest body displayed (most pictures, never a', 'clipped one over a whole one)', 'genuinely different wording kept as quotedVariants', 'best-ranked clock; recipients and attachments', 'unioned; provider metadata preserved']],
], C.gold);

o.push(panel(40, 1060, 1520, 200, 'D · Worked example — the reply that reads earlier than the message it answers', C.purple));
for (const [x, a, b] of [
  [80, 'Carol  ·  8 Sep 17:12', 'provider header · anchored'],
  [480, 'Bob  ·  9 Sep 09:04', 'quoted attribution · no zone recorded'],
  [880, 'Alice  ·  9 Sep 13:28', 'provider header · anchored'],
]) o.push(box(x, 1100, 340, 62, a, [b], C.purple));
o.push(arrow('M424 1131 H474', { color: C.purple, sw: 2 }));
o.push(arrow('M824 1131 H874', { color: C.purple, sw: 2 }));
o.push(label(449, 1120, 'quoted', { fill: C.purple }));
o.push(label(849, 1120, 'quoted', { fill: C.purple }));
o.push(box(1250, 1100, 290, 62, 'Shown in this order', ['both ends marked “Placed by the quoted reply chain”'], C.purple));
o.push(text(80, 1200, 'Bob’s 09:04 is his own client’s wall clock with no offset written down, so it reads before the 13:28 message it answers. The nesting is first-hand evidence — Alice’s client enclosed', { size: 12.5, fill: C.dim }));
o.push(text(80, 1222, 'Bob’s email inside her own — so the chain settles the order and the clocks only break the ties it leaves open. Both messages say so in the panel and in the export.', { size: 12.5, fill: C.dim }));
o.push(footer(44, 1300, 'Nothing here guesses: two copies merge only on evidence, an offset is believed only once the thread itself proves it, and a pair that stays ambiguous is shown twice rather than silently collapsed.'));
process.stdout.write(svg(W, H, o.join('\n')));
