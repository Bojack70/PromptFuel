/**
 * Environment variable loader + validation.
 * All secrets come from GitHub Actions secrets (or .env for local runs).
 *
 * Local .env lookup: checks (in order) `packages/max/.env`, then repo root
 * `.env`. First match wins. No-ops silently if none found — CI relies on
 * real environment variables set by the workflow.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

(() => {
  if (typeof process.loadEnvFile !== 'function') return; // Node < 20.12
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // After tsup bundle, this module lives at packages/max/dist/index.js,
    // so ../.env → packages/max/.env and ../../../.env → repo root /.env.
    const candidates = [join(here, '../.env'), join(here, '../../../.env')];
    for (const path of candidates) {
      if (existsSync(path)) {
        process.loadEnvFile(path);
        break;
      }
    }
  } catch {
    // Loader failures must never block — CI has no .env and that's fine.
  }
})();

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

  // Claude / Anthropic (content generation — optional, only needed for local generation)
  claudeApiKey: string; // empty string if not set

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

    claudeApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),

    blueskyHandle: optionalEnv('BLUESKY_HANDLE', ''),
    blueskyAppPassword: optionalEnv('BLUESKY_APP_PASSWORD', ''),

    redditClientId: optionalEnv('REDDIT_CLIENT_ID', ''),
    redditClientSecret: optionalEnv('REDDIT_CLIENT_SECRET', ''),
    redditUsername: optionalEnv('REDDIT_USERNAME', ''),
    redditPassword: optionalEnv('REDDIT_PASSWORD', ''),

    mastodonAccessToken: optionalEnv('MASTODON_ACCESS_TOKEN', ''),
    mastodonInstanceUrl: optionalEnv('MASTODON_INSTANCE_URL', 'https://fosstodon.org'),

    devtoApiKey: requireEnv('DEVTO_API_KEY'),

    // Default data dir: packages/max/data. After tsup bundle, this module
    // ships inside packages/max/dist/index.js, so `../data` resolves to
    // packages/max/data. fileURLToPath() decodes %20 etc. (the source-path
    // module lives at packages/max/src/config.ts, so `../../data` WAS
    // correct pre-bundle — the bundle flattened it by one level).
    dataDir: optionalEnv('MAX_DATA_DIR', fileURLToPath(new URL('../data', import.meta.url))),
  };
}
