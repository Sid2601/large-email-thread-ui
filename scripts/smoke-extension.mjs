/** Real Chromium smoke test. Set PLAYWRIGHT_MODULE to a Playwright module path if needed. */
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'threadlens-smoke-'));
const extension = resolve(process.env.DEV_EXTENSION || 'dist-dev');
assert.equal(JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')).name, 'ThreadLens Dev', 'This smoke test exercises developer downloads; build:dev first.');
assert.doesNotMatch(await readFile(join(extension, 'src/side-panel/index.html'), 'utf8'), /modulepreload/i, 'built panel must not preload cross-world shared extension modules');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const errors = [];
  const imageBytes = await sharp(Buffer.from('<svg width="960" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="300" fill="#e0f2fe"/><text x="40" y="70" font-size="32">Warehouse transfer analysis</text><rect x="40" y="110" width="400" height="40" fill="#0284c7"/><rect x="40" y="180" width="700" height="40" fill="#0d9488"/><text x="40" y="270" font-size="22">Synthetic image fixture · 960 × 300</text></svg>')).png().toBuffer();
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const attribution = (name, when, body) => `<div class="gmail_attr">On ${when} <a href="mailto:${name.toLowerCase()}@example.com">${name}</a> wrote:</div><blockquote class="gmail_quote">${body}</blockquote>`;
  const quote = (name, date, body) => attribution(name, `${date} at 10:00 AM UTC`, body);
  // A replying client in another country writes its own wall clock with no
  // offset, so Carol's quoted copy must still reconcile with her real header.
  const carolSentAt = Date.parse('2026-09-08T10:00:00Z');
  const pad = value => String(value).padStart(2, '0');
  const localClock = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const carolBody = '<p>Adding you for visibility.</p><p>The rollout covers the northern region first, and the budget table below is the version finance agreed last week. Please raise anything that looks wrong before Friday.</p>';
  const history = quote('Alice', 'Sep 7, 2026', '<p>Budget approved.</p><table><tr><th>Item</th><th>Budget</th></tr><tr><td>Hosting</td><td>$500</td></tr></table>' + quote('Bob', 'Sep 6, 2026', '<p>Initial proposal.</p>'));
  const html = `<main role="main"><span data-ogsr-up><span data-email="new@example.com"></span></span><h2 class="hP">Enterprise rollout · joined midway</h2><div data-message-id="direct-1"><div class="gE"></div><span class="gD" email="carol@example.com" name="Carol">Carol</span><span class="g2" email="new@example.com"></span><span class="g3" data-tooltip="2026-09-08T10:00:00Z"></span><div class="a3s aiL">${carolBody}<div hidden style="display:none">${history}</div></div><div class="aZo" data-tooltip="report.txt"><span class="aV3">report.txt</span><span class="aV7">12 B</span><a href="https://mail.google.com/mail/u/0/?view=att&amp;attid=1">Download</a></div></div><div data-message-id="direct-2"><div class="gE"></div><span class="gD" email="dave@example.com" name="Dave">Dave</span><span class="g3" data-tooltip="2026-09-09T10:00:00Z"></span><div class="a3s aiL"><p>OK</p>${attribution('Carol', localClock(carolSentAt - 4.5 * 3600 * 1000), carolBody + history)}</div></div></main>`;
  await context.route('https://mail.google.com/**', route => route.fulfill(route.request().url().includes('view=att') ? { contentType: 'text/plain', body: 'Report data' } : { contentType: 'text/html; charset=utf-8', body: html }));
  await context.route('https://mail.google.com/inline-test.png', route => route.fulfill({ contentType: 'image/png', body: imageBytes }));
  const mail = await context.newPage();
  await mail.goto('https://mail.google.com/mail/u/0/#inbox/testthread123456');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const saved = await worker.evaluate(async () => chrome.storage.session.get(null));
  const entry = Object.entries(saved).find(([key]) => key.startsWith('thread:'));
  assert.ok(entry, 'content script delivers a thread to the real service worker');
  assert.equal(entry[1].messages.length, 4, 'a quoted copy written in another timezone must not become a fifth message');
  assert.equal(entry[1].messages[0].body, 'Initial proposal.');
  assert.equal(entry[1].messages[2].timestamp, new Date(carolSentAt).toISOString(), 'the provider header wins over a zoneless quoted clock');
  const mailTabId = Number(entry[0].split(':')[1]);
  const panel = await context.newPage();
  const panelLogs = [];
  const cdp = await context.newCDPSession(panel);
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', ({ entry }) => panelLogs.push(entry.text));
  await panel.setViewportSize({ width: 440, height: 1000 });
  await panel.goto(`chrome-extension://${id}/src/side-panel/index.html`);
  await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), mailTabId);
  await panel.getByText('4 messages', { exact: true }).waitFor();
  assert.equal(await panel.locator('table').count(), 1);
  await panel.getByText('You joined here · first visible inclusion', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Initial proposal.', { exact: true }).count(), 1);
  await panel.locator('input[type="text"], input[type="search"]').fill('Hosting');
  assert.equal(await panel.locator('table mark').innerText(), 'Hosting');
  const [conversation] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByRole('button', { name: 'Text only (no images)' }).click(),
  ]);
  assert.ok(conversation.suggestedFilename().endsWith('-no-images.html'));
  await mkdir('artifacts', { recursive: true });
  const exportPath = resolve('artifacts/conversation-export.html');
  await conversation.saveAs(exportPath);
  const exported = await readFile(exportPath, 'utf8');
  assert.equal((exported.match(/<article /g) || []).length, 4, 'export includes all messages despite active search');
  assert.equal((exported.match(/Adding you for visibility/g) || []).length, 1, 'the timezone-shifted duplicate is exported once');
  assert.ok(exported.includes('report.txt'));
  assert.ok(exported.includes('<table>'));
  assert.ok(!exported.includes('view=att'), 'provider attachment URLs are not exported');
  // The share-safe copy must hold the same messages with no real identity, image or attachment data.
  const [maskedExport] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Masked copy (share-safe)' }).click()]);
  assert.ok(maskedExport.suggestedFilename().endsWith('-masked.html'));
  const maskedPath = resolve('artifacts/masked-export.html');
  await maskedExport.saveAs(maskedPath);
  const masked = await readFile(maskedPath, 'utf8');
  assert.equal((masked.match(/<article /g) || []).length, 4, 'the masked copy keeps every message');
  for (const identity of ['Carol', 'Dave', 'Alice', 'Bob', 'carol@', 'dave@', 'alice@', 'bob@'])
    assert.ok(!masked.includes(identity), `masked export leaks ${identity}`);
  assert.ok(masked.includes('&lt;person1@example.com&gt;'), 'senders become numbered placeholders');
  assert.ok(masked.includes('Budget approved.') && masked.includes('<table>'), 'wording and structure survive masking');
  assert.ok(!masked.includes('<img'), 'a masked copy writes no image data');
  // The thread-source capture: the mail page's own markup, masked, and checked
  // against the original before it is written.
  await panel.getByText('Report a parsing problem', { exact: true }).click();
  const [sourceExport] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Thread source (masked)' }).click()]);
  assert.ok(sourceExport.suggestedFilename().endsWith('-source-masked.json'), 'the capture is named as a masked source file');
  const sourcePath = resolve('artifacts/thread-source-masked.json');
  await sourceExport.saveAs(sourcePath);
  const capture = JSON.parse(await readFile(sourcePath, 'utf8'));
  assert.equal(capture.masked, true);
  assert.equal(capture.client, 'gmail');
  assert.equal(capture.messages.length, 2, 'both provider containers are captured');
  assert.ok(capture.messages.every(message => message.snapshot && message.live), 'the capture holds the snapshots the parser received');
  assert.ok(capture.messages[0].containerHtml.includes('class="a3s aiL"'), 'the provider markup a scraper reads survives masking');
  assert.equal(capture.fidelity.sameStructure, true, 'the masked capture must parse to the same thread as the original');
  assert.equal(capture.fidelity.orderIndependent, true);
  assert.equal(capture.fidelity.originalMessages, 4);
  for (const identity of ['Carol', 'Dave', 'Alice', 'Bob', 'carol@', 'dave@', 'alice@', 'bob@'])
    assert.ok(!JSON.stringify(capture).includes(identity), `thread-source capture leaks ${identity}`);
  await panel.getByText('parses to the same 4 message(s)', { exact: false }).waitFor();
  await panel.getByText('Report a parsing problem', { exact: true }).click();
  await panel.locator('input[type="text"], input[type="search"]').fill('');
  await panel.getByText('Save locally', { exact: true }).click();
  await panel.getByText('Saved on this device', { exact: true }).waitFor();
  await panel.getByText('Remove local copy', { exact: true }).click();
  await panel.getByText('Choose downloaded file', { exact: true }).waitFor();
  await panel.locator('input[type="file"]').setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('Report data') });
  await panel.getByText('Saved on this device', { exact: true }).waitFor();
  // Reload proves IndexedDB persistence rather than component-only state.
  await panel.reload();
  await panel.getByText('Saved on this device', { exact: true }).waitFor();
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByText('Download saved file', { exact: true }).click()]);
  assert.equal(download.suggestedFilename(), 'report.txt');
  await panel.getByText('Remove local copy', { exact: true }).click();
  await panel.getByText('Choose downloaded file', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Saved on this device', { exact: true }).count(), 0);
  // Both ends of a long thread are one tap away. Make the fixture overflow
  // and start at the bottom: the first-message button is hidden at the top.
  await panel.setViewportSize({ width: 440, height: 600 });
  await panel.locator('.overflow-y-auto').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await panel.getByRole('button', { name: 'Jump to the first message' }).click();
  await panel.waitForFunction(() => document.querySelector('.overflow-y-auto').scrollTop === 0);
  await panel.getByRole('button', { name: 'Jump to the latest message' }).click();
  await panel.waitForFunction(() => { const el = document.querySelector('.overflow-y-auto'); return el.scrollHeight - el.clientHeight - el.scrollTop < 40; });
  await panel.setViewportSize({ width: 440, height: 1000 });
  // Expanding has an opposite. Gmail's header row toggles a message, so the
  // fixture does too, and the panel must keep every email it already recovered
  // after the mailbox stops showing them.
  await mail.evaluate(() => document.querySelectorAll('.gE').forEach(header =>
    header.addEventListener('click', () => header.closest('[data-message-id]').querySelector('.a3s')?.remove())));
  await panel.getByRole('button', { name: 'Collapse emails again' }).click();
  await mail.waitForFunction(() => document.querySelectorAll('.a3s').length === 0);
  await panel.getByText('4 messages', { exact: true }).waitFor();
  assert.equal(await panel.getByText('Initial proposal.', { exact: true }).count(), 1, 'collapsing the mailbox keeps the recovered history');
  await mkdir('artifacts', { recursive: true });
  await panel.screenshot({ path: 'artifacts/threadlens-smoke.png', fullPage: true });
  const unrelated = await context.newPage();
  await unrelated.goto('about:blank');
  await panel.getByText('4 messages', { exact: true }).waitFor({ state: 'detached' });
  await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), mailTabId);
  await panel.getByText('4 messages', { exact: true }).waitFor();
  // Reproduce the reported near-duplicate with synthetic wording, a missing
  // year in the direct header, and a changed signature inside a quoted copy.
  const request = 'Can you send the opening position for on-order and in-transit stock by purchase order to ensure we are all aligned? Please include the reconciliation details and confirm when the final data will be available for review.';
  const variant = request.replace('by purchase order', 'by purchase order for Riverside North');
  const markup = `<span data-ogsr-up><span data-email="new@example.com"></span></span><h2 class="hP">Enterprise duplicate regression</h2><div data-message-id="original"><span class="gD" email="alex@example.com" name="Alex">Alex</span><span class="g3" data-tooltip="Sep 8, 10:00 AM UTC"></span><div class="a3s aiL"><p>${request}</p><p>Many thanks</p><p>Alex</p></div></div><div data-message-id="joined"><span class="gD" email="lee@example.com" name="Lee">Lee</span><span class="g2" email="new@example.com"></span><span class="g3" data-tooltip="2026-09-09T10:00:00Z"></span><div class="a3s aiL"><p>Adding you to the discussion.</p>${quote('Alex', 'Sep 8, 2026', `<p>${variant}</p><p>Many thanks</p><p>Alex</p><p>Updated signature</p>`)}</div></div>`;
  await mail.evaluate(markup => { document.querySelector('main').innerHTML = markup; location.hash = '#inbox/duplicatethread123'; }, markup);
  await panel.getByText('2 messages', { exact: true }).waitFor();
  await panel.getByText('Quoted copy differs (1)', { exact: true }).click();
  await panel.getByText('You joined here · first visible inclusion', { exact: true }).waitFor();
  assert.ok(await panel.getByText('Updated signature', { exact: true }).isVisible());
  const [deduplicatedExport] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Text only (no images)' }).click()]);
  const deduplicatedPath = resolve('artifacts/enterprise-export.html');
  await deduplicatedExport.saveAs(deduplicatedPath);
  const deduplicatedHtml = await readFile(deduplicatedPath, 'utf8');
  assert.equal((deduplicatedHtml.match(/<article /g) || []).length, 2);
  assert.ok(deduplicatedHtml.includes('Riverside North'));
  assert.ok(!deduplicatedHtml.includes('2001'));
  await panel.screenshot({ path: 'artifacts/enterprise-regression.png', fullPage: true });
  // A forward without an introduction still records the receiving envelope,
  // enabling an inclusion marker without repeating the forwarded message body.
  const forwardOnly = markup.slice(markup.indexOf('<div data-message-id="joined">')).replace('<p>Adding you to the discussion.</p>', '');
  await mail.evaluate(markup => { document.querySelector('main').innerHTML = '<span data-ogsr-up><span data-email="new@example.com"></span></span><h2 class="hP">Forward only</h2>' + markup; location.hash = '#inbox/forwardonly123'; }, forwardOnly);
  await panel.getByText('Forward only', { exact: true }).waitFor();
  await panel.getByText('passed this conversation on', { exact: false }).waitFor();
  await panel.getByText('You joined here · first visible inclusion', { exact: true }).waitFor();
  // Images retain their author and placement; source-tab blob URLs are resolved
  // only when visible, and both sources become offline bytes on export.
  await mail.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    document.querySelector('main').innerHTML = `<h2 class="hP">Inline image verification</h2><div data-message-id="image-message"><span class="gD" email="lee@example.com" name="Lee">Lee</span><span class="g3" data-tooltip="2026-09-09T10:00:00Z"></span><div class="a3s aiL"><p>Before the current image.</p><img src="${blob}" alt="Current chart"><p>After the current image.</p><div class="gmail_attr">On Sep 8, 2026 at 10:00 AM UTC <a href="mailto:alex@example.com">Alex</a> wrote:</div><blockquote class="gmail_quote"><p>Original image below.</p><img src="https://mail.google.com/inline-test.png" alt="Original chart"></blockquote></div></div>`;
    location.hash = '#inbox/images123456';
  }, imageBytes.toString('base64'));
  await panel.getByText('Inline image verification', { exact: true }).waitFor();
  await panel.getByText('2 messages', { exact: true }).waitFor();
  for (const alt of ['Original chart', 'Current chart']) {
    const img = panel.getByRole('button', { name: `View image: ${alt}` });
    await img.scrollIntoViewIfNeeded();
    try {
      await panel.waitForFunction(alt => Array.from(document.images).some(img => img.alt === alt && img.naturalWidth === 960), alt);
    } catch (error) {
      console.error('Image failure', alt, await panel.locator('.email-body').evaluateAll(els => els.map(el => el.innerHTML)), panelLogs);
      await panel.screenshot({ path: 'artifacts/image-failure.png', fullPage: true });
      throw error;
    }
    await img.click();
    await panel.getByRole('dialog', { name: 'Full-size image' }).waitFor();
    await panel.getByRole('button', { name: 'Close image' }).click();
  }
  const beforeStats = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'READER_STATS' }), mailTabId);
  await mail.locator('.a3s > p').first().evaluate(el => { el.textContent = 'Updated text before the current image.'; });
  await panel.getByText('Updated text before the current image.', { exact: true }).waitFor();
  const afterStats = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'READER_STATS' }), mailTabId);
  assert.equal(afterStats.snapshots - beforeStats.snapshots, 1, 'editing one body snapshots only that message');
  await mail.locator('.a3s').evaluate(el => {
    const replacement = el.cloneNode(true);
    replacement.querySelector('p').textContent = 'Replacement body keeps both images.';
    el.replaceWith(replacement);
  });
  await panel.getByText('Replacement body keeps both images.', { exact: true }).waitFor();
  await panel.screenshot({ path: 'artifacts/inline-images.png', fullPage: true });
  const [imageDownload] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Text only (no images)' }).click()]);
  const imageExportPath = resolve('artifacts/inline-images.html');
  await imageDownload.saveAs(imageExportPath);
  const imageExport = await readFile(imageExportPath, 'utf8');
  // Every export is now the small one: pictures keep their place and their name,
  // and no picture bytes or provider addresses are written.
  assert.ok(!imageExport.includes('<img'), 'the export writes no pictures');
  assert.ok(!imageExport.includes('data:image/png;base64,'), 'the export writes no picture bytes');
  assert.equal((imageExport.match(/class="image-placeholder"/g) || []).length, 2, 'both pictures keep their place');
  for (const alt of ['Original chart', 'Current chart']) assert.ok(imageExport.includes(alt), `the export keeps the ${alt} caption`);
  const offlineImages = await context.newPage();
  await offlineImages.route('https://**/*', route => route.abort());
  await offlineImages.goto(pathToFileURL(imageExportPath).href);
  await offlineImages.getByText('Original chart', { exact: false }).first().waitFor();
  await offlineImages.screenshot({ path: 'artifacts/inline-images-export.png', fullPage: true });
  await offlineImages.close();
  await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), mailTabId);
  // Expanding an original rehosts images and changes alt captions in all its
  // nested copies. Several later invitations must still show one timeline.
  const members = ['Alice', 'Bob', 'Carol', 'Dana', 'Evan'];
  const expansionBody = (i, expanded) => `<p>Transfer update ${i}: Please review the twelve warehouse balances and confirm the reconciliation before the next scheduled delivery.</p><img src="https://mail.google.com/inline-test.png" alt="${expanded ? 'image.png' : 'Inline image'}"><p>Kind regards</p><p>${members[i]}</p>`;
  const histories = [], expandedBodies = [];
  let earlier = '';
  for (let i = 0; i < members.length; i++) {
    histories.push(expansionBody(i, false) + earlier);
    expandedBodies.push(histories[i].replaceAll('alt="Inline image"', 'alt="image.png"'));
    earlier = quote(members[i], `Sep ${6 + i}, 2026`, histories[i]);
  }
  const expansionMarkup = `<span data-ogsr-up><span data-email="new@example.com"></span></span><h2 class="hP">Stable expansion verification</h2>` + members.map((name, i) => `<div data-message-id="expand-${i}"><span class="gD" email="${name.toLowerCase()}@example.com" name="${name}">${name}</span>${i === 4 ? '<span class="g2" email="new@example.com"></span>' : ''}<span class="g3" data-tooltip="2026-09-${String(6 + i).padStart(2, '0')}T10:00:00Z"></span>${i === 4 ? `<div class="a3s aiL">${histories[i]}</div>` : `<button id="open-${i}">Open email ${i}</button>`}</div>`).join('');
  await mail.evaluate(({ markup, bodies }) => {
    document.querySelector('main').innerHTML = markup;
    bodies.slice(0, 4).forEach((html, i) => document.getElementById(`open-${i}`).onclick = () => {
      const container = document.querySelector(`[data-message-id="expand-${i}"]`);
      const existing = container.querySelector('.a3s');
      if (existing) existing.remove();
      else { const body = document.createElement('div'); body.className = 'a3s aiL'; body.innerHTML = html; container.append(body); }
    });
    location.hash = '#inbox/stableexpansion123';
  }, { markup: expansionMarkup, bodies: expandedBodies });
  await panel.getByText('Stable expansion verification', { exact: true }).waitFor();
  await panel.getByText('5 messages', { exact: true }).waitFor();
  await panel.getByText('You joined here · first visible inclusion', { exact: true }).waitFor();
  for (const i of [2, 0, 3, 1]) {
    const before = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'READER_STATS' }), mailTabId);
    await mail.getByRole('button', { name: `Open email ${i}`, exact: true }).click();
    // Await the offscreen result, not just the reader's snapshot dispatch.
    const expectedDirect = 2 + [2, 0, 3, 1].indexOf(i);
    let observed;
    for (let attempt = 0; attempt < 60; attempt++) {
      observed = await worker.evaluate(async () => Object.values(await chrome.storage.session.get(null)).find(data => data?.subject === 'Stable expansion verification'));
      if (observed?.messages.filter(m => m.id.startsWith('expand-')).length === expectedDirect) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(observed?.messages.length, 5);
    assert.equal(observed?.messages.filter(m => m.id.startsWith('expand-')).length, expectedDirect);
    const after = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, { type: 'READER_STATS' }), mailTabId);
    assert.equal(after.snapshots - before.snapshots, 1, 'opening an email snapshots only its newly available body');
    await panel.getByText('5 messages', { exact: true }).waitFor();
    assert.equal(await panel.getByText(/Quoted copy differs/).count(), 0, 'expansion must not invent edited variants');
  }
  const expansionSaved = await worker.evaluate(async () => Object.values(await chrome.storage.session.get(null)).find(data => data?.subject === 'Stable expansion verification'));
  assert.equal(expansionSaved.messages.length, 5);
  assert.deepEqual(expansionSaved.messages.map(m => m.body.match(/Transfer update \d/)?.[0]), members.map((_, i) => `Transfer update ${i}`));
  assert.ok(expansionSaved.messages.every(m => !m.quotedVariants?.length && m.bodyHtml.includes('<img')));
  await panel.screenshot({ path: 'artifacts/stable-expansion.png', fullPage: true });
  // Inbox navigation must clear mail rather than leaving stale content visible.
  await mail.evaluate(() => { location.hash = '#inbox'; });
  await panel.getByText('5 messages', { exact: true }).waitFor({ state: 'detached' });
  const exportedPage = await context.newPage();
  await exportedPage.goto(pathToFileURL(exportPath).href);
  assert.equal(await exportedPage.locator('article').count(), 4);
  assert.equal(await exportedPage.locator('table').count(), 1);
  await exportedPage.setViewportSize({ width: 1000, height: 1100 });
  await exportedPage.screenshot({ path: 'artifacts/conversation-export.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.ok(!panelLogs.some(text => text.includes('cross-world extension resource mismatch')), 'no cross-world preload warnings');
  console.log('PASS: real extension extraction, duplicate reconciliation, joined-midway and forward-only markers, four-message history, standalone text-only conversation export during search, identity-masked export, masked thread-source capture checked against the original, table, rich search, local file save/reload/download/remove, HTTPS/blob inline images, full-size viewer, named picture placeholders in exports, collapsing the mailbox again, jumping to both ends of the thread, incremental body updates/replacement, stable five-person expansion with images, navigation clearing; no page errors or cross-world preload warnings.');
} finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
