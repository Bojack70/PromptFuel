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
import { weeklyReflection, weeklyDataOnly } from './brain/weekly.js';
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

  // Guard against duplicate posts when the daily flow runs more than once in a day
  // (e.g. CI re-run, manual trigger, local test). Every pre-gen publish path goes
  // through appendHistory(), so a same-platform same-date entry means we already posted.
  const todayStr = today();
  const todayEntries = history.filter((e) => e.date === todayStr);
  const alreadyPostedBluesky = todayEntries.some((e) => e.platform === 'bluesky');
  const alreadyPostedDevto = todayEntries.some((e) => e.platform === 'devto');

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
  if (plan.bluesky && alreadyPostedBluesky) {
    console.log('[Max] Bluesky: already posted today — skipping to avoid duplicate');
  }
  if (plan.bluesky && !alreadyPostedBluesky) {
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
  if (plan.devto && alreadyPostedDevto) {
    console.log('[Max] Dev.to: already posted today — skipping to avoid duplicate');
  }
  if (plan.devto && !alreadyPostedDevto) {
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
    const { subject, html } = buildDailyDigest({ snapshot, stage: plan.stage, todaysPosts, pregeneratedToday: todayPregen });
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

/**
 * CI-safe weekly pass — runs the deterministic (non-LLM) portion of the
 * weekly brain. Used by `.github/workflows/max-weekly.yml` because GitHub
 * Actions has neither the Claude Code CLI nor access to the subscription
 * keychain, and the zero-cost policy forbids hitting the paid Anthropic API
 * from CI. Run `--mode weekly` locally on Mondays to produce the reflection,
 * next week's calendar, and pre-generated content.
 */
async function weeklyData() {
  const config = loadConfig();
  try {
    await weeklyDataOnly(config);
  } catch (err) {
    console.warn('[Max] Weekly data-only pass failed (non-fatal):', (err as Error).message);
  }
  // Always regenerate dashboard after data pass so the HTML is never stale
  generateDashboard(config.dataDir);
}

async function dashboard() {
  const config = loadConfig();
  console.log('[Max] Generating dashboard...');
  generateDashboard(config.dataDir);
  console.log('[Max] Dashboard complete.');
}

/**
 * Daily reader — fetches 1 article per topic bucket from Medium (and optionally
 * Substack publications listed in data/reader-sources.json), appending to
 * data/reading-log.json. Pure fetch, zero LLM calls, CI-safe.
 *
 * Runs daily alongside analytics collection. Weekly brain later synthesises
 * patterns from the corpus.
 */
async function readDaily() {
  const { fetchDailyReading } = await import('./analytics/reader.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  console.log('[Max] Starting daily reader...');
  const result = await fetchDailyReading(dataDir);
  console.log(`[Max] Reader done: +${result.added} added, ${result.skipped} skipped`);
}

/**
 * Local cross-platform engagement collector — scrapes Medium/Substack/Twitter
 * via OpenTabs (needs logged-in Brave session). Cannot run in CI.
 *
 * Usage:
 *   node dist/index.js --mode collect-engagement-local                (all 3)
 *   node dist/index.js --mode collect-engagement-local --dry-run      (dumps DOM, saves nothing)
 *   node dist/index.js --mode collect-engagement-local --only medium
 */
async function collectEngagementLocal() {
  const { collectLocalEngagement } = await import('./analytics/engagement-local.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx !== -1 ? args[onlyIdx + 1] as 'medium' | 'substack' | 'twitter' : undefined;
  const dryRun = args.includes('--dry-run');

  const handles = {
    medium: process.env.MEDIUM_HANDLE ?? 'natevoss.dev',
    substack: process.env.SUBSTACK_HANDLE ?? 'natevoss',
    twitter: process.env.TWITTER_HANDLE ?? 'natevoss_dev',
  };

  console.log(`[Max] Collecting local engagement (medium=${handles.medium}, substack=${handles.substack}, twitter=${handles.twitter})${dryRun ? ' [dry-run]' : ''}${only ? ` [only=${only}]` : ''}`);
  const snapshot = await collectLocalEngagement({ dataDir, handles, dryRun, only });

  console.log('[Max] Local engagement complete:');
  if (snapshot.medium) console.log(`  Medium: articles=${snapshot.medium.articles.length} followers=${snapshot.medium.followers ?? '?'}`);
  if (snapshot.substack) console.log(`  Substack: subs=${snapshot.substack.subscribers ?? '?'} posts=${snapshot.substack.posts.length} notes=${snapshot.substack.notes.length}`);
  if (snapshot.twitter) console.log(`  Twitter: followers=${snapshot.twitter.followers ?? '?'} tweets=${snapshot.twitter.tweets.length}`);
  if (dryRun) console.log('  (dry-run — no data saved; check data/dom-dumps/ for HTML dumps)');
}

/**
 * Daily news fetcher — pulls from 5 sources (HN + Product Hunt + TechCrunch
 * + Ars Technica + The Verge) into rolling 30-day corpus in data/news-log.json.
 * Pure fetch, zero LLM, CI-safe. Weekly brain triages into eligible angles.
 */
async function fetchNews() {
  const { fetchDailyNews } = await import('./analytics/news.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  console.log('[Max] Starting daily news fetcher...');
  const result = await fetchDailyNews(dataDir);
  console.log(`[Max] News done: +${result.added} added`);
}

/**
 * Reactive post generator — user-initiated when they want to react to
 * breaking news with a genuine take.
 *
 * Usage:
 *   node dist/index.js --mode react --topic "anthropic claude 4.7 release"
 *   node dist/index.js --mode react --topic "apple ai event" --angle "their take on on-device privacy"
 *   node dist/index.js --mode react --topic "..." --platform medium     (default: twitter)
 *
 * Flow:
 *   1. Search HN Algolia + local corpus for articles matching topic
 *   2. Generate post via Claude with guardrails (no quality claims without firsthand use)
 *   3. Run anti-polish + quality review
 *   4. Save to data/reactive-posts.json + print to stdout for review
 *   5. User publishes via existing `--mode social-post` flows
 */
async function react() {
  const topicIdx = args.indexOf('--topic');
  if (topicIdx === -1 || !args[topicIdx + 1]) {
    console.error('[Max] react requires --topic "your topic"');
    console.error('[Max] optional: --angle "your genuine take" --platform twitter|bluesky|medium');
    process.exit(1);
  }
  const topic = args[topicIdx + 1];
  const angleIdx = args.indexOf('--angle');
  const angle = angleIdx !== -1 ? args[angleIdx + 1] : undefined;
  const platformIdx = args.indexOf('--platform');
  const platform = (platformIdx !== -1 ? args[platformIdx + 1] : 'twitter') as 'twitter' | 'bluesky' | 'medium';

  const mode = (process.env.MAX_LLM_MODE ?? 'cli').toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (mode === 'api' && !apiKey) {
    console.error('[Max] MAX_LLM_MODE=api but ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }

  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));

  const { searchNews } = await import('./analytics/news.js');
  const { generateContent } = await import('./content/claude.js');
  const { antiPolish } = await import('./content/anti-polish.js');
  const { reviewBlueskyPost, reviewArticle } = await import('./content/quality.js');

  console.log(`[Max][react] topic="${topic}" angle=${angle ? `"${angle}"` : '(none — will infer)'} platform=${platform}`);
  console.log('[Max][react] Searching news (HN Algolia + local corpus)...');
  const search = await searchNews(topic, dataDir, 7);
  console.log(`[Max][react] Found ${search.all.length} matching articles (${search.fromSearch.length} from Algolia, ${search.fromCorpus.length} from local)`);

  if (search.all.length === 0 && !angle) {
    console.error('[Max][react] No matching articles found and no --angle provided.');
    console.error('[Max][react] Either broaden the topic, or provide --angle "your genuine take" so I can still generate.');
    process.exit(1);
  }

  const articlesBlock = search.all.slice(0, 5)
    .map((a) => `- [${a.source}] "${a.title}" ${a.excerpt ? `— ${a.excerpt.slice(0, 200)}` : ''} (${a.url})`)
    .join('\n');

  const platformConstraints: Record<string, { limit: string; format: string; model: string; maxTokens: number }> = {
    twitter:   { limit: '280 chars max', format: 'single tweet — no threads, no bullets, no hashtags', model: 'claude-haiku-4-5', maxTokens: 150 },
    bluesky:   { limit: '300 chars max', format: 'single post — no bullets, no hashtags', model: 'claude-haiku-4-5', maxTokens: 150 },
    medium:    { limit: '700-1200 words', format: 'Medium markdown with # title, personal scene opener, short paragraphs, end with a direct question', model: 'claude-opus-4-7', maxTokens: 4096 },
  };
  const cfg = platformConstraints[platform];
  if (!cfg) {
    console.error(`[Max][react] Unknown platform: ${platform}. Use twitter|bluesky|medium.`);
    process.exit(1);
  }

  const prompt = `You are Nate Voss. Generate ONE ${platform} post reacting to breaking news about "${topic}".

${angle ? `NATE'S GENUINE ANGLE (from his actual experience — build the post around this): ${angle}\n` : 'NATE HAS NOT SPECIFIED A PERSONAL ANGLE — choose the most defensible observable/discourse/meta angle from the news below.\n'}
HONEST-TAKE RULE — non-negotiable:
You may comment on OBSERVABLE second-order effects, PRICING/availability/policy shifts, the DISCOURSE (what the community is collectively saying), META-commentary on how people are reacting, or PATTERN recognition across similar past events.
You may NOT claim any product, model, framework, or tool is "good", "bad", "impressive", "a game-changer", "solid", or any quality/performance judgment UNLESS Nate has personally tested it and the angle above explicitly states that testing.
If you catch yourself drifting toward quality claims, pivot to "what's observable instead is X".

FORMAT: ${cfg.format}
LENGTH: ${cfg.limit}

NEWS CONTEXT:
${articlesBlock || '(no articles fetched — rely on the angle above and general knowledge of the topic)'}

Generate the post now. No preamble, no explanation, no meta-commentary. Just the post itself.${platform === 'medium' ? ' Return as markdown starting with a single # title line.' : ''}`;

  console.log('[Max][react] Generating...');
  let text = await generateContent(apiKey, prompt, { temperature: 0.7, maxTokens: cfg.maxTokens, model: cfg.model });

  // anti-polish
  const polished = antiPolish(text, platform);
  if (polished.changes.length > 0) console.log(`[Max][react] anti-polish: ${polished.changes.join(', ')}`);
  text = polished.text;

  // quality review (short-post reviewer for twitter/bluesky, article reviewer for medium)
  let quality;
  if (platform === 'medium') {
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : topic;
    const body = text.replace(/^#\s+.+$/m, '').trim();
    quality = await reviewArticle(title, body, apiKey);
  } else {
    quality = await reviewBlueskyPost(text, apiKey);
  }
  console.log(`[Max][react] Quality: ${quality.score.average}/10 (A:${quality.score.authenticity} V:${quality.score.value} Ac:${quality.score.accuracy} E:${quality.score.engagement})`);
  if (quality.score.feedback) console.log(`[Max][react] Reviewer note: ${quality.score.feedback}`);

  // Save to reactive-posts.json for later retrieval
  const fs = await import('node:fs');
  const reactiveFile = join(dataDir, 'reactive-posts.json');
  const existing: { posts: any[] } = fs.existsSync(reactiveFile)
    ? JSON.parse(fs.readFileSync(reactiveFile, 'utf-8'))
    : { posts: [] };
  const entry = {
    id: `react-${Date.now()}`,
    createdAt: new Date().toISOString(),
    topic,
    angle,
    platform,
    articleUrls: search.all.slice(0, 5).map((a) => a.url),
    text,
    quality: quality.score,
    passed: quality.passed,
  };
  existing.posts.push(entry);
  existing.posts = existing.posts.slice(-20); // keep last 20
  fs.writeFileSync(reactiveFile, JSON.stringify(existing, null, 2));

  console.log('\n========== GENERATED POST ==========');
  console.log(text);
  console.log('====================================\n');
  console.log(`[Max][react] Saved as ${entry.id} in data/reactive-posts.json`);
  console.log('[Max][react] Review the text above. To publish:');
  if (platform === 'twitter') console.log('  • edit data/pregenerated-content.json to splice in this text for today, then --mode social-post');
  if (platform === 'bluesky') console.log('  • use --mode post with POST_TEXT env var, or edit pregenerated-content.json');
  if (platform === 'medium') console.log('  • save text to a .json file with {"title":"...","body":"..."} and run --mode publish-medium --file <path> --submit');
  if (!quality.passed) console.log('  ⚠ Quality below threshold — review + edit before publishing.');
}

/**
 * Daily trend fetcher — pulls top HN stories to the running trend log.
 * Pure fetch, zero LLM, CI-safe. Weekly brain synthesises themes from the
 * accumulated headlines.
 */
async function fetchTrends() {
  const { fetchDailyTrends } = await import('./analytics/trends.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  console.log('[Max] Starting daily trend fetcher...');
  const result = await fetchDailyTrends(dataDir);
  console.log(`[Max] Trends done: +${result.added} added, ${result.skipped} skipped`);
}

/**
 * Local content generation — run this manually each Monday before the week starts.
 *
 * Defaults to MAX_LLM_MODE=cli (Claude Code subscription subprocess, $0 cost, needs
 * `claude` on PATH and an active session). Set MAX_LLM_MODE=api + ANTHROPIC_API_KEY
 * to use the paid API instead (isolated from subscription quota, ~$5–7/mo).
 *
 * Resume-from-failure: re-running the same command resumes from where it left off.
 *
 * Usage:
 *   node dist/index.js --mode generate-week                         (cli mode, default)
 *   MAX_LLM_MODE=api ANTHROPIC_API_KEY=sk-ant-... node dist/index.js --mode generate-week
 */
async function generateWeek() {
  const config = loadConfig();
  const mode = (process.env.MAX_LLM_MODE ?? 'cli').toLowerCase();
  if (mode === 'api' && !config.claudeApiKey) {
    console.error('[Max] MAX_LLM_MODE=api but ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }
  console.log(`[Max] LLM mode: ${mode}${mode === 'cli' ? ' (Claude Code subscription subprocess)' : ' (Anthropic API)'}`);

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
 * Medium engagement — read, clap, and respond to other people's articles.
 *
 * Anti-detection-first: conservative caps, human-paced reading, Claude-generated
 * responses that reference article content.
 *
 * Usage:
 *   node dist/index.js --mode medium-engage
 *   node dist/index.js --mode medium-engage --dry-run
 *   node dist/index.js --mode medium-engage --topic artificial-intelligence
 *
 * Requires ANTHROPIC_API_KEY for comment generation.
 */
async function mediumEngage() {
  const { engageMedium } = await import('./publish/opentabs/medium-engage.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  const mode = (process.env.MAX_LLM_MODE ?? 'cli').toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (mode === 'api' && !apiKey) {
    console.error('[Max] MAX_LLM_MODE=api but ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }
  console.log(`[Max] LLM mode: ${mode}${mode === 'cli' ? ' (Claude Code subscription subprocess)' : ' (Anthropic API)'}`);
  const topicIdx = args.indexOf('--topic');
  const topic = topicIdx !== -1 ? args[topicIdx + 1] : undefined;
  const result = await engageMedium({
    claudeApiKey: apiKey,
    dataDir,
    dryRun: args.includes('--dry-run'),
    verify: args.includes('--verify'),
    topic,
  });
  console.log('[Max] medium-engage complete:', JSON.stringify(result, null, 2));
}

/**
 * Substack Notes engagement — like and reply to other writers' Notes.
 *
 * Parallel to medium-engage. Anti-detection-first: conservative caps, scroll-based
 * browsing, Claude-generated replies that reference note content.
 *
 * Usage:
 *   node dist/index.js --mode substack-engage --dry-run     (first-run DOM dump)
 *   node dist/index.js --mode substack-engage               (live run)
 *   node dist/index.js --mode substack-engage --verify      (1-note smoke test)
 *
 * Requires Brave logged into substack.com and (in CLI mode) Claude Code subscription.
 */
async function substackEngage() {
  const { engageSubstack } = await import('./publish/opentabs/substack-engage.js');
  const dataDir = process.env.MAX_DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
  const mode = (process.env.MAX_LLM_MODE ?? 'cli').toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (mode === 'api' && !apiKey) {
    console.error('[Max] MAX_LLM_MODE=api but ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }
  console.log(`[Max] LLM mode: ${mode}${mode === 'cli' ? ' (Claude Code subscription subprocess)' : ' (Anthropic API)'}`);
  // Auto-reply is off by default — Substack shadow-moderates new accounts.
  // Enable via SUBSTACK_AUTO_REPLY=1 env var OR --auto-reply flag.
  const autoReply = process.env.SUBSTACK_AUTO_REPLY === '1' || args.includes('--auto-reply');
  const result = await engageSubstack({
    claudeApiKey: apiKey,
    dataDir,
    dryRun: args.includes('--dry-run'),
    verify: args.includes('--verify'),
    autoReply,
  });
  console.log('[Max] substack-engage complete:', JSON.stringify(result, null, 2));
}

/**
 * Trigger-based social posting across Twitter, Reddit, HN, and Medium.
 *
 * Usage:
 *   node dist/index.js --mode social-post                  (Twitter only, auto-post)
 *   node dist/index.js --mode social-post --reddit         (+ Reddit human-submit)
 *   node dist/index.js --mode social-post --hn             (+ HN human-submit)
 *   node dist/index.js --mode social-post --medium         (+ Medium human-assisted publish)
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
      medium: args.includes('--medium'),
      substack: args.includes('--substack'),
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

/**
 * Smoke test: posts a story to Medium via OpenTabs.
 *
 * Usage:
 *   node dist/index.js --mode social-test-medium           (dry run: fill editor only)
 *   node dist/index.js --mode social-test-medium --submit  (auto-publish end-to-end)
 */
async function socialTestMedium() {
  const { postToMedium } = await import('./publish/opentabs/medium.js');
  const shouldSubmit = args.includes('--submit');
  const date = new Date().toISOString().split('T')[0];
  console.log(`[Max] Medium smoke test: ${shouldSubmit ? 'auto-publish' : 'dry run (fill only)'}`);
  const result = await postToMedium({
    title: `Automation smoke test — ${date}`,
    body: `This is a smoke test post generated by Max on ${date}. You can delete this.`,
    dryRun: !shouldSubmit,
  });
  console.log(`[Max] Medium smoke test done. Tab ID: ${result.tabId}. URL: ${result.submittedUrl}`);
}

/**
 * Publish a custom article to Medium from a JSON file.
 *
 * Usage:
 *   node dist/index.js --mode publish-medium --file /path/to/article.json
 *   node dist/index.js --mode publish-medium --file /path/to/article.json --dry-run
 *
 * JSON format: { "title": "...", "body": "..." }
 */
async function publishMediumCustom() {
  const { postToMedium } = await import('./publish/opentabs/medium.js');
  const fileArgIdx = args.indexOf('--file');
  if (fileArgIdx === -1 || !args[fileArgIdx + 1]) {
    console.error('[Max] publish-medium requires --file <path-to-json>');
    process.exit(1);
  }
  const filePath = args[fileArgIdx + 1];
  const raw = readFileSync(filePath, 'utf-8');
  const article = JSON.parse(raw) as { title: string; body: string };
  if (!article.title || !article.body) {
    console.error('[Max] Article JSON must have "title" and "body" fields');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const shouldSubmit = args.includes('--submit');
  // Default: fill editor + wait for human review (safe). --submit: fully automated. --dry-run: fill only.
  const waitForHuman = !shouldSubmit && !dryRun;
  console.log(`[Max] Publishing to Medium: "${article.title.slice(0, 60)}" [${dryRun ? 'dry-run' : shouldSubmit ? 'auto-submit' : 'human-review'}]`);
  const result = await postToMedium({ title: article.title, body: article.body, dryRun, waitForHuman, humanTimeoutMs: 10 * 60_000 });
  console.log(`[Max] Done. URL: ${result.submittedUrl}`);
}

/**
 * Smoke test: posts a note to Substack Notes via OpenTabs.
 *
 * Usage:
 *   node dist/index.js --mode social-test-substack          (dry run: fill compose box only)
 *   node dist/index.js --mode social-test-substack --submit (actually posts the note)
 */
async function socialTestSubstack() {
  const { postSubstackNote } = await import('./publish/opentabs/substack.js');
  const shouldSubmit = args.includes('--submit');
  const text = `Automation smoke test — ${new Date().toISOString().split('T')[0]} (ignore this)`;
  console.log(`[Max] Substack smoke test: ${shouldSubmit ? 'REAL NOTE' : 'dry run (compose fill only)'}`);
  const result = await postSubstackNote({ text, dryRun: !shouldSubmit });
  console.log(`[Max] Substack smoke test done. Tab ID: ${result.tabId}. URL: ${result.url}`);
}

/**
 * Publish a Substack newsletter from a JSON file (mirrors the publish-medium workflow).
 * User fills the editor via automation, then reviews + publishes manually.
 *
 * Usage:
 *   node dist/index.js --mode publish-substack --file /path/to/article.json
 *   node dist/index.js --mode publish-substack --file /path/to/article.json --dry-run
 *
 * JSON format: { "title": "...", "body": "..." }
 * Tip: reuse the same JSON file as publish-medium to cross-post the same article.
 */
async function publishSubstack() {
  const { postSubstackNewsletter } = await import('./publish/opentabs/substack.js');
  const fileArgIdx = args.indexOf('--file');
  if (fileArgIdx === -1 || !args[fileArgIdx + 1]) {
    console.error('[Max] publish-substack requires --file <path-to-json>');
    process.exit(1);
  }
  const filePath = args[fileArgIdx + 1];
  const raw = readFileSync(filePath, 'utf-8');
  const article = JSON.parse(raw) as { title: string; body: string };
  if (!article.title || !article.body) {
    console.error('[Max] Article JSON must have "title" and "body" fields');
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  console.log(`[Max] Publishing to Substack: "${article.title.slice(0, 60)}"`);
  const result = await postSubstackNewsletter({
    title: article.title,
    body: article.body,
    dryRun,
    waitForHuman: true,
    humanTimeoutMs: 10 * 60_000,
  });
  console.log(`[Max] Done. URL: ${result.submittedUrl}`);
}

async function main() {
  // Set MAX_DATA_DIR so claude.ts's call counter can find the data dir from any cwd.
  if (!process.env.MAX_DATA_DIR) {
    try {
      const cfg = loadConfig();
      process.env.MAX_DATA_DIR = cfg.dataDir;
    } catch {
      // loadConfig can fail (missing non-LLM secrets) — fall back to relative ./data.
      process.env.MAX_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
    }
  }

  try {
    switch (mode) {
      case 'daily':
        await daily();
        break;
      case 'weekly':
        await weekly();
        break;
      case 'weekly-data':
        await weeklyData();
        break;
      case 'dashboard':
        await dashboard();
        break;
      case 'read-daily':
        await readDaily();
        break;
      case 'fetch-trends':
        await fetchTrends();
        break;
      case 'fetch-news':
        await fetchNews();
        break;
      case 'react':
        await react();
        break;
      case 'collect-engagement-local':
        await collectEngagementLocal();
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
      case 'social-test-medium':
        await socialTestMedium();
        break;
      case 'publish-medium':
        await publishMediumCustom();
        break;
      case 'social-test-substack':
        await socialTestSubstack();
        break;
      case 'publish-substack':
        await publishSubstack();
        break;
      case 'social-post':
        await socialPost();
        break;
      case 'social-engage':
        await socialEngage();
        break;
      case 'medium-engage':
        await mediumEngage();
        break;
      case 'substack-engage':
        await substackEngage();
        break;
      default:
        console.error(`Unknown mode: ${mode}. Use --mode daily|weekly|weekly-data|dashboard|read-daily|fetch-trends|fetch-news|react|collect-engagement-local|post|generate-week|social-test-hn|social-test-reddit|social-test-twitter|social-post|social-engage|medium-engage|substack-engage|social-test-medium|social-test-substack|publish-substack`);
        process.exit(1);
    }
  } catch (err) {
    console.error('[Max] Fatal error:', err);
    process.exit(1);
  }
}

main();
