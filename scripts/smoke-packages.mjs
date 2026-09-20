/** Verify the delivered development and production packages against synthetic mail. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const output = resolve(`artifacts/packages-${version}`);
await mkdir(output, { recursive: true });
const png = await sharp({ create: { width: 80, height: 40, channels: 4, background: '#0284c7' } }).png().toBuffer();
const html = `<main role="main"><span data-ogsr-up><span data-email="me@example.com"></span></span><h2 class="hP">Package verification</h2><div data-message-id="package-message"><div class="gE"></div><span class="gD" email="alice@example.com" name="Alice">Alice</span><span class="g2" email="me@example.com"></span><span class="g3" data-tooltip="2026-09-19T10:00:00Z"></span><div class="a3s aiL"><p>Please review the warehouse balances.</p><table><tr><th>Item</th><th>Count</th></tr><tr><td>Warehouse</td><td>12</td></tr></table><img src="https://mail.google.com/test-chart.png" alt="Balance chart"><div class="gmail_attr">On Sep 18, 2026 at 10:00 AM UTC <a href="mailto:bob@example.com">Bob</a> wrote:</div><blockquote class="gmail_quote"><p>Earlier balance request.</p></blockquote></div><div class="aZo" data-tooltip="report.txt"><span class="aV3">report.txt</span><span class="aV7">12 B</span><a href="https://mail.google.com/mail/u/0/?view=att&amp;attid=1">Download</a></div></div></main>`;
const results = [];
for (const channel of ['prod', 'dev']) {
  const isDev = channel === 'dev';
  const extension = resolve(`releases/threadlens-${version}-${channel}`);
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.name, isDev ? 'ThreadLens Dev' : 'ThreadLens');
  const profile = await mkdtemp(join(tmpdir(), 'threadlens-packages-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.route('https://mail.google.com/**', route => route.fulfill(
      route.request().url().endsWith('/blocked.png') ? (route.request().resourceType() === 'image' ? { contentType: 'image/png', body: png, headers: { 'cache-control': 'no-store' } } : { status: 403, body: 'Unavailable' })
        : route.request().url().endsWith('/test-chart.png') ? { contentType: 'image/png', body: png }
        : route.request().url().includes('view=att') ? { contentType: 'text/plain', body: 'Report data' }
          : { contentType: 'text/html', body: html }));
    const mail = await context.newPage();
    await mail.goto('https://mail.google.com/mail/u/0/#inbox/packagecheck123456');
    await mail.evaluate(base64 => {
      const data = `data:image/png;base64,${base64}`;
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const blob = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      for (const [alt, src] of [['Blob chart', blob], ['Embedded chart', data], ['Restricted chart', 'https://mail.google.com/blocked.png']]) {
        const img = document.createElement('img'); img.alt = alt; img.src = src;
        document.querySelector('.a3s').append(img);
      }
    }, png.toString('base64'));
    let entry;
    for (let attempt = 0; attempt < 100; attempt++) {
      entry = await worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).find(([key]) => key.startsWith('thread:')));
      if (entry?.[1]?.messages?.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(entry?.[1]?.messages?.length, 2, `${channel} extracts the email`);
    const tabId = Number(entry[0].split(':')[1]);
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 440, height: 1050 });
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/src/side-panel/index.html`);
    await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tabId);
    await panel.getByText('2 messages', { exact: true }).waitFor();
    await panel.getByText('report.txt', { exact: true }).waitFor();
    await panel.getByText('You joined here · first visible inclusion', { exact: true }).waitFor();
    assert.equal(await panel.locator('table').count(), 1);
    await panel.locator('input[type="text"], input[type="search"]').fill('Warehouse');
    assert.equal(await panel.locator('table mark').innerText(), 'Warehouse');
    await panel.locator('input[type="text"], input[type="search"]').fill('');
    await panel.getByRole('button', { name: 'View image: Blob chart' }).waitFor();
    for (const alt of ['Balance chart', 'Blob chart', 'Embedded chart', 'Restricted chart']) {
      await panel.getByRole('button', { name: `View image: ${alt}` }).scrollIntoViewIfNeeded();
      await panel.waitForFunction(alt => Array.from(document.images).some(img => img.alt === alt && img.naturalWidth === 80), alt);
      await panel.getByRole('button', { name: `View image: ${alt}` }).click();
      const viewer = panel.getByRole('dialog', { name: 'Full-size image' });
      await viewer.waitFor();
      const download = viewer.getByRole('button', { name: 'Download image', exact: true });
      const close = viewer.getByRole('button', { name: 'Close image', exact: true });
      const positions = await Promise.all([download.boundingBox(), close.boundingBox()]);
      assert.ok(Math.abs(positions[0].y - positions[1].y) < 2, 'image controls share one row');
      if (alt === 'Restricted chart') {
        await download.click();
        await viewer.getByRole('alert').waitFor();
        assert.match(await viewer.getByRole('alert').innerText(), /Could not download image/);
        assert.equal(await download.isEnabled(), true, 'a failed download can be retried');
      } else {
        const [file] = await Promise.all([panel.waitForEvent('download'), download.click()]);
        assert.ok(file.suggestedFilename().endsWith('.png'));
        const path = join(output, `${channel}-${alt}.png`);
        await file.saveAs(path);
        assert.deepEqual(await readFile(path), png, 'download keeps the original image bytes');
        assert.equal(await viewer.isVisible(), true, 'downloading keeps the image open');
        if (alt === 'Balance chart') await panel.screenshot({ path: join(output, `${channel}-image-viewer.png`), fullPage: true });
      }
      await close.click();
    }
    for (const name of ['Read collapsed emails', 'Collapse emails again'])
      assert.equal(await panel.getByRole('button', { name, exact: true }).count(), 1);

    async function download(name) {
      const [file] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name }).click()]);
      const path = join(output, file.suggestedFilename());
      await file.saveAs(path);
      return readFile(path, 'utf8');
    }
    if (isDev) {
      const text = await download('Text only (no images)');
      assert.ok(text.includes('Warehouse') && !text.includes('<img'));
      const masked = await download('Masked copy (share-safe)');
      assert.ok(masked.includes('Warehouse') && !masked.includes('alice@example.com'));
      await panel.getByText('Report a parsing problem', { exact: true }).click();
      for (const [name, masked] of [['Thread source (masked)', true], ['Thread source (original, private)', false]]) {
        const capture = JSON.parse(await download(name));
        assert.equal(capture.masked, masked);
        assert.equal(capture.messages.length, 1);
        assert.equal(capture.fidelity.sameStructure, true);
      }
      await panel.getByText('Report a parsing problem', { exact: true }).click();
    } else {
      const controls = await panel.locator('button, a, summary, input[type="file"]').allTextContents();
      assert.ok(controls.every(text => !/download conversation|text only|masked copy|thread source|report a parsing problem/i.test(text)), controls.join('\n'));
      const capture = await worker.evaluate(async tabId => {
        try { return await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_THREAD_SOURCE' }); }
        catch { return null; }
      }, tabId);
      assert.ok(!capture, 'production content script does not provide diagnostic captures');
    }
    // Attachments are ordinary email functionality in BOTH packages.
    assert.match(await panel.getByRole('link', { name: 'Open in email', exact: true }).getAttribute('href'), /view=att/);
    await panel.getByRole('button', { name: 'Save locally', exact: true }).click();
    await panel.getByText('Saved on this device', { exact: true }).waitFor();
    await panel.reload();
    await panel.getByText('Saved on this device', { exact: true }).waitFor();
    assert.equal(await download('Download saved file'), 'Report data');
    await panel.getByRole('button', { name: 'Remove local copy', exact: true }).click();
    await panel.getByRole('button', { name: 'Choose downloaded file', exact: true }).waitFor();
    await panel.locator('input[type="file"]').setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('Manually imported report') });
    await panel.getByText('Saved on this device', { exact: true }).waitFor();
    assert.equal(await download('Download saved file'), 'Manually imported report');
    await panel.getByRole('button', { name: 'Remove local copy', exact: true }).click();
    await panel.getByRole('button', { name: 'Choose downloaded file', exact: true }).waitFor();
    if (!isDev) assert.equal(await panel.getByRole('button', { name: /Text only|Masked copy|Thread source|Download conversation/ }).count(), 0);
    await panel.screenshot({ path: join(output, `${channel}.png`), fullPage: true });
    // The mail controls remain functional even without export state in App.
    await mail.evaluate(() => document.querySelector('.gE').onclick = () => document.querySelector('.a3s')?.remove());
    await panel.getByRole('button', { name: 'Collapse emails again', exact: true }).click();
    await mail.waitForFunction(() => !document.querySelector('.a3s'));
    await panel.getByText('2 messages', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.push({ channel, version, messages: 2, conversationExportsEnabled: isDev, attachmentsSaveImportDownload: 'passed', imageDownloadsHttpsBlobDataAndFailure: 'passed', imagesTablesSearchAndMailControls: 'passed', pageErrors: 0 });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
