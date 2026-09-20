import { IdentityMasker, maskMessage } from './mask';
import { captureFidelity } from '../../shared/capture-replay';
import { conversationFilename } from './conversation';
import { saveFile } from './download';
import type { CaptureFidelity, ThreadCapture } from '../../shared/capture';
import type { ThreadData } from '../../types';

/**
 * The mail page's own markup for a thread, masked for sharing.
 *
 * Identities are seeded from every message header before a body or a container is read, so a
 * name written in prose resolves to the correspondent whose header it belongs to, exactly as
 * in the conversation export. Everything a parser reads — markup, classes, clocks, ordering,
 * picture identity, provider ids and their references — survives the masking, which is what
 * makes the copy worth sending: it still reproduces the problem the original does.
 */
export function maskCapture(capture: ThreadCapture, masker = new IdentityMasker()): ThreadCapture {
  // Addressed identities first, so an author a quote names without an address is recognised as
  // the person the rest of the thread addresses rather than becoming a second placeholder.
  for (const addressed of [true, false]) {
    for (const { snapshot } of capture.messages) {
      if (!snapshot || snapshot.message.sender.email.includes('@') !== addressed) continue;
      masker.person(snapshot.message.sender.email, snapshot.message.sender.name);
      if (addressed) for (const recipient of snapshot.message.recipients ?? []) masker.person(recipient);
    }
  }
  if (capture.currentUserEmail) masker.person(capture.currentUserEmail);
  // Every copy of an email must mask alike, so the whole capture is read for
  // addresses and names before a single word of it is rewritten. A name learned
  // only halfway through would leave the copies of one message looking different.
  for (const message of capture.messages) {
    masker.seedHtml(message.containerHtml);
    if (message.snapshot) masker.seedHtml(message.snapshot.html);
  }
  return {
    ...capture,
    masked: true,
    threadId: masker.id(capture.threadId),
    subject: masker.text(capture.subject),
    currentUserEmail: capture.currentUserEmail ? masker.person(capture.currentUserEmail).email : '',
    url: masker.url(capture.url),
    messages: capture.messages.map(message => ({
      ...message,
      snapshot: message.snapshot && {
        message: maskMessage(message.snapshot.message, masker),
        html: masker.providerHtml(message.snapshot.html),
        imageSources: message.snapshot.imageSources.map(source => masker.imageSource(source)),
      },
      containerHtml: masker.providerHtml(message.containerHtml),
    })),
  };
}

/** Asks the mail page for its own markup. Only the page itself can read it. */
export async function requestCapture(tabId: number | undefined): Promise<ThreadCapture> {
  if (tabId === undefined) throw new Error('The original mail tab is no longer open. Reopen the conversation and try again.');
  const capture: ThreadCapture | undefined = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_THREAD_SOURCE' });
  if (!capture?.messages?.length) throw new Error('No email was readable in the mail tab. Open the conversation there, then try again.');
  return capture;
}

export function captureFilename(subject: string, date = new Date(), masked = true): string {
  return conversationFilename(subject, date, masked ? 'source-masked' : 'source-original').replace(/\.html$/, '.json');
}

/**
 * Writes the thread's source for diagnosis and reports whether the masked copy is faithful.
 *
 * Both copies are always made and both are always parsed, whichever one is saved: the only
 * evidence that a masked copy still reproduces a problem is that it parses to the same thread
 * as the original, and that answer is written into the file itself. The original stays on this
 * machine unless its owner sends it; the masked copy is the one meant for sharing.
 */
export async function downloadThreadSource(thread: ThreadData, options: { masked?: boolean } = {}): Promise<CaptureFidelity> {
  const date = new Date();
  const original = await requestCapture(thread.sourceTabId);
  const masked = maskCapture(original);
  const fidelity = captureFidelity(original, masked);
  original.fidelity = fidelity;
  masked.fidelity = fidelity;
  const chosen = options.masked === false ? original : masked;
  saveFile(captureFilename(chosen.subject, date, chosen.masked),
    new Blob([JSON.stringify(chosen, null, 1)], { type: 'application/json;charset=utf-8' }));
  return fidelity;
}
