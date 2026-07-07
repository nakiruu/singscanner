"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface UserDetail {
  id: string;
  email: string;
  username: string;
  name: string | null;
  image: string | null;
  role: "USER" | "PREMIUM" | "ADMIN";
  suspended: boolean;
  createdAt: string;
  portfolio: Array<{ symbol: string; qty: number; costBasis: number }>;
  watchlist: Array<{ symbol: string }>;
}

export function UserDetailClient({ user }: { user: UserDetail }) {
  const [role, setRole] = useState<UserDetail["role"]>(user.role);
  const [suspended, setSuspended] = useState<boolean>(user.suspended);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const commitRole = (next: UserDetail["role"]) => {
    setErr(null);
    setRole(next);
    startTransition(async () => {
      const r = await fetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      if (!r.ok) { setErr(`role update failed (${r.status})`); setRole(user.role); return; }
      router.refresh();
    });
  };
  const commitSuspend = (next: boolean) => {
    setErr(null);
    setSuspended(next);
    startTransition(async () => {
      const r = await fetch(`/api/admin/users/${user.id}/suspend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspended: next }),
      });
      if (!r.ok) { setErr(`suspend update failed (${r.status})`); setSuspended(user.suspended); return; }
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>▸ Info</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-1 font-mono text-[11px]">
            <Row label="id" value={user.id} />
            <Row label="email" value={user.email} />
            <Row label="username" value={user.username} />
            <Row label="name" value={user.name ?? "—"} />
            <Row label="created" value={user.createdAt.slice(0, 19).replace("T", " ")} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>▸ Actions</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Role</div>
              <div className="flex gap-2">
                {(["USER", "PREMIUM", "ADMIN"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={pending}
                    onClick={() => commitRole(r)}
                    className={cn(
                      "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                      role === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
                    )}
                  >{r}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">Suspended</div>
              <button
                type="button"
                disabled={pending}
                onClick={() => commitSuspend(!suspended)}
                className={cn(
                  "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider",
                  suspended
                    ? "border-error bg-error/10 text-error"
                    : "border-border bg-surface-lowest text-on-surface-variant hover:text-on-surface",
                )}
              >
                {suspended ? "suspended" : "active"}
              </button>
              <div className="mt-1 font-mono text-[10px] text-on-surface-variant">
                v1: flag only. Login enforcement is a follow-up.
              </div>
            </div>
            {err && <div className="font-mono text-[11px] text-error">{err}</div>}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>▸ Portfolio · {user.portfolio.length}</CardTitle></CardHeader>
        <CardContent>
          {user.portfolio.length === 0 ? (
            <div className="font-mono text-[11px] text-on-surface-variant">empty</div>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="text-on-surface-variant">
                  <th className="text-left">symbol</th>
                  <th className="text-right">qty</th>
                  <th className="text-right">cost basis</th>
                </tr>
              </thead>
              <tbody>
                {user.portfolio.map((p) => (
                  <tr key={p.symbol} className="border-t border-border/50">
                    <td className="text-on-surface font-semibold">{p.symbol}</td>
                    <td className="text-right text-on-surface">{p.qty}</td>
                    <td className="text-right text-on-surface">${p.costBasis.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-on-surface">{value}</dd>
    </div>
  );
}
