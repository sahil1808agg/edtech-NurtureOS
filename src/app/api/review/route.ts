import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../lib/db/server';
import { serviceClient } from '../../../lib/db/clients';

export const runtime = 'nodejs';

/** Pending review queue. Ops only — this crosses family boundaries by design. */
export async function GET() {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.isOps) return NextResponse.json({ error: 'Not authorised' }, { status: 403 });

  const admin = serviceClient();

  const { data: queue, error } = await admin
    .from('review_queue')
    .select('id, artifact_type, artifact_id, status, created_at')
    .eq('status', 'in_review')
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const setIds = (queue ?? []).filter((q) => q.artifact_type === 'finding_set').map((q) => q.artifact_id);

  const { data: sets } = setIds.length
    ? await admin
        .from('finding_sets')
        .select('id, child_id, report_id, honesty_path, model_deployment, prompt_version, created_at')
        .in('id', setIds)
    : { data: [] };

  const byId = new Map((sets ?? []).map((s) => [s.id, s]));

  return NextResponse.json({
    items: (queue ?? []).map((q) => ({
      queueId: q.id,
      artifactType: q.artifact_type,
      artifactId: q.artifact_id,
      createdAt: q.created_at,
      findingSet: byId.get(q.artifact_id) ?? null,
    })),
  });
}
