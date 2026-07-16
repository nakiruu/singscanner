// Individual /learn article page. Static content keyed by slug; adding a
// new article requires adding an entry to ARTICLES + rendering. When the
// docs corpus grows past ~20 articles, migrate to MDX with a content
// pipeline. For now the inline JSX keeps the surface area tiny.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Article {
  slug: string;
  title: string;
  tag: string;
  body: React.ReactNode;
  citations: readonly Citation[];
}

interface Citation {
  ref: string;
  href?: string;
}

const ARTICLES: Record<string, Article> = {
  "after-cost-gate": {
    slug: "after-cost-gate",
    title: "The after-cost gate — why we subtract friction before you see it",
    tag: "gate",
    body: (
      <>
        <Para>
          Every scanner shows a raw &quot;signal.&quot; The question a trader
          actually has is: <em>what does this look like after I pay to enter,
          hold, and exit?</em> That answer is buried behind a spread, a
          liquidity impact, and an adverse-selection component that most
          tools never explicitly model.
        </Para>
        <Para>
          The JuniperFin gate splits every decision into six terms:
        </Para>
        <List>
          <li><Mono>model edge</Mono> — the family-rank composite forecast in bps</li>
          <li><Mono>c<sub>Entry</sub></Mono> — spread + queue on the entry leg</li>
          <li><Mono>c<sub>Exit</sub></Mono> — reserved exit cost (0.65 legacy haircut OR explicit half-spread + adverse-selection + half-impact)</li>
          <li><Mono>c<sub>Queue</sub></Mono> — stale-quote decay per Aquilina-Budish 2022</li>
          <li><Mono>c<sub>Memory</sub></Mono> — same-ticker reversal cost, decayed over horizon</li>
          <li><Mono>c<sub>Concentration</sub></Mono> — bps penalty from the portfolio-aware layer</li>
        </List>
        <Para>
          <strong>Net = modelEdge − Σcosts.</strong> When net &gt; minHurdle,
          BUY. When negative and you&apos;re a qualifying member of the
          long-side cohort, WAIT. Otherwise HOLD-CASH. The scanner never
          shows you a &quot;great signal&quot; if the after-cost math
          doesn&apos;t survive.
        </Para>
      </>
    ),
    citations: [
      { ref: "Roll (1984) — A simple implicit measure of the effective bid-ask spread. Journal of Finance." },
      { ref: "Bouchaud et al. (2018) — Trades, Quotes and Prices, ch. 12." },
      { ref: "Glosten & Milgrom (1985) — Bid, ask, and transaction prices. JFE." },
      { ref: "Kissell (2013) — The Science of Algorithmic Trading, ch. 5." },
    ],
  },
  "deflated-sharpe": {
    slug: "deflated-sharpe",
    title: "Deflated Sharpe — why a 2.0 Sharpe on a config sweep isn't 2.0",
    tag: "shadow",
    body: (
      <>
        <Para>
          The Sharpe ratio is a t-statistic for &quot;is this strategy&apos;s
          mean return greater than zero.&quot; If you run 100 hyperparameter
          configurations and pick the best, the winning config&apos;s
          observed Sharpe is inflated — because you selected on the noisy
          maximum of 100 draws.
        </Para>
        <Para>
          Bailey & López de Prado (2014) formalize this. The <em>Deflated
          Sharpe Ratio</em> corrects the observed Sharpe by the expected
          maximum from N pure-noise trials:
        </Para>
        <Code>
          DSR = (Sharpe − E[max_null]) / SD[max_null]
        </Code>
        <Para>
          Empirically, DSR-adjusted p-values run 5-30× larger than the naive
          version (Harvey/Liu/Zhu 2016). At JuniperFin, the shadow-monitor
          promotion decision gates on DSR before the challenger goes
          live — so a raw +5 bps posterior isn&apos;t enough. You have to
          clear the search-corrected floor.
        </Para>
      </>
    ),
    citations: [
      { ref: "Bailey & López de Prado (2014) — The Deflated Sharpe Ratio. JPM 40(5)." },
      { ref: "Harvey, Liu & Zhu (2016) — …and the cross-section of expected returns. RFS." },
    ],
  },
  "shadow-monitor": {
    slug: "shadow-monitor",
    title: "Shadow monitor — how the challenger earns its promotion",
    tag: "shadow",
    body: (
      <>
        <Para>
          Every model change ships behind a shadow-A/B loop. The current
          baseline gates rows into decisions. A challenger — a proposed
          model change — runs in parallel and scores the same rows.
        </Para>
        <Para>
          When decisions disagree OR nets diverge past NET_DIVERGENCE_BPS,
          we insert a &quot;pending&quot; row. When the forward-return
          window closes, we compute the realized Δnet_bps and add it to
          the challenger&apos;s posterior.
        </Para>
        <Para>
          Promotion requires three independent checks:
        </Para>
        <List>
          <li>Beta-shrinkage posterior on δ_post_bps clears the mean floor</li>
          <li>DSR-adjusted uplift clears the search-corrected significance bar (see /learn/deflated-sharpe)</li>
          <li>k-consecutive-cycles peeking correction: the posterior clears in ≥ k rounds separated by minimum time-spacing (Johari et al. 2017 — continuous peeking inflates 5% type-I to 20-40%)</li>
        </List>
        <Para>
          Zero of the three gates is enough. All three must pass.
        </Para>
      </>
    ),
    citations: [
      { ref: "Gelman et al. (2013) — Bayesian Data Analysis, ch. 3." },
      { ref: "Johari, Koomen, Pekelis & Walsh (2017) — Peeking at A/B tests. KDD." },
      { ref: "Kohavi et al. (2013) — Online controlled experiments at large scale. KDD." },
    ],
  },
  "signal-families": {
    slug: "signal-families",
    title: "Signal families — Momentum, Quality, Liquidity, Risk",
    tag: "signal",
    body: (
      <>
        <Para>
          Every symbol gets four scores, each in [0, 100]. The scores are
          cross-sectional percentile ranks — so &quot;Momentum: 78&quot;
          means &quot;this name ranks in the 78th percentile of momentum
          across today&apos;s universe.&quot;
        </Para>
        <List>
          <li><Mono>Momentum</Mono> — 3d/5d/10d/21d/63d/126d returns, trend slope, price/SMA50, price/60d-high, acceleration, volume ratio</li>
          <li><Mono>Quality</Mono> — revenue growth, earnings growth, profit margin, ROE, inverted debt-to-equity, inverted forward P/E</li>
          <li><Mono>Liquidity</Mono> — tight spread + dollar volume + log-scaled relative volume (+ Amihud ILLIQ when enabled)</li>
          <li><Mono>Risk</Mono> — inverted realized vol + inverted absolute beta + 60d drawdown</li>
        </List>
        <Para>
          The composite is a horizon-conditional weighted average
          (Grinold-Kahn 2000 style). Weights lerp with horizon: short holds
          weight Momentum + Liquidity higher; long holds weight Quality
          higher.
        </Para>
      </>
    ),
    citations: [
      { ref: "Grinold & Kahn (2000) — Active Portfolio Management, ch. 6." },
      { ref: "Green, Hand & Zhang (2017) — The characteristics that provide independent information. RFS." },
      { ref: "Amihud (2002) — Illiquidity and stock returns. J. Financial Markets." },
    ],
  },
  "square-root-impact": {
    slug: "square-root-impact",
    title: "The square-root impact law — Bouchaud et al. 2018",
    tag: "gate",
    body: (
      <>
        <Para>
          When you buy a stock, the price moves against you. The magnitude
          of that move scales with the square root of your order size
          divided by the average daily volume:
        </Para>
        <Code>
          Impact ≈ Y · σ · √(Q / ADV) · 10_000  bps
        </Code>
        <Para>
          Where Y is a market-dependent coefficient (typically 0.5-1.5),
          σ is daily volatility, Q is trade size, ADV is average daily
          volume. This is the &quot;square-root impact law&quot; — a
          canonical empirical relationship from Bouchaud and collaborators.
        </Para>
        <Para>
          Inside the gate, C_liq encodes this term. The coefficient is
          currently configured via <Mono>GATE_SQRT_IMPACT_COEFF</Mono>
          (legacy 9; recalibrated target 25 pending TCA panel evidence).
          Ship the recal in isolation — mixing it with session-multiplier
          changes makes paper-vs-live attribution impossible.
        </Para>
      </>
    ),
    citations: [
      { ref: "Bouchaud et al. (2018) — Trades, Quotes and Prices, ch. 12." },
      { ref: "Kissell (2013) — The Science of Algorithmic Trading, ch. 6." },
      { ref: "Frazzini, Israel & Moskowitz (2018) — Trading costs. AQR." },
    ],
  },
  "hard-caps-vs-soft-caps": {
    slug: "hard-caps-vs-soft-caps",
    title: "Hard caps vs soft caps — why we ship both",
    tag: "portfolio",
    body: (
      <>
        <Para>
          The portfolio builder applies two separate caps to any single
          name:
        </Para>
        <List>
          <li><Mono>maxNameWeight = 0.10</Mono> — a HARD cap. Weight is clipped and overflow water-fills into uncapped names. This is the tail-risk containment layer.</li>
          <li><Mono>comfortableWeight = 0.35</Mono> — a SOFT cap. Above this, a concentrationBps penalty is subtracted from the gate&apos;s net edge (~300 bps per unit squared overweight).</li>
        </List>
        <Para>
          Why both? The hard cap prevents disasters — MacLean/Thorp/Ziemba
          (2011) put the practitioner Kelly ceiling at 3-5% NAV; 10% is
          double that, still bounded. The soft cap lets a strong signal
          overweight a name up to a point, but pays for it in the gate
          math. It&apos;s the difference between &quot;impossible&quot;
          and &quot;expensive.&quot;
        </Para>
        <Para>
          The cross-horizon aggregator adds a THIRD layer: an aggregate
          hard cap of 0.15 across all lanes for the same symbol,
          preventing a name that&apos;s primary in 5d AND 10d from
          silently carrying 0.30+ NAV.
        </Para>
      </>
    ),
    citations: [
      { ref: "MacLean, Thorp & Ziemba (2011) — The Kelly Capital Growth Investment Criterion." },
      { ref: "Grinold & Kahn (2000) — Active Portfolio Management, ch. 15." },
      { ref: "DeMiguel, Garlappi & Uppal (2009) — Optimal versus naive diversification. RFS." },
    ],
  },
};

const TAG_COLORS: Record<string, string> = {
  gate: "border-primary/40 bg-primary/5 text-primary",
  signal: "border-tertiary/40 bg-tertiary/5 text-tertiary",
  shadow: "border-success/40 bg-success/5 text-success",
  portfolio: "border-outline/40 bg-surface-high text-on-surface",
};

// Next 15 async params.
export default async function LearnArticle({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = ARTICLES[slug];
  if (!article) notFound();

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6 p-6">
      <Link
        href="/learn"
        className="inline-flex items-center gap-2 font-mono text-[12px] text-on-surface-variant transition hover:text-on-surface"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All articles
      </Link>

      <div>
        <span
          className={`inline-flex rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${TAG_COLORS[article.tag] ?? ""}`}
        >
          {article.tag}
        </span>
        <h1 className="mt-3 font-sans text-3xl font-semibold tracking-tight leading-snug">
          {article.title}
        </h1>
      </div>

      <div className="space-y-4 text-[15px] leading-7 text-on-surface">
        {article.body}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>References</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 font-mono text-[12px] text-on-surface-variant">
            {article.citations.map((c) => (
              <li key={c.ref} className="flex items-start gap-2">
                <span aria-hidden="true">·</span>
                {c.href ? (
                  <a
                    href={c.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {c.ref}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>{c.ref}</span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// -- Content primitives -----------------------------------------------------

function Para({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-2 pl-4 [&>li]:list-disc [&>li]:pl-1 [&>li]:marker:text-on-surface-variant">
      {children}
    </ul>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-low px-1 py-0.5 font-mono text-[13px] text-on-surface">
      {children}
    </code>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded border border-border bg-surface-low p-4 font-mono text-[13px] text-on-surface">
      <code>{children}</code>
    </pre>
  );
}
