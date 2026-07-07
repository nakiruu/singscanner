"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSummary } from "@/app/api/admin/summary/route";

type Business = AdminSummary["business"];

export function BusinessSection({ business }: { business: Business | null }) {
  if (!business) {
    return (
      <Card>
        <CardHeader><CardTitle>▸ Business</CardTitle></CardHeader>
        <CardContent><div className="font-mono text-[11px] text-on-surface-variant">loading…</div></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>▸ Business · 30d</CardTitle>
        <span className="font-mono text-[10px] text-on-surface-variant">postgres</span>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Users · by role
            </div>
            <div className="font-mono text-sm text-on-surface">
              <span className="font-semibold">{business.totalUsers}</span> total ·
              {" "}<span>{business.usersByRole.USER} free</span> ·
              {" "}<span>{business.usersByRole.PREMIUM} premium</span> ·
              {" "}<span>{business.usersByRole.ADMIN} admin</span>
            </div>
            <div className="mt-2 font-mono text-[10px] text-on-surface-variant">
              +{business.signups7d} signups last 7d
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              MRR (stub)
            </div>
            <div className="font-mono text-lg font-semibold text-on-surface">${business.mrrStub}</div>
            <div className="font-mono text-[10px] text-on-surface-variant">stripe not wired</div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              Recent signups
            </div>
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {business.recentSignups.length === 0 ? (
                  <tr><td className="text-on-surface-variant">no recent signups</td></tr>
                ) : business.recentSignups.map((u) => (
                  <tr key={u.id} className="border-t border-border/50">
                    <td className="text-on-surface-variant py-1">{u.createdAt.slice(11, 16)}</td>
                    <td className="py-1">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-on-surface hover:text-primary hover:underline"
                      >
                        {u.email}
                      </Link>
                    </td>
                    <td className="text-on-surface-variant py-1 text-right">{u.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
