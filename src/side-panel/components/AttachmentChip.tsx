import type { Attachment } from '../../types';

function iconForMime(mime: string): string {
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('image')) return '🖼️';
  if (mime.includes('video')) return '🎬';
  if (mime.includes('audio')) return '🎵';
  if (mime.includes('zip') || mime.includes('archive')) return '🗜️';
  return '📎';
}

export function AttachmentChip({ attachment }: { attachment: Attachment }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-100 rounded-lg border border-gray-200 text-xs max-w-full">
      <span className="text-base shrink-0">{iconForMime(attachment.mimeType)}</span>
      <span className="truncate text-gray-700 min-w-0 flex-1" title={attachment.name}>
        {attachment.name}
      </span>
      {attachment.sizeLabel && (
        <span className="text-gray-400 shrink-0">{attachment.sizeLabel}</span>
      )}
      <button
        onClick={() => window.open(attachment.downloadUrl, '_blank')}
        className="shrink-0 text-blue-500 hover:text-blue-700 font-medium"
        title="Download"
      >
        ↓
      </button>
    </div>
  );
}
