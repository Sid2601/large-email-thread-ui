/** Synthetic Gmail CPU benchmark. No account or real emails are used. */
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let chain = '', messages = '';
for (let i = 0; i < 40; i++) {
  const body = `<p>Update ${i}: ${'Warehouse transfer reconciliation figures and delivery confirmation. '.repeat(15)}</p><table><tr><td>Reference ${i}</td><td>${100 + i}</td></tr></table>`;
  messages += `<div data-message-id="message-${i}"><span class="gD" email="person${i % 4}@example.com">Person ${i % 4}</span><span class="g3" title="2026-09-08T10:${String(i).padStart(2, '0')}:00Z"></span><div class="a3s aiL">${body}${chain}</div></div>`;
  chain = `<div class="gmail_attr">On Sep 8, 2026 at 10:${String(i).padStart(2, '0')} AM UTC <a href="mailto:person${i % 4}@example.com">Person ${i % 4}</a> wrote:</div><blockquote class="gmail_quote">${body}${chain}</blockquote>`;
}
const html = `<meta charset="utf-8"><main role="main"><h2 class="hP">Synthetic 40-message benchmark</h2><div id="toolbar"></div><button data-tooltip="Expand all" onclick="window.expandClicks=(window.expandClicks||0)+1">Expand all</button>${messages}</main>`;
async function run(path, name) {
  const profile = await mkdtemp(join(tmpdir(), 'threadlens-bench-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.route('https://mail.google.com/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    const page = await context.newPage(); const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    const start = Date.now();
    await page.goto('https://mail.google.com/mail/u/0/#inbox/benchmark12345');
    let data;
    for (let n = 0; n < 60; n++) {
      await wait(500);
      data = await worker.evaluate(async () => Object.entries(await chrome.storage.session.get(null)).find(([k]) => k.startsWith('thread:')));
      if (data?.[1].messages.length >= 40) break;
    }
    if (!data || data[1].messages.length !== 40) throw new Error(`${name}: expected 40 messages, got ${data?.[1]?.messages.length}`);
    await wait(2000);
    const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const statsBefore = await worker.evaluate(async id => { try { return await chrome.tabs.sendMessage(id, { type: 'READER_STATS' }); } catch { return null; } }, Number(data[0].split(':')[1]));
    for (let i = 0; i < 5; i++) {
      await page.evaluate(i => { document.querySelector('#toolbar').textContent = `Scrolling position ${i}`; window.scrollTo(0, i % 2 ? document.body.scrollHeight : 0); }, i);
      await wait(800);
    }
    await wait(1000);
    const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const statsAfter = await worker.evaluate(async id => { try { return await chrome.tabs.sendMessage(id, { type: 'READER_STATS' }); } catch { return null; } }, Number(data[0].split(':')[1]));
    if (statsBefore && statsAfter.snapshots !== statsBefore.snapshots) throw new Error('Unrelated toolbar/scroll changes resnapshotted messages.');
    return { name, inputHtmlBytes: html.length, messages: data[1].messages.length, elapsedMs: Date.now() - start, initialPageScriptMs: before.ScriptDuration * 1000, scrollBurstPageScriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, automaticExpandClicks: await page.evaluate(() => window.expandClicks || 0), statsBefore, statsAfter };
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
const version = async path => JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')).version;
const results = [];
if (process.env.BASELINE_EXTENSION) results.push(await run(resolve(process.env.BASELINE_EXTENSION), `baseline ${await version(process.env.BASELINE_EXTENSION)}`));
results.push(await run(resolve('dist'), `current ${await version('dist')}`));
await mkdir('artifacts', { recursive: true }); await writeFile(process.env.BENCHMARK_OUTPUT || 'artifacts/performance.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
