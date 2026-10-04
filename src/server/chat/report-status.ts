import { getFindingsForChat } from '../db/findings.js';
import { getLatestAttachedReportId } from '../db/messages.js';
import { getReport } from '../db/reports.js';
import { buildFailureMessageForChat } from './summarize.js';
import type { TargetFinding } from '../db/plans.js';

/**
 * Resolves the "not there yet" case for the report-analysis agent: a report
 * was just uploaded in this conversation and either hasn't finished
 * processing, hasn't been reviewed yet, or (rare) was never enqueued at all.
 * Deterministic — the agent relays `statusNote` rather than guessing or
 * re-deriving claims from raw observations, which would bypass
 * citationGate/corroborate.ts. See docs/specs/08-orchestrator-chat.md.
 */
export interface ReportAgentContext {
  findings: TargetFinding[];
  /** Plain-language note to give the agent when there's nothing to ground on yet. Null once findings exist. */
  statusNote: string | null;
  /** Set when a report's analyse job was orphaned and this call just re-enqueued it. */
  reanalysisRequestedForReportId: string | null;
}

const MID_PIPELINE_STATUSES = new Set(['uploaded', 'extracted', 'normalised']);

export async function loadReportAgentContext(childId: string, conversationId: string): Promise<ReportAgentContext> {
  const findings = await getFindingsForChat(childId);
  if (findings.length > 0) {
    return { findings, statusNote: null, reanalysisRequestedForReportId: null };
  }

  const reportId = await getLatestAttachedReportId(conversationId);
  if (!reportId) {
    return { findings, statusNote: null, reanalysisRequestedForReportId: null };
  }

  const report = await getReport(reportId);

  if (MID_PIPELINE_STATUSES.has(report.status)) {
    return {
      findings,
      statusNote: "The most recently uploaded report is still being processed — analysis hasn't finished yet.",
      reanalysisRequestedForReportId: null,
    };
  }

  if (report.status === 'failed' || report.status === 'held') {
    return { findings, statusNote: buildFailureMessageForChat(report.status), reanalysisRequestedForReportId: null };
  }

  // report.status implies analyse should already have produced a finding set
  // (analysed/in_review/published) but getFindingsForChat found none — an
  // orphaned row (analyse never enqueued, or its finding_set never landed).
  // Shouldn't happen via the chat-attachment path, which always enqueues
  // (docs/specs/02-report-attachment.md), but could via a stale row.
  return {
    findings,
    statusNote: "That report's analysis seems to have stalled — I've asked for it to be run again.",
    reanalysisRequestedForReportId: reportId,
  };
}
