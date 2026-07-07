// Admin activity feed. Mixed sources: CH scans + star transitions + postgres
// signups + in-memory errors. Session-gated to ADMIN only.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getErrors } from "@/lib/data/metrics";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

export type AdminActivityEvent =
  | { id: string; kind: "scan";       ts: string; symbolsScanned: number; primary: number; stars: number }
  | { id: string; kind: "star-in";    ts: string; symbol: string }
  | { id: string; kind: "star-out";   ts: string; symbol: string }
  | { id: string; kind: "signup";     ts: string; userId: string; email: string; role: string }
  | { id: string; kind: "error";      ts: string; errorId: string; errKind: "alpaca" | "ch" | "fundamentals"; message: string };

export interface AdminActivityResponse { events: AdminActivityEvent[] }

// -- Lazy CH client ----------------------------------------------------------
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
  } catch { return null; }
}

async function chJson<T>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
  const c = getCh();
  if (!c) return [];
  try {
    const rs = await c.query({ query: sql, query_params: params ?? {}, format: "JSONEachRow" });
    return (await rs.json()) as T[];
  } catch { return []; }
}

async function fetchScanEvents(): Promise<AdminActivityEvent[]> {
  const rows = await chJson<{ id: string; ts: string; symbolsScanned: number; primary: number; stars: number }>(
    `SELECT
       toString(s.id) AS id,
       formatDateTime(s.generated_at, '%Y-%m-%dT%H:%M:%SZ') AS ts,
       s.symbols_scanned AS symbolsScanned,
       countIf(r.role = 'primary') AS primary,
       countIf(r.star = 1) AS stars
     FROM scan_snapshots s
     LEFT JOIN scan_rows r
       ON r.generated_at = s.generated_at
     WHERE s.generated_at >= now() - INTERVAL 4 HOUR
     GROUP BY s.id, s.generated_at, s.symbols_scanned
     ORDER BY s.generated_at DESC
     LIMIT 40`,
  );
  return rows.map((r) => ({
    id: `scan-${r.id}`,
    kind: "scan" as const,
    ts: r.ts,
    symbolsScanned: Number(r.symbolsScanned),
    primary: Number(r.primary),
    stars: Number(r.stars),
  }));
}

async function fetchStarTransitions(): Promise<AdminActivityEvent[]> {
  // Get the last 20 scans' star sets ordered oldest→newest, then diff pairs.
  const rows = await chJson<{ ts: string; symbols: string[] }>(
    `SELECT formatDateTime(generated_at, '%Y-%m-%dT%H:%M:%SZ') AS ts,
            groupArrayIf(symbol, star = 1) AS symbols
     FROM scan_rows
     WHERE generated_at >= now() - INTERVAL 4 HOUR
     GROUP BY generated_at
     ORDER BY generated_at ASC
     LIMIT 40`,
  );
  const events: AdminActivityEvent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = new Set(rows[i - 1].symbols);
    const curr = new Set(rows[i].symbols);
    for (const s of curr) if (!prev.has(s)) events.push({ id: `star-in-${rows[i].ts}-${s}`, kind: "star-in", ts: rows[i].ts, symbol: s });
    for (const s of prev) if (!curr.has(s)) events.push({ id: `star-out-${rows[i].ts}-${s}`, kind: "star-out", ts: rows[i].ts, symbol: s });
  }
  return events;
}

async function fetchSignups(): Promise<AdminActivityEvent[]> {
  const cutoff = new Date(Date.now() - 4 * 3600 * 1000);
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, createdAt: true },
    take: 30,
  });
  return users.map((u) => ({
    id: `signup-${u.id}`,
    kind: "signup" as const,
    ts: u.createdAt.toISOString(),
    userId: u.id,
    email: u.email,
    role: u.role,
  }));
}

function fetchErrorEvents(): AdminActivityEvent[] {
  const cutoff = Date.now() - 4 * 3600 * 1000;
  return getErrors(50)
    .filter((e) => e.ts >= cutoff)
    .map((e) => ({
      id: `err-${e.id}`,
      kind: "error" as const,
      ts: new Date(e.ts).toISOString(),
      errorId: e.id,
      errKind: e.kind,
      message: e.message,
    }));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const [scans, stars, signups] = await Promise.all([
    fetchScanEvents(),
    fetchStarTransitions(),
    fetchSignups(),
  ]);
  const errors = fetchErrorEvents();

  const all: AdminActivityEvent[] = [...scans, ...stars, ...signups, ...errors];
  all.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));

  const resp: AdminActivityResponse = { events: all.slice(0, limit) };
  return NextResponse.json(resp);
}
