import type { SupabaseClient } from '@supabase/supabase-js';

/** Report statuses that mean the pipeline is still working on it. */
export const REPORT_IN_PROGRESS = ['uploaded', 'extracted', 'normalised', 'analysed', 'in_review'];

export const REPORT_STAGE: Record<string, string> = {
  uploaded: 'Reading the report',
  extracted: 'Matching skills',
  normalised: 'Looking for patterns',
  analysed: 'Checking against the teacher’s comments',
  in_review: 'Waiting for a person to review',
  published: 'Ready',
  held: 'Not enough to go on',
  failed: 'Could not be read',
};

export interface JourneyReport {
  id: string;
  status: string;
  term_label: string | null;
  academic_year: string | null;
  created_at: string;
}

export interface JourneyPlan {
  id: string;
  cycle_no: number;
  status: string;
  created_at: string;
}

export interface ChildJourney {
  reports: JourneyReport[];
  plans: JourneyPlan[];
  /** The plan the parent sees: newest ready one, else newest non-rejected. */
  shownPlan: JourneyPlan | null;
  planReady: boolean;
  reportInProgress: boolean;
  hasPublishedReport: boolean;
  planError: string | null;
  /**
   * A published report but no plan and no recorded failure — publishing
   * queues plan generation automatically (maybeQueuePlanGeneration), so the
   * plan is on its way.
   */
  planExpected: boolean;
}

const isReady = (s: string) => s === 'approved' || s === 'published';

/**
 * Where a parent is in the journey for one child: add child → upload report →
 * plan → Today. Shared by the Today tab's step tracker and the Report & plan
 * tab so both describe the same state the same way.
 */
export async function loadChildJourney(db: SupabaseClient, childId: string, familyId: string): Promise<ChildJourney> {
  const [{ data: reports }, { data: plans }, { data: child }] = await Promise.all([
    db
      .from('reports')
      .select('id, status, term_label, academic_year, created_at')
      .eq('child_id', childId)
      .eq('family_id', familyId)
      .order('created_at', { ascending: false }),
    db
      .from('plans')
      .select('id, cycle_no, status, created_at')
      .eq('child_id', childId)
      .eq('family_id', familyId)
      .order('cycle_no', { ascending: false }),
    db.from('children').select('plan_error').eq('id', childId).eq('family_id', familyId).maybeSingle(),
  ]);

  const reportList = (reports ?? []) as JourneyReport[];
  const planList = (plans ?? []) as JourneyPlan[];
  const shownPlan =
    planList.find((p) => isReady(p.status)) ?? planList.find((p) => p.status !== 'rejected') ?? null;
  const planReady = shownPlan !== null && isReady(shownPlan.status);
  const hasPublishedReport = reportList.some((r) => r.status === 'published');
  const planError = (child?.plan_error as string | null | undefined) ?? null;

  return {
    reports: reportList,
    plans: planList,
    shownPlan,
    planReady,
    reportInProgress: reportList.some((r) => REPORT_IN_PROGRESS.includes(r.status)),
    hasPublishedReport,
    planError,
    planExpected: hasPublishedReport && !shownPlan && !planError,
  };
}
