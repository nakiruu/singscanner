import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserDetailClient, type UserDetail } from "./UserDetailClient";

export const dynamic = "force-dynamic";

async function fetchUser(id: string): Promise<UserDetail | null> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return null;
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, username: true, name: true, image: true,
      role: true, suspended: true, createdAt: true,
      portfolio: { select: { symbol: true, qty: true, costBasis: true } },
      watchlist: { select: { symbol: true } },
    },
  });
  if (!u) return null;
  return { ...u, createdAt: u.createdAt.toISOString() } as UserDetail;
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await fetchUser(id);
  if (!user) notFound();

  return (
    <main className="relative flex flex-1 flex-col px-6 py-8">
      <div className="mx-auto w-full max-w-[880px] space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-low px-5 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin" className="font-mono text-[11px] text-on-surface-variant hover:text-on-surface">
              ← admin
            </Link>
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-on-surface">
              ◆ User · {user.email}
            </h1>
          </div>
        </div>
        <UserDetailClient user={user} />
      </div>
    </main>
  );
}
