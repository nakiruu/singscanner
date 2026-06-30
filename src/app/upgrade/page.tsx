import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; reason?: string }>;
}) {
  const { from, reason } = await searchParams;
  const session = await auth();
  const adminOnly = reason === "admin-only";

  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-16">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-30" />

      <Card className="relative z-10 w-full max-w-lg emerald-glow">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle>{adminOnly ? "Admin Access Required" : "Members Only"}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-6 text-on-surface-variant">
            {adminOnly
              ? "This area is restricted to administrators."
              : "Singularity Scanner is a paid membership. Subscribe to access the live scanner, portfolio overlay, and ML signals."}
          </p>

          {!adminOnly && (
            <ul className="space-y-2 font-mono text-sm">
              {[
                "Real-time M·Q·L·R signals across 300+ symbols",
                "After-cost gate with model edge / net surplus",
                "Portfolio overlay: stop, target, R:R",
                "ML + Kronos boost signals",
                "Live SSE stream — no manual refresh",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-on-surface-variant">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-2 pt-2">
            {adminOnly ? (
              <Button asChild>
                <Link href="/dashboard">Return to dashboard</Link>
              </Button>
            ) : (
              <>
                {/* TODO: wire Stripe checkout. For now, a placeholder. */}
                <Button disabled>Subscribe — coming soon</Button>
                <p className="text-center font-mono text-xs text-terminal-gray">
                  Payment integration is being finalized.
                </p>
              </>
            )}
          </div>

          {!session && (
            <div className="border-t border-border pt-4 text-center font-mono text-xs text-on-surface-variant">
              Already a member?{" "}
              <Link
                href={`/login${from ? `?from=${encodeURIComponent(from)}` : ""}`}
                className="text-primary hover:underline"
              >
                Sign in
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
