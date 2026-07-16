// Command palette — global ⌘K / Ctrl-K search & navigate.
//
// Hand-rolled to avoid a new dependency (cmdk library would work but
// adds ~4kb + peer-dep footprint we don't currently have). Registry
// currently owns:
//   - Every top-level page (Scanner, Portfolio, Pipeline, Settings tabs,
//     Learn placeholder)
//   - Every symbol in the current scan snapshot (jump to /symbol/{sym}
//     when that route lands in Week 3+; falls back to search for now)
//   - Immediate actions: sign out, toggle theme (theme wiring lands with
//     the design-system PR)
//
// Fuzzy scoring is a simple contains-then-prefix-then-word-boundary
// ranking — no full Fuse.js pull-in. Good enough for a registry under a
// few hundred items; upgrade if the registry grows.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BookOpen,
  Briefcase,
  Cog,
  CreditCard,
  FileText,
  KeyRound,
  LogOut,
  Radar,
  Search,
  ShieldCheck,
  Terminal,
  User,
  Wallet,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth-actions";
import { useScanStream } from "@/lib/hooks/useScanStream";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;   // extra terms for fuzzy match
  icon: React.ComponentType<{ className?: string }>;
  action: () => void | Promise<void>;
}

const STATIC_NAV = (router: ReturnType<typeof useRouter>): CommandItem[] => [
  { id: "nav.scanner",       label: "Scanner",       hint: "/dashboard",         icon: Radar,        action: () => router.push("/dashboard") },
  { id: "nav.portfolio",     label: "Portfolio",     hint: "/portfolio",         icon: Briefcase,    action: () => router.push("/portfolio") },
  { id: "nav.pipeline",      label: "Pipeline",      hint: "/pipeline",          icon: FileText,     action: () => router.push("/pipeline") },
  { id: "nav.settings",      label: "Settings",      hint: "/settings",          icon: Cog,          action: () => router.push("/settings") },
  { id: "nav.profile",       label: "Profile",       hint: "Settings › Profile",       icon: User,       action: () => router.push("/settings/profile") },
  { id: "nav.account",       label: "Account",       hint: "Settings › Account",       icon: KeyRound,   action: () => router.push("/settings/account") },
  { id: "nav.notifications", label: "Notifications", hint: "Settings › Notifications", icon: Bell,       action: () => router.push("/settings/notifications") },
  { id: "nav.brokerage",     label: "Brokerage",     hint: "Settings › Brokerage",     icon: Wallet,     action: () => router.push("/settings/brokerage") },
  { id: "nav.billing",       label: "Billing",       hint: "Settings › Billing",       icon: CreditCard, action: () => router.push("/settings/billing") },
  { id: "nav.api-keys",      label: "API keys",      hint: "Settings › API keys",      icon: Terminal,   action: () => router.push("/settings/api-keys") },
  { id: "nav.admin",         label: "Admin panel",   hint: "/admin",                   icon: ShieldCheck, keywords: "admin ADMIN", action: () => router.push("/admin") },
  { id: "nav.learn",         label: "Learn",         hint: "Coming soon",              icon: BookOpen,   action: () => router.push("/dashboard") },
];

// Contains-then-prefix-then-word-boundary scoring. Higher = better match.
function scoreItem(q: string, haystack: string): number {
  if (!q) return 1;
  const h = haystack.toLowerCase();
  const needle = q.toLowerCase();
  if (h === needle) return 100;
  if (h.startsWith(needle)) return 80;
  // Word-boundary match
  if (new RegExp(`\\b${escapeRegex(needle)}`).test(h)) return 60;
  if (h.includes(needle)) return 40;
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { snapshot } = useScanStream();

  // Global ⌘K / Ctrl-K listener.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Reset query + focus on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Focus after mount.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Build the full item registry each render — cheap, and the snapshot
  // changes reference each cycle so useMemo would thrash without a stable
  // dep. Registry size is bounded by universe cardinality (~600).
  const items = useMemo<CommandItem[]>(() => {
    const staticItems = STATIC_NAV(router);
    const symbolItems: CommandItem[] = snapshot
      ? snapshot.rows.slice(0, 200).map((r) => ({
          id: `symbol.${r.symbol}`,
          label: r.symbol,
          hint: `${r.decision} · net ${r.net.toFixed(1)}bps`,
          keywords: `${r.symbol} symbol ${r.decision}`,
          icon: Search,
          // /symbol/[symbol] route lands in Week 3 or later — for now,
          // opening a symbol just returns to /dashboard so we don't leak
          // a 404.
          action: () => router.push("/dashboard"),
        }))
      : [];
    return [
      ...staticItems,
      { id: "action.signout", label: "Sign out", icon: LogOut, keywords: "logout log out", action: () => signOutAction() },
      ...symbolItems,
    ];
  }, [router, snapshot]);

  // Filter + rank.
  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 40);
    return items
      .map((it) => ({
        item: it,
        score: Math.max(
          scoreItem(query, it.label),
          scoreItem(query, it.keywords ?? ""),
          scoreItem(query, it.hint ?? ""),
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.item);
  }, [items, query]);

  // Keep selectedIdx in bounds after filter shrinks.
  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(0);
  }, [filtered.length, selectedIdx]);

  const runItem = async (it: CommandItem) => {
    setOpen(false);
    await it.action();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" aria-hidden="true" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface-lowest shadow-2xl"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search commands, symbols…"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && filtered[selectedIdx]) {
                e.preventDefault();
                runItem(filtered[selectedIdx]);
              }
            }}
            className="h-11 flex-1 bg-transparent font-mono text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none"
            aria-label="Command search"
          />
          <kbd className="hidden rounded border border-border bg-surface-low px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant sm:inline-flex">
            Esc
          </kbd>
        </div>

        {/* Result list */}
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-center font-mono text-[11px] text-on-surface-variant">
              No matches.
            </li>
          )}
          {filtered.map((it, i) => {
            const Icon = it.icon;
            const active = i === selectedIdx;
            return (
              <li key={it.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => runItem(it)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left",
                    active ? "bg-surface-high" : "bg-transparent",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-on-surface">
                    {it.label}
                  </span>
                  {it.hint && (
                    <span className="truncate font-mono text-[10px] text-on-surface-variant">
                      {it.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 font-mono text-[10px] text-on-surface-variant">
          <span>↑↓ navigate · ↵ open</span>
          <span>⌘K toggles</span>
        </div>
      </div>
    </div>
  );
}
