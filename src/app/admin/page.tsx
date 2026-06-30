import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Middleware already gates this route to ADMIN-only — no in-page auth check
// is needed for access control, but we read the session for display.

export default function AdminPage() {
  return (
    <main className="relative flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-[1280px] space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-sans text-2xl font-semibold">Admin</h1>
          <Badge tone="primary" led>
            ADMIN
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Site Analytics</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs text-terminal-gray">
              Wire up next: pageviews, MAU, conversion to PREMIUM.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs text-terminal-gray">
              Wire up next: Stripe webhooks, MRR, churn, refunds.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Users</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-xs text-terminal-gray">
              Wire up next: list, search, role overrides, suspend.
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
