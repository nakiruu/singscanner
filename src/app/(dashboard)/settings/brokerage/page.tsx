// Brokerage — Alpaca live/paper key entry.
//
// Stub for Week 2. Absorbs the "Alpaca" card from the previous stub
// settings page. Full per-user encrypted-key storage lands with the
// brokerage-adapter PR (needs a per-user encrypted secret in Prisma).

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BrokeragePage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Alpaca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-mono text-sm text-on-surface-variant">
            Alpaca is currently configured via environment (ALPACA_API_KEY /
            ALPACA_API_SECRET). Per-user key entry lands with the
            brokerage-adapter PR.
          </p>
          <div className="rounded border border-border bg-surface-lowest px-3 py-2 font-mono text-[11px] text-on-surface-variant">
            <div>Live keys — <span className="text-tertiary">system-wide (env)</span></div>
            <div>Paper keys — <span className="text-tertiary">system-wide (env)</span></div>
            <div>Feed — <span className="text-primary">iex</span></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interactive Brokers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            IB connection not yet supported. Planned for after the Alpaca
            per-user key entry lands.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
