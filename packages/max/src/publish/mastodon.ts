/**
 * Mastodon posting via REST API — zero dependencies, zero cost.
 * Uses an application access token (created in Mastodon web UI:
 * Settings > Development > New Application > write:statuses scope).
 *
 * Default instance: fosstodon.org (FOSS/developer community).
 * 500 character limit.
 */

const DEFAULT_INSTANCE = 'https://fosstodon.org';

export interface MastodonResult {
  id: string;
  url: string;
  text: string;
}

export async function postToMastodon(
  text: string,
  accessToken: string,
  instanceUrl: string = DEFAULT_INSTANCE,
): Promise<MastodonResult> {
  const res = await fetch(`${instanceUrl}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mastodon post failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { id: data.id, url: data.url, text };
}
