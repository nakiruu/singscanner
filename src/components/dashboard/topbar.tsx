import { Bell } from "lucide-react";

export function Topbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface-lowest/80 px-6 backdrop-blur">
      <div className="flex items-center gap-4">
        <h1 className="font-sans text-xl font-semibold text-on-surface">
          Singularity Scanner
        </h1>
        <span className="flex items-center gap-2">
          <span className="label-caps">Horizon:</span>
          <span className="inline-flex items-center rounded-md border border-border bg-surface-low px-2 py-0.5 font-mono text-xs font-semibold text-on-surface">
            5d
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Notifications"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
        >
          <Bell className="h-4 w-4" />
        </button>
        <span
          aria-label="Profile"
          className="inline-block h-8 w-8 rounded-full bg-primary"
        />
      </div>
    </header>
  );
}
