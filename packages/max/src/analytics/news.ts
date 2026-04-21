/**
 * News fetcher — broader signal than HN trends.ts. Pulls from:
 *   • Hacker News (Firebase v0 API) — top stories
 *   • Product Hunt RSS — daily launches
 *   • TechCrunch RSS — startup/VC/AI
 *   • Ars Technica RSS — deeper tech journalism
 *   • The Verge RSS — tech + culture
 *
 * Plus: searchNews(topic) uses HN Algolia (free, no auth) to find recent
 * stories matching an arbitrary keyword — powers the `--mode react --topic`
 * command where the user wants to react to specific breaking news.
 *
 * All fetchers free + no auth. Stored in data/news-log.json as rolling
 * 30-day corpus. Weekly brain triages into eligible/ineligible angles.
 *
 * This is separate from trends.ts which is narrowly scoped to HN's
 * top-N stories for the tech-ai bucket injection. news.ts is broader
 * (multi-source) and powers the current_event content category.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = 'news-log.json';

export type NewsSource = 'hn' | 'producthunt' | 'techcrunch' | 'ars' | 'verge';

export interface NewsEntry {
  date: string;
  source: NewsSource;
  title: string;
  url: string;
  excerpt: string;
  score?: number;       // HN score; undefined for RSS sources
  pubDate?: string;     // ISO from RSS
  id: string;           // dedup key (source:url or source:hn_id)
}

export interface NewsLog {
  entries: NewsEntry[];
}

export function loadNewsLog(dataDir: string): NewsLog {
  const file = join(dataDir, LOG_FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

export function saveNewsLog(dataDir: string, log: NewsLog): void {
  writeFileSync(join(dataDir, LOG_FILE), JSON.stringify(log, null, 2));
}

// ── RSS parsing helpers ──

/**
 * Parse feed items from RSS 2.0 (<item>) OR Atom (<entry>) — both are common
 * across the 5 sources. Falls back gracefully between formats.
 */
function parseRSSItems(xml: string): Array<{ title: string; url: string; excerpt: string; pubDate: string }> {
  // RSS 2.0: <item>...</item>
  // Atom:    <entry>...</entry>
  const blocks: string[] = [];
  for (const m of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) blocks.push(m[1]);
  for (const m of xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g)) blocks.push(m[1]);

  return blocks.map((content) => {
    const ex = (tag: string): string => {
      const cdata = content.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
      if (cdata) return cdata[1].trim();
      const plain = content.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return plain ? plain[1].trim() : '';
    };

    const title = ex('title');

    // URL: RSS uses <link>URL</link>; Atom uses <link href="URL"/> (self-closing, no text)
    let url = ex('link') || ex('guid');
    if (!url || url.length < 10) {
      // Atom fallback: extract href from <link ... href="..."/>
      // Prefer rel="alternate" if multiple links exist.
      const altMatch = content.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/);
      if (altMatch) url = altMatch[1].trim();
      else {
        const anyLink = content.match(/<link[^>]*href=["']([^"']+)["']/);
        if (anyLink) url = anyLink[1].trim();
      }
    }

    // Description: RSS <description> / <content:encoded>; Atom <content> / <summary>
    const rawDesc = ex('description') || ex('content:encoded') || ex('content') || ex('summary');
    // Date: RSS <pubDate>; Atom <published> / <updated>
    const pubDate = ex('pubDate') || ex('published') || ex('updated');

    const excerpt = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    return { title, url, excerpt, pubDate };
  }).filter((i) => i.title.length > 5 && i.url.length > 10);
}

async function fetchRSS(url: string, userAgent = 'Max-Agent/1.0'): Promise<Array<{ title: string; url: string; excerpt: string; pubDate: string }>> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (!res.ok) {
      console.warn(`[Max][news] RSS ${url} returned ${res.status}`);
      return [];
    }
    return parseRSSItems(await res.text());
  } catch (err) {
    console.warn(`[Max][news] RSS ${url} fetch failed:`, (err as Error).message);
    return [];
  }
}

// ── Source-specific fetchers ──

interface HNItem { id: number; title: string; url?: string; score: number; type: string; dead?: boolean; deleted?: boolean; }

async function fetchHN(limit = 10): Promise<NewsEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  try {
    const idsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { headers: { 'User-Agent': 'Max-Agent/1.0' } });
    if (!idsRes.ok) return [];
    const ids = (await idsRes.json()) as number[];
    const picks = ids.slice(0, limit);
    const entries: NewsEntry[] = [];
    for (const id of picks) {
      const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!res.ok) continue;
      const item = (await res.json()) as HNItem;
      if (!item || item.dead || item.deleted || item.type !== 'story' || !item.title) continue;
      entries.push({
        date: today,
        source: 'hn',
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        excerpt: '',
        score: item.score ?? 0,
        id: `hn:${item.id}`,
      });
    }
    return entries;
  } catch (err) {
    console.warn('[Max][news] HN fetch failed:', (err as Error).message);
    return [];
  }
}

async function fetchProductHunt(): Promise<NewsEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const items = await fetchRSS('https://www.producthunt.com/feed');
  return items.slice(0, 12).map((i) => ({
    date: today,
    source: 'producthunt' as const,
    title: i.title,
    url: i.url,
    excerpt: i.excerpt,
    pubDate: i.pubDate,
    id: `producthunt:${i.url}`,
  }));
}

async function fetchTechCrunch(): Promise<NewsEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const items = await fetchRSS('https://techcrunch.com/feed/');
  return items.slice(0, 15).map((i) => ({
    date: today,
    source: 'techcrunch' as const,
    title: i.title,
    url: i.url,
    excerpt: i.excerpt,
    pubDate: i.pubDate,
    id: `techcrunch:${i.url}`,
  }));
}

async function fetchArs(): Promise<NewsEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const items = await fetchRSS('https://feeds.arstechnica.com/arstechnica/index');
  return items.slice(0, 12).map((i) => ({
    date: today,
    source: 'ars' as const,
    title: i.title,
    url: i.url,
    excerpt: i.excerpt,
    pubDate: i.pubDate,
    id: `ars:${i.url}`,
  }));
}

async function fetchVerge(): Promise<NewsEntry[]> {
  const today = new Date().toISOString().split('T')[0];
  const items = await fetchRSS('https://www.theverge.com/rss/index.xml');
  return items.slice(0, 12).map((i) => ({
    date: today,
    source: 'verge' as const,
    title: i.title,
    url: i.url,
    excerpt: i.excerpt,
    pubDate: i.pubDate,
    id: `verge:${i.url}`,
  }));
}

/**
 * Fetch today's news across all 5 sources, append to rolling log.
 * Dedupes by stable id. Keeps last 30 days.
 */
export async function fetchDailyNews(dataDir: string): Promise<{ added: number; perSource: Record<NewsSource, number> }> {
  const log = loadNewsLog(dataDir);
  const existingIds = new Set(log.entries.map((e) => e.id));
  const today = new Date().toISOString().split('T')[0];

  const perSource: Record<NewsSource, number> = { hn: 0, producthunt: 0, techcrunch: 0, ars: 0, verge: 0 };

  console.log('[Max][news] Fetching from 5 sources...');
  const [hn, ph, tc, ars, verge] = await Promise.all([
    fetchHN(10),
    fetchProductHunt(),
    fetchTechCrunch(),
    fetchArs(),
    fetchVerge(),
  ]);

  const all: NewsEntry[] = [...hn, ...ph, ...tc, ...ars, ...verge];
  let added = 0;
  for (const entry of all) {
    if (existingIds.has(entry.id)) continue;
    log.entries.push(entry);
    existingIds.add(entry.id);
    perSource[entry.source]++;
    added++;
  }

  // Prune entries older than 30 days so the corpus stays focused
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  log.entries = log.entries.filter((e) => e.date >= cutoffStr);

  saveNewsLog(dataDir, log);
  console.log(`[Max][news] +${added} new (${Object.entries(perSource).filter(([, n]) => n > 0).map(([s, n]) => `${s}:${n}`).join(' ')}), log=${log.entries.length}`);

  return { added, perSource };
}

// ── Topic search (for --mode react) ──

export interface TopicSearchResult {
  topic: string;
  fromSearch: NewsEntry[];     // HN Algolia results
  fromCorpus: NewsEntry[];     // local news-log.json matches
  all: NewsEntry[];            // deduped merged list, freshest first
}

/**
 * Search for news matching a user-provided topic. Combines:
 *   • HN Algolia search (real-time, covers past 7 days)
 *   • Local news corpus filtered by keyword match (covers our 5 sources)
 *
 * Returns freshest-first, deduped.
 */
export async function searchNews(topic: string, dataDir: string, windowDays = 7): Promise<TopicSearchResult> {
  const q = topic.trim();
  if (!q) return { topic: q, fromSearch: [], fromCorpus: [], all: [] };

  // 1. HN Algolia
  const fromSearch: NewsEntry[] = [];
  try {
    const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${cutoff}&hitsPerPage=15`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Max-Agent/1.0' } });
    if (res.ok) {
      const data = (await res.json()) as { hits?: Array<{ objectID: string; title: string; url?: string; points?: number; created_at: string; story_text?: string }> };
      for (const hit of data.hits ?? []) {
        if (!hit.title) continue;
        fromSearch.push({
          date: hit.created_at.split('T')[0],
          source: 'hn',
          title: hit.title,
          url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
          excerpt: (hit.story_text ?? '').replace(/<[^>]+>/g, ' ').slice(0, 250),
          score: hit.points ?? 0,
          pubDate: hit.created_at,
          id: `hn:${hit.objectID}`,
        });
      }
    } else {
      console.warn(`[Max][news] Algolia returned ${res.status}`);
    }
  } catch (err) {
    console.warn('[Max][news] Algolia search failed:', (err as Error).message);
  }

  // 2. Local corpus keyword match
  const log = loadNewsLog(dataDir);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const fromCorpus = log.entries
    .filter((e) => e.date >= cutoffStr)
    .filter((e) => {
      const hay = `${e.title} ${e.excerpt}`.toLowerCase();
      // Require at least half the query terms to match (unordered)
      const hits = terms.filter((t) => hay.includes(t)).length;
      return hits >= Math.max(1, Math.ceil(terms.length / 2));
    });

  // Dedup merged, freshest first
  const seen = new Set<string>();
  const merged: NewsEntry[] = [];
  for (const e of [...fromSearch, ...fromCorpus]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  merged.sort((a, b) => {
    const ad = a.pubDate ? Date.parse(a.pubDate) : Date.parse(a.date);
    const bd = b.pubDate ? Date.parse(b.pubDate) : Date.parse(b.date);
    return bd - ad;
  });

  return { topic: q, fromSearch, fromCorpus, all: merged.slice(0, 12) };
}
