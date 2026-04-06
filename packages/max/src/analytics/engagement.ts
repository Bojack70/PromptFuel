/**
 * Engagement collection — fetches post-publish metrics from Bluesky and Dev.to.
 * Runs daily after analytics collection. Data stored in data/engagement.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MaxConfig } from '../config.js';
import { loadHistory } from '../content/history.js';

// ── Types ──

export interface BlueskyEngagement {
  likes: number;
  reposts: number;
  replies: number;
}

export interface DevtoEngagement {
  views: number;
  reactions: number;
  comments: number;
  readingTime: number;
}

export interface PostEngagement {
  postId: string;
  platform: 'bluesky' | 'devto';
  collectedAt: string;
  metrics: BlueskyEngagement | DevtoEngagement;
}

export interface EngagementSnapshot {
  date: string;
  posts: PostEngagement[];
}

// ── Bluesky ──

interface BlueskySession {
  did: string;
  accessJwt: string;
}

const BSKY_SERVICE = 'https://bsky.social';

async function createBlueskySession(handle: string, appPassword: string): Promise<BlueskySession> {
  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky auth failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  return { did: data.did, accessJwt: data.accessJwt };
}

export async function fetchBlueskyEngagement(
  postUri: string,
  session: BlueskySession,
): Promise<BlueskyEngagement> {
  const res = await fetch(
    `${BSKY_SERVICE}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=0`,
    { headers: { Authorization: `Bearer ${session.accessJwt}` } },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky getPostThread failed ${res.status}: ${body}`);
  }

  const data = await res.json();
  const post = data.thread?.post;

  return {
    likes: post?.likeCount ?? 0,
    reposts: post?.repostCount ?? 0,
    replies: post?.replyCount ?? 0,
  };
}

// ── Dev.to ──

export async function fetchDevtoEngagement(
  apiKey: string,
): Promise<Map<string, DevtoEngagement>> {
  const res = await fetch('https://dev.to/api/articles/me?per_page=30', {
    headers: { 'api-key': apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dev.to articles/me failed ${res.status}: ${body}`);
  }

  const articles: any[] = await res.json();
  const map = new Map<string, DevtoEngagement>();

  for (const article of articles) {
    map.set(String(article.id), {
      views: article.page_views_count ?? 0,
      reactions: article.positive_reactions_count ?? 0,
      comments: article.comments_count ?? 0,
      readingTime: article.reading_time_minutes ?? 0,
    });
  }

  return map;
}

// ── Persistence ──

const ENGAGEMENT_FILE = 'engagement.json';

export function loadEngagement(dataDir: string): EngagementSnapshot[] {
  const file = join(dataDir, ENGAGEMENT_FILE);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveEngagementSnapshot(dataDir: string, snapshot: EngagementSnapshot): void {
  const snapshots = loadEngagement(dataDir);
  snapshots.push(snapshot);
  writeFileSync(join(dataDir, ENGAGEMENT_FILE), JSON.stringify(snapshots, null, 2));
}

// ── Main Collection ──

export async function collectEngagement(config: MaxConfig): Promise<EngagementSnapshot> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const history = loadHistory(config.dataDir);

  // Filter to recent posts worth tracking
  const recentPosts = history.filter((e) => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d >= cutoff && (e.platform === 'bluesky' || e.platform === 'devto');
  });

  const posts: PostEngagement[] = [];

  // Bluesky engagement
  const blueskyPosts = recentPosts.filter((e) => e.platform === 'bluesky');
  if (blueskyPosts.length > 0) {
    try {
      const session = await createBlueskySession(config.blueskyHandle, config.blueskyAppPassword);
      for (const post of blueskyPosts) {
        try {
          const metrics = await fetchBlueskyEngagement(post.postId, session);
          posts.push({
            postId: post.postId,
            platform: 'bluesky',
            collectedAt: now.toISOString(),
            metrics,
          });
        } catch (err) {
          console.warn(`[Max] Failed to fetch Bluesky engagement for ${post.postId}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.warn(`[Max] Bluesky auth failed for engagement collection: ${(err as Error).message}`);
    }
  }

  // Dev.to engagement
  const devtoPosts = recentPosts.filter((e) => e.platform === 'devto');
  if (devtoPosts.length > 0) {
    try {
      const devtoMap = await fetchDevtoEngagement(config.devtoApiKey);
      for (const post of devtoPosts) {
        const metrics = devtoMap.get(post.postId);
        if (metrics) {
          posts.push({
            postId: post.postId,
            platform: 'devto',
            collectedAt: now.toISOString(),
            metrics,
          });
        }
      }
    } catch (err) {
      console.warn(`[Max] Dev.to engagement collection failed: ${(err as Error).message}`);
    }
  }

  const snapshot: EngagementSnapshot = { date: today, posts };
  saveEngagementSnapshot(config.dataDir, snapshot);

  return snapshot;
}
