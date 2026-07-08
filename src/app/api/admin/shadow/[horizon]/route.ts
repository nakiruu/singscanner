import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMonitor } from "@/lib/shadow";
import {
  queryResolvedForPosterior,
  queryRecentPending,
  queryRecentResolvedLive,
  queryHistoricalDailyDelta,
} from "@/lib/shadow/persistence";
import { computePosterior, type Posterior } from "@/lib/shadow/posterior";

export const dynamic = "force-dynamic";

const HORIZONS = new Set(["3d", "5d", "10d"]);

export interface ShadowDetail {
  horizon: "3d" | "5d" | "10d";
  posterior_live: Posterior;
  posterior_all: Posterior;
  buckets: Array<{ bucket: string; n: number; mean_y_bps: number }>;
  pending: Array<{
    symbol: string; baselineDecision: string; challengerDecision: string;
    baselineNetBps: number; challengerNetBps: number; submittedAt: string;
  }>;
  resolved: Array<{
    symbol: string; delta_bps: number; realized_bps: number;
    baseline_decision: string; challenger_decision: string; resolvedAt: string;
  }>;
  historicalDailyDelta: Array<{ day: string; mean_delta_bps: number; n: number }>;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ horizon: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { horizon } = await params;
  if (!HORIZONS.has(horizon)) {
    return NextResponse.json({ error: "bad horizon" }, { status: 400 });
  }
  const h = horizon as "3d" | "5d" | "10d";
  const [liveRows, allRows, pending, resolved, hist] = await Promise.all([
    queryResolvedForPosterior(h, "live"),
    queryResolvedForPosterior(h, "all"),
    queryRecentPending(h, 20),
    queryRecentResolvedLive(h, 20),
    queryHistoricalDailyDelta(h),
  ]);
  const monitor = getMonitor(h);
  const buckets = monitor ? monitor.getChallenger().status() : [];

  const detail: ShadowDetail = {
    horizon: h,
    posterior_live: computePosterior(liveRows),
    posterior_all: computePosterior(allRows),
    buckets,
    pending: pending.map((p) => ({
      symbol: p.symbol,
      baselineDecision: p.baselineDecision,
      challengerDecision: p.challengerDecision,
      baselineNetBps: p.baselineNetBps,
      challengerNetBps: p.challengerNetBps,
      submittedAt: p.submittedAt,
    })),
    resolved: resolved.map((r) => ({
      symbol: r.symbol,
      delta_bps: r.deltaBps,
      realized_bps: r.realizedBps,
      baseline_decision: r.baselineDecision,
      challenger_decision: r.challengerDecision,
      resolvedAt: r.resolvedAt,
    })),
    historicalDailyDelta: hist,
  };
  return NextResponse.json(detail);
}
