import { C, svg, title, panel, box, arrow, label, footer, text } from './svg-kit.mjs';
const W = 1560, H = 1200, o = [];
o.push(title(44, 56, 'ThreadLens — splitting one email into the messages inside it',
  'src/content/quoted-chain-parser.ts · extractEmailBody() runs once per provider message, in the offscreen document'));

/* 1 — projection */
o.push(panel(40, 100, 1480, 230, '1 · Project the DOM to flat text, keeping a map back to it', C.blue));
o.push(box(60, 136, 420, 176, 'What the parser is handed', [
  '<div class="a3s">',
  '  Thanks, approved.',
  '  <div class="gmail_attr">On 9 Sep … wrote:</div>',
  '  <blockquote class="gmail_quote">',
  '    Can you approve this?',
  '    <div>From: Carol<br>Sent: 8 Sep …</div>',
  '  </blockquote>',
  '</div>',
], C.blue, { mono: true }));
o.push(box(560, 136, 560, 176, 'project(root)  →  one string plus an index', [
  '   0   Thanks, approved.',
  '  19   On 9 Sep 2026 at 09:04 Bob wrote:',
  '  53   Can you approve this?',
  '  76   From: Carol',
  '  89   Sent: 8 September 2026 17:12',
  ' 119   To: Bob Adeyemi',
  ' 136   Subject: Warehouse balances',
], C.blue, { mono: true }));
o.push(box(1160, 136, 360, 176, 'The rules that make it reversible', [
  'block tag and <br>   →   "\\n"',
  'every <img>          →   U+FFFC',
  'runs[] { start, end, node, offset }',
  'spans  element → [start, end]',
  'point(i) binary-searches the runs',
  'slice(a,b) → Range → cloneContents,',
  'formatting ancestors restored — but',
  'never the quote wrapper around them',
], C.blue, { mono: true }));
o.push(arrow('M484 224 H556', { color: C.blue, sw: 2 }));
o.push(arrow('M1124 224 H1156', { color: C.blue, sw: 2 }));

/* 2 — header recognition */
o.push(panel(40, 360, 1480, 262, '2 · Recognise every header in that text — four independent detectors', C.green,
  { note: 'a header is only accepted with real evidence behind it' }));
o.push(box(60, 396, 340, 196, 'A · Gmail attribution (DOM)', [
  'reads the .gmail_attr elements',
  'text must end in "wrote:"',
  'date = up to the clock and zone',
  'address from the mailto: link,',
  'display name from the text beside it',
  'scope = the blockquote it points at,',
  'else the blockquote around it',
  'names without an address are kept',
], C.green));
o.push(box(420, 396, 340, 196, 'B · Outlook / forwarded block', [
  '/^[ \\t>]*(From|De|Von|Van):/im',
  'then up to 24 following lines',
  'needs a date field AND one other',
  '(To · Cc · Subject) — so ordinary',
  'prose saying "From:" never splits',
  'wrapped To/Cc lines are absorbed',
  '≤ 2 stray lines tolerated inside',
  '"--- Forwarded message ---" pulled in',
], C.green));
o.push(box(780, 396, 340, 196, 'C · Plain "On … wrote:"', [
  'for mobile clients and forwards',
  'that carry no attribution markup',
  'may span up to three lines, so a',
  'wrapped attribution still matches',
  'skipped where detector A or B',
  'already covers that offset',
  'date and author split on the clock',
], C.green));
o.push(box(1140, 396, 380, 196, 'D · Second pass over the rebuilt body', [
  'UNSPLIT_HEADER: From: … followed by',
  'Sent:/Date: within 800 characters',
  'runs the whole extraction again on',
  'the body this pass produced, ≤ 2 deep',
  'catches any provider shape the first',
  'pass stopped at — it reads ThreadLens’',
  'own markup, not the provider’s',
  'an envelope holding only quotes is',
  'dissolved, its children re-parented',
], C.green));

/* 3 — segments */
o.push(panel(40, 652, 1480, 220, '3 · Turn the headers into segments — one segment is one message', C.orange));
o.push(box(60, 688, 340, 162, 'Scope of a header', [
  'Gmail: the blockquote it names',
  'others: to the end of the innermost',
  'enclosing scope',
  'so a signature or a reply written',
  'after a quote stays with its own',
  'author instead of joining the oldest',
  'nested message',
], C.orange));
o.push(box(420, 688, 340, 162, 'Stranded header lines', [
  'a wrapped recipient list or a Subject',
  'line left above a body belongs to no',
  'message at all',
  'up to 8 such lines are skipped before',
  'the body is allowed to start',
], C.orange));
o.push(box(780, 688, 340, 162, 'content(start, end)', [
  'excludes every nested header span',
  'slices what is left, joins with <br>',
  'htmlToText()      →  body (plain)',
  'sanitizeEmailHtml() →  bodyHtml',
  'tables, lists, spans and allowlisted',
  'styles survive; scripts do not',
], C.orange));
o.push(box(1140, 688, 380, 162, 'Legal footer trim', [
  '"this e-mail and any attachments…"',
  '"…contains information that is confidential"',
  '"agreements binding"  ·  "not secure"',
  'the segment ends there, so a disclaimer',
  'never leaks into the next message',
], C.orange));

/* 4 — identity and links */
o.push(panel(40, 902, 1480, 212, '4 · Identity, reply links and recursion', C.purple));
o.push(box(60, 938, 460, 160, 'Stable identity', [
  'generateId( threadId : sender :',
  '            header date :',
  '            normalised body :',
  '            image identity )',
  'no DOM index takes part, so the same',
  'recovered email keeps one id however',
  'often the page is re-read',
], C.purple));
o.push(box(540, 938, 460, 160, 'Reply links  ·  quotedBy', [
  'the innermost header that encloses',
  'this one belongs to the client that',
  'quoted it — first-hand evidence that',
  'its author replied to this message',
  'a quote holding nothing is dropped and',
  'its children re-point at the nearest',
  'surviving quoter (else the carrier)',
], C.purple));
o.push(box(1020, 938, 500, 160, 'Recursion, then reconciliation', [
  'own body   = content(0, end of text)',
  'history    = drafts holding words, a table',
  '             or a picture (empty ones dropped)',
  'each recovered body is rescanned once more',
  'mergeMessages() then reconciles the whole set',
  '→  diagram 4',
], C.purple));

o.push(footer(44, 1152, 'Result per container: { body, bodyHtml, history[] } — the sender’s own words, plus every earlier message their client quoted, each with its own sender, clock, recipients and reply link.'));
o.push(footer(44, 1176, 'A container that yields no words, no table and no picture but does yield history is a carrier: the panel announces the forward on one line rather than drawing an empty bubble.'));
process.stdout.write(svg(W, H, o.join('\n')));
