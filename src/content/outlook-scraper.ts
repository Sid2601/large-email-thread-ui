import type { ExtensionMessage, ParsedMessage } from '../types';
import { buildSender, debounce, generateId, mimeFromExtension } from './scraper-utils';
import { readRecipients } from './message-metadata';
import { extractEmailBody, parseEmailDate } from './quoted-chain-parser';
import { threadCache } from './thread-cache';

// Set to true only during local development — never commit as true.
const DEBUG = false;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[ThreadLens/Outlook]', ...args); };

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

function findMessageItems(pane: Element): HTMLElement[] {
  for (const sel of ITEM_SELECTORS) {
    const items = Array.from(pane.querySelectorAll<HTMLElement>(sel));
    if (items.length > 0) {
      log(`Item selector matched: ${sel} (${items.length} items)`);
      return items;
    }
  }
  return [];
}

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

// Track active thread so we can evict stale cache entries on navigation
let activeThreadId = '';
let threadAnchor = Date.now();

function scrape(): void {
  const pane = document.querySelector<HTMLElement>(
    '[data-app-section="ConversationContainer"], [class*="ReadingPane"], [role="region"][aria-label*="Reading" i]'
  );
  const convEl = pane?.querySelector<HTMLElement>('[data-convid]') ??
    (pane?.matches('[data-convid]') ? pane : null) ??
    document.querySelector<HTMLElement>('[data-convid][aria-selected="true"], [aria-selected="true"] [data-convid]');
  const threadId = convEl?.getAttribute('data-convid') ?? '';
  if (!pane || !threadId) {
    if (activeThreadId) {
      threadCache.evict(activeThreadId); activeThreadId = '';
      chrome.runtime.sendMessage({ type: 'CLEAR_THREAD' }).catch(() => {});
    }
    return;
  }
  if (activeThreadId !== threadId) {
    threadCache.evict(activeThreadId);
    threadAnchor = Date.now();
    activeThreadId = threadId;
  }

  const itemEls = findMessageItems(pane);
  if (itemEls.length === 0) {
    log('No message items found');
    return;
  }

  const currentUserEmail = getCurrentUserEmail();
  log(`Current user: ${currentUserEmail || '(unknown)'}`);

  const messages: ParsedMessage[] = [];
  itemEls.forEach((el, index) => {
    const { name, email } = extractSender(el, index);
    const resolvedEmail = email || `unknown-${index}@outlook`;

    const timeEl = el.querySelector<HTMLElement>('time[datetime]');
    const rawDate = timeEl?.getAttribute('datetime') ?? '';
    const { timestamp, timestampEstimated } = parseEmailDate(rawDate, new Date(threadAnchor + index * 1000).toISOString());

    const bodyEl = el.querySelector(BODY_SELECTORS.join(','));
    if (!bodyEl) return;
    const { body, bodyHtml, history } = extractEmailBody(bodyEl, currentUserEmail, threadId, timestamp);
    messages.push(...history);
    const attachments = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[download], a[href*="attachment" i], a[href*="GetFileAttachment" i]')).map(a => {
      const name = a.getAttribute('download') || a.getAttribute('title') || a.textContent?.trim() || 'Attachment';
      return { name, mimeType: mimeFromExtension(name), sizeLabel: '', downloadUrl: a.href };
    });
    if (!body && !attachments.length && !history.length) return;

    messages.push({
      id: el.getAttribute('data-unique-id') || generateId(`${threadId}:${resolvedEmail}:${index}`, timestamp),
      sender: buildSender(name, resolvedEmail),
      timestamp,
      body: body || (history.length ? 'This email contains only quoted history, shown separately above.' : ''),
      historyCarrier: !body && history.length > 0,
      bodyHtml,
      attachments,
      source: 'direct',
      timestampEstimated,
      recipients: readRecipients(el, bodyEl),
      isCurrentUser: currentUserEmail
        ? resolvedEmail.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      index,
    });
  });

  if (messages.length === 0) {
    log('No messages with body extracted');
    return;
  }

  // Merge into cache — only proceed if new messages appeared
  const changed = threadCache.update(threadId, messages);
  if (!changed) {
    log('No new messages — skipping send');
    return;
  }

  const threadData = threadCache.getThreadData(threadId, getSubject(), 'outlook', currentUserEmail);
  if (!threadData) return;

  log(`Sending ${threadData.messages.length} messages to Side Panel`);

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrape, 400);

// ─────────────────────────────────────────────────────────────────────────────
// MutationObserver — attach to the reading pane or fall back to document.body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keep one observer instance so we don't stack multiple observers if the
 * reading pane re-mounts (e.g., Outlook SPA navigations).
 */
let observer: MutationObserver | null = null;

function attachObserver(): void {
  const target = document.body;

  if (observer) {
    observer.disconnect();
  }

  observer = new MutationObserver(debouncedScrape);
  observer.observe(target, { childList: true, subtree: true });
  log(`Observer attached to: ${target.tagName}#${target.id || target.className.slice(0, 30)}`);
}

// Bootstrap: attach observer, then run an immediate scrape
attachObserver();
debouncedScrape();

// Re-attach when Outlook's SPA loads the reading pane after initial DOM is ready
// (the [data-convid] element might not exist yet on first load)
let bootstrapRetries = 0;
const MAX_BOOTSTRAP_RETRIES = 5;

function bootstrapRetry(): void {
  if (bootstrapRetries >= MAX_BOOTSTRAP_RETRIES) return;
  bootstrapRetries++;

  if (!document.querySelector('[data-convid]')) {
    setTimeout(() => {
      attachObserver();
      debouncedScrape();
      bootstrapRetry();
    }, 1000 * bootstrapRetries);
  }
}

bootstrapRetry();

chrome.runtime.onMessage.addListener(message => { if (message.type === 'SCRAPE_THREAD') { threadCache.evict(activeThreadId); debouncedScrape(); } });
