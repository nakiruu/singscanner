// API keys — programmatic access.
//
// Stub for Week 2. Full issue/rotate/revoke flow lands with the API-keys
// PR (needs Prisma ApiKey model with hashed secrets + scope tokens).

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your API keys</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            No keys yet. API access is behind the feature flag while the
            key-management + scope-enforcement PR is being written.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this unlocks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-[12px] text-on-surface-variant">
          <div>
            • <span className="text-on-surface">GET /api/scan</span> —
            programmatic access to the current scan snapshot
          </div>
          <div>
            • <span className="text-on-surface">GET /api/portfolio</span> —
            portfolio overlay for your positions
          </div>
          <div>
            • <span className="text-on-surface">POST /api/watchlist</span> —
            add / remove symbols
          </div>
          <div>
            • <span className="text-on-surface">GET /api/status</span> —
            engine health probe (usable without a key)
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
