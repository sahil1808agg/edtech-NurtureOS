/**
 * Gate tests. Cases are taken from the real EYP report analysed in the PRD and
 * from the six constructed adversarial cases in the evaluation strategy.
 */

import { describe, it, expect } from "vitest";
import { citationGate } from "./citation";
import { buildTrajectory, recentRegressions, buildTrajectories } from "./trajectory";
import { sufficiencyGate, DEFAULT_SUFFICIENCY } from "./sufficiency";
import { verifyQuote } from "./quote";
import { normaliseValue, isAmbiguousRaw } from "@/lib/ontology/scales";
import type { CandidateClaim, ObservationRow, NarrativeRow } from "../pipeline/types";

// ---------------------------------------------------------------- fixtures

let seq = 0;
function obs(
  rawValues: (string | null)[],
  opts: { skillId?: string; scaleId?: string | string[] } = {},
): ObservationRow[] {
  const skillId = opts.skillId ?? "skill-1";
  return rawValues.map((raw, i) => {
    const scaleId = Array.isArray(opts.scaleId)
      ? opts.scaleId[i]
      : (opts.scaleId ?? "IB_OPCE");
    const { normalised, isAmbiguous } = normaliseValue(scaleId, raw);
    return {
      id: `obs-${++seq}`,
      reportId: "report-1",
      skillId,
      rawLabel: "test standard",
      scaleId,
      termIndex: i + 1,
      rawValue: raw,
      normalised,
      isAmbiguous,
      confidence: 1,
      sourceRef: { page: 1 },
    };
  });
}

function claim(ids: string[]): CandidateClaim {
  return {
    kind: "growth",
    statement: "test claim",
    citedObservationIds: ids,
    reasoning: "because",
  };
}

// ---------------------------------------------------------------- scales

describe("scale normalisation", () => {
  it("maps the IB four-point scale", () => {
    expect(normaliseValue("IB_OPCE", "O").normalised).toBe(1);
    expect(normaliseValue("IB_OPCE", "P").normalised).toBe(0.75);
    expect(normaliseValue("IB_OPCE", "C").normalised).toBe(0.5);
    expect(normaliseValue("IB_OPCE", "E").normalised).toBe(0.25);
  });

  it("treats a dash as absence of assessment, not a zero", () => {
    for (const token of ["-", "–", "", "  ", "N/A"]) {
      expect(isAmbiguousRaw(token)).toBe(true);
      expect(normaliseValue("IB_OPCE", token).normalised).toBeNull();
      expect(normaliseValue("IB_OPCE", token).isAmbiguous).toBe(true);
    }
  });

  it("flags values the scale does not recognise rather than guessing", () => {
    expect(normaliseValue("IB_OPCE", "Z").unrecognised).toBe(true);
    expect(normaliseValue("IB_OPCE", "Z").normalised).toBeNull();
  });

  it("parses percentages", () => {
    expect(normaliseValue("PCT", "78").normalised).toBeCloseTo(0.78);
    expect(normaliseValue("PCT", "78%").normalised).toBeCloseTo(0.78);
    expect(normaliseValue("PCT", "150").unrecognised).toBe(true);
  });
});

// ---------------------------------------------------------------- trajectory

describe("trajectory", () => {
  it("reports a straightforward rise", () => {
    const t = buildTrajectory(obs(["C", "P", "O"]));
    expect(t.reportable).toBe(true);
    expect(t.delta).toBeCloseTo(0.5);
    expect(t.direction).toBe("up");
  });

  it("catches a fall in the latest term even when the year improved overall", () => {
    // "Use capital letters, full stops in their writing": C, O, P
    const t = buildTrajectory(obs(["C", "O", "P"]));
    expect(t.reportable).toBe(true);
    expect(t.delta).toBeCloseTo(0.25); // up across the year
    expect(t.lastStepDelta).toBeCloseTo(-0.25); // but down in T3
    expect(recentRegressions([t])).toHaveLength(1);
  });

  it("keeps a real regression that begins with an unassessed term", () => {
    // "Interpret terms like more than / take away…": -, O, P
    const t = buildTrajectory(obs([null, "O", "P"]));
    expect(t.reportable).toBe(true);
    expect(t.lastStepDelta).toBeCloseTo(-0.25);
    expect(recentRegressions([t])).toHaveLength(1);
  });

  it("does not report a fall caused by a trailing dash", () => {
    // "Count with one-to-one correspondence up to 80": P, O, -
    const t = buildTrajectory(obs(["P", "O", null]));
    expect(t.truncated).toBe(true);
    expect(t.lastStepDelta).toBeCloseTo(0.25); // the real movement was upward
    expect(recentRegressions([t])).toHaveLength(0);
  });

  it("refuses to interpret an interior gap", () => {
    const t = buildTrajectory(obs(["O", null, "P"]));
    expect(t.reportable).toBe(false);
    expect(t.reason).toBe("INTERIOR_GAP");
    expect(t.delta).toBeNull();
  });

  it("never compares across scales", () => {
    const t = buildTrajectory(obs(["C", "78"], { scaleId: ["IB_OPCE", "PCT"] }));
    expect(t.reportable).toBe(false);
    expect(t.reason).toBe("MIXED_SCALES");
  });

  it("treats a single point as a value, not a trend", () => {
    const t = buildTrajectory(obs(["O"]));
    expect(t.reportable).toBe(false);
    expect(t.reason).toBe("INSUFFICIENT_POINTS");
  });

  it("drops observations with no skill mapping", () => {
    const rows = obs(["C", "O"]).map((r) => ({ ...r, skillId: null }));
    expect(buildTrajectories(rows)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- citation

describe("citation gate", () => {
  const valid = new Set(["a", "b", "c"]);

  it("keeps a fully grounded claim", () => {
    const { kept, dropped } = citationGate([claim(["a", "b"])], valid);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("drops a claim citing an observation that does not exist", () => {
    const { kept, dropped } = citationGate([claim(["a", "ghost"])], valid);
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toBe("UNRESOLVED_CITATION");
    expect(dropped[0].unresolved).toEqual(["ghost"]);
  });

  it("drops a claim with no citations at all", () => {
    const { kept, dropped } = citationGate([claim([])], valid);
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toBe("NO_CITATION");
  });

  it("keeps grounded claims while dropping ungrounded ones", () => {
    const { kept, dropped } = citationGate(
      [claim(["a"]), claim(["ghost"]), claim(["b", "c"])],
      valid,
    );
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- sufficiency

describe("sufficiency gate", () => {
  it("passes a rich report", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      obs(["O"], { skillId: `s${i}` })[0],
    );
    expect(sufficiencyGate(rows, 1200).pass).toBe(true);
  });

  it("fires the honesty path on a thin report", () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      obs(["O"], { skillId: `s${i}` })[0],
    );
    const r = sufficiencyGate(rows, 20);
    expect(r.pass).toBe(false);
    expect(r.failures).toContain("TOO_FEW_OBSERVATIONS");
    expect(r.failures).toContain("NARRATIVE_TOO_SHORT");
  });

  it("fires when most values are unassessed", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      obs([i % 4 === 0 ? "O" : null], { skillId: `s${i}` })[0],
    );
    const r = sufficiencyGate(rows, 1200);
    expect(r.pass).toBe(false);
    expect(r.failures).toContain("TOO_MANY_AMBIGUOUS");
  });

  it("has thresholds that are configuration, not constants", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      obs(["O"], { skillId: `s${i}` })[0],
    );
    expect(sufficiencyGate(rows, 1200).pass).toBe(false);
    expect(
      sufficiencyGate(rows, 1200, { ...DEFAULT_SUFFICIENCY, minObservations: 5 })
        .pass,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------- quote

describe("quote verification", () => {
  const narratives: NarrativeRow[] = [
    {
      id: "n1",
      reportId: "report-1",
      subject: "Mathematics",
      text: "Building further confidence in solving story-based problems and representing data through graphs will support his continued success.",
    },
  ];

  it("accepts a verbatim quote", () => {
    const r = verifyQuote(
      {
        verdict: "corroborated",
        quote: "solving story-based problems",
        narrativeId: "n1",
      },
      narratives,
    );
    expect(r.verdict).toBe("corroborated");
    expect(r.violation).toBeNull();
  });

  it("tolerates whitespace and case differences", () => {
    const r = verifyQuote(
      {
        verdict: "corroborated",
        quote: "Solving  Story-Based\nProblems",
        narrativeId: "n1",
      },
      narratives,
    );
    expect(r.verdict).toBe("corroborated");
  });

  it("downgrades a fabricated quote instead of trusting it", () => {
    const r = verifyQuote(
      {
        verdict: "corroborated",
        quote: "the teacher is concerned about his progress",
        narrativeId: "n1",
      },
      narratives,
    );
    expect(r.verdict).toBe("not_mentioned");
    expect(r.violation).toBe("QUOTE_NOT_FOUND");
  });

  it("downgrades when the narrative does not exist", () => {
    const r = verifyQuote(
      { verdict: "conflicting", quote: "anything", narrativeId: "ghost" },
      narratives,
    );
    expect(r.verdict).toBe("not_mentioned");
    expect(r.violation).toBe("NARRATIVE_NOT_FOUND");
  });

  it("leaves not_mentioned alone", () => {
    const r = verifyQuote(
      { verdict: "not_mentioned", quote: null, narrativeId: null },
      narratives,
    );
    expect(r.verdict).toBe("not_mentioned");
    expect(r.violation).toBeNull();
  });
});
