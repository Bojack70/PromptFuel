/**
 * Strategy decisions log — persistent memory of what was tried and what happened.
 * Each week records a structured decision; subsequent weeks evaluate the outcome.
 * This is the "learning" layer that prevents the agent from repeating failed strategies.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentCategory } from '../content/templates.js';
import { generateContent } from '../content/gemini.js';

// ── Types ──

export interface MetricsSnapshot {
  starsDelta: number;
  npmDownloadsWeek: number;
  uniqueViews: number;
  avgEngagement: number;
}

export interface StrategyOutcome {
  evaluatedAt: string;
  metricsBefore: MetricsSnapshot;
  metricsAfter: MetricsSnapshot;
  verdict: 'positive' | 'negative' | 'neutral';
  summary: string;
}

export interface StrategyDecision {
  id: string;
  weekOf: string;
  decidedAt: string;
  decision: string;
  rationale: string;
  type: 'category_shift' | 'frequency_change' | 'platform_rebalance' | 'general';
  parameters?: {
    categoryWeights?: Partial<Record<ContentCategory, number>>;
    postingFrequency?: { bluesky: number; devto: number };
  };
  status: 'active' | 'evaluated';
  outcome?: StrategyOutcome;
}

export interface StrategyMemory {
  recentDecisions: StrategyDecision[];
  patterns: string[];
}

// ── Persistence ──

const STRATEGY_FILE = 'strategy-log.json';

export function loadStrategyLog(dataDir: string): StrategyDecision[] {
  const file = join(dataDir, STRATEGY_FILE);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveStrategyLog(dataDir: string, log: StrategyDecision[]): void {
  writeFileSync(join(dataDir, STRATEGY_FILE), JSON.stringify(log, null, 2));
}

// ── Record a Decision ──

export function recordDecision(
  dataDir: string,
  decision: Omit<StrategyDecision, 'id' | 'status'>,
): StrategyDecision {
  const log = loadStrategyLog(dataDir);

  // Generate ID from week + type
  const weekNum = getISOWeek(decision.weekOf);
  const year = decision.weekOf.slice(0, 4);
  const id = `${year}-W${String(weekNum).padStart(2, '0')}-${decision.type}`;

  const entry: StrategyDecision = { ...decision, id, status: 'active' };
  log.push(entry);
  saveStrategyLog(dataDir, log);

  return entry;
}

function getISOWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// ── Evaluate Past Outcomes ──

function computeVerdict(before: MetricsSnapshot, after: MetricsSnapshot): 'positive' | 'negative' | 'neutral' {
  let improved = 0;
  let declined = 0;

  if (after.starsDelta > before.starsDelta) improved++;
  else if (after.starsDelta < before.starsDelta) declined++;

  if (after.npmDownloadsWeek > before.npmDownloadsWeek) improved++;
  else if (after.npmDownloadsWeek < before.npmDownloadsWeek) declined++;

  if (after.uniqueViews > before.uniqueViews) improved++;
  else if (after.uniqueViews < before.uniqueViews) declined++;

  if (improved >= 2) return 'positive';
  if (declined >= 2) return 'negative';
  return 'neutral';
}

function summarizeOutcome(before: MetricsSnapshot, after: MetricsSnapshot, verdict: string): string {
  const parts: string[] = [];
  const starsDiff = after.starsDelta - before.starsDelta;
  const npmDiff = after.npmDownloadsWeek - before.npmDownloadsWeek;
  const viewsDiff = after.uniqueViews - before.uniqueViews;

  if (starsDiff !== 0) parts.push(`stars ${starsDiff > 0 ? '+' : ''}${starsDiff}`);
  if (npmDiff !== 0) parts.push(`npm ${npmDiff > 0 ? '+' : ''}${npmDiff}`);
  if (viewsDiff !== 0) parts.push(`views ${viewsDiff > 0 ? '+' : ''}${viewsDiff}`);

  return `${verdict}: ${parts.join(', ') || 'no significant change'}`;
}

export function evaluateOutcomes(
  dataDir: string,
  currentMetrics: MetricsSnapshot,
  prevWeekMetrics: MetricsSnapshot,
): StrategyDecision[] {
  const log = loadStrategyLog(dataDir);
  let changed = false;

  for (const decision of log) {
    if (decision.status !== 'active') continue;

    // Evaluate: before = metrics from the week the decision was made (prevWeekMetrics),
    // after = current week's metrics
    const verdict = computeVerdict(prevWeekMetrics, currentMetrics);
    const summary = summarizeOutcome(prevWeekMetrics, currentMetrics, verdict);

    decision.status = 'evaluated';
    decision.outcome = {
      evaluatedAt: new Date().toISOString(),
      metricsBefore: prevWeekMetrics,
      metricsAfter: currentMetrics,
      verdict,
      summary,
    };
    changed = true;
  }

  if (changed) saveStrategyLog(dataDir, log);
  return log;
}

// ── Build Strategy Memory ──

function derivePatterns(decisions: StrategyDecision[]): string[] {
  const patterns: string[] = [];
  const evaluated = decisions.filter((d) => d.outcome);
  if (evaluated.length < 2) return patterns;

  // Check if category shifts have a pattern
  const categoryShifts = evaluated.filter((d) => d.type === 'category_shift');
  const positiveShifts = categoryShifts.filter((d) => d.outcome?.verdict === 'positive');
  const negativeShifts = categoryShifts.filter((d) => d.outcome?.verdict === 'negative');

  if (positiveShifts.length > 0) {
    const successfulCategories = positiveShifts
      .filter((d) => d.parameters?.categoryWeights)
      .flatMap((d) => Object.entries(d.parameters!.categoryWeights!)
        .filter(([, w]) => w > 0.2)
        .map(([cat]) => cat));
    const unique = [...new Set(successfulCategories)];
    if (unique.length > 0) {
      patterns.push(`Category shifts toward ${unique.join(', ')} have been positive`);
    }
  }

  if (negativeShifts.length > 0) {
    patterns.push(`${negativeShifts.length} category shift(s) had negative outcomes — avoid repeating those mixes`);
  }

  // Check verdict trend
  const recentVerdicts = evaluated.slice(-3).map((d) => d.outcome!.verdict);
  if (recentVerdicts.every((v) => v === 'negative')) {
    patterns.push('Last 3 strategy decisions all had negative outcomes — consider a fundamentally different approach');
  } else if (recentVerdicts.every((v) => v === 'positive')) {
    patterns.push('Last 3 strategies were all positive — current direction is working');
  }

  return patterns;
}

export function buildStrategyMemory(dataDir: string): StrategyMemory {
  const log = loadStrategyLog(dataDir);
  const recentDecisions = log.slice(-4);
  const patterns = derivePatterns(log);

  return { recentDecisions, patterns };
}

// ── Extract Decision from Gemini Reflection ──

export async function extractDecision(
  geminiApiKey: string,
  reflection: string,
  goalStatus: string,
  strategyMemory: StrategyMemory,
): Promise<Omit<StrategyDecision, 'id' | 'status'>> {
  const historyBlock = strategyMemory.recentDecisions.length > 0
    ? strategyMemory.recentDecisions.map((d) =>
      `- Week ${d.weekOf}: "${d.decision}" → ${d.outcome ? `${d.outcome.verdict}: ${d.outcome.summary}` : 'pending'}`,
    ).join('\n')
    : 'No previous decisions recorded.';

  const patternsBlock = strategyMemory.patterns.length > 0
    ? strategyMemory.patterns.map((p) => `- ${p}`).join('\n')
    : 'No patterns detected yet.';

  const prompt = `You are an AI growth strategist. Based on the weekly reflection and strategy history, extract a single concrete strategy decision for next week.

WEEKLY REFLECTION:
"${reflection}"

GROWTH STATUS: ${goalStatus}

PREVIOUS STRATEGY DECISIONS:
${historyBlock}

OBSERVED PATTERNS:
${patternsBlock}

Respond in EXACTLY this JSON format, nothing else:
{
  "decision": "One sentence describing the strategy change",
  "rationale": "Why this decision based on the data",
  "type": "category_shift|frequency_change|platform_rebalance|general",
  "parameters": {
    "categoryWeights": {"tip": 0.2, "comparison": 0.2, "tutorial": 0.3, "stats": 0.1, "launch": 0.1, "opinion": 0.1},
    "postingFrequency": {"bluesky": 7, "devto": 3}
  }
}

Rules:
- categoryWeights must sum to 1.0 (approximate distribution for next week)
- postingFrequency is posts per week for each platform
- type should match the primary change you're recommending
- If growth is stalled, be bold. If accelerating, stay the course with minor tweaks.
- DO NOT repeat a strategy that had a "negative" outcome unless you have a specific reason.`;

  const raw = await generateContent(geminiApiKey, prompt, { temperature: 0.5, maxTokens: 500 });

  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(cleaned);

    const now = new Date();
    const monday = getMonday(now);

    return {
      weekOf: monday,
      decidedAt: now.toISOString(),
      decision: parsed.decision || 'Continue current strategy',
      rationale: parsed.rationale || 'Based on weekly reflection',
      type: (['category_shift', 'frequency_change', 'platform_rebalance', 'general'] as const).includes(parsed.type)
        ? parsed.type
        : 'general',
      parameters: parsed.parameters
        ? {
            categoryWeights: parsed.parameters.categoryWeights,
            postingFrequency: parsed.parameters.postingFrequency,
          }
        : undefined,
    };
  } catch {
    // Fallback: general decision from reflection
    const now = new Date();
    return {
      weekOf: getMonday(now),
      decidedAt: now.toISOString(),
      decision: reflection.split('.')[0] || 'Continue current strategy',
      rationale: 'Auto-extracted from reflection (JSON parse failed)',
      type: 'general',
    };
  }
}

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}
