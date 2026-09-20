import { parseSnapshot } from '../offscreen/parser';
import { threadCache } from '../content/thread-cache';
import { imageKeys } from '../content/message-reconciliation';
import { SNAPSHOT_BATCH_LIMIT } from './snapshots';
import type { SnapshotBatch } from './snapshots';
import type { CaptureFidelity, ThreadCapture } from './capture';
import type { ParsedMessage, ThreadData } from '../types';

export interface ReplayResult {
  thread: ThreadData | null;
  /** One identity-independent line per message, so two copies of a thread can be compared. */
  shape: string[];
  batches: number;
  parsed: number;
}

let replays = 0;

/**
 * Parses a capture exactly as the extension would: the same snapshots, through
 * the same parser, into the same cache, batch by batch. `batchSize` of 0 reads
 * the whole thread in one go, which is how an order-dependent result shows
 * itself — the mailbox delivers a thread in pieces, and it should not matter.
 */
export function replayCapture(capture: ThreadCapture, options: { batchSize?: number } = {}): ReplayResult {
  const usable = capture.messages.filter(message => message.snapshot);
  const size = options.batchSize === 0 ? usable.length || 1 : options.batchSize ?? SNAPSHOT_BATCH_LIMIT;
  const key = `capture-replay:${++replays}`;
  let batches = 0, parsed = 0;
  try {
    for (let at = 0; at < usable.length; at += size) {
      const chunk = usable.slice(at, at + size);
      const batch: SnapshotBatch = {
        threadId: capture.threadId, subject: capture.subject, client: capture.client,
        currentUserEmail: capture.currentUserEmail, session: key, snapshots: chunk.map(message => message.snapshot!),
      };
      const incoming: ParsedMessage[] = [];
      for (const snapshot of batch.snapshots) incoming.push(...parseSnapshot(snapshot, batch));
      parsed += incoming.length;
      threadCache.update(key, incoming);
      batches++;
    }
    const thread = threadCache.getThreadData(key, capture.subject, capture.client, capture.currentUserEmail);
    return { thread, shape: thread ? threadShape(thread) : [], batches, parsed };
  } finally {
    threadCache.evict(key);
  }
}

/** Placeholders in the order they appear, so a picture repeated in a quote reads alike in both copies. */
function imageShape(html = ''): string {
  const seen = new Map<string, number>();
  return imageKeys(html).map(key => {
    if (key === '?') return '?';
    if (!seen.has(key)) seen.set(key, seen.size + 1);
    return String(seen.get(key));
  }).join(',');
}

/**
 * What a thread is, with who it is about removed: counts, order, clocks, flags,
 * quote links and picture groupings. Masking rewrites names and addresses but
 * never adds or removes a message, a line, a picture or a link, so a masked
 * copy that still reproduces a problem produces exactly these lines.
 */
export function threadShape(thread: ThreadData): string[] {
  const senders = new Map<string, number>();
  const position = new Map<string, number>();
  thread.messages.forEach((message, index) => position.set(message.id, index));
  return thread.messages.map((message, index) => {
    if (!senders.has(message.sender.email)) senders.set(message.sender.email, senders.size + 1);
    const flags = [
      message.timestampEstimated && 'estimated', message.timestampZoneUnknown && 'zoneless',
      message.orderedByQuote && 'chained', message.historyCarrier && 'carrier', message.isCurrentUser && 'you',
    ].filter(Boolean).join('+') || 'none';
    const quoted = message.quotedBy !== undefined && position.has(message.quotedBy) ? `#${position.get(message.quotedBy)}` : 'none';
    return [
      `#${index}`, `sender=${senders.get(message.sender.email)}`, `time=${message.timestamp}`,
      `source=${message.source ?? 'direct'}`, `flags=${flags}`, `lines=${message.body.split('\n').length}`,
      `quotedBy=${quoted}`, `variants=${message.quotedVariants?.length ?? 0}`,
      `recipients=${message.recipients?.length ?? 0}`, `attachments=${message.attachments?.length ?? 0}`,
      `images=${imageShape(message.bodyHtml)}`,
    ].join(' ');
  });
}

/** Every line that differs, named by position and by the field that moved. */
export function compareShapes(left: string[], right: string[], names: [string, string], limit = 24): string[] {
  const differences: string[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index], b = right[index];
    if (a === b) continue;
    if (a === undefined) { differences.push(`message ${index + 1}: only in the ${names[1]} (${b})`); continue; }
    if (b === undefined) { differences.push(`message ${index + 1}: only in the ${names[0]} (${a})`); continue; }
    const fields = a.split(' ').filter((field, at) => field !== b.split(' ')[at]).map(field => field.split('=')[0]);
    differences.push(`message ${index + 1}: ${fields.join(', ')} differ — ${names[0]} "${a}" vs ${names[1]} "${b}"`);
    if (differences.length >= limit) { differences.push('further differences not listed'); break; }
  }
  return differences;
}

/**
 * Whether the masked copy is worth sending: it must parse to the same thread as
 * the original it was made from. Masking shortens names, and a body that sits
 * close to one of reconciliation's length thresholds can therefore cross it, so
 * the copy is checked rather than assumed. Both copies are also read whole and
 * in batches, which reports any dependence on the order the mailbox delivers.
 */
export function captureFidelity(original: ThreadCapture, masked: ThreadCapture): CaptureFidelity {
  const first = replayCapture(original), second = replayCapture(masked);
  const whole = replayCapture(original, { batchSize: 0 }), wholeMasked = replayCapture(masked, { batchSize: 0 });
  const differences = compareShapes(first.shape, second.shape, ['original', 'masked copy']);
  const orderDifferences = [
    ...compareShapes(first.shape, whole.shape, ['batched original', 'whole original'], 6),
    ...compareShapes(second.shape, wholeMasked.shape, ['batched masked copy', 'whole masked copy'], 6),
  ];
  const sameStructure = differences.length === 0;
  const orderIndependent = orderDifferences.length === 0;
  const summary = sameStructure
    ? `The masked copy parses to the same ${first.shape.length} message(s) as the original, with the same order, clocks, quote links and pictures.`
    : `The masked copy parses to ${second.shape.length} message(s) against the original's ${first.shape.length}; ${differences.length} difference(s) are listed. Send the original as well if it can be shared.`;
  return {
    checkedAt: new Date().toISOString(), sameStructure, orderIndependent,
    originalMessages: first.shape.length, maskedMessages: second.shape.length,
    differences: [...differences, ...orderDifferences.map(line => `order dependence — ${line}`)],
    summary: orderIndependent ? summary : `${summary} Reading the thread whole and in batches disagree, which is a parsing problem in itself.`,
  };
}
