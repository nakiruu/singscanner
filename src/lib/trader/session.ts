// US/Eastern session detection + bar-boundary scheduling. Pure functions.
// Sessions per auto3 trader.py et_session():
//   premarket 4:00–9:30 ET, regular 9:30–16:00, afterhours 16:00–20:00,
//   closed otherwise (incl. weekends).

export type TraderSession = "premarket" | "regular" | "afterhours" | "closed";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function etParts(d: Date): { weekday: string; hour: number; minute: number } {
  const parts = ET_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Intl can render midnight as "24" with hour12:false — normalize.
  const hour = Number(get("hour")) % 24;
  return { weekday: get("weekday"), hour, minute: Number(get("minute")) };
}

export function etSession(now: Date = new Date()): { session: TraderSession; etHour: number } {
  const { weekday, hour, minute } = etParts(now);
  const etHour = hour + minute / 60;
  if (weekday === "Sat" || weekday === "Sun") return { session: "closed", etHour };
  if (etHour >= 4 && etHour < 9.5) return { session: "premarket", etHour };
  if (etHour >= 9.5 && etHour < 16) return { session: "regular", etHour };
  if (etHour >= 16 && etHour < 20) return { session: "afterhours", etHour };
  return { session: "closed", etHour };
}

const FIVE_MIN_MS = 5 * 60 * 1000;

// Next 5-minute boundary (ms epoch) that falls inside the 04:00–20:00 ET
// weekday window. ET offsets are whole hours, so UTC 5-min boundaries ARE
// ET 5-min boundaries. Bounded scan: a full weekend is < 900 steps.
export function nextBarBoundary(nowMs: number = Date.now()): number {
  let t = Math.floor(nowMs / FIVE_MIN_MS) * FIVE_MIN_MS + FIVE_MIN_MS;
  for (let i = 0; i < 4000; i++) {
    if (etSession(new Date(t)).session !== "closed") return t;
    t += FIVE_MIN_MS;
  }
  return t; // unreachable in practice
}

export function isStale(generatedAtIso: string, maxAgeMs = 300_000): boolean {
  const ts = Date.parse(generatedAtIso);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > maxAgeMs;
}
