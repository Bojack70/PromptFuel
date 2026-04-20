/**
 * Weekly Brain — aggregates the week's data, evaluates hypotheses,
 * correlates content with metrics, evaluates strategy outcomes,
 * generates a Claude reflection, extracts a structured strategy decision,
 * pre-generates the week's content, and feeds everything back into next week's calendar.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MaxConfig } from '../config.js';
import type { DaySnapshot } from '../analytics/collector.js';
import { loadHistory } from '../content/history.js';
import { loadExperiments } from '../experiments/tracker.js';
import { evaluateWeek, type WeeklyEvaluation } from '../experiments/evaluator.js';
import { generateWeeklyCalendar, type CalendarContext } from '../content/calendar.js';
import { pregenerateWeek } from '../content/pregenerate.js';
import { getStage } from '../content/scheduler.js';
import { generateContent } from '../content/claude.js';
import { sendEmail } from '../reports/email.js';
import { generateDrafts } from './drafts.js';
import { collectEngagement } from '../analytics/engagement.js';
import { loadEngagement, type EngagementSnapshot, type BlueskyEngagement, type DevtoEngagement } from '../analytics/engagement.js';
import { saveCorrelationReport } from './correlation.js';
import {
  evaluateOutcomes,
  buildStrategyMemory,
  extractDecision,
  recordDecision,
  type MetricsSnapshot,
  type StrategyMemory,
} from './strategy.js';
import { fetchInfluencerPosts } from '../analytics/influencer.js';
import { researchFormats, loadFormatInsights, type FormatInsights } from './format-research.js';

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function loadWeekSnapshots(dataDir: string, weekStart: string): DaySnapshot[] {
  const snapshotsDir = join(dataDir, 'snapshots');
  if (!existsSync(snapshotsDir)) return [];

  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  return readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(snapshotsDir, f), 'utf-8')) as DaySnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is DaySnapshot => {
      if (!s) return false;
      const d = new Date(s.date + 'T00:00:00Z');
      return d >= start && d < end;
    });
}

function loadPrevWeekSnapshots(dataDir: string, weekStart: string): DaySnapshot[] {
  const start = new Date(weekStart + 'T00:00:00Z');
  const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  return loadWeekSnapshots(dataDir, prevStart.toISOString().split('T')[0]);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function delta(n: number): string {
  if (n > 0) return `<span style="color:#22c55e">+${fmt(n)}</span>`;
  if (n < 0) return `<span style="color:#ef4444">${fmt(n)}</span>`;
  return `<span style="color:#6b7280">±0</span>`;
}

// ── Growth Goals ──

interface GrowthGoals {
  weeklyStarsDelta: number;
  weeklyNpmDownloads: number;
  weeklyUniqueViews: number;
}

const DEFAULT_GOALS: GrowthGoals = {
  weeklyStarsDelta: 2,
  weeklyNpmDownloads: 100,
  weeklyUniqueViews: 20,
};

type GrowthStatus = 'on_track' | 'stalled' | 'accelerating';

interface GoalEvaluation {
  status: GrowthStatus;
  met: string[];
  missed: string[];
  stalledWeeks: number;
}

function evaluateGoals(
  summary: WeekSummary,
  prevStalledWeeks: number,
  goals: GrowthGoals = DEFAULT_GOALS,
): GoalEvaluation {
  const met: string[] = [];
  const missed: string[] = [];

  if (summary.stars.delta >= goals.weeklyStarsDelta) met.push('stars');
  else missed.push('stars');

  if (summary.npmDownloadsWeek >= goals.weeklyNpmDownloads) met.push('npm_downloads');
  else missed.push('npm_downloads');

  if (summary.views.uniques >= goals.weeklyUniqueViews) met.push('views');
  else missed.push('views');

  let status: GrowthStatus;
  let stalledWeeks = 0;

  if (missed.length >= 2) {
    stalledWeeks = prevStalledWeeks + 1;
    status = 'stalled';
  } else if (
    met.length === 3 &&
    (summary.stars.delta >= goals.weeklyStarsDelta * 2 ||
     summary.npmDownloadsWeek >= goals.weeklyNpmDownloads * 2 ||
     summary.views.uniques >= goals.weeklyUniqueViews * 2)
  ) {
    status = 'accelerating';
  } else {
    status = 'on_track';
  }

  return { status, met, missed, stalledWeeks };
}

// ── Week Summary ──

interface EngagementSummary {
  bluesky: { avgLikes: number; avgReposts: number; avgReplies: number; totalPosts: number };
  devto: { avgViews: number; avgReactions: number; avgComments: number; totalArticles: number };
}

interface WeekSummary {
  stars: { current: number; delta: number };
  forks: { current: number; delta: number };
  views: { total: number; uniques: number };
  clones: { total: number; uniques: number };
  npmDownloadsWeek: number;
  prevNpmDownloadsWeek: number;
  postsCount: { bluesky: number; mastodon: number; devto: number; reddit: number };
  engagement: EngagementSummary;
}

function computeEngagementSummary(dataDir: string, weekStart: string): EngagementSummary {
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const snapshots = loadEngagement(dataDir);

  const blueskyMetrics: BlueskyEngagement[] = [];
  const devtoMetrics: DevtoEngagement[] = [];

  for (const snapshot of snapshots) {
    const d = new Date(snapshot.date + 'T00:00:00Z');
    if (d < start || d >= end) continue;
    for (const post of snapshot.posts) {
      if (post.platform === 'bluesky') blueskyMetrics.push(post.metrics as BlueskyEngagement);
      else devtoMetrics.push(post.metrics as DevtoEngagement);
    }
  }

  return {
    bluesky: {
      avgLikes: blueskyMetrics.length > 0 ? blueskyMetrics.reduce((s, m) => s + m.likes, 0) / blueskyMetrics.length : 0,
      avgReposts: blueskyMetrics.length > 0 ? blueskyMetrics.reduce((s, m) => s + m.reposts, 0) / blueskyMetrics.length : 0,
      avgReplies: blueskyMetrics.length > 0 ? blueskyMetrics.reduce((s, m) => s + m.replies, 0) / blueskyMetrics.length : 0,
      totalPosts: blueskyMetrics.length,
    },
    devto: {
      avgViews: devtoMetrics.length > 0 ? devtoMetrics.reduce((s, m) => s + m.views, 0) / devtoMetrics.length : 0,
      avgReactions: devtoMetrics.length > 0 ? devtoMetrics.reduce((s, m) => s + m.reactions, 0) / devtoMetrics.length : 0,
      avgComments: devtoMetrics.length > 0 ? devtoMetrics.reduce((s, m) => s + m.comments, 0) / devtoMetrics.length : 0,
      totalArticles: devtoMetrics.length,
    },
  };
}

function summarizeWeek(snapshots: DaySnapshot[], prevSnapshots: DaySnapshot[], dataDir: string, weekStart: string): WeekSummary {
  const latest = snapshots[snapshots.length - 1];
  const prevLatest = prevSnapshots[prevSnapshots.length - 1];

  const totalViews = snapshots.reduce((s, snap) => s + snap.github.views.count, 0);
  const uniqueViews = snapshots.reduce((s, snap) => s + snap.github.views.uniques, 0);
  const totalClones = snapshots.reduce((s, snap) => s + snap.github.clones.count, 0);
  const uniqueClones = snapshots.reduce((s, snap) => s + snap.github.clones.uniques, 0);

  const npmWeek = latest
    ? Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0)
    : 0;
  const prevNpmWeek = prevLatest
    ? Object.values(prevLatest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0)
    : 0;

  const history = loadHistory(dataDir);
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekPosts = history.filter((e) => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d >= start && d < end;
  });

  const engagement = computeEngagementSummary(dataDir, weekStart);

  return {
    stars: {
      current: latest?.github.stars ?? 0,
      delta: latest && prevLatest ? latest.github.stars - prevLatest.github.stars : 0,
    },
    forks: {
      current: latest?.github.forks ?? 0,
      delta: latest && prevLatest ? latest.github.forks - prevLatest.github.forks : 0,
    },
    views: { total: totalViews, uniques: uniqueViews },
    clones: { total: totalClones, uniques: uniqueClones },
    npmDownloadsWeek: npmWeek,
    prevNpmDownloadsWeek: prevNpmWeek,
    postsCount: {
      bluesky: weekPosts.filter((e) => e.platform === 'bluesky').length,
      mastodon: weekPosts.filter((e) => e.platform === 'mastodon').length,
      devto: weekPosts.filter((e) => e.platform === 'devto').length,
      reddit: weekPosts.filter((e) => e.platform === 'reddit').length,
    },
    engagement,
  };
}

// ── Metrics Snapshot (for strategy evaluation) ──

function buildMetricsSnapshot(summary: WeekSummary): MetricsSnapshot {
  const blueskyEng = summary.engagement.bluesky;
  const devtoEng = summary.engagement.devto;
  const avgEngagement =
    (blueskyEng.totalPosts > 0 ? blueskyEng.avgLikes + blueskyEng.avgReposts : 0) +
    (devtoEng.totalArticles > 0 ? devtoEng.avgViews / 10 + devtoEng.avgReactions : 0);

  return {
    starsDelta: summary.stars.delta,
    npmDownloadsWeek: summary.npmDownloadsWeek,
    uniqueViews: summary.views.uniques,
    avgEngagement,
  };
}

// ── Reflection ──

async function generateReflection(
  claudeApiKey: string,
  summary: WeekSummary,
  evaluation: WeeklyEvaluation,
  goalEval: GoalEvaluation,
  strategyMemory: StrategyMemory,
): Promise<string> {
  // Strategy history block
  const strategyBlock = strategyMemory.recentDecisions.length > 0
    ? `\nSTRATEGY HISTORY (what you decided before and what happened):\n${strategyMemory.recentDecisions.map((d) =>
      `- Week ${d.weekOf}: "${d.decision}" → ${d.outcome ? `${d.outcome.verdict}: ${d.outcome.summary}` : 'pending evaluation'}`,
    ).join('\n')}`
    : '';

  const patternsBlock = strategyMemory.patterns.length > 0
    ? `\nOBSERVED PATTERNS:\n${strategyMemory.patterns.map((p) => `- ${p}`).join('\n')}`
    : '';

  // Correlation insights block
  const correlationBlock = evaluation.correlations?.insights.length
    ? `\nCONTENT CORRELATION INSIGHTS:\n${evaluation.correlations.insights.map((i) => `- ${i}`).join('\n')}`
    : '';

  // Engagement block
  const eng = summary.engagement;
  const engagementBlock = (eng.bluesky.totalPosts > 0 || eng.devto.totalArticles > 0)
    ? `\nENGAGEMENT THIS WEEK:${eng.bluesky.totalPosts > 0 ? `\n- Bluesky: avg ${eng.bluesky.avgLikes.toFixed(1)} likes, ${eng.bluesky.avgReposts.toFixed(1)} reposts, ${eng.bluesky.avgReplies.toFixed(1)} replies (${eng.bluesky.totalPosts} posts)` : ''}${eng.devto.totalArticles > 0 ? `\n- Dev.to: avg ${eng.devto.avgViews.toFixed(0)} views, ${eng.devto.avgReactions.toFixed(1)} reactions, ${eng.devto.avgComments.toFixed(1)} comments (${eng.devto.totalArticles} articles)` : ''}`
    : '';

  const prompt = `You are Max, the autonomous growth agent for PromptFuel (an open-source token optimization toolkit). You're writing a brief weekly reflection for the founder.

METRICS THIS WEEK:
- GitHub: ${fmt(summary.stars.current)} stars (${summary.stars.delta >= 0 ? '+' : ''}${summary.stars.delta} this week), ${fmt(summary.forks.current)} forks
- Views: ${fmt(summary.views.total)} (${fmt(summary.views.uniques)} unique)
- npm downloads: ${fmt(summary.npmDownloadsWeek)} this week (prev week: ${fmt(summary.prevNpmDownloadsWeek)})
- Content posted: ${summary.postsCount.bluesky} Bluesky posts, ${summary.postsCount.devto} Dev.to articles, ${summary.postsCount.reddit} Reddit posts

EXPERIMENT RESULTS:
${evaluation.results.map((r) => `- ${r.name}: ${r.verdict} — ${r.summary}`).join('\n')}
${evaluation.topCategory ? `- Best performing category: ${evaluation.topCategory}` : ''}
${evaluation.weakCategory ? `- Weakest category: ${evaluation.weakCategory}` : ''}

GROWTH GOAL EVALUATION:
- Status: ${goalEval.status.toUpperCase()}${goalEval.stalledWeeks > 1 ? ` (${goalEval.stalledWeeks} consecutive stalled weeks)` : ''}
- Goals met: ${goalEval.met.length > 0 ? goalEval.met.join(', ') : 'none'}
- Goals missed: ${goalEval.missed.length > 0 ? goalEval.missed.join(', ') : 'none'}
- Targets: >=${DEFAULT_GOALS.weeklyStarsDelta} stars/week, >=${DEFAULT_GOALS.weeklyNpmDownloads} npm downloads/week, >=${DEFAULT_GOALS.weeklyUniqueViews} unique views/week
${engagementBlock}${correlationBlock}${strategyBlock}${patternsBlock}

Write a 3-5 sentence reflection covering: what went well, what to improve, and one specific strategy recommendation for next week. ${goalEval.status === 'stalled' ? 'Growth is stalled — be direct about what needs to change. Recommend a concrete pivot. DO NOT repeat a strategy that previously had a negative outcome.' : ''} Be concise and data-driven. No fluff. End with a clear, actionable recommendation.`;

  return generateContent(claudeApiKey, prompt, { temperature: 0.7, maxTokens: 500, model: 'claude-sonnet-4-6' });
}

// ── Weekly Digest Email ──

function buildWeeklyDigest(
  weekStart: string,
  summary: WeekSummary,
  evaluation: WeeklyEvaluation,
  reflection: string,
  stage: string,
  goalEval: GoalEvaluation,
  strategyMemory: StrategyMemory,
  hnDraft = '',
  linkedinDraft = '',
): { subject: string; html: string } {
  const npmDelta = summary.npmDownloadsWeek - summary.prevNpmDownloadsWeek;

  const hypothesisRows = evaluation.results
    .map((r) => {
      const color = r.verdict === 'supported' ? '#22c55e' : r.verdict === 'refuted' ? '#ef4444' : '#6b7280';
      const icon = r.verdict === 'supported' ? 'Y' : r.verdict === 'refuted' ? 'N' : '?';
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${r.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:bold">${icon}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${r.summary}</td>
      </tr>`;
    })
    .join('\n');

  const statusColor = goalEval.status === 'stalled' ? '#ef4444' : goalEval.status === 'accelerating' ? '#22c55e' : '#f59e0b';
  const statusLabel = goalEval.status.toUpperCase();

  // Engagement section
  const eng = summary.engagement;
  const engagementHtml = (eng.bluesky.totalPosts > 0 || eng.devto.totalArticles > 0) ? `
<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Engagement</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  ${eng.bluesky.totalPosts > 0 ? `<tr><td style="padding:6px 0">Bluesky (${eng.bluesky.totalPosts} posts)</td><td style="text-align:right">${eng.bluesky.avgLikes.toFixed(1)} likes · ${eng.bluesky.avgReposts.toFixed(1)} reposts · ${eng.bluesky.avgReplies.toFixed(1)} replies avg</td></tr>` : ''}
  ${eng.devto.totalArticles > 0 ? `<tr><td style="padding:6px 0">Dev.to (${eng.devto.totalArticles} articles)</td><td style="text-align:right">${eng.devto.avgViews.toFixed(0)} views · ${eng.devto.avgReactions.toFixed(1)} reactions · ${eng.devto.avgComments.toFixed(1)} comments avg</td></tr>` : ''}
</table>` : '';

  // Strategy section
  const lastDecision = strategyMemory.recentDecisions[strategyMemory.recentDecisions.length - 1];
  const strategyHtml = lastDecision ? `
<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Strategy Decision</h2>
<div style="padding:12px;background:#fef3c7;border-radius:8px;border-left:3px solid #f59e0b;font-size:14px;line-height:1.6">
<strong>${lastDecision.decision}</strong><br>
<span style="color:#6b7280">${lastDecision.rationale}</span>
${lastDecision.outcome ? `<br><span style="color:${lastDecision.outcome.verdict === 'positive' ? '#22c55e' : lastDecision.outcome.verdict === 'negative' ? '#ef4444' : '#6b7280'}">Outcome: ${lastDecision.outcome.summary}</span>` : ''}
</div>` : '';

  // Drafts section
  const draftsHtml = (hnDraft || linkedinDraft) ? `
<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Drafts for Manual Posting</h2>
${hnDraft ? `
<h3 style="font-size:14px;margin-bottom:6px">Hacker News</h3>
<div style="padding:12px;background:#f9fafb;border-radius:8px;border-left:3px solid #ff6600;font-size:13px;line-height:1.6;white-space:pre-wrap;font-family:monospace">${hnDraft.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
` : ''}
${linkedinDraft ? `
<h3 style="font-size:14px;margin-bottom:6px;margin-top:16px">LinkedIn</h3>
<div style="padding:12px;background:#f9fafb;border-radius:8px;border-left:3px solid #0a66c2;font-size:13px;line-height:1.6;white-space:pre-wrap;font-family:monospace">${linkedinDraft.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
` : ''}` : '';

  // Correlation section
  const correlationHtml = evaluation.correlations?.topPerformers.length ? `
<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Top Performing Content</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr style="background:#f9fafb">
    <th style="padding:6px 8px;text-align:left">Platform</th>
    <th style="padding:6px 8px;text-align:left">Category</th>
    <th style="padding:6px 8px;text-align:center">Score</th>
    <th style="padding:6px 8px;text-align:right">Stars +</th>
  </tr>
  ${evaluation.correlations.topPerformers.map((c) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${c.platform}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${c.category}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:bold">${c.score}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${c.metricDeltas.starsDelta}</td>
  </tr>`).join('\n')}
</table>` : '';

  const subject = `[Max Weekly] ${weekStart} — ${statusLabel} — ${fmt(summary.stars.current)} stars ${delta(summary.stars.delta).replace(/<[^>]+>/g, '')} | ${fmt(summary.npmDownloadsWeek)} downloads`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">

<h1 style="font-size:20px;margin-bottom:4px">Max Weekly Digest</h1>
<p style="color:#6b7280;margin-top:0">Week of ${weekStart} · Stage: <strong>${stage}</strong> · Growth: <strong style="color:${statusColor}">${statusLabel}</strong>${goalEval.stalledWeeks > 1 ? ` (${goalEval.stalledWeeks} weeks)` : ''}</p>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px">Growth Goals</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr><td style="padding:6px 0">Stars delta</td><td style="text-align:right">${summary.stars.delta >= DEFAULT_GOALS.weeklyStarsDelta ? '<span style="color:#22c55e">PASS</span>' : '<span style="color:#ef4444">MISS</span>'} (${summary.stars.delta} / ${DEFAULT_GOALS.weeklyStarsDelta} target)</td></tr>
  <tr><td style="padding:6px 0">npm downloads</td><td style="text-align:right">${summary.npmDownloadsWeek >= DEFAULT_GOALS.weeklyNpmDownloads ? '<span style="color:#22c55e">PASS</span>' : '<span style="color:#ef4444">MISS</span>'} (${fmt(summary.npmDownloadsWeek)} / ${fmt(DEFAULT_GOALS.weeklyNpmDownloads)} target)</td></tr>
  <tr><td style="padding:6px 0">Unique views</td><td style="text-align:right">${summary.views.uniques >= DEFAULT_GOALS.weeklyUniqueViews ? '<span style="color:#22c55e">PASS</span>' : '<span style="color:#ef4444">MISS</span>'} (${fmt(summary.views.uniques)} / ${fmt(DEFAULT_GOALS.weeklyUniqueViews)} target)</td></tr>
</table>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Week-over-Week</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr><td style="padding:6px 0">Stars</td><td style="text-align:right"><strong>${fmt(summary.stars.current)}</strong> ${delta(summary.stars.delta)}</td></tr>
  <tr><td style="padding:6px 0">Forks</td><td style="text-align:right"><strong>${fmt(summary.forks.current)}</strong> ${delta(summary.forks.delta)}</td></tr>
  <tr><td style="padding:6px 0">Views</td><td style="text-align:right"><strong>${fmt(summary.views.total)}</strong> (${fmt(summary.views.uniques)} unique)</td></tr>
  <tr><td style="padding:6px 0">Clones</td><td style="text-align:right"><strong>${fmt(summary.clones.total)}</strong> (${fmt(summary.clones.uniques)} unique)</td></tr>
  <tr><td style="padding:6px 0">npm downloads</td><td style="text-align:right"><strong>${fmt(summary.npmDownloadsWeek)}</strong> ${delta(npmDelta)}</td></tr>
</table>
${engagementHtml}

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Content Output</h2>
<p style="font-size:14px">${summary.postsCount.bluesky} Bluesky posts · ${summary.postsCount.devto} Dev.to articles · ${summary.postsCount.reddit} Reddit posts · ${evaluation.totalExperiments} quality evaluations</p>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Experiment Results</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr style="background:#f9fafb">
    <th style="padding:6px 8px;text-align:left">Hypothesis</th>
    <th style="padding:6px 8px;text-align:center">Result</th>
    <th style="padding:6px 8px;text-align:left">Detail</th>
  </tr>
  ${hypothesisRows}
</table>
${correlationHtml}
${strategyHtml}
${draftsHtml}

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Reflection</h2>
<div style="padding:12px;background:#f0f9ff;border-radius:8px;border-left:3px solid #3b82f6;font-size:14px;line-height:1.6">
${reflection}
</div>

<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
<p style="font-size:12px;color:#9ca3af;text-align:center">Max Agent · PromptFuel · Weekly Brain</p>

</body>
</html>`;

  return { subject, html };
}

// ── Main Weekly Flow ──

export async function weeklyReflection(config: MaxConfig): Promise<void> {
  const now = new Date();
  const weekStart = getMonday(now);
  // Actually reflect on the *previous* week (we run Monday morning)
  const prevMonday = new Date(new Date(weekStart + 'T00:00:00Z').getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  console.log(`[Max] Weekly reflection for week of ${prevMonday}`);

  // 1. Aggregate snapshots
  const snapshots = loadWeekSnapshots(config.dataDir, prevMonday);
  const prevSnapshots = loadPrevWeekSnapshots(config.dataDir, prevMonday);
  console.log(`[Max] Loaded ${snapshots.length} snapshots (prev week: ${prevSnapshots.length})`);

  // 2. Collect fresh engagement data
  try {
    console.log('[Max] Collecting fresh engagement data...');
    await collectEngagement(config);
  } catch (err) {
    console.warn('[Max] Engagement collection failed (non-fatal):', (err as Error).message);
  }

  // 3. Evaluate experiments (now includes correlations)
  const evaluation = evaluateWeek(config.dataDir, prevMonday);
  console.log(`[Max] Evaluated ${evaluation.totalExperiments} experiments, ${evaluation.results.length} hypotheses`);

  for (const r of evaluation.results) {
    console.log(`[Max]   ${r.name}: ${r.verdict} — ${r.summary}`);
  }

  if (evaluation.correlations) {
    console.log(`[Max] Correlation report: ${evaluation.correlations.correlations.length} posts correlated`);
    for (const insight of evaluation.correlations.insights) {
      console.log(`[Max]   Insight: ${insight}`);
    }
  }

  // 4. Summarize week (includes engagement)
  const stateFile = join(config.dataDir, 'state.json');
  const state = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf-8'))
    : { warmupStartDate: '2026-03-24' };
  const stage = getStage(state.warmupStartDate);
  const summary = summarizeWeek(snapshots, prevSnapshots, config.dataDir, prevMonday);

  // 5. Evaluate growth goals
  const prevStalledWeeks = state.stalledWeeks ?? 0;
  const goalEval = evaluateGoals(summary, prevStalledWeeks);
  console.log(`[Max] Growth status: ${goalEval.status} (met: ${goalEval.met.join(', ') || 'none'}, missed: ${goalEval.missed.join(', ') || 'none'})`);

  // 6. Evaluate past strategy outcomes
  const currentMetrics = buildMetricsSnapshot(summary);
  const prevSummary = summarizeWeek(prevSnapshots, [], config.dataDir,
    new Date(new Date(prevMonday + 'T00:00:00Z').getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const prevMetrics = buildMetricsSnapshot(prevSummary);

  try {
    evaluateOutcomes(config.dataDir, currentMetrics, prevMetrics);
    console.log('[Max] Strategy outcomes evaluated');
  } catch (err) {
    console.warn('[Max] Strategy outcome evaluation failed (non-fatal):', (err as Error).message);
  }

  // 7. Build strategy memory
  const strategyMemory = buildStrategyMemory(config.dataDir);
  if (strategyMemory.recentDecisions.length > 0) {
    console.log(`[Max] Strategy memory: ${strategyMemory.recentDecisions.length} recent decisions, ${strategyMemory.patterns.length} patterns`);
  }

  // 8. Generate Claude reflection (with strategy + correlations)
  console.log('[Max] Generating reflection...');
  const reflection = await generateReflection(config.claudeApiKey, summary, evaluation, goalEval, strategyMemory);
  console.log(`[Max] Reflection: ${reflection.slice(0, 100)}...`);

  // 9. Extract structured strategy decision
  let strategyDecision: CalendarContext['strategyDecision'] | undefined;
  try {
    console.log('[Max] Extracting strategy decision...');
    const decision = await extractDecision(config.claudeApiKey, reflection, goalEval.status, strategyMemory);
    const recorded = recordDecision(config.dataDir, decision);
    console.log(`[Max] Strategy decision: ${recorded.id} — "${recorded.decision}"`);
    strategyDecision = { decision: recorded.decision, parameters: recorded.parameters };
  } catch (err) {
    console.warn('[Max] Strategy decision extraction failed (non-fatal):', (err as Error).message);
  }

  // 10. Influencer format research — study what's working this week across platforms
  let formatInsights: FormatInsights | undefined;
  try {
    console.log('[Max] Running influencer format research...');
    const research = await fetchInfluencerPosts();
    if (research.posts.length > 0 && config.claudeApiKey) {
      formatInsights = await researchFormats(config.claudeApiKey, research, config.dataDir);
    } else {
      formatInsights = loadFormatInsights(config.dataDir) ?? undefined;
      if (formatInsights) console.log('[Max] Using cached format insights');
    }
  } catch (err) {
    console.warn('[Max] Format research failed (non-fatal):', (err as Error).message);
    formatInsights = loadFormatInsights(config.dataDir) ?? undefined;
  }

  // 11. Generate Reddit/HN/LinkedIn drafts (before email so drafts appear in digest)
  console.log('[Max] Generating platform drafts...');
  const latest = snapshots[snapshots.length - 1];
  let hnDraft = '';
  let linkedinDraft = '';
  if (latest) {
    const totalWeek = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0);
    const totalMonth = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastMonth, 0);
    const history = loadHistory(config.dataDir);
    const ctx = {
      stars: latest.github.stars,
      forks: latest.github.forks,
      npmDownloadsWeek: totalWeek,
      npmDownloadsMonth: totalMonth,
      deltaStars: summary.stars.delta,
      recentPosts: history.slice(-5).map((e) =>
        e.platform === 'bluesky' ? e.content : (e.title ?? e.content.slice(0, 80)),
      ),
    };
    await generateDrafts(config, ctx);
    const today = new Date().toISOString().split('T')[0];
    const hnPath = join(config.dataDir, 'drafts', `${today}-hn.md`);
    const linkedinPath = join(config.dataDir, 'drafts', `${today}-linkedin.md`);
    if (existsSync(hnPath)) hnDraft = readFileSync(hnPath, 'utf-8');
    if (existsSync(linkedinPath)) linkedinDraft = readFileSync(linkedinPath, 'utf-8');
  }

  // 12. Build and send weekly email
  const { subject, html } = buildWeeklyDigest(prevMonday, summary, evaluation, reflection, stage, goalEval, strategyMemory, hnDraft, linkedinDraft);
  const emailResult = await sendEmail(config.resendApiKey, {
    to: config.reportEmail,
    subject,
    html,
  });
  console.log(`[Max] Weekly digest sent: ${emailResult.id}`);

  // 13. Generate next week's calendar — WITH enriched context
  console.log('[Max] Generating next week calendar with enriched context...');
  const calendarCtx: CalendarContext = {
    topCategory: evaluation.topCategory,
    weakCategory: evaluation.weakCategory,
    growthStatus: goalEval.status,
    reflection,
    strategyDecision,
    correlationInsights: evaluation.correlations?.insights,
    engagementRankings: evaluation.correlations?.categoryRankings,
    formatInsights,
  };
  const calendar = await generateWeeklyCalendar(config.claudeApiKey, stage, config.dataDir, calendarCtx);

  // 13b. Pre-generate this week's content (so daily runs just publish, no API calls needed)
  try {
    const latest = snapshots[snapshots.length - 1];
    if (latest) {
      const totalWeek = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0);
      const totalMonth = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastMonth, 0);
      const history = loadHistory(config.dataDir);
      const promptCtx = {
        stars: latest.github.stars,
        forks: latest.github.forks,
        npmDownloadsWeek: totalWeek,
        npmDownloadsMonth: totalMonth,
        deltaStars: summary.stars.delta,
        recentPosts: history.slice(-5).map((e) =>
          e.platform === 'bluesky' ? e.content : (e.title ?? e.content.slice(0, 80)),
        ),
      };
      await pregenerateWeek(config.claudeApiKey, calendar, promptCtx, config.dataDir, formatInsights);
    }
  } catch (err) {
    console.warn('[Max] Content pre-generation failed (non-fatal):', (err as Error).message);
  }

  // 14. Save correlation report
  if (evaluation.correlations) {
    saveCorrelationReport(config.dataDir, evaluation.correlations);
  }

  // 15. Update state
  state.lastWeeklyRun = new Date().toISOString();
  state.growthStatus = goalEval.status;
  state.stalledWeeks = goalEval.stalledWeeks;
  state.lastGoalEval = {
    week: prevMonday,
    status: goalEval.status,
    met: goalEval.met,
    missed: goalEval.missed,
  };
  state.lastEngagementRun = new Date().toISOString();
  state.lastCorrelationRun = evaluation.correlations ? new Date().toISOString() : state.lastCorrelationRun;
  writeFileSync(stateFile, JSON.stringify(state, null, 2));

  console.log('[Max] Weekly brain complete.');
}
