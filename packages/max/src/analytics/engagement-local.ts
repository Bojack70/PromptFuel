/**
 * Cross-platform engagement collector — orchestrates the OpenTabs scrapers
 * for Medium / Substack / Twitter and writes results to data/engagement-local.json.
 *
 * "Local" because OpenTabs requires a logged-in Brave session — cannot run in
 * CI. Invoked from the weekly brain's local Monday pass, or manually via
 * `--mode collect-engagement-local`.
 *
 * The separate file (vs. existing engagement.json) keeps the CI-collected
 * Bluesky/Dev.to metrics clean from local-only scrapes that might have stale
 * selectors.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchMediumEngagement, type MediumEngagement } from './medium-engagement.js';
import { fetchSubstackEngagement, type SubstackEngagement } from './substack-engagement.js';
import { fetchTwitterEngagement, type TwitterEngagement } from './twitter-engagement.js';

const FILE = 'engagement-local.json';

export interface LocalEngagementSnapshot {
  collectedAt: string;
  date: string;
  medium: MediumEngagement | null;
  substack: SubstackEngagement | null;
  twitter: TwitterEngagement | null;
}

export interface LocalEngagementLog {
  snapshots: LocalEngagementSnapshot[];
}

export interface CollectLocalOptions {
  dataDir: string;
  handles: {
    medium: string;    // e.g. "natevoss.dev"
    substack: string;  // subdomain, e.g. "natevoss"
    twitter: string;   // e.g. "natevoss"
  };
  dryRun?: boolean;
  only?: 'medium' | 'substack' | 'twitter';  // limit to a single platform for testing
}

export function loadLocalEngagement(dataDir: string): LocalEngagementLog {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return { snapshots: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { snapshots: [] };
  }
}

export function saveLocalEngagement(dataDir: string, log: LocalEngagementLog): void {
  writeFileSync(join(dataDir, FILE), JSON.stringify(log, null, 2));
}

export async function collectLocalEngagement(opts: CollectLocalOptions): Promise<LocalEngagementSnapshot> {
  const { dataDir, handles, dryRun = false, only } = opts;
  const today = new Date().toISOString().split('T')[0];

  let medium: MediumEngagement | null = null;
  let substack: SubstackEngagement | null = null;
  let twitter: TwitterEngagement | null = null;

  if (!only || only === 'medium') {
    try {
      console.log('[Max][engagement-local] Medium...');
      medium = await fetchMediumEngagement({ handle: handles.medium, dataDir, dryRun });
    } catch (err) {
      console.warn('[Max][engagement-local] Medium scrape failed:', (err as Error).message);
    }
  }

  if (!only || only === 'substack') {
    try {
      console.log('[Max][engagement-local] Substack...');
      substack = await fetchSubstackEngagement({ handle: handles.substack, dataDir, dryRun });
    } catch (err) {
      console.warn('[Max][engagement-local] Substack scrape failed:', (err as Error).message);
    }
  }

  if (!only || only === 'twitter') {
    try {
      console.log('[Max][engagement-local] Twitter...');
      twitter = await fetchTwitterEngagement({ handle: handles.twitter, dataDir, dryRun });
    } catch (err) {
      console.warn('[Max][engagement-local] Twitter scrape failed:', (err as Error).message);
    }
  }

  const snapshot: LocalEngagementSnapshot = {
    collectedAt: new Date().toISOString(),
    date: today,
    medium,
    substack,
    twitter,
  };

  if (!dryRun) {
    const log = loadLocalEngagement(dataDir);
    log.snapshots.push(snapshot);
    // Keep last 26 weeks of snapshots so the file doesn't grow unbounded
    log.snapshots = log.snapshots.slice(-26);
    saveLocalEngagement(dataDir, log);
  }

  return snapshot;
}
