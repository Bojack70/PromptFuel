/**
 * Nate's notebook — running log of observations that compound over time.
 *
 * Each week, the weekly brain extracts 2-4 surprising/non-obvious observations
 * from the data (analytics deltas, engagement correlations, reading corpus,
 * strategy outcomes) and appends them here. Content generation pulls 2-3
 * recent entries into prompts so posts reflect genuine thought-progression,
 * not timeless-feeling platitudes.
 *
 * The moat: over months, this becomes a record of what Nate has actually
 * noticed — something no agent starting from scratch can replicate. Posts
 * that reference real prior observations feel lived-in.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../content/claude.js';

const FILE = 'nate-notebook.json';

export type NotebookSource =
  | 'analytics'      // GitHub/npm/views deltas
  | 'engagement'     // Bluesky/Dev.to likes/views/comments
  | 'correlation'    // content-to-metric correlations
  | 'reading'        // distilled from daily reading corpus
  | 'strategy';      // strategy-log outcome reflections

export interface NotebookEntry {
  date: string;              // YYYY-MM-DD added
  observation: string;       // 1-2 sentence lived-in observation in first person
  source: NotebookSource;
  weekOf?: string;           // monday of the week it was extracted from
}

export interface Notebook {
  entries: NotebookEntry[];
}

export function loadNotebook(dataDir: string): Notebook {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

export function saveNotebook(dataDir: string, notebook: Notebook): void {
  writeFileSync(join(dataDir, FILE), JSON.stringify(notebook, null, 2));
}

/**
 * Append new entries. Dedupes on exact observation text (case-insensitive)
 * so re-runs don't pile up identical entries.
 */
export function appendEntries(dataDir: string, toAdd: NotebookEntry[]): number {
  if (toAdd.length === 0) return 0;
  const notebook = loadNotebook(dataDir);
  const existing = new Set(notebook.entries.map((e) => e.observation.trim().toLowerCase()));
  let added = 0;
  for (const entry of toAdd) {
    const key = entry.observation.trim().toLowerCase();
    if (existing.has(key)) continue;
    notebook.entries.push(entry);
    existing.add(key);
    added++;
  }
  if (added > 0) saveNotebook(dataDir, notebook);
  return added;
}

/**
 * Produce a prompt-ready snippet of recent observations. Picks from the last
 * 8 weeks (so the corpus doesn't get stale), shuffles, returns up to `count`.
 */
export function notebookForPrompt(dataDir: string, count = 2): string {
  const notebook = loadNotebook(dataDir);
  if (notebook.entries.length === 0) return '';

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 56); // 8 weeks
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recent = notebook.entries.filter((e) => e.date >= cutoffStr);
  const pool = recent.length >= count ? recent : notebook.entries;

  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, Math.min(count, pool.length));
  if (picks.length === 0) return '';

  const lines = picks.map((p) => `- ${p.observation}`).join('\n');

  return `\n\nTHINGS NATE HAS BEEN SITTING WITH (recent observations — let one surface naturally if it fits; don't force it, don't quote verbatim):\n${lines}`;
}

/**
 * Context bundle handed to Claude for surprise extraction. All fields optional
 * — extractor works with whatever's available.
 */
export interface SurpriseContext {
  weekOf: string;
  summary?: string;         // plain-english summary of the week's numbers
  evaluation?: string;      // top/weak categories, hypothesis verdicts
  correlations?: string;    // content-to-metric correlation highlights
  readingInsights?: string; // cross-cutting patterns + anti-patterns
  strategyOutcomes?: string;
}

/**
 * Ask Claude to identify 2-4 surprising, non-obvious observations from this
 * week's data. "Surprising" means things a generic observer would miss —
 * pattern reversals, counter-intuitive correlations, tonal shifts in the
 * niche, unexpected gaps.
 *
 * Observations are written in first-person, lived-in voice (so they can be
 * surfaced directly in content prompts without rewriting).
 */
export async function extractSurprises(
  claudeApiKey: string,
  ctx: SurpriseContext,
): Promise<NotebookEntry[]> {
  const blocks: string[] = [];
  if (ctx.summary) blocks.push(`WEEKLY SUMMARY:\n${ctx.summary}`);
  if (ctx.evaluation) blocks.push(`EVALUATION:\n${ctx.evaluation}`);
  if (ctx.correlations) blocks.push(`CORRELATIONS:\n${ctx.correlations}`);
  if (ctx.readingInsights) blocks.push(`READING INSIGHTS:\n${ctx.readingInsights}`);
  if (ctx.strategyOutcomes) blocks.push(`STRATEGY OUTCOMES:\n${ctx.strategyOutcomes}`);

  if (blocks.length === 0) return [];

  const prompt = `You are Nate Voss, reviewing this week's data about your own content performance and the broader writing scene. Pull 2-4 observations that genuinely surprised you — pattern reversals, counter-intuitive results, tonal shifts in the niche, gaps between what you expected and what happened.

Rules for each observation:
- First-person, lived-in voice. "I noticed X..." or "Turns out Y..." — not third-person analysis.
- 1-2 sentences. Specific. Something a human could say in conversation.
- NOT generic wisdom. "Consistency matters" is not a surprise. "My most promoted category this week got half the engagement of the most casual one" is.
- If nothing is genuinely surprising, return fewer entries. Empty array is OK.

CONTEXT FROM THIS WEEK:

${blocks.join('\n\n')}

Respond in EXACTLY this JSON format, nothing else:
{
  "observations": [
    { "observation": "first-person sentence", "source": "analytics|engagement|correlation|reading|strategy" }
  ]
}`;

  const raw = await generateContent(claudeApiKey, prompt, {
    temperature: 0.5,
    maxTokens: 800,
    model: 'claude-sonnet-4-6',
  });

  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(cleaned) as {
      observations?: Array<{ observation: string; source: NotebookSource }>;
    };
    const today = new Date().toISOString().split('T')[0];
    return (parsed.observations ?? [])
      .filter((o) => typeof o.observation === 'string' && o.observation.trim().length > 15)
      .map((o) => ({
        date: today,
        observation: o.observation.trim(),
        source: (['analytics', 'engagement', 'correlation', 'reading', 'strategy'].includes(o.source)
          ? o.source
          : 'analytics') as NotebookSource,
        weekOf: ctx.weekOf,
      }));
  } catch (err) {
    console.warn('[Max][notebook] extractSurprises parse failed:', (err as Error).message);
    return [];
  }
}
