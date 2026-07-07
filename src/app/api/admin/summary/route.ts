// Admin dashboard summary endpoint. Session-gated to ADMIN only.
// Server-side cache: 10s TTL to protect CH from multi-tab hammering.
// Spec: docs/superpowers/specs/2026-07-07-admin-dashboard-design.md

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAlpacaSuccessRate, getScanLatencyP95 } from "@/lib/data/metrics";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10_000;
let cache: { payload: AdminSummary; ts: number } | null = null;

// -- Shape shared with the client ---------------------------------------------
export interface AdminSummary {
  generatedAt: string;
  signal: {
    latestSnapshotAt: string | null;
    roleSplit: { primary: number; secondary: number; none: number; retained: number };
    pupHistogram: Array<{ bucket: number; n: number }>;
    topStars: Array<{ symbol: string; role: string; net: number; pUp: number }>;
    primaryCountSpark: Array<{ ts: string; n: number }>;
  };
  pipeline: {
    alpacaSuccess1h: number;
    fundamentalsCacheHit: number | null;
    chBars24h: number;
    chScanRows24h: number;
    scanP95Ms: number;
  };
  business: {
    totalUsers: number;
    usersByRole: { USER: number; PREMIUM: number; ADMIN: number };
    signups7d: number;
    recentSignups: Array<{ id: string; email: string; role: string; createdAt: string }>;
    mrrStub: number;
  };
}

// -- Lazy CH client (fail-open if URL unset) ---------------------------------
let chClient: ReturnType<typeof createClient> | null = null;
let chInit = false;
function getCh(): ReturnType<typeof createClient> | null {
  if (chInit) return chClient;
  chInit = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    chClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
    });
    return chClient;
  } catch {
    return null;
  }
}

async function chJson<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const c = getCh();
  if (!c) return [];
  try {
    const rs = await c.query({ query: sql, query_params: params ?? {}, format: "JSONEachRow" });
    return (await rs.json()) as T[];
  } catch (err) {
    console.warn("[admin/summary] CH query failed:", err);
    return [];
  }
}

// -- Section fetchers --------------------------------------------------------

async function fetchSignal() {
  const [latestRow] = await chJson<{ latest: string | null }>(
    `SELECT toString(max(generated_at)) AS latest FROM scan_snapshots`,
  );
  const latestSnapshotAt = latestRow?.latest ?? null;

  const roleRows = await chJson<{ role: string; n: number }>(
    `SELECT role, count() AS n FROM scan_rows
     WHERE generated_at = (SELECT max(generated_at) FROM scan_rows)
     GROUP BY role`,
  );
  const roleSplit = { primary: 0, secondary: 0, none: 0, retained: 0 };
  for (const r of roleRows) {
    if (r.role === "primary" || r.role === "secondary" || r.role === "none" || r.role === "retained") {
      roleSplit[r.role] = Number(r.n);
    }
  }

  const pupHistogram = await chJson<{ bucket: number; n: number }>(
    `SELECT round(p_up, 2) AS bucket, count() AS n
     FROM scan_rows
     WHERE generated_at = (SELECT max(generated_at) FROM scan_rows)
       AND role = 'primary'
     GROUP BY bucket
     ORDER BY bucket`,
  );

  const topStars = await chJson<{ symbol: string; role: string; net: number; pUp: number }>(
    `SELECT symbol, role, net, p_up AS pUp
     FROM scan_rows
     WHERE decision = 'BUY' AND star = 1
       AND generated_at = (SELECT max(generated_at) FROM scan_rows)
     ORDER BY net DESC
     LIMIT 5`,
  );

  const primaryCountSpark = await chJson<{ ts: string; n: number }>(
    `SELECT toString(generated_at) AS ts, countIf(role = 'primary') AS n
     FROM scan_rows
     WHERE generated_at >= now() - INTERVAL 1 HOUR
     GROUP BY generated_at
     ORDER BY generated_at`,
  );

  return { latestSnapshotAt, roleSplit, pupHistogram, topStars, primaryCountSpark };
}

async function fetchPipeline() {
  const [barsRow] = await chJson<{ n: number }>(
    `SELECT count() AS n FROM bars WHERE ts >= now() - INTERVAL 24 HOUR`,
  );
  const [scanRow] = await chJson<{ n: number }>(
    `SELECT count() AS n FROM scan_rows WHERE generated_at >= now() - INTERVAL 24 HOUR`,
  );
  return {
    alpacaSuccess1h: getAlpacaSuccessRate(),
    fundamentalsCacheHit: null, // Populated when sidecar /stats exists — see spec §Deferred.
    chBars24h: Number(barsRow?.n ?? 0),
    chScanRows24h: Number(scanRow?.n ?? 0),
    scanP95Ms: getScanLatencyP95(),
  };
}

async function fetchBusiness() {
  const [totalUsers, roleGroups, signups7d, recentSignups] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, email: true, role: true, createdAt: true },
    }),
  ]);
  const usersByRole = { USER: 0, PREMIUM: 0, ADMIN: 0 };
  for (const g of roleGroups) {
    const key = g.role as string as keyof typeof usersByRole;
    if (key in usersByRole) usersByRole[key] = g._count._all;
  }
  return {
    totalUsers,
    usersByRole,
    signups7d,
    recentSignups: recentSignups.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    mrrStub: usersByRole.PREMIUM * 19,
  };
}

// -- Route handler -----------------------------------------------------------
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  const [signal, pipeline, business] = await Promise.all([
    fetchSignal(),
    fetchPipeline(),
    fetchBusiness(),
  ]);
  const payload: AdminSummary = {
    generatedAt: new Date().toISOString(),
    signal,
    pipeline,
    business,
  };
  cache = { payload, ts: Date.now() };
  return NextResponse.json(payload);
}
