import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDefinitionForModel } from '../llm/types.js';

/**
 * The chat model's allowlisted write access — never raw SQL, never an
 * unscoped DB client. Each tool is dispatched to an existing, validated
 * db/*.ts function by src/server/chat/dispatch.ts. These are the
 * direct-apply tools; an orchestrator turn hands a narrower subset of them
 * to whichever agent it calls (see REPORT_AGENT_TOOLS/PLANNING_AGENT_TOOLS
 * below and src/server/chat/orchestrator-dispatch.ts). See
 * docs/engineering/engineering-doc.md §3, docs/specs/03-direct-apply-tools.md
 * and docs/specs/08-orchestrator-chat.md.
 */

export const EditFindingStatementArgs = z.object({
  findingId: z.string().uuid(),
  newStatement: z.string().min(1).max(500),
});

export const ExcludeFindingArgs = z.object({ findingId: z.string().uuid() });
export const RestoreFindingArgs = z.object({ findingId: z.string().uuid() });

export const EditPlanActivityArgs = z
  .object({
    activityId: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    instructions: z.string().min(1).max(2000).optional(),
    declined: z.boolean().optional(),
  })
  .refine(a => a.title !== undefined || a.instructions !== undefined || a.declined !== undefined, {
    message: 'at least one field to change',
  });

// No childId field: the model is never told the child's internal id (only
// its name, via ChildContext), so asking it to supply one as an argument
// just invites a hallucinated placeholder — this tool always targets
// ToolDispatchContext.childId, the conversation's own child, instead.
export const RegeneratePlanArgs = z.object({});
export const RequestReportReanalysisArgs = z.object({ reportId: z.string().uuid() });
export const FindNearbyResourcesArgs = z.object({
  query: z.string().min(1).max(200),
});

export const TOOL_SCHEMAS = {
  edit_finding_statement: EditFindingStatementArgs,
  exclude_finding: ExcludeFindingArgs,
  restore_finding: RestoreFindingArgs,
  edit_plan_activity: EditPlanActivityArgs,
  regenerate_plan: RegeneratePlanArgs,
  request_report_reanalysis: RequestReportReanalysisArgs,
  find_nearby_resources: FindNearbyResourcesArgs,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  edit_finding_statement: "Reword a finding's statement. The model's original wording is preserved.",
  exclude_finding: 'Drop a finding from the active set; it stops being used for plans.',
  restore_finding: 'Bring a previously excluded finding back into the active set.',
  edit_plan_activity: "Change an activity's title/instructions, or mark it declined.",
  regenerate_plan: "Re-run plan generation for the child's current active findings.",
  request_report_reanalysis: 'Re-run finding analysis for a report. Queues the work; does not block the reply.',
  find_nearby_resources:
    "Look up real nearby places/classes/activities (e.g. swimming classes, library storytime) near the child's home, via Google Places. Falls back gracefully if there's no location on file or the lookup fails.",
};

function toolDefinitionsFor(names: readonly ToolName[]): ToolDefinitionForModel[] {
  return names.map(name => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: zodToJsonSchema(TOOL_SCHEMAS[name]),
  }));
}

/** JSON-schema form of every direct-apply tool — kept for completeness; agents use the narrower lists below. */
export const TOOL_DEFINITIONS_FOR_MODEL: ToolDefinitionForModel[] = toolDefinitionsFor(Object.keys(TOOL_SCHEMAS) as ToolName[]);

// ---------- Per-agent tool lists (docs/specs/08-orchestrator-chat.md) ----------

export const REPORT_AGENT_TOOLS: readonly ToolName[] = [
  'edit_finding_statement',
  'exclude_finding',
  'restore_finding',
  'request_report_reanalysis',
];

export const PLANNING_AGENT_TOOLS: readonly ToolName[] = ['edit_plan_activity', 'regenerate_plan', 'find_nearby_resources'];

export const REPORT_AGENT_TOOL_DEFINITIONS_FOR_MODEL: ToolDefinitionForModel[] = toolDefinitionsFor(REPORT_AGENT_TOOLS);
export const PLANNING_AGENT_TOOL_DEFINITIONS_FOR_MODEL: ToolDefinitionForModel[] = toolDefinitionsFor(PLANNING_AGENT_TOOLS);

// ---------- Orchestrator's own tools: the three agents it can hand a turn to ----------
//
// Each agent tool takes just the parent's intent in its own words — the agent
// gets the same ChildContext (findings/plan summary) already loaded once per
// turn, threaded in by orchestrator-dispatch.ts, not reloaded per agent call.

export const AgentCallArgs = z.object({
  question: z.string().min(1).max(2000),
});

export const AGENT_NAMES = ['report_analysis_agent', 'planning_agent', 'generic_agent'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

const AGENT_DESCRIPTIONS: Record<AgentName, string> = {
  report_analysis_agent:
    "Hand off to the report-analysis agent for anything about the child's reports or findings — strengths, gaps, opportunities, or editing/excluding a finding.",
  planning_agent:
    "Hand off to the planning agent for anything about the child's home-activity plan, or for nearby activities/classes/resources.",
  generic_agent: "Hand off to the generic agent for ordinary parenting/education advice not tied to this child's specific data.",
};

export const AGENT_TOOL_DEFINITIONS_FOR_MODEL: ToolDefinitionForModel[] = AGENT_NAMES.map(name => ({
  name,
  description: AGENT_DESCRIPTIONS[name],
  parameters: zodToJsonSchema(AgentCallArgs),
}));
