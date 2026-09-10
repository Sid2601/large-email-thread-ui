import { expect, it, vi } from 'vitest';
import { extractEmailBody } from '../src/content/quoted-chain-parser';
import { sanitizeEmailHtml } from '../src/content/scraper-utils';
import { mergeMessages } from '../src/content/message-reconciliation';
import { parseSnapshot } from '../src/offscreen/parser';
import { safeImageSource, imageResponse, MAX_IMAGE_BYTES } from '../src/shared/images';
import { embedImages, stripImages, inlineImageName } from '../src/side-panel/media/images';
import type { MessageSnapshot, SnapshotBatch } from '../src/shared/snapshots';
import { buildSender } from '../src/content/scraper-utils';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
const anchor = '2026-09-09T10:00:00Z';
function parse(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractEmailBody(doc.body, '', 'images', anchor);
}
it.each([
  ['image only', `<img src="${png}" alt="chart">`],
  ['at the start', `<img src="${png}" alt="chart"><p>After</p>`],
  ['at the end', `<p>Before</p><img src="${png}" alt="chart">`],
  ['between text', `<p>Before</p><img src="${png}" alt="chart"><p>After</p>`],
  ['inside a table cell', `<table><tr><td><img src="${png}" alt="chart"></td></tr></table>`],
])('preserves an inline image %s', (_label, html) => {
  const result = parse(html);
  const doc = new DOMParser().parseFromString(result.bodyHtml, 'text/html');
  expect(doc.querySelector('img')?.getAttribute('src')).toBe(png);
  expect(result.body).toContain('[Image: chart]');
  if (html.includes('Before')) expect(result.bodyHtml.indexOf('Before')).toBeLessThan(result.bodyHtml.indexOf('<img'));
  if (html.includes('After')) expect(result.bodyHtml.indexOf('After')).toBeGreaterThan(result.bodyHtml.indexOf('<img'));
});
it('keeps quoted images with their sender rather than the forwarding email', () => {
  const result = parse(`<p>New reply</p><div class="gmail_attr">On Sep 8, 2026 at 10:00 AM UTC <a href="mailto:a@example.com">Alice</a> wrote:</div><blockquote class="gmail_quote"><img src="${png}" alt="chart"></blockquote>`);
  expect(result.bodyHtml).not.toContain('<img');
  expect(result.history).toHaveLength(1);
  expect(result.history[0].bodyHtml).toContain('<img');
});
it('preserves HTTPS images with lazy decoding and strips handlers/srcset', () => {
  const html = sanitizeEmailHtml('<img src="https://mail.google.com/image.png" srcset="javascript:x" onerror="evil()" alt="chart">');
  expect(html).toContain('loading="lazy"'); expect(html).toContain('decoding="async"');
  expect(html).toContain('referrerpolicy="no-referrer"'); expect(html).not.toMatch(/onerror|srcset/);
});
it.each(['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'file:///etc/passwd', 'http://example.com/picture', 'https://user:pass@example.com/image', 'cid:removed'])('rejects an unsafe/unresolved image source %s', source => {
  expect(safeImageSource(source)).toBe('');
});
it('retains source-tab blob references without trying to load them in the extension document', () => {
  const html = sanitizeEmailHtml('<img src="blob:https://mail.google.com/abc" alt="chart">');
  expect(html).toContain('data-tl-image-src="blob:https://mail.google.com/abc"');
  expect(html).not.toMatch(/\ssrc=/);
});
it('labels removed images instead of inventing bytes', () => {
  expect(parse('<img alt="Image removed by sender.">').body).toContain('Image unavailable: Image removed by sender.');
});
it('keeps separate image-only messages whose filenames match but image sources differ', () => {
  const base = { id: 'direct', sender: buildSender('Alice', 'a@example.com'), timestamp: anchor, body: '[Image: chart]', index: 0, isCurrentUser: false };
  expect(mergeMessages([{ ...base, source: 'direct', bodyHtml: '<img src="https://mail.google.com/a">' }, { ...base, id: 'quote', source: 'quoted', bodyHtml: '<img src="https://mail.google.com/b">' }])).toHaveLength(2);
});
it('parses snapshots outside the mail page, including live image source overrides', () => {
  const message = { id: 'direct', sender: buildSender('Alice', 'a@example.com'), timestamp: anchor, body: '', index: 0, isCurrentUser: false, source: 'direct' as const };
  const snapshot: MessageSnapshot = { message, html: '<img src="cid:chart" alt="chart">', imageSources: [png] };
  const batch: SnapshotBatch = { threadId: 'one', subject: 'Images', client: 'gmail', currentUserEmail: '', session: 'one', snapshots: [snapshot] };
  const messages = parseSnapshot(snapshot, batch);
  expect(messages).toHaveLength(1); expect(messages[0].bodyHtml).toContain(png);
  expect(messages[0].historyCarrier).toBe(false);
});
it('embeds available images once per source in standalone HTML', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/png' } }));
  try {
    const result = await embedImages('<html><body><img src="https://mail.google.com/export-image"><img src="https://mail.google.com/export-image"></body></html>');
    expect(result.missing).toBe(0); expect(result.html.match(/data:image\/png;base64/g)).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { fetch.mockRestore(); }
});
it('reports export failures and preserves available online sources', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Not authorized'));
  try {
    const result = await embedImages('<html><body><section class="overview"></section><img src="https://mail.google.com/expired" alt="chart"></body></html>');
    expect(result.missing).toBe(1); expect(result.html).toContain('Image not embedded: chart');
    expect(result.html).toContain('https://mail.google.com/expired');
  } finally { fetch.mockRestore(); }
});
it('rejects oversized images and login HTML responses', async () => {
  await expect(imageResponse(new Response('login', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow();
  await expect(imageResponse(new Response('', { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } }))).rejects.toThrow('8 MB');
});

it('replaces images with filenames for a small test export, writing no image data or source URLs', () => {
  const result = stripImages(`<html><body><section class="overview"></section><p><img src="https://mail.google.com/attachment/chart%20q4.png?token=SECRET" alt="Q4 chart"></p><p><img src="${png}"></p><p><img data-tl-image-src="blob:https://mail.google.com/9f1c" alt="Inline image"></p></body></html>`);
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  expect(result.replaced).toBe(3);
  expect(doc.querySelectorAll('img')).toHaveLength(0);
  expect(Array.from(doc.querySelectorAll('.image-placeholder')).map(el => el.getAttribute('data-image-name')))
    .toEqual(['chart-q4.png', 'image-2.png', 'image-3.png']);
  expect(doc.querySelector('.image-placeholder')?.textContent).toBe('chart-q4.png — Q4 chart');
  expect(result.html).not.toContain('SECRET');
  expect(result.html).not.toContain('base64');
  expect(result.html).not.toContain('blob:');
  expect(doc.querySelector('.overview')?.textContent).toContain('3 inline image(s) replaced');
});
it('leaves image-free exports untouched and names sources by extension', () => {
  const result = stripImages('<html><body><section class="overview"></section><p>No images here</p></body></html>');
  expect(result.replaced).toBe(0);
  expect(result.html).not.toContain('image-placeholder');
  expect(result.html).not.toContain('replaced by their filenames');
  expect(inlineImageName('data:image/jpeg;base64,AAAA', 4)).toBe('image-4.jpg');
  expect(inlineImageName('https://mail.google.com/photo.JPG', 1)).toBe('photo.JPG');
  expect(inlineImageName('cid:logo', 7)).toBe('image-7.png');
});
