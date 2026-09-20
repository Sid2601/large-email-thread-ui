import type { ParsedMessage, Sender, ThreadData } from '../../types';
import { extractInitials, hashColor } from '../../content/scraper-utils';

/** Consumer mail hosts identify nobody on their own, so they stay readable. */
const PUBLIC_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'example.com']);

/** Role words and filler: replacing them would obscure the thread without protecting anybody. */
const GENERIC_TOKENS = new Set(['mail', 'email', 'inbox', 'info', 'admin', 'sales', 'support', 'help', 'helpdesk',
  'team', 'teams', 'noreply', 'reply', 'contact', 'contacts', 'office', 'accounts', 'account', 'finance', 'hello',
  'enquiries', 'enquiry', 'service', 'services', 'group', 'ltd', 'limited', 'llp', 'inc', 'corp', 'company',
  'the', 'and', 'for', 'all', 'user', 'users', 'staff', 'www', 'com', 'net', 'org', 'gov', 'edu', 'plc',
  'unknown', 'sender', 'recipient']);

/** Calendar words. A correspondent called May, June or Marchetti must not rewrite the dates
 * in a thread: a timestamp is evidence the masked copy has to keep exactly as it was. */
const CALENDAR_WORDS = new Set(['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun',
  'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec',
  'december', 'mon', 'monday', 'tue', 'tues', 'tuesday', 'wed', 'wednesday', 'thu', 'thur', 'thurs', 'thursday',
  'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday', 'today', 'yesterday', 'tomorrow']);

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** A conservative candidate; the digit count, shape and date test below decide whether it is really a number to call. */
const PHONE = /(?<![\w@.:-])\+?\(?\d[\d \t()+.-]{6,18}\d(?![\w:])/g;
const PLACEHOLDER_RUN = /(Person \d+|Company \d+)(?:[ \t'’-]*\1)+/g;

/** Attributes a scraper reads for structure, layout or time. Masking them would change what the
 * capture reproduces without protecting anybody: none of them names a person. */
const STRUCTURAL_ATTRIBUTES = new Set(['class', 'style', 'id', 'width', 'height', 'colspan', 'rowspan', 'align',
  'valign', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color', 'face', 'size', 'dir', 'lang', 'role',
  'type', 'target', 'rel', 'tabindex', 'hidden', 'start', 'span', 'datetime', 'loading', 'decoding',
  'referrerpolicy', 'contenteditable', 'draggable', 'spellcheck', 'translate', 'aria-hidden', 'aria-expanded',
  'aria-selected', 'aria-level', 'aria-checked', 'aria-disabled', 'aria-live', 'aria-haspopup', 'aria-atomic']);
const SOURCE_ATTRIBUTES = new Set(['src', 'data-src', 'data-tl-image-src', 'data-surl', 'poster']);
const URL_ATTRIBUTES = new Set(['href', 'cite', 'action', 'background', 'longdesc', 'data-saferedirecturl', 'ping', 'formaction']);
/** Provider identifiers hash a real address, so they are renumbered together with the message ids. */
const ID_ATTRIBUTES = new Set(['data-message-id', 'data-legacy-message-id', 'data-thread-id', 'data-legacy-thread-id',
  'data-thread-perm-id', 'data-unique-id', 'data-convid', 'data-conversation-id']);

export interface MaskedIdentity {
  name: string;
  email: string;
}

/**
 * Replaces real identities with stable placeholders so a conversation can be shared for
 * diagnosis. The same address, name, company, phone number or message id always maps to the
 * same placeholder, so reply chains, duplicate quotes and participation stay readable; the
 * wording, structure, ordering and timestamps of every message are left untouched.
 *
 * The map lives only in this object and is never written into the export.
 */
export class IdentityMasker {
  private readonly people = new Map<string, MaskedIdentity>();
  private readonly domains = new Map<string, string>();
  private readonly phrases = new Map<string, string>();
  private readonly shortForms = new Map<string, string>();
  private readonly phones = new Map<string, string>();
  private readonly ids = new Map<string, string>();
  private readonly images = new Map<string, string>();
  private issued = 0;
  private phrasePattern: RegExp | null | undefined;
  private shortFormPattern: RegExp | null | undefined;

  /** One placeholder per real address. Names seen later for a known address are learned too. */
  person(rawEmail: string, rawName = ''): MaskedIdentity {
    const email = rawEmail.trim().toLowerCase().replace(/^mailto:/, '').replace(/^<|>$/g, '');
    let identity = this.people.get(email);
    if (!identity) {
      const host = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
      // A quoted attribution names an author without recording an address, and the parser marks
      // that with `unknown:`. The masked copy keeps that shape: an identity with no address is
      // evidence in itself — it is how one person comes to be listed twice — and inventing an
      // address for it would hide that and change how the copy reconciles. Where the thread does
      // name that person elsewhere, both identities take the same placeholder name, so the masked
      // copy resolves them into one person exactly as the real thread does.
      const label = (rawName.trim() || (host ? '' : email.replace(/^unknown:/, ''))).trim().replace(/\s+/g, ' ').toLowerCase();
      const known = host ? undefined : this.phrases.get(label);
      const name = known ?? `Person ${++this.issued}`;
      identity = host
        ? { name, email: `person${this.issued}@${this.domain(host, true)}` }
        : { name, email: `unknown:${name.toLowerCase()}` };
      this.people.set(email, identity);
      if (host) this.learn(email.slice(0, email.lastIndexOf('@')), name);
    }
    if (rawName.trim()) this.learn(rawName, identity.name);
    return identity;
  }

  sender(sender: Sender): Sender {
    const identity = this.person(sender.email, sender.name);
    return { name: identity.name, email: identity.email, initials: extractInitials(identity.name), avatarColor: hashColor(identity.email) };
  }

  /** Message ids hash a real address, so they are renumbered; references keep pointing at the same message. */
  id(raw: string): string {
    const known = this.ids.get(raw);
    if (known) return known;
    const masked = `masked-${this.ids.size + 1}`;
    this.ids.set(raw, masked);
    return masked;
  }

  text(value: string): string {
    if (!value) return value;
    let masked = value.replace(EMAIL, match => this.person(match).email);
    const pattern = this.pattern();
    if (pattern) masked = masked.replace(pattern, match => this.phrases.get(match.toLowerCase().replace(/\s+/g, ' ')) ?? match);
    // "Hi Sid" and "Elevation Services" name the same people as Siddharth and elevationservices.co.uk.
    const shortForms = this.shortFormPattern === undefined ? this.buildShortForms() : this.shortFormPattern;
    if (shortForms) masked = masked.replace(shortForms, match => this.shortForms.get(match) ?? match);
    // A full name and its parts both map to one placeholder; collapse the repetition that leaves.
    masked = masked.replace(PLACEHOLDER_RUN, '$1');
    return this.maskPhones(masked);
  }

  /**
   * Learns who a piece of markup is about before any of it is rewritten.
   *
   * Masking a text node can only replace the names the masker already knows, so a display name
   * written above the address it belongs to — the name in a quoted attribution, a signature over
   * a mailto link — would survive in the copy that was masked first and be replaced in the next
   * one. That is both a leak and a difference between two copies of one email, which is exactly
   * what reconciliation reads as two different messages. Every address is therefore learned
   * first, together with whatever name is written beside it.
   */
  seedHtml(value: string): void {
    if (!value) return;
    this.seed(new DOMParser().parseFromString(value, 'text/html').body);
  }

  private seed(root: HTMLElement): void {
    for (const element of Array.from(root.querySelectorAll('[email], [data-hovercard-id], [data-address], a[href^="mailto:" i]'))) {
      const href = element.getAttribute('href') ?? '';
      const address = element.getAttribute('email') || element.getAttribute('data-hovercard-id') || element.getAttribute('data-address')
        || (/^mailto:/i.test(href) ? decodeURIComponent(href.slice(7).split(/[?,]/)[0]) : '');
      if (!address.includes('@')) continue;
      const label = (element.getAttribute('name') || element.getAttribute('data-name') || element.getAttribute('title') || element.textContent || '').trim().replace(/\s+/g, ' ');
      this.person(address, label.length <= 80 && !label.includes('@') ? label : '');
    }
    // An address written in prose names somebody even when nothing links to it.
    for (const match of (root.textContent ?? '').match(EMAIL) ?? []) this.person(match);
  }

  /** Masks text nodes and identifying attributes while leaving the markup itself intact. */
  html(value: string): string {
    if (!value) return value;
    const doc = new DOMParser().parseFromString(value, 'text/html');
    this.seed(doc.body);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) node.data = this.text(node.data);
    // An inline picture can show a face, a signature or a letterhead, so no masked copy points at
    // one. Each image keeps its position, and a placeholder of the same kind as its real address.
    for (const image of Array.from(doc.body.querySelectorAll('img'))) {
      const from = ['src', 'data-tl-image-src', 'data-src'].find(attribute => image.getAttribute(attribute)) ?? 'src';
      const source = image.getAttribute(from) ?? '';
      for (const attribute of ['src', 'data-tl-image-src', 'data-src', 'srcset']) image.removeAttribute(attribute);
      // A blob belongs to the mail tab and is read through it, so it stays in the attribute that says so.
      image.setAttribute(from === 'data-tl-image-src' ? 'data-tl-image-src' : 'src', this.imageSource(source));
    }
    for (const element of Array.from(doc.body.querySelectorAll('*'))) {
      for (const attribute of ['href', 'cite', 'action', 'background']) {
        const raw = element.getAttribute(attribute);
        if (raw !== null) element.setAttribute(attribute, this.url(raw));
      }
      for (const attribute of ['alt', 'title', 'aria-label', 'name', 'data-image-name']) {
        const raw = element.getAttribute(attribute);
        if (raw !== null) element.setAttribute(attribute, this.text(raw));
      }
    }
    return doc.body.innerHTML;
  }

  /**
   * Masks a provider's own markup: the message container as the mail page held it, rather than
   * the body ThreadLens rebuilt from it.
   *
   * Every attribute is treated as identifying unless it is structural, because a mail client
   * writes addresses and display names into attributes no allowlist could predict. What a
   * scraper reads to do its job — element classes, layout, ids and the spelled-out dates in
   * `datetime`, `title` and tooltip attributes — keeps its shape, so the masked capture still
   * reproduces the problem the original does.
   */
  providerHtml(value: string): string {
    if (!value) return value;
    const doc = new DOMParser().parseFromString(value, 'text/html');
    // A provider labels a correspondent with their address and their display name on one
    // element, which is the strongest evidence of who a name belongs to in the whole page.
    this.seed(doc.body);
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) node.data = this.text(node.data);
    for (const element of Array.from(doc.body.querySelectorAll('*'))) {
      const picture = element.tagName === 'IMG';
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase(), raw = attribute.value;
        if (!raw || STRUCTURAL_ATTRIBUTES.has(name)) continue;
        // A source set lists several addresses for one picture and none of them is needed.
        if (name === 'srcset') { element.removeAttribute(name); continue; }
        if (picture && SOURCE_ATTRIBUTES.has(name)) { element.setAttribute(name, this.imageSource(raw)); continue; }
        if (URL_ATTRIBUTES.has(name) || SOURCE_ATTRIBUTES.has(name)) { element.setAttribute(name, this.url(raw)); continue; }
        if (ID_ATTRIBUTES.has(name)) { element.setAttribute(name, this.id(raw)); continue; }
        element.setAttribute(name, this.text(raw));
      }
    }
    return doc.body.innerHTML;
  }

  /**
   * Link and image addresses carry names, tenants and one-time tokens, so the host is mapped
   * like any other domain, the path is masked as text and the query is dropped. Inline image
   * bytes and mail-tab blobs are refused outright: a picture can show a face or a letterhead.
   */
  url(raw: string): string {
    const value = raw.trim();
    if (!value) return '';
    if (/^(?:data|blob|cid):/i.test(value)) return 'masked:image';
    let url: URL;
    try { url = new URL(value, 'https://masked.example/'); } catch { return 'masked:link'; }
    if (url.protocol === 'mailto:') {
      const addresses = url.pathname.split(',').map(address => address.trim()).filter(Boolean);
      return `mailto:${addresses.map(address => this.person(address).email).join(',')}`;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'masked:link';
    const query = url.search || url.hash ? '?masked' : '';
    return `${url.protocol}//${this.domain(url.hostname, false)}${this.text(url.pathname)}${query}`;
  }

  /** Keeps the extension so an attachment still reads as a spreadsheet, image or document. */
  filename(name: string): string {
    return this.text(name);
  }

  /**
   * Replaces a picture's address while keeping what reconciliation reads it for.
   *
   * Copies of one email are told apart by their pictures, and the kind of
   * address matters as much as the address itself: a data payload and a content
   * id name a picture, a blob handle and a bare proxy token name none, and a
   * proxy address ending in the original URL names the picture that URL does.
   * A masked copy that flattened all of these into one https placeholder would
   * merge or separate copies that the original does not, so each kind is
   * replaced by a placeholder of its own kind. No picture bytes are written.
   */
  imageSource(raw: string): string {
    const value = raw.trim();
    if (!value) return '';
    const key = /^cid:/i.test(value) ? value.toLowerCase()
      : /^https?:/i.test(value) && !/#https?:\/\//i.test(value) && !/googleusercontent\.com\/proxy\//i.test(value) ? this.addressKey(value)
      : value;
    const known = this.images.get(key);
    if (known) return known;
    const masked = this.mintImage(value);
    this.images.set(key, masked);
    return masked;
  }

  /** Providers vary the query around one picture, so only the origin and path identify it. */
  private addressKey(value: string): string {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value; }
  }

  private mintImage(value: string): string {
    const index = this.images.size + 1;
    // A proxy address that ends in the original URL is identified by that URL.
    const proxied = /#(https?:\/\/[^"\s]+)$/.exec(value)?.[1];
    if (proxied) return `https://ci0.googleusercontent.com/proxy/masked#${this.imageAddress(proxied)}`;
    if (/^blob:/i.test(value)) return `blob:https://mail.google.com/masked-${index}`;
    if (/googleusercontent\.com\/proxy\//i.test(value)) return `https://ci0.googleusercontent.com/proxy/masked-${index}`;
    // A payload identifies a picture by its bytes; a placeholder of the same
    // length would be as heavy as the picture, so a distinct short one is used.
    if (/^data:/i.test(value)) {
      const mime = /^data:([a-z0-9/+.-]*)[;,]/i.exec(value)?.[1] || 'image/png';
      return `data:${mime};base64,${btoa(`masked-image-${index}`)}`;
    }
    if (/^cid:/i.test(value)) return `cid:masked-${index}@company.example`;
    if (/^https?:/i.test(value)) return this.imageAddress(value);
    return `masked:image-${index}`;
  }

  /** One neutral name per real picture, so a picture repeated in a quote stays recognisable as the same one. */
  private imageAddress(source: string): string {
    const key = this.addressKey(source);
    const known = this.images.get(key);
    if (known) return known;
    const extension = /\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.exec(source)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? 'png';
    const masked = `https://images.example/image-${this.images.size + 1}.${extension}`;
    this.images.set(key, masked);
    return masked;
  }

  private domain(host: string, learnLabel: boolean): string {
    const real = host.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (!real) return 'company.example';
    if (PUBLIC_MAIL_DOMAINS.has(real)) return real;
    const known = this.domains.get(real);
    if (known) return known;
    const index = this.domains.size + 1;
    const masked = `company${index}.example`;
    this.domains.set(real, masked);
    // Only a correspondent's own domain names their employer in the prose; arbitrary link
    // hosts are masked in the address but their words are left alone.
    if (learnLabel) {
      const label = real.split('.').filter(part => part.length >= 4 && !GENERIC_TOKENS.has(part)).sort((a, b) => b.length - a.length)[0];
      if (label) this.learn(label, `Company ${index}`);
    }
    return masked;
  }

  /** Learns the whole name and each of its parts, so "Dana Okafor", "Dana" and "okafor" all map alike. */
  private learn(raw: string, replacement: string): void {
    const full = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    const candidates = [full, ...full.split(/[^\p{L}\p{N}]+/u)];
    for (const candidate of candidates) {
      if (candidate.length < 3 || GENERIC_TOKENS.has(candidate) || CALENDAR_WORDS.has(candidate) || !/\p{L}/u.test(candidate) || /^\d+$/.test(candidate)) continue;
      if (this.phrases.has(candidate)) continue;
      this.phrases.set(candidate, replacement);
      this.phrasePattern = undefined;
      this.learnShortForms(candidate, replacement);
    }
  }

  /**
   * A greeting rarely uses the full name, and a domain runs its words together, so capitalised
   * openings of a known name are masked too: Sid for Siddharth, Elevation for elevationservices.
   * Only the capitalised form is matched, which keeps ordinary lowercase words readable.
   */
  private learnShortForms(token: string, replacement: string): void {
    if (token.includes(' ')) return;
    // The whole word is repeated here because this pattern also matches across a capital,
    // which is how WarehousePartners and ElevationServices give a company away in a filename.
    for (let length = token.length; length >= 3; length--) {
      if (length < token.length && token.length < 5) break;
      const prefix = token.slice(0, length);
      if (GENERIC_TOKENS.has(prefix) || CALENDAR_WORDS.has(prefix)) continue;
      const capitalised = prefix[0].toUpperCase() + prefix.slice(1);
      if (this.shortForms.has(capitalised)) continue;
      this.shortForms.set(capitalised, replacement);
      this.shortFormPattern = undefined;
    }
  }

  private buildShortForms(): RegExp | null {
    if (!this.shortForms.size) return (this.shortFormPattern = null);
    const alternatives = Array.from(this.shortForms.keys())
      .sort((a, b) => b.length - a.length)
      .map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '\\x2d'));
    // A capital starts a new word inside CamelCase, so it counts as a boundary on both sides.
    return (this.shortFormPattern = new RegExp(`(?<![\\p{Lu}\\p{N}])(?:${alternatives.join('|')})(?![\\p{Ll}\\p{N}])`, 'gu'));
  }

  private pattern(): RegExp | null {
    if (this.phrasePattern !== undefined) return this.phrasePattern;
    if (!this.phrases.size) return (this.phrasePattern = null);
    // Longest first, so a full name wins over the single part it contains.
    const alternatives = Array.from(this.phrases.keys())
      .sort((a, b) => b.length - a.length)
      // Unicode mode rejects \- outside a class, so the hyphen is escaped by code point.
      .map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '\\x2d').replace(/ +/g, '\\s+'));
    return (this.phrasePattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu'));
  }

  private maskPhones(value: string): string {
    return value.replace(PHONE, match => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15) return match;
      // Dates and reference numbers are part of the evidence a thread is read for.
      if (/\d{4}[-/.]\d{1,2}/.test(match) || /\d[-/.]\d{4}/.test(match)) return match;
      if (!/^[+(]|^0|^\d{9}/.test(match.trim())) return match;
      let masked = this.phones.get(digits);
      if (!masked) {
        // A bare run of digits is as likely an account or reference number as a number to call.
        const kind = /^[+(]|^0/.test(match.trim()) ? 'phone' : 'number';
        masked = `[${kind}-${this.phones.size + 1}]`;
        this.phones.set(digits, masked);
      }
      return masked;
    });
  }
}

/**
 * One message with its identities replaced and everything a parser reads left alone: the
 * wording, the markup, the clock, the recovery flags and the quote links are untouched.
 * Shared by the conversation export and the thread-source capture, so a masked message
 * reads the same whichever file it reaches.
 */
export function maskMessage(message: ParsedMessage, masker: IdentityMasker): ParsedMessage {
  const masked: ParsedMessage = {
    ...message,
    id: masker.id(message.id),
    sender: masker.sender(message.sender),
    body: masker.text(message.body),
  };
  if (message.bodyHtml) masked.bodyHtml = masker.html(message.bodyHtml);
  if (message.quotedText) masked.quotedText = masker.text(message.quotedText);
  if (message.quotedBy) masked.quotedBy = masker.id(message.quotedBy);
  if (message.recipients) masked.recipients = message.recipients.map(recipient => masker.person(recipient).email);
  if (message.quotedVariants) {
    masked.quotedVariants = message.quotedVariants.map(variant => ({
      body: masker.text(variant.body),
      ...(variant.bodyHtml ? { bodyHtml: masker.html(variant.bodyHtml) } : {}),
    }));
  }
  if (message.attachments) {
    masked.attachments = message.attachments.map(attachment => ({
      ...attachment,
      name: masker.filename(attachment.name),
      downloadUrl: '',
    }));
  }
  return masked;
}

/**
 * Returns a copy of the thread with every identity replaced. Message wording, order,
 * timestamps, formatting, recovery labels and quote relationships are preserved so the copy
 * still reproduces a parsing problem.
 */
export function maskThread(thread: ThreadData, masker = new IdentityMasker()): ThreadData {
  // Seed every header identity first, so a name mentioned in a body maps to the sender it belongs
  // to — and the addressed identities before the name-only ones, so an author quoted without an
  // address is recognised as the person the rest of the thread addresses.
  for (const addressed of [true, false]) {
    for (const message of thread.messages) {
      if (message.sender.email.includes('@') !== addressed) continue;
      masker.person(message.sender.email, message.sender.name);
      if (addressed) for (const recipient of message.recipients ?? []) masker.person(recipient);
    }
    for (const participant of thread.participants) {
      if (participant.sender.email.includes('@') === addressed) masker.person(participant.sender.email, participant.sender.name);
    }
  }
  if (thread.currentUserEmail) masker.person(thread.currentUserEmail);

  const messages = thread.messages.map(message => maskMessage(message, masker));

  return {
    ...thread,
    threadId: masker.id(thread.threadId),
    subject: masker.text(thread.subject),
    messages,
    participants: thread.participants.map(participant => ({ ...participant, sender: masker.sender(participant.sender) })),
    currentUserEmail: thread.currentUserEmail ? masker.person(thread.currentUserEmail).email : undefined,
    participation: thread.participation
      ? { ...thread.participation, messageId: masker.id(thread.participation.messageId), title: masker.text(thread.participation.title), detail: masker.text(thread.participation.detail) }
      : undefined,
    // The masked copy is self-contained: nothing may be fetched from the original mail tab.
    sourceTabId: undefined,
  };
}
