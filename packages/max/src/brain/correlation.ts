/**
 * Content-to-metric correlation engine.
 * Correlates individual posts with metric movements in the 48h window after posting.
 * Produces a weekly report with top performers, category/platform rankings, and insights.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentCategory } from '../content/templates.js';
import type { DaySnapshot } from '../analytics/collector.js';
import { loadHistory, type ContentLogEntry } from '../content/history.js';
import { loadEngagement, type EngagementSnapshot, type BlueskyEngagement, type DevtoEngagement } from '../analytics/engagement.js';

// ── Types ──

export interface ContentCorrelation {
  postId: string;
  platform: 'bluesky' | 'devto' | 'reddit';
  category: ContentCategory;
  date: string;
  engagement: {
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
    reactions?: number;
    comments?: number;
  };
  metricDeltas: {
    starsDelta: number;
    npmDelta: number;
    viewsDelta: number;
  };
  referrerMatch: boolean;
  score: number;
}

export interface CorrelationReport {
  weekOf: string;
  correlations: ContentCorrelation[];
  topPerformers: ContentCorrelation[];
  categoryRankings: Array<{ category: ContentCategory; avgScore: number; count: number }>;
  platformRankings: Array<{ platform: string; avgScore: number; count: number }>;
  insights: string[];
}

// ── Helpers ──

function loadAllSnapshots(dataDir: string): DaySnapshot[] {
  const dir = join(dataDir, 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as DaySnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is DaySnapshot => s !== null);
}

function getLatestEngagement(
  postId: string,
  engagementSnapshots: EngagementSnapshot[],
): { likes?: number; reposts?: number; replies?: number; views?: number; reactions?: number; comments?: number } | null {
  // Search from newest snapshot backwards
  for (let i = engagementSnapshots.length - 1; i >= 0; i--) {
    const match = engagementSnapshots[i].posts.find((p) => p.postId === postId);
    if (match) {
      if (match.platform === 'bluesky') {
        const m = match.metrics as BlueskyEngagement;
        return { likes: m.likes, reposts: m.reposts, replies: m.replies };
      } else {
        const m = match.metrics as DevtoEngagement;
        return { views: m.views, reactions: m.reactions, comments: m.comments };
      }
    }
  }
  return null;
}

function getMetricDeltas(
  postDate: string,
  snapshots: DaySnapshot[],
): { starsDelta: number; npmDelta: number; viewsDelta: number } {
  const postTime = new Date(postDate + 'T00:00:00Z').getTime();
  const windowEnd = postTime + 48 * 60 * 60 * 1000;

  // Find snapshot on post day and 2 days later
  const daySnapshot = snapshots.find((s) => s.date === postDate);
  const windowSnapshots = snapshots.filter((s) => {
    const t = new Date(s.date + 'T00:00:00Z').getTime();
    return t > postTime && t <= windowEnd;
  });

  if (!daySnapshot || windowSnapshots.length === 0) {
    return { starsDelta: 0, npmDelta: 0, viewsDelta: 0 };
  }

  const lastInWindow = windowSnapshots[windowSnapshots.length - 1];
  const starsDelta = lastInWindow.github.stars - daySnapshot.github.stars;
  const npmBefore = Object.values(daySnapshot.npm.packages).reduce((s, p) => s + p.downloadsLastDay, 0);
  const npmAfter = Object.values(lastInWindow.npm.packages).reduce((s, p) => s + p.downloadsLastDay, 0);
  const viewsDelta = windowSnapshots.reduce((s, snap) => s + snap.github.views.uniques, 0);

  return { starsDelta, npmDelta: npmAfter - npmBefore, viewsDelta };
}

function checkReferrerMatch(
  postDate: string,
  platform: string,
  snapshots: DaySnapshot[],
): boolean {
  const postTime = new Date(postDate + 'T00:00:00Z').getTime();
  const windowEnd = postTime + 48 * 60 * 60 * 1000;

  const platformReferrer = platform === 'devto' ? 'dev.to' : platform === 'bluesky' ? 'bsky' : platform;

  return snapshots.some((s) => {
    const t = new Date(s.date + 'T00:00:00Z').getTime();
    if (t < postTime || t > windowEnd) return false;
    return s.github.referrers.some((r) =>
      r.referrer.toLowerCase().includes(platformReferrer),
    );
  });
}

// ── Scoring ──

function scoreCorrelation(
  engagement: ContentCorrelation['engagement'],
  deltas: ContentCorrelation['metricDeltas'],
  referrerMatch: boolean,
  weekAvgEngagement: number,
  weekAvgDeltas: { stars: number; npm: number; views: number },
): number {
  // Engagement component (40%)
  const totalEngagement = (engagement.likes ?? 0) + (engagement.reposts ?? 0) +
    (engagement.replies ?? 0) + (engagement.views ?? 0) / 10 +
    (engagement.reactions ?? 0) + (engagement.comments ?? 0);
  const engagementRatio = weekAvgEngagement > 0 ? totalEngagement / weekAvgEngagement : 1;
  const engagementScore = Math.min(engagementRatio * 50, 100);

  // Metric deltas component (40%)
  const starsRatio = weekAvgDeltas.stars > 0 ? deltas.starsDelta / weekAvgDeltas.stars : (deltas.starsDelta > 0 ? 2 : 0);
  const npmRatio = weekAvgDeltas.npm > 0 ? deltas.npmDelta / weekAvgDeltas.npm : (deltas.npmDelta > 0 ? 2 : 0);
  const viewsRatio = weekAvgDeltas.views > 0 ? deltas.viewsDelta / weekAvgDeltas.views : (deltas.viewsDelta > 0 ? 2 : 0);
  const deltaScore = Math.min(((starsRatio + npmRatio + viewsRatio) / 3) * 50, 100);

  // Referrer match (20%)
  const referrerScore = referrerMatch ? 100 : 0;

  return Math.round(engagementScore * 0.4 + deltaScore * 0.4 + referrerScore * 0.2);
}

// ── Correlate Single Post ──

export function correlatePost(
  post: ContentLogEntry,
  snapshots: DaySnapshot[],
  engagementSnapshots: EngagementSnapshot[],
  weekAvgEngagement: number,
  weekAvgDeltas: { stars: number; npm: number; views: number },
): ContentCorrelation {
  const engagement = getLatestEngagement(post.postId, engagementSnapshots) ?? {};
  const metricDeltas = getMetricDeltas(post.date, snapshots);
  const referrerMatch = checkReferrerMatch(post.date, post.platform, snapshots);

  const score = scoreCorrelation(engagement, metricDeltas, referrerMatch, weekAvgEngagement, weekAvgDeltas);

  return {
    postId: post.postId,
    platform: post.platform as 'bluesky' | 'devto' | 'reddit',
    category: post.category,
    date: post.date,
    engagement,
    metricDeltas,
    referrerMatch,
    score,
  };
}

// ── Insight Generation ──

function generateInsights(
  correlations: ContentCorrelation[],
  categoryRankings: CorrelationReport['categoryRankings'],
  platformRankings: CorrelationReport['platformRankings'],
): string[] {
  const insights: string[] = [];
  if (correlations.length === 0) return insights;

  // Category insight
  if (categoryRankings.length >= 2) {
    const top = categoryRankings[0];
    const bottom = categoryRankings[categoryRankings.length - 1];
    if (top.avgScore > 0 && bottom.avgScore > 0) {
      const ratio = (top.avgScore / bottom.avgScore).toFixed(1);
      insights.push(`${top.category} content scored ${ratio}x higher than ${bottom.category} in real-world impact`);
    }
  }

  // Platform insight
  if (platformRankings.length >= 2) {
    const top = platformRankings[0];
    insights.push(`${top.platform} posts had the highest avg correlation score (${top.avgScore.toFixed(0)}/100)`);
  }

  // Star correlation
  const starPosts = correlations.filter((c) => c.metricDeltas.starsDelta > 0);
  if (starPosts.length > 0) {
    const starCategories = [...new Set(starPosts.map((c) => c.category))];
    insights.push(`Star growth correlated with: ${starCategories.join(', ')} content`);
  }

  // Referrer insight
  const referrerPosts = correlations.filter((c) => c.referrerMatch);
  if (referrerPosts.length > 0) {
    const pct = Math.round((referrerPosts.length / correlations.length) * 100);
    insights.push(`${pct}% of posts showed referrer traffic from the publishing platform`);
  }

  // Top performer
  const top = correlations.sort((a, b) => b.score - a.score)[0];
  if (top && top.score > 0) {
    insights.push(`Best performing post: ${top.category} on ${top.platform} (score ${top.score}/100)`);
  }

  return insights.slice(0, 5);
}

// ── Build Weekly Report ──

export function buildCorrelationReport(dataDir: string, weekStart: string): CorrelationReport {
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const history = loadHistory(dataDir);
  const snapshots = loadAllSnapshots(dataDir);
  const engagementSnapshots = loadEngagement(dataDir);

  // Get week's posts
  const weekPosts = history.filter((e) => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d >= start && d < end && ['bluesky', 'devto', 'reddit'].includes(e.platform);
  });

  if (weekPosts.length === 0) {
    return {
      weekOf: weekStart,
      correlations: [],
      topPerformers: [],
      categoryRankings: [],
      platformRankings: [],
      insights: ['No content published this week — no correlations to analyze'],
    };
  }

  // Calculate week averages for normalization
  const weekSnapshots = snapshots.filter((s) => {
    const d = new Date(s.date + 'T00:00:00Z');
    return d >= start && d < end;
  });

  const avgStarsDelta = weekSnapshots.length > 1
    ? (weekSnapshots[weekSnapshots.length - 1].github.stars - weekSnapshots[0].github.stars) / weekSnapshots.length
    : 0;
  const avgNpmDelta = weekSnapshots.length > 0
    ? weekSnapshots.reduce((s, snap) => s + Object.values(snap.npm.packages).reduce((t, p) => t + p.downloadsLastDay, 0), 0) / weekSnapshots.length
    : 0;
  const avgViewsDelta = weekSnapshots.length > 0
    ? weekSnapshots.reduce((s, snap) => s + snap.github.views.uniques, 0) / weekSnapshots.length
    : 0;

  // Calculate avg engagement across all tracked posts this week
  let totalEngagement = 0;
  let engagementCount = 0;
  for (const snapshot of engagementSnapshots) {
    const snapDate = new Date(snapshot.date + 'T00:00:00Z');
    if (snapDate >= start && snapDate < end) {
      for (const post of snapshot.posts) {
        if (post.platform === 'bluesky') {
          const m = post.metrics as { likes: number; reposts: number; replies: number };
          totalEngagement += m.likes + m.reposts + m.replies;
        } else {
          const m = post.metrics as { views: number; reactions: number; comments: number };
          totalEngagement += m.views / 10 + m.reactions + m.comments;
        }
        engagementCount++;
      }
    }
  }
  const weekAvgEngagement = engagementCount > 0 ? totalEngagement / engagementCount : 1;
  const weekAvgDeltas = { stars: avgStarsDelta, npm: avgNpmDelta, views: avgViewsDelta };

  // Correlate each post
  const correlations = weekPosts.map((post) =>
    correlatePost(post, snapshots, engagementSnapshots, weekAvgEngagement, weekAvgDeltas),
  );

  // Rank by score
  const sorted = [...correlations].sort((a, b) => b.score - a.score);
  const topPerformers = sorted.slice(0, 3);

  // Category rankings
  const categories: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'stats', 'launch', 'opinion'];
  const categoryRankings = categories
    .map((cat) => {
      const entries = correlations.filter((c) => c.category === cat);
      if (entries.length === 0) return null;
      const avgScore = entries.reduce((s, e) => s + e.score, 0) / entries.length;
      return { category: cat, avgScore, count: entries.length };
    })
    .filter((r): r is { category: ContentCategory; avgScore: number; count: number } => r !== null)
    .sort((a, b) => b.avgScore - a.avgScore);

  // Platform rankings
  const platforms = ['bluesky', 'devto', 'reddit'] as const;
  const platformRankings = platforms
    .map((plat) => {
      const entries = correlations.filter((c) => c.platform === plat);
      if (entries.length === 0) return null;
      const avgScore = entries.reduce((s, e) => s + e.score, 0) / entries.length;
      return { platform: plat, avgScore, count: entries.length };
    })
    .filter((r): r is { platform: string; avgScore: number; count: number } => r !== null)
    .sort((a, b) => b.avgScore - a.avgScore);

  const insights = generateInsights(correlations, categoryRankings, platformRankings);

  return { weekOf: weekStart, correlations, topPerformers, categoryRankings, platformRankings, insights };
}

// ── Persistence ──

export function saveCorrelationReport(dataDir: string, report: CorrelationReport): void {
  writeFileSync(join(dataDir, 'correlations.json'), JSON.stringify(report, null, 2));
}

export function loadCorrelationReport(dataDir: string): CorrelationReport | null {
  const file = join(dataDir, 'correlations.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}
