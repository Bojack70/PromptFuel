/**
 * Weekly hypothesis evaluator — runs all hypotheses against experiment data.
 */

import type { ContentCategory } from '../content/templates.js';
import { getWeekExperiments, type ExperimentEntry } from './tracker.js';
import { HYPOTHESES, type HypothesisResult } from './hypotheses.js';

export interface WeeklyEvaluation {
  weekStart: string;
  results: HypothesisResult[];
  topCategory: ContentCategory | null;
  weakCategory: ContentCategory | null;
  totalExperiments: number;
}

function avgScore(entries: ExperimentEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.reduce((s, e) => s + e.qualityScores.average, 0) / entries.length;
}

export function evaluateWeek(dataDir: string, weekStart: string): WeeklyEvaluation {
  const experiments = getWeekExperiments(dataDir, weekStart);
  const results = HYPOTHESES.map((h) => h.evaluate(experiments));

  // Find top and weak categories
  const categories: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'stats', 'launch', 'opinion'];
  const ranked = categories
    .map((cat) => {
      const entries = experiments.filter((e) => e.category === cat);
      return { category: cat, avg: avgScore(entries), count: entries.length };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.avg - a.avg);

  return {
    weekStart,
    results,
    topCategory: ranked.length > 0 ? ranked[0].category : null,
    weakCategory: ranked.length > 1 ? ranked[ranked.length - 1].category : null,
    totalExperiments: experiments.length,
  };
}
