/**
 * Influencer research — fetches top-performing public posts from Bluesky and Dev.to.
 * Used weekly to study format patterns that drive engagement in the dev/AI community.
 * No auth required — both are public read APIs.
 */

export interface InfluencerPost {
  platform: 'bluesky' | 'devto';
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
