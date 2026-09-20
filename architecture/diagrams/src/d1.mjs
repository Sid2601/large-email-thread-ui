import { C, svg, title, panel, box, arrow, label, footer, text } from './svg-kit.mjs';
const W = 1440, H = 1280, o = [];
o.push(title(44, 56, 'ThreadLens — system architecture',
  'Chrome MV3 extension · four runtime contexts · no server, no telemetry, no AI service · v1.7.4'));

/* ── Band 1 — mail tab ─────────────────────────────────────────── */
o.push(panel(40, 120, 1320, 190, '1 · Mail tab — content script, provider origin', C.blue,
  { note: 'mail.google.com · outlook.live/office/office365.com' }));
o.push(box(60, 156, 410, 136, 'Provider DOM', [
  'Gmail  [data-message-id] · .a3s body · .g3 date cell',
  '       .aZo attachment chip · .gD sender',
  'Outlook  reading pane · [data-unique-id] item',
  '       .allowTextSelection body · [data-pe-id] sender',
], C.blue));
o.push(box(495, 156, 410, 136, 'ReaderAdapter (one per provider)', [
  'thread id · subject · signed-in address',
  'sender, timestamp, recipients, attachment chips',
  'expand / collapse all (Gmail)',
  'snapshot(el) → { message, html, imageSources }',
], C.blue));
o.push(box(930, 156, 410, 136, 'incremental-reader.ts — the read loop', [
  'MutationObserver → dirty map (body vs header only)',
  '250 ms debounce · requestIdleCallback per email',
  '≤ 4 snapshots per batch · unchanged emails skipped',
  'navigation reset · re-queue on failure (≤ 2 tries)',
], C.blue));

/* ── Band 2 — service worker ───────────────────────────────────── */
o.push(panel(40, 370, 1320, 150, '2 · Service worker (MV3 background)', C.orange));
o.push(box(60, 406, 410, 100, 'Tab-scoped session store', [
  "chrome.storage.session['thread:<tabId>']",
  'writes serialised per tab · legacy local entry purged',
  'cleared on navigation, tab close and browser exit',
], C.orange));
o.push(box(495, 406, 410, 100, 'Offscreen lifecycle', [
  'ensureParser(): one DOM_PARSER document, on demand',
  'reused by every tab · PARSER_DROP on tab close',
], C.orange));
o.push(box(930, 406, 410, 100, 'Message router', [
  'SNAPSHOT_BATCH → offscreen parser',
  'READ_PAGE_IMAGE → mail tab (blob images)',
  'REQUEST_THREAD → stored thread + re-scrape nudge',
], C.orange));

/* ── Band 3 — offscreen parsing ────────────────────────────────── */
o.push(panel(40, 580, 1320, 200, '3 · Offscreen document — parsing happens away from the mail page', C.green));
o.push(box(60, 616, 305, 140, 'parser.ts', [
  'inert DOMParser document',
  '<img src> restored from',
  'imageSources, srcset dropped',
  'no-words forward → carrier',
  'notice instead of a bubble',
], C.green));
o.push(box(385, 616, 305, 140, 'quoted-chain-parser.ts', [
  'project(): text ↔ DOM runs',
  'header recognition, 4 kinds',
  'scope + Range slice per email',
  'stranded-header skip',
  '≤ 2 rescans of rebuilt bodies',
], C.green));
o.push(box(710, 616, 305, 140, 'message-reconciliation.ts', [
  'duplicate matching + variants',
  'timezone offset voting',
  'quote-chain topological order',
  'unread-clock interpolation',
  'one person, one identity',
], C.green));
o.push(box(1035, 616, 305, 140, 'thread-cache.ts', [
  'ParsedMessage map per session',
  're-merged on every batch',
  'participants recounted',
  'evicted when the session or',
  'thread id changes',
], C.green));
for (const x of [365, 690, 1015]) o.push(arrow(`M${x + 2} 686 H${x + 18}`, { color: C.green, sw: 2 }));

/* ── Band 4 — side panel ───────────────────────────────────────── */
o.push(panel(40, 840, 1320, 210, '4 · Side panel — React 18, extension page, strict CSP', C.purple));
o.push(box(60, 876, 305, 150, 'useThreadData', [
  'REQUEST_THREAD on mount',
  'and on tab activation',
  'THREAD_UPDATED / _CLEARED',
  'ignores threads belonging',
  'to another tab',
], C.purple));
o.push(box(385, 876, 305, 150, 'Filter & search', [
  'useParticipantFilter',
  'useSearch over body, quoted',
  'variants, sender name/address',
  'highlight injected into text',
  'nodes only — tables survive',
], C.purple));
o.push(box(710, 876, 305, 150, 'Chat rendering', [
  'ChatThread · MessageBubble',
  'RichBody: sanitize on render,',
  'IntersectionObserver images,',
  'full-size viewer + download',
  'quoted-variant disclosure',
], C.purple));
o.push(box(1035, 876, 305, 150, 'Files & exports', [
  'AttachmentControls: open,',
  'save locally, import, remove',
  'Dev build only: conversation,',
  'masked copy, thread-source',
  'capture + fidelity report',
], C.purple));

/* ── Band 5 — state & network ──────────────────────────────────── */
o.push(panel(40, 1110, 1320, 115, '5 · Local state and the only network the product makes', C.gold));
o.push(box(60, 1146, 410, 62, 'chrome.storage.session', ['Mail content, keyed per tab, gone when Chrome exits'], C.gold));
o.push(box(495, 1146, 410, 62, 'IndexedDB · threadlens-attachments', ['Only files the user saves · 20 MB each · 100 MB total'], C.gold));
o.push(box(930, 1146, 410, 62, 'Provider + image hosts', ['fetch(credentials: include) for images and attachments'], C.gold));

/* ── Wiring ────────────────────────────────────────────────────── */
o.push(arrow('M1050 292 V326 H1135 V404', { color: C.blue, sw: 2 }));
o.push(label(1040, 322, 'SNAPSHOT_BATCH', { anchor: 'end', fill: C.blue }));
o.push(arrow('M1250 292 V352 H380 V404', { color: C.blue, sw: 2 }));
o.push(label(815, 348, 'THREAD_PARSED  →  store the thread, then broadcast it', { fill: C.blue }));
o.push(arrow('M1135 506 V560 H212 V614', { color: C.orange, sw: 2 }));
o.push(label(1105, 556, 'PARSER_BATCH · one serial queue per tab', { anchor: 'end', fill: C.orange }));
o.push(arrow('M1340 686 H1376 V240 H1344', { color: C.green, sw: 2 }));
o.push(label(1368, 556, 'parsed ThreadData', { anchor: 'end', fill: C.green }));
o.push(arrow('M265 506 V546 H24 V806 H212 V874', { color: C.orange, sw: 2 }));
o.push(label(330, 802, 'THREAD_UPDATED / THREAD_CLEARED', { anchor: 'start', fill: C.orange }));
o.push(arrow('M537 874 V816 H1400 V456 H1342', { color: C.purple, sw: 2, dash: '6 4' }));
o.push(label(1010, 812, 'REQUEST_THREAD  (panel opened, or tab switched)', { fill: C.purple }));

o.push(footer(44, 1252, 'Blob inline images: panel → READ_PAGE_IMAGE → service worker → READ_BLOB_IMAGE in the mail tab → data: URL back.   Dev capture: panel → CAPTURE_THREAD_SOURCE → mail tab.   Gmail controls: EXPAND_THREAD / COLLAPSE_THREAD.'));
process.stdout.write(svg(W, H, o.join('\n')));
