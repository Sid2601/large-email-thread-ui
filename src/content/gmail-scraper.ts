import type { Attachment } from '../types';
import { buildSender, generateId, mimeFromExtension } from './scraper-utils';
import { readRecipients } from './message-metadata';
import { startReader, imageSources } from './incremental-reader';
import type { MessageSnapshot } from '../shared/snapshots';
import { parseEmailDate } from './quoted-chain-parser';

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

startReader({
  client: 'gmail', messageSelector: '[data-message-id]', bodySelector: '.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]',
  threadId: getThreadId, subject: getSubject, currentUser: getCurrentUserEmail, expand: tryExpandAll,
  snapshot(el, index, anchor, previous, bodyDirty): MessageSnapshot | null {
    const bodyEl = el.querySelector('.a3s.aiL, .a3s, .ii.gt > div, [data-message-text]');
    if (!bodyEl) return null;
    const currentUserEmail = getCurrentUserEmail();
    const senderEl = el.querySelector<HTMLElement>('.gD, [email]');
    const name = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || 'Unknown';
    const email = senderEl?.getAttribute('email') || senderEl?.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')?.getAttribute('href')?.slice(7) || previous?.message.sender.email || `sender-${index}@unknown`;
    const timeEl = el.querySelector<HTMLElement>('.g3, time[datetime]');
    const raw = timeEl?.getAttribute('datetime') || timeEl?.getAttribute('title') || timeEl?.getAttribute('data-tooltip') || timeEl?.textContent || '';
    const date = parseEmailDate(raw, previous?.message.timestamp || new Date(anchor + index * 1000).toISOString());
    return {
      message: { id: el.getAttribute('data-message-id') || previous?.message.id || generateId(email, String(index)), sender: buildSender(name, email), ...date,
        body: '', source: 'direct', index: previous?.message.index ?? index, isCurrentUser: !!currentUserEmail && email.toLowerCase() === currentUserEmail.toLowerCase(),
        recipients: readRecipients(el, bodyEl), attachments: scrapeAttachments(el) },
      html: !bodyDirty && previous ? previous.html : bodyEl.innerHTML, imageSources: !bodyDirty && previous ? previous.imageSources : imageSources(bodyEl),
    };
  },
});
