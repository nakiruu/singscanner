// Learn — methodology docs index. Public /learn as a marketing-and-trust
// investment; every JuniperFin constant is a citation, this is where those
// citations get their own pages.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Article {
  slug: string;
  title: string;
  synopsis: string;
  tag: "gate" | "signal" | "shadow" | "portfolio";
}

const ARTICLES: readonly Article[] = [
  {
    slug: "after-cost-gate",
    title: "The after-cost gate — why we subtract friction before you see it",
    synopsis:
      "Spec §59 decomposition: signal edge minus (spread + impact + adverse-selection + queue + memory + concentration) equals what actually lands in your account.",
    tag: "gate",
  },
  {
    slug: "deflated-sharpe",
    title: "Deflated Sharpe — why a 2.0 Sharpe on a config sweep isn't 2.0",
    synopsis:
      "Bailey & López de Prado 2014: the winning config in a grid search inflates observed Sharpe. Every promotion here clears a DSR-adjusted floor.",
    tag: "shadow",
  },
  {
    slug: "shadow-monitor",
    title: "Shadow monitor — how the challenger earns its promotion",
    synopsis:
      "Beta-shrinkage posterior + peeking correction + PBO. No model update ships without clearing all three.",
    tag: "shadow",
  },
  {
    slug: "signal-families",
    title: "Signal families — Momentum, Quality, Liquidity, Risk",
    synopsis:
      "Cross-sectional percentile ranks per family, Grinold & Kahn 2000 style. Composite weights are horizon-conditional but hand-tuned — no black-box booster.",
    tag: "signal",
  },
  {
    slug: "square-root-impact",
    title: "The square-root impact law — Bouchaud et al. 2018",
    synopsis:
      "Why the impact term inside the gate scales with √(order size / ADV). What SQRT_IMPACT_COEFF actually means and how we're recalibrating it.",
    tag: "gate",
  },
  {
    slug: "hard-caps-vs-soft-caps",
    title: "Hard caps vs soft caps — why we ship both",
    synopsis:
      "MacLean/Thorp/Ziemba 2011 practitioner Kelly ceiling: 10% hard cap per name + a soft comfortableWeight penalty above 35%. Two layers, one philosophy.",
    tag: "portfolio",
  },
];

const TAG_COLORS: Record<Article["tag"], string> = {
  gate: "border-primary/40 bg-primary/5 text-primary",
  signal: "border-tertiary/40 bg-tertiary/5 text-tertiary",
  shadow: "border-success/40 bg-success/5 text-success",
  portfolio: "border-outline/40 bg-surface-high text-on-surface",
};

export default function LearnIndex() {
  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-8 p-6">
      <div>
        <h1 className="font-sans text-3xl font-semibold tracking-tight">Learn</h1>
        <p className="mt-2 max-w-2xl font-mono text-sm text-on-surface-variant">
          The math behind every decision the scanner surfaces. Every constant
          in the code cites a paper here.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {ARTICLES.map((a) => (
          <li key={a.slug}>
            <Link href={`/learn/${a.slug}`} className="block">
              <Card className="h-full transition hover:border-primary/60">
                <CardContent className="flex flex-col gap-3 pt-5">
                  <span
                    className={`inline-flex w-fit rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${TAG_COLORS[a.tag]}`}
                  >
                    {a.tag}
                  </span>
                  <h2 className="font-sans text-base font-semibold text-on-surface">
                    {a.title}
                  </h2>
                  <p className="text-sm leading-6 text-on-surface-variant">
                    {a.synopsis}
                  </p>
                  <span className="mt-auto inline-flex items-center gap-1 font-mono text-[11px] text-primary">
                    Read
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-border bg-surface-low p-6">
        <div className="label-caps font-mono">Coming next</div>
        <ul className="mt-3 space-y-1 font-mono text-[12px] text-on-surface-variant">
          <li>· Purged rolling-origin CV — why random K-fold overstates skill</li>
          <li>· Effective breadth — Narang 2013 correction for signal correlation</li>
          <li>· Cross-horizon concentration — why the 3-lane aggregate matters</li>
          <li>· Transfer Coefficient — the piece Grinold-Kahn IR usually skips</li>
        </ul>
      </div>
    </div>
  );
}
