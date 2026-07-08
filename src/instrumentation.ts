// Next.js 16 server bootstrap. Runs once per server boot.
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

import { bootstrapShadowMonitors } from "@/lib/shadow";

export async function register(): Promise<void> {
  bootstrapShadowMonitors();
}
