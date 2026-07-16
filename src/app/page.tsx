// Marketing homepage.
//
// Server component. Anti-gamification stance is intentional and central
// to the brand — every section either reinforces that or gets cut.
// Per UIUX-PLAN.md §4.1 / Week 8:
//   1. Hero: system-status ping + short pitch + two CTAs
//   2. Static "live opportunity" preview (real live feed lands after
//      /api/scan is opened to anonymous callers with redaction)
//   3. Anti-gamification manifesto — what we do and don't do
//   4. Three method cards citing the actual quant math
//   5. Two-tier pricing anchor (Free / Paid — Paid deferred to /billing)
//   6. Small footer with methodology + terms links

import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col bg-surface-lowest">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-30" />

      {/* Header — sticky */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-surface-lowest/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between px-6 sm:px-12">
          <div className="flex items-center gap-2">
            <span className="led-pulse h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="font-sans text-[15px] font-semibold tracking-tight text-on-surface">
              JuniperFin
            </span>
          </div>
          <nav className="flex items-center gap-6 font-mono text-[12px]">
            <Link
              href="/login"
              className="text-on-surface-variant transition hover:text-on-surface"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-8 items-center rounded bg-primary px-3 font-semibold text-on-primary transition hover:bg-primary-bright"
            >
              Try demo →
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-col justify-center px-6 pt-28 pb-20 sm:px-12">
        <div className="flex items-center gap-3">
          <span className="led-pulse h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="label-caps font-mono">System Status — Online</span>
        </div>

        <h1 className="mt-8 max-w-3xl font-sans text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Signal-grade tools.
          <br />
          <span className="text-on-surface-variant">
            For the trader who reads.
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-7 text-on-surface-variant">
          After-cost decisions on 600 US large-caps, every 15 seconds. We
          show you what the model would do — you take the trade.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/dashboard"
            className="emerald-glow inline-flex h-11 items-center rounded bg-primary px-5 font-mono text-sm font-semibold text-on-primary transition hover:bg-primary-bright"
          >
            Open scanner
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center rounded border border-border px-5 font-mono text-sm text-on-surface transition hover:border-primary hover:text-primary"
          >
            Sign in
          </Link>
        </div>

        {/* Preview tile — a static mock of the scanner. Real live feed
            comes online once /api/scan is opened to anonymous callers
            with redaction (Week 8+). */}
        <div className="mt-16 overflow-hidden rounded-lg border border-border bg-surface-low font-mono text-[12px] shadow-lg">
          <div className="flex items-center justify-between border-b border-border bg-surface-lowest px-4 py-2">
            <span className="label-caps">Scanner · 5d</span>
            <span className="text-[10px] uppercase tracking-widest text-primary">
              live preview
            </span>
          </div>
          <ul className="divide-y divide-border">
            {[
              { sym: "▂▃▄▅", role: "primary",   dec: "BUY",  net: "+43", conf: 4, tone: "text-success" },
              { sym: "▂▃▄▅", role: "primary",   dec: "BUY",  net: "+38", conf: 3, tone: "text-success" },
              { sym: "▂▃▄▅", role: "secondary", dec: "BUY",  net: "+21", conf: 3, tone: "text-success" },
              { sym: "▂▃▄▅", role: "primary",   dec: "WAIT", net: "+12", conf: 2, tone: "text-tertiary" },
              { sym: "▂▃▄▅", role: "retained",  dec: "HOLD", net:  "−4", conf: 1, tone: "text-on-surface-variant" },
            ].map((r, i) => (
              <li key={i} className="grid grid-cols-6 items-center gap-3 px-4 py-2.5">
                <span className="col-span-2 flex items-center gap-2 tabular-nums text-on-surface-variant">
                  <span className="font-mono text-primary">{r.sym}</span>
                  <span className="text-[10px] uppercase tracking-wider">
                    {r.role}
                  </span>
                </span>
                <span className={`col-span-2 tabular-nums ${r.tone}`}>
                  {r.dec}
                </span>
                <span className="col-span-1 text-right tabular-nums text-on-surface">
                  {r.net} bps
                </span>
                <span className="col-span-1 flex justify-end gap-0.5">
                  {[0, 1, 2, 3].map((j) => (
                    <span
                      key={j}
                      className={`h-1.5 w-1.5 rounded-full ${
                        j < r.conf ? "bg-primary" : "bg-surface-high"
                      }`}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border bg-surface-lowest px-4 py-2 text-[10px] text-on-surface-variant">
            Symbols redacted in preview · Sign in to see live decisions
          </div>
        </div>
      </section>

      {/* Anti-gamification section */}
      <section className="relative z-10 border-y border-border/60 bg-surface-lowest">
        <div className="mx-auto grid w-full max-w-[1280px] gap-16 px-6 py-24 sm:px-12 md:grid-cols-2">
          <div>
            <div className="label-caps font-mono">What we don&apos;t do</div>
            <ul className="mt-4 space-y-3 font-mono text-sm text-on-surface-variant">
              <Cross>Confetti when you win</Cross>
              <Cross>Meme stocks pushed to you</Cross>
              <Cross>Push notifications on price</Cross>
              <Cross>Order flow sold to HFTs</Cross>
              <Cross>Streaks, badges, engagement loops</Cross>
            </ul>
          </div>
          <div>
            <div className="label-caps font-mono">What we do</div>
            <ul className="mt-4 space-y-3 font-mono text-sm text-on-surface">
              <Check>After-cost signal (spread + impact + adverse-selection)</Check>
              <Check>3d / 5d / 10d horizons — pick your own risk profile</Check>
              <Check>Shadow-A/B tested model updates before they ship</Check>
              <Check>Open methodology — every constant is defensible</Check>
              <Check>An explanation of every decision, one hover away</Check>
            </ul>
          </div>
        </div>
      </section>

      {/* Method cards */}
      <section className="relative z-10 mx-auto w-full max-w-[1280px] px-6 py-24 sm:px-12">
        <div className="mb-10">
          <div className="label-caps font-mono">Under the hood</div>
          <h2 className="mt-2 max-w-2xl font-sans text-3xl font-semibold tracking-tight">
            Every constant is a citation.
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <MethodCard
            title="Cross-sectional signal"
            body="Four families (Momentum, Quality, Liquidity, Risk) ranked cross-sectionally at every scan. Same math as Grinold & Kahn — not a black-box booster."
            cite="Grinold-Kahn 2000; Green/Hand/Zhang 2017"
          />
          <MethodCard
            title="After-cost gate"
            body="Bouchaud square-root impact + Roll spread + Glosten-Milgrom adverse-selection — subtracted from the signal before you see it."
            cite="Bouchaud 2018; Roll 1984; Glosten-Milgrom 1985"
          />
          <MethodCard
            title="A/B tested model"
            body="Every hyperparameter change runs as a shadow challenger with Deflated Sharpe + PBO before promotion. No shipping on gut."
            cite="Bailey/López de Prado 2014; Bailey et al. 2017 JCF"
          />
        </div>
      </section>

      {/* Pricing anchor */}
      <section className="relative z-10 border-t border-border/60 bg-surface-lowest">
        <div className="mx-auto w-full max-w-[1280px] px-6 py-24 sm:px-12">
          <div className="mb-10">
            <div className="label-caps font-mono">Pricing</div>
            <h2 className="mt-2 max-w-2xl font-sans text-3xl font-semibold tracking-tight">
              One tier. No gates on the model.
            </h2>
            <p className="mt-3 max-w-xl font-mono text-sm text-on-surface-variant">
              While the product is in beta, everyone gets the paid feature
              set. When we ship pricing, the model itself stays available at
              the free tier.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <PriceCard
              title="Free"
              bullets={[
                "Watch mode — scanner output at 15-min delay",
                "Read /methodology in full",
                "No portfolio overlay",
                "No API access",
              ]}
            />
            <PriceCard
              title="Paid"
              bullets={[
                "Live scanner at 15-second updates",
                "Portfolio overlay + risk summary",
                "Alerts + email digest",
                "Programmatic API access",
              ]}
              featured
            />
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center rounded bg-primary px-5 font-mono text-sm font-semibold text-on-primary transition hover:bg-primary-bright"
            >
              Get started
            </Link>
            <span className="font-mono text-[11px] text-on-surface-variant">
              No credit card required during beta.
            </span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/60">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-4 px-6 py-6 font-mono text-[11px] text-on-surface-variant sm:px-12">
          <span>© 2026 JuniperFin</span>
          <nav className="flex flex-wrap gap-4">
            <Link href="/dashboard" className="hover:text-on-surface">Scanner</Link>
            <Link href="/login" className="hover:text-on-surface">Sign in</Link>
            <span aria-disabled className="opacity-50">Methodology</span>
            <span aria-disabled className="opacity-50">Security</span>
            <span aria-disabled className="opacity-50">Terms</span>
          </nav>
        </div>
      </footer>
    </main>
  );
}

// -- Sub-components ----------------------------------------------------------

function Cross({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span aria-hidden="true" className="text-error">✗</span>
      <span>{children}</span>
    </li>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span aria-hidden="true" className="text-primary">✓</span>
      <span>{children}</span>
    </li>
  );
}

function MethodCard({
  title,
  body,
  cite,
}: {
  title: string;
  body: string;
  cite: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-low p-6">
      <h3 className="font-sans text-lg font-semibold text-on-surface">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-on-surface-variant">{body}</p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-primary/80">
        {cite}
      </p>
    </div>
  );
}

function PriceCard({
  title,
  bullets,
  featured,
}: {
  title: string;
  bullets: string[];
  featured?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-6 ${
        featured
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-surface-low"
      }`}
    >
      <h3 className="font-sans text-2xl font-semibold text-on-surface">
        {title}
      </h3>
      <ul className="mt-5 space-y-2 font-mono text-sm text-on-surface-variant">
        {bullets.map((b) => (
          <li key={b} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="text-primary">·</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
