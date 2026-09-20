/**
 * Reads a capture file named by `npm run replay -- <file>` back through the real
 * parser and prints the conversation it produces. Nothing is checked in: the file
 * comes from whoever is reporting a problem, and the test is skipped without one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayCapture } from '../src/shared/capture-replay';
import type { ThreadCapture } from '../src/shared/capture';

const path = process.env.THREADLENS_CAPTURE;

describe.skipIf(!path)('A capture supplied on the command line', () => {
  it('parses to a conversation, and says what it made of it', () => {
    const capture = JSON.parse(readFileSync(path!, 'utf8')) as ThreadCapture;
    const batched = replayCapture(capture), whole = replayCapture(capture, { batchSize: 0 });
    const lines = [
      '',
      `File        ${path}`,
      `Thread      ${capture.subject} · ${capture.client} · ThreadLens ${capture.appVersion} · ${capture.masked ? 'identity-masked' : 'ORIGINAL, not masked'}`,
      `Captured    ${capture.capturedAt}`,
      `Containers  ${capture.messages.length} (${capture.messages.filter(message => message.snapshot).length} readable,`
        + ` ${capture.messages.filter(message => message.live).length} as the parser received them)`,
      `Parsed      ${batched.parsed} message copies in ${batched.batches} batch(es) → ${batched.shape.length} messages`,
      `Order       ${JSON.stringify(batched.shape) === JSON.stringify(whole.shape) ? 'the same read whole or in batches' : 'DIFFERENT read whole or in batches'}`,
      ...(capture.fidelity ? [`Masking     ${capture.fidelity.summary}`] : []),
      ...capture.notes.map(note => `Note        ${note}`),
      ...(capture.fidelity?.differences ?? []).map(line => `Difference  ${line}`),
      '',
      `Participants ${batched.thread?.participants.length ?? 0}`,
      ...(batched.thread?.participants ?? []).map(participant =>
        `             ${participant.sender.name} <${participant.sender.email}> · ${participant.messageCount} message(s)`),
      '',
      ...(batched.thread?.messages ?? []).map((message, index) =>
        `${String(index + 1).padStart(3)}. ${message.timestamp} ${message.source === 'quoted' ? 'quoted' : 'direct'}`
        + ` ${message.sender.name} <${message.sender.email}>`
        + `${message.quotedVariants?.length ? ` · ${message.quotedVariants.length} variant(s)` : ''}`
        + `${message.attachments?.length ? ` · ${message.attachments.length} attachment(s)` : ''}`
        + `${message.orderedByQuote ? ' · placed by the quote chain' : ''}`
        + `${message.timestampEstimated ? ' · approximate time' : ''}`
        + `\n     ${message.body.replace(/\s+/g, ' ').slice(0, 140)}`),
      '',
    ];
    console.log(lines.join('\n'));
    expect(batched.thread, 'the capture holds no readable email').not.toBeNull();
    expect(batched.shape).toEqual(whole.shape);
    if (capture.fidelity) expect(capture.fidelity.differences).toEqual([]);
  });
});
