// Profile — identity + display preferences.
//
// Server component. Reads the session for the current identity block; a
// client sub-form handles the editable prefs (name, timezone, theme).
// Persistence is stubbed for Week 2 — the form action is a placeholder
// that logs; wire it to a Prisma-backed update in a follow-up.

import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-outline bg-surface-high">
              {user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-mono text-sm font-semibold text-on-surface">
                  {(user?.name || user?.email || "??").slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <div className="font-sans text-lg font-semibold text-on-surface">
                {user?.name ?? "Unnamed"}
              </div>
              <div className="font-mono text-xs text-on-surface-variant">
                {user?.email ?? "no email"}
              </div>
            </div>
          </div>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Sign in via Google to sync an avatar. Display-name editing lands
            with the profile-update endpoint.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 font-mono text-sm">
          <PrefRow label="Theme" value="System" hint="Dark / Light / System — coming soon" />
          <PrefRow label="Timezone" value="America/New_York" hint="Detected from browser" />
          <PrefRow
            label="Highlight new opportunities"
            value="ON"
            hint="Since-last-visit deltas on the dashboard"
          />
          <PrefRow
            label="Show extended-hours"
            value="OFF"
            hint="Include premarket / after-hours in default table filter"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PrefRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <div>
        <div className="text-on-surface">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[11px] text-on-surface-variant">{hint}</div>
        )}
      </div>
      <span className="text-primary">{value}</span>
    </div>
  );
}
