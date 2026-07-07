import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const ALLOWED_ROLES = new Set(["USER", "PREMIUM", "ADMIN"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null) as { role?: string } | null;
  if (!body || !body.role || !ALLOWED_ROLES.has(body.role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id },
    // Cast to the prisma-generated Role enum via string literal — Prisma accepts
    // the exact string value at runtime; TypeScript's enum type flows in via
    // the schema-generated types.
    data: { role: body.role as "USER" | "PREMIUM" | "ADMIN" },
  });
  return NextResponse.json({ ok: true });
}
