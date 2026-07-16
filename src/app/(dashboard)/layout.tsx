import { auth } from "@/auth";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side session read so UserMenu can render identity + role-gated
  // links without pulling next-auth into the client bundle.
  const session = await auth();
  const user = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
        role: session.user.role,
      }
    : undefined;

  return (
    <div className="flex h-screen w-full">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
