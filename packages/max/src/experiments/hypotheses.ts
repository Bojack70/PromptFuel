/**
 * Hypothesis definitions — predefined questions the agent evaluates weekly.
 * Each hypothesis compares experiment data to produce a verdict.
 */

import type { ExperimentEntry } from './tracker.js';
import type { ContentCategory } from '../content/templates.js';

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
  evaluate: (experiments: ExperimentEntry[]) => HypothesisResult;
}

function avgScore(entries: ExperimentEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((s, e) => s + e.qualityScores.average, 0) / entries.length;
}

function byCategory(entries: ExperimentEntry[], cat: ContentCategory): ExperimentEntry[] {
  return entries.filter((e) => e.category === cat);
}

function byPlatform(entries: ExperimentEntry[], platform: 'twitter' | 'devto'): ExperimentEntry[] {
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
    id: 'devto-vs-twitter',
    name: 'Dev.to articles score higher than tweets',
    description: 'Longer-form Dev.to content receives higher quality scores than tweets',
    minSamples: 4,
    evaluate(experiments) {
      const tweets = byPlatform(experiments, 'twitter');
      const articles = byPlatform(experiments, 'devto');
      const total = tweets.length + articles.length;

      if (total < this.minSamples) {
        return { id: this.id, name: this.name, verdict: 'insufficient_data', summary: `Need ${this.minSamples} samples, have ${total}`, sampleSize: total };
      }

      const tweetAvg = avgScore(tweets);
      const articleAvg = avgScore(articles);
      const supported = articleAvg > tweetAvg;

      return {
        id: this.id,
        name: this.name,
        verdict: supported ? 'supported' : 'refuted',
        summary: `Dev.to avg ${articleAvg.toFixed(1)} vs Twitter avg ${tweetAvg.toFixed(1)}`,
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
];
