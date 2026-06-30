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

// Pure: returns a new array of assignments aligned by index with `rows`.
// Only primary BUYs are star-eligible (the top-5 cut happens elsewhere).
export function assignRoles(rows: readonly RoleInputRow[], calib: Calibration): RoleAssignment[] {
  // First pass: find max modelEdge among rows that meet the long-band gate.
  let maxEdge = -Infinity;
  for (const r of rows) {
    if (r.evidence >= calib.evidenceThreshold && r.pUp >= calib.memberPupMin) {
      if (r.modelEdge > maxEdge) maxEdge = r.modelEdge;
    }
  }
  const hasCohort = maxEdge > -Infinity;

  return rows.map((r) => {
    if (r.evidence >= calib.evidenceThreshold && r.pUp >= calib.memberPupMin) {
      // qualifying member of the long band
      const isPrimary = hasCohort && r.modelEdge >= maxEdge - calib.primaryBand;
      const role: Role = isPrimary ? "primary" : "secondary";
      return { role, starEligible: role === "primary" };
    }
    if (r.isHeld && r.evidence >= calib.retainFloor) {
      return { role: "retained", starEligible: false };
    }
    return { role: "none", starEligible: false };
  });
}
