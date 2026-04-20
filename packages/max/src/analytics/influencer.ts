/**
 * Influencer research — fetches top-performing public posts from Bluesky and Dev.to.
 * Used weekly to study format patterns that drive engagement in the dev/AI community.
 * No auth required — both are public read APIs.
 */

export interface InfluencerPost {
  platform: 'bluesky' | 'devto' | 'medium';
  text: string;      // post body / article title + intro
  likes: number;
  reposts?: number;
  views?: number;
  category: 'tool' | 'personal_brand'; // tool = LLM/dev-tool topic, personal_brand = broader topic
}

export interface InfluencerResearch {
  fetchedAt: string;
  posts: InfluencerPost[];
}

const BLUESKY_TOOL_QUERIES = ['llm tokens', 'openai costs', 'claude api', 'prompt engineering', 'LLM production'];
const BLUESKY_PERSONAL_QUERIES = ['indie dev life', 'software economics', 'AI opinion', 'developer burnout', 'build in public'];
const DEVTO_TOOL_TAGS = ['ai', 'llm', 'openai', 'machinelearning'];
const DEVTO_PERSONAL_TAGS = ['career', 'discuss', 'productivity', 'webdev'];
// Medium RSS feeds — public, no auth required. Returns ~10 recent articles per tag.
const MEDIUM_TOOL_TAGS = ['artificial-intelligence', 'machine-learning', 'programming', 'software-development'];
const MEDIUM_PERSONAL_TAGS = ['indie-hacking', 'entrepreneurship', 'productivity', 'technology'];

async function fetchBlueskyTopPosts(query: string, limit = 5): Promise<InfluencerPost[]> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=${limit}&sort=top`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as { posts?: any[] };
    return (data.posts ?? []).map((p: any) => ({
      platform: 'bluesky' as const,
      text: p.record?.text ?? '',
      likes: p.likeCount ?? 0,
      reposts: p.repostCount ?? 0,
      category: 'tool' as const,
    })).filter((p) => p.text.length > 20);
  } catch {
    return [];
  }
}

async function fetchDevtoTopArticles(tag: string, limit = 5): Promise<InfluencerPost[]> {
  try {
    const url = `https://dev.to/api/articles?tag=${tag}&per_page=${limit}&top=7`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return data.map((a: any) => ({
      platform: 'devto' as const,
      text: `${a.title}\n${a.description ?? ''}`,
      likes: a.positive_reactions_count ?? 0,
      views: a.page_views_count ?? 0,
      category: 'tool' as const,
    })).filter((p) => p.text.length > 10);
  } catch {
    return [];
  }
}

/** Parse RSS XML without npm deps — extracts title + description from <item> blocks. */
function parseMediumRSS(xml: string): Array<{ title: string; excerpt: string }> {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return items.map(([, content]) => {
    const title = (
      content.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      content.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''
    ).trim();

    const rawDesc = (
      content.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] ??
      content.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ''
    );
    // Strip HTML tags and collapse whitespace
    const excerpt = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    return { title, excerpt };
  }).filter((i) => i.title.length > 10);
}

async function fetchMediumTopArticles(tag: string, category: 'tool' | 'personal_brand'): Promise<InfluencerPost[]> {
  try {
    const url = `https://medium.com/feed/tag/${encodeURIComponent(tag)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseMediumRSS(xml).map((item) => ({
      platform: 'medium' as const,
      text: `${item.title}\n${item.excerpt}`,
      likes: 0, // Medium RSS doesn't expose clap counts — style analysis only
      category,
    }));
  } catch {
    return [];
  }
}

export async function fetchInfluencerPosts(): Promise<InfluencerResearch> {
  console.log('[Max] Fetching influencer posts for format research...');

  const results: InfluencerPost[] = [];

  // Bluesky — tool/product queries
  for (const query of BLUESKY_TOOL_QUERIES) {
    const posts = await fetchBlueskyTopPosts(query, 5);
    results.push(...posts.map((p) => ({ ...p, category: 'tool' as const })));
  }

  // Bluesky — personal brand queries
  for (const query of BLUESKY_PERSONAL_QUERIES) {
    const posts = await fetchBlueskyTopPosts(query, 5);
    results.push(...posts.map((p) => ({ ...p, category: 'personal_brand' as const })));
  }

  // Dev.to — tool tags
  for (const tag of DEVTO_TOOL_TAGS) {
    const posts = await fetchDevtoTopArticles(tag, 5);
    results.push(...posts.map((p) => ({ ...p, category: 'tool' as const })));
  }

  // Dev.to — personal brand tags
  for (const tag of DEVTO_PERSONAL_TAGS) {
    const posts = await fetchDevtoTopArticles(tag, 5);
    results.push(...posts.map((p) => ({ ...p, category: 'personal_brand' as const })));
  }

  // Medium — tool/AI tags (style learning only — no clap counts in RSS)
  for (const tag of MEDIUM_TOOL_TAGS) {
    const posts = await fetchMediumTopArticles(tag, 'tool');
    results.push(...posts);
  }

  // Medium — personal brand tags
  for (const tag of MEDIUM_PERSONAL_TAGS) {
    const posts = await fetchMediumTopArticles(tag, 'personal_brand');
    results.push(...posts);
  }

  // Deduplicate by text prefix and sort by engagement
  const seen = new Set<string>();
  const unique = results
    .filter((p) => {
      const key = p.text.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.likes + (b.reposts ?? 0)) - (a.likes + (a.reposts ?? 0)));

  console.log(`[Max] Influencer research: ${unique.length} unique posts fetched`);

  return {
    fetchedAt: new Date().toISOString(),
    posts: unique.slice(0, 60), // cap at 60 to keep Claude's input manageable
  };
}
