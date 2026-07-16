// Watchlist page — activates the existing WatchlistView component as a
// first-class route. Previously an orphan under /components/dashboard/views.

"use client";

import { WatchlistView } from "@/components/dashboard/views/WatchlistView";
import { useScanStream } from "@/lib/hooks/useScanStream";

export default function WatchlistPage() {
  const { snapshot, status } = useScanStream();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-sans text-2xl font-semibold">Watchlist</h1>
        <p className="font-mono text-xs text-terminal-gray">
          Scan stream: {status}
          {snapshot && (
            <span className="ml-2">
              · {snapshot.rows.length} symbols · horizon {snapshot.horizon}
            </span>
          )}
        </p>
      </div>
      <WatchlistView snapshot={snapshot} />
    </div>
  );
}
