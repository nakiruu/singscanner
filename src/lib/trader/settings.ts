// Env-var → settings readers. Read once at bootstrap; changes need a restart.

import type { TraderSettings } from "./sizing";
import type { ExtendedSessionSettings, SessionSettings } from "./runner";

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== ""
    ? v
    : fallback;
}

export function readTraderSettings(): TraderSettings {
  return {
    riskPerTrade: envNum("TRADER_RISK_PER_TRADE", 0.01),
    maxPositionPct: envNum("TRADER_MAX_POSITION_PCT", 0.10),
    cashFloorPct: envNum("TRADER_CASH_FLOOR_PCT", 0.02),
    minConviction: envNum("TRADER_MIN_CONVICTION", 1.0),
    maxConviction: envNum("TRADER_MAX_CONVICTION", 2.0),
    maxPositions: envNum("TRADER_MAX_POSITIONS", 8),
    maxEntriesPerCycle: envNum("TRADER_MAX_ENTRIES_PER_CYCLE", 2),
    maxRotationsPerCycle: envNum("TRADER_MAX_ROTATIONS_PER_CYCLE", 1),
    rotationMinAgeS: envNum("TRADER_ROTATION_MIN_AGE_S", 3600),
    reversalCooldownS: envNum("TRADER_REVERSAL_COOLDOWN_S", 900),
  };
}

export function readExtendedSettings(): ExtendedSessionSettings {
  return {
    stopWiden: envNum("TRADER_EXT_STOP_WIDEN", 0.005),
    targetWiden: envNum("TRADER_EXT_TARGET_WIDEN", 0.005),
    limitSlip: envNum("TRADER_EXT_LIMIT_SLIP", 0.001),
  };
}

export function readSessionSettings(): SessionSettings {
  return { premarketMinHour: envNum("TRADER_PREMARKET_MIN_HOUR", 7) };
}
