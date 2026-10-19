import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../../lib/db/server';

export const runtime = 'nodejs';

/**
 * Findings for a report, each with the observations (page, label, value) that
 * back it — the same data /reports/[id] shows under "Where this comes from",
 * served as JSON so the chat evidence panel can show it without navigating
 * away. See docs/specs/08-orchestrator-chat.md (evidence-in-chat addendum).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let reportQuery = db.from('reports').select('id, family_id').eq('id', id);
  if (!user.isOps) reportQuery = reportQuery.eq('family_id', user.familyId);
  const { data: report } = await reportQuery.maybeSingle();
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  const { data: findingSet } = await db
    .from('finding_sets')
    .select('id, status')
    .eq('report_id', id)
    .in('status', ['draft', 'in_review', 'published'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Mirrors ReportPage's visibility rule: a draft is visible to the owning
  // family (reviewing) or to ops (auditing), but not to anyone else.
  const ownsReport = report.family_id === user.familyId;
  const visible = Boolean(findingSet && (findingSet.status === 'published' || ownsReport || user.isOps));
  if (!findingSet || !visible) return NextResponse.json({ findings: [] });

  const { data: findings } = await db
    .from('findings')
    .select('id, kind, statement, excluded, corroboration_status, position')
    .eq('finding_set_id', findingSet.id)
    .eq('excluded', false)
    .neq('corroboration_status', 'conflicting')
    .order('position');

  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: citations } = findingIds.length
    ? await db.from('finding_citations').select('finding_id, observation_id').in('finding_id', findingIds)
    : { data: [] };

  const obsIds = (citations ?? []).map((c) => c.observation_id).filter(Boolean) as string[];
  const { data: observations } = obsIds.length
    ? await db.from('observations').select('id, raw_label, term_index, raw_value, source_ref').in('id', obsIds)
    : { data: [] };
  const obsById = new Map((observations ?? []).map((o) => [o.id, o]));

  const result = (findings ?? []).map((f) => ({
    id: f.id,
    kind: f.kind,
    statement: f.statement,
    citations: (citations ?? [])
      .filter((c) => c.finding_id === f.id)
      .map((c) => (c.observation_id ? obsById.get(c.observation_id) : null))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))
      .map((o) => ({
        observationId: o.id,
        label: o.raw_label as string,
        termIndex: o.term_index as number,
        value: (o.raw_value as string | null) ?? null,
        page: (o.source_ref as { page?: number } | null)?.page ?? null,
      })),
  }));

  return NextResponse.json({ findings: result });
}
