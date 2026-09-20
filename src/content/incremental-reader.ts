import { SNAPSHOT_BATCH_LIMIT } from '../shared/snapshots';
import type { MessageSnapshot, SnapshotBatch } from '../shared/snapshots';
import type { ThreadData } from '../types';
import { imageResponse, safeImageSource } from '../shared/images';
import { CAPTURE_FORMAT, foldImages, foldSnapshot } from '../shared/capture';
import type { CapturedMessage, ThreadCapture } from '../shared/capture';

/** A capture is a diagnostic file, not a mailbox copy: one provider container this
 * large already holds far more than a parsing problem needs. */
const CONTAINER_LIMIT = 512 * 1024;
const CAPTURE_LIMIT = 16 * 1024 * 1024;

export interface ReaderAdapter {
  client: ThreadData['client'];
  messageSelector: string;
  bodySelector: string;
  threadId(): string;
  subject(): string;
  currentUser(): string;
  messageElement?(target: Element): HTMLElement | null;
  /** `position` is the message's place in the mailbox's own order, which is authoritative when a clock cannot be read. */
  snapshot(el: HTMLElement, index: number, anchor: number, previous?: MessageSnapshot, bodyDirty?: boolean, position?: number): MessageSnapshot | null;
  expand?(): void;
  collapse?(): void;
}
/** Only DOM snapshots run here. Parsing/reconciliation run in the extension document. */
export function startReader(adapter: ReaderAdapter) {
  let session = '', threadId = '', anchor = Date.now(), timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, requested = false, lastInteraction = 0, revision = 0;
  let known = new WeakMap<Element, MessageSnapshot>();
  let failures = 0;
  const dirty = new Map<HTMLElement, boolean>();
  const stats = { batches: 0, snapshots: 0, scans: 0, snapshotMs: 0, maxSnapshotMs: 0, ignoredMutations: 0 };
  function schedule() { if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 250); }
  function discover() {
    stats.scans++;
    document.querySelectorAll<HTMLElement>(adapter.messageSelector).forEach(el => { if (!known.has(el)) dirty.set(el, true); });
  }
  function navigation() {
    const next = adapter.threadId();
    if (next === threadId) return false;
    revision++; threadId = next; session = `${Date.now()}:${Math.random()}`; anchor = Date.now();
    known = new WeakMap(); dirty.clear(); failures = 0;
    if (!next) { void chrome.runtime.sendMessage({ type: 'CLEAR_THREAD' }).catch(() => {}); return true; }
    discover(); schedule(); return true;
  }
  async function idle() {
    await new Promise<void>(resolve => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
      else setTimeout(resolve, 0);
    });
  }
  async function flush() {
    if (running) { requested = true; return; }
    navigation();
    if (!threadId || !dirty.size) return;
    if (performance.now() - lastInteraction < 200) { schedule(); return; }
    running = true; const token = revision;
    const collected: HTMLElement[] = [];
    try {
      const snapshots: MessageSnapshot[] = [];
      // The provider renders a thread in order, so read each message's place in
      // it once per pass: a lazily inserted email shifts the ones after it.
      const positions = new Map<Element, number>();
      document.querySelectorAll<HTMLElement>(adapter.messageSelector).forEach((el, at) => positions.set(el, at));
      for (const [el, bodyDirty] of Array.from(dirty)) {
        if (token !== revision) return;
        dirty.delete(el);
        if (!el.isConnected) continue;
        await idle();
        if (token !== revision) return;
        const previous = known.get(el);
        const start = performance.now();
        const snapshot = adapter.snapshot(el, stats.snapshots, anchor, previous, bodyDirty, positions.get(el) ?? previous?.message.index ?? stats.snapshots);
        const elapsed = performance.now() - start;
        stats.snapshotMs += elapsed; stats.maxSnapshotMs = Math.max(stats.maxSnapshotMs, elapsed);
        if (!snapshot) continue;
        // Compare only a dirty message; never serialize/reparse the entire thread on scroll.
        if (previous && snapshot.html === previous.html && JSON.stringify(snapshot.message) === JSON.stringify(previous.message) && snapshot.imageSources.join('\n') === previous.imageSources.join('\n')) continue;
        known.set(el, snapshot); snapshots.push(snapshot); collected.push(el); stats.snapshots++;
        // Bound each IPC batch, including conversations with large quoted bodies.
        if (snapshots.length >= SNAPSHOT_BATCH_LIMIT) break;
      }
      if (!snapshots.length || token !== revision) return;
      stats.batches++;
      const batch: SnapshotBatch = { threadId, subject: adapter.subject(), client: adapter.client, currentUserEmail: adapter.currentUser(), session, snapshots };
      const result = await chrome.runtime.sendMessage({ type: 'SNAPSHOT_BATCH', batch });
      if (result?.error || !result?.data) throw new Error(result?.error || 'Parser returned no thread.');
      if (token === revision && result?.data) await chrome.runtime.sendMessage({ type: 'THREAD_PARSED', data: result.data });
      failures = 0;
    } catch (error) {
      if (token === revision) {
        failures++;
        collected.forEach(el => { known.delete(el); if (failures <= 2 && el.isConnected) dirty.set(el, true); });
      }
      console.warn('[ThreadLens] Could not update thread:', error);
    }
    finally { running = false; if (dirty.size || requested) { requested = false; schedule(); } }
  }
  /**
   * The thread exactly as this page holds it, for reproducing a parsing problem
   * that only a real mailbox produces.
   *
   * Where the reader has already sent a message to the parser, that very
   * snapshot is recorded rather than a fresh reading of the same element, so
   * the capture is the parser's own input and not a second opinion about it.
   * Alongside it goes the whole provider container — header rows, date cells,
   * recipient chips, attachment chips — which is where a problem lives when the
   * parsed body itself looks right. Picture bytes are folded to a digest: they
   * are heavy, they can show a face, and every comparison that depends on them
   * is preserved by the fold.
   */
  function capture(): ThreadCapture {
    const notes: string[] = [];
    let used = 0;
    const messages: CapturedMessage[] = Array.from(document.querySelectorAll<HTMLElement>(adapter.messageSelector)).map((el, position) => {
      const live = known.get(el);
      const snapshot = live ?? adapter.snapshot(el, position, anchor, undefined, true, position) ?? null;
      const folded = foldImages(el.outerHTML);
      // The parser's own input is never dropped; the container markup around it
      // yields first, so one enormous thread cannot outgrow a browser message.
      used += snapshot ? snapshot.html.length : 0;
      const room = Math.max(0, Math.min(CONTAINER_LIMIT, CAPTURE_LIMIT - used));
      used += Math.min(folded.length, room);
      return {
        position, live: !!live, bodyFound: !!el.querySelector(adapter.bodySelector),
        snapshot: snapshot && foldSnapshot(snapshot),
        containerHtml: folded.slice(0, room), ...(folded.length > room ? { containerTruncated: true } : {}),
      };
    });
    const truncated = messages.filter(message => message.containerTruncated).length;
    if (truncated) notes.push(`${truncated} provider container(s) were shortened to keep the file readable; the parser input for each message is complete.`);
    if (messages.some(message => !message.snapshot)) notes.push('Some rows render no body and are recorded as headers only; a collapsed email is not readable until it is opened.');
    if (messages.some(message => !message.live)) notes.push('Some messages were read for this capture rather than taken from what the parser already received.');
    return {
      format: CAPTURE_FORMAT, appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
      masked: false, capturedAt: new Date().toISOString(), client: adapter.client,
      threadId, subject: adapter.subject(), currentUserEmail: adapter.currentUser(), url: location.href,
      messageSelector: adapter.messageSelector, bodySelector: adapter.bodySelector,
      readerStats: { ...stats, pending: dirty.size }, messages, notes,
    };
  }
  const observer = new MutationObserver(records => {
    if (navigation()) return;
    let structural = false;
    for (const record of records) {
      const el = record.target instanceof Element ? record.target : record.target.parentElement;
      const message = el && (adapter.messageElement ? adapter.messageElement(el) : el.closest<HTMLElement>(adapter.messageSelector));
      if (message) {
        const body = message.querySelector(adapter.bodySelector);
        const replacedBody = record.type === 'childList' && Array.from(record.addedNodes).some(node =>
          node instanceof Element && (node.matches(adapter.bodySelector) || !!node.querySelector(adapter.bodySelector)));
        const bodyChanged = replacedBody || (!!body && (body === el || body.contains(el)));
        dirty.set(message, dirty.get(message) === true || bodyChanged || !known.has(message));
        continue;
      }
      if (record.type === 'childList') {
        for (const node of [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]) {
          if (node instanceof Element && (node.matches(adapter.messageSelector) || node.querySelector(adapter.messageSelector))) { structural = true; break; }
        }
      }
      stats.ignoredMutations++;
    }
    if (structural) discover();
    if (dirty.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset', 'data-src', 'email', 'data-email', 'datetime', 'title', 'data-tooltip', 'data-message-id', 'data-unique-id'] });
  window.addEventListener('hashchange', () => { navigation(); schedule(); });
  window.addEventListener('popstate', () => { navigation(); schedule(); });
  document.addEventListener('wheel', () => { lastInteraction = performance.now(); }, { passive: true });
  document.addEventListener('touchmove', () => { lastInteraction = performance.now(); }, { passive: true });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'SCRAPE_THREAD') { navigation(); discover(); schedule(); }
    if (message.type === 'EXPAND_THREAD') { adapter.expand?.(); discover(); schedule(); }
    // Collapsing reveals nothing new, so nothing is re-read: the emails already
    // recovered stay in the panel whether or not the page still shows them.
    if (message.type === 'COLLAPSE_THREAD') { adapter.collapse?.(); }
    if (message.type === 'READER_STATS') { respond({ ...stats, pending: dirty.size }); }
    if (__DEV_TOOLS__ && message.type === 'CAPTURE_THREAD_SOURCE') { navigation(); respond(capture()); }
    if (message.type === 'READ_BLOB_IMAGE') {
      const url = safeImageSource(message.url ?? '');
      const included = url.startsWith(`blob:${location.origin}/`) && Array.from(document.querySelectorAll(adapter.bodySelector)).some(body =>
        Array.from(body.querySelectorAll<HTMLImageElement>('img')).some(img => (img.currentSrc || img.src) === url));
      if (!included) { respond({ error: 'Image is not present in the original email.' }); return false; }
      void fetch(url, { signal: AbortSignal.timeout(15000) }).then(imageResponse).then(data => respond({ data }), () => respond({ error: 'Original inline image is no longer available.' }));
      return true;
    }
    return false;
  });
  navigation();
  return { stats, capture: __DEV_TOOLS__ ? capture : undefined, disconnect: () => { observer.disconnect(); if (timer) clearTimeout(timer); } };
}

export function imageSources(body: Element): string[] {
  return Array.from(body.querySelectorAll<HTMLImageElement>('img')).map(img => img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '');
}
