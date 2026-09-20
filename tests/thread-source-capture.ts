/**
 * Synthetic Gmail markup only; no private mailbox contents are checked in.
 *
 * The conversation below is the shape that keeps producing reports: two people
 * talking, a third added, a fourth added, and the reader added last, so most of
 * the thread reaches the mailbox only as quoted history — and then one older
 * email is opened, which is when duplicates used to appear.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseBatch, dropTab } from '../src/offscreen/parser';
import { startReader } from '../src/content/incremental-reader';
import { replayCapture, threadShape, compareShapes, captureFidelity } from '../src/shared/capture-replay';
import { foldImageSource, CAPTURE_FORMAT } from '../src/shared/capture';
import { maskCapture, captureFilename } from '../src/side-panel/export/capture';
import { IdentityMasker } from '../src/side-panel/export/mask';
import type { ThreadCapture } from '../src/shared/capture';
import type { ThreadData } from '../src/types';
import type { MessageSnapshot } from '../src/shared/snapshots';

/** The extension's own plumbing, standing in for Chrome: the mail page talks to a real parser. */
const harness = vi.hoisted(() => {
  const listeners: ((message: { type: string }, sender: unknown, respond: (value?: unknown) => void) => boolean | void)[] = [];
  let router: ((message: { type: string }) => Promise<unknown>) | null = null;
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (message: { type: string }) => (router ? router(message) : Promise.resolve(undefined)),
      onMessage: { addListener: (listener: unknown) => { listeners.push(listener as never); } },
    },
  };
  return { listeners, route(fn: (message: { type: string }) => Promise<unknown>) { router = fn; } };
});
import '../src/content/gmail-scraper';

let parsed: ThreadData | null = null;
harness.route(async (message: { type: string; batch?: never; data?: never }) => {
  if (message.type === 'SNAPSHOT_BATCH') return { data: await parseBatch(1, message.batch!) };
  if (message.type === 'THREAD_PARSED') { parsed = message.data as ThreadData; return { ok: true }; }
  return undefined;
});
function tell(message: { type: string }): unknown {
  let answer: unknown;
  for (const listener of harness.listeners) listener(message, {}, value => { answer = value; });
  return answer;
}
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── The conversation ─────────────────────────────────────────────────────────
const people = {
  alice: { name: 'Alice Nwosu', email: 'alice.nwosu@harbourfreight.co.uk' },
  ben: { name: 'Ben Carter', email: 'ben.carter@harbourfreight.co.uk' },
  chidi: { name: 'Chidi Okeke', email: 'chidi.okeke@meridian-supply.com' },
  dana: { name: 'Dana Fischer', email: 'dana.fischer@meridian-supply.com' },
  reader: { name: 'Sam Patel', email: 'sam.patel@northgate-logistics.co.uk' },
};
const SECRETS = ['Alice', 'Nwosu', 'alice.nwosu', 'Ben ', 'Carter', 'ben.carter', 'Chidi', 'Okeke', 'chidi.okeke',
  'Dana', 'Fischer', 'dana.fischer', 'Patel', 'sam.patel', 'harbourfreight', 'Harbour', 'meridian-supply',
  'Meridian', 'northgate-logistics', 'Northgate', '7700 900123', 'iVBORw0KGgoNOTAREALPICTURE'];

const DATA_LOGO = 'data:image/png;base64,iVBORw0KGgoNOTAREALPICTURE';
const signature = (who: { name: string }, title: string, company: string) =>
  `<p>Thanks &amp; Regards</p><p>${who.name}</p><p>${title}, ${company}</p><p>Direct line 07700 900123</p>`;

function attribution(from: { name: string; email: string }, when: string, inner: string): string {
  return `<div class="gmail_attr">On ${when} <a href="mailto:${from.email}">${from.name}</a> wrote:</div>`
    + `<blockquote class="gmail_quote">${inner}</blockquote>`;
}
const e1 = `<p>Hi ${people.ben.name.split(' ')[0]},</p><p>Please pull together the opening position for every in-transit warehouse`
  + ` transfer so that we can agree the September baseline before the audit visit lands with us.</p>`
  + signature(people.alice, 'Operations Lead', 'Harbour Freight');
const e2 = `<p>I have checked and currently there are no in-progress warehouse transfers outstanding.</p>`
  + attribution(people.alice, 'Sat, Sep 5, 2026 at 09:10', e1);
const e3 = `<p>Adding ${people.chidi.name} of Meridian Supply, who holds the transfer schedule for the southern depots,`
  + ` so that the week 37 movements can be confirmed against the same baseline.</p>`
  + attribution(people.ben, 'Sat, Sep 5, 2026 at 14:02', e2);
const e4 = `<p>Week 37 has four movements booked and the fifth is waiting on a slot at the northern gate.`
  + ` The schedule extract is attached below for reference.</p><p><img src="cid:schedule-extract@meridian" alt="Week 37 schedule"></p>`
  + attribution(people.alice, 'Mon, Sep 7, 2026 at 08:30', e3);
const e5 = `<p>Looping in ${people.dana.name}, who runs the reconciliation for Meridian Supply and will need the same`
  + ` numbers when the October cycle opens next month.</p>`
  + attribution(people.chidi, 'Tue, Sep 8, 2026 at 11:20', e4);
const e6 = `<p>${people.reader.name.split(' ')[0]}, adding you to this conversation because you take over the reconciliation`
  + ` from October and will need the whole history of these warehouse transfer movements.</p>`
  + `<p><img src="https://ci3.googleusercontent.com/proxy/tok3n#https://harbourfreight.co.uk/logo.png" alt="Harbour Freight"></p>`
  + `<p><img src="${DATA_LOGO}" alt="Meridian Supply"></p>`
  + signature(people.dana, 'Reconciliation Manager', 'Meridian Supply')
  + attribution(people.ben, 'Wed, Sep 9, 2026 at 16:45', e5);
const e7 = `<p>Noted, and the four booked movements still stand for week 37. I will confirm the fifth once the northern`
  + ` gate slot is released, which should be before the audit visit.</p>`
  + `<p><img src="blob:https://mail.google.com/copy-a1" alt="Harbour Freight"></p>`
  + `<p><img src="blob:https://mail.google.com/copy-a2" alt="Meridian Supply"></p>`
  + attribution(people.dana, 'Thu, Sep 10, 2026 at 09:14',
    `<p>&#9432; External email &#10095;</p>${e6}`)
  + `<div>[Message clipped] <a href="https://mail.google.com/view-entire">View entire message</a></div>`;

function container(id: string, from: { name: string; email: string }, to: { email: string }[], title: string, body: string | null, attachments = ''): string {
  const recipients = to.map(person => `<span class="g2" email="${person.email}">${person.email}</span>`).join('');
  return `<div class="adn ads" data-message-id="msg-f:${id}" data-legacy-message-id="${id}">`
    + `<div class="gE gt"><span class="gD" email="${from.email}" name="${from.name}" data-hovercard-id="${from.email}">${from.name}</span>`
    + `<div class="hb">${recipients}</div><div class="gH"><span class="g3" title="${title}">${title.slice(0, 6)}</span></div></div>`
    + (body === null ? '' : `<div class="ii gt"><div class="a3s aiL">${body}</div></div>${attachments}`)
    + `</div>`;
}
const attachmentChip = '<div class="aZo"><span class="aV3">week-37-harbourfreight-schedule.xlsx</span><span class="aV7">18 KB</span></div>';

const collapsed = container('1710000000000000005', people.ben, [people.chidi, people.dana], 'Wed, Sep 9, 2026, 4:45 PM', null);
const opened = container('1710000000000000005', people.ben, [people.chidi, people.dana], 'Wed, Sep 9, 2026, 4:45 PM', e5);
const inbox = container('1710000000000000006', people.dana, [people.reader, people.chidi, people.ben], 'Thu, Sep 10, 2026, 9:14 AM', e6)
  + container('1710000000000000007', people.chidi, [people.reader, people.dana], 'Fri, Sep 11, 2026, 10:05 AM', e7, attachmentChip);

async function readThread(html: string, threadId: string): Promise<{ thread: ThreadData; capture: ThreadCapture }> {
  parsed = null;
  location.hash = `#inbox/${threadId}`;
  document.body.innerHTML = `<div data-ogsr-up=""><div data-email="${people.reader.email}"></div></div><h2 class="hP">Warehouse transfer movements</h2>${html}`;
  tell({ type: 'SCRAPE_THREAD' });
  // Four messages travel per batch, and each batch waits a debounce out.
  for (let round = 0; round < 6 && !parsed; round++) await settle(400);
  await settle(400);
  const capture = tell({ type: 'CAPTURE_THREAD_SOURCE' }) as ThreadCapture;
  return { thread: parsed!, capture };
}

let closed: { thread: ThreadData; capture: ThreadCapture };
let expanded: { thread: ThreadData; capture: ThreadCapture };
beforeAll(async () => {
  closed = await readThread(collapsed + inbox, 'threadaaaaaaaa1');
  dropTab(1);
  expanded = await readThread(opened + inbox, 'threadaaaaaaaa2');
}, 20000);
afterAll(() => { dropTab(1); document.body.innerHTML = ''; location.hash = ''; });

describe('Capturing the thread the mail page is actually showing', () => {
  it('records one entry per provider container, with the snapshot the parser received', () => {
    expect(closed.capture.format).toBe(CAPTURE_FORMAT);
    expect(closed.capture.client).toBe('gmail');
    expect(closed.capture.threadId).toBe('threadaaaaaaaa1');
    expect(closed.capture.currentUserEmail).toBe(people.reader.email);
    expect(closed.capture.messages).toHaveLength(3);
    expect(closed.capture.messages.map(message => message.position)).toEqual([0, 1, 2]);
    const readable = closed.capture.messages.filter(message => message.snapshot);
    expect(readable).toHaveLength(2);
    expect(readable.every(message => message.live)).toBe(true);
    expect(readable[0].snapshot!.message.sender.email).toBe(people.dana.email);
    expect(readable[0].snapshot!.html).toContain('take over the reconciliation');
  });

  it('keeps the collapsed row, its headers and an explanation of why it holds no body', () => {
    const row = closed.capture.messages[0];
    expect(row.bodyFound).toBe(false);
    expect(row.snapshot).toBeNull();
    expect(row.containerHtml).toContain('Sep 9, 2026, 4:45 PM');
    expect(closed.capture.notes.join(' ')).toContain('collapsed email is not readable until it is opened');
  });

  it('reads the provider markup a scraping problem lives in, not only the parsed body', () => {
    const container = closed.capture.messages[2].containerHtml;
    expect(container).toContain('data-message-id="msg-f:1710000000000000007"');
    expect(container).toContain('class="g3"');
    expect(container).toContain('week-37-harbourfreight-schedule.xlsx');
    expect(closed.capture.messageSelector).toBe('[data-message-id]');
    expect(closed.capture.readerStats.snapshots).toBeGreaterThan(0);
  });

  it('replays to exactly the thread the extension itself produced', () => {
    const replay = replayCapture(closed.capture);
    expect(replay.thread).not.toBeNull();
    expect(replay.shape).toEqual(threadShape(closed.thread));
    // The whole point of the conversation: four authors, most of them reaching
    // this mailbox only as quoted history, and a reader who was added at the end.
    expect(new Set(replay.thread!.messages.map(message => message.sender.email)))
      .toEqual(new Set([people.alice.email, people.ben.email, people.chidi.email, people.dana.email]));
    expect(replay.thread!.messages.filter(message => message.source === 'quoted').length).toBeGreaterThan(2);
    expect(replay.thread!.participation?.kind).toBe('recipient');
  });

  it('replays the same thread whether the mailbox delivers it whole or in batches', () => {
    expect(replayCapture(closed.capture, { batchSize: 0 }).shape).toEqual(replayCapture(closed.capture).shape);
    expect(replayCapture(expanded.capture, { batchSize: 0 }).shape).toEqual(replayCapture(expanded.capture).shape);
  });

  it('shows opening an older email adding no duplicate, as the panel and the capture agree', () => {
    expect(expanded.capture.messages.filter(message => message.snapshot)).toHaveLength(3);
    expect(replayCapture(expanded.capture).shape).toEqual(threadShape(expanded.thread));
    expect(expanded.thread.messages).toHaveLength(closed.thread.messages.length);
    const bodies = expanded.thread.messages.map(message => message.body.slice(0, 60));
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

describe('Masking a capture without changing what it reproduces', () => {
  it('writes no real name, address, domain, phone number or picture payload', () => {
    const file = JSON.stringify(maskCapture(closed.capture));
    for (const secret of SECRETS) expect(file, `leaked ${secret}`).not.toContain(secret);
    expect(file).toContain('Person 1');
    expect(file).toContain('company1.example');
    expect(file).toContain('[phone-1]');
    expect(file).not.toContain('msg-f:1710000000000000006');
  });

  it('parses to the same thread as the original it was made from', () => {
    const masked = maskCapture(closed.capture);
    expect(replayCapture(masked).shape).toEqual(replayCapture(closed.capture).shape);
    const fidelity = captureFidelity(closed.capture, masked);
    expect(fidelity.sameStructure).toBe(true);
    expect(fidelity.orderIndependent).toBe(true);
    expect(fidelity.differences).toEqual([]);
    expect(fidelity.maskedMessages).toBe(fidelity.originalMessages);
    expect(fidelity.summary).toContain('same');
  });

  it('parses to the same thread after an older email is opened, too', () => {
    const fidelity = captureFidelity(expanded.capture, maskCapture(expanded.capture));
    expect(fidelity.sameStructure).toBe(true);
    expect(fidelity.differences).toEqual([]);
  });

  it('keeps the provider markup a scraper reads: classes, ids, clocks and recipient rows', () => {
    const masked = maskCapture(closed.capture);
    const container = masked.messages[2].containerHtml;
    expect(container).toContain('class="g3"');
    expect(container).toContain('title="Fri, Sep 11, 2026, 10:05 AM"');
    expect(container).toContain('class="a3s aiL"');
    expect(container).toMatch(/data-message-id="masked-\d+"/);
    expect(container).toMatch(/email="person\d+@/);
    expect(container).toMatch(/\.xlsx/);
  });

  it('replaces a picture with a placeholder of its own kind, so copies still match as they did', () => {
    const masker = new IdentityMasker();
    const blob = masker.imageSource('blob:https://mail.google.com/copy-a1');
    expect(blob).toMatch(/^blob:https:\/\/mail\.google\.com\//);
    expect(masker.imageSource('blob:https://mail.google.com/copy-a2')).not.toBe(blob);
    expect(masker.imageSource('cid:schedule@meridian')).toMatch(/^cid:masked-/);
    expect(masker.imageSource('https://ci3.googleusercontent.com/proxy/tok3n')).toContain('googleusercontent.com/proxy/');
    // One picture behind two proxy tokens is one picture, and stays one.
    const first = masker.imageSource('https://ci3.googleusercontent.com/proxy/aaa#https://harbourfreight.co.uk/logo.png');
    const second = masker.imageSource('https://ci9.googleusercontent.com/proxy/bbb#https://harbourfreight.co.uk/logo.png');
    expect(first.split('#')[1]).toBe(second.split('#')[1]);
    expect(first).not.toContain('harbourfreight');
    // A payload names a picture; two payloads that differ must keep differing.
    const one = masker.imageSource('data:image/png;base64,AAAA'), two = masker.imageSource('data:image/png;base64,BBBB');
    expect(one).not.toBe(two);
    expect(one).toBe(masker.imageSource('data:image/png;base64,AAAA'));
    expect(one).not.toContain('AAAA');
    // The query around one address varies per copy and never named a second picture.
    expect(masker.imageSource('https://cdn.harbourfreight.co.uk/sig.png?size=1'))
      .toBe(masker.imageSource('https://cdn.harbourfreight.co.uk/sig.png?size=2'));
  });

  it('never rewrites a date, even for a correspondent whose name is a calendar word', () => {
    const masker = new IdentityMasker();
    masker.person('may.march@northgate-logistics.co.uk', 'May March');
    expect(masker.text('Sent Wed, Sep 9, 2026 at 16:45; due May 3 and reviewed on Monday.'))
      .toBe('Sent Wed, Sep 9, 2026 at 16:45; due May 3 and reviewed on Monday.');
  });

  it('writes a whole masked capture that npm run replay can read back', () => {
    const masked = maskCapture(closed.capture);
    masked.fidelity = captureFidelity(closed.capture, masked);
    mkdirSync('artifacts', { recursive: true });
    // A synthetic example of exactly the file a report should attach, and the
    // fixture `npm run replay -- artifacts/thread-source-capture.json` reads.
    writeFileSync('artifacts/thread-source-capture.json', JSON.stringify(masked, null, 1));
    expect(masked.fidelity.sameStructure).toBe(true);
  });

  it('names the file so a masked copy is never mistaken for the private one', () => {
    const date = new Date('2026-09-11T10:00:00Z');
    expect(captureFilename('Warehouse transfer movements', date, true)).toBe('ThreadLens-Warehouse transfer movements-2026-09-11-source-masked.json');
    expect(captureFilename('Warehouse transfer movements', date, false)).toMatch(/-source-original\.json$/);
    expect(captureFilename(maskCapture(closed.capture).subject, date, true)).not.toContain('Harbour');
  });
});

describe('Saying so when a masked copy would not reproduce the problem', () => {
  it('reports a message the masked copy lost, rather than claiming the copy is faithful', () => {
    const masked = maskCapture(closed.capture);
    // The last email is the only one no other copy repeats, so losing it loses a message.
    const broken = { ...masked, messages: masked.messages.filter(message => message.position !== 2) };
    const fidelity = captureFidelity(closed.capture, broken);
    expect(fidelity.sameStructure).toBe(false);
    expect(fidelity.maskedMessages).toBeLessThan(fidelity.originalMessages);
    expect(fidelity.differences.length).toBeGreaterThan(0);
    expect(fidelity.summary).toContain('Send the original as well');
  });

  it('names the field that moved, not merely that something did', () => {
    const differences = compareShapes(['#0 time=a lines=2'], ['#0 time=b lines=2'], ['original', 'masked copy']);
    expect(differences).toHaveLength(1);
    expect(differences[0]).toContain('time differ');
  });
});

describe('Folding picture bytes out of a capture', () => {
  it('keeps one payload one picture and two payloads two, without carrying either', () => {
    const first = foldImageSource(`data:image/png;base64,${'A'.repeat(4096)}`);
    expect(first).toBe(foldImageSource(`data:image/png;base64,${'A'.repeat(4096)}`));
    expect(first).not.toBe(foldImageSource(`data:image/png;base64,${'B'.repeat(4096)}`));
    expect(first.length).toBeLessThan(64);
    expect(first).toMatch(/^data:image\/png;base64,folded/);
  });
  it('leaves every other kind of address exactly as the page wrote it', () => {
    for (const source of ['blob:https://mail.google.com/copy-a1', 'cid:logo@example', 'https://example.com/a.png?tok=1', ''])
      expect(foldImageSource(source)).toBe(source);
  });
  it('holds no picture bytes anywhere in a capture', () => {
    expect(JSON.stringify(closed.capture)).not.toContain('NOTAREALPICTURE');
    const sources = closed.capture.messages.flatMap(message => message.snapshot?.imageSources ?? []);
    expect(sources.filter(source => source.startsWith('data:')).every(source => source.includes('folded'))).toBe(true);
  });
});

describe('Reading a capture back into a page', () => {
  it('reads the masked containers as the same conversation, so the markup really did survive', async () => {
    const masked = maskCapture(closed.capture);
    dropTab(1);
    const replanted = await readThread(masked.messages.map(message => message.containerHtml).join(''), 'threadaaaaaaaa3');
    expect(replanted.thread.messages).toHaveLength(closed.thread.messages.length);
    expect(threadShape(replanted.thread).map(line => line.replace(/time=\S+ /, '')))
      .toEqual(replayCapture(masked).shape.map(line => line.replace(/time=\S+ /, '')));
  }, 20000);
});

describe('The reader\'s own capture rules', () => {
  function stubAdapter(snapshot: (el: HTMLElement) => MessageSnapshot | null) {
    return { client: 'gmail' as const, messageSelector: '.stub', bodySelector: '.stub-body',
      threadId: () => 'stub-thread', subject: () => 'Stub', currentUser: () => 'a@example.com',
      snapshot: (el: HTMLElement) => snapshot(el) };
  }
  it('prefers the snapshot the parser already received over reading the page again', async () => {
    document.body.innerHTML = '<div class="stub" id="one"><div class="stub-body">Body</div></div>';
    let reads = 0;
    const reader = startReader(stubAdapter(el => ({
      message: { id: `read-${++reads}`, sender: { name: 'A', email: 'a@example.com', initials: 'A', avatarColor: '#000' },
        timestamp: '2026-09-09T12:00:00Z', body: el.textContent ?? '', source: 'direct', index: 0, isCurrentUser: false },
      html: '<p>Body</p>', imageSources: [],
    })));
    try {
      await settle(500);
      const capture = reader.capture();
      expect(capture.messages[0].live).toBe(true);
      expect(capture.messages[0].snapshot!.message.id).toBe('read-1');
      expect(reads).toBe(1);
    } finally { reader.disconnect(); document.body.innerHTML = ''; }
  });
  it('shortens an oversized provider container and says that it did', () => {
    document.body.innerHTML = `<div class="stub"><div class="stub-body">${'filler '.repeat(120000)}</div></div>`;
    const reader = startReader(stubAdapter(() => null));
    try {
      const capture = reader.capture();
      expect(capture.messages[0].containerTruncated).toBe(true);
      expect(capture.messages[0].containerHtml.length).toBeLessThanOrEqual(512 * 1024);
      expect(capture.notes.join(' ')).toContain('shortened');
    } finally { reader.disconnect(); document.body.innerHTML = ''; }
  });
  it('folds a picture payload out of the container markup as well as the snapshot', () => {
    document.body.innerHTML = `<div class="stub"><img src="${DATA_LOGO}"><div class="stub-body">Body</div></div>`;
    const reader = startReader(stubAdapter(() => null));
    try {
      const capture = reader.capture();
      expect(capture.messages[0].containerHtml).not.toContain('NOTAREALPICTURE');
      expect(capture.messages[0].containerHtml).toContain('folded');
    } finally { reader.disconnect(); document.body.innerHTML = ''; }
  });
});
