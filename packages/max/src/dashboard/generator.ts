/**
 * Static HTML dashboard generator.
 * Reads snapshots, content log, experiments, engagement, correlations,
 * and strategy log to produce a self-contained index.html.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DaySnapshot } from '../analytics/collector.js';
import type { ContentLogEntry } from '../content/history.js';
import type { ExperimentEntry } from '../experiments/tracker.js';
import { loadEngagement, type EngagementSnapshot, type BlueskyEngagement, type DevtoEngagement } from '../analytics/engagement.js';
import { loadCorrelationReport, type CorrelationReport } from '../brain/correlation.js';
import { loadStrategyLog, type StrategyDecision } from '../brain/strategy.js';
import { getStage, DEVTO_DAYS, SUBSTACK_DAYS, MEDIUM_ENGAGE_DAYS } from '../content/scheduler.js';
import { loadReadingLog } from '../analytics/reader.js';
import { loadReadingInsights } from '../brain/reading-insights.js';
import { loadTrendInsights } from '../brain/trend-insights.js';
import { loadTrendsLog } from '../analytics/trends.js';
import { loadNotebook } from '../brain/notebook.js';
import { loadOpinions } from '../content/opinions.js';
import { loadLocalEngagement } from '../analytics/engagement-local.js';

function loadAllSnapshots(dataDir: string): DaySnapshot[] {
  const dir = join(dataDir, 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as DaySnapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is DaySnapshot => s !== null);
}

function loadContentLog(dataDir: string): ContentLogEntry[] {
  const file = join(dataDir, 'content-log.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function loadExperimentData(dataDir: string): ExperimentEntry[] {
  const file = join(dataDir, 'experiments.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function buildEngagementSection(dataDir: string): string {
  const snapshots = loadEngagement(dataDir);
  if (snapshots.length === 0) return '';

  // Aggregate latest engagement per post (dedupe by postId, keep latest)
  const latestByPost = new Map<string, { platform: string; metrics: any }>();
  for (const snapshot of snapshots) {
    for (const post of snapshot.posts) {
      latestByPost.set(post.postId, { platform: post.platform, metrics: post.metrics });
    }
  }

  let blueskyLikes = 0, blueskyReposts = 0, blueskyCount = 0;
  let devtoViews = 0, devtoReactions = 0, devtoCount = 0;

  for (const { platform, metrics } of latestByPost.values()) {
    if (platform === 'bluesky') {
      const m = metrics as BlueskyEngagement;
      blueskyLikes += m.likes;
      blueskyReposts += m.reposts;
      blueskyCount++;
    } else {
      const m = metrics as DevtoEngagement;
      devtoViews += m.views;
      devtoReactions += m.reactions;
      devtoCount++;
    }
  }

  return `
  <div class="card">
    <h3>Bluesky Engagement</h3>
    <div><span class="value">${blueskyCount > 0 ? (blueskyLikes / blueskyCount).toFixed(1) : '—'}</span><span class="delta flat"> avg likes/post (${blueskyCount} posts)</span></div>
  </div>
  <div class="card">
    <h3>Dev.to Engagement</h3>
    <div><span class="value">${devtoCount > 0 ? fmt(Math.round(devtoViews / devtoCount)) : '—'}</span><span class="delta flat"> avg views/article (${devtoCount} articles)</span></div>
  </div>`;
}

function buildCorrelationSection(dataDir: string): string {
  const report = loadCorrelationReport(dataDir);
  if (!report || report.correlations.length === 0) return '';

  const rows = report.correlations
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((c, i) => {
      const engText = c.platform === 'devto'
        ? `${c.engagement.views ?? 0} views, ${c.engagement.reactions ?? 0} reactions`
        : `${c.engagement.likes ?? 0} likes, ${c.engagement.reposts ?? 0} reposts`;
      const highlight = i < 3 ? ' style="background:#1e3a2f"' : '';
      return `<tr${highlight}>
        <td>${c.date}</td>
        <td><span class="badge badge-${c.platform}">${c.platform}</span></td>
        <td>${c.category}</td>
        <td>${engText}</td>
        <td>${c.metricDeltas.starsDelta > 0 ? '+' : ''}${c.metricDeltas.starsDelta}</td>
        <td style="font-weight:bold">${c.score}</td>
      </tr>`;
    })
    .join('\n');

  const insightsHtml = report.insights.length > 0
    ? `<div style="margin-top:12px;padding:12px;background:#1e293b;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;line-height:1.6">${report.insights.map((i) => `<div>• ${i}</div>`).join('')}</div>`
    : '';

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Content Correlation (impact score)</h2>
  <table>
    <tr><th>Date</th><th>Platform</th><th>Category</th><th>Engagement</th><th>Stars +</th><th>Score</th></tr>
    ${rows}
  </table>
  ${insightsHtml}
</div>`;
}

function buildStrategySection(dataDir: string): string {
  const log = loadStrategyLog(dataDir);
  if (log.length === 0) return '';

  const cards = log.slice(-6).reverse().map((d) => {
    const verdictColor = d.outcome
      ? d.outcome.verdict === 'positive' ? '#22c55e' : d.outcome.verdict === 'negative' ? '#ef4444' : '#94a3b8'
      : '#f59e0b';
    const verdictLabel = d.outcome ? d.outcome.verdict.toUpperCase() : 'ACTIVE';

    return `<div style="background:#1e293b;border-radius:8px;padding:16px;border-left:3px solid ${verdictColor}">
      <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">Week of ${d.weekOf} · <span style="color:${verdictColor};font-weight:bold">${verdictLabel}</span></div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">${d.decision}</div>
      <div style="font-size:13px;color:#94a3b8">${d.rationale}</div>
      ${d.outcome ? `<div style="font-size:13px;margin-top:8px;color:${verdictColor}">${d.outcome.summary}</div>` : ''}
    </div>`;
  }).join('\n');

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Strategy Decisions</h2>
  <div style="display:grid;gap:12px">${cards}</div>
</div>`;
}

/**
 * Content Intelligence — visibility into what feeds each content prompt:
 * reader corpus, trend themes, notebook entries, opinion coverage.
 * Each block renders whatever data is available; missing data just skips.
 */
function buildContentIntelligenceSection(dataDir: string): string {
  const readingLog = loadReadingLog(dataDir);
  const readingInsights = loadReadingInsights(dataDir);
  const trendsLog = loadTrendsLog(dataDir);
  const trendInsights = loadTrendInsights(dataDir);
  const notebook = loadNotebook(dataDir);
  const opinions = loadOpinions(dataDir);

  // All empty? render nothing.
  if (
    readingLog.entries.length === 0
    && trendsLog.entries.length === 0
    && notebook.entries.length === 0
    && opinions.length === 0
  ) return '';

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Reader corpus: entries per bucket (last 7 days + total)
  const bucketCounts: Record<string, { recent: number; total: number }> = {};
  for (const e of readingLog.entries) {
    const b = bucketCounts[e.bucket] ?? { recent: 0, total: 0 };
    b.total++;
    if (e.date >= cutoffStr) b.recent++;
    bucketCounts[e.bucket] = b;
  }
  const readerCards = Object.entries(bucketCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([bucket, { recent, total }]) =>
      `<div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:10px 14px">
        <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${bucket}</div>
        <div style="font-size:18px;font-weight:700">${fmt(recent)} <span style="font-size:12px;color:#6b7280;font-weight:400">/ ${fmt(total)} total</span></div>
      </div>`,
    ).join('');

  // Trends: hot themes + avoid list
  const themesHtml = trendInsights && trendInsights.hotThemes.length > 0
    ? `<div>
        <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Hot Themes (${trendInsights.weekOf}, ${trendInsights.headlinesAnalysed} headlines)</div>
        ${trendInsights.hotThemes.map((t) => `<span style="display:inline-block;background:#312e81;color:#c7d2fe;border-radius:999px;padding:4px 10px;margin:3px 4px 3px 0;font-size:12px">${t}</span>`).join('')}
        ${trendInsights.avoidList.length > 0 ? `<div style="margin-top:10px"><div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Over-saturated — avoid</div>${trendInsights.avoidList.map((t) => `<span style="display:inline-block;background:#7f1d1d;color:#fecaca;border-radius:999px;padding:4px 10px;margin:3px 4px 3px 0;font-size:12px">${t}</span>`).join('')}</div>` : ''}
      </div>`
    : `<div style="color:#6b7280;font-size:13px">No trend synthesis yet (runs weekly — will appear after first Monday pregen with ≥10 HN headlines). Raw log: ${trendsLog.entries.length} headlines captured.</div>`;

  // Notebook: last 5 entries
  const recentNotebook = notebook.entries.slice(-5).reverse();
  const notebookHtml = recentNotebook.length > 0
    ? recentNotebook.map((n) =>
        `<div style="background:#0f172a;border-left:3px solid #60a5fa;border-radius:4px;padding:10px 14px;margin-bottom:8px">
          <div style="font-size:14px;color:#e2e8f0;line-height:1.4">${n.observation}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px">${n.date} · ${n.source}${n.weekOf ? ` · week of ${n.weekOf}` : ''}</div>
        </div>`,
      ).join('')
    : `<div style="color:#6b7280;font-size:13px">Notebook empty — first entries arrive on the next weekly brain run.</div>`;

  // Opinions: heat coverage by bucket
  const opinionCoverage: Record<string, { moderate: number; spicy: number }> = {};
  for (const o of opinions) {
    for (const b of o.buckets) {
      const cov = opinionCoverage[b] ?? { moderate: 0, spicy: 0 };
      if (o.heat === 'spicy') cov.spicy++;
      else cov.moderate++;
      opinionCoverage[b] = cov;
    }
  }
  const opinionRows = Object.entries(opinionCoverage)
    .sort((a, b) => (b[1].moderate + b[1].spicy) - (a[1].moderate + a[1].spicy))
    .map(([bucket, { moderate, spicy }]) =>
      `<tr>
        <td>${bucket}</td>
        <td style="text-align:right">${moderate}</td>
        <td style="text-align:right;color:#fb923c">${spicy}</td>
        <td style="text-align:right;font-weight:700">${moderate + spicy}</td>
      </tr>`,
    ).join('');

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Content Intelligence</h2>
  <p style="color:#94a3b8;font-size:13px;margin-bottom:16px">What feeds each content prompt: accumulated reading corpus, this week's hot themes, recent notebook observations, Nate's worldview coverage.</p>

  <div style="margin-bottom:20px">
    <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:10px">Reader Corpus <span style="font-size:12px;color:#6b7280;font-weight:400">— last 7 days / total</span></h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${readerCards || '<div style="color:#6b7280;font-size:13px">No articles read yet — --mode read-daily kicks off in next CI run.</div>'}</div>
  </div>

  <div style="margin-bottom:20px">
    <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:10px">Trend Themes</h3>
    ${themesHtml}
  </div>

  <div style="margin-bottom:20px">
    <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:10px">Notebook — recent observations</h3>
    ${notebookHtml}
  </div>

  <div>
    <h3 style="font-size:14px;color:#e2e8f0;margin-bottom:10px">Nate's Opinions — ${opinions.length} stances, coverage by bucket</h3>
    <table>
      <tr><th>Bucket</th><th style="text-align:right">Moderate</th><th style="text-align:right;color:#fb923c">Spicy</th><th style="text-align:right">Total</th></tr>
      ${opinionRows || '<tr><td colspan="4" style="color:#6b7280">No opinions loaded.</td></tr>'}
    </table>
  </div>
</div>`;
}

/**
 * Local engagement — Medium/Substack/Twitter numbers from the OpenTabs scrapers.
 * Renders the latest snapshot; falls back to an explainer if the corpus is empty.
 */
function buildLocalEngagementSection(dataDir: string): string {
  const log = loadLocalEngagement(dataDir);
  if (log.snapshots.length === 0) {
    return `
<div class="chart-card" style="margin-top:24px">
  <h2>Cross-Platform Engagement (Medium / Substack / Twitter)</h2>
  <p style="color:#94a3b8;font-size:13px">Not collected yet. Runs locally (needs OpenTabs + logged-in Brave) during the Monday <code>--mode weekly</code> pass, or via <code>--mode collect-engagement-local</code>.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:8px">Bluesky + Dev.to are tracked via API in CI daily — see Engagement section above. Medium/Substack/Twitter have no public metrics APIs, so they need the browser-automation pass.</p>
</div>`;
  }

  const latest = log.snapshots[log.snapshots.length - 1];
  const cards: string[] = [];

  if (latest.medium) {
    cards.push(`<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Medium</div>
      <div style="font-size:22px;font-weight:700">${latest.medium.followers !== null ? fmt(latest.medium.followers) : '?'}<span style="font-size:12px;color:#6b7280;font-weight:400;margin-left:6px">followers</span></div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">${latest.medium.articles.length} articles${latest.medium.totalViews !== null ? ` · ${fmt(latest.medium.totalViews)} views` : ''}${latest.medium.totalReads !== null ? ` · ${fmt(latest.medium.totalReads)} reads` : ''}</div>
    </div>`);
  }
  if (latest.substack) {
    cards.push(`<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Substack</div>
      <div style="font-size:22px;font-weight:700">${latest.substack.subscribers !== null ? fmt(latest.substack.subscribers) : '?'}<span style="font-size:12px;color:#6b7280;font-weight:400;margin-left:6px">subscribers</span></div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">${latest.substack.posts.length} posts · ${latest.substack.notes.length} notes tracked</div>
    </div>`);
  }
  if (latest.twitter) {
    cards.push(`<div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Twitter / X</div>
      <div style="font-size:22px;font-weight:700">${latest.twitter.followers !== null ? fmt(latest.twitter.followers) : '?'}<span style="font-size:12px;color:#6b7280;font-weight:400;margin-left:6px">followers</span></div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">${latest.twitter.tweets.length} recent tweets tracked</div>
    </div>`);
  }

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Cross-Platform Engagement (Medium / Substack / Twitter)</h2>
  <p style="color:#94a3b8;font-size:12px;margin-bottom:12px">Latest snapshot: ${latest.collectedAt}. Collected locally via OpenTabs scrapers — selectors may need periodic calibration.</p>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${cards.join('')}</div>
</div>`;
}

function buildWeekCalendar(dataDir: string): string {
  const calFile = join(dataDir, 'calendar.json');
  const preFile = join(dataDir, 'pregenerated-content.json');
  if (!existsSync(calFile)) return '';

  type CalendarDay = { date: string; bluesky?: string; devto?: string | null; blueskyAngle?: string; devtoAngle?: string };
  type PrePost = { date: string; bluesky?: { text: string }; twitter?: { text: string; category: string }; devto?: { title: string }; medium?: { title: string }; substack?: { note: string } };

  const cal = JSON.parse(readFileSync(calFile, 'utf-8')) as { days: CalendarDay[] };
  const pre: { posts: PrePost[] } = existsSync(preFile)
    ? JSON.parse(readFileSync(preFile, 'utf-8'))
    : { posts: [] };
  const preMap = Object.fromEntries(pre.posts.map((p) => [p.date, p]));

  const stage = getStage();
  const todayStr = new Date().toISOString().split('T')[0];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const rows = cal.days.map((day) => {
    const utcDay = new Date(day.date + 'T12:00:00Z').getUTCDay();
    const p = preMap[day.date];
    const isToday = day.date === todayStr;
    const isPast = day.date < todayStr;
    // Calendar entry overrides stage-based day rules (e.g. weekly plan may put Dev.to on Monday)
    const isDevtoDay = DEVTO_DAYS[stage].includes(utcDay) || !!day.devto;
    const isSubstackDay = SUBSTACK_DAYS[stage].includes(utcDay) || !!day.devto;
    const isEngageDay = MEDIUM_ENGAGE_DAYS.includes(utcDay);
    const dayName = DAY_NAMES[utcDay];
    const bg = isToday ? '#1e3a5f' : isPast ? '#0f172a' : '#1e293b';
    const border = isToday ? '2px solid #3b82f6' : '1px solid #334155';

    const items: string[] = [];

    // Bluesky — always, AUTO
    items.push(`<div style="margin:3px 0"><span style="background:#0085ff;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">AUTO</span> <strong>Bluesky</strong>${p?.bluesky ? ` <span style="color:#94a3b8;font-size:11px">— ${p.bluesky.text.slice(0, 60)}…</span>` : ''}</div>`);

    // Dev.to — stage-aware, AUTO
    if (isDevtoDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#166534;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">AUTO</span> <strong>Dev.to</strong>${p?.devto ? ` <span style="color:#94a3b8;font-size:11px">— ${p.devto.title.slice(0, 60)}…</span>` : ''}</div>`);
    }

    // Twitter + Medium — same days as Dev.to, MANUAL (same command runs both)
    // Twitter gets the short bluesky-style text; Medium gets its own long-form article.
    if (isDevtoDay) {
      const twitterText = p?.twitter?.text ?? p?.bluesky?.text ?? '';
      const twitterCat = p?.twitter?.category ?? '';
      const twitterPreview = twitterText ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">🐦 <span style="color:#60a5fa;font-size:10px">[${twitterCat}]</span> ${twitterText.slice(0, 60)}…</div>` : '';
      const mediumPreview = p?.medium ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">📝 ${p.medium.title.slice(0, 60)}…</div>` : '';
      items.push(`<div style="margin:3px 0"><span style="background:#f59e0b;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Twitter + Medium</strong>${twitterPreview}${mediumPreview}<code style="font-size:10px;color:#94a3b8;margin-top:3px;display:block">--mode social-post --medium</code></div>`);
    }

    // Substack Note — same days as Dev.to, MANUAL
    if (isSubstackDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#f59e0b;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Substack Note</strong>${p?.substack ? ` <span style="color:#94a3b8;font-size:11px">— ${p.substack.note.slice(0, 50)}…</span>` : ''}<br><code style="font-size:10px;color:#94a3b8">--mode social-test-substack --submit</code></div>`);
    }

    // Medium Engage — Mon/Wed/Fri, MANUAL
    if (isEngageDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#7c3aed;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Medium Engage</strong> <span style="color:#94a3b8;font-size:11px">— clap + comment</span><br><code style="font-size:10px;color:#94a3b8">--mode medium-engage --topic programming</code></div>`);
    }

    return `<div style="background:${bg};border:${border};border-radius:10px;padding:14px;min-width:180px">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:${isToday ? '#93c5fd' : '#e2e8f0'}">${dayName} ${day.date}${isToday ? ' <span style="font-size:10px;background:#3b82f6;color:#fff;padding:1px 6px;border-radius:3px">TODAY</span>' : isPast ? ' <span style="font-size:10px;color:#475569">past</span>' : ''}</div>
      ${items.join('')}
    </div>`;
  }).join('');

  return `
<div style="margin-bottom:24px">
  <h2 style="font-size:16px;margin-bottom:12px">This Week</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
    ${rows}
  </div>
</div>`;
}

export function generateDashboard(dataDir: string): void {
  const snapshots = loadAllSnapshots(dataDir);
  const contentLog = loadContentLog(dataDir);
  const experiments = loadExperimentData(dataDir);

  const outDir = join(dataDir, 'dashboard');
  mkdirSync(outDir, { recursive: true });

  // Prepare chart data
  const dates = snapshots.map((s) => s.date);
  const stars = snapshots.map((s) => s.github.stars);
  const downloads = snapshots.map((s) =>
    Object.values(s.npm.packages).reduce((sum, p) => sum + p.downloadsLastDay, 0),
  );
  const views = snapshots.map((s) => s.github.views.count);

  // Category quality scores
  const categoryScores: Record<string, number[]> = {};
  for (const exp of experiments) {
    if (!categoryScores[exp.category]) categoryScores[exp.category] = [];
    categoryScores[exp.category].push(exp.qualityScores.average);
  }
  const categoryAvgs = Object.entries(categoryScores).map(([cat, scores]) => ({
    category: cat,
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    count: scores.length,
  })).sort((a, b) => b.avg - a.avg);

  // Recent content (last 20)
  const recentContent = contentLog.slice(-20).reverse();

  // Latest snapshot
  const latest = snapshots[snapshots.length - 1];
  const totalWeekDownloads = latest
    ? Object.values(latest.npm.packages).reduce((s, p) => s + p.downloadsLastWeek, 0)
    : 0;

  // New sections
  const weekCalendar = buildWeekCalendar(dataDir);
  const engagementCards = buildEngagementSection(dataDir);
  const correlationSection = buildCorrelationSection(dataDir);
  const strategySection = buildStrategySection(dataDir);
  const contentIntelligenceSection = buildContentIntelligenceSection(dataDir);
  const localEngagementSection = buildLocalEngagementSection(dataDir);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Max Agent Dashboard — PromptFuel</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #94a3b8; margin-bottom: 24px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; }
  .card h3 { font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .card .value { font-size: 28px; font-weight: 700; }
  .card .delta { font-size: 14px; margin-left: 8px; }
  .delta.up { color: #22c55e; }
  .delta.down { color: #ef4444; }
  .delta.flat { color: #6b7280; }
  .chart-card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .chart-card h2 { font-size: 16px; margin-bottom: 16px; }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  canvas { max-height: 260px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px; color: #94a3b8; border-bottom: 2px solid #334155; }
  td { padding: 8px; border-bottom: 1px solid #334155; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .badge-bluesky { background: #0085ff; color: #fff; }
  .badge-devto { background: #166534; color: #fff; }
  .badge-reddit { background: #ff4500; color: #fff; }
  .badge-pass { background: #166534; color: #fff; }
  .badge-fail { background: #991b1b; color: #fff; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<h1>Max Agent Dashboard</h1>
<p class="subtitle">Generated ${new Date().toISOString().split('T')[0]} · ${snapshots.length} snapshots · ${contentLog.length} posts · ${experiments.length} experiments</p>

${weekCalendar}

<div class="grid">
  <div class="card">
    <h3>GitHub Stars</h3>
    <div><span class="value">${latest ? fmt(latest.github.stars) : '—'}</span>${latest ? `<span class="delta ${latest.deltas.stars > 0 ? 'up' : latest.deltas.stars < 0 ? 'down' : 'flat'}">${latest.deltas.stars > 0 ? '+' : ''}${latest.deltas.stars}</span>` : ''}</div>
  </div>
  <div class="card">
    <h3>npm Downloads (week)</h3>
    <div><span class="value">${fmt(totalWeekDownloads)}</span></div>
  </div>
  <div class="card">
    <h3>Content Posted</h3>
    <div><span class="value">${contentLog.length}</span><span class="delta flat">${contentLog.filter((e) => e.platform === 'bluesky').length} posts · ${contentLog.filter((e) => e.platform === 'devto').length} articles · ${contentLog.filter((e) => e.platform === 'reddit').length} reddit</span></div>
  </div>
  <div class="card">
    <h3>Avg Quality Score</h3>
    <div><span class="value">${experiments.length > 0 ? (experiments.reduce((s, e) => s + e.qualityScores.average, 0) / experiments.length).toFixed(1) : '—'}</span><span class="delta flat">/10</span></div>
  </div>
  ${engagementCards}
</div>

<div class="chart-row">
  <div class="chart-card">
    <h2>Stars Over Time</h2>
    <canvas id="starsChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>Daily npm Downloads</h2>
    <canvas id="downloadsChart"></canvas>
  </div>
</div>

<div class="chart-row">
  <div class="chart-card">
    <h2>Daily Views</h2>
    <canvas id="viewsChart"></canvas>
  </div>
  <div class="chart-card">
    <h2>Quality by Category</h2>
    <canvas id="qualityChart"></canvas>
  </div>
</div>

<div class="chart-card">
  <h2>Recent Content</h2>
  <table>
    <tr><th>Date</th><th>Platform</th><th>Category</th><th>Content</th></tr>
    ${recentContent.map((e) => `<tr>
      <td>${e.date}</td>
      <td><span class="badge badge-${e.platform}">${e.platform}</span></td>
      <td>${e.category}</td>
      <td>${e.platform === 'devto' && e.postUrl ? `<a href="${e.postUrl}" style="color:#60a5fa">${e.title || e.content.slice(0, 60)}</a>` : e.content.slice(0, 80)}</td>
    </tr>`).join('\n')}
  </table>
</div>

${experiments.length > 0 ? `
<div class="chart-card" style="margin-top:24px">
  <h2>Experiment Log (last 20)</h2>
  <table>
    <tr><th>Date</th><th>Platform</th><th>Category</th><th>Score</th><th>Status</th><th>Retried</th></tr>
    ${experiments.slice(-20).reverse().map((e) => `<tr>
      <td>${e.date}</td>
      <td><span class="badge badge-${e.platform}">${e.platform}</span></td>
      <td>${e.category}</td>
      <td>${e.qualityScores.average.toFixed(1)}</td>
      <td><span class="badge badge-${e.passed ? 'pass' : 'fail'}">${e.passed ? 'pass' : 'fail'}</span></td>
      <td>${e.retried ? 'yes' : 'no'}</td>
    </tr>`).join('\n')}
  </table>
</div>` : ''}

${categoryAvgs.length > 0 ? `
<div class="chart-card" style="margin-top:24px">
  <h2>Category Performance</h2>
  <table>
    <tr><th>Category</th><th>Avg Score</th><th>Samples</th></tr>
    ${categoryAvgs.map((c) => `<tr>
      <td>${c.category}</td>
      <td>${c.avg.toFixed(1)}</td>
      <td>${c.count}</td>
    </tr>`).join('\n')}
  </table>
</div>` : ''}

${correlationSection}
${strategySection}
${contentIntelligenceSection}
${localEngagementSection}

<script>
const dates = ${JSON.stringify(dates)};
const chartOpts = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#94a3b8', maxTicksLimit: 10 }, grid: { color: '#334155' } },
    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
  }
};

new Chart(document.getElementById('starsChart'), {
  type: 'line',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(stars)}, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 }] },
  options: chartOpts
});

new Chart(document.getElementById('downloadsChart'), {
  type: 'bar',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(downloads)}, backgroundColor: '#3b82f6' }] },
  options: chartOpts
});

new Chart(document.getElementById('viewsChart'), {
  type: 'line',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(views)}, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3 }] },
  options: chartOpts
});

${categoryAvgs.length > 0 ? `
new Chart(document.getElementById('qualityChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(categoryAvgs.map((c) => c.category))},
    datasets: [{
      data: ${JSON.stringify(categoryAvgs.map((c) => Math.round(c.avg * 10) / 10))},
      backgroundColor: ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899']
    }]
  },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 10 } } }
});
` : `
new Chart(document.getElementById('qualityChart'), {
  type: 'bar',
  data: { labels: ['No data yet'], datasets: [{ data: [0], backgroundColor: '#334155' }] },
  options: chartOpts
});
`}
</script>

</body>
</html>`;

  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`[Max] Dashboard generated: ${join(outDir, 'index.html')}`);
}
