/**
 * Reddit posting via OAuth2 "script" app — zero cost, zero dependencies.
 * Uses password grant (script-type apps don't need user redirect flow).
 *
 * Setup: Create a Reddit app at https://www.reddit.com/prefs/apps/
 *   - Type: "script"
 *   - Redirect URI: http://localhost (unused for script apps)
 *   - Save the client ID and secret
 */

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const SUBMIT_URL = 'https://oauth.reddit.com/api/submit';
const USER_AGENT = 'PromptFuel-Max/0.1.0 (by /u/natevoss)';

export interface RedditResult {
  id: string;
  url: string;
  name: string;
}

interface RedditAuth {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

async function getAccessToken(auth: RedditAuth): Promise<string> {
  const credentials = Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: auth.username,
      password: auth.password,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit auth failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`Reddit auth error: ${data.error}`);
  }
  return data.access_token;
}

/**
 * Post a self-text submission to a subreddit.
 */
export async function postToReddit(
  subreddit: string,
  title: string,
  body: string,
  auth: RedditAuth,
): Promise<RedditResult> {
  const token = await getAccessToken(auth);

  const res = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      sr: subreddit,
      kind: 'self',
      title,
      text: body,
      api_type: 'json',
    }),
  });

  if (!res.ok) {
    const resBody = await res.text();
    throw new Error(`Reddit submit failed ${res.status}: ${resBody}`);
  }

  const data = await res.json();
  const errors = data.json?.errors;
  if (errors && errors.length > 0) {
    throw new Error(`Reddit submit errors: ${JSON.stringify(errors)}`);
  }

  const things = data.json?.data?.things;
  if (things && things.length > 0) {
    const post = things[0].data;
    return { id: post.id, url: `https://reddit.com${post.permalink}`, name: post.name };
  }

  // Fallback: some endpoints return differently
  const postData = data.json?.data;
  return {
    id: postData?.id ?? 'unknown',
    url: postData?.url ?? `https://reddit.com/r/${subreddit}`,
    name: postData?.name ?? 'unknown',
  };
}

/**
 * Subreddits to rotate through — one per week.
 * Ordered by relevance to PromptFuel's audience.
 */
export const TARGET_SUBREDDITS = [
  'webdev',
  'programming',
  'ChatGPT',
  'LocalLLaMA',
  'node',
  'javascript',
];

export function pickSubreddit(weekNumber: number): string {
  return TARGET_SUBREDDITS[weekNumber % TARGET_SUBREDDITS.length];
}
