/**
 * Pre-generation module — generates a full week's content during the weekly brain run.
 *
 * Saves all posts/articles to data/pregenerated-content.json so the daily run
 * only needs to publish, not generate. If strategy changes, the weekly brain
 * calls this again to regenerate with the new parameters.
 *
 * Daily run falls back to on-demand generation only if pre-generated content
 * is missing or marked as failed.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateContent } from './claude.js';
import { blueskyPrompt, devtoPrompt, mediumPrompt, tagsForCategory, type ContentCategory, type PromptContext } from './templates.js';
import type { FormatInsights } from '../brain/format-research.js';
import { reviewBlueskyPost, reviewArticle } from './quality.js';
import { parseArticle } from '../publish/devto.js';
import type { WeeklyCalendar } from './calendar.js';

const FILE = 'pregenerated-content.json';

export interface PregeneratedPost {
  date: string;
  bluesky: {
    text: string;
    category: ContentCategory;
    angle?: string;
    qualityPassed: boolean;
    qualityScore: number;
  } | null;
  devto: {
    title: string;
    body: string;
    tags: string[];
    category: ContentCategory;
    qualityPassed: boolean;
    qualityScore: number;
  } | null;
  medium: {
    title: string;
    body: string;
    category: ContentCategory;
    qualityPassed: boolean;
    qualityScore: number;
  } | null;
  /**
   * Substack content — zero extra API calls.
   * note: mirrors bluesky.text (same content, posted to Substack Notes feed)
   * newsletter: mirrors medium content (same article, different distribution layer)
   */
  substack: {
    note: string | null;
    newsletter: {
      title: string;
      body: string;
      category: ContentCategory;
    } | null;
  } | null;
}

export interface PregeneratedWeek {
  weekOf: string;
  generatedAt: string;
  posts: PregeneratedPost[];
}

export function loadPregenerated(dataDir: string): PregeneratedWeek | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function savePregenerated(dataDir: string, week: PregeneratedWeek): void {
  writeFileSync(join(dataDir, FILE), JSON.stringify(week, null, 2));
}

export function getTodayPregenerated(week: PregeneratedWeek): PregeneratedPost | null {
  const today = new Date().toISOString().split('T')[0];
  return week.posts.find((p) => p.date === today) ?? null;
}

export function isPregeneratedCurrent(week: PregeneratedWeek | null): boolean {
  if (!week) return false;
  const today = new Date().toISOString().split('T')[0];
  return week.posts.some((p) => p.date === today);
}

/**
 * Generate a full week of content based on the calendar.
 * Called during the weekly brain run — expensive but done once per week.
 */
export async function pregenerateWeek(
  claudeApiKey: string,
  calendar: WeeklyCalendar,
  ctx: PromptContext,
  dataDir: string,
  formatInsights?: FormatInsights,
): Promise<PregeneratedWeek> {
  console.log('[Max] Pre-generating week of content with Claude...');
  const posts: PregeneratedPost[] = [];

  for (const day of calendar.days) {
    const post: PregeneratedPost = { date: day.date, bluesky: null, devto: null, medium: null, substack: null };

    // Generate Bluesky post
    if (day.bluesky) {
      try {
        console.log(`[Max] Pre-generating ${day.date} Bluesky (${day.bluesky}${day.blueskyFormat ? `/${day.blueskyFormat}` : ''})...`);
        const angleHint = day.blueskyAngle ? `\n\nANGLE FOR TODAY: ${day.blueskyAngle}` : '';
        const prompt = blueskyPrompt(day.bluesky, { ...ctx, postFormat: day.blueskyFormat }) + angleHint;

        let text = await generateBlueskyText(claudeApiKey, prompt);
        let quality = await reviewBlueskyPost(text, claudeApiKey);

        if (!quality.passed) {
          text = await generateBlueskyText(
            claudeApiKey,
            `${prompt}\n\nIMPORTANT FEEDBACK: ${quality.score.feedback}. Address this.`,
          );
          quality = await reviewBlueskyPost(text, claudeApiKey);
        }

        post.bluesky = {
          text,
          category: day.bluesky,
          angle: day.blueskyAngle,
          qualityPassed: quality.passed,
          qualityScore: quality.score.average,
        };
        console.log(`[Max]   Bluesky ${day.date}: ${quality.score.average}/10 (${quality.passed ? 'pass' : 'fail'})`);
      } catch (err) {
        console.warn(`[Max]   Bluesky pre-gen failed for ${day.date}:`, (err as Error).message);
      }
    }

    // Generate Dev.to article (only on scheduled days)
    if (day.devto) {
      try {
        console.log(`[Max] Pre-generating ${day.date} Dev.to (${day.devto}${day.devtoFormat ? `/${day.devtoFormat}` : ''})...`);
        const angleHint = day.devtoAngle ? `\n\nFOCUS: ${day.devtoAngle}` : '';
        const prompt = devtoPrompt(day.devto, { ...ctx, postFormat: day.devtoFormat }) + angleHint;

        let markdown = await generateContent(claudeApiKey, prompt, {
          temperature: 0.8,
          maxTokens: 4096,
          model: 'claude-haiku-4-5',
        });
        let { title, body } = parseArticle(markdown);
        const tags = tagsForCategory(day.devto);

        let quality = await reviewArticle(title, body, claudeApiKey);

        if (!quality.passed) {
          markdown = await generateContent(
            claudeApiKey,
            `${prompt}\n\nFEEDBACK: ${quality.score.feedback}. Address this.`,
            { temperature: 0.8, maxTokens: 4096, model: 'claude-haiku-4-5' },
          );
          ({ title, body } = parseArticle(markdown));
          quality = await reviewArticle(title, body, claudeApiKey);
        }

        post.devto = {
          title,
          body,
          tags,
          category: day.devto,
          qualityPassed: quality.passed,
          qualityScore: quality.score.average,
        };
        console.log(`[Max]   Dev.to ${day.date}: ${quality.score.average}/10 (${quality.passed ? 'pass' : 'fail'})`);
      } catch (err) {
        console.warn(`[Max]   Dev.to pre-gen failed for ${day.date}:`, (err as Error).message);
      }
    }

    // Generate Medium article on the same days as Dev.to (both are long-form platforms).
    // Medium content is generated independently — different tone, different angle.
    if (day.devto) {
      try {
        // Use same category as Dev.to but generate independently — different persona + style.
        const mediumCategory = day.devto;
        console.log(`[Max] Pre-generating ${day.date} Medium (${mediumCategory})...`);
        const angleHint = day.devtoAngle ? `\n\nFOCUS: ${day.devtoAngle}` : '';
        const mediumStyleHint = formatInsights?.mediumSummary
          ? `\n\nMEDIUM STYLE LEARNINGS (from trending articles this week — learn from these patterns, don't copy):\n${formatInsights.mediumSummary}`
          : '';
        const prompt = mediumPrompt(mediumCategory, { ...ctx, postFormat: day.devtoFormat }) + angleHint + mediumStyleHint;

        let markdown = await generateContent(claudeApiKey, prompt, {
          temperature: 0.9,
          maxTokens: 4096,
          model: 'claude-opus-4-7',
        });
        let { title, body } = parseArticle(markdown);

        let quality = await reviewArticle(title, body, claudeApiKey);

        if (!quality.passed) {
          markdown = await generateContent(
            claudeApiKey,
            `${prompt}\n\nFEEDBACK: ${quality.score.feedback}. Address this and make the article significantly better.`,
            { temperature: 0.9, maxTokens: 4096, model: 'claude-opus-4-7' },
          );
          ({ title, body } = parseArticle(markdown));
          quality = await reviewArticle(title, body, claudeApiKey);
        }

        post.medium = {
          title,
          body,
          category: mediumCategory,
          qualityPassed: quality.passed,
          qualityScore: quality.score.average,
        };
        console.log(`[Max]   Medium ${day.date}: ${quality.score.average}/10 (${quality.passed ? 'pass' : 'fail'})`);
      } catch (err) {
        console.warn(`[Max]   Medium pre-gen failed for ${day.date}:`, (err as Error).message);
      }
    }

    // Populate Substack from existing content — zero extra API calls.
    // Notes mirror Bluesky; Newsletter mirrors Medium.
    post.substack = {
      note: post.bluesky?.text ?? null,
      newsletter: post.medium
        ? { title: post.medium.title, body: post.medium.body, category: post.medium.category }
        : null,
    };

    posts.push(post);
  }

  const week: PregeneratedWeek = {
    weekOf: calendar.weekOf,
    generatedAt: new Date().toISOString(),
    posts,
  };

  savePregenerated(dataDir, week);
  const passed = posts.filter((p) => p.bluesky?.qualityPassed || p.devto?.qualityPassed).length;
  console.log(`[Max] Pre-generation complete: ${passed}/${posts.length} days with passing content`);

  return week;
}

async function generateBlueskyText(apiKey: string, prompt: string): Promise<string> {
  let text = await generateContent(apiKey, prompt, {
    temperature: 0.9,
    maxTokens: 150,
    model: 'claude-haiku-4-5',
  });

  for (let attempt = 1; attempt <= 3 && text.length > 300; attempt++) {
    text = await generateContent(
      apiKey,
      `${prompt}\n\nIMPORTANT: Previous attempt was ${text.length} chars. ABSOLUTE MAX is 300 chars. Be much more concise.`,
      { temperature: 0.7, maxTokens: 100, model: 'claude-haiku-4-5' },
    );
  }

  if (text.length > 300) {
    const truncated = text.slice(0, 297);
    text = truncated.slice(0, truncated.lastIndexOf(' ')) + '...';
  }

  return text;
}
