import { NextResponse } from 'next/server';
import { serviceClient } from '../../../../lib/db/clients';

export const runtime = 'nodejs';

/**
 * Creates a parent account.
 *
 * Server-side because provisioning is more than an auth user: create_family_account
 * makes the family, profile and constraints in one transaction, and it is
 * SECURITY DEFINER granted only to service_role. A profile without a family is a
 * broken account, so the client cannot be trusted to do this in two steps.
 *
 * TODO before launch: the address is auto-confirmed, so nobody proves they own
 * it. That is only tolerable because email delivery does not exist yet — this
 * route must switch to a real confirmation flow when it does. It is also
 * unauthenticated and unthrottled, which is what signup is, but it means rate
 * limiting is a prerequisite for exposing this publicly.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';

  if (!email.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }
  if (password.length < 10) {
    return NextResponse.json({ error: 'Use a password of at least 10 characters.' }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    // Do not confirm or deny whether an address is already registered.
    const alreadyExists = /already|registered|exists/i.test(createError?.message ?? '');
    return NextResponse.json(
      { error: alreadyExists ? 'That email cannot be used. Try signing in instead.' : createError?.message },
      { status: alreadyExists ? 409 : 500 },
    );
  }

  const { error: provisionError } = await admin.rpc('create_family_account', {
    p_user_id: created.user.id,
    p_full_name: fullName || null,
  });

  if (provisionError) {
    // Leave no auth user stranded without a family — they could sign in but
    // nothing in the app would work.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: `Could not set up your account: ${provisionError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ userId: created.user.id }, { status: 201 });
}
