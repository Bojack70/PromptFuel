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
import { blueskyPrompt, devtoPrompt, mediumPrompt, substackPrompt, SUBSTACK_ROTATION, substackNotePrompt, SUBSTACK_NOTE_ROTATION, tagsForCategory, twitterStandalonePrompt, TWITTER_ROTATION, type ContentCategory, type TwitterCategory, type SubstackNoteCategory, type PromptContext } from './templates.js';
import type { FormatInsights } from '../brain/format-research.js';
import { reviewBlueskyPost, reviewArticle } from './quality.js';
import { parseArticle } from '../publish/devto.js';
import type { WeeklyCalendar } from './calendar.js';
import { readingInsightForPrompt, bucketForCategory, type ReadingInsights } from '../brain/reading-insights.js';
import { opinionsForPrompt } from './opinions.js';
import { notebookForPrompt } from '../brain/notebook.js';
import { trendsForPrompt, type TrendInsights } from '../brain/trend-insights.js';
import { antiPolish } from './anti-polish.js';

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
  /** Twitter — dedicated human-first content, independent of Bluesky. */
  twitter: {
    text: string;
    category: TwitterCategory;
    qualityPassed: boolean;
    qualityScore: number;
  } | null;
  /**
   * Substack content.
   * note: INDEPENDENT short-form Substack voice (ss_morning / ss_line / ss_aside /
   *   ss_question / ss_revision), via SUBSTACK_NOTE_ROTATION. Falls back to
   *   mirroring Bluesky text if generation fails. `mirroredFromBluesky` flag
   *   makes the fallback visible downstream.
   * newsletter: INDEPENDENT of Medium — uses SUBSTACK_ROTATION categories with
   *   email-first intimate voice. Falls back to mirroring Medium if generation fails.
   *   `mirroredFromMedium` flag makes that fallback visible downstream.
   */
  substack: {
    note: string | null;
    /** Category of the note — absent on the Bluesky-mirror fallback path. */
    noteCategory?: SubstackNoteCategory;
    /** True if note generation failed and we fell back to mirroring Bluesky text. */
    mirroredFromBluesky?: boolean;
    newsletter: {
      title: string;
      body: string;
      category: ContentCategory;
      qualityPassed?: boolean;
      qualityScore?: number;
      mirroredFromMedium?: boolean;
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
 *
 * Resume-from-failure: if pregenerated-content.json already exists for the same
 * weekOf, days with content already present are skipped. Saves incrementally
 * after each day, so a mid-run failure only loses the in-progress day. Re-run
 * the same command to resume from where it left off.
 */
export async function pregenerateWeek(
  claudeApiKey: string,
  calendar: WeeklyCalendar,
  ctx: PromptContext,
  dataDir: string,
  formatInsights?: FormatInsights,
  readingInsights?: ReadingInsights,
  trendInsights?: TrendInsights,
): Promise<PregeneratedWeek> {
  console.log('[Max] Pre-generating week of content with Claude...');

  // Resume: load any existing pregenerated file for the same weekOf.
  const existing = loadPregenerated(dataDir);
  const existingByDate = new Map<string, PregeneratedPost>();
  if (existing && existing.weekOf === calendar.weekOf) {
    for (const p of existing.posts) existingByDate.set(p.date, p);
    const resumed = Array.from(existingByDate.values()).filter(
      (p) => p.bluesky || p.devto || p.medium,
    ).length;
    if (resumed > 0) {
      console.log(`[Max] Resume: found ${resumed} day(s) already generated for week ${calendar.weekOf} — skipping those`);
    }
  }

  const posts: PregeneratedPost[] = [];

  for (const day of calendar.days) {
    const prior = existingByDate.get(day.date);
    const dayIndex = calendar.days.indexOf(day);
    const twitterCategory: TwitterCategory = TWITTER_ROTATION[dayIndex % TWITTER_ROTATION.length];

    const post: PregeneratedPost = {
      date: day.date,
      bluesky: prior?.bluesky ?? null,
      devto: prior?.devto ?? null,
      medium: prior?.medium ?? null,
      twitter: prior?.twitter ?? null,
      substack: prior?.substack ?? null,
    };

    // Generate Bluesky post (skip if already present from prior resume)
    if (day.bluesky && !post.bluesky) {
      try {
        console.log(`[Max] Pre-generating ${day.date} Bluesky (${day.bluesky}${day.blueskyFormat ? `/${day.blueskyFormat}` : ''})...`);
        const angleHint = day.blueskyAngle ? `\n\nANGLE FOR TODAY: ${day.blueskyAngle}` : '';
        const bucket = bucketForCategory(day.bluesky);
        const readingHint = readingInsightForPrompt(readingInsights ?? null, bucket);
        const opinionsHint = opinionsForPrompt(dataDir, bucket);
        const notebookHint = notebookForPrompt(dataDir);
        const trendHint = trendsForPrompt(trendInsights ?? null, bucket);
        const prompt = blueskyPrompt(day.bluesky, { ...ctx, postFormat: day.blueskyFormat }) + angleHint + readingHint + opinionsHint + notebookHint + trendHint;

        let text = await generateBlueskyText(claudeApiKey, prompt);
        const polished1 = antiPolish(text, 'bluesky');
        if (polished1.changes.length > 0) console.log(`[Max]   anti-polish (bluesky): ${polished1.changes.join(', ')}`);
        text = polished1.text;
        let quality = await reviewBlueskyPost(text, claudeApiKey);

        if (!quality.passed) {
          text = await generateBlueskyText(
            claudeApiKey,
            `${prompt}\n\nIMPORTANT FEEDBACK: ${quality.score.feedback}. Address this.`,
          );
          const polished2 = antiPolish(text, 'bluesky');
          if (polished2.changes.length > 0) console.log(`[Max]   anti-polish retry (bluesky): ${polished2.changes.join(', ')}`);
          text = polished2.text;
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

    // Generate Dev.to article (only on scheduled days; skip if already present)
    if (day.devto && !post.devto) {
      try {
        console.log(`[Max] Pre-generating ${day.date} Dev.to (${day.devto}${day.devtoFormat ? `/${day.devtoFormat}` : ''})...`);
        const angleHint = day.devtoAngle ? `\n\nFOCUS: ${day.devtoAngle}` : '';
        const bucket = bucketForCategory(day.devto);
        const readingHint = readingInsightForPrompt(readingInsights ?? null, bucket);
        const opinionsHint = opinionsForPrompt(dataDir, bucket);
        const notebookHint = notebookForPrompt(dataDir);
        const trendHint = trendsForPrompt(trendInsights ?? null, bucket);
        const prompt = devtoPrompt(day.devto, { ...ctx, postFormat: day.devtoFormat }) + angleHint + readingHint + opinionsHint + notebookHint + trendHint;

        let markdown = await generateContent(claudeApiKey, prompt, {
          temperature: 0.8,
          maxTokens: 4096,
          model: 'claude-haiku-4-5',
        });
        let { title, body } = parseArticle(markdown);
        const tags = tagsForCategory(day.devto);
        const polishedDev1 = antiPolish(body, 'devto');
        if (polishedDev1.changes.length > 0) console.log(`[Max]   anti-polish (devto): ${polishedDev1.changes.join(', ')}`);
        body = polishedDev1.text;

        let quality = await reviewArticle(title, body, claudeApiKey);

        if (!quality.passed) {
          markdown = await generateContent(
            claudeApiKey,
            `${prompt}\n\nFEEDBACK: ${quality.score.feedback}. Address this.`,
            { temperature: 0.8, maxTokens: 4096, model: 'claude-haiku-4-5' },
          );
          ({ title, body } = parseArticle(markdown));
          const polishedDev2 = antiPolish(body, 'devto');
          if (polishedDev2.changes.length > 0) console.log(`[Max]   anti-polish retry (devto): ${polishedDev2.changes.join(', ')}`);
          body = polishedDev2.text;
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
    // Skip if already present from prior resume.
    if (day.devto && !post.medium) {
      try {
        // Use same category as Dev.to but generate independently — different persona + style.
        const mediumCategory = day.devto;
        console.log(`[Max] Pre-generating ${day.date} Medium (${mediumCategory})...`);
        const angleHint = day.devtoAngle ? `\n\nFOCUS: ${day.devtoAngle}` : '';
        const mediumStyleHint = formatInsights?.mediumSummary
          ? `\n\nMEDIUM STYLE LEARNINGS (from trending articles this week — learn from these patterns, don't copy):\n${formatInsights.mediumSummary}`
          : '';
        const bucket = bucketForCategory(mediumCategory);
        const readingHint = readingInsightForPrompt(readingInsights ?? null, bucket);
        const opinionsHint = opinionsForPrompt(dataDir, bucket);
        const notebookHint = notebookForPrompt(dataDir);
        const trendHint = trendsForPrompt(trendInsights ?? null, bucket);
        const prompt = mediumPrompt(mediumCategory, { ...ctx, postFormat: day.devtoFormat }) + angleHint + mediumStyleHint + readingHint + opinionsHint + notebookHint + trendHint;

        let markdown = await generateContent(claudeApiKey, prompt, {
          temperature: 0.9,
          maxTokens: 4096,
          model: 'claude-opus-4-7',
        });
        let { title, body } = parseArticle(markdown);
        const polishedMed1 = antiPolish(body, 'medium');
        if (polishedMed1.changes.length > 0) console.log(`[Max]   anti-polish (medium): ${polishedMed1.changes.join(', ')}`);
        body = polishedMed1.text;

        let quality = await reviewArticle(title, body, claudeApiKey);

        if (!quality.passed) {
          markdown = await generateContent(
            claudeApiKey,
            `${prompt}\n\nFEEDBACK: ${quality.score.feedback}. Address this and make the article significantly better.`,
            { temperature: 0.9, maxTokens: 4096, model: 'claude-opus-4-7' },
          );
          ({ title, body } = parseArticle(markdown));
          const polishedMed2 = antiPolish(body, 'medium');
          if (polishedMed2.changes.length > 0) console.log(`[Max]   anti-polish retry (medium): ${polishedMed2.changes.join(', ')}`);
          body = polishedMed2.text;
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

    // Generate Twitter post (every day, own category rotation, independent of Bluesky)
    if (!post.twitter) {
      try {
        console.log(`[Max] Pre-generating ${day.date} Twitter (${twitterCategory})...`);
        const bucket = bucketForCategory(twitterCategory);
        const readingHint = readingInsightForPrompt(readingInsights ?? null, bucket);
        const opinionsHint = opinionsForPrompt(dataDir, bucket);
        const notebookHint = notebookForPrompt(dataDir);
        const trendHint = trendsForPrompt(trendInsights ?? null, bucket);
        const prompt = twitterStandalonePrompt(twitterCategory, ctx) + readingHint + opinionsHint + notebookHint + trendHint;
        let text = await generateTwitterText(claudeApiKey, prompt);
        const polishedTw = antiPolish(text, 'twitter');
        if (polishedTw.changes.length > 0) console.log(`[Max]   anti-polish (twitter): ${polishedTw.changes.join(', ')}`);
        text = polishedTw.text;
        const quality = await reviewBlueskyPost(text, claudeApiKey); // reuse short-post reviewer

        post.twitter = {
          text,
          category: twitterCategory,
          qualityPassed: quality.passed,
          qualityScore: quality.score.average,
        };
        console.log(`[Max]   Twitter ${day.date} (${twitterCategory}): ${quality.score.average}/10`);
      } catch (err) {
        console.warn(`[Max]   Twitter pre-gen failed for ${day.date}:`, (err as Error).message);
      }
    }

    // Substack has TWO content surfaces with DIFFERENT cadence + voice:
    //   - Notes (short): INDEPENDENT voice, generated DAILY via SUBSTACK_NOTE_ROTATION
    //     (5 short-form categories: ss_morning / ss_line / ss_aside / ss_question /
    //     ss_revision). Falls back to mirroring Bluesky text if generation fails.
    //   - Newsletter (long): INDEPENDENT voice, generated 1-3x/week via SUBSTACK_ROTATION
    //     (5 long-form categories: letter / field_notes / essay_long / contrarian /
    //     thread_story). Falls back to mirroring Medium if generation fails.

    // --- Substack NOTE (short-form, daily) ---
    let noteText: string | null = null;
    let noteCategory: SubstackNoteCategory | undefined;
    let mirroredFromBluesky = false;
    try {
      const cat = SUBSTACK_NOTE_ROTATION[dayIndex % SUBSTACK_NOTE_ROTATION.length];
      console.log(`[Max] Pre-generating ${day.date} Substack Note (${cat})...`);
      const prompt = substackNotePrompt(cat, ctx);
      let text = await generateBlueskyText(claudeApiKey, prompt); // reuses short-text generator (Haiku, low tokens)
      const polished = antiPolish(text, 'twitter');
      if (polished.changes.length > 0) console.log(`[Max]   anti-polish (ss-note): ${polished.changes.join(', ')}`);
      text = polished.text.trim();
      // Soft cap — Substack Notes have no hard limit but aiming for the 280 range
      if (text.length > 320) text = text.slice(0, 317).trimEnd() + '...';
      noteText = text;
      noteCategory = cat;
      console.log(`[Max]   Substack Note ${day.date} (${cat}): ${text.length} chars — "${text.slice(0, 60)}..."`);
    } catch (err) {
      console.warn(`[Max]   Substack Note pre-gen failed for ${day.date}:`, (err as Error).message);
      noteText = post.bluesky?.text ?? null;
      mirroredFromBluesky = noteText !== null;
    }

    // --- Substack NEWSLETTER (long-form, Dev.to days only) ---
    const existingNewsletter = post.substack?.newsletter ?? null;
    if (day.devto && !existingNewsletter) {
      const substackCategory = SUBSTACK_ROTATION[dayIndex % SUBSTACK_ROTATION.length];
      try {
        console.log(`[Max] Pre-generating ${day.date} Substack Newsletter (${substackCategory})...`);
        const bucket = bucketForCategory(substackCategory);
        const readingHint = readingInsightForPrompt(readingInsights ?? null, bucket);
        const opinionsHint = opinionsForPrompt(dataDir, bucket);
        const notebookHint = notebookForPrompt(dataDir);
        const trendHint = trendsForPrompt(trendInsights ?? null, bucket);
        const prompt = substackPrompt(substackCategory, ctx) + readingHint + opinionsHint + notebookHint + trendHint;

        let markdown = await generateContent(claudeApiKey, prompt, {
          temperature: 0.9,
          maxTokens: 4096,
          model: 'claude-haiku-4-5',
        });
        let { title, body } = parseArticle(markdown);
        const polished1 = antiPolish(body, 'medium');
        if (polished1.changes.length > 0) console.log(`[Max]   anti-polish (substack): ${polished1.changes.join(', ')}`);
        body = polished1.text;

        let quality = await reviewArticle(title, body, claudeApiKey);

        if (!quality.passed) {
          markdown = await generateContent(
            claudeApiKey,
            `${prompt}\n\nFEEDBACK: ${quality.score.feedback}. Address this.`,
            { temperature: 0.9, maxTokens: 4096, model: 'claude-haiku-4-5' },
          );
          ({ title, body } = parseArticle(markdown));
          const polished2 = antiPolish(body, 'medium');
          if (polished2.changes.length > 0) console.log(`[Max]   anti-polish retry (substack): ${polished2.changes.join(', ')}`);
          body = polished2.text;
          quality = await reviewArticle(title, body, claudeApiKey);
        }

        post.substack = {
          note: noteText,
          noteCategory,
          mirroredFromBluesky,
          newsletter: {
            title,
            body,
            category: substackCategory,
            qualityPassed: quality.passed,
            qualityScore: quality.score.average,
          },
        };
        console.log(`[Max]   Substack Newsletter ${day.date} (${substackCategory}): ${quality.score.average}/10 (${quality.passed ? 'pass' : 'fail'})`);
      } catch (err) {
        console.warn(`[Max]   Substack Newsletter pre-gen failed for ${day.date}:`, (err as Error).message);
        // Fallback: mirror Medium so we still ship something, flagged for visibility
        post.substack = {
          note: noteText,
          noteCategory,
          mirroredFromBluesky,
          newsletter: post.medium
            ? {
                title: post.medium.title,
                body: post.medium.body,
                category: post.medium.category,
                mirroredFromMedium: true,
              }
            : null,
        };
      }
    } else {
      // Not a newsletter day — still ship the Note. Preserve any existing newsletter from resume.
      post.substack = {
        note: noteText,
        noteCategory,
        mirroredFromBluesky,
        newsletter: existingNewsletter,
      };
    }

    posts.push(post);

    // Incremental save after each day — so a mid-run failure leaves partial progress
    // that the next run can resume from instead of restarting from scratch.
    savePregenerated(dataDir, {
      weekOf: calendar.weekOf,
      generatedAt: new Date().toISOString(),
      posts,
    });
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

async function generateTwitterText(apiKey: string, prompt: string): Promise<string> {
  let text = await generateContent(apiKey, prompt, {
    temperature: 0.92,
    maxTokens: 150,
    model: 'claude-haiku-4-5',
  });

  for (let attempt = 1; attempt <= 3 && text.length > 280; attempt++) {
    text = await generateContent(
      apiKey,
      `${prompt}\n\nIMPORTANT: Previous attempt was ${text.length} chars. ABSOLUTE MAX is 280 chars. Be more concise.`,
      { temperature: 0.7, maxTokens: 100, model: 'claude-haiku-4-5' },
    );
  }

  if (text.length > 280) {
    const truncated = text.slice(0, 277);
    text = truncated.slice(0, truncated.lastIndexOf(' ')) + '...';
  }

  return text.trim();
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
