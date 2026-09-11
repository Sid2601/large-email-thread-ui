import type { ParsedMessage, Sender, ThreadData } from '../types';

/** Providers rewrite the same picture's address in every copy, so compare what
 * survives that: the proxied original, a data payload, or a content id. */
function imageKeys(html = ''): string[] {
  return (html.match(/<img\b[^>]*>/gi) ?? []).map(tag => {
    const raw = tag.match(/(?:src|data-tl-image-src)="([^"]*)"/i)?.[1] ?? '';
    const proxied = /#(https?:\/\/[^"\s]+)$/.exec(raw)?.[1];
    if (proxied) return proxied;
    if (/^data:/i.test(raw)) return raw.slice(0, 128);
    if (/^cid:/i.test(raw)) return raw.toLowerCase();
    // A blob handle or bare proxy token is minted per copy and names no picture.
    if (/^blob:/i.test(raw) || /googleusercontent\.com\/proxy\//i.test(raw)) return '?';
    // Providers vary the query (message id, size, token) around one picture.
    try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return raw || '?'; }
  });
}
export function imageIdentity(html = ''): string {
  return imageKeys(html).join('|');
}
// Every pairwise comparison re-reads both bodies; each is scanned once.
const pictures = new WeakMap<ParsedMessage, string[]>();
function picturesOf(message: ParsedMessage): string[] {
  let value = pictures.get(message);
  if (value === undefined) { value = imageKeys(message.bodyHtml); pictures.set(message, value); }
  return value;
}
/**
 * Different pictures, not merely differently addressed or partly dropped ones.
 *
 * A quoting client keeps what it can: a signature block routinely arrives with
 * some of its logos and a later copy with fewer, so an unequal count is not
 * evidence of a different message. The copies conflict only when the pictures
 * they do hold disagree — that is, when the shorter list is not the longer one
 * with some pictures missing. A key of '?' names a per-copy blob or proxy
 * handle that identifies no picture, so it matches anything.
 */
function imagesConflict(a: ParsedMessage, b: ParsedMessage): boolean {
  const left = picturesOf(a), right = picturesOf(b);
  // A quoted copy that dropped the pictures is still the same message.
  if (!left.length || !right.length) return false;
  const [fewer, more] = left.length <= right.length ? [left, right] : [right, left];
  let cursor = 0;
  for (const key of more) {
    if (cursor < fewer.length && (key === '?' || fewer[cursor] === '?' || key === fewer[cursor])) cursor++;
  }
  return cursor < fewer.length;
}
function nameKey(sender: Sender): string {
  return sender.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
/** A placeholder such as "Unknown" identifies nobody, so it can confirm nothing. */
function specificName(sender: Sender): string {
  const key = nameKey(sender);
  return key.length >= 4 && !/^(?:unknown|sender|unknownsender|noreply|noreplies|mailer|daemon|automated|support)$/.test(key) ? key : '';
}
/** Quoted attributions often name an author without recording an address. A
 * name alone can only confirm an address seen elsewhere, never replace it. */
function sameAuthor(a: ParsedMessage, b: ParsedMessage): boolean {
  const left = a.sender.email.toLowerCase().replace(/\s/g, ''), right = b.sender.email.toLowerCase().replace(/\s/g, '');
  if (left === right) return left.includes('@') || !!specificName(a.sender);
  const named = left.startsWith('unknown:') ? a : right.startsWith('unknown:') ? b : undefined;
  if (!named) return false;
  const addressed = named === a ? b : a;
  if (!addressed.sender.email.includes('@')) return false;
  const name = specificName(named.sender);
  return !!name && (name === nameKey(addressed.sender) || name === addressed.sender.email.split('@')[0].replace(/[^a-z0-9]+/g, ''));
}

export function normalizedBody(body: string): string {
  return body.replace(/^\s*>+\s?/gm, '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
/**
 * A sign-off ends what the author wrote. Enterprise mail reaches for more forms
 * of it than "Regards": "Thanks & Regards" over a block of contact details is
 * the house style of whole companies, and a copy that keeps a different amount
 * of that block is still the same message.
 */
const SIGN_OFF = /\n\s*(?:--\s*$|(?:many\s+|kind(?:est)?\s+|best\s+|warm(?:est)?\s+|with\s+|thanks\s*(?:&|and)\s*){0,2}(?:regards|thanks|wishes|thank you)[,!.]?\s*$|sent from my (?:iphone|ipad|android))/im;
/** Gmail truncates a long quoted body and says so in the message itself. */
const CLIPPED = /\[message clipped\]|view entire message/i;
function clipped(message: ParsedMessage): boolean {
  return CLIPPED.test(message.body);
}
/**
 * Chrome the provider adds to one copy of a message and not another: a tenant's
 * external-sender banner is stamped on the copy that arrived from outside but
 * not on the copy its author quoted, and a picture that one client could not
 * re-host leaves a caption where another client kept the picture. Neither is
 * the author's words, so neither is compared; both stay in the displayed body.
 */
function withoutProviderNoise(text: string): string {
  return text
    .replace(/[\u24d8\u2139\ufe0f\u26a0\u276f\u25b6]/g, ' ')
    .replace(/\[image unavailable:[^\]\n]{0,160}\]/gi, ' ')
    .replace(/\bimage removed by sender\.?/gi, ' ')
    .replace(/\[\s*(?:external|extern|caution|suspicious)[^\]\n]{0,60}\]/gi, ' ')
    // A banner is often laid out as separate elements, so it reaches the text
    // one word to a line.
    .replace(/\bexternal\s+e-?mail\b[\s:;>|.-]*/gi, ' ')
    .replace(/^[ \t>|]*(?:caution|warning)\b[^\n]{0,200}$/gim, ' ')
    .replace(/\bthis\s+(?:e-?mail|message)\s+(?:originated|was\s+sent|came)\s+from\s+(?:outside|an\s+external)[\s\S]{0,200}?(?:\n\s*\n|$)/gi, ' ')
    .replace(/\bdo\s+not\s+click\s+(?:any\s+)?links\s+or\s+open\s+attachments[\s\S]{0,200}?(?:\n\s*\n|$)/gi, ' ');
}
function core(body: string): string {
  // Match without signature/footer noise, but retain it in the displayed body.
  const text = withoutProviderNoise(body).replace(/^\s*>+\s?/gm, '');
  const signature = text.search(SIGN_OFF);
  const trimmed = signature >= 0 ? text.slice(0, signature) : text;
  // The provider's own truncation notice is not the author's words, and the
  // ellipsis it leaves behind is not the author's punctuation.
  const clip = trimmed.search(CLIPPED);
  return normalizedBody(clip >= 0 ? trimmed.slice(0, clip).replace(/[\s.\u2026]+$/, '') : trimmed);
}
// A long thread compares every pair repeatedly; each body is reduced once.
const cores = new WeakMap<ParsedMessage, string>();
function coreOf(message: ParsedMessage): string {
  let value = cores.get(message);
  if (value === undefined) { value = core(message.body); cores.set(message, value); }
  return value;
}
/**
 * A quoted "Sent:" line is the sending client's own clock and the provider
 * header is the server's, so copies of one email routinely sit a few minutes
 * apart on top of any timezone difference. Real offsets are quarter-hour
 * multiples, so minutes of skew never turn one offset into another.
 */
const SKEW = 5 * 60000;
function sameTime(a: ParsedMessage, b: ParsedMessage, exact: boolean): boolean {
  const left = Date.parse(a.timestamp), right = Date.parse(b.timestamp);
  // Word-for-word copies may absorb the skew; anything less keeps to the minute.
  if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < (exact ? SKEW : 60000)) return true;
  // Unknown-time long copies can match, but tiny repeated acknowledgements cannot.
  return exact && (a.timestampEstimated === true || b.timestampEstimated === true) && coreOf(a).length >= 100;
}
/** A provider header read in the reader's own timezone is solid time evidence. */
function anchoredTime(m: ParsedMessage): boolean {
  return m.timestampZoneUnknown !== true && m.timestampEstimated !== true && Number.isFinite(Date.parse(m.timestamp));
}
/** An email the mailbox itself holds, dated by the provider rather than by a
 * quoting client's zoneless clock. */
function anchoredDirect(m: ParsedMessage): boolean {
  return m.source !== 'quoted' && anchoredTime(m);
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
  // Attributions omit seconds and the two clocks are set independently, so a
  // few minutes of skew sit on top of the offset.
  const remainder = delta % 900000;
  return Math.min(remainder, 900000 - remainder) < SKEW;
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
const LONG_ENOUGH = 160, SPECIFIC_ENOUGH = 40, EXACT_ENOUGH = 24, CONFIRMED_ENOUGH = 12;
function match(a: ParsedMessage, b: ParsedMessage, offsets: number[]): boolean {
  if (a.id === b.id) return true;
  if (a.source !== 'quoted' && b.source !== 'quoted') return false;
  if (!sameAuthor(a, b)) return false;
  const x = coreOf(a), y = coreOf(b);
  if (!x || !y) return false;
  // A copy the provider truncated cannot be word-for-word equal to the whole
  // message, but it says itself that it is the start of one. Only the provider's
  // own notice licenses this, and only for a body long enough to be specific.
  const truncated = Math.min(x.length, y.length) >= SPECIFIC_ENOUGH
    && ((clipped(a) && y.startsWith(x)) || (clipped(b) && x.startsWith(y)));
  const exact = x === y || truncated;
  /**
   * Pictures are re-addressed by every client that passes a message on: one
   * thread carried the same seven-picture signature as seven proxied URLs, as
   * seven "Image removed by sender" placeholders, and as six of those URLs plus
   * one re-rendered copy. They therefore cannot outvote a specific run of
   * word-for-word identical text — which is far stronger evidence of one
   * message — but they still separate copies whose wording only resembles each
   * other. Whichever copy differs is kept as an inspectable variant either way.
   */
  if (!(exact && Math.min(x.length, y.length) >= SPECIFIC_ENOUGH) && imagesConflict(a, b)) return false;
  if (sameTime(a, b, exact)) return exact || nearCopy(x, y);
  if (zoneShifted(a, b)) {
    const offset = zoneOffset(a, b);
    // An offset-shaped gap alone is weak, so require a body specific enough to
    // be one message — or an offset this same conversation has already proven.
    const confirmed = offset !== undefined && offsets.some(known => Math.abs(known - offset) < SKEW);
    const shortest = Math.min(x.length, y.length);
    // Word-for-word copies of a whole sentence are the same message; an edited
    // near-copy still needs a long body, or a confirmed offset and some length.
    // A copy quoted against an email the mailbox itself holds is the strongest
    // pairing available without a proven offset: the quote is the same author's
    // words, the provider dated the original, and the gap is offset-shaped. A
    // sentence specific enough to be one message is then enough, because a
    // second email repeating it word for word would be in this mailbox too, and
    // the ambiguity rule below keeps both when it is.
    if (exact) return shortest >= (confirmed ? CONFIRMED_ENOUGH
      : offset !== undefined && (anchoredDirect(a) || anchoredDirect(b)) ? SPECIFIC_ENOUGH
      : LONG_ENOUGH);
    // Only an anchored counterpart can date an edited copy.
    if ((anchoredTime(a) || anchoredTime(b)) && (shortest >= LONG_ENOUGH || (confirmed && shortest >= SPECIFIC_ENOUGH))) return nearCopy(x, y);
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
  // Where the provider clipped one copy, the complete one is what was written.
  // The clip notice itself adds length, so the authored words are compared.
  if (clipped(primary) && !clipped(copy) && coreOf(copy).length > coreOf(primary).length) {
    return combine({ ...primary, body: copy.body, bodyHtml: copy.bodyHtml }, { ...copy, body: primary.body, bodyHtml: primary.bodyHtml });
  }
  const variants = [...(primary.quotedVariants ?? []), ...(copy.quotedVariants ?? [])];
  if (normalizedBody(primary.body) !== normalizedBody(copy.body) || imageIdentity(primary.bodyHtml) !== imageIdentity(copy.bodyHtml)) variants.push({ body: copy.body, bodyHtml: copy.bodyHtml });
  const distinct = variants.filter((v, i) => (normalizedBody(v.body) !== normalizedBody(primary.body) || imageIdentity(v.bodyHtml) !== imageIdentity(primary.bodyHtml)) && variants.findIndex(other => normalizedBody(other.body) === normalizedBody(v.body) && imageIdentity(other.bodyHtml) === imageIdentity(v.bodyHtml)) === i);
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

/** The gap between a quoted copy and its counterpart, or 0 when their clocks agree. */
function pairOffset(a: ParsedMessage, b: ParsedMessage): number | undefined {
  return zoneShifted(a, b) ? zoneOffset(a, b) : 0;
}
/** One quoting client wrote every copy in this thread, so it used a single
 * timezone. Word-for-word copies vote on that offset; the longest bodies carry
 * the most weight, and the winner then dates the copies too short to prove it. */
function votedOffsets(messages: ParsedMessage[]): number[] {
  const groups = new Map<string, ParsedMessage[]>();
  for (const message of messages) {
    const body = coreOf(message);
    if (body.length < EXACT_ENOUGH) continue;
    const group = groups.get(body);
    if (group) group.push(message); else groups.set(body, [message]);
  }
  const votes = new Map<number, { pairs: number; weight: number }>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.source !== 'quoted' && b.source !== 'quoted') continue;
      if (!sameAuthor(a, b) || imagesConflict(a, b) || !zoneShifted(a, b)) continue;
      const offset = zoneOffset(a, b);
      if (offset === undefined) continue;
      // Attributions omit seconds, so bank the quarter hour a real offset uses.
      const quarter = Math.round(offset / 900000) * 900000;
      const vote = votes.get(quarter) ?? { pairs: 0, weight: 0 };
      votes.set(quarter, { pairs: vote.pairs + 1, weight: vote.weight + coreOf(a).length });
    }
  }
  // No pair may confirm the offset that would justify merging itself: an offset
  // counts once two separate copies agree on it, or one long body proves it.
  const corroborated = Array.from(votes).filter(([, vote]) => vote.pairs > 1 || vote.weight >= LONG_ENOUGH);
  const best = Math.max(0, ...corroborated.map(([, vote]) => vote.weight));
  return best ? corroborated.filter(([, vote]) => vote.weight === best).map(([offset]) => offset) : [];
}

function reconcile(messages: ParsedMessage[], offsets: number[]) {
  const result: ParsedMessage[] = [];
  const observed: number[] = [];
  // Where each input copy ended up, so quote-nesting evidence gathered before
  // reconciliation still names the surviving message afterwards.
  const place = new Map<ParsedMessage, number>();
  const ordered = [...messages].sort((a, b) => Number(a.source === 'quoted') - Number(b.source === 'quoted'));
  for (const msg of ordered) {
    const sameId = result.findIndex(old => old.id === msg.id);
    if (sameId >= 0) { place.set(msg, sameId); result[sameId] = combine(result[sameId], msg); continue; }
    const candidates = result.map((old, i) => match(old, msg, offsets) ? i : -1).filter(i => i >= 0);
    let chosen = candidates.length === 1 ? candidates[0] : -1;
    if (candidates.length > 1) {
      // A copy belongs to the message whose gap is this thread's own offset;
      // the same wording sent twice reads as a plain-clock or foreign gap.
      const preferred = candidates.filter(i => {
        const offset = pairOffset(result[i], msg);
        return offset === 0 || (offset !== undefined && offsets.some(known => Math.abs(known - offset) < SKEW));
      });
      // Copies that stay ambiguous (two real identical approvals) keep history.
      if (preferred.length === 1) chosen = preferred[0];
    }
    if (chosen < 0) { place.set(msg, result.length); result.push({ ...msg }); continue; }
    place.set(msg, chosen);
    const target = result[chosen];
    const offset = zoneShifted(target, msg) ? zoneOffset(target, msg) : undefined;
    // Only a long copy is strong enough to teach this conversation an offset.
    if (offset !== undefined && Math.min(coreOf(target).length, coreOf(msg).length) >= LONG_ENOUGH) observed.push(offset);
    result[chosen] = combine(target, msg);
  }
  return { result, observed, place };
}

/** A clock the provider never spelled out, such as a collapsed row labelled
 * "10:32", must not drift to the end of the thread. The mailbox order around
 * it is authoritative, so the missing time is placed between its neighbours. */
function placeUnread(messages: ParsedMessage[]): ParsedMessage[] {
  const direct = messages.filter(message => message.source !== 'quoted').sort((a, b) => a.index - b.index);
  const times = direct.map(message => anchoredTime(message) ? Date.parse(message.timestamp) : NaN);
  if (!times.some(Number.isFinite) || times.every(Number.isFinite)) return messages;
  const placed = new Map<ParsedMessage, string>();
  for (let i = 0; i < direct.length; i++) {
    if (Number.isFinite(times[i])) continue;
    let before = i - 1, after = i + 1;
    while (before >= 0 && !Number.isFinite(times[before])) before--;
    while (after < times.length && !Number.isFinite(times[after])) after++;
    const low = before >= 0 ? times[before] : undefined, high = after < times.length ? times[after] : undefined;
    const time = low !== undefined && high !== undefined ? low + ((high - low) * (i - before)) / (after - before)
      : low !== undefined ? low + (i - before) * 1000
      : high! - (after - i) * 1000;
    placed.set(direct[i], new Date(time).toISOString());
  }
  // The time stays flagged as an estimate; only the position is now known.
  return messages.map(message => placed.has(message) ? { ...message, timestamp: placed.get(message)!, timestampEstimated: true } : message);
}
/** Oldest first, with the mailbox's own order settling equal or unreadable clocks. */
function chronological(a: ParsedMessage, b: ParsedMessage): number {
  const left = Date.parse(a.timestamp), right = Date.parse(b.timestamp);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return (Number.isFinite(left) ? 0 : 1) - (Number.isFinite(right) ? 0 : 1) || a.index - b.index;
  return left - right || a.index - b.index;
}
/** A quoting client nests the message it answers inside its own, so the quote
 * links record the reply order first-hand. That evidence outranks the clocks:
 * an attribution is stamped in the quoting author's timezone, which it never
 * writes down, so correspondents an offset apart read out of order — a reply
 * at 09:04 appearing to precede the 13:28 message it answers. Each link is
 * read after reconciliation so copies from separate emails constrain the one
 * message they were merged into. */
function chainEdges(messages: ParsedMessage[], place: Map<ParsedMessage, number>): [number, number][] {
  const byId = new Map<string, number>();
  for (const message of messages) byId.set(message.id, place.get(message)!);
  const edges: [number, number][] = [];
  for (const message of messages) {
    const quoter = message.quotedBy === undefined ? undefined : byId.get(message.quotedBy);
    if (quoter !== undefined) edges.push([place.get(message)!, quoter]);
  }
  return edges;
}
/** Chronological, but never contradicting the quote nesting: of the messages
 * whose predecessors are already placed, the earliest clock goes next. A thread
 * that quotes nothing therefore keeps exactly the plain chronological order. */
function sequence(messages: ParsedMessage[], edges: [number, number][]): ParsedMessage[] {
  const order = messages.map((_, i) => i).sort((a, b) => chronological(messages[a], messages[b]) || a - b);
  const blocking = messages.map(() => 0);
  const unlocks = messages.map((): number[] => []);
  for (const [older, newer] of edges) {
    if (older === newer || unlocks[older].includes(newer)) continue;
    unlocks[older].push(newer); blocking[newer]++;
  }
  const sorted: ParsedMessage[] = [];
  while (order.length) {
    // Copies wrongly collapsed into one message could leave a cycle with no
    // free message; the clock then settles it rather than stalling the thread.
    const at = Math.max(0, order.findIndex(i => blocking[i] === 0));
    const [next] = order.splice(at, 1);
    for (const later of unlocks[next]) blocking[later]--;
    sorted.push(messages[next]);
  }
  // Where the nesting overruled the clocks, say so on both messages: their
  // times were read in timezones that differ, and the reader can see it.
  let latest = -Infinity, latestAt = -1;
  for (let i = 0; i < sorted.length; i++) {
    const time = Date.parse(sorted[i].timestamp);
    if (!Number.isFinite(time)) continue;
    if (time < latest) {
      sorted[i] = { ...sorted[i], orderedByQuote: true };
      sorted[latestAt] = { ...sorted[latestAt], orderedByQuote: true };
    } else { latest = time; latestAt = i; }
  }
  return sorted;
}

export function mergeMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const voted = votedOffsets(messages);
  const first = reconcile(messages, voted);
  // An offset proven by a long duplicate also resolves the shorter copies.
  const merged = first.observed.length ? reconcile(messages, [...voted, ...first.observed]) : first;
  return sequence(placeUnread(merged.result), chainEdges(messages, merged.place));
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
