/**
 * Hypothesis definitions — predefined questions the agent evaluates weekly.
 * Each hypothesis compares experiment data to produce a verdict.
 */

import type { ExperimentEntry } from './tracker.js';
import type { ContentCategory } from '../content/templates.js';
import type { ContentCorrelation } from '../brain/correlation.js';

export interface HypothesisResult {
  id: string;
  name: string;
  verdict: 'supported' | 'refuted' | 'insufficient_data';
  summary: string;
  sampleSize: number;
}

export interface Hypothesis {
  id: string;
  name: string;
  description: string;
  minSamples: number;
  evaluate: (experiments: ExperimentEntry[], correlations?: ContentCorrelation[]) => HypothesisResult;
}

function avgScore(entries: ExperimentEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((s, e) => s + e.qualityScores.average, 0) / entries.length;
}

function byCategory(entries: ExperimentEntry[], cat: ContentCategory): ExperimentEntry[] {
  return entries.filter((e) => e.category === cat);
}

function byPlatform(entries: ExperimentEntry[], platform: 'bluesky' | 'mastodon' | 'devto' | 'reddit'): ExperimentEntry[] {
  return entries.filter((e) => e.platform === platform);
}

export const HYPOTHESES: Hypothesis[] = [
  {
    id: 'tips-vs-opinions',
    name: 'Tips outperform opinions',
    description: 'Tip content scores higher on average than opinion content',
    minSamples: 4,
    evaluate(experiments) {
      const tips = byCategory(experiments, 'tip');
      const opinions = byCategory(experiments, 'opinion');
      const total = tips.length + opinions.length;

      if (total < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} samples, have ${total}`, sampleSize: total };
      }

      const tipAvg = avgScore(tips);
      const opinionAvg = avgScore(opinions);
      const supported = tipAvg > opinionAvg;

      return {
        id: this.id,
        name: this.name,
        verdict: supported ? 'supported' : 'refuted',
        summary: `Tips avg ${tipAvg.toFixed(1)} vs opinions avg ${opinionAvg.toFixed(1)}`,
        sampleSize: total,
      };
    },
  },
  {
    id: 'devto-vs-bluesky',
    name: 'Dev.to articles score higher than Bluesky posts',
    description: 'Longer-form Dev.to content receives higher quality scores than short posts',
    minSamples: 4,
    evaluate(experiments) {
      const posts = byPlatform(experiments, 'bluesky');
      const articles = byPlatform(experiments, 'devto');
      const total = posts.length + articles.length;

      if (total < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} samples, have ${total}`, sampleSize: total };
      }

      const postAvg = avgScore(posts);
      const articleAvg = avgScore(articles);
      const supported = articleAvg > postAvg;

      return {
        id: this.id,
        name: this.name,
        verdict: supported ? 'supported' : 'refuted',
        summary: `Dev.to avg ${articleAvg.toFixed(1)} vs Bluesky avg ${postAvg.toFixed(1)}`,
        sampleSize: total,
      };
    },
  },
  {
    id: 'retry-improves-quality',
    name: 'Retry improves quality',
    description: 'Content that was retried after failing quality gate ends up with higher pass rates',
    minSamples: 3,
    evaluate(experiments) {
      const retried = experiments.filter((e) => e.retried);
      const firstPass = experiments.filter((e) => !e.retried);

      if (retried.length < 2) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need at least 2 retried samples, have ${retried.length}`, sampleSize: retried.length };
      }

      const retriedPassRate = retried.filter((e) => e.passed).length / retried.length;
      const firstPassAvg = avgScore(firstPass);
      const retriedAvg = avgScore(retried);

      return {
        id: this.id,
        name: this.name,
        verdict: retriedAvg >= firstPassAvg ? 'supported' : 'refuted',
        summary: `Retried avg ${retriedAvg.toFixed(1)} (${(retriedPassRate * 100).toFixed(0)}% pass) vs first-pass avg ${firstPassAvg.toFixed(1)}`,
        sampleSize: retried.length + firstPass.length,
      };
    },
  },
  {
    id: 'top-category',
    name: 'Category ranking by quality',
    description: 'Identifies which content category consistently scores highest',
    minSamples: 6,
    evaluate(experiments) {
      if (experiments.length < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} samples, have ${experiments.length}`, sampleSize: experiments.length };
      }

      const categories: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'stats', 'launch', 'opinion'];
      const ranked = categories
        .map((cat) => {
          const entries = byCategory(experiments, cat);
          return { category: cat, avg: avgScore(entries), count: entries.length };
        })
        .filter((r) => r.count > 0)
        .sort((a, b) => b.avg - a.avg);

      const top = ranked[0];
      const bottom = ranked[ranked.length - 1];

      return {
        id: this.id,
        name: this.name,
        verdict: 'supported',
        summary: `Best: ${top.category} (${top.avg.toFixed(1)}, n=${top.count}) · Worst: ${bottom.category} (${bottom.avg.toFixed(1)}, n=${bottom.count})`,
        sampleSize: experiments.length,
      };
    },
  },

  // ── Engagement-based hypotheses (require correlation data) ──

  {
    id: 'engagement-drives-stars',
    name: 'High engagement drives star growth',
    description: 'Posts in the top quartile of engagement are followed by above-average star growth',
    minSamples: 8,
    evaluate(_experiments, correlations?) {
      if (!correlations || correlations.length < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} correlated samples, have ${correlations?.length ?? 0}`, sampleSize: correlations?.length ?? 0 };
      }

      const sorted = [...correlations].sort((a, b) => {
        const aEng = (a.engagement.likes ?? 0) + (a.engagement.reposts ?? 0) + (a.engagement.reactions ?? 0) + (a.engagement.comments ?? 0);
        const bEng = (b.engagement.likes ?? 0) + (b.engagement.reposts ?? 0) + (b.engagement.reactions ?? 0) + (b.engagement.comments ?? 0);
        return bEng - aEng;
      });

      const q1Count = Math.max(1, Math.floor(sorted.length / 4));
      const topQuartile = sorted.slice(0, q1Count);
      const rest = sorted.slice(q1Count);

      const topAvgStars = topQuartile.reduce((s, c) => s + c.metricDeltas.starsDelta, 0) / topQuartile.length;
      const restAvgStars = rest.length > 0 ? rest.reduce((s, c) => s + c.metricDeltas.starsDelta, 0) / rest.length : 0;

      const supported = topAvgStars > restAvgStars;
      return {
        id: this.id,
        name: this.name,
        verdict: supported ? 'supported' : 'refuted',
        summary: `Top quartile engagement → ${topAvgStars.toFixed(1)} avg stars vs ${restAvgStars.toFixed(1)} for rest`,
        sampleSize: correlations.length,
      };
    },
  },
  {
    id: 'tutorials-convert-best',
    name: 'Tutorials have highest conversion',
    description: 'Tutorial content has the highest average correlation score',
    minSamples: 4,
    evaluate(_experiments, correlations?) {
      if (!correlations || correlations.length < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} correlated samples, have ${correlations?.length ?? 0}`, sampleSize: correlations?.length ?? 0 };
      }

      const categories: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'stats', 'launch', 'opinion'];
      const ranked = categories
        .map((cat) => {
          const entries = correlations.filter((c) => c.category === cat);
          if (entries.length === 0) return null;
          return { category: cat, avg: entries.reduce((s, e) => s + e.score, 0) / entries.length, count: entries.length };
        })
        .filter((r): r is { category: ContentCategory; avg: number; count: number } => r !== null)
        .sort((a, b) => b.avg - a.avg);

      if (ranked.length === 0) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: 'No category data', sampleSize: 0 };
      }

      const tutorialRank = ranked.find((r) => r.category === 'tutorial');
      const supported = ranked[0].category === 'tutorial';

      return {
        id: this.id,
        name: this.name,
        verdict: supported ? 'supported' : 'refuted',
        summary: `Top converter: ${ranked[0].category} (score ${ranked[0].avg.toFixed(0)})${tutorialRank ? `, tutorials at ${tutorialRank.avg.toFixed(0)}` : ', tutorials: no data'}`,
        sampleSize: correlations.length,
      };
    },
  },
  {
    id: 'devto-converts-better',
    name: 'Dev.to drives more conversions than Bluesky',
    description: 'Dev.to articles have higher average correlation scores than Bluesky posts',
    minSamples: 4,
    evaluate(_experiments, correlations?) {
      if (!correlations || correlations.length < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} correlated samples, have ${correlations?.length ?? 0}`, sampleSize: correlations?.length ?? 0 };
      }

      const devto = correlations.filter((c) => c.platform === 'devto');
      const bluesky = correlations.filter((c) => c.platform === 'bluesky');

      if (devto.length === 0 || bluesky.length === 0) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need both platforms (devto: ${devto.length}, bluesky: ${bluesky.length})`, sampleSize: correlations.length };
      }

      const devtoAvg = devto.reduce((s, c) => s + c.score, 0) / devto.length;
      const blueskyAvg = bluesky.reduce((s, c) => s + c.score, 0) / bluesky.length;

      return {
        id: this.id,
        name: this.name,
        verdict: devtoAvg > blueskyAvg ? 'supported' : 'refuted',
        summary: `Dev.to avg score ${devtoAvg.toFixed(0)} vs Bluesky ${blueskyAvg.toFixed(0)}`,
        sampleSize: correlations.length,
      };
    },
  },
  {
    id: 'timing-matters',
    name: 'Post timing affects engagement',
    description: 'Posts published before 12:00 UTC get more engagement than afternoon posts',
    minSamples: 6,
    evaluate(experiments, correlations?) {
      if (!correlations || correlations.length < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} correlated samples, have ${correlations?.length ?? 0}`, sampleSize: correlations?.length ?? 0 };
      }

      // Use experiment timestamps to determine posting time
      const withTiming = correlations.map((c) => {
        const exp = experiments.find((e) => e.date === c.date && e.platform === c.platform);
        const hour = exp ? new Date(exp.timestamp).getUTCHours() : 12;
        return { ...c, hour };
      });

      const morning = withTiming.filter((c) => c.hour < 12);
      const afternoon = withTiming.filter((c) => c.hour >= 12);

      if (morning.length === 0 || afternoon.length === 0) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need both time slots (morning: ${morning.length}, afternoon: ${afternoon.length})`, sampleSize: correlations.length };
      }

      const morningAvg = morning.reduce((s, c) => s + c.score, 0) / morning.length;
      const afternoonAvg = afternoon.reduce((s, c) => s + c.score, 0) / afternoon.length;

      return {
        id: this.id,
        name: this.name,
        verdict: morningAvg > afternoonAvg ? 'supported' : 'refuted',
        summary: `Morning avg score ${morningAvg.toFixed(0)} vs afternoon ${afternoonAvg.toFixed(0)}`,
        sampleSize: correlations.length,
      };
    },
  },
];
