import type { ParsedMessage, Attachment, ExtensionMessage } from '../types';
import { buildSender, debounce, generateId, mimeFromExtension } from './scraper-utils';
import { readRecipients } from './message-metadata';
import { threadCache } from './thread-cache';
import { extractEmailBody, mergeMessages, parseEmailDate } from './quoted-chain-parser';

// Set to true only during local development — never commit as true.
const DEBUG = false;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[ThreadLens]', ...args); };

// Retry schedule (ms) when initial parse returns 0 messages.
// Starts at 1200ms to avoid colliding with tryExpandAll's own 800ms timeout.
const RETRY_DELAYS = [1200, 2000, 3500];
let retryIndex = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

let activeThreadId = '';
let threadAnchor = Date.now();
let lastSentUser = '';
let expandAttempted = false;
function getCurrentUserEmail(): string {
  const accountEl = document.querySelector<HTMLElement>('[data-ogsr-up] [data-email]');
  if (accountEl) return accountEl.getAttribute('data-email') ?? '';

  const profileLink = document.querySelector<HTMLElement>('a[href*="myaccount.google.com"], [aria-label*="Google Account:"], [aria-label*="Google Account"]');
  if (profileLink) {
    const match = ((profileLink.getAttribute('title') ?? '') + ' ' + (profileLink.getAttribute('aria-label') ?? '')).match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (match) return match[0];
  }
  return '';
}

function getThreadId(): string {
  // Gmail URL hash formats:
  //   Inbox:  #inbox/18e1234567890abc
  //   Search: #search/gym/KtbxLvHcHtqRLdDVGPXKWRLTwVsXTzjxNq
  //   Label:  #label/Work/18e1234567890abc
  // The thread/message ID is always the last slash-separated segment.
  // Guard: alphanumeric only + ≥9 chars — rejects keywords, labels, and search queries.
  const parts = location.hash.split('/');
  const last = parts[parts.length - 1];
  return last && /^[A-Za-z0-9]{9,}$/.test(last) ? last : '';
}

function getSubject(): string {
  return document.querySelector('.hP, h2[data-legacy-thread-id]')
    ?.textContent?.trim() ?? 'Email Thread';
}

function tryExpandAll(): void {
  const expandBtn = document.querySelector<HTMLElement>(
    '[data-tooltip="Expand all"], [aria-label="Expand all"], button[title="Expand all"]'
  );
  if (expandBtn) {
    expandBtn.click();
    return;
  }
  // Click individual collapsed message headers using stable Gmail header-row classes
  document.querySelectorAll<HTMLElement>('[data-message-id]').forEach(container => {
    if (!container.querySelector('.a3s')) {
      (container.querySelector<HTMLElement>('.gE') ??
       container.querySelector<HTMLElement>('.go'))?.click();
    }
  });
}

function scrapeAttachments(msgEl: HTMLElement): Attachment[] {
  const chips: Element[] = [];
  // Try multiple Gmail attachment chip selectors
  for (const sel of ['.aZo', '.M2 .aQy', '[data-tooltip*="."]']) {
    const found = Array.from(msgEl.querySelectorAll<Element>(sel));
    if (found.length > 0) { chips.push(...found); break; }
  }

  return chips.flatMap(chip => {
    const tooltip = chip.getAttribute('data-tooltip') ??
                    chip.querySelector('[data-tooltip]')?.getAttribute('data-tooltip') ?? '';
    const name = (chip.querySelector('.aV3, .aQw')?.textContent || tooltip).trim();
    if (!name || !name.includes('.')) return [];

    const sizeEl = chip.querySelector('.aV7, [class*="size"]');
    const sizeLabel = sizeEl?.textContent?.trim() ?? '';

    const link = chip.querySelector<HTMLAnchorElement>('a[href*="view=att"], a[href*="attid"]');
    const downloadUrl = link?.href ?? (chip.matches('a[href]') ? (chip as HTMLAnchorElement).href : '');


    return [{ name, mimeType: mimeFromExtension(name), sizeLabel, downloadUrl }];
  });
}

function parseMessages(currentUserEmail: string): ParsedMessage[] {
  const seen = new Set<string>();
  const messages: ParsedMessage[] = [];

  const messageEls = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-id]')
  ).filter(el => {
    const id = el.getAttribute('data-message-id') ?? '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  log(`Found ${messageEls.length} message containers`);

  messageEls.forEach((el, index) => {
    // Use Gmail's own data-message-id directly as the stable ParsedMessage ID.
    // This is assigned by Gmail's server and is globally unique — eliminates the
    // same-sender/same-second collision risk that a derived hash cannot avoid.
    const domMessageId = el.getAttribute('data-message-id') ?? generateId(`fallback-${index}`, new Date().toISOString());

    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const senderName = senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? 'Unknown';
    let senderEmail = senderEl?.getAttribute('email') ?? '';
    if (!senderEmail) {
      const mailto = el.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
      senderEmail = mailto?.href.replace('mailto:', '') ?? `sender-${index}@unknown`;
    }

    const timeEl = el.querySelector<HTMLElement>('.g3, [data-tooltip]');
    const rawTime = timeEl?.getAttribute('title') || timeEl?.getAttribute('data-tooltip') || timeEl?.textContent?.trim() || '';
    const { timestamp, timestampEstimated } = parseEmailDate(rawTime, new Date(threadAnchor + index * 1000).toISOString());
    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]');
    if (!bodyEl) return;
    const { body, bodyHtml, history } = extractEmailBody(bodyEl, currentUserEmail, activeThreadId, timestamp);
    messages.push(...history);
    const attachments = scrapeAttachments(el);
    if (!body && !attachments.length && !history.length) return;

    messages.push({
      id: domMessageId,
      sender: buildSender(senderName, senderEmail),
      timestamp,
      body: body || (history.length ? 'This email contains only quoted history, shown separately above.' : ''),
      historyCarrier: !body && history.length > 0,
      source: 'direct',
      recipients: readRecipients(el, bodyEl),
      timestampEstimated,
      isCurrentUser: currentUserEmail
        ? senderEmail.toLowerCase() === currentUserEmail.toLowerCase()
        : false,
      index,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(bodyHtml ? { bodyHtml } : {}),
    });
  });

  return messages;
}

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryIndex >= RETRY_DELAYS.length) return;
  const delay = RETRY_DELAYS[retryIndex++];
  log(`Scheduling retry in ${delay}ms (attempt ${retryIndex})`);
  // Null retryTimer before calling scrapeAndSend so any future
  // `if (retryTimer !== null)` guard sees a clean state.
  retryTimer = setTimeout(() => { retryTimer = null; scrapeAndSend(); }, delay);
}

function onThreadChanged(newThreadId: string): void {
  if (activeThreadId && activeThreadId !== newThreadId) {
    threadCache.evict(activeThreadId);
  }
  activeThreadId = newThreadId;
  lastSentUser = '';
  threadAnchor = Date.now();
  expandAttempted = false;
  retryIndex = 0;
  clearRetryTimer();
}

function scrapeAndSend(): void {
  const threadId = getThreadId();

  if (!threadId) {
    if (activeThreadId) {
      onThreadChanged('');
      chrome.runtime.sendMessage({ type: 'CLEAR_THREAD' }).catch(() => {});
    }
    log('No thread ID in URL — not in a thread view');
    return;
  }

  // Detect thread navigation and reset state
  if (threadId !== activeThreadId) {
    onThreadChanged(threadId);
  }

  if (!expandAttempted) {
    expandAttempted = true;
    tryExpandAll();
    // Safety net: re-scrape after expand settles (separate from retry backoff)
    setTimeout(debouncedScrape, 800);
  }

  const currentUserEmail = getCurrentUserEmail();

  // Parse direct messages and included history from every expanded email.
  const domMessages = parseMessages(currentUserEmail);
  log(`Direct and recovered: ${domMessages.length} messages`);

  const incoming = mergeMessages(domMessages);

  if (incoming.length === 0) {
    scheduleRetry();
    return;
  }

  // Retry is no longer needed — messages found
  clearRetryTimer();
  retryIndex = 0;

  // Update the cache — returns true only if new messages were found
  const changed = threadCache.update(threadId, incoming);
  if (!changed && currentUserEmail === lastSentUser) {
    log('No new messages — skipping send');
    return;
  }

  const threadData = threadCache.getThreadData(threadId, getSubject(), 'gmail', currentUserEmail);
  if (!threadData) return;
  lastSentUser = currentUserEmail;

  log(`Sending ${threadData.messages.length} messages to Side Panel`);

  chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: threadData } satisfies ExtensionMessage)
    .catch(() => {});
}

const debouncedScrape = debounce(scrapeAndSend, 350);

// hashchange fires on every Gmail SPA navigation (inbox → thread → inbox etc.)
// More reliable than MutationObserver for detecting thread switches.
window.addEventListener('hashchange', () => {
  const newId = getThreadId();
  // Only reset if we actually moved to a different thread (not a label-vs-search hash prefix change)
  if (newId && newId !== activeThreadId) {
    log(`hashchange → new thread: ${newId}`);
    onThreadChanged(newId);
  }
  debouncedScrape();
});

// MutationObserver catches content changes within the current thread
const observeTarget = document.querySelector('[role="main"]') ?? document.body;
const observer = new MutationObserver(debouncedScrape);
observer.observe(observeTarget, { childList: true, subtree: true });

log('Content script loaded');
debouncedScrape();

chrome.runtime.onMessage.addListener(message => { if (message.type === 'SCRAPE_THREAD') { threadCache.evict(activeThreadId); debouncedScrape(); } });
