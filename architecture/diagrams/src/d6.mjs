import { C, svg, title, panel, box, arrow, footer, text } from './svg-kit.mjs';
const W = 1600, H = 990, o = [];
o.push(title(44, 56, 'ThreadLens — exports, identity masking and the diagnostic loop',
  'Everything below is written by the side panel itself: no upload, no network, and no download permission · development build only'));
const h = n => 42 + (n - 1) * 17 + 14;
function stack(x, w, top, gap, items, color, arrows = false) {
  let y = top; const placed = [];
  for (const [t, lines] of items) { const ch = h(lines.length); o.push(box(x, y, w, ch, t, lines, color)); placed.push([y, ch]); y += ch + gap; }
  if (arrows) for (let i = 0; i < placed.length - 1; i++)
    o.push(arrow(`M${x + 30} ${placed[i][0] + placed[i][1] + 1} V${placed[i + 1][0] - 2}`, { color, sw: 1.6 }));
}
o.push(panel(40, 100, 480, 780, 'A · Conversation export', C.blue, { note: 'export/conversation.ts' }));
stack(60, 440, 148, 16, [
  ['What it writes', ['one standalone HTML file, no script at all', 'meta CSP: default-src \'none\'; img-src data: https:', 'messages are re-merged and re-ordered first, so', 'the file always agrees with the panel']],
  ['Always the whole thread', ['the search box and participant filter are ignored', 'every recovered message, in order, with its', 'recovery label, participation marker and', 'quoted-variant sections']],
  ['Two forms', ['Text only (no images) — placeholders, a few KB,', 'identical offline', 'Masked copy (share-safe) — identities replaced', 'image embedding was removed in 1.7.2']],
  ['Never written', ['attachment bytes · provider URLs · expiring links', 'the placeholder → person map', 'an address the quoted history never recorded is', 'said to be missing, not invented']],
  ['Filenames', ['ThreadLens-<subject>-<date>.html', 'suffixed -no-images or -masked', 'the subject is sanitised for the filesystem first']],
  ['Print-ready', ['@media print repeats table headers, avoids', 'breaking a row and releases the body overflow']],
], C.blue, true);

o.push(panel(550, 100, 560, 780, 'B · IdentityMasker — making a thread shareable', C.orange, { note: 'export/mask.ts' }));
stack(570, 520, 148, 14, [
  ['Seed before rewriting anything', ['every address, and the name written beside it, is', 'learned from the headers first — addressed', 'identities before name-only ones — then from all', 'markup, so two copies of one email mask alike']],
  ['People', ['Person 1  ·  person1@company1.example', 'an author the history names without an address', 'keeps that shape (unknown:person 3), because it', 'is evidence in itself and it changes how it merges']],
  ['Companies and domains', ['company1.example, consistently', 'consumer hosts stay readable — gmail.com', 'identifies nobody', 'the distinctive label of a correspondent’s own', 'domain also becomes Company 1 in the prose']],
  ['Short forms', ['capitalised openings of a known token: Sid for', 'Siddharth, Elevation for elevationservices —', 'and across a capital, so WarehousePartners in a', 'filename is caught; lowercase words are left alone']],
  ['Numbers', ['a 9–15 digit run → [phone-1] or [number-1]', 'anything shaped like a date is evidence and stays']],
  ['Deliberately never masked', ['calendar words — a colleague called May must not', 'rewrite the dates; role words (info, sales, team);', 'classes, layout, ids-as-structure and every clock', '— the copy has to still reproduce the problem']],
], C.orange);

o.push(panel(1140, 100, 420, 780, 'C · Capture, replay and fidelity', C.green, { note: 'shared/capture*.ts' }));
stack(1160, 380, 148, 14, [
  ['capture() — in the mail page', ['the provider container for every row, plus the', 'exact snapshot the parser received for it', 'picture payloads folded to a short digest', '512 KB per container · 16 MB per file']],
  ['maskCapture()', ['every attribute is treated as identifying unless', 'it is structural; provider ids renumbered', 'consistently; each picture address replaced by a', 'placeholder of its own kind']],
  ['replayCapture()', ['parses the file through the real parser and the', 'real cache — in batches, and again whole']],
  ['captureFidelity()', ['threadShape(): one identity-free line per message', 'original vs masked  →  same structure?', 'batched vs whole   →  order independent?', 'the verdict is written into both files and shown', 'in the panel before either is saved']],
  ['npm run replay', ['reads a capture back with no browser and no', 'mailbox, and prints what the parser made of it']],
  ['What a capture is not', ['not a copy of the mailbox: a container over', '512 KB is shortened and the file says so —', 'the parser’s own input is never truncated']],
  ['Format version', ['CAPTURE_FORMAT is raised whenever the shape', 'changes, so an old file is recognised, not misread']],
], C.green);
o.push(footer(44, 920, 'Production omits all of this: the export buttons, the masking code and the CAPTURE_THREAD_SOURCE handler are compiled out, and packaging fails if any of them appears in the bundle.'));
o.push(footer(44, 946, 'Masking is a strong default, not a guarantee: a nickname sharing no opening letters, an identity written only inside a picture, or a company named in prose but never in an address can survive. Read the file before sending it.'));
process.stdout.write(svg(W, H, o.join('\n')));
