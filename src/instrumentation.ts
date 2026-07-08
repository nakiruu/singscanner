// Next.js 16 server bootstrap. Runs once per server boot, in BOTH the
// node and edge runtimes — node-only imports must stay behind the guard.
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapShadowMonitors } = await import("@/lib/shadow");
    bootstrapShadowMonitors();
  }
}
