// Auth layout — split-screen with landscape hero on the left.
//
// Per UIUX-PLAN.md §4.2: 40% landscape / 60% form on desktop, form-only on
// mobile. Landscape is a placeholder styled div until the user drops the
// actual Rubens (or chosen alternative) JPG at public/hero/juniper-
// landscape.jpg — at which point the CSS background-image below picks it
// up automatically.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full flex-1">
      {/* Landscape column — hidden below md */}
      <aside
        aria-hidden="true"
        className="hidden md:relative md:block md:w-[40%] md:min-w-[420px]"
        style={{
          // When public/hero/juniper-landscape.jpg exists, this overrides
          // the fallback gradient below. Placed at 50% 40% to keep the
          // painting's horizon just above the vertical center on standard
          // aspect ratios.
          backgroundImage:
            "url('/hero/juniper-landscape.jpg'), " +
            "linear-gradient(135deg, #1a2f24 0%, #2d3d24 45%, #4a3820 100%)",
          backgroundSize: "cover, cover",
          backgroundPosition: "50% 40%, center",
          backgroundRepeat: "no-repeat, no-repeat",
        }}
      >
        {/* Dark gradient overlay to keep the right-column form legible when
            the JPG loads. Left→right so the seam near the split stays
            darker; readable label pinned to the bottom-left. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(0,0,0,0) 60%, rgba(0,0,0,0.55) 100%), " +
              "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 40%)",
          }}
        />
        <div className="absolute bottom-8 left-8 z-10 max-w-xs text-white/85 mix-blend-luminosity">
          <div className="font-mono text-[10px] uppercase tracking-widest text-white/60">
            JuniperFin
          </div>
          <div className="mt-2 font-sans text-[15px] leading-snug">
            Signal-grade tools for the trader who reads.
          </div>
        </div>
      </aside>

      {/* Form column */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-16">
        <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative z-10 w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
