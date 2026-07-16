"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity as ActivityIcon,
  BookOpen,
  Briefcase,
  Cog,
  Radar,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Scanner",   icon: Radar },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/activity",  label: "Activity",  icon: ActivityIcon },
  { href: "/learn",     label: "Learn",     icon: BookOpen },
  { href: "/settings",  label: "Settings",  icon: Cog },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-surface-lowest">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="inline-block h-3 w-3 rounded-full bg-primary" />
        <span className="font-sans text-[15px] font-semibold tracking-tight text-on-surface">
          JuniperFin
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] transition-colors",
                active
                  ? "bg-surface-high text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-[11px] text-on-surface-variant">
          <span className="led-pulse inline-block h-1.5 w-1.5 rounded-full bg-success" />
          <span>Engine online</span>
        </div>
      </div>
    </aside>
  );
}
