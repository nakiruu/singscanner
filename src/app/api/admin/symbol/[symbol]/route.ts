import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@clickhouse/client";

export const dynamic = "force-dynamic";

export interface SymbolHistoryResponse {
  symbol: string;
  history: Array<{ generatedAt: string; net: number; role: string; decision: string; star: number; price: number }>;
}

let chClient: ReturnType<typeof createClient> | null = null;
let chInit = false;
function getCh() {
  if (chInit) return chClient;
  chInit = true;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  try {
    chClient = createClient({
      url,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "default",
    });
    return chClient;
  } catch { return null; }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { symbol } = await params;
  const c = getCh();
  if (!c) return NextResponse.json({ symbol, history: [] } satisfies SymbolHistoryResponse);
  try {
    const rs = await c.query({
      query: `
        SELECT
          toString(generated_at) AS generatedAt,
          net, role, decision, star, price
        FROM scan_rows
        WHERE symbol = {symbol:String}
        ORDER BY generated_at DESC
        LIMIT 20
      `,
      query_params: { symbol },
      format: "JSONEachRow",
    });
    const history = (await rs.json()) as SymbolHistoryResponse["history"];
    return NextResponse.json({ symbol, history } satisfies SymbolHistoryResponse);
  } catch {
    return NextResponse.json({ symbol, history: [] } satisfies SymbolHistoryResponse);
  }
}
