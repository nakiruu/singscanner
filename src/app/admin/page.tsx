import { AdminDashboard } from "./AdminDashboard";

// Middleware already gates /admin to ADMIN role — no in-page auth check needed.
export default function AdminPage() {
  return <AdminDashboard />;
}
