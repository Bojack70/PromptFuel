/**
 * Email delivery via Resend REST API — zero dependencies.
 */

const RESEND_URL = 'https://api.resend.com/emails';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(
  apiKey: string,
  options: EmailOptions,
): Promise<{ id: string }> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Max Agent <max@promptfuel.dev>',
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API ${res.status}: ${body}`);
  }

  return res.json();
}
