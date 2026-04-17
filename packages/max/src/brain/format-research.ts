/**
 * Format research — Claude analyzes top influencer posts and extracts format patterns
 * that drive engagement, per platform and per content category type.
 *
 * Output is saved to data/format-insights.json and fed into the weekly calendar prompt.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from '../content/claude.js';
import type { InfluencerResearch } from '../analytics/influencer.js';

export type PostFormat =
  | 'story_opener'   // "spent 20 min debugging why X..."
  | 'hot_take'       // "everyone says X but actually Y"
  | 'question_hook'  // "how many tokens did your last request use?"
  | 'data_drop'      // "42% reduction. one line of code."
  | 'confession'     // "I made a mistake that cost me $200"
  | 'list_insight';  // "3 things I learned from shipping an LLM app"

export interface FormatInsight {
  format: PostFormat;
  platform: 'bluesky' | 'devto' | 'all';
  categoryType: 'tool' | 'personal_brand' | 'all';
  observation: string; // e.g. "story_opener posts get 2x more replies on Bluesky"
  exampleOpener: string; // concrete example of how to open with this format
}

export interface FormatInsights {
  generatedAt: string;
  weekOf: string;
  insights: FormatInsight[];
  blueskyToolSummary: string;
  blueskyPersonalSummary: string;
  devtoSummary: string;
  topFormatsThisWeek: PostFormat[];
}

const FILE = 'format-insights.json';

export function loadFormatInsights(dataDir: string): FormatInsights | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function buildAnalysisPrompt(research: InfluencerResearch): string {
  const blueskyTool = research.posts
    .filter((p) => p.platform === 'bluesky' && p.category === 'tool')
    .slice(0, 15)
    .map((p) => `[${p.likes}❤ ${p.reposts ?? 0}🔁] ${p.text.slice(0, 200)}`)
    .join('\n---\n');

  const blueskyPersonal = research.posts
    .filter((p) => p.platform === 'bluesky' && p.category === 'personal_brand')
    .slice(0, 15)
    .map((p) => `[${p.likes}❤ ${p.reposts ?? 0}🔁] ${p.text.slice(0, 200)}`)
    .join('\n---\n');

  const devtoPosts = research.posts
    .filter((p) => p.platform === 'devto')
    .slice(0, 15)
    .map((p) => `[${p.likes}❤ ${p.views ?? 0} views] ${p.text.slice(0, 200)}`)
    .join('\n---\n');

  return `You are analyzing top-performing social media posts to extract content format patterns that drive engagement. The goal is to help an indie dev persona (Nate Voss) write posts that feel human and perform well.

Available formats to classify into:
- story_opener: starts with a personal experience ("spent X doing Y...")
- hot_take: contrarian or surprising opinion ("everyone says X but...")
- question_hook: opens with a direct question to the reader
- data_drop: leads with a surprising number or metric
- confession: admits a mistake, failure, or embarrassing truth
- list_insight: "N things I learned / discovered / found"

TOP BLUESKY POSTS — DEV TOOLS / LLM TOPIC (sorted by engagement):
${blueskyTool || '(none fetched)'}

TOP BLUESKY POSTS — PERSONAL BRAND / GENERAL TOPIC:
${blueskyPersonal || '(none fetched)'}

TOP DEV.TO ARTICLES — ALL TOPICS:
${devtoPosts || '(none fetched)'}

Analyze these posts and respond in EXACTLY this JSON format, nothing else:
{
  "insights": [
    {
      "format": "story_opener",
      "platform": "bluesky",
      "categoryType": "tool",
      "observation": "one sentence on why this format performs well here",
      "exampleOpener": "concrete 1-sentence example opener in Nate's voice"
    }
  ],
  "blueskyToolSummary": "2 sentences on what format/voice works for dev tool posts on Bluesky this week",
  "blueskyPersonalSummary": "2 sentences on what format/voice works for personal brand posts on Bluesky",
  "devtoSummary": "2 sentences on what article formats/titles perform best on Dev.to this week",
  "topFormatsThisWeek": ["format1", "format2", "format3"]
}

Include 6-10 insights covering different platform/categoryType combinations. topFormatsThisWeek should list the 3 formats that appear most in the top posts.`;
}

export async function researchFormats(
  claudeApiKey: string,
  research: InfluencerResearch,
  dataDir: string,
): Promise<FormatInsights> {
  console.log('[Max] Analyzing influencer posts for format patterns...');

  const prompt = buildAnalysisPrompt(research);
  const raw = await generateContent(claudeApiKey, prompt, {
    temperature: 0.3,
    maxTokens: 1500,
    model: 'claude-sonnet-4-6',
  });

  let parsed: Omit<FormatInsights, 'generatedAt' | 'weekOf'>;
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[Max] Format research parse failed — using empty insights');
    parsed = {
      insights: [],
      blueskyToolSummary: '',
      blueskyPersonalSummary: '',
      devtoSummary: '',
      topFormatsThisWeek: [],
    };
  }

  const monday = (() => {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const m = new Date(now);
    m.setUTCDate(now.getUTCDate() + diff);
    return m.toISOString().split('T')[0];
  })();

  const insights: FormatInsights = {
    generatedAt: new Date().toISOString(),
    weekOf: monday,
    ...parsed,
  };

  writeFileSync(join(dataDir, FILE), JSON.stringify(insights, null, 2));
  console.log(`[Max] Format insights saved: ${insights.insights.length} insights, top formats: ${insights.topFormatsThisWeek.join(', ')}`);

  return insights;
}
