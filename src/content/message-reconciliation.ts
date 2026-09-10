import type { ParsedMessage, ThreadData } from '../types';

export function normalizedBody(body: string): string {
  return body.replace(/^\s*>+\s?/gm, '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
function core(body: string): string {
  // Match without signature/footer noise, but retain it in the displayed body.
  const text = body.replace(/^\s*>+\s?/gm, '');
  const signature = text.search(/\n\s*(?:--\s*$|(?:kind |best )?regards[,!.]?\s*$|many thanks[,!.]?\s*$|thanks[,!.]?\s*$|sent from my (?:iphone|ipad|android))/im);
  return normalizedBody(signature >= 0 ? text.slice(0, signature) : text);
}
function sameTime(a: ParsedMessage, b: ParsedMessage, exact: boolean): boolean {
  const left = Date.parse(a.timestamp), right = Date.parse(b.timestamp);
  if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 60000) return true;
  // Unknown-time long copies can match, but tiny repeated acknowledgements cannot.
  return exact && (a.timestampEstimated === true || b.timestampEstimated === true) && core(a.body).length >= 100;
}
/** A provider header read in the reader's own timezone is solid time evidence. */
function anchoredTime(m: ParsedMessage): boolean {
  return m.timestampZoneUnknown !== true && m.timestampEstimated !== true && Number.isFinite(Date.parse(m.timestamp));
}
/** Quoted attribution clocks carry no offset, so the same message can appear a
 * whole timezone away from its provider header. Accept only differences shaped
 * like a real offset (a quarter-hour multiple within the inhabited range), and
 * only when at least one side is a zone-unknown quote. */
function zoneShifted(a: ParsedMessage, b: ParsedMessage): boolean {
  if (a.timestampZoneUnknown !== true && b.timestampZoneUnknown !== true) return false;
  const left = Date.parse(a.timestamp), right = Date.parse(b.timestamp);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const delta = Math.abs(left - right);
  // The smallest real offset difference is a quarter of an hour; anything
  // closer than that is not a timezone and is left to sameTime.
  if (delta < 840000 || delta > 14 * 3600000) return false;
  // Attributions usually omit seconds, so allow a minute either side.
  const remainder = delta % 900000;
  return Math.min(remainder, 900000 - remainder) < 60000;
}
/** Signed shift from a zone-unknown quote to its anchored counterpart. */
function zoneOffset(a: ParsedMessage, b: ParsedMessage): number | undefined {
  const quote = a.timestampZoneUnknown === true ? a : b.timestampZoneUnknown === true ? b : undefined;
  const other = quote === a ? b : a;
  if (!quote || other.timestampZoneUnknown === true || !anchoredTime(other)) return undefined;
  const delta = Date.parse(other.timestamp) - Date.parse(quote.timestamp);
  return Number.isFinite(delta) ? delta : undefined;
}
function nearCopy(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 160) return false;
  const words = (text: string) => text.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  let short = words(a), long = words(b);
  if (short.length > long.length) [short, long] = [long, short];
  if (short.length / long.length < 0.85) return false;
  let cursor = 0;
  const added: string[] = [];
  for (const word of long) {
    if (word === short[cursor]) cursor++;
    else added.push(word);
  }
  // Only small insertions, not substitutions, changed numbers or negations.
  return cursor === short.length && !added.some(word => /\d|^(?:no|not|never|cancel|cancelled|revoked|reject|rejected|instead|except)$/i.test(word));
}
const LONG_ENOUGH = 160, SPECIFIC_ENOUGH = 40;
function match(a: ParsedMessage, b: ParsedMessage, offsets: number[]): boolean {
  if (a.id === b.id) return true;
  if (a.source !== 'quoted' && b.source !== 'quoted') return false;
  if (a.sender.email.toLowerCase().replace(/\s/g, '') !== b.sender.email.toLowerCase().replace(/\s/g, '')) return false;
  // Unknown names are not enough evidence to merge independent senders.
  if (!a.sender.email.includes('@')) return false;
  const x = core(a.body), y = core(b.body);
  if (!x || !y) return false;
  const exact = x === y;
  if (sameTime(a, b, exact)) return exact || nearCopy(x, y);
  if (zoneShifted(a, b)) {
    const offset = zoneOffset(a, b);
    // An offset-shaped gap alone is weak, so require a substantial body — or an
    // offset this same conversation has already confirmed on a long copy.
    const confirmed = offset !== undefined && offsets.some(known => Math.abs(known - offset) < 60000);
    const shortest = Math.min(x.length, y.length);
    if (shortest >= LONG_ENOUGH || (confirmed && shortest >= SPECIFIC_ENOUGH)) {
      // With an anchored counterpart a small edited insertion is still the same
      // message; between two zone-unknown quotes require an identical body.
      return anchoredTime(a) || anchoredTime(b) ? exact || nearCopy(x, y) : exact;
    }
  }
  // Missing-year dates are estimates, but retain a day/clock for matching.
  if (a.timestampEstimated || b.timestampEstimated) {
    const left = new Date(a.timestamp), right = new Date(b.timestamp);
    return Number.isFinite(left.getTime()) && Number.isFinite(right.getTime()) && left.toISOString().slice(5, 16) === right.toISOString().slice(5, 16) && nearCopy(x, y);
  }
  return false;
}
/** Prefer a real instant over an estimate, and a known offset over a quoted clock. */
function timeRank(m: ParsedMessage): number {
  if (!Number.isFinite(Date.parse(m.timestamp))) return 0;
  return 1 + (m.timestampEstimated === true ? 0 : 1) + (m.timestampZoneUnknown === true ? 0 : 2);
}
function combine(primary: ParsedMessage, copy: ParsedMessage): ParsedMessage {
  const variants = [...(primary.quotedVariants ?? []), ...(copy.quotedVariants ?? [])];
  if (normalizedBody(primary.body) !== normalizedBody(copy.body)) variants.push({ body: copy.body, bodyHtml: copy.bodyHtml });
  const distinct = variants.filter((v, i) => normalizedBody(v.body) !== normalizedBody(primary.body) && variants.findIndex(other => normalizedBody(other.body) === normalizedBody(v.body)) === i);
  const attachments = [...(primary.attachments ?? []), ...(copy.attachments ?? [])];
  const recipients = Array.from(new Set([...(primary.recipients ?? []), ...(copy.recipients ?? [])]));
  return { ...primary,
    ...(timeRank(copy) > timeRank(primary)
      ? { timestamp: copy.timestamp, timestampEstimated: copy.timestampEstimated === true, timestampZoneUnknown: copy.timestampZoneUnknown === true }
      : {}),
    ...(distinct.length ? { quotedVariants: distinct } : {}),
    ...(recipients.length ? { recipients } : {}),
    ...(attachments.length ? { attachments: attachments.filter((a, i) => attachments.findIndex(b => a.name === b.name && a.sizeLabel === b.sizeLabel && a.downloadUrl === b.downloadUrl) === i) } : {}),
  };
}

function reconcile(messages: ParsedMessage[], offsets: number[]) {
  const result: ParsedMessage[] = [];
  const observed: number[] = [];
  const ordered = [...messages].sort((a, b) => Number(a.source === 'quoted') - Number(b.source === 'quoted'));
  for (const msg of ordered) {
    const sameId = result.findIndex(old => old.id === msg.id);
    if (sameId >= 0) { result[sameId] = combine(result[sameId], msg); continue; }
    const candidates = result.map((old, i) => match(old, msg, offsets) ? i : -1).filter(i => i >= 0);
    // Ambiguous copies (e.g. two real identical approvals) must not erase history.
    if (candidates.length !== 1) { result.push({ ...msg }); continue; }
    const target = result[candidates[0]];
    const offset = zoneShifted(target, msg) ? zoneOffset(target, msg) : undefined;
    // Only a long copy is strong enough to teach this conversation an offset.
    if (offset !== undefined && Math.min(core(target.body).length, core(msg.body).length) >= LONG_ENOUGH) observed.push(offset);
    result[candidates[0]] = combine(target, msg);
  }
  return { result: result.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)), observed };
}

export function mergeMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const strict = reconcile(messages, []);
  // A quoting client's timezone is the same for every message it quoted, so an
  // offset proven by a long duplicate also resolves the shorter ones.
  return strict.observed.length ? reconcile(messages, strict.observed).result : strict.result;
}

export function participationBoundary(messages: ParsedMessage[], currentUserEmail = ''): ThreadData['participation'] {
  const user = currentUserEmail.toLowerCase().trim();
  const explicit = user ? messages.findIndex(m => m.sender.email === user || m.recipients?.includes(user)) : -1;
  if (explicit === 0) return undefined;
  if (explicit > 0) {
    const message = messages[explicit];
    const authored = message.sender.email === user;
    return { messageId: message.id, kind: authored ? 'authored' : 'recipient',
      title: authored ? 'You were participating by this message' : 'You joined here · first visible inclusion',
      detail: authored ? 'This is your first authored message in the available history; you may have joined earlier.' : 'This is the first available header that explicitly includes your address. It does not prove when you originally joined.' };
  }
  const firstDirect = messages.findIndex(m => m.source === 'direct');
  return firstDirect > 0 ? { messageId: messages[firstDirect].id, kind: 'available', title: 'Your available mailbox history starts here',
    detail: 'Earlier messages were recovered from quoted history. Recipient information is insufficient to determine when you joined.' } : undefined;
}
