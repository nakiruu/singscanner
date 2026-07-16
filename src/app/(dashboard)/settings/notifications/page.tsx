// Notifications — email digest + push + per-symbol alerts.
//
// Functional stub for Week 2: toggles render + persist per-tab client state
// (no backend yet). Persistence lands with the notification-prefs Prisma
// model in a follow-up. Toggle state is intentionally optimistic so the
// UX feels real during design review.

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const [digestDaily, setDigestDaily] = useState(true);
  const [digestWeekly, setDigestWeekly] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [alertOnPromotion, setAlertOnPromotion] = useState(true);
  const [alertOnStopBreach, setAlertOnStopBreach] = useState(true);
  const [alertOnConcentration, setAlertOnConcentration] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email digest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle
            label="Daily digest"
            hint="Sent 09:15 ET — top-10 opportunities + your positions"
            checked={digestDaily}
            onChange={setDigestDaily}
          />
          <Toggle
            label="Weekly retrospective"
            hint="Sent Friday — hit-rate, missed opps, portfolio review"
            checked={digestWeekly}
            onChange={setDigestWeekly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Push (browser)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle
            label="Enable push notifications"
            hint="Only for gate-decision changes, never for raw price moves"
            checked={pushEnabled}
            onChange={setPushEnabled}
          />
          {pushEnabled && (
            <p className="rounded border border-tertiary/40 bg-tertiary/5 px-3 py-2 font-mono text-[11px] text-tertiary">
              Web Push permission not yet requested — landing with the
              service-worker PR.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle
            label="Challenger promotion ready"
            hint="Fires when the shadow monitor's posterior would promote a challenger"
            checked={alertOnPromotion}
            onChange={setAlertOnPromotion}
          />
          <Toggle
            label="Stop-price breach"
            hint="Any position where the market touched or crossed your stop"
            checked={alertOnStopBreach}
            onChange={setAlertOnStopBreach}
          />
          <Toggle
            label="Portfolio concentration warning"
            hint="Aggregate name weight or Herfindahl exceeds threshold"
            checked={alertOnConcentration}
            onChange={setAlertOnConcentration}
          />
        </CardContent>
      </Card>

      <p className="pt-2 font-mono text-[11px] text-on-surface-variant">
        These toggles are UI-only during Week 2. Persistence lands with the
        notification-prefs Prisma model.
      </p>
    </div>
  );
}

// -- Toggle primitive --------------------------------------------------------

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-sm text-on-surface">{label}</span>
        {hint && (
          <span className="mt-0.5 block font-mono text-[11px] text-on-surface-variant">
            {hint}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          checked ? "bg-primary" : "bg-surface-high",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-on-primary transition-transform",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
    </label>
  );
}
