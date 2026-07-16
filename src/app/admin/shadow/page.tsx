import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ShadowClient } from "./ShadowClient";

export const dynamic = "force-dynamic";

export default async function AdminShadowPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    redirect("/dashboard");
  }
  return <ShadowClient />;
}
