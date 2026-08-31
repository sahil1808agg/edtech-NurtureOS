import { NextResponse } from 'next/server';
import { routeClient, currentUser } from '../../../lib/db/server';
import { serviceClient } from '../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Adds a child to the caller's family, and records consent in the same request.
 *
 * The two are deliberately not separable: a child with no consent row is a child
 * nothing can be done with, and the PRD's gate is that no processing happens
 * without a live consent. Capturing it at the moment the parent adds the child
 * is the only point where the person granting it is unambiguously present.
 *
 * grant_child_consent derives family_id from the child rather than taking it
 * from the caller, so a mismatched consent cannot be created at all.
 */
export async function POST(request: Request) {
  const db = await routeClient();
  const user = await currentUser(db);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
  const dob = typeof body?.dob === 'string' ? body.dob : '';
  const grade = typeof body?.grade === 'string' ? body.grade.trim() : '';
  const consentGiven = body?.consent === true;

  if (!firstName) return NextResponse.json({ error: 'Your child’s first name is required.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return NextResponse.json({ error: 'A date of birth is required.' }, { status: 400 });
  }
  if (new Date(dob) > new Date()) {
    return NextResponse.json({ error: 'That date of birth is in the future.' }, { status: 400 });
  }
  if (!grade) return NextResponse.json({ error: 'A class or grade is required.' }, { status: 400 });
  if (!consentGiven) {
    return NextResponse.json(
      { error: 'We cannot analyse a report without your consent for this child.' },
      { status: 400 },
    );
  }

  const admin = serviceClient();

  const { data: child, error: childError } = await admin
    .from('children')
    .insert({ family_id: user.familyId, first_name: firstName, dob, grade })
    .select('id')
    .single();

  if (childError || !child) {
    return NextResponse.json({ error: `Could not add your child: ${childError?.message}` }, { status: 500 });
  }

  const { error: consentError } = await admin.rpc('grant_child_consent', {
    p_child_id: child.id,
    p_granted_by: user.id,
    p_method: 'parent_web_form',
    p_purposes: ['report_analysis', 'plan_generation'],
  });

  if (consentError) {
    // A child we cannot act on is worse than no child — do not leave one behind.
    await admin.from('children').delete().eq('id', child.id);
    return NextResponse.json(
      { error: `Could not record consent: ${consentError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ childId: child.id }, { status: 201 });
}
