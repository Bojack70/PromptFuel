/**
 * Reading insights — weekly synthesis of the daily reading corpus.
 *
 * Reads the last 7 days from data/reading-log.json, sends to Claude Sonnet for
 * pattern extraction (title hooks, opening structures, emotional registers,
 * topic resonance per bucket), writes data/reading-insights.json.
 *
 * Runs locally in the weekly brain (uses Claude subscription). The insights
 * are injected into content generation prompts so Max's writing reflects
 * what's actually resonating in the niche this week, not what was resonating
 * when Claude was trained.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../content/claude.js';
import { loadReadingLog, type ReadingEntry } from '../analytics/reader.js';

const FILE = 'reading-insights.json';

export interface BucketInsight {
  bucket: string;
  titlePatterns: string[];   // 2-4 recurring title hook patterns
  openingHooks: string[];    // 2-4 opening-line patterns observed
  emotionalRegister: string; // 1 sentence on the tonal range (earnest, wry, confessional, etc.)
  topicsResonating: string[]; // 3-5 specific topics/angles that recurred
  voiceNotes: string;        // 1-2 sentences — what makes this content feel human
}

export interface ReadingInsights {
  generatedAt: string;
  weekOf: string;
  daysCovered: number;
  articlesAnalyzed: number;
  buckets: BucketInsight[];
  crossCuttingPatterns: string;  // 2-3 sentences — what shows up everywhere this week
  antiPatterns: string;           // 2-3 sentences — tropes that are stale / AI-flavored
}

export function loadReadingInsights(dataDir: string): ReadingInsights | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function groupByBucket(entries: ReadingEntry[]): Map<string, ReadingEntry[]> {
  const map = new Map<string, ReadingEntry[]>();
  for (const e of entries) {
    const list = map.get(e.bucket) ?? [];
    list.push(e);
    map.set(e.bucket, list);
  }
  return map;
}

function buildSynthesisPrompt(entries: ReadingEntry[]): string {
  const byBucket = groupByBucket(entries);
  const sections: string[] = [];
  for (const [bucket, items] of byBucket.entries()) {
    const lines = items
      .slice(0, 14)
      .map((e) => `- "${e.title}"${e.excerpt ? ` — ${e.excerpt.slice(0, 180)}` : ''}`)
      .join('\n');
    sections.push(`## ${bucket}\n${lines}`);
  }

  return `You are analysing a week of reading across 7 topic buckets. The goal is to extract patterns that help an indie writer (Nate Voss) produce content that feels human and current — learning what resonates, not copying specific articles.

For each bucket, identify:
- titlePatterns: recurring hook structures in titles (e.g. "The N Things I...", "What I Learned When...", "Why X Is Actually Y")
- openingHooks: common opening-line moves (personal anecdote, contrarian claim, direct question, sensory scene)
- emotionalRegister: the tonal range (earnest, wry, confessional, academic, satirical...)
- topicsResonating: 3-5 specific topics/angles that recurred this week
- voiceNotes: what distinguishes human writing in this bucket from AI-generated content

Also note:
- crossCuttingPatterns: 2-3 sentences on what shows up across multiple buckets this week
- antiPatterns: 2-3 sentences on stale tropes or AI-flavoured clichés you observed (so we can AVOID them)

READING CORPUS (last 7 days):

${sections.join('\n\n')}

Respond in EXACTLY this JSON format, nothing else:
{
  "buckets": [
    {
      "bucket": "life-reflection",
      "titlePatterns": ["pattern 1", "pattern 2"],
      "openingHooks": ["hook type 1", "hook type 2"],
      "emotionalRegister": "one sentence describing the tonal range",
      "topicsResonating": ["topic 1", "topic 2", "topic 3"],
      "voiceNotes": "1-2 sentences on what makes this feel human"
    }
  ],
  "crossCuttingPatterns": "2-3 sentences",
  "antiPatterns": "2-3 sentences"
}

Include one entry per bucket present in the corpus.`;
}

/**
 * Synthesize insights from the last N days of the reading log.
 * Returns null if there aren't enough entries yet (skips quietly — the corpus
 * needs time to accumulate).
 */
export async function synthesizeReadingInsights(
  claudeApiKey: string,
  dataDir: string,
  windowDays = 7,
): Promise<ReadingInsights | null> {
  const log = loadReadingLog(dataDir);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recent = log.entries.filter((e) => e.date >= cutoffStr);

  if (recent.length < 7) {
    console.log(`[Max][reading-insights] Only ${recent.length} entries in last ${windowDays} days — need ≥7 to synthesize. Skipping.`);
    return null;
  }

  console.log(`[Max][reading-insights] Synthesising patterns from ${recent.length} articles across last ${windowDays} days...`);
  const prompt = buildSynthesisPrompt(recent);

  const raw = await generateContent(claudeApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 2000,
    model: 'claude-sonnet-4-6',
  });

  let parsed: { buckets: BucketInsight[]; crossCuttingPatterns: string; antiPatterns: string };
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[Max][reading-insights] Parse failed — using empty insights');
    parsed = { buckets: [], crossCuttingPatterns: '', antiPatterns: '' };
  }

  const monday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(now);
    m.setUTCDate(now.getUTCDate() + diff);
    return m.toISOString().split('T')[0];
  })();

  const insights: ReadingInsights = {
    generatedAt: new Date().toISOString(),
    weekOf: monday,
    daysCovered: windowDays,
    articlesAnalyzed: recent.length,
    buckets: parsed.buckets,
    crossCuttingPatterns: parsed.crossCuttingPatterns,
    antiPatterns: parsed.antiPatterns,
  };

  writeFileSync(join(dataDir, FILE), JSON.stringify(insights, null, 2));
  console.log(`[Max][reading-insights] Saved: ${insights.buckets.length} bucket insights from ${insights.articlesAnalyzed} articles`);

  return insights;
}

/**
 * Map a ContentCategory or TwitterCategory to the reader bucket whose insights
 * are most relevant for generating that kind of content.
 */
export function bucketForCategory(category: string): string {
  // Twitter categories
  if (category === 'tw_reflection' || category === 'tw_life' || category === 'tw_question') return 'life-reflection';
  if (category === 'tw_satire') return 'humor-satire';
  if (category === 'tw_philosophy') return 'philosophy-psychology';
  if (category === 'tw_tech') return 'tech-ai';

  // Content categories — PromptFuel-linked tech + AI general
  if (category === 'tip' || category === 'comparison' || category === 'tutorial'
    || category === 'stats' || category === 'launch' || category === 'opinion'
    || category === 'ai_general') return 'tech-ai';

  // Personal brand + Substack-native
  if (category === 'economics') return 'work-economics';
  if (category === 'philosophy' || category === 'essay_long') return 'philosophy-psychology';
  if (category === 'short_story' || category === 'mystery_interactive' || category === 'thread_story'
    || category === 'character_dark') return 'creative-writing';
  if (category === 'letter' || category === 'field_notes') return 'life-reflection';
  if (category === 'contrarian') return 'humor-satire';

  return 'life-reflection';
}

/**
 * Produce a compact prompt-ready summary for injection into content generation.
 * Returns a short, bucket-specific string, or empty string if no insights exist
 * or no insight for the requested bucket.
 *
 * bucketHint: the topic bucket closest to the content being generated (e.g. 'tech-ai'
 * for a tip post, 'life-reflection' for tw_reflection). Falls back to cross-cutting
 * patterns when an exact bucket match isn't available.
 */
export function readingInsightForPrompt(
  insights: ReadingInsights | null,
  bucketHint: string,
): string {
  if (!insights) return '';

  const b = insights.buckets.find((x) => x.bucket === bucketHint);
  const lines: string[] = [];

  if (b) {
    lines.push(`TITLE HOOKS RESONATING IN ${bucketHint.toUpperCase()} THIS WEEK: ${b.titlePatterns.join('; ')}`);
    lines.push(`OPENING MOVES: ${b.openingHooks.join('; ')}`);
    lines.push(`TONE: ${b.emotionalRegister}`);
    lines.push(`TOPICS SHOWING UP: ${b.topicsResonating.join(', ')}`);
    lines.push(`HUMAN VOICE MARKERS: ${b.voiceNotes}`);
  } else if (insights.crossCuttingPatterns) {
    lines.push(`CROSS-CUTTING PATTERNS THIS WEEK: ${insights.crossCuttingPatterns}`);
  }

  if (insights.antiPatterns) {
    lines.push(`AVOID THESE STALE/AI-FLAVORED TROPES: ${insights.antiPatterns}`);
  }

  if (lines.length === 0) return '';
  return `\n\nREADING INSIGHTS (learn from, don't copy):\n${lines.join('\n')}`;
}
