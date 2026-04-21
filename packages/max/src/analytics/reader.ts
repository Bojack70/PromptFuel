/**
 * Daily reader — fetches 1 article per topic bucket per day from Medium (and optionally
 * Substack publications), appending to data/reading-log.json. Pure fetch, zero LLM.
 *
 * Runs in CI every day alongside the daily snapshot. The corpus accumulates over months
 * and is synthesised weekly (see brain/reading-insights.ts) into patterns that get
 * injected into content generation prompts.
 *
 * The moat isn't raw volume — Claude already trained on more text than this will ever hold.
 * The moat is the pairing of "articles Nate's niche is reading NOW" + "what Max's own
 * audience is engaging with" over time. The daily reader is the first half of that pair.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = 'reading-log.json';
const SOURCES_FILE = 'reader-sources.json';

export interface ReadingEntry {
  date: string;          // YYYY-MM-DD — the day we fetched it
  bucket: string;        // topic bucket it came from
  source: string;        // e.g. "medium:life-lessons" or "substack:platformer"
  title: string;
  excerpt: string;       // stripped-HTML description, ≤300 chars
  url: string;
  author?: string;
  pubDate?: string;      // ISO date of original publication
}

export interface ReadingLog {
  entries: ReadingEntry[];
}

interface ReaderSources {
  buckets: Record<string, {
    description?: string;
    mediumTags?: string[];
    substackHandles?: string[];
    picks?: string[];
  }>;
}

export function loadReadingLog(dataDir: string): ReadingLog {
  const file = join(dataDir, LOG_FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

export function saveReadingLog(dataDir: string, log: ReadingLog): void {
  writeFileSync(join(dataDir, LOG_FILE), JSON.stringify(log, null, 2));
}

function loadSources(dataDir: string): ReaderSources {
  const file = join(dataDir, SOURCES_FILE);
  if (!existsSync(file)) {
    throw new Error(`Reader sources config missing: ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/**
 * Parse RSS XML without npm deps. Extracts title + description + link + pubDate + author
 * from <item> blocks. Handles both Medium (CDATA-wrapped) and Substack (mixed).
 */
interface RawItem {
  title: string;
  excerpt: string;
  url: string;
  author?: string;
  pubDate?: string;
}

function parseRSS(xml: string): RawItem[] {
  const items = [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)];
  return items.map(([, content]) => {
    const extract = (tag: string): string => {
      const cdata = content.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (cdata) return cdata[1].trim();
      const plain = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return plain ? plain[1].trim() : '';
    };

    const title = extract('title');
    const rawDesc = extract('description') || extract('content:encoded');
    const url = extract('link') || extract('guid');
    const author = extract('dc:creator') || extract('author');
    const pubDate = extract('pubDate');

    const excerpt = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    return { title, excerpt, url, author: author || undefined, pubDate: pubDate || undefined };
  }).filter((i) => i.title.length > 10 && i.url.length > 10);
}

async function fetchMediumTag(tag: string): Promise<RawItem[]> {
  try {
    const url = `https://medium.com/feed/tag/${encodeURIComponent(tag)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.warn(`[Max][reader] medium/${tag} returned ${res.status}`);
      return [];
    }
    return parseRSS(await res.text());
  } catch (err) {
    console.warn(`[Max][reader] medium/${tag} fetch failed:`, (err as Error).message);
    return [];
  }
}

async function fetchSubstackHandle(handle: string): Promise<RawItem[]> {
  try {
    const url = `https://${handle}.substack.com/feed`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) {
      console.warn(`[Max][reader] substack/${handle} returned ${res.status}`);
      return [];
    }
    return parseRSS(await res.text());
  } catch (err) {
    console.warn(`[Max][reader] substack/${handle} fetch failed:`, (err as Error).message);
    return [];
  }
}

/**
 * Pick the freshest item that isn't already in the log. Prefers items from the last 14 days.
 */
function pickFreshest(candidates: RawItem[], existingUrls: Set<string>): RawItem | null {
  const fresh = candidates
    .filter((c) => !existingUrls.has(c.url))
    .sort((a, b) => {
      const ad = a.pubDate ? Date.parse(a.pubDate) : 0;
      const bd = b.pubDate ? Date.parse(b.pubDate) : 0;
      return bd - ad;
    });
  return fresh[0] ?? null;
}

/**
 * Fetch one article per bucket, append to the log. Idempotent — if today already has
 * an entry for a bucket, skip fetching that bucket.
 */
export async function fetchDailyReading(dataDir: string): Promise<{ added: number; skipped: number }> {
  const sources = loadSources(dataDir);
  const log = loadReadingLog(dataDir);
  const today = new Date().toISOString().split('T')[0];

  const existingUrls = new Set(log.entries.map((e) => e.url));
  const bucketsAlreadyDoneToday = new Set(
    log.entries.filter((e) => e.date === today).map((e) => e.bucket),
  );

  let added = 0;
  let skipped = 0;

  for (const [bucket, config] of Object.entries(sources.buckets)) {
    if (bucketsAlreadyDoneToday.has(bucket)) {
      console.log(`[Max][reader] ${bucket}: already logged today, skipping`);
      skipped++;
      continue;
    }

    const candidates: Array<{ item: RawItem; source: string }> = [];

    for (const tag of config.mediumTags ?? []) {
      const items = await fetchMediumTag(tag);
      for (const item of items) candidates.push({ item, source: `medium:${tag}` });
    }

    for (const handle of config.substackHandles ?? []) {
      const items = await fetchSubstackHandle(handle);
      for (const item of items) candidates.push({ item, source: `substack:${handle}` });
    }

    // De-dup by URL within today's candidate set before choosing
    const seenThisRun = new Set<string>();
    const uniqueCandidates = candidates.filter(({ item }) => {
      if (seenThisRun.has(item.url)) return false;
      seenThisRun.add(item.url);
      return true;
    });

    if (uniqueCandidates.length === 0) {
      console.warn(`[Max][reader] ${bucket}: no candidates fetched`);
      skipped++;
      continue;
    }

    // Find the freshest unseen item across all sources for this bucket
    const freshest = pickFreshest(
      uniqueCandidates.map((c) => c.item),
      existingUrls,
    );
    if (!freshest) {
      console.log(`[Max][reader] ${bucket}: all candidates already in log`);
      skipped++;
      continue;
    }

    const matched = uniqueCandidates.find((c) => c.item.url === freshest.url)!;

    const entry: ReadingEntry = {
      date: today,
      bucket,
      source: matched.source,
      title: freshest.title,
      excerpt: freshest.excerpt,
      url: freshest.url,
      author: freshest.author,
      pubDate: freshest.pubDate,
    };
    log.entries.push(entry);
    existingUrls.add(entry.url);
    added++;
    console.log(`[Max][reader] ${bucket}: + "${entry.title.slice(0, 70)}" (${matched.source})`);
  }

  saveReadingLog(dataDir, log);
  console.log(`[Max][reader] Done: +${added} added, ${skipped} skipped. Log size: ${log.entries.length}`);

  return { added, skipped };
}
