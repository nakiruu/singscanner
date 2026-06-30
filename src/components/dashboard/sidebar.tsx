"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Cog,
  FileText,
  Radar,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "Scanner", icon: Radar },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/pipeline", label: "Pipeline", icon: FileText },
  { href: "/settings", label: "Settings", icon: Cog },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-surface-lowest">
      <div className="flex items-start gap-3 border-b border-border px-5 py-5">
        <span className="led-pulse mt-1.5 inline-block h-3 w-1 rounded-sm bg-primary" />
        <div className="flex flex-col">
          <span className="font-sans text-lg font-semibold text-on-surface">Singularity</span>
          <span className="label-caps mt-0.5 text-on-surface-variant">Scan Engine Active</span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-border px-3 py-4">
        <Button variant="primary" size="md" className="w-full">
          <Zap className="h-4 w-4" />
          Active Scan
        </Button>
        <div className="flex items-center gap-2 px-2 font-mono text-xs text-on-surface-variant">
          <span className="led-pulse h-2 w-2 rounded-full bg-primary" />
          <span>Engine Status: Online</span>
        </div>
      </div>
    </aside>
  );
}
