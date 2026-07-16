// Two-column settings shell. Vertical nav on the left, content on the right.
// Matches the pattern proposed in UIUX-PLAN.md §4.6.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  User,
  KeyRound,
  Bell,
  Wallet,
  CreditCard,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/settings/profile",        label: "Profile",       icon: User },
  { href: "/settings/account",        label: "Account",       icon: KeyRound },
  { href: "/settings/notifications",  label: "Notifications", icon: Bell },
  { href: "/settings/brokerage",      label: "Brokerage",     icon: Wallet },
  { href: "/settings/billing",        label: "Billing",       icon: CreditCard },
  { href: "/settings/api-keys",       label: "API keys",      icon: Terminal },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex w-full max-w-[1180px] gap-6 p-6">
      {/* Nav column */}
      <aside className="w-56 shrink-0">
        <h1 className="mb-4 px-3 font-sans text-2xl font-semibold text-on-surface">
          Settings
        </h1>
        <nav className="space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-surface-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content column */}
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
