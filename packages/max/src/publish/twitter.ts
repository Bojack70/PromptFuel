/**
 * Twitter/X posting via API v2 with OAuth 1.0a user-context auth.
 */

import { buildOAuthHeader } from '../util/oauth.js';
import { generateContent } from '../content/gemini.js';
import type { MaxConfig } from '../config.js';

const TWEETS_URL = 'https://api.twitter.com/2/tweets';
const MAX_RETRIES = 3;

export interface TweetResult {
  id: string;
  text: string;
}

export async function postTweet(
  text: string,
  config: MaxConfig,
): Promise<TweetResult> {
  const auth = buildOAuthHeader('POST', TWEETS_URL, {
    consumerKey: config.twitterApiKey,
    consumerSecret: config.twitterApiSecret,
    accessToken: config.twitterAccessToken,
    accessTokenSecret: config.twitterAccessTokenSecret,
  });

  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitter API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { id: data.data.id, text: data.data.text };
}

/**
 * Generate a tweet via Gemini and ensure it fits within 280 chars.
 * Retries with stricter instructions if the first attempt is too long.
 * Returns the text only — does NOT post.
 */
export async function generateTweet(
  prompt: string,
  geminiApiKey: string,
): Promise<string> {
  let text = await generateContent(geminiApiKey, prompt, {
    temperature: 0.9,
    maxTokens: 150,
  });

  for (let attempt = 1; attempt <= MAX_RETRIES && text.length > 280; attempt++) {
    console.warn(`[Max] Tweet attempt ${attempt} was ${text.length} chars, retrying...`);
    text = await generateContent(
      geminiApiKey,
      `${prompt}\n\nIMPORTANT: Your previous attempt was ${text.length} characters. The ABSOLUTE MAXIMUM is 280 characters. Be much more concise.`,
      { temperature: 0.7, maxTokens: 100 },
    );
  }

  if (text.length > 280) {
    const truncated = text.slice(0, 277);
    text = truncated.slice(0, truncated.lastIndexOf(' ')) + '...';
    console.warn(`[Max] Tweet force-truncated to ${text.length} chars`);
  }

  return text;
}
