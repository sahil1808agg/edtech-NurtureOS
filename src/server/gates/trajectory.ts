/**
 * Trajectory construction — encodes the rules that separate a real change from
 * an artefact of how the school filled in the grid.
 *
 * Where a dash sits determines what it means:
 *   -, O, P   leading dash  → not assessed in T1. O→P in the later terms is a
 *                             real change and must survive.
 *   P, O, -   trailing dash → the standard stopped being assessed. Reporting a
 *                             fall here is the false-regression failure.
 *   O, -, P   interior gap  → cannot be interpreted. Not reportable.
 *
 * A trajectory spanning two scales is never reportable: 0.75 on an IB
 * four-point scale and 0.75 on a percentage scale are not comparable.
 *
 * See PRD adversarial cases 3 and 4, and LLD §2.
 */

import type { ObservationRow } from "../pipeline/types";

export interface TrajectoryPoint {
  termIndex: number;
  value: number | null;
  ambiguous: boolean;
}

export type UnreportableReason =
  | "INTERIOR_GAP"
  | "MIXED_SCALES"
  | "INSUFFICIENT_POINTS";

export interface Trajectory {
  skillId: string | null;
  scaleId: string | null;
  /** every point as recorded, including ambiguous ones */
  points: TrajectoryPoint[];
  reportable: boolean;
  reason: UnreportableReason | null;
  /** last solid minus first solid. null when unreportable. */
  delta: number | null;
  /**
   * Change across the most recent solid step. This is what "a regression"
   * means — a fall in the latest term, even when the overall delta is positive.
   */
  lastStepDelta: number | null;
  direction: "up" | "down" | "flat" | null;
  /** true when trailing ambiguous points were dropped before evaluation */
  truncated: boolean;
}

function unreportable(
  skillId: string | null,
  scaleId: string | null,
  points: TrajectoryPoint[],
  reason: UnreportableReason,
  truncated = false,
): Trajectory {
  return {
    skillId,
    scaleId,
    points,
    reportable: false,
    reason,
    delta: null,
    lastStepDelta: null,
    direction: null,
    truncated,
  };
}

export function buildTrajectory(rows: readonly ObservationRow[]): Trajectory {
  if (rows.length === 0) {
    return unreportable(null, null, [], "INSUFFICIENT_POINTS");
  }

  const sorted = [...rows].sort((a, b) => a.termIndex - b.termIndex);
  const points: TrajectoryPoint[] = sorted.map((r) => ({
    termIndex: r.termIndex,
    value: r.normalised,
    ambiguous: r.isAmbiguous || r.normalised === null,
  }));

  const skillId = sorted[0].skillId;
  const scaleIds = new Set(sorted.map((r) => r.scaleId));
  if (scaleIds.size > 1) {
    return unreportable(skillId, null, points, "MIXED_SCALES");
  }
  const scaleId = sorted[0].scaleId;

  // Trim leading and trailing ambiguity. Both are absence of assessment, not
  // a value, and neither should generate or suppress a claim on its own.
  let start = 0;
  let end = points.length - 1;
  while (start <= end && points[start].ambiguous) start++;
  while (end >= start && points[end].ambiguous) end--;
  const truncated = end < points.length - 1;

  if (end < start) {
    return unreportable(skillId, scaleId, points, "INSUFFICIENT_POINTS", truncated);
  }

  const window = points.slice(start, end + 1);

  // Anything ambiguous left inside the window is an uninterpretable gap.
  if (window.some((p) => p.ambiguous)) {
    return unreportable(skillId, scaleId, points, "INTERIOR_GAP", truncated);
  }

  if (window.length < 2) {
    return unreportable(skillId, scaleId, points, "INSUFFICIENT_POINTS", truncated);
  }

  const first = window[0].value!;
  const last = window[window.length - 1].value!;
  const prev = window[window.length - 2].value!;
  const delta = last - first;
  const lastStepDelta = last - prev;

  return {
    skillId,
    scaleId,
    points,
    reportable: true,
    reason: null,
    delta,
    lastStepDelta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    truncated,
  };
}

/** Group observations by skill, then build a trajectory for each. */
export function buildTrajectories(
  rows: readonly ObservationRow[],
): Trajectory[] {
  const bySkill = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    // Unmapped observations have no identity across terms.
    if (row.skillId === null) continue;
    const bucket = bySkill.get(row.skillId);
    if (bucket) bucket.push(row);
    else bySkill.set(row.skillId, [row]);
  }
  return [...bySkill.values()].map(buildTrajectory);
}

/** Skills that fell in the most recent term, regardless of overall direction. */
export function recentRegressions(trajectories: readonly Trajectory[]): Trajectory[] {
  return trajectories.filter(
    (t) => t.reportable && !t.truncated && (t.lastStepDelta ?? 0) < 0,
  );
}
