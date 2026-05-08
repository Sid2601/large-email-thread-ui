export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-5 text-center bg-gray-50 dark:bg-gray-900">
      <div className="text-5xl">📬</div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No thread loaded yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          Open an email thread in Gmail, then click the ThreadLens icon.
        </p>
      </div>
      <div className="w-full rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2 text-left space-y-1">
        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">If this stays blank:</p>
        <ol className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5 list-decimal list-inside">
          <li>Click an email to open the full thread</li>
          <li>Open DevTools → Console, filter by <code className="bg-blue-100 dark:bg-blue-900 px-0.5 rounded">[ThreadLens]</code></li>
          <li>You should see <em>"Content script loaded"</em></li>
          <li>If not, reload the extension at <code className="bg-blue-100 dark:bg-blue-900 px-0.5 rounded">chrome://extensions</code></li>
        </ol>
      </div>
    </div>
  );
}
