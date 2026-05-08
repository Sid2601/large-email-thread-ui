export function LoadingState() {
  return (
    <div className="flex flex-col gap-3 p-4 bg-gray-50 dark:bg-gray-900 flex-1">
      {[1, 2, 3].map(i => (
        <div key={i} className={`flex gap-2 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse shrink-0" />
          <div className="flex flex-col gap-1 flex-1">
            <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
            <div className="h-12 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
