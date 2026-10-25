import { Resend } from 'resend';

/**
 * Thin wrapper around Resend — the provider named first in
 * docs/engineering/engineering-doc.md's "Resend or Azure Communication
 * Services" intent. EMAIL_PROVIDER_API_KEY/EMAIL_FROM were placeholder env
 * vars until now; this is the first code that actually reads them.
 */
let client: Resend | null = null;

function resendClient(): Resend {
  const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  if (!apiKey) throw new Error('EMAIL_PROVIDER_API_KEY is not set');
  client ??= new Resend(apiKey);
  return client;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set');

  const { error } = await resendClient().emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (error) throw new Error(`sending email to ${input.to}: ${error.message}`);
}
