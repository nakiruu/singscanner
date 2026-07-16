// Billing — plan + invoices + payment method.
//
// Stub for Week 2. Existing /upgrade page moves here in a follow-up. Full
// Stripe integration lands with billing PR.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-sm text-on-surface-variant">Plan</span>
            <span className="font-mono text-lg font-semibold text-primary">
              Beta
            </span>
          </div>
          <p className="font-mono text-[11px] text-on-surface-variant">
            Everyone is on the beta plan while the product is under active
            construction. Pricing and paid tiers ship after the P0/P1/P2
            roadmap is fully deployed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment method</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            No payment method on file. Stripe wiring lands with the billing PR.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-[11px] text-on-surface-variant">
            No invoices yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
