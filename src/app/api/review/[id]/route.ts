import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../../lib/db/server';
import { serviceClient } from '../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * One finding set, with each finding's citations resolved back to the exact
 * observation or narrative it came from. This is what makes review possible:
 * a reviewer checks the claim against its source, not against a vibe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });

  const admin = serviceClient();

  const { data: set } = await admin
    .from('finding_sets')
    .select('id, child_id, report_id, status, honesty_path, model_deployment, prompt_version, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!set) return NextResponse.json({ error: 'Finding set not found' }, { status: 404 });

  const { data: findings } = await admin
    .from('findings')
    .select('id, kind, statement, corroboration_status, corroboration_quote, position')
    .eq('finding_set_id', id)
    .order('position');

  const findingIds = (findings ?? []).map((f) => f.id);

  const { data: citations } = findingIds.length
    ? await admin
        .from('finding_citations')
        .select('finding_id, observation_id, narrative_id, quote')
        .in('finding_id', findingIds)
    : { data: [] };

  const observationIds = (citations ?? []).map((c) => c.observation_id).filter(Boolean) as string[];
  const narrativeIds = (citations ?? []).map((c) => c.narrative_id).filter(Boolean) as string[];

  const { data: observations } = observationIds.length
    ? await admin
        .from('observations')
        .select('id, raw_label, term_index, raw_value, normalised, is_ambiguous, source_ref')
        .in('id', observationIds)
    : { data: [] };

  const { data: narratives } = narrativeIds.length
    ? await admin.from('narratives').select('id, subject, text').in('id', narrativeIds)
    : { data: [] };

  const obsById = new Map((observations ?? []).map((o) => [o.id, o]));
  const narById = new Map((narratives ?? []).map((n) => [n.id, n]));

  return NextResponse.json({
    findingSet: set,
    findings: (findings ?? []).map((f) => ({
      ...f,
      citations: (citations ?? [])
        .filter((c) => c.finding_id === f.id)
        .map((c) => ({
          quote: c.quote,
          observation: c.observation_id ? obsById.get(c.observation_id) ?? null : null,
          narrative: c.narrative_id ? narById.get(c.narrative_id) ?? null : null,
        })),
    })),
  });
}
