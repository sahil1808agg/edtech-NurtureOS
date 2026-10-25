import { verifyActionToken } from '../../../../server/email/action-token';
import { setEmailOptOut } from '../../../../server/db/profiles';

export const runtime = 'nodejs';

function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>NurtureOS</title></head>` +
      `<body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/**
 * Unlike /api/email/activity-action, this acts directly on GET with no
 * confirm-then-POST step — standard practice for unsubscribe links, and
 * unlike marking an activity done/removed, a mail client prefetching this
 * link and accidentally unsubscribing someone is low-stakes and reversible
 * (they just stop getting an email; nothing in their plan changes).
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const payload = verifyActionToken(token);
  if (!payload || payload.action !== 'unsubscribe') {
    return page('<p>This link has expired or is no longer valid.</p>');
  }

  await setEmailOptOut(payload.targetId, true);
  return page("<p>You've been unsubscribed from daily activity emails.</p>");
}
