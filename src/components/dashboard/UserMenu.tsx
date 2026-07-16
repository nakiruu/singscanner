// UserMenu — clickable avatar dropdown in the topbar.
//
// Ships as UI-Week-1. Wraps: identity display, quick-nav to settings,
// admin-panel link (role-gated), sign-out. Hand-rolled dropdown with
// click-outside + Escape close — no Radix dependency yet (that primitive
// arrives with the Phase 2 component-library rebuild).

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { signOutAction } from "@/app/actions/auth-actions";
import { cn } from "@/lib/utils";

export interface UserMenuUser {
  name: string | null | undefined;
  email: string | null | undefined;
  image: string | null | undefined;
  role: string | null | undefined;
}

function initialsOf(user: UserMenuUser): string {
  const source = user.name || user.email || "??";
  const parts = source.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function UserMenu({ user }: { user: UserMenuUser }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const isAdmin = user.role === "ADMIN";
  const initials = initialsOf(user);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open user menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center overflow-hidden",
          "rounded-full border border-outline bg-surface-high",
          "font-mono text-[10px] font-semibold text-on-surface",
          "transition hover:border-primary focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-primary",
        )}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-64",
            "rounded-md border border-border bg-surface-lowest shadow-lg",
            "py-1 font-mono text-[12px]",
          )}
        >
          {/* Identity block */}
          <div className="border-b border-border px-3 py-2">
            <div className="truncate text-[13px] font-semibold text-on-surface">
              {user.name ?? "Signed in"}
            </div>
            {user.email && (
              <div className="truncate text-[11px] text-on-surface-variant">
                {user.email}
              </div>
            )}
            {isAdmin && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-sm border border-tertiary/40 bg-tertiary/10 px-1.5 py-px text-[9px] uppercase tracking-wider text-tertiary">
                <ShieldCheck className="h-2.5 w-2.5" /> Admin
              </div>
            )}
          </div>

          {/* Primary nav */}
          <MenuLink href="/settings" icon={<Settings className="h-3.5 w-3.5" />}>
            Settings
          </MenuLink>

          {isAdmin && (
            <MenuLink
              href="/admin"
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
            >
              Admin panel
            </MenuLink>
          )}

          {/* Sign out via server action — matches the login-form pattern. */}
          <div className="border-t border-border pt-1">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5",
                  "text-left text-error/90 transition hover:bg-error/10 hover:text-error",
                )}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        "text-on-surface-variant transition hover:bg-surface-low hover:text-on-surface",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
