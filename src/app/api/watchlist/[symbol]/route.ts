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

interface Ctx {
  params: Promise<{ symbol: string }>;
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const { symbol: raw } = await ctx.params;
  const symbol = raw?.trim().toUpperCase() ?? "";
  if (!SYMBOL_RE.test(symbol)) return badRequest("symbol must match /^[A-Z]{1,6}$/");

  try {
    await prisma.watchlistEntry.delete({
      where: { userId_symbol: { userId, symbol } },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
