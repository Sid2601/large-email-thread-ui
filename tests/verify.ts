/**
 * ThreadLens parser test suite.
 *
 * Tests the quoted-chain parser (and supporting utilities) against 10
 * realistic email-thread fixtures covering Gmail DOM, Outlook plain-text,
 * Gmail-forward, and edge cases.
 *
 * Run: npx vitest run
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Parser under test — imported directly (no Chrome APIs needed here)
import { parseQuotedChain } from '../src/content/quoted-chain-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Create an element from an HTML string (for fixtures that contain real HTML markup). */
function makeElement(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

/**
 * Wrap plain text in a DOM element safely.
 * Escapes angle brackets so email addresses like <alice@example.com> survive
 * HTML parsing instead of being consumed as tags.
 */
function makePlainTextElement(text: string): Element {
  const div = document.createElement('div');
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  div.innerHTML = escaped;
  return div;
}

const ANCHOR = '2026-04-10T17:00:00.000Z';
const THREAD_ID = 'test-thread-001';
const USER_EMAIL = 'bob@example.com';

// ─────────────────────────────────────────────────────────────────────────────
// T1 — Simple Gmail 2-person reply
// ─────────────────────────────────────────────────────────────────────────────

describe('01 — Simple Gmail reply chain', () => {
  const html = fixture('01-simple-gmail-reply.txt');
  const messages = parseQuotedChain(makeElement(html), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts exactly 1 quoted message', () => {
    expect(messages).toHaveLength(1);
  });

  it('identifies the correct sender email', () => {
    expect(messages[0].sender.email).toBe('alice@example.com');
  });

  it('identifies the correct sender name', () => {
    expect(messages[0].sender.name).toBe('Alice Smith');
  });

  it('body contains the message text', () => {
    expect(messages[0].body).toContain('review the proposal');
  });

  it('marks message as NOT from current user', () => {
    expect(messages[0].isCurrentUser).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — 3-person Gmail thread
// ─────────────────────────────────────────────────────────────────────────────

describe('02 — 3-person Gmail thread', () => {
  const html = fixture('02-gmail-multi-person.txt');
  const messages = parseQuotedChain(makeElement(html), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts 3 unique messages', () => {
    expect(messages).toHaveLength(3);
  });

  it('contains Alice as a sender', () => {
    expect(messages.some(m => m.sender.email === 'alice@example.com')).toBe(true);
  });

  it('contains Bob as a sender', () => {
    expect(messages.some(m => m.sender.email === 'bob@example.com')).toBe(true);
  });

  it('contains Carol as a sender', () => {
    expect(messages.some(m => m.sender.email === 'carol@example.com')).toBe(true);
  });

  it('messages are sorted chronologically (oldest first)', () => {
    const timestamps = messages.map(m => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('assigns stable unique IDs', () => {
    const ids = messages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Gmail forward
// ─────────────────────────────────────────────────────────────────────────────

describe('03 — Gmail forward message', () => {
  const text = fixture('03-gmail-forward.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts the forwarded message', () => {
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('identifies Bob as the forwarded sender', () => {
    expect(messages.some(m => m.sender.email === 'bob@example.com')).toBe(true);
  });

  it('body contains key content', () => {
    const bobMsg = messages.find(m => m.sender.email === 'bob@example.com');
    expect(bobMsg?.body).toContain('budget');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Outlook chain
// ─────────────────────────────────────────────────────────────────────────────

describe('04 — Outlook email chain', () => {
  const text = fixture('04-outlook-chain.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts at least 2 messages from Outlook chain', () => {
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('identifies Alice as a sender', () => {
    expect(messages.some(m => m.sender.email === 'alice@example.com')).toBe(true);
  });

  it('identifies Bob as a sender', () => {
    expect(messages.some(m => m.sender.email === 'bob@example.com')).toBe(true);
  });

  it('parses real timestamps (not fallback estimates)', () => {
    const aliceMsg = messages.find(m => m.sender.email === 'alice@example.com');
    expect(aliceMsg?.timestamp).toContain('2026');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Mixed Gmail forward + Outlook inside
// ─────────────────────────────────────────────────────────────────────────────

describe('05 — Mixed Gmail forward with Outlook chain inside', () => {
  const text = fixture('05-mixed-gmail-outlook.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts messages from the nested Outlook chain', () => {
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('finds devops sender', () => {
    expect(messages.some(m => m.sender.email === 'devops@example.com')).toBe(true);
  });

  it('all messages have non-empty bodies', () => {
    for (const msg of messages) {
      expect(msg.body.trim().length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 — Single message, no history
// ─────────────────────────────────────────────────────────────────────────────

describe('06 — Single message with no quoted history', () => {
  const html = fixture('06-single-message.txt');
  const messages = parseQuotedChain(makeElement(html), USER_EMAIL, THREAD_ID, ANCHOR);

  it('returns 0 messages (no history to parse)', () => {
    expect(messages).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Legal disclaimer stripping
// ─────────────────────────────────────────────────────────────────────────────

describe('07 — Legal disclaimer stripping', () => {
  const text = fixture('07-legal-disclaimer.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts messages from chain with disclaimer', () => {
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('body does not contain the legal disclaimer text', () => {
    for (const msg of messages) {
      expect(msg.body).not.toMatch(/this e-?mail and any attachments/i);
      expect(msg.body).not.toMatch(/email transmissions are not secure/i);
    }
  });

  it('Bob message body contains the real content', () => {
    const bobMsg = messages.find(m => m.sender.email === 'bob@example.com');
    expect(bobMsg?.body).toContain('deployment is complete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — Duplicate message deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe('08 — Duplicate message deduplication', () => {
  const html = fixture('08-duplicate-messages.txt');
  const messages = parseQuotedChain(makeElement(html), USER_EMAIL, THREAD_ID, ANCHOR);

  it('deduplicates identical messages from same sender', () => {
    // Same body from bob@example.com appears twice but should produce 1 entry
    const bobMessages = messages.filter(m => m.sender.email === 'bob@example.com');
    expect(bobMessages).toHaveLength(1);
  });

  it('deduplication yields exactly 1 message total', () => {
    expect(messages).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 — Various sender formats
// ─────────────────────────────────────────────────────────────────────────────

describe('09 — Sender format parsing', () => {
  const text = fixture('09-sender-formats.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('parses email-only sender', () => {
    expect(messages.some(m => m.sender.email === 'alice@example.com')).toBe(true);
  });

  it('parses "Name (Role)" <email> sender', () => {
    const bob = messages.find(m => m.sender.email === 'bob.davis@contractor.example.com');
    expect(bob).toBeDefined();
    expect(bob?.sender.name).toBeTruthy();
  });

  it('all messages have non-empty sender names', () => {
    for (const msg of messages) {
      expect(msg.sender.name.trim().length).toBeGreaterThan(0);
      expect(msg.sender.name).not.toBe('Unknown');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10 — Deep nested 5-message Gmail thread
// ─────────────────────────────────────────────────────────────────────────────

describe('10 — Long 5-message nested Gmail thread', () => {
  const html = fixture('10-long-thread.txt');
  const messages = parseQuotedChain(makeElement(html), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts all 5 messages', () => {
    expect(messages).toHaveLength(5);
  });

  it('contains all 5 unique participants', () => {
    const emails = new Set(messages.map(m => m.sender.email));
    expect(emails.size).toBe(5);
    expect(emails.has('alice@example.com')).toBe(true);
    expect(emails.has('bob@example.com')).toBe(true);
    expect(emails.has('carol@example.com')).toBe(true);
    expect(emails.has('dave@example.com')).toBe(true);
    expect(emails.has('eve@example.com')).toBe(true);
  });

  it('messages sorted chronologically', () => {
    const timestamps = messages.map(m => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it('all messages have unique stable IDs', () => {
    const ids = messages.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all messages have non-trivial body text', () => {
    for (const msg of messages) {
      expect(msg.body.trim().length).toBeGreaterThan(10);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11 — Live Gmail Test Case
// ─────────────────────────────────────────────────────────────────────────────

describe('11 — Live Gmail complex thread', () => {
  const text = fixture('11-live-gmail-test.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts multiple messages from the complex chain', () => {
    // Should find Harj's message and Ashutosh's forwarded message
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('finds Harj Lasher as a sender', () => {
    expect(messages.some(m => m.sender.email === 'harj.lasher@abc.com')).toBe(true);
  });

  it('finds Ashutosh Bhargava as a sender from the Outlook-style block', () => {
    expect(messages.some(m => m.sender.email === 'ashutosh.bhargava@abc.co.uk')).toBe(true);
  });

  it('preserves table-like structure in text if possible', () => {
    const ashutoshMsg = messages.find(m => m.sender.email === 'ashutosh.bhargava@abc.co.uk' && m.body.includes('WarehouseGIToFaulty'));
    expect(ashutoshMsg?.body).toContain('WarehouseGIToFaulty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T12 — Deeply Nested Multi-Format
// ─────────────────────────────────────────────────────────────────────────────

describe('12 — Deeply nested multi-format thread', () => {
  const text = fixture('12-deeply-nested.txt');
  const messages = parseQuotedChain(makePlainTextElement(text), USER_EMAIL, THREAD_ID, ANCHOR);

  it('extracts all 3 historical messages (Forward -> Outlook -> Gmail Text)', () => {
    expect(messages.length).toBe(3);
  });

  it('identifies Harj Lasher twice (one in forward, one in gmail text)', () => {
    const harjMsgs = messages.filter(m => m.sender.email === 'harj.lasher@abc.com');
    expect(harjMsgs.length).toBe(2);
  });

  it('identifies Jon Brittle from the Outlook segment', () => {
    expect(messages.some(m => m.sender.email === 'jon.brittle@abc.com')).toBe(true);
  });
});
