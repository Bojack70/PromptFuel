/**
 * Experiment tracker — records quality scores for every content generation.
 * Data stored in data/experiments.json for weekly analysis.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentCategory } from '../content/templates.js';
import type { QualityScore } from '../content/quality.js';

export interface ExperimentEntry {
  date: string;
  timestamp: string;
  platform: 'twitter' | 'devto';
  category: ContentCategory;
  qualityScores: QualityScore;
  passed: boolean;
  retried: boolean;
}

export function loadExperiments(dataDir: string): ExperimentEntry[] {
  const file = join(dataDir, 'experiments.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

export function recordExperiment(dataDir: string, entry: ExperimentEntry): void {
  const entries = loadExperiments(dataDir);
  entries.push(entry);
  writeFileSync(join(dataDir, 'experiments.json'), JSON.stringify(entries, null, 2));
}

export function getWeekExperiments(dataDir: string, weekStart: string): ExperimentEntry[] {
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const all = loadExperiments(dataDir);

  return all.filter((e) => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d >= start && d < end;
  });
}
