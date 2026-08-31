import { serviceClient } from '../../lib/db/clients.js';

/**
 * Puts an artifact into the review queue. Idempotent on (artifact_type,
 * artifact_id), so a re-run of the producing job does not create a second
 * review task for the same finding set.
 */
export async function enqueueForReview(
  artifactType: 'finding_set' | 'plan',
  artifactId: string,
): Promise<void> {
  const { error } = await serviceClient()
    .from('review_queue')
    .upsert(
      { artifact_type: artifactType, artifact_id: artifactId, status: 'in_review' },
      { onConflict: 'artifact_type,artifact_id', ignoreDuplicates: true },
    );

  if (error) throw new Error(`enqueuing ${artifactType} ${artifactId} for review: ${error.message}`);
}
