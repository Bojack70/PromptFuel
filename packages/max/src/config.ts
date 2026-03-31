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

  // Dub.co (link tracking)
  dubApiKey: string;

  // Gemini (content generation)
  geminiApiKey: string;

  // Twitter / X
  twitterApiKey: string;
  twitterApiSecret: string;
  twitterAccessToken: string;
  twitterAccessTokenSecret: string;

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

    dubApiKey: optionalEnv('DUB_API_KEY', ''),

    geminiApiKey: requireEnv('GEMINI_API_KEY'),

    twitterApiKey: requireEnv('TWITTER_API_KEY'),
    twitterApiSecret: requireEnv('TWITTER_API_SECRET'),
    twitterAccessToken: requireEnv('TWITTER_ACCESS_TOKEN'),
    twitterAccessTokenSecret: requireEnv('TWITTER_ACCESS_TOKEN_SECRET'),

    devtoApiKey: requireEnv('DEVTO_API_KEY'),

    dataDir: optionalEnv('MAX_DATA_DIR', new URL('../../data', import.meta.url).pathname),
  };
}
