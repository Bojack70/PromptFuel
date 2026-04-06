/**
 * Bluesky posting via AT Protocol — zero dependencies, zero cost.
 * Uses app password auth (no OAuth complexity).
 */

const BSKY_SERVICE = 'https://bsky.social';

export interface BlueskyResult {
  uri: string;
  cid: string;
  text: string;
}

interface BlueskySession {
  did: string;
  accessJwt: string;
}

async function createSession(handle: string, appPassword: string): Promise<BlueskySession> {
  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky auth failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { did: data.did, accessJwt: data.accessJwt };
}

/**
 * Detect URLs in text and create facets (rich text links) for Bluesky.
 */
function detectUrlFacets(text: string): Array<{
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri: string }>;
}> {
  const encoder = new TextEncoder();
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  const facets: Array<{
    index: { byteStart: number; byteEnd: number };
    features: Array<{ $type: string; uri: string }>;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    const beforeBytes = encoder.encode(text.slice(0, match.index)).length;
    const matchBytes = encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart: beforeBytes, byteEnd: beforeBytes + matchBytes },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
    });
  }

  return facets;
}

export async function postToBluesky(
  text: string,
  handle: string,
  appPassword: string,
): Promise<BlueskyResult> {
  const session = await createSession(handle, appPassword);

  const facets = detectUrlFacets(text);

  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
  };

  if (facets.length > 0) {
    record.facets = facets;
  }

  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky post failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { uri: data.uri, cid: data.cid, text };
}
