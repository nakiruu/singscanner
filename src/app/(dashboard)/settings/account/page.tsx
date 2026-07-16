// Account — credentials + security.
//
// Stub-level for Week 2 — displays current email and sign-in method; edit
// forms defer to a follow-up that plumbs the Prisma User model.

import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AccountPage() {
  const session = await auth();
  const user = session?.user;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 font-mono text-sm">
          <Row label="Email">{user?.email ?? "—"}</Row>
          <Row label="Method">Credentials + Google (if linked)</Row>
          <Row label="Role">{user?.role ?? "USER"}</Row>
          <p className="pt-2 text-[11px] text-on-surface-variant">
            Change-email + change-password + 2FA setup ship in a follow-up.
            For now, contact an admin to update an account.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Active-session management + &quot;Sign out other devices&quot;
            requires the sessions table to be exposed via the auth adapter.
            Placeholder — lands with the account-hardening PR.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Deletion path removes credentials + Google links + portfolio +
            watchlist rows. Kept manual for now to prevent accidental use.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-on-surface">{children}</span>
    </div>
  );
}
