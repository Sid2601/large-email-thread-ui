import { expect, it } from 'vitest';
import { IdentityMasker, maskThread } from '../src/side-panel/export/mask';
import { conversationHtml, conversationFilename, downloadConversation } from '../src/side-panel/export/conversation';
import { stripImages } from '../src/side-panel/media/images';
import { buildSender } from '../src/content/scraper-utils';
import type { ThreadData } from '../src/types';

const thread: ThreadData = {
  threadId: 'thread-9981', subject: 'Warehouse transfer — Northwind Logistics', client: 'gmail',
  scrapedAt: '2026-09-09T12:00:00Z', currentUserEmail: 'dana.okafor@northwind-logistics.co.uk',
  participants: [
    { sender: buildSender('Dana Okafor', 'dana.okafor@northwind-logistics.co.uk'), messageCount: 1, firstSeen: '2026-09-09T12:00:00Z' },
    { sender: buildSender('Priya Raman', 'priya.raman@gmail.com'), messageCount: 1, firstSeen: '2026-09-08T09:00:00Z' },
  ],
  messages: [
    {
      id: 'msg-abc', index: 0, isCurrentUser: false, source: 'quoted',
      sender: buildSender('Priya Raman', 'priya.raman@gmail.com'), timestamp: '2026-09-08T09:00:00Z',
      body: 'Hi Dana,\nNorthwind can take the pallets on 2026-09-08 12:00. Call me on +44 7700 900123.\nPriya Raman',
      bodyHtml: '<p>Hi Dana,</p><p>Northwind can take the pallets on 2026-09-08 12:00. Call me on +44 7700 900123.</p>'
        + '<table><tr><td colspan="2">Pallets for <b>Northwind</b></td></tr></table>'
        + '<p><a href="https://northwind-logistics.co.uk/orders?token=SECRET9">Order 4471</a> — <a href="mailto:dana.okafor@northwind-logistics.co.uk">Dana</a></p>'
        + '<p><img src="https://mail.google.com/proxy/dana-okafor-signature.png" alt="Dana Okafor signature"></p>',
      recipients: ['dana.okafor@northwind-logistics.co.uk'],
      quotedText: 'Forwarded by ops@northwind-logistics.co.uk',
      quotedBy: 'msg-def',
      attachments: [{ name: 'Northwind-Dana-Okafor-invoice.pdf', mimeType: 'application/pdf', sizeLabel: '1 MB', downloadUrl: 'https://mail.google.com/?token=SECRET9' }],
    },
    {
      id: 'msg-def', index: 1, isCurrentUser: true, source: 'direct', orderedByQuote: true,
      sender: buildSender('Dana Okafor', 'dana.okafor@northwind-logistics.co.uk'), timestamp: '2026-09-09T12:00:00Z',
      body: 'Thanks Priya — confirmed. Invoice 4471 is 12,500 units at 2026-09-09 09:30.',
      quotedVariants: [{ body: 'Thanks PRIYA — confirmed.', bodyHtml: '<p>Thanks Priya Raman — confirmed.</p>' }],
    },
  ],
};

const date = new Date('2026-09-09T12:00:00Z');
const maskedHtml = () => conversationHtml(maskThread(thread), date, { masked: true });

it('replaces every real identity, domain, phone number and link token in the export', () => {
  const html = maskedHtml();
  for (const secret of ['Dana', 'Okafor', 'Priya', 'Raman', 'Northwind', 'northwind-logistics', 'dana.okafor', 'priya.raman', '7700 900123', 'SECRET9', 'thread-9981', 'msg-abc']) {
    expect(html, `leaked ${secret}`).not.toContain(secret);
  }
  expect(html).toContain('person1@gmail.com');
  expect(html).toContain('Person 1');
  expect(html).toContain('Person 2');
  expect(html).toContain('company1.example');
  expect(html).toContain('[phone-1]');
});

it('maps one person to one placeholder everywhere they appear, including inside bodies', () => {
  const masked = maskThread(thread);
  const priya = masked.messages[0].sender;
  const dana = masked.messages[1].sender;
  expect(priya.email).not.toBe(dana.email);
  expect(priya.initials).toBe('P1');
  // The sender's own name in the signature and the recipient's name in the greeting resolve to their headers.
  expect(masked.messages[0].body).toContain(dana.name);
  expect(masked.messages[0].body.trimEnd().endsWith(priya.name)).toBe(true);
  expect(masked.messages[0].recipients).toEqual([dana.email]);
  expect(masked.messages[1].body).toContain(dana.name === 'Person 1' ? 'Person 2' : 'Person 1');
  expect(masked.currentUserEmail).toBe(dana.email);
  // Names are collapsed rather than repeated once per part.
  expect(masked.messages[1].quotedVariants?.[0].bodyHtml).toBe(`<p>Thanks ${priya.name} — confirmed.</p>`);
});

it('keeps wording, structure, order, timestamps and recovery labels so the copy still reproduces a problem', () => {
  const doc = new DOMParser().parseFromString(maskedHtml(), 'text/html');
  expect(doc.querySelectorAll('article')).toHaveLength(2);
  expect(doc.querySelector('td')?.getAttribute('colspan')).toBe('2');
  expect(doc.body.textContent).toContain('Recovered from quoted history');
  expect(doc.body.textContent).toContain('Placed by the quoted reply chain');
  expect(doc.body.textContent).toContain('can take the pallets on 2026-09-08 12:00');
  expect(doc.body.textContent).toContain('12,500 units at 2026-09-09 09:30');
  expect(doc.querySelector('.masked-note')?.textContent).toContain('Identity-masked copy');
});

it('renumbers message ids while keeping the references between them', () => {
  const masked = maskThread(thread);
  expect(masked.messages[0].id).not.toBe('msg-abc');
  expect(masked.messages[0].quotedBy).toBe(masked.messages[1].id);
  expect(masked.threadId).not.toBe('thread-9981');
});

it('writes no image bytes, no attachment URLs and no mail-tab reference', () => {
  const masked = maskThread({ ...thread, sourceTabId: 7 });
  expect(masked.sourceTabId).toBeUndefined();
  expect(masked.messages[0].attachments?.[0].downloadUrl).toBe('');
  expect(masked.messages[0].attachments?.[0].name).toMatch(/\.pdf$/);
  const doc = new DOMParser().parseFromString(conversationHtml(masked, date, { masked: true }), 'text/html');
  // Every inline picture keeps its place under a neutral name and points at nothing real.
  expect(Array.from(doc.querySelectorAll('img')).map(img => img.getAttribute('src'))).toEqual(['https://images.example/image-1.png']);
  expect(stripImages(conversationHtml(masked, date, { masked: true })).html).not.toContain('<img');
  const links = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));
  expect(links.some(href => href?.includes('northwind'))).toBe(false);
  expect(links).toContain('https://company1.example/orders?masked');
});

it('masks addresses that appear only in a body, and leaves ordinary words alone', () => {
  const masker = new IdentityMasker();
  masker.person('dana.okafor@northwind-logistics.co.uk', 'Dana Okafor');
  const text = masker.text('Please copy stock.control@thirdparty.example and keep the 500 pallets in the London depot.');
  expect(text).toContain('person2@company2.example');
  expect(text).toContain('keep the 500 pallets in the London depot');
});

it('does not mistake dates, order quantities or reference numbers for phone numbers', () => {
  const masker = new IdentityMasker();
  const text = masker.text('Sent 2026-09-09 12:00, PO 4471 for 12500 units; ring 07700 900123 or +44 20 7946 0958.');
  expect(text).toContain('Sent 2026-09-09 12:00, PO 4471 for 12500 units');
  expect(text).toContain('[phone-1]');
  expect(text).toContain('[phone-2]');
});

it('masks a capitalised short name and a run-together domain, but not ordinary lowercase words', () => {
  const masker = new IdentityMasker();
  masker.person('siddharth.shah@elevationservices.co.uk', 'Siddharth Shah');
  const text = masker.text('Hi Sid, Elevation Services will collect the parts. Please sid-step the old ref and check the car park.');
  expect(text).toContain('Hi Person 1,');
  expect(text).toContain('Company 1 Services will collect');
  expect(text).toContain('check the car park');
  expect(text).not.toMatch(/\bSid\b/);
});

it('masks a company written run-together, as filenames and domains write it', () => {
  const masker = new IdentityMasker();
  masker.person('j.okonkwo@warehouse-partners.com', 'Joy Okonkwo');
  expect(masker.text('WarehousePartners-Joy-invoice.pdf')).toBe('Company 1-Person 1-invoice.pdf');
  expect(masker.text('Warehouse Partners Ltd')).toBe('Company 1 Ltd');
});

it('labels a bare reference number as a number rather than claiming it is a phone number', () => {
  const masker = new IdentityMasker();
  const text = masker.text('Ref 998877665544, call 07700 900123.');
  expect(text).toContain('[number-1]');
  expect(text).toContain('[phone-2]');
});

it('names the masked download so it is not mistaken for the real conversation', async () => {
  const masked = maskThread(thread);
  expect(conversationFilename(masked.subject, date, 'masked')).not.toContain('Northwind');
  expect(conversationFilename('Rollout', date, 'masked')).toBe('ThreadLens-Rollout-2026-09-09-masked.html');

  const clicked: string[] = [];
  const createElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = (() => 'blob:masked-test') as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  document.createElement = ((tag: string) => {
    const element = createElement(tag);
    if (tag === 'a') element.click = () => clicked.push((element as HTMLAnchorElement).download);
    return element;
  }) as typeof document.createElement;
  try {
    await downloadConversation({ ...thread, sourceTabId: 7 }, { mask: true });
  } finally {
    document.createElement = createElement;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
  expect(clicked).toHaveLength(1);
  expect(clicked[0]).toMatch(/-masked\.html$/);
  expect(clicked[0]).not.toContain('Northwind');
});
