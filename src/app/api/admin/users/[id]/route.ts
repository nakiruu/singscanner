import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, username: true, name: true, image: true,
      role: true, suspended: true, createdAt: true,
      portfolio: { select: { symbol: true, qty: true, costBasis: true } },
      watchlist: { select: { symbol: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    ...user,
    createdAt: user.createdAt.toISOString(),
  });
}
