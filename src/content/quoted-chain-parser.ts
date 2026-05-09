/**
 * Multi-format quoted-chain parser.
 */

import type { ParsedMessage } from '../types';
import { buildSender, htmlToText, generateId, sanitizeEmailHtml } from './scraper-utils';

// ── constants ────────────────────────────────────────────────────────────────

const GMAIL_FORWARD_RE = /[-─—]{5,}\s*Forwarded message\s*[-─—]{5,}/i;
const GMAIL_TEXT_SEP_RE = /^On\s+([\s\S]+?)\s+wrote:$/m;
const OUTLOOK_START_RE = /^(?:From|De|Von|Van):\s+/m;

const MONTHS_PATTERN = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)';

const DISCLAIMER_RE = /\s*(?:this e-?mail and any attachments|this message contains information that is confidential|agreements binding|e-mail transmissions are not secure|wickes Building Supplies Limited|Vision House, 19 Colonial Way|For more information, please see our Privacy Policy|due to the nature of my role)[\s\S]{0,3000}$/i;

// ── segment types ────────────────────────────────────────────────────────────

interface Segment {
  senderEmail: string;
  senderName: string;
  timestamp: string;
  bodyText: string;
  bodyHtml?: string;
  bodyHash: string;
  depth: number;
}

// ── normalization & hashing ─────────────────────────────────────────────────

function stripDisclaimer(text: string): string {
  return text.replace(DISCLAIMER_RE, '').trim();
}

function hashBody(text: string): string {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 500);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function dedupKey(email: string, bodyHash: string): string {
  return `${email.toLowerCase().trim()}:${bodyHash}`;
}

function parseSenderFromText(raw: string): { name: string; email: string } {
  const emailMatch = raw.match(/<([\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,})>/) ||
                     raw.match(/([\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1].toLowerCase().trim() : 'unknown@unknown';
  let namePart = raw.replace(/<.*?>/g, '').replace(/\(.*\)/g, '').replace(/"/g, '').trim();

  const parts = namePart.split(/[,;]/).map(p => p.trim()).filter(Boolean);
  let name = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d{1,2}:\d{2}$/.test(p) || /^at\s+\d{1,2}:\d{2}$/i.test(p) || /^\d{1,2}\s+\w+/.test(p) || /^\d{4}$/.test(p)) {
      continue;
    }
    name = p;
    break;
  }

  if (!name && parts.length > 0) {
    name = parts[parts.length - 1];
  }

  name = name.replace(/^\d{1,2}:\d{2}\s+/, '').replace(/at\s+$/i, '').trim();

  return { name: name || email.split('@')[0], email };
}

function parseTimestampFromText(raw: string, depth: number, anchorTimestamp: string): string {
  const datePatterns = [
    new RegExp('(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+' + MONTHS_PATTERN + '\\s+\\d{1,2},\\s+\\d{4}(?:[\\s,]+(?:at\\s+)?\\d{1,2}:\\d{2}\\s*(?:AM|PM)?)?', 'i'),
    new RegExp('\\d{1,2}\\s+' + MONTHS_PATTERN + '\\s+\\d{4}(?:\\s+\\d{1,2}:\\d{2})?', 'i'),
    /\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?/,
    new RegExp('\\w+,\\s+\\d{1,2}\\s+' + MONTHS_PATTERN + '\\s+\\d{4},?\\s+\\d{1,2}:\\d{2}', 'i'),
    new RegExp('\\w+,\\s+\\d{1,2}\\s+' + MONTHS_PATTERN + '\\s+\\d{4}\\s+at\\s+\\d{1,2}:\\d{2}', 'i'),
    new RegExp('\\w+,\\s+\\d{1,2}\\s+' + MONTHS_PATTERN + ',\\s+\\d{1,2}:\\d{2}', 'i'),
    new RegExp('\\d{1,2}\\s+' + MONTHS_PATTERN + '\\s+\\d{4}', 'i'),
    new RegExp('\\d{2}/\\d{2}/\\d{4}', 'i'),
  ];

  for (const pattern of datePatterns) {
    const match = raw.match(pattern);
    if (match) {
      try {
        const dateStr = match[0].replace(/ at /i, ' ');
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      } catch { /* next */ }
    }
  }

  const anchorMs = new Date(anchorTimestamp).getTime();
  const MS_PER_6H = 6 * 60 * 60 * 1000;
  return new Date(anchorMs - (depth + 1) * MS_PER_6H).toISOString();
}

// ── unified text parser ──────────────────────────────────────────────────────

function parseUnifiedText(text: string, depth: number, anchorTimestamp: string, out: Map<string, Segment>): void {
  const separators: { index: number; headerEndIndex: number; senderRaw: string; dateRaw: string; isGmailText?: boolean }[] = [];

  // 1. Find Forwards
  const fwdRe = new RegExp(GMAIL_FORWARD_RE.source, 'mgi');
  let m: RegExpMatchArray | null;
  while ((m = fwdRe.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length);
    const blankLineMatch = after.match(/\n\s*\n/);
    const headerContent = blankLineMatch ? after.slice(0, blankLineMatch.index) : after.slice(0, 500);
    const headerEndIndex = m.index + m[0].length + (blankLineMatch ? blankLineMatch.index! + blankLineMatch[0].length : 0);

    let s = '', d = '';
    const lines = headerContent.split(/\r?\n/);
    for (const line of lines) {
      const fromMatch = line.match(/From:\s+(.+)/i);
      if (fromMatch) s = fromMatch[1].trim();
      const dateMatch = line.match(/(?:Date|Sent):\s+(.+)/i);
      if (dateMatch) d = dateMatch[1].trim();
    }
    separators.push({ index: m.index, headerEndIndex, senderRaw: s, dateRaw: d });
  }

  // 2. Find Outlook
  const outRe = new RegExp(OUTLOOK_START_RE.source, 'mgi');
  while ((m = outRe.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    if (text.slice(lineStart, m.index).trim().length > 0) continue;

    const after = text.slice(m.index);
    const blankLineMatch = after.match(/\n\s*\n/);
    const headerContent = blankLineMatch ? after.slice(0, blankLineMatch.index) : after.slice(0, 500);

    if (!/Sent|Date|Envoyé|Gesendet|Verzonden:/mi.test(headerContent) ||
        !/To|À|An|Aan:/mi.test(headerContent)) {
      continue;
    }

    const headerEndIndex = m.index + (blankLineMatch ? blankLineMatch.index! + blankLineMatch[0].length : 0);

    let s = '', d = '';
    const lines = headerContent.split(/\r?\n/);
    for (const line of lines) {
      const fromMatch = line.match(/(?:From|De|Von|Van):\s+(.+)/i);
      if (fromMatch) s = fromMatch[1].trim();
      const dateMatch = line.match(/(?:Sent|Date|Envoyé|Gesendet|Verzonden):\s+(.+)/i);
      if (dateMatch) d = dateMatch[1].trim();
    }
    separators.push({ index: m.index, headerEndIndex, senderRaw: s, dateRaw: d });
  }

  // 3. Find Gmail Text
  const gRe = new RegExp(GMAIL_TEXT_SEP_RE.source, 'mgi');
  while ((m = gRe.exec(text)) !== null) {
    separators.push({ index: m.index, headerEndIndex: m.index + m[0].length, senderRaw: m[1].trim(), dateRaw: m[1].trim(), isGmailText: true });
  }

  if (separators.length === 0) return;

  separators.sort((a, b) => a.index - b.index);

  separators.forEach((sep, i) => {
    let nextSepIndex = i + 1 < separators.length ? separators[i + 1].index : text.length;

    if (sep.isGmailText && i + 1 < separators.length) {
       const gap = text.slice(sep.headerEndIndex, separators[i+1].index).trim();
       if (gap.length < 5) return;
    }

    const body = text.slice(sep.headerEndIndex, nextSepIndex).trim();
    const cleanBody = stripDisclaimer(body);
    if (cleanBody.length < 5) return;

    const { name, email } = parseSenderFromText(sep.senderRaw);
    const timestamp = parseTimestampFromText(sep.dateRaw, depth + i, anchorTimestamp);
    const hash = hashBody(cleanBody);
    const key = dedupKey(email, hash);

    if (!out.has(key)) {
      out.set(key, { senderEmail: email, senderName: name, timestamp, bodyText: cleanBody, bodyHash: hash, depth: depth + i });
    }
  });
}

// ── Gmail DOM parser ─────────────────────────────────────────────────────────

function extractSenderFromAttr(attrEl: Element): { name: string; email: string } {
  const anchor = attrEl.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
  if (anchor) {
    const email = anchor.href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
    const text = anchor.textContent?.trim() ?? '';
    return { name: text.includes('@') ? email.split('@')[0] : text || email.split('@')[0], email };
  }
  const text = attrEl.textContent ?? '';
  const emailMatch = text.match(/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    const namePart = text.slice(0, text.indexOf(emailMatch[0]))
      .replace(/^.*?(\d{1,2}:\d{2}\s*(?:AM|PM))\s*/i, '').replace(/[<,]/g, '').trim();
    const name = namePart.split(/[,;]/)[0].trim() || email.split('@')[0];
    return { name: name.replace(/^\d{1,2}:\d{2}\s+/, '').trim(), email };
  }
  return { name: 'Unknown', email: 'unknown@unknown' };
}

function parseGmailQuotes(latestBodyEl: Element, depth: number, anchorTimestamp: string, out: Map<string, Segment>): void {
  const attrs = Array.from(latestBodyEl.querySelectorAll<Element>('.gmail_attr'));
  attrs.forEach((attr, i) => {
    let sibling: Element | null = attr.nextElementSibling;
    while (sibling && !sibling.classList.contains('gmail_quote') && !sibling.classList.contains('gmail_attr')) {
      sibling = sibling.nextElementSibling;
    }
    if (!sibling || sibling.classList.contains('gmail_attr')) {
      const prev = attr.previousElementSibling;
      if (prev?.classList.contains('gmail_quote')) sibling = prev;
      else return;
    }

    const { name, email } = extractSenderFromAttr(attr);
    const timestamp = parseTimestampFromText(attr.textContent ?? '', depth + i, anchorTimestamp);
    const clone = sibling.cloneNode(true) as Element;
    clone.querySelectorAll('.gmail_attr, .gmail_quote').forEach(el => el.remove());

    const bodyHtml = sanitizeEmailHtml(clone.innerHTML);
    const bodyText = stripDisclaimer(htmlToText(clone.innerHTML).trim());

    if (bodyText.length < 5) return;
    const hash = hashBody(bodyText);
    const key = dedupKey(email, hash);
    if (!out.has(key)) {
      out.set(key, {
        senderEmail: email,
        senderName: name,
        timestamp,
        bodyText,
        bodyHtml,
        bodyHash: hash,
        depth: depth + i
      });
    }
  });
}

// ── main export ───────────────────────────────────────────────────────────────

export function parseQuotedChain(
  latestBodyEl: Element,
  currentUserEmail: string,
  threadId: string,
  anchorTimestamp: string,
): ParsedMessage[] {
  const segmentMap = new Map<string, Segment>();
  parseGmailQuotes(latestBodyEl, 0, anchorTimestamp, segmentMap);

  const outerClone = latestBodyEl.cloneNode(true) as Element;
  outerClone.querySelectorAll('.gmail_quote, .gmail_attr').forEach(el => el.remove());
  const outerText = htmlToText(outerClone.innerHTML);
  parseUnifiedText(outerText, segmentMap.size, anchorTimestamp, segmentMap);

  if (segmentMap.size === 0) return [];

  const sorted = Array.from(segmentMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return sorted.map((seg, i) => ({
    id: generateId(`${threadId}-chain-${seg.senderEmail}-${seg.bodyHash}`, 'chain'),
    sender: buildSender(seg.senderName, seg.senderEmail),
    timestamp: seg.timestamp,
    body: seg.bodyText,
    ...(seg.bodyHtml ? { bodyHtml: seg.bodyHtml } : {}),
    isCurrentUser: seg.senderEmail === currentUserEmail.toLowerCase(),
    index: -(sorted.length - i),
  }));
}
