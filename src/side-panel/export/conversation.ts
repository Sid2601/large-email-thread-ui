import { embedImages, stripImages } from '../media/images';
import type { ThreadData } from '../../types';
import { mergeMessages, participationBoundary } from '../../content/message-reconciliation';
import { sanitizeEmailHtml } from '../../content/scraper-utils';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** A portable, script-free document; never export expiring attachment URLs. */
export function conversationHtml(thread: ThreadData, exportedAt = new Date()): string {
  const messages = mergeMessages(thread.messages);
  const participation = participationBoundary(messages, thread.currentUserEmail) ?? thread.participation;
  const participants = new Map(messages.map(message => [message.sender.email, message.sender]));
  const articles = messages.map((message, index) => {
    const date = new Date(message.timestamp);
    const time = message.timestampEstimated || !Number.isFinite(date.getTime())
      ? 'Time unavailable · approximate order'
      : date.toLocaleString([], { dateStyle: 'full', timeStyle: 'long' });
    const body = message.bodyHtml ? sanitizeEmailHtml(message.bodyHtml) : `<div class="plain">${escape(message.body)}</div>`;
    const attachments = message.attachments?.length ? `<aside><strong>Attachments</strong><ul>${message.attachments.map(attachment =>
      `<li>${escape(attachment.name)}${attachment.sizeLabel ? ` — ${escape(attachment.sizeLabel)}` : ''}</li>`
    ).join('')}</ul><small>File contents are not embedded. Download attachments separately from ThreadLens or the original email.</small></aside>` : '';
    const variants = message.quotedVariants?.length ? `<details><summary>Quoted copy differs (${message.quotedVariants.length})</summary><p>A likely repeated quote has different wording. These copies are preserved for comparison.</p>${message.quotedVariants.map(variant => `<div class="email-body">${variant.bodyHtml ? sanitizeEmailHtml(variant.bodyHtml) : `<div class="plain">${escape(variant.body)}</div>`}</div>`).join('')}</details>` : '';
    const boundary = participation?.messageId === message.id ? `<section class="participation"><strong>${escape(participation.title)}</strong><p>${escape(participation.detail)}</p></section>` : '';
    return `${boundary}<article aria-label="Message ${index + 1}"><header><strong>${escape(message.sender.name)}</strong> <span>&lt;${escape(message.sender.email)}&gt;</span><div class="meta">${escape(time)}${message.source === 'quoted' ? ' · Recovered from quoted history' : ''}${message.isCurrentUser ? ' · You' : ''}</div></header><div class="email-body">${body}</div>${message.quotedText ? `<details><summary>Additional quoted text</summary><div class="plain">${escape(message.quotedText)}</div></details>` : ''}${variants}${attachments}</article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(thread.subject)} — ThreadLens conversation</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#172334;font:15px/1.6 system-ui,-apple-system,sans-serif}main{max-width:960px;margin:auto;padding:32px 20px}.overview{margin-bottom:24px}.participation{padding:16px;border:1px solid #b6cef0;background:#edf5ff;border-radius:10px}h1{font-size:28px;line-height:1.2;overflow-wrap:anywhere}.meta,small{color:#526175;font-size:12px}.participants{overflow-wrap:anywhere}article{background:white;border:1px solid #d8e0ea;border-radius:12px;padding:20px;margin:16px 0;overflow-wrap:anywhere}article header{border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:14px}article header span{color:#526175;font-size:13px}.email-body{overflow-x:auto}.email-body img{display:block;max-width:100%;height:auto;margin:12px 0}.email-body p{margin:.5em 0}.email-body table{border-collapse:collapse;max-width:100%;margin:12px 0}.email-body td,.email-body th{border:1px solid #cbd5e1;padding:6px 10px}.email-body blockquote{border-left:3px solid #cbd5e1;margin-left:0;padding-left:14px}.image-placeholder{display:inline-block;margin:6px 0;padding:4px 8px;border:1px dashed #a9b6c8;border-radius:6px;background:#eef2f7;color:#526175;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.plain{white-space:pre-wrap}pre{overflow:auto;white-space:pre}a{color:#175bc1}aside,details{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0}aside ul{padding-left:20px}footer{margin-top:24px}@media print{body{background:white}main{max-width:none;padding:0}article{border-radius:0;break-inside:auto}thead{display:table-header-group}tr{break-inside:avoid}.email-body{overflow:visible}}
</style></head><body><main><section class="overview"><h1>${escape(thread.subject)}</h1><p>${messages.length} messages · ${participants.size} participants · ${escape(thread.client)}</p><p class="participants">${Array.from(participants.values()).map(sender => `${escape(sender.name)} &lt;${escape(sender.email)}&gt;`).join(' · ')}</p><p class="meta">Exported ${escape(exportedAt.toLocaleString())}. Contains all messages currently recovered by ThreadLens, regardless of search or participant filters. Earlier history absent from the available emails cannot be recovered.${messages.some(message => message.timestampZoneUnknown) ? ' Some times were read from quoted text, which records no timezone, and can be offset from the original send time.' : ''}</p></section>${articles}<footer class="meta">Exported locally by ThreadLens. Attachment names are listed; file contents are not embedded.</footer></main></body></html>`;
}

export function conversationFilename(subject: string, date = new Date(), suffix = ''): string {
  const name = subject.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'conversation';
  return `ThreadLens-${name}-${date.toISOString().slice(0, 10)}${suffix ? `-${suffix}` : ''}.html`;
}

/** `includeImages: false` writes a small, offline-stable copy for testing: images become filenames such as image-1.png. */
export async function downloadConversation(thread: ThreadData, options: { includeImages?: boolean } = {}): Promise<number> {
  const date = new Date();
  const includeImages = options.includeImages !== false;
  const html = conversationHtml(thread, date);
  const exported = includeImages ? await embedImages(html, thread.sourceTabId) : { html: stripImages(html).html, missing: 0 };
  const blob = new Blob([exported.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = conversationFilename(thread.subject, date, includeImages ? '' : 'no-images');
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return exported.missing;
}
