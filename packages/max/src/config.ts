/**
 * Environment variable loader + validation.
 * All secrets come from GitHub Actions secrets (or .env for local testing).
 */

export interface MaxConfig {
  // GitHub
  githubToken: string;
  githubOwner: string;
  githubRepo: string;

  // npm package names to track
  npmPackages: string[];

  // Resend (email)
  resendApiKey: string;
  reportEmail: string;

  // Claude / Anthropic (content generation)
  claudeApiKey: string;

  // Bluesky
  blueskyHandle: string;
  blueskyAppPassword: string;

  // Reddit
  redditClientId: string;
  redditClientSecret: string;
  redditUsername: string;
  redditPassword: string;

  // Mastodon
  mastodonAccessToken: string;
  mastodonInstanceUrl: string;

  // Dev.to
  devtoApiKey: string;

  // Paths
  dataDir: string;
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function loadConfig(): MaxConfig {
  return {
    githubToken: requireEnv('GITHUB_TOKEN'),
    githubOwner: optionalEnv('GITHUB_OWNER', 'Bojack70'),
    githubRepo: optionalEnv('GITHUB_REPO', 'PromptFuel'),

    npmPackages: [
      'promptfuel',
      '@promptfuel/core',
      '@promptfuel/mcp',
      '@promptfuel/sdk',
    ],

    resendApiKey: requireEnv('RESEND_API_KEY'),
    reportEmail: requireEnv('REPORT_EMAIL'),

    claudeApiKey: requireEnv('ANTHROPIC_API_KEY'),

    blueskyHandle: optionalEnv('BLUESKY_HANDLE', ''),
    blueskyAppPassword: optionalEnv('BLUESKY_APP_PASSWORD', ''),

    redditClientId: optionalEnv('REDDIT_CLIENT_ID', ''),
    redditClientSecret: optionalEnv('REDDIT_CLIENT_SECRET', ''),
    redditUsername: optionalEnv('REDDIT_USERNAME', ''),
    redditPassword: optionalEnv('REDDIT_PASSWORD', ''),

    mastodonAccessToken: optionalEnv('MASTODON_ACCESS_TOKEN', ''),
    mastodonInstanceUrl: optionalEnv('MASTODON_INSTANCE_URL', 'https://fosstodon.org'),

    devtoApiKey: requireEnv('DEVTO_API_KEY'),

    dataDir: optionalEnv('MAX_DATA_DIR', new URL('../../data', import.meta.url).pathname),
  };
}
