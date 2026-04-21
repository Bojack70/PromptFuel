/**
 * Social-post orchestration — trigger-based browser automation posting.
 *
 * Uses pre-generated content from data/pregenerated-content.json (generated
 * each Monday via `node dist/index.js --mode generate-week`). No API key needed
 * at post time.
 *
 * Usage:
 *   node dist/index.js --mode social-post                   (Twitter only)
 *   node dist/index.js --mode social-post --reddit          (+ Reddit human-submit)
 *   node dist/index.js --mode social-post --hn              (+ HN human-submit)
 *   node dist/index.js --mode social-post --medium          (+ Medium human-assisted publish)
 *   node dist/index.js --mode social-post --dry-run         (print content, no posting)
 */

import { loadPregenerated, getTodayPregenerated } from '../../content/pregenerate.js';
import { postTweet } from './twitter.js';
import { submitToReddit } from './reddit.js';
import { submitToHN } from './hn.js';
import { postToMedium } from './medium.js';
import { postSubstackNote } from './substack.js';
import { jitter, sleep } from './client.js';

export interface SocialPostConfig {
  dataDir: string;
  platforms: {
    twitter: boolean;
    reddit: boolean;
    hn: boolean;
    medium: boolean;
    substack: boolean;
  };
  dryRun: boolean;
}

export interface SocialPostResult {
  twitter?: { url: string } | null;
  reddit?: { url: string } | null;
  hn?: { url: string; itemId?: string } | null;
  medium?: { url: string } | null;
  substack?: { url: string } | null;
  skipped?: string[];
}

/**
 * Derive a Reddit/HN discussion title from the pre-generated post.
 * Uses devto.title when available; otherwise builds one from the angle metadata.
 */
function deriveTitle(post: { bluesky: { text: string; angle?: string; category?: string }; devto: { title?: string } | null }): string {
  if (post.devto?.title) return post.devto.title;
  // Fallback: use the angle as a discussion-friendly title
  const angle = post.bluesky.angle ?? post.bluesky.category ?? 'Discussion';
  // Capitalise first letter
  return angle.charAt(0).toUpperCase() + angle.slice(1);
}

/**
 * Derive Reddit/HN body text from the pre-generated post.
 * Uses first 400 chars of devto.body when available; otherwise uses bluesky.text.
 */
function deriveBody(post: { bluesky: { text: string }; devto: { body?: string } | null }): string {
  if (post.devto?.body) {
    // Strip markdown headers and trim to ~400 chars for a discussion opener
    const plain = post.devto.body
      .replace(/^#+\s.+$/gm, '')  // remove headers
      .replace(/```[\s\S]*?```/g, '') // remove code blocks
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    // Take first paragraph that has enough substance
    const paragraphs = plain.split('\n\n').filter((p) => p.trim().length > 80);
    return (paragraphs[0] ?? plain).slice(0, 400).trim();
  }
  return post.bluesky.text;
}

/**
 * Run the social posting orchestration using pre-generated content.
 */
export async function runSocialPost(config: SocialPostConfig): Promise<SocialPostResult> {
  const result: SocialPostResult = { skipped: [] };

  // Load today's pre-generated content
  const week = loadPregenerated(config.dataDir);
  const todayPost = week ? getTodayPregenerated(week) : null;

  if (!todayPost) {
    console.error(
      `[Max] social-post: no pre-generated content for today.\n` +
      `Run "node dist/index.js --mode generate-week" on Monday to pre-generate this week's content.\n` +
      `Pre-generated weeks cover Mon–Sun, so run it at the start of each week.`
    );
    process.exit(1);
  }

  const platforms = Object.entries(config.platforms)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+');

  // Use dedicated Twitter content if available; fall back to Bluesky text trimmed to 280
  const twitterText = (todayPost.twitter?.text ?? todayPost.bluesky.text).trim().slice(0, 280);
  const twitterCategory = todayPost.twitter?.category ?? todayPost.bluesky.category;

  console.log(`[Max] Social post: ${new Date().toISOString().split('T')[0]} | bluesky=${todayPost.bluesky.category} twitter=${twitterCategory} | platforms=${platforms}`);
  console.log(`[Max] Twitter content (${twitterCategory}): "${twitterText.slice(0, 80)}..."`);

  // --- Twitter ---
  if (config.platforms.twitter) {
    console.log(`[Max] Twitter: ${twitterText.length} chars — "${twitterText.slice(0, 60)}..."`);
    const tweet = twitterText;

    if (config.dryRun) {
      console.log(`[Max] Twitter: DRY RUN — would post this tweet`);
      result.twitter = null;
    } else {
      await jitter(1000, 3000);
      const r = await postTweet({ text: tweet });
      console.log(`[Max] Twitter: posted — ${r.url}`);
      result.twitter = { url: r.url };
    }
  }

  // --- Reddit ---
  if (config.platforms.reddit) {
    // Space out from Twitter
    if (config.platforms.twitter && !config.dryRun) {
      const wait = Math.floor(5000 + Math.random() * 10000);
      console.log(`[Max] Reddit: waiting ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
    }

    const title = deriveTitle(todayPost as Parameters<typeof deriveTitle>[0]);
    const text = deriveBody(todayPost as Parameters<typeof deriveBody>[0]);

    console.log(`[Max] Reddit: title — "${title.slice(0, 80)}"`);
    console.log(`[Max] Reddit: body — "${text.slice(0, 80)}..."`);

    if (config.dryRun) {
      console.log(`[Max] Reddit: DRY RUN — would open r/test with the above content`);
      result.reddit = null;
    } else {
      await jitter(800, 2000);
      const r = await submitToReddit({
        subreddit: 'test',
        title: title.slice(0, 300),
        text: text,
        waitForHuman: true,
        humanTimeoutMs: 3 * 60_000,
      });
      console.log(`[Max] Reddit: submitted — ${r.submittedUrl}`);
      result.reddit = { url: r.submittedUrl };
    }
  }

  // --- Hacker News ---
  if (config.platforms.hn) {
    if ((config.platforms.twitter || config.platforms.reddit) && !config.dryRun) {
      const wait = Math.floor(8000 + Math.random() * 12000);
      console.log(`[Max] HN: waiting ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
    }

    const title = deriveTitle(todayPost as Parameters<typeof deriveTitle>[0]);
    const text = deriveBody(todayPost as Parameters<typeof deriveBody>[0]);

    // HN titles must be ≤80 chars
    const hnTitle = title.slice(0, 80);
    console.log(`[Max] HN: title — "${hnTitle}"`);

    if (config.dryRun) {
      console.log(`[Max] HN: DRY RUN — would open HN submit with the above content`);
      result.hn = null;
    } else {
      await jitter(800, 2000);
      const r = await submitToHN({ title: hnTitle, text });
      console.log(`[Max] HN: submitted — ${r.submittedUrl}`);
      result.hn = { url: r.submittedUrl, itemId: r.itemId };
    }
  }

  // --- Medium ---
  if (config.platforms.medium) {
    if ((config.platforms.twitter || config.platforms.reddit || config.platforms.hn) && !config.dryRun) {
      const wait = Math.floor(5000 + Math.random() * 10000);
      console.log(`[Max] Medium: waiting ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
    }

    if (!todayPost.medium?.title || !todayPost.medium?.body) {
      console.log(`[Max] Medium: skipping — no Medium content pre-generated for today (run generate-week to populate)`);
      result.skipped = [...(result.skipped ?? []), 'medium (no pregenerated content)'];
    } else {
      console.log(`[Max] Medium: title — "${todayPost.medium.title.slice(0, 80)}"`);

      if (config.dryRun) {
        console.log(`[Max] Medium: DRY RUN — would open medium.com/new-story and fill story`);
        result.medium = null;
      } else {
        await jitter(800, 2000);
        const r = await postToMedium({
          title: todayPost.medium.title,
          body: todayPost.medium.body,
        });
        console.log(`[Max] Medium: published — ${r.submittedUrl}`);
        result.medium = { url: r.submittedUrl };
      }
    }
  }

  // --- Substack Note ---
  if (config.platforms.substack) {
    if ((config.platforms.twitter || config.platforms.reddit || config.platforms.hn || config.platforms.medium) && !config.dryRun) {
      const wait = Math.floor(3000 + Math.random() * 5000);
      console.log(`[Max] Substack: waiting ${Math.round(wait / 1000)}s...`);
      await sleep(wait);
    }

    const noteText = todayPost.substack?.note ?? todayPost.bluesky?.text ?? null;

    if (!noteText) {
      console.log(`[Max] Substack: skipping — no note content available for today`);
      result.skipped = [...(result.skipped ?? []), 'substack (no note content)'];
    } else {
      console.log(`[Max] Substack Note: "${noteText.slice(0, 80)}..."`);

      if (config.dryRun) {
        console.log(`[Max] Substack: DRY RUN — would post note to Substack Notes feed`);
        result.substack = null;
      } else {
        await jitter(800, 2000);
        const r = await postSubstackNote({ text: noteText });
        console.log(`[Max] Substack Note: posted — ${r.url}`);
        result.substack = { url: r.url };
      }
    }
  }

  return result;
}
