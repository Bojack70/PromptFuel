/**
 * Weekly Brain — aggregates the week's data, evaluates hypotheses,
 * generates a reflection via Gemini, and sends a weekly digest email.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MaxConfig } from '../config.js';
import type { DaySnapshot } from '../analytics/collector.js';
import { loadHistory } from '../content/history.js';
import { loadExperiments } from '../experiments/tracker.js';
import { evaluateWeek, type WeeklyEvaluation } from '../experiments/evaluator.js';
import { generateWeeklyCalendar } from '../content/calendar.js';
import { getStage } from '../content/scheduler.js';
import { generateContent } from '../content/gemini.js';
import { sendEmail } from '../reports/email.js';
import { generateDrafts } from './drafts.js';

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function loadWeekSnapshots(dataDir: string, weekStart: string): DaySnapshot[] {
  const snapshotsDir = join(dataDir, 'snapshots');
  if (!existsSync(snapshotsDir)) return [];

  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  return readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(snapshotsDir, f), 'utf-8')) as DaySnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is DaySnapshot => {
      if (!s) return false;
      const d = new Date(s.date + 'T00:00:00Z');
      return d >= start && d < end;
    });
}

function loadPrevWeekSnapshots(dataDir: string, weekStart: string): DaySnapshot[] {
  const start = new Date(weekStart + 'T00:00:00Z');
  const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
  return loadWeekSnapshots(dataDir, prevStart.toISOString().split('T')[0]);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function delta(n: number): string {
  if (n > 0) return `<span style="color:#22c55e">+${fmt(n)}</span>`;
  if (n < 0) return `<span style="color:#ef4444">${fmt(n)}</span>`;
  return `<span style="color:#6b7280">±0</span>`;
}

interface WeekSummary {
  stars: { current: number; delta: number };
  forks: { current: number; delta: number };
  views: { total: number; uniques: number };
  clones: { total: number; uniques: number };
  npmDownloadsWeek: number;
  prevNpmDownloadsWeek: number;
  postsCount: { twitter: number; devto: number };
}

function summarizeWeek(snapshots: DaySnapshot[], prevSnapshots: DaySnapshot[], dataDir: string, weekStart: string): WeekSummary {
  const latest = snapshots[snapshots.length - 1];
  const prevLatest = prevSnapshots[prevSnapshots.length - 1];

  const totalViews = snapshots.reduce((s, snap) => s + snap.github.views.count, 0);
  const uniqueViews = snapshots.reduce((s, snap) => s + snap.github.views.uniques, 0);
  const totalClones = snapshots.reduce((s, snap) => s + snap.github.clones.count, 0);
  const uniqueClones = snapshots.reduce((s, snap) => s + snap.github.clones.uniques, 0);

  const npmWeek = latest
    ? Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0)
    : 0;
  const prevNpmWeek = prevLatest
    ? Object.values(prevLatest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0)
    : 0;

  const history = loadHistory(dataDir);
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekPosts = history.filter((e) => {
    const d = new Date(e.date + 'T00:00:00Z');
    return d >= start && d < end;
  });

  return {
    stars: {
      current: latest?.github.stars ?? 0,
      delta: latest && prevLatest ? latest.github.stars - prevLatest.github.stars : 0,
    },
    forks: {
      current: latest?.github.forks ?? 0,
      delta: latest && prevLatest ? latest.github.forks - prevLatest.github.forks : 0,
    },
    views: { total: totalViews, uniques: uniqueViews },
    clones: { total: totalClones, uniques: uniqueClones },
    npmDownloadsWeek: npmWeek,
    prevNpmDownloadsWeek: prevNpmWeek,
    postsCount: {
      twitter: weekPosts.filter((e) => e.platform === 'twitter').length,
      devto: weekPosts.filter((e) => e.platform === 'devto').length,
    },
  };
}

async function generateReflection(
  geminiApiKey: string,
  summary: WeekSummary,
  evaluation: WeeklyEvaluation,
): Promise<string> {
  const prompt = `You are Max, the autonomous growth agent for PromptFuel (an open-source token optimization toolkit). You're writing a brief weekly reflection for the founder.

METRICS THIS WEEK:
- GitHub: ${fmt(summary.stars.current)} stars (${summary.stars.delta >= 0 ? '+' : ''}${summary.stars.delta} this week), ${fmt(summary.forks.current)} forks
- Views: ${fmt(summary.views.total)} (${fmt(summary.views.uniques)} unique)
- npm downloads: ${fmt(summary.npmDownloadsWeek)} this week (prev week: ${fmt(summary.prevNpmDownloadsWeek)})
- Content posted: ${summary.postsCount.twitter} tweets, ${summary.postsCount.devto} Dev.to articles

EXPERIMENT RESULTS:
${evaluation.results.map((r) => `- ${r.name}: ${r.verdict} — ${r.summary}`).join('\n')}
${evaluation.topCategory ? `- Best performing category: ${evaluation.topCategory}` : ''}
${evaluation.weakCategory ? `- Weakest category: ${evaluation.weakCategory}` : ''}

Write a 3-5 sentence reflection covering: what went well, what to improve, and one specific strategy recommendation for next week. Be concise and data-driven. No fluff.`;

  return generateContent(geminiApiKey, prompt, { temperature: 0.7, maxTokens: 500 });
}

function buildWeeklyDigest(
  weekStart: string,
  summary: WeekSummary,
  evaluation: WeeklyEvaluation,
  reflection: string,
  stage: string,
): { subject: string; html: string } {
  const npmDelta = summary.npmDownloadsWeek - summary.prevNpmDownloadsWeek;

  const hypothesisRows = evaluation.results
    .map((r) => {
      const color = r.verdict === 'supported' ? '#22c55e' : r.verdict === 'refuted' ? '#ef4444' : '#6b7280';
      const icon = r.verdict === 'supported' ? 'Y' : r.verdict === 'refuted' ? 'N' : '?';
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${r.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:${color};font-weight:bold">${icon}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${r.summary}</td>
      </tr>`;
    })
    .join('\n');

  const subject = `[Max Weekly] ${weekStart} — ${fmt(summary.stars.current)} stars ${delta(summary.stars.delta).replace(/<[^>]+>/g, '')} | ${fmt(summary.npmDownloadsWeek)} downloads`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">

<h1 style="font-size:20px;margin-bottom:4px">Max Weekly Digest</h1>
<p style="color:#6b7280;margin-top:0">Week of ${weekStart} · Stage: <strong>${stage}</strong></p>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px">Week-over-Week</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr><td style="padding:6px 0">Stars</td><td style="text-align:right"><strong>${fmt(summary.stars.current)}</strong> ${delta(summary.stars.delta)}</td></tr>
  <tr><td style="padding:6px 0">Forks</td><td style="text-align:right"><strong>${fmt(summary.forks.current)}</strong> ${delta(summary.forks.delta)}</td></tr>
  <tr><td style="padding:6px 0">Views</td><td style="text-align:right"><strong>${fmt(summary.views.total)}</strong> (${fmt(summary.views.uniques)} unique)</td></tr>
  <tr><td style="padding:6px 0">Clones</td><td style="text-align:right"><strong>${fmt(summary.clones.total)}</strong> (${fmt(summary.clones.uniques)} unique)</td></tr>
  <tr><td style="padding:6px 0">npm downloads</td><td style="text-align:right"><strong>${fmt(summary.npmDownloadsWeek)}</strong> ${delta(npmDelta)}</td></tr>
</table>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Content Output</h2>
<p style="font-size:14px">${summary.postsCount.twitter} tweets · ${summary.postsCount.devto} Dev.to articles · ${evaluation.totalExperiments} quality evaluations</p>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Experiment Results</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr style="background:#f9fafb">
    <th style="padding:6px 8px;text-align:left">Hypothesis</th>
    <th style="padding:6px 8px;text-align:center">Result</th>
    <th style="padding:6px 8px;text-align:left">Detail</th>
  </tr>
  ${hypothesisRows}
</table>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Reflection</h2>
<div style="padding:12px;background:#f0f9ff;border-radius:8px;border-left:3px solid #3b82f6;font-size:14px;line-height:1.6">
${reflection}
</div>

<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
<p style="font-size:12px;color:#9ca3af;text-align:center">Max Agent · PromptFuel · Weekly Brain</p>

</body>
</html>`;

  return { subject, html };
}

export async function weeklyReflection(config: MaxConfig): Promise<void> {
  const now = new Date();
  const weekStart = getMonday(now);
  // Actually reflect on the *previous* week (we run Monday morning)
  const prevMonday = new Date(new Date(weekStart + 'T00:00:00Z').getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  console.log(`[Max] Weekly reflection for week of ${prevMonday}`);

  // 1. Aggregate snapshots
  const snapshots = loadWeekSnapshots(config.dataDir, prevMonday);
  const prevSnapshots = loadPrevWeekSnapshots(config.dataDir, prevMonday);
  console.log(`[Max] Loaded ${snapshots.length} snapshots (prev week: ${prevSnapshots.length})`);

  // 2. Evaluate experiments
  const evaluation = evaluateWeek(config.dataDir, prevMonday);
  console.log(`[Max] Evaluated ${evaluation.totalExperiments} experiments, ${evaluation.results.length} hypotheses`);

  for (const r of evaluation.results) {
    console.log(`[Max]   ${r.name}: ${r.verdict} — ${r.summary}`);
  }

  // 3. Summarize week
  const stateFile = join(config.dataDir, 'state.json');
  const state = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf-8'))
    : { warmupStartDate: '2026-03-24' };
  const stage = getStage(state.warmupStartDate);
  const summary = summarizeWeek(snapshots, prevSnapshots, config.dataDir, prevMonday);

  // 4. Generate Gemini reflection
  console.log('[Max] Generating reflection...');
  const reflection = await generateReflection(config.geminiApiKey, summary, evaluation);
  console.log(`[Max] Reflection: ${reflection.slice(0, 100)}...`);

  // 5. Build and send weekly email
  const { subject, html } = buildWeeklyDigest(prevMonday, summary, evaluation, reflection, stage);
  const emailResult = await sendEmail(config.resendApiKey, {
    to: config.reportEmail,
    subject,
    html,
  });
  console.log(`[Max] Weekly digest sent: ${emailResult.id}`);

  // 6. Generate next week's content calendar
  console.log('[Max] Generating next week calendar...');
  await generateWeeklyCalendar(config.geminiApiKey, stage, config.dataDir);

  // 7. Generate Reddit/HN drafts
  console.log('[Max] Generating platform drafts...');
  const latest = snapshots[snapshots.length - 1];
  if (latest) {
    const totalWeek = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0);
    const totalMonth = Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastMonth, 0);
    const history = loadHistory(config.dataDir);
    const ctx = {
      stars: latest.github.stars,
      forks: latest.github.forks,
      npmDownloadsWeek: totalWeek,
      npmDownloadsMonth: totalMonth,
      deltaStars: summary.stars.delta,
      recentPosts: history.slice(-5).map((e) =>
        e.platform === 'twitter' ? e.content : (e.title ?? e.content.slice(0, 80)),
      ),
    };
    await generateDrafts(config, ctx);
  }

  // 8. Update state
  state.lastWeeklyRun = new Date().toISOString();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(stateFile, JSON.stringify(state, null, 2));

  console.log('[Max] Weekly brain complete.');
}
