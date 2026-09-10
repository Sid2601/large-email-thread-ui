import type { ParsedMessage } from '../types';
import { buildSender, generateId, mimeFromExtension } from './scraper-utils';
import { readRecipients } from './message-metadata';
import { parseEmailDate } from './quoted-chain-parser';
import { startReader, imageSources } from './incremental-reader';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract name and email from various Outlook title attribute formats:
 *   "Alice Smith <alice@example.com>"
 *   "Alice Smith (alice@example.com)"
 *   "alice@example.com"
 *   "Alice Smith"
 */
function parseSenderTitle(raw: string): { name: string; email: string } {
  // "Name <email@domain>" format
  const angleMatch = raw.match(/^(.*?)\s*<([\w.+\-]+@[\w.\-]+\.\w+)>\s*$/);
  if (angleMatch) {
    return { name: angleMatch[1].trim() || angleMatch[2], email: angleMatch[2].toLowerCase() };
  }

  // "Name (email@domain)" format
  const parenMatch = raw.match(/^(.*?)\s*\(([\w.+\-]+@[\w.\-]+\.\w+)\)\s*$/);
  if (parenMatch) {
    return { name: parenMatch[1].trim() || parenMatch[2], email: parenMatch[2].toLowerCase() };
  }

  // Raw email only
  const emailOnlyMatch = raw.match(/^([\w.+\-]+@[\w.\-]+\.\w+)$/);
  if (emailOnlyMatch) {
    return { name: emailOnlyMatch[1].split('@')[0], email: emailOnlyMatch[1].toLowerCase() };
  }

  // Contains an email address somewhere in the string
  const embeddedEmail = raw.match(/([\w.+\-]+@[\w.\-]+\.\w+)/);
  if (embeddedEmail) {
    const email = embeddedEmail[1].toLowerCase();
    const name = raw.replace(embeddedEmail[0], '').replace(/[<>()]/g, '').trim() || email.split('@')[0];
    return { name, email };
  }

  // Name only — no email found
  return { name: raw.trim(), email: '' };
}

/**
 * Ordered list of attribute / element strategies for finding message item containers.
 * We try each selector in turn and return the first non-empty result.
 */
const ITEM_SELECTORS = [
  '[data-unique-id]',
  '[class*="ConversationItem"]',
  '[role="option"]',
] as const;

/**
 * Ordered strategies for extracting sender info from a message item element.
 * Returns the first result that yields a non-empty name.
 */
function extractSender(el: Element, index: number): { name: string; email: string } {
  // Strategy 1: dedicated sender class with [title]
  const senderClassEl = el.querySelector<HTMLElement>('[class*="Sender"] [title]');
  if (senderClassEl) {
    const title = senderClassEl.getAttribute('title') ?? '';
    if (title) {
      const parsed = parseSenderTitle(title);
      if (parsed.name) return parsed;
    }
  }

  // Strategy 2: [data-pe-id] — Outlook stores the SMTP address here
  const peEl = el.querySelector<HTMLElement>('[data-pe-id]');
  if (peEl) {
    const email = peEl.getAttribute('data-pe-id') ?? '';
    const name = peEl.getAttribute('title') ?? peEl.textContent?.trim() ?? '';
    if (email) return { name: name || email.split('@')[0], email: email.toLowerCase() };
  }

  // Strategy 3: any [title] attribute that might contain a sender
  const titleEl = el.querySelector<HTMLElement>('[title]');
  if (titleEl) {
    const title = titleEl.getAttribute('title') ?? '';
    if (title) {
      const parsed = parseSenderTitle(title);
      if (parsed.name) return parsed;
    }
  }

  // Strategy 4: [aria-label] on any element
  const ariaEl = el.querySelector<HTMLElement>('[aria-label]');
  if (ariaEl) {
    const label = ariaEl.getAttribute('aria-label') ?? '';
    if (label) {
      const parsed = parseSenderTitle(label);
      if (parsed.name) return parsed;
    }
  }

  return { name: `Unknown Sender`, email: `unknown-${index}@outlook` };
}

/**
 * Ordered strategies for extracting body text from a message item element.
 */
const BODY_SELECTORS = [
  '.allowTextSelection',
  '[data-block]',
  '[role="document"]',
  '.elementToProof',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Current user detection
// ─────────────────────────────────────────────────────────────────────────────

function getCurrentUserEmail(): string {
  // Outlook Web stores the signed-in account in aria-label on the profile button
  const profileSelectors = [
    '[aria-label*="profile"]',
    '[aria-label*="account"]',
    '[aria-label*="Account manager"]',
    '[data-automationid="meControl"]',
  ];

  for (const sel of profileSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;

    // Check title attribute first
    const title = el.getAttribute('title') ?? '';
    const titleEmail = title.match(/([\w.+\-]+@[\w.\-]+\.\w+)/)?.[1];
    if (titleEmail) return titleEmail.toLowerCase();

    // Check aria-label
    const label = el.getAttribute('aria-label') ?? '';
    const labelEmail = label.match(/([\w.+\-]+@[\w.\-]+\.\w+)/)?.[1];
    if (labelEmail) return labelEmail.toLowerCase();
  }

  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Subject extraction
// ─────────────────────────────────────────────────────────────────────────────

function getSubject(): string {
  // Prefer the reading pane header over the page title
  const headerEl = document.querySelector<HTMLElement>(
    '[data-testid="subject"], [aria-label="Subject"], .allowTextSelection h1, h1[class*="subject" i], .jGFnO'
  );
  if (headerEl?.textContent?.trim()) return headerEl.textContent.trim();

  return document.title.replace(/\s*[-–|]\s*Outlook.*$/i, '').trim() || 'Email Thread';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scrape function
// ─────────────────────────────────────────────────────────────────────────────

function readingPane() {
  return document.querySelector<HTMLElement>('[data-app-section="ConversationContainer"], [class*="ReadingPane"], [role="region"][aria-label*="Reading" i]');
}
function messageElement(target: Element): HTMLElement | null {
  for (const selector of ITEM_SELECTORS) {
    const found = target.closest<HTMLElement>(selector);
    if (found) return found;
  }
  return null;
}
startReader({
  client: 'outlook', messageSelector: ITEM_SELECTORS.join(','), bodySelector: BODY_SELECTORS.join(','),
  messageElement,
  threadId() {
    const pane = readingPane();
    return (pane?.querySelector('[data-convid]') ?? (pane?.matches('[data-convid]') ? pane : null) ?? document.querySelector('[data-convid][aria-selected="true"], [aria-selected="true"] [data-convid]'))?.getAttribute('data-convid') ?? '';
  }, subject: getSubject, currentUser: getCurrentUserEmail,
  snapshot(el, index, anchor, previous, bodyDirty) {
    if (!readingPane()?.contains(el)) return null;
    const bodyEl = el.querySelector(BODY_SELECTORS.join(',')); if (!bodyEl) return null;
    if (messageElement(bodyEl) !== el) return null;
    const { name, email } = extractSender(el, previous?.message.index ?? index);
    const user = getCurrentUserEmail();
    const date = parseEmailDate(el.querySelector('time[datetime]')?.getAttribute('datetime') ?? '', previous?.message.timestamp || new Date(anchor + index * 1000).toISOString());
    const attachments = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[download], a[href*="attachment" i], a[href*="GetFileAttachment" i]')).map(a => {
      const name = a.getAttribute('download') || a.getAttribute('title') || a.textContent?.trim() || 'Attachment';
      return { name, mimeType: mimeFromExtension(name), sizeLabel: '', downloadUrl: a.href };
    });
    const message: ParsedMessage = { id: el.getAttribute('data-unique-id') || previous?.message.id || generateId(`${email}:${index}`, String(anchor)), sender: buildSender(name, email), ...date,
      body: '', source: 'direct', index: previous?.message.index ?? index, isCurrentUser: !!user && email.toLowerCase() === user.toLowerCase(), recipients: readRecipients(el, bodyEl), attachments };
    return { message, html: !bodyDirty && previous ? previous.html : bodyEl.innerHTML, imageSources: !bodyDirty && previous ? previous.imageSources : imageSources(bodyEl) };
  },
});
