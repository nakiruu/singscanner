export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" />

      <section className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-1 flex-col justify-center px-6 py-32 sm:px-12">
        <div className="flex items-center gap-3">
          <span className="led-pulse h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="label-caps font-mono">System Status — Online</span>
        </div>

        {/* TODO(user): write the hero copy. This is your brand voice moment.
            DESIGN.md frames the product as "observing the machine" for devs/AI engineers.
            Constraints: ~6-10 words for h1, ~20-30 words for the sub. Tight tracking. */}
        <h1 className="mt-8 max-w-2xl font-sans text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
          {/* placeholder */}
          Singularity Scanner
        </h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-on-surface-variant">
          {/* placeholder */}
          A real-time signal layer over the market — momentum, quality, liquidity, and risk,
          ranked cross-sectionally and gated by after-cost edge.
        </p>

        <div className="mt-12 flex gap-4">
          <a
            href="/dashboard"
            className="emerald-glow inline-flex h-11 items-center rounded bg-primary px-5 font-mono text-sm font-semibold text-on-primary transition hover:bg-primary-bright"
          >
            Open Scanner
          </a>
          <a
            href="/login"
            className="inline-flex h-11 items-center rounded border border-border px-5 font-mono text-sm text-on-surface transition hover:border-primary hover:text-primary"
          >
            Sign In
          </a>
        </div>

        <div className="mt-24 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          {[
            { label: "Universe", value: "AUTO" },
            { label: "Horizon", value: "3D" },
            { label: "Engine", value: "TS+ML" },
            { label: "Feed", value: "ALPACA" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-low px-5 py-4">
              <div className="label-caps">{s.label}</div>
              <div className="mt-1 font-mono text-lg text-primary">{s.value}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
