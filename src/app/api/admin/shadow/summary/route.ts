import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBacklogProgress, getMonitor } from "@/lib/shadow";
import {
  countResolvedHistorical,
  queryResolvedForPosterior,
} from "@/lib/shadow/persistence";
import { computePosterior, type Posterior } from "@/lib/shadow/posterior";

export const dynamic = "force-dynamic";

export interface ShadowSummary {
  generatedAt: string;
  perHorizon: Array<{
    horizon: "3d" | "5d" | "10d";
    posterior_live: Posterior;
    posterior_all: Posterior;
    backlogStatus: "not-started" | "running" | "done";
    backlogSamples: number;
    pendingCount: number;
  }>;
}

const CACHE_TTL_MS = 10_000;
let cache: { payload: ShadowSummary; ts: number } | null = null;

const HORIZONS = ["3d", "5d", "10d"] as const;

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Auth checked above — safe to serve cached payload without re-verifying.
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  const perHorizon = await Promise.all(
    HORIZONS.map(async (h) => {
      const [liveRows, allRows, backlogSamples, prog] = await Promise.all([
        queryResolvedForPosterior(h, "live"),
        queryResolvedForPosterior(h, "all"),
        countResolvedHistorical(h),
        Promise.resolve(getBacklogProgress(h)),
      ]);
      const status: "not-started" | "running" | "done" = prog.running
        ? "running"
        : backlogSamples > 0
          ? "done"
          : "not-started";
      return {
        horizon: h,
        posterior_live: computePosterior(liveRows, {}, h),
        posterior_all: computePosterior(allRows, {}, h),
        backlogStatus: status,
        backlogSamples,
        pendingCount: getMonitor(h) ? 0 : 0, // placeholder; real pending count computed in detail route
      };
    }),
  );

  const payload: ShadowSummary = {
    generatedAt: new Date().toISOString(),
    perHorizon,
  };
  cache = { payload, ts: Date.now() };
  return NextResponse.json(payload);
}
