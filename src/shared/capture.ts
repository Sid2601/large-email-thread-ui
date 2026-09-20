import type { MessageSnapshot } from './snapshots';
import type { ThreadData } from '../types';

/** Raised whenever the shape below changes, so an old file is recognised rather than misread. */
export const CAPTURE_FORMAT = 1;

/**
 * One provider message container exactly as the mail page held it.
 *
 * `snapshot` is the parser's own input: when the reader has already sent this
 * message to the parser, it is that very snapshot, so a capture reproduces
 * what the extension actually saw rather than a fresh second reading.
 * `containerHtml` is the whole provider element around it — headers, date
 * cells, recipient chips and attachment rows — which is where a scraping
 * problem lives when the parsed body looks correct.
 */
export interface CapturedMessage {
  position: number;
  /** True when this is the snapshot the parser received, false when it was read for the capture. */
  live: boolean;
  /** False for a collapsed row the reader skips because it renders no body. */
  bodyFound: boolean;
  snapshot: MessageSnapshot | null;
  containerHtml: string;
  containerTruncated?: boolean;
}

export interface CaptureFidelity {
  checkedAt: string;
  /** The masked copy parses to the same structure as the original it was made from. */
  sameStructure: boolean;
  /** Reading every message at once and reading them in batches agree, in both copies. */
  orderIndependent: boolean;
  originalMessages: number;
  maskedMessages: number;
  differences: string[];
  summary: string;
}

export interface ThreadCapture {
  format: number;
  appVersion: string;
  masked: boolean;
  capturedAt: string;
  client: ThreadData['client'];
  threadId: string;
  subject: string;
  currentUserEmail: string;
  url: string;
  messageSelector: string;
  bodySelector: string;
  readerStats: Record<string, number>;
  messages: CapturedMessage[];
  notes: string[];
  fidelity?: CaptureFidelity;
}

/** A 64-bit-ish stable digest written in base36, so it stays inside the base64 alphabet. */
function digest(value: string): string {
  let low = 0x811c9dc5, high = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    low = Math.imul(low ^ code, 16777619) >>> 0;
    high = Math.imul(high + code + i, 2246822519) >>> 0;
  }
  return `${low.toString(36)}${high.toString(36)}`;
}

/**
 * Drops the bytes of an inline picture while keeping every comparison that
 * depends on it. Reconciliation identifies a `data:` picture by its complete
 * payload, so one payload always folds to one digest and two different
 * payloads never collide: "the same picture" and "a different picture" read
 * exactly as they did. Every other kind of source is left untouched — a blob
 * handle, a proxy token and an ordinary address each carry their own meaning.
 */
export function foldImageSource(raw: string): string {
  const match = /^\s*data:([a-z0-9/+.=-]*);base64,([\s\S]*)$/i.exec(raw);
  if (!match) return raw;
  return `data:${match[1]};base64,folded${digest(match[2])}`;
}

/** The same fold applied inside markup, by rewriting attributes rather than reserializing the DOM. */
export function foldImages(html: string): string {
  return html.replace(/(\b(?:src|data-src|data-tl-image-src|href)\s*=\s*)(["'])(data:[^"']*)\2/gi,
    (_match, prefix: string, quote: string, source: string) => `${prefix}${quote}${foldImageSource(source)}${quote}`)
    // A srcset lists several addresses; the whole attribute goes rather than half of it.
    .replace(/(\bsrcset\s*=\s*)(["'])([^"']*data:[^"']*)\2/gi, (_match, prefix: string, quote: string) => `${prefix}${quote}${quote}`);
}

export function foldSnapshot(snapshot: MessageSnapshot): MessageSnapshot {
  return { message: snapshot.message, html: foldImages(snapshot.html), imageSources: snapshot.imageSources.map(foldImageSource) };
}
