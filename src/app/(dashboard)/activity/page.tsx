// Activity — the user's own timeline of trade + scan interactions.
//
// Different from /admin/activity (a system feed). Stub for Week 9 — real
// timeline lands with the activity-persistence Prisma model tracking
// position adds/removes, watchlist changes, threshold breaches, etc.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ActivityPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] space-y-6 p-6">
      <div>
        <h1 className="font-sans text-2xl font-semibold">Activity</h1>
        <p className="mt-1 font-mono text-xs text-on-surface-variant">
          Your timeline of positions, watchlist changes, and threshold events.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
              nothing yet
            </div>
            <p className="max-w-md font-mono text-[11px] text-on-surface-variant">
              Once you add positions, star symbols, or receive alerts, they
              appear here in reverse-chronological order. Persistence for
              this timeline lands with the activity-log Prisma model.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What we track</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-[12px] text-on-surface-variant">
          <div>• Positions added / removed / edited</div>
          <div>• Watchlist add / remove</div>
          <div>• Stop-price breaches on your holdings</div>
          <div>• Challenger promotions that would have affected your rows</div>
          <div>• Portfolio concentration / Herfindahl warnings</div>
          <div className="pt-2 text-[10px] uppercase tracking-widest text-primary/80">
            We do NOT track scanner views or hover interactions — this is a
            decision timeline, not a behavior log.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
