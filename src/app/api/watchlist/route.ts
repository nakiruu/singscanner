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

  const entries = await prisma.watchlistEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(entries, {
    headers: { "cache-control": "no-store" },
  });
}

interface UpsertBody {
  symbol?: unknown;
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
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!SYMBOL_RE.test(symbol)) return badRequest("symbol must match /^[A-Z]{1,6}$/");

  const entry = await prisma.watchlistEntry.upsert({
    where: { userId_symbol: { userId, symbol } },
    create: { userId, symbol, notes },
    update: { notes },
  });
  return NextResponse.json(entry, { status: 201 });
}
