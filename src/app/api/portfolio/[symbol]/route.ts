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

interface PatchBody {
  qty?: unknown;
  costBasis?: unknown;
  notes?: unknown;
}

interface Ctx {
  params: Promise<{ symbol: string }>;
}

async function getSymbol(ctx: Ctx): Promise<string | null> {
  const { symbol: raw } = await ctx.params;
  const symbol = raw?.trim().toUpperCase() ?? "";
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

export async function PUT(req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const symbol = await getSymbol(ctx);
  if (!symbol) return badRequest("symbol must match /^[A-Z]{1,6}$/");

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return badRequest("invalid json");
  }

  const data: { qty?: number; costBasis?: number; notes?: string | null } = {};

  if (body.qty !== undefined) {
    const qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) return badRequest("qty must be > 0");
    data.qty = qty;
  }
  if (body.costBasis !== undefined) {
    const cb = typeof body.costBasis === "number" ? body.costBasis : Number(body.costBasis);
    if (!Number.isFinite(cb) || cb <= 0) return badRequest("costBasis must be > 0");
    data.costBasis = cb;
  }
  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" ? body.notes : null;
  }

  const existing = await prisma.portfolioEntry.findUnique({
    where: { userId_symbol: { userId, symbol } },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.portfolioEntry.update({
    where: { userId_symbol: { userId, symbol } },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const symbol = await getSymbol(ctx);
  if (!symbol) return badRequest("symbol must match /^[A-Z]{1,6}$/");

  try {
    await prisma.portfolioEntry.delete({
      where: { userId_symbol: { userId, symbol } },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
