/**
 * Trend insights — weekly synthesis of the HN headlines accumulated in trends-log.json.
 *
 * Reads last 7 days of headlines (top 10/day = up to 70 items), Claude Sonnet
 * extracts 3-5 "hot themes" plus a handful of representative headlines. The
 * themes are injected into tech-ai content prompts so posts can peg to what's
 * actually being discussed this week — the kind of topicality that's impossible
 * for an agent training cutoff to fake.
 *
 * Injection is tech-ai-only: the themes are dev/startup/AI-flavoured. Posts in
 * life-reflection, philosophy, parenting, etc. are meant to feel timeless and
 * get no trend hint.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../content/claude.js';
import { loadTrendsLog } from '../analytics/trends.js';

const FILE = 'trend-insights.json';

export interface TrendInsights {
  generatedAt: string;
  weekOf: string;
  headlinesAnalysed: number;
  hotThemes: string[];              // 3-5 short phrases: "agent frameworks consolidating", "rust rewrites of cli tools"
  representativeHeadlines: string[]; // 3-5 actual headlines that exemplify the themes
  avoidList: string[];               // themes that feel over-saturated — posts in tech-ai should avoid leaning on these
}

export function loadTrendInsights(dataDir: string): TrendInsights | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Build the synthesis prompt from last N days of trend entries.
 */
function buildPrompt(headlines: string[]): string {
  return `You are analysing last week of Hacker News top stories to extract what the dev/AI/startup community is *actually* discussing right now. Your output will be injected into content generation prompts for an indie-developer persona (Nate Voss), so he can peg posts to current conversation instead of sounding timeless/generic.

Produce:
- hotThemes: 3-5 SHORT phrases naming what's dominating discussion. E.g. "agent framework consolidation", "rust rewrites of CLI tools", "AI coding-assistant pricing wars". Specific, not generic.
- representativeHeadlines: 3-5 actual headlines from the list that best exemplify the themes.
- avoidList: 1-3 themes that feel over-saturated — topics where the noise is so loud that another post would get lost. Nate should *avoid* these, not add to them.

Rules:
- Be specific. "AI is popular" is worthless. "Everyone's posting about whether Cursor vs Zed matters" is useful.
- No predictions. Just observe what's showing up.
- Empty arrays are fine if the week is quiet.

HEADLINES FROM LAST 7 DAYS (HN top stories, highest-scoring first):

${headlines.slice(0, 70).map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond in EXACTLY this JSON format, nothing else:
{
  "hotThemes": ["theme 1", "theme 2"],
  "representativeHeadlines": ["headline 1", "headline 2"],
  "avoidList": ["over-saturated theme"]
}`;
}

/**
 * Synthesize trend insights from last `windowDays` of HN headlines.
 * Returns null quietly if there aren't enough headlines yet.
 */
export async function synthesizeTrends(
  claudeApiKey: string,
  dataDir: string,
  windowDays = 7,
): Promise<TrendInsights | null> {
  const log = loadTrendsLog(dataDir);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recent = log.entries
    .filter((e) => e.date >= cutoffStr)
    .sort((a, b) => b.score - a.score);

  if (recent.length < 10) {
    console.log(`[Max][trend-insights] Only ${recent.length} headlines in last ${windowDays} days — need ≥10. Skipping.`);
    return null;
  }

  console.log(`[Max][trend-insights] Synthesising themes from ${recent.length} HN headlines...`);

  const prompt = buildPrompt(recent.map((e) => e.title));
  const raw = await generateContent(claudeApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 800,
    model: 'claude-sonnet-4-6',
  });

  let parsed: Omit<TrendInsights, 'generatedAt' | 'weekOf' | 'headlinesAnalysed'>;
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[Max][trend-insights] Parse failed — skipping save');
    return null;
  }

  const monday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(now);
    m.setUTCDate(now.getUTCDate() + diff);
    return m.toISOString().split('T')[0];
  })();

  const insights: TrendInsights = {
    generatedAt: new Date().toISOString(),
    weekOf: monday,
    headlinesAnalysed: recent.length,
    hotThemes: parsed.hotThemes ?? [],
    representativeHeadlines: parsed.representativeHeadlines ?? [],
    avoidList: parsed.avoidList ?? [],
  };

  writeFileSync(join(dataDir, FILE), JSON.stringify(insights, null, 2));
  console.log(`[Max][trend-insights] Saved: ${insights.hotThemes.length} themes, ${insights.avoidList.length} to avoid`);

  return insights;
}

/**
 * Prompt-ready injection. Returns empty string for non-tech-ai buckets (trends
 * are tech/dev/AI-flavoured; they'd be noise in life-reflection/relationships/etc.)
 */
export function trendsForPrompt(insights: TrendInsights | null, bucket: string): string {
  if (!insights || bucket !== 'tech-ai') return '';
  if (insights.hotThemes.length === 0) return '';

  const parts: string[] = [];
  parts.push(`WHAT'S HOT IN DEV/AI RIGHT NOW (last 7 days of HN): ${insights.hotThemes.join(' · ')}`);
  if (insights.representativeHeadlines.length > 0) {
    parts.push(`REPRESENTATIVE HEADLINES: ${insights.representativeHeadlines.slice(0, 3).map((h) => `"${h}"`).join(' | ')}`);
  }
  if (insights.avoidList.length > 0) {
    parts.push(`OVER-SATURATED (avoid adding to the noise): ${insights.avoidList.join(', ')}`);
  }

  return `\n\nCURRENT TREND CONTEXT (optional — peg to one only if it genuinely connects to the post's angle):\n${parts.join('\n')}`;
}
