import type { Attachment } from '../../types';
import { AttachmentControls } from './AttachmentControls';

export function AttachmentChip({ attachment, messageId }: { attachment: Attachment; messageId: string }) {
  return (
    <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-xs max-w-full">
      <div className="flex gap-2 items-center"><span aria-hidden="true">📎</span><span className="break-all flex-1">{attachment.name}</span><span>{attachment.sizeLabel}</span></div>
      <AttachmentControls attachment={attachment} messageId={messageId} />
    </div>
  );
}
