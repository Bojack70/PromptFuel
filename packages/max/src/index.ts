/**
 * Max — Autonomous AI Growth Agent for PromptFuel
 * Entry point: --mode daily | weekly | dashboard
 *
 * Zero-cost publishing: Bluesky + Dev.to + Reddit (weekly)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { collectAndSave, type DaySnapshot } from './analytics/collector.js';
import { appendHistory, loadHistory, type ContentLogEntry } from './content/history.js';
import { planToday, type DailyPlan } from './content/scheduler.js';
import { generateContent } from './content/claude.js';
import { blueskyPrompt, devtoPrompt, tagsForCategory, type PromptContext } from './content/templates.js';
import { loadPregenerated, getTodayPregenerated, isPregeneratedCurrent } from './content/pregenerate.js';
import { postToBluesky } from './publish/bluesky.js';
import { postArticle, parseArticle } from './publish/devto.js';
import { postToReddit, pickSubreddit } from './publish/reddit.js';
import { reviewBlueskyPost, reviewArticle } from './content/quality.js';
import { loadCalendar, isCalendarCurrent, getTodayFromCalendar, generateWeeklyCalendar } from './content/calendar.js';
import { sendEmail } from './reports/email.js';
import { buildDailyDigest } from './reports/digest.js';
import { recordExperiment } from './experiments/tracker.js';
import { weeklyReflection } from './brain/weekly.js';
import { generateDashboard } from './dashboard/generator.js';
import { collectEngagement } from './analytics/engagement.js';

const args = process.argv.slice(2);
const modeFlag = args.indexOf('--mode');
const mode = modeFlag !== -1 ? args[modeFlag + 1] : 'daily';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function loadState(dataDir: string): Record<string, unknown> {
  const file = join(dataDir, 'state.json');
  if (!existsSync(file)) return { warmupStartDate: '2026-03-24' };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { warmupStartDate: '2026-03-24' };
  }
}

function saveState(dataDir: string, state: Record<string, unknown>): void {
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(state, null, 2));
}

function buildPromptContext(snapshot: DaySnapshot, history: ContentLogEntry[]): PromptContext {
  const totalWeek = Object.values(snapshot.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0);
  const totalMonth = Object.values(snapshot.npm.packages).reduce((s, p) => s + p.downloadsLastMonth, 0);

  // Last 5 post summaries for anti-repetition
  const recentPosts = history.slice(-5).map((e) =>
    e.platform === 'bluesky' ? e.content : (e.title ?? e.content.slice(0, 80)),
  );

  return {
    stars: snapshot.github.stars,
    forks: snapshot.github.forks,
    npmDownloadsWeek: totalWeek,
    npmDownloadsMonth: totalMonth,
    deltaStars: snapshot.deltas.stars,
    recentPosts,
  };
}

/**
 * Generate a Bluesky post via Claude and ensure it fits within 300 graphemes.
 */
async function generateBlueskyPost(prompt: string, claudeApiKey: string): Promise<string> {
  let text = await generateContent(claudeApiKey, prompt, {
    temperature: 0.9,
    maxTokens: 150,
    model: 'claude-haiku-4-5',
  });

  for (let attempt = 1; attempt <= 3 && text.length > 300; attempt++) {
    console.warn(`[Max] Post attempt ${attempt} was ${text.length} chars, retrying...`);
    text = await generateContent(
      claudeApiKey,
      `${prompt}\n\nIMPORTANT: Your previous attempt was ${text.length} characters. The ABSOLUTE MAXIMUM is 300 characters. Be much more concise.`,
      { temperature: 0.7, maxTokens: 100, model: 'claude-haiku-4-5' },
    );
  }

  if (text.length > 300) {
    const truncated = text.slice(0, 297);
    text = truncated.slice(0, truncated.lastIndexOf(' ')) + '...';
    console.warn(`[Max] Post force-truncated to ${text.length} chars`);
  }

  return text;
}

async function daily() {
  const config = loadConfig();

  // ── Phase 0: Analytics collection ──
  console.log('[Max] Starting daily collection...');
  const snapshot = await collectAndSave(config);

  console.log(`[Max] Snapshot saved: ${snapshot.date}`);
  console.log(`[Max] GitHub: ${snapshot.github.stars} stars (+${snapshot.deltas.stars}), ${snapshot.github.forks} forks`);
  console.log(`[Max] Views: ${snapshot.github.views.count} (${snapshot.github.views.uniques} unique)`);

  const totalDownloads = Object.values(snapshot.npm.packages).reduce((s, p) => s + p.downloadsLastDay, 0);
  console.log(`[Max] npm downloads (today): ${totalDownloads}`);

  for (const [pkg, data] of Object.entries(snapshot.npm.packages)) {
    console.log(`[Max]   ${pkg}: ${data.downloadsLastDay}/day, ${data.downloadsLastWeek}/week, ${data.downloadsLastMonth}/month`);
  }

  // ── Phase 0.5: Engagement collection ──
  try {
    console.log('[Max] Collecting engagement metrics...');
    const engagementSnapshot = await collectEngagement(config);
    console.log(`[Max] Engagement collected for ${engagementSnapshot.posts.length} posts`);
  } catch (err) {
    console.warn('[Max] Engagement collection failed (non-fatal):', (err as Error).message);
  }

  // ── Phase 1: Content pipeline ──
  console.log('\n[Max] Starting content pipeline...');
  const state = loadState(config.dataDir);
  const history = loadHistory(config.dataDir);

  // Load weekly content calendar
  const calendar = loadCalendar(config.dataDir);
  const calendarDay = calendar && isCalendarCurrent(calendar) ? getTodayFromCalendar(calendar) : null;
  if (calendarDay) {
    console.log(`[Max] Calendar: Bluesky=${calendarDay.bluesky ?? 'skip'} Dev.to=${calendarDay.devto ?? 'skip'}`);
  }

  const plan = planToday(state as any, history, calendarDay);
  console.log(`[Max] Stage: ${plan.stage} | Bluesky: ${plan.bluesky?.category ?? 'skip'} | Dev.to: ${plan.devto?.category ?? 'skip'}`);

  const ctx = buildPromptContext(snapshot, history);

  // Check for pre-generated content (committed to repo each Monday)
  const pregenerated = loadPregenerated(config.dataDir);
  const todayPregen = isPregeneratedCurrent(pregenerated) ? getTodayPregenerated(pregenerated!) : null;

  if (todayPregen) {
    console.log('[Max] Pre-generated content found for today');
    // Pre-generated content was quality-reviewed for this specific date — publish it
    // regardless of day-of-week gating in the scheduler.
    if (!plan.devto && todayPregen.devto?.qualityPassed) {
      plan.devto = { category: todayPregen.devto.category };
      console.log('[Max] Dev.to plan overridden: pre-generated article available for today');
    }
  } else {
    console.log('[Max] No pre-generated content for today — will attempt on-demand generation');
    if (!config.claudeApiKey) {
      console.warn('[Max] No ANTHROPIC_API_KEY set and no pre-generated content — skipping content publishing');
    }
  }

  // ── Bluesky ──
  if (plan.bluesky) {
    try {
      // Use pre-generated content if available and passed quality gate
      if (todayPregen?.bluesky?.qualityPassed) {
        const pregenPost = todayPregen.bluesky;
        console.log(`[Max] Using pre-generated Bluesky post (quality: ${pregenPost.qualityScore}/10)`);
        const result = await postToBluesky(pregenPost.text, config.blueskyHandle, config.blueskyAppPassword);
        appendHistory(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'bluesky',
          category: pregenPost.category,
          content: result.text,
          postId: result.uri,
        });
        console.log(`[Max] Bluesky post published (${result.text.length} chars): ${result.uri}`);
        recordExperiment(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'bluesky',
          category: pregenPost.category,
          qualityScores: { authenticity: 7, value: 7, accuracy: 7, engagement: 7, average: pregenPost.qualityScore, feedback: 'pre-generated' },
          passed: true,
          retried: false,
        });
      } else if (config.claudeApiKey) {
        // On-demand generation fallback (only if API key available)
        console.log(`[Max] Generating ${plan.bluesky.category} Bluesky post on-demand...`);
        const prompt = blueskyPrompt(plan.bluesky.category, ctx);
        let postText = await generateBlueskyPost(prompt, config.claudeApiKey);
        let wasRetried = false;

        let quality = await reviewBlueskyPost(postText, config.claudeApiKey);
        console.log(`[Max] Post quality: ${quality.score.average}/10 (A:${quality.score.authenticity} V:${quality.score.value} Ac:${quality.score.accuracy} E:${quality.score.engagement})`);

        if (!quality.passed) {
          console.log(`[Max] Below threshold — regenerating with feedback: ${quality.score.feedback}`);
          postText = await generateBlueskyPost(
            `${prompt}\n\nIMPORTANT FEEDBACK FROM REVIEWER: ${quality.score.feedback}. Address this in your post.`,
            config.claudeApiKey,
          );
          quality = await reviewBlueskyPost(postText, config.claudeApiKey);
          wasRetried = true;
          console.log(`[Max] Retry quality: ${quality.score.average}/10`);
        }

        recordExperiment(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'bluesky',
          category: plan.bluesky.category,
          qualityScores: quality.score,
          passed: quality.passed,
          retried: wasRetried,
        });

        if (quality.passed) {
          const result = await postToBluesky(postText, config.blueskyHandle, config.blueskyAppPassword);
          appendHistory(config.dataDir, {
            date: today(),
            timestamp: new Date().toISOString(),
            platform: 'bluesky',
            category: plan.bluesky.category,
            content: result.text,
            postId: result.uri,
          });
          console.log(`[Max] Bluesky post published (${result.text.length} chars): ${result.uri}`);
        } else {
          console.warn(`[Max] Post rejected after retry (${quality.score.average}/10) — skipping`);
        }
      } // end on-demand fallback
    } catch (err) {
      console.error('[Max] Bluesky post failed:', err);
    }
  }

  // ── Dev.to ──
  if (plan.devto) {
    try {
      // Use pre-generated article if available and passed quality gate
      if (todayPregen?.devto?.qualityPassed) {
        const pregenArticle = todayPregen.devto;
        console.log(`[Max] Using pre-generated Dev.to article (quality: ${pregenArticle.qualityScore}/10): "${pregenArticle.title}"`);
        const result = await postArticle(pregenArticle.title, pregenArticle.body, pregenArticle.tags, config);
        appendHistory(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'devto',
          category: pregenArticle.category,
          title: pregenArticle.title,
          content: pregenArticle.body.slice(0, 200),
          postId: String(result.id),
          postUrl: result.url,
        });
        console.log(`[Max] Article posted: ${result.url}`);
        recordExperiment(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'devto',
          category: pregenArticle.category,
          qualityScores: { authenticity: 7, value: 7, accuracy: 7, engagement: 7, average: pregenArticle.qualityScore, feedback: 'pre-generated' },
          passed: true,
          retried: false,
        });
      } else if (config.claudeApiKey) {
        // On-demand generation fallback (only if API key available)
        console.log(`[Max] Generating ${plan.devto.category} article on-demand...`);
        const prompt = devtoPrompt(plan.devto.category, ctx);
        let markdown = await generateContent(config.claudeApiKey, prompt, {
          temperature: 0.8,
          maxTokens: 4096,
          model: 'claude-haiku-4-5',
        });

        let { title, body } = parseArticle(markdown);
        const tags = tagsForCategory(plan.devto.category);
        let wasRetried = false;

        let quality = await reviewArticle(title, body, config.claudeApiKey);
        console.log(`[Max] Article quality: ${quality.score.average}/10 (A:${quality.score.authenticity} V:${quality.score.value} Ac:${quality.score.accuracy} E:${quality.score.engagement})`);

        if (!quality.passed) {
          console.log(`[Max] Below threshold — regenerating with feedback: ${quality.score.feedback}`);
          markdown = await generateContent(config.claudeApiKey,
            `${prompt}\n\nIMPORTANT FEEDBACK FROM REVIEWER: ${quality.score.feedback}. Address this issue while keeping the article high quality.`,
            { temperature: 0.8, maxTokens: 4096, model: 'claude-haiku-4-5' },
          );
          ({ title, body } = parseArticle(markdown));
          quality = await reviewArticle(title, body, config.claudeApiKey);
          wasRetried = true;
          console.log(`[Max] Retry quality: ${quality.score.average}/10`);
        }

        recordExperiment(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'devto',
          category: plan.devto.category,
          qualityScores: quality.score,
          passed: quality.passed,
          retried: wasRetried,
        });

        if (quality.passed) {
          const result = await postArticle(title, body, tags, config);
          appendHistory(config.dataDir, {
            date: today(),
            timestamp: new Date().toISOString(),
            platform: 'devto',
            category: plan.devto.category,
            title,
            content: body.slice(0, 200),
            postId: String(result.id),
            postUrl: result.url,
          });
          console.log(`[Max] Article posted: ${result.url}`);
        } else {
          console.warn(`[Max] Article rejected after retry (${quality.score.average}/10) — skipping`);
        }
      } // end on-demand fallback
    } catch (err) {
      console.error('[Max] Dev.to post failed:', err);
    }
  }

  // ── Email digest ──
  try {
    console.log('\n[Max] Sending daily digest...');
    const todaysPosts = loadHistory(config.dataDir).filter((e) => e.date === today());
    const { subject, html } = buildDailyDigest({ snapshot, stage: plan.stage, todaysPosts });
    const emailResult = await sendEmail(config.resendApiKey, {
      to: config.reportEmail,
      subject,
      html,
    });
    console.log(`[Max] Digest sent: ${emailResult.id}`);
  } catch (err) {
    console.error('[Max] Email digest failed:', err);
  }

  // ── Update state ──
  state.lastContentRun = new Date().toISOString();
  state.accountStatus = { bluesky: plan.stage, devto: plan.stage };
  saveState(config.dataDir, state);

  console.log('[Max] Daily run complete.');
}

async function weekly() {
  const config = loadConfig();
  try {
    await weeklyReflection(config);
  } catch (err) {
    console.warn('[Max] Weekly reflection failed (non-fatal):', (err as Error).message);
  }
}

async function dashboard() {
  const config = loadConfig();
  console.log('[Max] Generating dashboard...');
  generateDashboard(config.dataDir);
  console.log('[Max] Dashboard complete.');
}

/**
 * Local content generation — run this manually each Monday before the week starts.
 * Requires ANTHROPIC_API_KEY set locally. Generates pregenerated-content.json which
 * you then commit so the daily GitHub Actions runs can just publish without an API key.
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... node dist/index.js --mode generate-week
 */
async function generateWeek() {
  const config = loadConfig();
  if (!config.claudeApiKey) {
    console.error('[Max] ANTHROPIC_API_KEY is required for generate-week. Set it in your environment.');
    process.exit(1);
  }

  console.log('[Max] Starting local content pre-generation for this week...');

  // Need analytics snapshot for context
  const snapshot = await collectAndSave(config);
  console.log(`[Max] Snapshot: ${snapshot.github.stars} stars, ${snapshot.github.forks} forks`);

  const history = loadHistory(config.dataDir);
  const state = loadState(config.dataDir);
  const ctx = buildPromptContext(snapshot, history);

  // Generate or load calendar
  let calendar = loadCalendar(config.dataDir);
  if (!calendar || !isCalendarCurrent(calendar)) {
    console.log('[Max] Generating new weekly calendar...');
    const stageDay = Math.floor((Date.now() - new Date('2026-03-24').getTime()) / 86400000);
    const stage = stageDay < 15 ? 'warmup' : stageDay < 31 ? 'transition' : 'active';
    calendar = await generateWeeklyCalendar(config.claudeApiKey, stage as any, config.dataDir);
  } else {
    console.log(`[Max] Using existing calendar for week of ${calendar.weekOf}`);
  }

  // Pre-generate all content for the week
  const { pregenerateWeek } = await import('./content/pregenerate.js');
  const week = await pregenerateWeek(config.claudeApiKey, calendar, ctx, config.dataDir);

  const passed = week.posts.filter((p) => p.bluesky?.qualityPassed || p.devto?.qualityPassed).length;
  console.log(`\n[Max] Done! ${passed}/${week.posts.length} days have passing content.`);
  console.log(`[Max] File saved: packages/max/data/pregenerated-content.json`);
  console.log('[Max] Commit and push this file so the daily workflow can publish from it.');
}

async function postBlueskyManual() {
  const config = loadConfig();
  const text = process.env.POST_TEXT;
  if (!text) throw new Error('POST_TEXT env var is required');
  if (text.length > 300) throw new Error(`Post is ${text.length} chars, max is 300`);
  console.log(`[Max] Posting to Bluesky (${text.length} chars): ${text}`);
  const result = await postToBluesky(text, config.blueskyHandle, config.blueskyAppPassword);
  console.log(`[Max] Bluesky post published: ${result.uri}`);
  appendHistory(config.dataDir, {
    date: today(),
    timestamp: new Date().toISOString(),
    platform: 'bluesky',
    category: 'tip',
    content: text,
    postId: result.uri,
  });
  console.log('[Max] Content log updated.');
}

/**
 * Smoke test: fills HN submit form via OpenTabs. Defaults to DRY RUN (no submission).
 * Requires `opentabs start` running + Nate Voss logged into HN in the connected browser.
 *
 * Usage: node dist/index.js --mode social-test-hn            (dry run)
 *        node dist/index.js --mode social-test-hn --submit   (actually posts)
 */
async function socialTestHN() {
  const { submitToHN } = await import('./publish/opentabs/hn.js');
  const shouldSubmit = args.includes('--submit');
  const title = `Test — verifying automation flow (${new Date().toISOString().split('T')[0]})`;
  const text = `This is a smoke-test fill of the HN submit form. Not meant for public posting.`;
  console.log(`[Max] Smoke test: ${shouldSubmit ? 'REAL SUBMISSION' : 'dry run (form fill only, no submit)'}`);
  const result = await submitToHN({ title, text, dryRun: !shouldSubmit });
  console.log(`[Max] Smoke test done. Tab ID: ${result.tabId}. URL: ${result.submittedUrl}`);
  if (result.itemId) console.log(`[Max] Item ID: ${result.itemId}`);
}

/**
 * Smoke test: fills r/test submit form via OpenTabs.
 *
 * Usage:
 *   node dist/index.js --mode social-test-reddit                  (dry run: fill only)
 *   node dist/index.js --mode social-test-reddit --submit         (auto-submit; fails if captcha shown)
 *   node dist/index.js --mode social-test-reddit --human-submit   (fill + wait for you to solve captcha + click submit)
 */
async function socialTestReddit() {
  const { submitToReddit } = await import('./publish/opentabs/reddit.js');
  const humanSubmit = args.includes('--human-submit');
  const shouldSubmit = args.includes('--submit') || humanSubmit;
  const title = `Automation smoke test — ${new Date().toISOString().split('T')[0]}`;
  const text = `Verifying OpenTabs → Max integration on r/test. This sub is for testing; please ignore.`;
  const mode = humanSubmit
    ? 'HUMAN-ASSISTED SUBMIT to r/test (you click captcha + submit)'
    : shouldSubmit
      ? 'REAL SUBMISSION to r/test (auto-click)'
      : 'dry run (form fill only, no submit)';
  console.log(`[Max] Smoke test: ${mode}`);
  const result = await submitToReddit({
    subreddit: 'test',
    title,
    text,
    dryRun: !shouldSubmit,
    waitForHuman: humanSubmit,
  });
  console.log(`[Max] Smoke test done. Tab ID: ${result.tabId}. URL: ${result.submittedUrl}`);
}

/**
 * Engagement warmup — likes, upvotes, and comments on other people's content.
 *
 * Usage:
 *   node dist/index.js --mode social-engage                  (all platforms)
 *   node dist/index.js --mode social-engage --twitter-only
 *   node dist/index.js --mode social-engage --reddit-only
 *   node dist/index.js --mode social-engage --hn-only
 *   node dist/index.js --mode social-engage --dry-run        (log actions, no clicks)
 */
async function socialEngage() {
  const { runEngagement } = await import('./publish/opentabs/engagement.js');
  const twitterOnly = args.includes('--twitter-only');
  const redditOnly = args.includes('--reddit-only');
  const hnOnly = args.includes('--hn-only');
  const anySpecific = twitterOnly || redditOnly || hnOnly;
  const result = await runEngagement({
    platforms: {
      twitter: anySpecific ? twitterOnly : true,
      reddit: anySpecific ? redditOnly : true,
      hn: anySpecific ? hnOnly : true,
    },
    dryRun: args.includes('--dry-run'),
  });
  console.log('[Max] Engagement complete:', JSON.stringify(result, null, 2));
}

/**
 * Trigger-based social posting across Twitter, Reddit, and HN.
 *
 * Usage:
 *   node dist/index.js --mode social-post                  (Twitter only, auto-post)
 *   node dist/index.js --mode social-post --reddit         (+ Reddit human-submit)
 *   node dist/index.js --mode social-post --hn             (+ HN human-submit)
 *   node dist/index.js --mode social-post --dry-run        (generate content, no posting)
 *
 * Requires ANTHROPIC_API_KEY in environment.
 */
async function socialPost() {
  const { runSocialPost } = await import('./publish/opentabs/social-post.js');
  // social-post only needs dataDir — skip loadConfig() which validates unrelated secrets.
  // fileURLToPath handles spaces in the path (new URL().pathname returns %20-encoded strings
  // which existsSync/readFileSync don't recognise as valid filesystem paths).
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  const result = await runSocialPost({
    dataDir,
    platforms: {
      twitter: true,
      reddit: args.includes('--reddit'),
      hn: args.includes('--hn'),
    },
    dryRun: args.includes('--dry-run'),
  });
  console.log('[Max] Social post complete:', JSON.stringify(result, null, 2));
}

/**
 * Smoke test: posts a tweet via OpenTabs.
 *
 * Usage:
 *   node dist/index.js --mode social-test-twitter          (dry run: fill compose box only)
 *   node dist/index.js --mode social-test-twitter --submit (actually tweets)
 */
async function socialTestTwitter() {
  const { postTweet } = await import('./publish/opentabs/twitter.js');
  const shouldSubmit = args.includes('--submit');
  const text = `Automation smoke test — ${new Date().toISOString().split('T')[0]} (ignore this)`;
  console.log(`[Max] Smoke test: ${shouldSubmit ? 'REAL TWEET' : 'dry run (compose fill only)'}`);
  const result = await postTweet({ text, dryRun: !shouldSubmit });
  console.log(`[Max] Smoke test done. Tab ID: ${result.tabId}. URL: ${result.url}`);
}

async function main() {
  try {
    switch (mode) {
      case 'daily':
        await daily();
        break;
      case 'weekly':
        await weekly();
        break;
      case 'dashboard':
        await dashboard();
        break;
      case 'post':
        await postBlueskyManual();
        break;
      case 'generate-week':
        await generateWeek();
        break;
      case 'social-test-hn':
        await socialTestHN();
        break;
      case 'social-test-reddit':
        await socialTestReddit();
        break;
      case 'social-test-twitter':
        await socialTestTwitter();
        break;
      case 'social-post':
        await socialPost();
        break;
      case 'social-engage':
        await socialEngage();
        break;
      default:
        console.error(`Unknown mode: ${mode}. Use --mode daily|weekly|dashboard|post|generate-week|social-test-hn|social-test-reddit|social-test-twitter|social-post|social-engage`);
        process.exit(1);
    }
  } catch (err) {
    console.error('[Max] Fatal error:', err);
    process.exit(1);
  }
}

main();
