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
  'the', 'and', 'for', 'all', 'user', 'users', 'staff', 'www', 'com', 'net', 'org', 'gov', 'edu', 'plc']);

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** A conservative candidate; the digit count, shape and date test below decide whether it is really a number to call. */
const PHONE = /(?<![\w@.:-])\+?\(?\d[\d \t()+.-]{6,18}\d(?![\w:])/g;
const PLACEHOLDER_RUN = /(Person \d+|Company \d+)(?:[ \t'’-]*\1)+/g;

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
  private phrasePattern: RegExp | null | undefined;
  private shortFormPattern: RegExp | null | undefined;

  /** One placeholder per real address. Names seen later for a known address are learned too. */
  person(rawEmail: string, rawName = ''): MaskedIdentity {
    const email = rawEmail.trim().toLowerCase().replace(/^mailto:/, '').replace(/^<|>$/g, '');
    let identity = this.people.get(email);
    if (!identity) {
      const index = this.people.size + 1;
      const host = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
      identity = { name: `Person ${index}`, email: `person${index}@${this.domain(host, true)}` };
      this.people.set(email, identity);
      this.learn(email.split('@')[0] ?? '', identity.name);
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

  /** Masks text nodes and identifying attributes while leaving the markup itself intact. */
  html(value: string): string {
    if (!value) return value;
    const doc = new DOMParser().parseFromString(value, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const node of texts) node.data = this.text(node.data);
    // An inline picture can show a face, a signature or a letterhead, so no masked copy points at
    // one. Each image keeps its position and a stable neutral name instead.
    for (const image of Array.from(doc.body.querySelectorAll('img'))) {
      const source = image.getAttribute('src') || image.getAttribute('data-tl-image-src') || image.getAttribute('data-src') || '';
      for (const attribute of ['data-tl-image-src', 'data-src', 'srcset']) image.removeAttribute(attribute);
      image.setAttribute('src', `https://images.example/${this.imageName(source)}`);
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

  /** One neutral name per real image source, so a picture repeated in a quote stays recognisable as the same one. */
  private imageName(source: string): string {
    const known = this.images.get(source);
    if (known) return known;
    const extension = /\.(png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.exec(source)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? 'png';
    const name = `image-${this.images.size + 1}.${extension}`;
    this.images.set(source, name);
    return name;
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
      if (candidate.length < 3 || GENERIC_TOKENS.has(candidate) || !/\p{L}/u.test(candidate) || /^\d+$/.test(candidate)) continue;
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
      if (GENERIC_TOKENS.has(prefix)) continue;
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
 * Returns a copy of the thread with every identity replaced. Message wording, order,
 * timestamps, formatting, recovery labels and quote relationships are preserved so the copy
 * still reproduces a parsing problem.
 */
export function maskThread(thread: ThreadData, masker = new IdentityMasker()): ThreadData {
  // Seed every header identity first, so a name mentioned in a body maps to the sender it belongs to.
  for (const message of thread.messages) {
    masker.person(message.sender.email, message.sender.name);
    for (const recipient of message.recipients ?? []) masker.person(recipient);
  }
  for (const participant of thread.participants) masker.person(participant.sender.email, participant.sender.name);
  if (thread.currentUserEmail) masker.person(thread.currentUserEmail);

  const messages: ParsedMessage[] = thread.messages.map(message => {
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
  });

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
