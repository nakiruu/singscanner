// Role assignment: primary / secondary / retained / none.
// Source: docs/instructions2.md "Roles".
//
// evidence >= 95 AND P_up >= 0.50 -> qualifies for the long band:
//   primary   if modelEdge within `primaryBand` bps of the cohort's max modelEdge
//   secondary otherwise
// Held AND evidence >= retainFloor (40) -> retained
// Else -> none

import type { Role } from "./types";
import type { Calibration } from "./horizon";

// C3-1: adaptive primaryBand mode. Legacy uses the fixed calib.primaryBand;
// adaptive uses `max(floor, 0.5·σ(modelEdge | qualifying))` where the
// sigma is computed over the qualifying-member cohort (evidence≥95, pUp≥0.5).
// Rank/data-scaled bands beat fixed absolute (Paleologo 2021, Advanced
// Portfolio Management). Behind SIGNAL_PRIMARY_BAND_MODE=fixed|adaptive.
const PRIMARY_BAND_MODE = process.env.SIGNAL_PRIMARY_BAND_MODE ?? "fixed";
const USE_ADAPTIVE_PRIMARY_BAND = PRIMARY_BAND_MODE === "adaptive";
const ADAPTIVE_PRIMARY_BAND_FLOOR = 15;   // bps

// Public helper — exported so callers that pre-compute a cohort (e.g. the
// scanner) can share the same math. Returns the fixed calibration band when
// too few rows to estimate σ, avoiding pathological narrow bands on empty
// slates.
export function computeAdaptivePrimaryBand(
  qualifyingModelEdges: readonly number[],
  floor: number = ADAPTIVE_PRIMARY_BAND_FLOOR,
): number {
  if (qualifyingModelEdges.length < 5) return floor;
  const n = qualifyingModelEdges.length;
  const mean = qualifyingModelEdges.reduce((s, x) => s + x, 0) / n;
  const variance = qualifyingModelEdges.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const sigma = Math.sqrt(Math.max(0, variance));
  return Math.max(floor, 0.5 * sigma);
}

export interface RoleInputRow {
  evidence: number;
  pUp: number;
  modelEdge: number;
  isHeld: boolean;
}

export interface RoleAssignment {
  role: Role;
  starEligible: boolean;
}

export interface AssignRolesOpts {
  // Optional tie-break comparator. Not currently consumed by the assignment
  // pass itself (assignRoles doesn't sort) — reserved for downstream callers
  // that pick top-N within a role and need deterministic ordering near the
  // primaryBand boundary (Paleologo 2021). Signature: standard Array.sort
  // comparator taking (a, b, idxA, idxB) where indices are into `rows`.
  tieBreaker?: (a: RoleInputRow, b: RoleInputRow, idxA: number, idxB: number) => number;
}

// Pure: returns a new array of assignments aligned by index with `rows`.
// Only primary BUYs are star-eligible (the top-5 cut happens elsewhere).
export function assignRoles(
  rows: readonly RoleInputRow[],
  calib: Calibration,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _opts?: AssignRolesOpts,
): RoleAssignment[] {
  // First pass: find max modelEdge + collect qualifying edges for adaptive
  // band. Single loop keeps this O(n) even when adaptive mode is on.
  let maxEdge = -Infinity;
  const qualifyingEdges: number[] = [];
  for (const r of rows) {
    if (r.evidence >= calib.evidenceThreshold && r.pUp >= calib.memberPupMin) {
      if (r.modelEdge > maxEdge) maxEdge = r.modelEdge;
      if (USE_ADAPTIVE_PRIMARY_BAND) qualifyingEdges.push(r.modelEdge);
    }
  }
  const hasCohort = maxEdge > -Infinity;

  // C3-1: adaptive band derived from cohort dispersion, else fall back to
  // the horizon-lerped/fixed band from calibration.
  const primaryBand = USE_ADAPTIVE_PRIMARY_BAND
    ? computeAdaptivePrimaryBand(qualifyingEdges)
    : calib.primaryBand;

  return rows.map((r) => {
    if (r.evidence >= calib.evidenceThreshold && r.pUp >= calib.memberPupMin) {
      // qualifying member of the long band
      const isPrimary = hasCohort && r.modelEdge >= maxEdge - primaryBand;
      const role: Role = isPrimary ? "primary" : "secondary";
      return { role, starEligible: role === "primary" };
    }
    if (r.isHeld && r.evidence >= calib.retainFloor) {
      return { role: "retained", starEligible: false };
    }
    return { role: "none", starEligible: false };
  });
}
