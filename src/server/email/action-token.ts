import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signs a one-click email action link. Stateless, unlike the checkins
 * design this mirrors (docs/engineering/low-level-design.md) — no DB row to
 * mark used, because the actions these tokens authorize (mark an activity
 * done/snoozed/declined, unsubscribe) are already idempotent through
 * updatePlanActivity/setEmailOptOut, so a token replayed before it expires
 * just re-applies the same state rather than double-counting anything.
 *
 * The signed token is the authorization — these routes are otherwise
 * unauthenticated, same as the checkins design (no session, so no cookie to
 * check).
 */
export interface ActionTokenPayload {
  action: string;
  /** The id the action applies to — an activity id, or a profile id for unsubscribe. */
  targetId: string;
  /** Unix seconds. */
  exp: number;
}

function secret(): string {
  const value = process.env.EMAIL_ACTION_TOKEN_SECRET;
  if (!value) throw new Error('EMAIL_ACTION_TOKEN_SECRET is not set');
  return value;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function signActionToken(payload: ActionTokenPayload): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns the payload if the signature is valid and it hasn't expired, otherwise null. */
export function verifyActionToken(token: string): ActionTokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

/** ~36h — long enough for a parent to act on the morning email that evening, short enough that a days-old email can't act unexpectedly. */
export function actionTokenExpiry(fromDate: Date = new Date()): number {
  return Math.floor(fromDate.getTime() / 1000) + 36 * 60 * 60;
}
