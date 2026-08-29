/**
 * Shared contracts for the pipeline stages.
 * See docs/engineering/low-level-design.md §1.
 */

export interface SourceRef {
  page: number;
  table?: number;
  row?: number;
  cell?: number;
}

export interface CallMeta {
  promptVersion: string;
  modelDeployment: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type StageError =
  | { code: "SCHEMA_INVALID"; detail: string }
  | { code: "LOW_CONFIDENCE"; field: string; confidence: number }
  | { code: "UNKNOWN_TEMPLATE" }
  | { code: "SEN_DETECTED"; indicators: string[] }
  | { code: "PROVIDER_ERROR"; status: number; retryable: boolean }
  | { code: "TIMEOUT" };

export type StageResult<T> =
  | { ok: true; value: T; meta: CallMeta }
  | { ok: false; error: StageError; meta?: CallMeta };

/** A single normalised data point about a child. */
export interface ObservationRow {
  id: string;
  reportId: string;
  skillId: string | null;
  rawLabel: string;
  scaleId: string;
  termIndex: number;
  rawValue: string | null;
  /** null when the source cell was a dash, blank, or not assessed */
  normalised: number | null;
  isAmbiguous: boolean;
  confidence: number;
  sourceRef: SourceRef;
}

export interface NarrativeRow {
  id: string;
  reportId: string;
  subject: string | null;
  text: string;
}

/** Output of Analyse. Not yet a finding — it has not passed the gates. */
export interface CandidateClaim {
  kind: "strength" | "growth";
  statement: string;
  citedObservationIds: string[];
  /** logged for evaluation, never shown to a parent */
  reasoning: string;
}

export type CorroborationVerdict =
  | "corroborated"
  | "not_mentioned"
  | "conflicting";

export interface CorroborationResult {
  verdict: CorroborationVerdict;
  quote: string | null;
  narrativeId: string | null;
}
