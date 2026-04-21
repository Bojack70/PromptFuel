/**
 * Daily trend fetcher — pulls top HN stories to a running log.
 *
 * Hacker News is the densest signal for "what's hot in dev/AI/startup right now"
 * and its API is free, unauthenticated, and rate-friendly. Other sources
 * (Reddit, Bluesky trending) can be added later; HN alone is enough signal
 * for the tech-ai bucket, which is the only bucket where trend-peg matters.
 *
 * Life-reflection, philosophy, parenting posts don't need news hooks — they're
 * meant to feel timeless. The reader corpus already handles evergreen signal
 * for those buckets.
 *
 * Runs daily in CI via `--mode fetch-trends`. Weekly brain synthesises the
 * week's headlines into themes that inject into tech-ai generation prompts.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = 'trends-log.json';

export interface TrendEntry {
  date: string;        // YYYY-MM-DD fetched
  source: 'hn';
  title: string;
  url?: string;        // external article url; falls back to HN item page if missing
  score: number;
  comments?: number;
  itemId: number;      // HN item id, used for dedup
}

export interface TrendsLog {
  entries: TrendEntry[];
}

export function loadTrendsLog(dataDir: string): TrendsLog {
  const file = join(dataDir, LOG_FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

export function saveTrendsLog(dataDir: string, log: TrendsLog): void {
  writeFileSync(join(dataDir, LOG_FILE), JSON.stringify(log, null, 2));
}

interface HNItem {
  id: number;
  title: string;
  url?: string;
  score: number;
  descendants?: number; // comment count
  type: string;
  dead?: boolean;
  deleted?: boolean;
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Max-Agent/1.0' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch the top N HN stories right now. Uses the Firebase v0 API — no auth,
 * no rate limit for our scale.
 */
export async function fetchHNTopStories(limit = 10): Promise<TrendEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const ids = await fetchJSON<number[]>('https://hacker-news.firebaseio.com/v0/topstories.json');
  if (!ids || ids.length === 0) {
    console.warn('[Max][trends] HN topstories returned empty');
    return [];
  }

  const picks = ids.slice(0, limit);
  const entries: TrendEntry[] = [];

  for (const id of picks) {
    const item = await fetchJSON<HNItem>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (!item || item.dead || item.deleted || item.type !== 'story' || !item.title) continue;
    entries.push({
      date: today,
      source: 'hn',
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      score: item.score ?? 0,
      comments: item.descendants,
      itemId: item.id,
    });
  }

  return entries;
}

/**
 * Fetch today's trends and append to the log. Skips if we already have entries
 * from today. Dedupes against prior entries by HN itemId.
 */
export async function fetchDailyTrends(dataDir: string): Promise<{ added: number; skipped: number }> {
  const log = loadTrendsLog(dataDir);
  const today = new Date().toISOString().split('T')[0];

  const alreadyToday = log.entries.some((e) => e.date === today);
  if (alreadyToday) {
    console.log('[Max][trends] Already fetched today — skipping');
    return { added: 0, skipped: 1 };
  }

  console.log('[Max][trends] Fetching HN top stories...');
  const fresh = await fetchHNTopStories(10);

  if (fresh.length === 0) {
    console.warn('[Max][trends] No stories fetched');
    return { added: 0, skipped: 0 };
  }

  const existingIds = new Set(log.entries.map((e) => `${e.source}:${e.itemId}`));
  const newEntries = fresh.filter((e) => !existingIds.has(`${e.source}:${e.itemId}`));

  log.entries.push(...newEntries);
  saveTrendsLog(dataDir, log);

  for (const e of newEntries) {
    console.log(`[Max][trends] + [${e.score}↑] "${e.title.slice(0, 80)}"`);
  }
  console.log(`[Max][trends] Done: +${newEntries.length} added, log size: ${log.entries.length}`);

  return { added: newEntries.length, skipped: 0 };
}
