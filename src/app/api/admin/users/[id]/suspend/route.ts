import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null) as { suspended?: boolean } | null;
  if (!body || typeof body.suspended !== "boolean") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await prisma.user.update({ where: { id }, data: { suspended: body.suspended } });
  return NextResponse.json({ ok: true });
}
