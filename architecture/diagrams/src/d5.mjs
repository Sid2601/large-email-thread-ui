import { C, svg, title, panel, box, arrow, footer, text } from './svg-kit.mjs';
const W = 1600, H = 1210, o = [];
o.push(title(44, 56, 'ThreadLens — inline images and attachments',
  'Two separate paths: a picture is part of the message and is shown in place; a file is named always and fetched only when the reader asks'));
const h = n => 42 + (n - 1) * 17 + 14;
function stack(x, w, top, gap, items, color, arrows = true) {
  let y = top; const placed = [];
  for (const [t, lines] of items) { const ch = h(lines.length); o.push(box(x, y, w, ch, t, lines, color)); placed.push([y, ch]); y += ch + gap; }
  if (arrows) for (let i = 0; i < placed.length - 1; i++)
    o.push(arrow(`M${x + 30} ${placed[i][0] + placed[i][1] + 1} V${placed[i + 1][0] - 2}`, { color, sw: 1.6 }));
}
o.push(panel(40, 100, 760, 1010, 'Inline images — from the mail page to the pixel on screen', C.blue,
  { note: 'src/shared/images.ts · media/images.ts · RichBody.tsx' }));
stack(60, 720, 148, 14, [
  ['1 · Read in the page', [
    'imageSources(body): every <img> in DOM order, taking img.currentSrc || src || data-src',
    'sent beside the body markup, so the parser never has to resolve a live resource',
    'a changed picture makes the message dirty like any other edit']],
  ['2 · Restored in the parser', [
    'the offscreen document is inert — assigning a src loads nothing and runs nothing',
    'img[i].src = imageSources[i]; srcset is dropped so no second address survives',
    'the picture keeps its exact position inside the message']],
  ['3 · Gated by safeImageSource()', [
    'data:image/(png|jpeg|gif|webp|avif);base64 only, under the 8 MB budget',
    'https: only, and never with credentials embedded in the URL',
    'blob: only when it belongs to one of the four provider origins',
    'anything else (cid:, unknown scheme) → visible “[Image unavailable: alt]”',
    'a 1–2 px image is a tracking pixel and is removed outright']],
  ['4 · Rewritten by sanitizeEmailHtml()', [
    'every attribute is stripped, then a known-safe set is put back:',
    'src — or data-tl-image-src when the source is a mail-tab blob',
    'alt · loading="lazy" · decoding="async" · referrerpolicy="no-referrer"',
    'width and height only when they are plain numbers']],
  ['5 · Loaded on demand in the panel', [
    'IntersectionObserver fires 200 px before the picture reaches the viewport',
    'https → fetch(credentials: include) from the panel’s own origin',
    'blob → READ_PAGE_IMAGE → service worker → the mail tab reads its own blob',
    'one retry through the extension’s host access, then a visible caption']],
  ['6 · loadInlineImage() limits', [
    'session cache keyed tabId:src, at most 16 entries, evicted oldest first',
    'at most two fetches in flight, so a signature of logos cannot flood the panel',
    'raster content-type only · streamed · hard stop at 8 MB',
    'anything over 2 MB is dropped from the cache once delivered']],
  ['7 · Full size and download', [
    'click or Enter opens a native <dialog> at the picture’s real dimensions',
    'Download image saves the original bytes — never a screenshot, never a resize',
    'the name comes from the source filename, else the alt text; the extension',
    'comes from the mime type actually returned']],
  ['8 · In exports', [
    'with images: embedded as data: URIs, with a 50 MB ceiling and a per-image note',
    'without images: every picture becomes its filename, e.g. image-1.png',
    'masked copy: never carries picture bytes — a picture can show a face']],
], C.blue);

o.push(panel(840, 100, 720, 1010, 'Attachments — named always, fetched only on request', C.gold,
  { note: 'storage/attachments.ts · AttachmentControls.tsx' }));
stack(860, 680, 148, 14, [
  ['1 · Chips read in the page', [
    'Gmail: .aZo · .M2 .aQy · [data-tooltip*="."] — first selector that matches wins',
    'name from .aV3/.aQw or the tooltip, and it must contain a dot, so a',
    'button label can never be mistaken for a filename',
    'size from .aV7; link from a[href*=view=att] or a[href*=attid]',
    'Outlook: a[download] and GetFileAttachment links']],
  ['2 · Carried through reconciliation', [
    'mimeFromExtension() gives the type from the filename',
    'attachments are unioned across every copy of a message and de-duplicated',
    'on name + size + link, so a chip that arrives late is never lost when the',
    'same email is read again']],
  ['3 · Shown whatever the link does', [
    'the chip shows name, size and type even when no usable link exists:',
    'evidence that the file was there is worth keeping on its own']],
  ['4 · attachmentUrl() allowlist', [
    'https only, and only mail.google.com, outlook.live.com,',
    'outlook.office.com and outlook.office365.com',
    'the response URL is re-checked after redirects']],
  ['5 · Save locally — always explicit', [
    'fetch(credentials: include) with a 30 s timeout',
    'an HTML response is refused: that is a login page, not a file',
    'content-length and the stream itself are both capped at 20 MB',
    'stored in IndexedDB under messageId:name:size']],
  ['6 · Budget and lifetime', [
    '20 MB per file · 100 MB per browser profile',
    'over budget the transaction aborts and the panel says which limit was hit',
    'saved files survive browser restarts until removed, storage is cleared,',
    'or the extension is uninstalled']],
  ['7 · When the provider refuses', [
    'Choose downloaded file: download it in the mail client, then pick it',
    'the chosen file’s name must equal the chip’s name, so the wrong file',
    'cannot be filed against a message']],
  ['8 · Download and remove', [
    'Download saved file → object URL → <a download>, revoked afterwards',
    'Remove local copy deletes the bytes immediately',
    'exports list attachment names and never write bytes or provider URLs']],
], C.gold);
o.push(footer(44, 1150, 'No download permission is requested: every save is performed by the panel itself with an <a download> element, so nothing can be written to disk without the reader clicking for it.'));
o.push(footer(44, 1176, 'Nothing is fetched in the background. A picture loads when it is about to be seen; a file is fetched only when Save locally or Download is pressed.'));
process.stdout.write(svg(W, H, o.join('\n')));
