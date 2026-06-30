import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z]{1,6}$/;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function badRequest(reason: string) {
  return NextResponse.json({ error: reason }, { status: 400 });
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const positions = await prisma.portfolioEntry.findMany({
    where: { userId },
    orderBy: { symbol: "asc" },
  });
  return NextResponse.json(positions, {
    headers: { "cache-control": "no-store" },
  });
}

interface UpsertBody {
  symbol?: unknown;
  qty?: unknown;
  costBasis?: unknown;
  notes?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  let body: UpsertBody;
  try {
    body = (await req.json()) as UpsertBody;
  } catch {
    return badRequest("invalid json");
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  const qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
  const costBasis = typeof body.costBasis === "number" ? body.costBasis : Number(body.costBasis);
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!SYMBOL_RE.test(symbol)) return badRequest("symbol must match /^[A-Z]{1,6}$/");
  if (!Number.isFinite(qty) || qty <= 0) return badRequest("qty must be > 0");
  if (!Number.isFinite(costBasis) || costBasis <= 0) return badRequest("costBasis must be > 0");

  const entry = await prisma.portfolioEntry.upsert({
    where: { userId_symbol: { userId, symbol } },
    create: { userId, symbol, qty, costBasis, notes },
    update: { qty, costBasis, notes },
  });
  return NextResponse.json(entry, { status: 201 });
}
