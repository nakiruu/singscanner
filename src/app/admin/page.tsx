import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDashboard } from "./AdminDashboard";

// Middleware gates /admin to ADMIN role; this in-page check is defense-in-depth
// so the dashboard cannot render if the matcher ever drifts.
export default async function AdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <AdminDashboard />;
}
