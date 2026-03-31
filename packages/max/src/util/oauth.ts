/**
 * OAuth 1.0a HMAC-SHA1 signing for Twitter API v2.
 * Zero dependencies — uses Node's built-in crypto module.
 */

import { createHmac, randomBytes } from 'node:crypto';

interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

export function buildOAuthHeader(
  method: string,
  url: string,
  credentials: OAuthCredentials,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: randomBytes(32).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  // For JSON body POSTs, only OAuth params + URL query params go into the signature base string
  const urlObj = new URL(url);
  const allParams: Record<string, string> = { ...oauthParams };
  urlObj.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  // Sort parameters alphabetically by key
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join('&');

  // Build base string: METHOD&url_without_query&sorted_params
  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
  const baseString = `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(sortedParams)}`;

  // Build signing key
  const signingKey = `${percentEncode(credentials.consumerSecret)}&${percentEncode(credentials.accessTokenSecret)}`;

  // HMAC-SHA1
  const signature = createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams['oauth_signature'] = signature;

  // Build Authorization header
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}
