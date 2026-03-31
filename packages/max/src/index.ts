/**
 * Max — Autonomous AI Growth Agent for PromptFuel
 * Entry point: --mode daily | weekly | dashboard
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { collectAndSave, type DaySnapshot } from './analytics/collector.js';
import { loadHistory, appendHistory, type ContentLogEntry } from './content/history.js';
import { planToday, type DailyPlan } from './content/scheduler.js';
import { generateContent } from './content/gemini.js';
import { twitterPrompt, devtoPrompt, tagsForCategory, type PromptContext } from './content/templates.js';
import { generateTweet, postTweet } from './publish/twitter.js';
import { postArticle, parseArticle } from './publish/devto.js';
import { reviewTweet, reviewArticle } from './content/quality.js';
import { loadCalendar, isCalendarCurrent, getTodayFromCalendar, generateWeeklyCalendar } from './content/calendar.js';
import { sendEmail } from './reports/email.js';
import { buildDailyDigest } from './reports/digest.js';
import { recordExperiment } from './experiments/tracker.js';
import { weeklyReflection } from './brain/weekly.js';
import { generateDashboard } from './dashboard/generator.js';

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
    e.platform === 'twitter' ? e.content : (e.title ?? e.content.slice(0, 80)),
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

  // ── Phase 1: Content pipeline ──
  console.log('\n[Max] Starting content pipeline...');
  const state = loadState(config.dataDir);
  const history = loadHistory(config.dataDir);

  // Generate or load weekly content calendar
  let calendar = loadCalendar(config.dataDir);
  if (!isCalendarCurrent(calendar)) {
    const { getStage } = await import('./content/scheduler.js');
    const stage = getStage((state as any).warmupStartDate);
    calendar = await generateWeeklyCalendar(config.geminiApiKey, stage, config.dataDir);
  }
  const calendarDay = calendar ? getTodayFromCalendar(calendar) : null;
  if (calendarDay) {
    console.log(`[Max] Calendar: Twitter=${calendarDay.twitter ?? 'skip'} Dev.to=${calendarDay.devto ?? 'skip'}`);
  }

  const plan = planToday(state as any, history, calendarDay);

  console.log(`[Max] Stage: ${plan.stage} | Twitter: ${plan.twitter?.category ?? 'skip'} | Dev.to: ${plan.devto?.category ?? 'skip'}`);

  const ctx = buildPromptContext(snapshot, history);

  // ── Twitter ──
  if (plan.twitter) {
    try {
      console.log(`[Max] Generating ${plan.twitter.category} tweet...`);
      const prompt = twitterPrompt(plan.twitter.category, ctx);
      let tweetText = await generateTweet(prompt, config.geminiApiKey);
      let wasRetried = false;

      // Quality gate: score → regenerate once if < 7 → skip if still < 7
      let quality = await reviewTweet(tweetText, config.geminiApiKey);
      console.log(`[Max] Tweet quality: ${quality.score.average}/10 (A:${quality.score.authenticity} V:${quality.score.value} Ac:${quality.score.accuracy} E:${quality.score.engagement})`);

      if (!quality.passed) {
        console.log(`[Max] Below threshold — regenerating with feedback: ${quality.score.feedback}`);
        tweetText = await generateTweet(
          `${prompt}\n\nIMPORTANT FEEDBACK FROM REVIEWER: ${quality.score.feedback}. Address this in your tweet.`,
          config.geminiApiKey,
        );
        quality = await reviewTweet(tweetText, config.geminiApiKey);
        wasRetried = true;
        console.log(`[Max] Retry quality: ${quality.score.average}/10`);
      }

      // Record experiment
      recordExperiment(config.dataDir, {
        date: today(),
        timestamp: new Date().toISOString(),
        platform: 'twitter',
        category: plan.twitter.category,
        qualityScores: quality.score,
        passed: quality.passed,
        retried: wasRetried,
      });

      if (quality.passed) {
        const result = await postTweet(tweetText, config);
        appendHistory(config.dataDir, {
          date: today(),
          timestamp: new Date().toISOString(),
          platform: 'twitter',
          category: plan.twitter.category,
          content: result.text,
          postId: result.id,
        });
        console.log(`[Max] Tweet posted (${result.text.length} chars): ${result.id}`);
      } else {
        console.warn(`[Max] Tweet rejected after retry (${quality.score.average}/10) — skipping`);
      }
    } catch (err) {
      console.error('[Max] Twitter post failed:', err);
    }
  }

  // ── Dev.to ──
  if (plan.devto) {
    try {
      console.log(`[Max] Generating ${plan.devto.category} article...`);
      const prompt = devtoPrompt(plan.devto.category, ctx);
      let markdown = await generateContent(config.geminiApiKey, prompt, {
        temperature: 0.8,
        maxTokens: 4096,
      });

      let { title, body } = parseArticle(markdown);
      const tags = tagsForCategory(plan.devto.category);
      let wasRetried = false;

      // Quality gate
      let quality = await reviewArticle(title, body, config.geminiApiKey);
      console.log(`[Max] Article quality: ${quality.score.average}/10 (A:${quality.score.authenticity} V:${quality.score.value} Ac:${quality.score.accuracy} E:${quality.score.engagement})`);

      if (!quality.passed) {
        console.log(`[Max] Below threshold — regenerating with feedback: ${quality.score.feedback}`);
        markdown = await generateContent(config.geminiApiKey,
          `${prompt}\n\nIMPORTANT FEEDBACK FROM REVIEWER: ${quality.score.feedback}. Address this issue while keeping the article high quality.`,
          { temperature: 0.8, maxTokens: 4096 },
        );
        ({ title, body } = parseArticle(markdown));
        quality = await reviewArticle(title, body, config.geminiApiKey);
        wasRetried = true;
        console.log(`[Max] Retry quality: ${quality.score.average}/10`);
      }

      // Record experiment
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
  state.accountStatus = { twitter: plan.stage, devto: plan.stage };
  saveState(config.dataDir, state);

  console.log('[Max] Daily run complete.');
}

async function weekly() {
  const config = loadConfig();
  await weeklyReflection(config);
}

async function dashboard() {
  const config = loadConfig();
  console.log('[Max] Generating dashboard...');
  generateDashboard(config.dataDir);
  console.log('[Max] Dashboard complete.');
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
      default:
        console.error(`Unknown mode: ${mode}. Use --mode daily|weekly|dashboard`);
        process.exit(1);
    }
  } catch (err) {
    console.error('[Max] Fatal error:', err);
    process.exit(1);
  }
}

main();
