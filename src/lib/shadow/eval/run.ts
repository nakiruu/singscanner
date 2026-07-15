// shadow-eval CLI runner.
//
// Loads shadow_resolved for a horizon, runs a caller-defined config grid
// through the offline-eval harness (purged CV → PBO → DSR), and writes a
// JSON report to stdout or a file. Intended for `npx tsx` execution or via
// `npm run shadow:eval -- --horizon 5d --config ./grid.json`.
//
// Usage:
//   npx tsx src/lib/shadow/eval/run.ts \
//     --horizon 5d \
//     --window-days 90 \
//     --n-folds 5 \
//     --config-grid './scripts/ridge-grid.json' \
//     --output './eval-out.json'
//
// The config grid file is a JSON array of objects; each object is passed
// verbatim to the scoreFn. Default scoreFn is a placeholder that reads
// shadow_resolved.delta_bps aggregates — real hyperparameter tuning
// wires a scoreFn that FITS the config against the train window and
// evaluates on test.

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { runOfflineEval, type OfflineEvalOpts, type Horizon } from "../offline-eval";
import type { CVFold } from "./purged-cv";

interface CliArgs {
  horizon: Horizon;
  windowDays: number;
  nFolds: number;
  embargoDays?: number;
  configGrid?: string;    // path to JSON array
  output?: string;        // stdout when omitted
}

// -- Argv parsing ------------------------------------------------------------

function parseArgs(argv: readonly string[]): CliArgs {
  const args: Partial<CliArgs> = { horizon: "5d", windowDays: 90, nFolds: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--horizon":
        if (next !== "3d" && next !== "5d" && next !== "10d") {
          throw new Error(`--horizon must be one of 3d|5d|10d, got ${next}`);
        }
        args.horizon = next; i++; break;
      case "--window-days":
        args.windowDays = Number(next); i++; break;
      case "--n-folds":
        args.nFolds = Number(next); i++; break;
      case "--embargo-days":
        args.embargoDays = Number(next); i++; break;
      case "--config-grid":
        args.configGrid = next; i++; break;
      case "--output":
        args.output = next; i++; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }
  return args as CliArgs;
}

function printHelp(): void {
  console.log(`
shadow-eval — offline hyperparameter evaluation harness

Usage:
  npx tsx src/lib/shadow/eval/run.ts [options]

Options:
  --horizon <3d|5d|10d>       (default 5d)
  --window-days <n>           trailing days of shadow_resolved (default 90)
  --n-folds <n>               purged-CV folds (default 5)
  --embargo-days <n>          fold embargo (default = horizon days)
  --config-grid <path>        JSON array of configs to evaluate
  --output <path>             write report to file (default stdout)

Example:
  npx tsx src/lib/shadow/eval/run.ts \\
    --horizon 5d --window-days 120 \\
    --config-grid ./scripts/ridge-grid.json \\
    --output ./out.json
`.trim());
}

// -- CH client ---------------------------------------------------------------

let client: ClickHouseClient | null = null;
function getClient(): ClickHouseClient | null {
  if (client) return client;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DB ?? "default",
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  return client;
}

// -- Default scoreFn: fold-window mean delta_bps ----------------------------
//
// Placeholder implementation. A real tuning workflow would fit each config
// against the fold's train window and evaluate on the test window. Here we
// just return the mean delta_bps in the test window as a coarse proxy so
// the CLI is exercisable without the fit path plumbed.

async function defaultScoreFn<TConfig>(
  _config: TConfig,
  fold: CVFold,
  horizon: Horizon,
): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  const rs = await c.query({
    query: `
      SELECT
        avg(delta_bps) AS mean_delta,
        stddevSamp(delta_bps) AS std_delta,
        count() AS n
      FROM shadow_resolved
      WHERE horizon = {horizon:String}
        AND clean = 1
        AND resolved_at >= parseDateTimeBestEffort({testStart:String})
        AND resolved_at <  parseDateTimeBestEffort({testEnd:String})
    `,
    query_params: {
      horizon,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
    },
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{
    mean_delta: number | string | null;
    std_delta: number | string | null;
    n: number | string;
  }>;
  if (rows.length === 0) return 0;
  const meanDelta = Number(rows[0].mean_delta) || 0;
  const stdDelta = Number(rows[0].std_delta) || 0;
  const n = Number(rows[0].n) || 0;
  // Sharpe-flavored: mean / (std / √n). Small n → small Sharpe; empty
  // window → 0.
  if (n < 2 || stdDelta <= 0) return 0;
  return meanDelta / (stdDelta / Math.sqrt(n));
}

// -- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const windowEnd = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - args.windowDays * 86_400_000)
    .toISOString().slice(0, 10);

  let configs: unknown[] = [{ default: true }];
  if (args.configGrid) {
    const fs = await import("fs/promises");
    configs = JSON.parse(await fs.readFile(args.configGrid, "utf-8")) as unknown[];
  }

  const opts: OfflineEvalOpts<unknown> = {
    horizon: args.horizon,
    windowStart,
    windowEnd,
    configs,
    scoreFn: (cfg, fold) => defaultScoreFn(cfg, fold, args.horizon),
    nFolds: args.nFolds,
    embargoDays: args.embargoDays,
  };

  const report = await runOfflineEval(opts);
  const json = JSON.stringify(report, null, 2);

  if (args.output) {
    const fs = await import("fs/promises");
    await fs.writeFile(args.output, json, "utf-8");
    console.log(`Report written to ${args.output}`);
  } else {
    console.log(json);
  }
}

// Only run when invoked directly (not on import).
if (require.main === module) {
  main().catch((err) => {
    console.error("shadow-eval failed:", err);
    process.exit(1);
  });
}
