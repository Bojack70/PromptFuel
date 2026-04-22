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
import { loadNewsLog } from '../analytics/news.js';
import { loadNewsAngles } from '../brain/news-triage.js';

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
      const highlight = i < 3 ? ' style="background:#f0fdf4"' : '';
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
    ? `<div style="margin-top:12px;padding:12px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;line-height:1.6;color:#111827">${report.insights.map((i) => `<div>• ${i}</div>`).join('')}</div>`
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

    return `<div style="background:#f9fafb;border-radius:8px;padding:16px;border-left:3px solid ${verdictColor}">
      <div style="font-size:12px;color:#6b7280;margin-bottom:4px">Week of ${d.weekOf} · <span style="color:${verdictColor};font-weight:bold">${verdictLabel}</span></div>
      <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:4px">${d.decision}</div>
      <div style="font-size:13px;color:#6b7280">${d.rationale}</div>
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
  const newsLog = loadNewsLog(dataDir);
  const newsAngles = loadNewsAngles(dataDir);

  // All empty? render nothing.
  if (
    readingLog.entries.length === 0
    && trendsLog.entries.length === 0
    && notebook.entries.length === 0
    && opinions.length === 0
    && newsLog.entries.length === 0
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
      `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px">
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${bucket}</div>
        <div style="font-size:18px;font-weight:700;color:#111827">${fmt(recent)} <span style="font-size:12px;color:#9ca3af;font-weight:400">/ ${fmt(total)} total</span></div>
      </div>`,
    ).join('');

  // Trends: hot themes + avoid list
  const themesHtml = trendInsights && trendInsights.hotThemes.length > 0
    ? `<div>
        <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Hot Themes (${trendInsights.weekOf}, ${trendInsights.headlinesAnalysed} headlines)</div>
        ${trendInsights.hotThemes.map((t) => `<span style="display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:4px 10px;margin:3px 4px 3px 0;font-size:12px">${t}</span>`).join('')}
        ${trendInsights.avoidList.length > 0 ? `<div style="margin-top:10px"><div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Over-saturated — avoid</div>${trendInsights.avoidList.map((t) => `<span style="display:inline-block;background:#fee2e2;color:#dc2626;border-radius:999px;padding:4px 10px;margin:3px 4px 3px 0;font-size:12px">${t}</span>`).join('')}</div>` : ''}
      </div>`
    : `<div style="color:#6b7280;font-size:13px">No trend synthesis yet (runs weekly — will appear after first Monday pregen with ≥10 HN headlines). Raw log: ${trendsLog.entries.length} headlines captured.</div>`;

  // Notebook: last 5 entries
  const recentNotebook = notebook.entries.slice(-5).reverse();
  const notebookHtml = recentNotebook.length > 0
    ? recentNotebook.map((n) =>
        `<div style="background:#f0f7ff;border-left:3px solid #3b82f6;border-radius:4px;padding:10px 14px;margin-bottom:8px">
          <div style="font-size:14px;color:#111827;line-height:1.4">${n.observation}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:4px">${n.date} · ${n.source}${n.weekOf ? ` · week of ${n.weekOf}` : ''}</div>
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

  // News: this week's eligible angles + ineligible events, plus corpus size
  const cutoff7 = new Date();
  cutoff7.setUTCDate(cutoff7.getUTCDate() - 7);
  const cutoff7Str = cutoff7.toISOString().split('T')[0];
  const newsRecent = newsLog.entries.filter((e) => e.date >= cutoff7Str).length;
  const newsPerSource: Record<string, number> = {};
  for (const e of newsLog.entries.filter((e) => e.date >= cutoff7Str)) {
    newsPerSource[e.source] = (newsPerSource[e.source] ?? 0) + 1;
  }
  const newsHtml = newsAngles && newsAngles.eligibleAngles.length > 0
    ? `<div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:8px">
          ${newsRecent} news entries last 7d (${Object.entries(newsPerSource).map(([s, n]) => `${s}:${n}`).join(' · ')}) · triaged ${newsAngles.generatedAt.split('T')[0]}
        </div>
        <div style="font-size:12px;color:#16a34a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600">Eligible angles this week</div>
        ${newsAngles.eligibleAngles.slice(0, 5).map((a) =>
          `<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:10px 12px;margin-bottom:8px;border-radius:4px">
            <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px">${a.event}</div>
            <div style="font-size:12px;color:#6b7280"><span style="color:#16a34a">${a.angle}</span> · ${a.salience} salience — ${a.hook}</div>
          </div>`).join('')}
        ${newsAngles.ineligible.length > 0 ? `
          <div style="font-size:12px;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;margin:12px 0 6px;font-weight:600">Ineligible — skip (needs firsthand testing)</div>
          ${newsAngles.ineligible.slice(0, 3).map((e) =>
            `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:8px 12px;margin-bottom:6px;border-radius:4px;font-size:12px">
              <span style="color:#dc2626">${e.event}</span> — <span style="color:#6b7280">${e.reason}</span>
            </div>`).join('')}
        ` : ''}
      </div>`
    : `<div style="color:#9ca3af;font-size:13px">${newsRecent > 0 ? `${newsRecent} news entries collected (${Object.entries(newsPerSource).map(([s, n]) => `${s}:${n}`).join(' · ')}). Triage runs Monday in weekly brain.` : 'No news collected yet — starts in next CI run via --mode fetch-news.'}</div>`;

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Content Intelligence</h2>
  <p style="color:#6b7280;font-size:13px;margin-bottom:16px">What feeds each content prompt: accumulated reading corpus, this week's hot themes, news events Nate can honestly react to, recent notebook observations, Nate's worldview coverage.</p>

  <div style="margin-bottom:20px">
    <h3 style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Reader Corpus <span style="font-size:12px;color:#9ca3af;font-weight:400">— last 7 days / total</span></h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${readerCards || '<div style="color:#9ca3af;font-size:13px">No articles read yet — --mode read-daily kicks off in next CI run.</div>'}</div>
  </div>

  <div style="margin-bottom:20px">
    <h3 style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Breaking News — eligible angles <span style="font-size:12px;color:#9ca3af;font-weight:400">— what Nate can honestly post about</span></h3>
    ${newsHtml}
  </div>

  <div style="margin-bottom:20px">
    <h3 style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Trend Themes</h3>
    ${themesHtml}
  </div>

  <div style="margin-bottom:20px">
    <h3 style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Notebook — recent observations</h3>
    ${notebookHtml}
  </div>

  <div>
    <h3 style="font-size:13px;font-weight:600;color:#111827;margin-bottom:10px">Nate's Opinions — ${opinions.length} stances, coverage by bucket</h3>
    <table>
      <tr><th>Bucket</th><th style="text-align:right">Moderate</th><th style="text-align:right;color:#f97316">Spicy</th><th style="text-align:right">Total</th></tr>
      ${opinionRows || '<tr><td colspan="4" style="color:#9ca3af">No opinions loaded.</td></tr>'}
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
  <p style="color:#6b7280;font-size:13px">Not collected yet. Runs locally (needs OpenTabs + logged-in Brave) during the Monday <code>--mode weekly</code> pass, or via <code>--mode collect-engagement-local</code>.</p>
  <p style="color:#9ca3af;font-size:12px;margin-top:8px">Bluesky + Dev.to are tracked via API in CI daily — see Engagement section above. Medium/Substack/Twitter have no public metrics APIs, so they need the browser-automation pass.</p>
</div>`;
  }

  const latest = log.snapshots[log.snapshots.length - 1];
  const cards: string[] = [];

  if (latest.medium) {
    cards.push(`<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Medium</div>
      <div style="font-size:22px;font-weight:700;color:#111827">${latest.medium.followers !== null ? fmt(latest.medium.followers) : '?'}<span style="font-size:12px;color:#9ca3af;font-weight:400;margin-left:6px">followers</span></div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px">${latest.medium.articles.length} articles${latest.medium.totalViews !== null ? ` · ${fmt(latest.medium.totalViews)} views` : ''}${latest.medium.totalReads !== null ? ` · ${fmt(latest.medium.totalReads)} reads` : ''}</div>
    </div>`);
  }
  if (latest.substack) {
    cards.push(`<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Substack</div>
      <div style="font-size:22px;font-weight:700;color:#111827">${latest.substack.subscribers !== null ? fmt(latest.substack.subscribers) : '?'}<span style="font-size:12px;color:#9ca3af;font-weight:400;margin-left:6px">subscribers</span></div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px">${latest.substack.posts.length} posts · ${latest.substack.notes.length} notes tracked</div>
    </div>`);
  }
  if (latest.twitter) {
    cards.push(`<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px">
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Twitter / X</div>
      <div style="font-size:22px;font-weight:700;color:#111827">${latest.twitter.followers !== null ? fmt(latest.twitter.followers) : '?'}<span style="font-size:12px;color:#9ca3af;font-weight:400;margin-left:6px">followers</span></div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px">${latest.twitter.tweets.length} recent tweets tracked</div>
    </div>`);
  }

  return `
<div class="chart-card" style="margin-top:24px">
  <h2>Cross-Platform Engagement (Medium / Substack / Twitter)</h2>
  <p style="color:#6b7280;font-size:12px;margin-bottom:12px">Latest snapshot: ${latest.collectedAt}. Collected locally via OpenTabs scrapers — selectors may need periodic calibration.</p>
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
    const bg = isToday ? '#eff6ff' : isPast ? '#f9fafb' : '#ffffff';
    const border = isToday ? '2px solid #3b82f6' : '1px solid #e5e7eb';

    const items: string[] = [];

    // Bluesky — always, AUTO
    items.push(`<div style="margin:3px 0"><span style="background:#1d4ed8;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">AUTO</span> <strong>Bluesky</strong>${p?.bluesky ? ` <span style="color:#6b7280;font-size:11px">— ${p.bluesky.text.slice(0, 60)}…</span>` : ''}</div>`);

    // Dev.to — stage-aware, AUTO
    if (isDevtoDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#15803d;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">AUTO</span> <strong>Dev.to</strong>${p?.devto ? ` <span style="color:#6b7280;font-size:11px">— ${p.devto.title.slice(0, 60)}…</span>` : ''}</div>`);
    }

    // Twitter + Medium — same days as Dev.to, MANUAL (same command runs both)
    // Twitter gets the short bluesky-style text; Medium gets its own long-form article.
    if (isDevtoDay) {
      const twitterText = p?.twitter?.text ?? p?.bluesky?.text ?? '';
      const twitterCat = p?.twitter?.category ?? '';
      const twitterPreview = twitterText ? `<div style="color:#6b7280;font-size:11px;margin-top:2px">🐦 <span style="color:#2563eb;font-size:10px">[${twitterCat}]</span> ${twitterText.slice(0, 60)}…</div>` : '';
      const mediumPreview = p?.medium ? `<div style="color:#6b7280;font-size:11px;margin-top:2px">📝 ${p.medium.title.slice(0, 60)}…</div>` : '';
      items.push(`<div style="margin:3px 0"><span style="background:#d97706;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Twitter + Medium</strong>${twitterPreview}${mediumPreview}<code style="font-size:10px;color:#6b7280;margin-top:3px;display:block">--mode social-post --medium</code></div>`);
    }

    // Substack Note — same days as Dev.to, MANUAL
    if (isSubstackDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#d97706;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Substack Note</strong>${p?.substack ? ` <span style="color:#6b7280;font-size:11px">— ${p.substack.note.slice(0, 50)}…</span>` : ''}<br><code style="font-size:10px;color:#6b7280">--mode social-test-substack --submit</code></div>`);
    }

    // Medium Engage — Mon/Wed/Fri, MANUAL
    if (isEngageDay) {
      items.push(`<div style="margin:3px 0"><span style="background:#7c3aed;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px">MANUAL</span> <strong>Medium Engage</strong> <span style="color:#6b7280;font-size:11px">— clap + comment</span><br><code style="font-size:10px;color:#6b7280">--mode medium-engage --topic programming</code></div>`);
    }

    return `<div style="background:${bg};border:${border};border-radius:10px;padding:14px;min-width:180px">
      <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:${isToday ? '#2563eb' : '#111827'}">${dayName} ${day.date}${isToday ? ' <span style="font-size:10px;background:#3b82f6;color:#fff;padding:1px 6px;border-radius:3px">TODAY</span>' : isPast ? ' <span style="font-size:10px;color:#9ca3af">past</span>' : ''}</div>
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

/**
 * Today's Actions — prominent card at top of dashboard answering
 * "what do I run right now?" Covers:
 *   • AUTO items (what CI is handling today at 06:00 UTC)
 *   • MANUAL items from today's calendar (content posting, engagement)
 *   • Monday-specific weekly brain + local engagement collection
 *   • First-run scraper calibration (shown only until engagement-local.json exists)
 */
function buildTodayActionsSection(dataDir: string): string {
  const calFile = join(dataDir, 'calendar.json');
  const preFile = join(dataDir, 'pregenerated-content.json');
  const engagementLocalFile = join(dataDir, 'engagement-local.json');
  if (!existsSync(calFile)) return '';

  type CalendarDay = { date: string; bluesky?: string; devto?: string | null };
  type PrePost = { date: string; bluesky?: { text: string }; twitter?: { text: string; category: string }; devto?: { title: string }; medium?: { title: string }; substack?: { note: string } };

  const cal = JSON.parse(readFileSync(calFile, 'utf-8')) as { days: CalendarDay[] };
  const pre: { posts: PrePost[] } = existsSync(preFile)
    ? JSON.parse(readFileSync(preFile, 'utf-8'))
    : { posts: [] };
  const preMap = Object.fromEntries(pre.posts.map((p) => [p.date, p]));

  const todayStr = new Date().toISOString().split('T')[0];
  const todayCal = cal.days.find((d) => d.date === todayStr);
  const utcDay = new Date(todayStr + 'T12:00:00Z').getUTCDay();
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = DAY_NAMES[utcDay];
  const p = preMap[todayStr];

  const stage = getStage();
  const isDevtoDay = DEVTO_DAYS[stage].includes(utcDay) || !!todayCal?.devto;
  const isSubstackDay = SUBSTACK_DAYS[stage].includes(utcDay) || !!todayCal?.devto;
  const isEngageDay = MEDIUM_ENGAGE_DAYS.includes(utcDay);
  const isMonday = utcDay === 1;

  // --- AUTO items (informational — what CI is doing) ---
  const autoLines: string[] = [];
  autoLines.push(`<strong>Bluesky</strong> ${p?.bluesky ? `<span style="color:#6b7280;font-size:12px">— "${p.bluesky.text.slice(0, 70)}…"</span>` : ''}`);
  if (isDevtoDay) autoLines.push(`<strong>Dev.to</strong> ${p?.devto ? `<span style="color:#6b7280;font-size:12px">— "${p.devto.title.slice(0, 70)}…"</span>` : ''}`);

  // --- MANUAL content items (things user runs today) ---
  const manualItems: Array<{ label: string; preview?: string; cmd: string }> = [];
  if (isDevtoDay && p?.medium) {
    const twitterText = p.twitter?.text ?? p.bluesky?.text ?? '';
    const twitterCat = p.twitter?.category ?? '';
    manualItems.push({
      label: 'Twitter + Medium',
      preview: `🐦${twitterCat ? ` [${twitterCat}]` : ''} ${twitterText.slice(0, 55)}… | 📝 ${p.medium.title.slice(0, 55)}…`,
      cmd: 'cd packages/max && node dist/index.js --mode social-post --medium',
    });
  }
  if (isSubstackDay && p?.substack) {
    manualItems.push({
      label: 'Substack Note',
      preview: p.substack.note.slice(0, 80) + '…',
      cmd: 'cd packages/max && node dist/index.js --mode social-test-substack --submit',
    });
  }
  if (isEngageDay) {
    manualItems.push({
      label: 'Medium Engage (clap + comment on 3 articles)',
      cmd: 'cd packages/max && node dist/index.js --mode medium-engage --topic programming',
    });
  }

  // --- MONDAY — weekly brain ---
  const mondayItems: Array<{ label: string; cmd: string; note?: string }> = [];
  if (isMonday) {
    mondayItems.push({
      label: 'Weekly brain (reflection + calendar + content pre-generation)',
      cmd: 'cd packages/max && npx pnpm build && node dist/index.js --mode weekly',
      note: 'Runs locally via your Claude Code subscription. Includes local engagement collection (Medium/Substack/Twitter) if OpenTabs is running.',
    });
  }

  // --- FIRST-RUN calibration (only if scrapers haven't run yet) ---
  const firstRunItems: Array<{ label: string; cmd: string; note?: string }> = [];
  if (!existsSync(engagementLocalFile)) {
    firstRunItems.push({
      label: 'Calibrate Medium scraper',
      cmd: 'cd packages/max && node dist/index.js --mode collect-engagement-local --only medium --dry-run',
      note: 'Dumps medium DOM to data/dom-dumps/ so selectors can be verified before first live run.',
    });
    firstRunItems.push({
      label: 'Calibrate Substack scraper',
      cmd: 'cd packages/max && node dist/index.js --mode collect-engagement-local --only substack --dry-run',
    });
    firstRunItems.push({
      label: 'Calibrate Twitter scraper',
      cmd: 'cd packages/max && node dist/index.js --mode collect-engagement-local --only twitter --dry-run',
    });
  }

  // --- Build HTML ---
  const autoHtml = autoLines.map((l) =>
    `<li style="margin:6px 0;padding:8px 12px;background:#f0fdf4;border-radius:6px;border-left:3px solid #22c55e;list-style:none;color:#111827">
      <span style="font-size:11px;background:#22c55e;color:#fff;padding:1px 6px;border-radius:3px;margin-right:8px">AUTO</span>${l}
    </li>`).join('');

  const manualHtml = manualItems.length === 0
    ? `<li style="color:#9ca3af;list-style:none;padding:8px 12px">Nothing manual scheduled for today.</li>`
    : manualItems.map((item) =>
        `<li style="margin:6px 0;padding:10px 12px;background:#fffbeb;border-radius:6px;border-left:3px solid #f59e0b;list-style:none;color:#111827">
          <span style="font-size:11px;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;margin-right:8px">MANUAL</span>
          <strong>${item.label}</strong>${item.preview ? ` — <span style="color:#6b7280;font-size:12px">"${item.preview}"</span>` : ''}<br>
          <code style="font-size:12px;background:#f3f4f6;color:#374151;padding:4px 8px;border-radius:4px;margin-top:6px;display:inline-block">${item.cmd}</code>
        </li>`).join('');

  const mondayHtml = mondayItems.length > 0
    ? `<h3 style="font-size:11px;color:#4338ca;margin:18px 0 8px 0;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Monday — Weekly Brain</h3>
       <ul style="margin:0;padding:0">
         ${mondayItems.map((item) =>
           `<li style="margin:6px 0;padding:10px 12px;background:#f5f3ff;border-radius:6px;border-left:3px solid #818cf8;list-style:none;color:#111827">
             <span style="font-size:11px;background:#818cf8;color:#fff;padding:1px 6px;border-radius:3px;margin-right:8px">WEEKLY</span>
             <strong>${item.label}</strong><br>
             <code style="font-size:12px;background:#f3f4f6;color:#374151;padding:4px 8px;border-radius:4px;margin-top:6px;display:inline-block">${item.cmd}</code>
             ${item.note ? `<div style="font-size:12px;color:#6b7280;margin-top:6px">${item.note}</div>` : ''}
           </li>`).join('')}
       </ul>`
    : '';

  const firstRunHtml = firstRunItems.length > 0
    ? `<h3 style="font-size:11px;color:#dc2626;margin:18px 0 8px 0;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">⚙ First-Run Setup (do once)</h3>
       <p style="color:#6b7280;font-size:12px;margin-bottom:8px">These scrapers need a DOM inspection pass before first live use. Run each with OpenTabs started + Brave logged in to that platform. They write HTML dumps to <code>data/dom-dumps/</code> — share them to finalize selectors.</p>
       <ul style="margin:0;padding:0">
         ${firstRunItems.map((item) =>
           `<li style="margin:6px 0;padding:10px 12px;background:#fef2f2;border-radius:6px;border-left:3px solid #ef4444;list-style:none;color:#111827">
             <span style="font-size:11px;background:#ef4444;color:#fff;padding:1px 6px;border-radius:3px;margin-right:8px">SETUP</span>
             <strong>${item.label}</strong><br>
             <code style="font-size:12px;background:#f3f4f6;color:#374151;padding:4px 8px;border-radius:4px;margin-top:6px;display:inline-block">${item.cmd}</code>
             ${item.note ? `<div style="font-size:12px;color:#6b7280;margin-top:6px">${item.note}</div>` : ''}
           </li>`).join('')}
       </ul>`
    : '';

  // --- ON DEMAND — always visible, no dependency on state ---
  const onDemandHtml = `
<h3 style="font-size:11px;color:#2563eb;margin:18px 0 8px 0;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">On demand — when breaking news happens</h3>
<p style="color:#6b7280;font-size:12px;margin-bottom:8px">React to a specific event with a genuine take (required: --topic). Respects the honest-take rule — no quality/performance claims without firsthand testing. Outputs to stdout + <code>data/reactive-posts.json</code>; you review before publishing.</p>
<div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 12px;border-radius:6px;font-size:12px">
  <code style="display:block;background:#f3f4f6;color:#374151;padding:6px 10px;border-radius:4px;margin-bottom:4px">cd packages/max &amp;&amp; node dist/index.js --mode react --topic "your topic" --angle "your genuine take" --platform twitter</code>
  <div style="color:#6b7280">--angle is optional but recommended. --platform: twitter (default) | bluesky | medium.</div>
</div>`;

  return `
<div style="background:#ffffff;border-radius:14px;padding:22px 26px;margin-bottom:24px;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px">
    <h2 style="font-size:20px;font-weight:700;color:#111827;margin:0">Today's Actions — ${dayName}</h2>
    <div style="color:#6b7280;font-size:13px">${todayStr} · stage: <strong style="color:#111827">${stage}</strong></div>
  </div>

  <h3 style="font-size:11px;color:#16a34a;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">CI handles these at 06:00 UTC</h3>
  <ul style="margin:0 0 4px 0;padding:0">${autoHtml}</ul>

  <h3 style="font-size:11px;color:#d97706;margin:18px 0 8px 0;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">You run these today</h3>
  <ul style="margin:0;padding:0">${manualHtml}</ul>

  ${mondayHtml}
  ${firstRunHtml}
  ${onDemandHtml}
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
  const todayActions = buildTodayActionsSection(dataDir);
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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; color: #111827; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: #6b7280; margin-bottom: 24px; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .card h3 { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; font-weight: 500; }
  .card .value { font-size: 28px; font-weight: 700; color: #111827; }
  .card .delta { font-size: 14px; margin-left: 8px; }
  .delta.up { color: #16a34a; }
  .delta.down { color: #dc2626; }
  .delta.flat { color: #9ca3af; }
  .chart-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .chart-card h2 { font-size: 15px; font-weight: 600; color: #111827; margin-bottom: 16px; }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  canvas { max-height: 260px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px 10px; color: #6b7280; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .badge-bluesky { background: #dbeafe; color: #1d4ed8; }
  .badge-devto { background: #dcfce7; color: #15803d; }
  .badge-reddit { background: #fee2e2; color: #dc2626; }
  .badge-pass { background: #dcfce7; color: #15803d; }
  .badge-fail { background: #fee2e2; color: #dc2626; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<h1>Max Agent Dashboard</h1>
<p class="subtitle">Generated ${new Date().toISOString().split('T')[0]} · ${snapshots.length} snapshots · ${contentLog.length} posts · ${experiments.length} experiments</p>

${todayActions}
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
      <td>${e.platform === 'devto' && e.postUrl ? `<a href="${e.postUrl}" style="color:#2563eb">${e.title || e.content.slice(0, 60)}</a>` : e.content.slice(0, 80)}</td>
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
    x: { ticks: { color: '#6b7280', maxTicksLimit: 10 }, grid: { color: '#f3f4f6' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } }
  }
};

new Chart(document.getElementById('starsChart'), {
  type: 'line',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(stars)}, borderColor: '#111827', backgroundColor: 'rgba(17,24,39,0.06)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#111827' }] },
  options: chartOpts
});

new Chart(document.getElementById('downloadsChart'), {
  type: 'bar',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(downloads)}, backgroundColor: '#374151', borderRadius: 4 }] },
  options: chartOpts
});

new Chart(document.getElementById('viewsChart'), {
  type: 'line',
  data: { labels: dates, datasets: [{ data: ${JSON.stringify(views)}, borderColor: '#6b7280', backgroundColor: 'rgba(107,114,128,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#6b7280' }] },
  options: chartOpts
});

${categoryAvgs.length > 0 ? `
new Chart(document.getElementById('qualityChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(categoryAvgs.map((c) => c.category))},
    datasets: [{
      data: ${JSON.stringify(categoryAvgs.map((c) => Math.round(c.avg * 10) / 10))},
      backgroundColor: ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#e5e7eb']
    }]
  },
  options: { ...chartOpts, scales: { ...chartOpts.scales, y: { ...chartOpts.scales.y, min: 0, max: 10 } }, datasets: { bar: { borderRadius: 4 } } }
});
` : `
new Chart(document.getElementById('qualityChart'), {
  type: 'bar',
  data: { labels: ['No data yet'], datasets: [{ data: [0], backgroundColor: '#e5e7eb' }] },
  options: chartOpts
});
`}
</script>

</body>
</html>`;

  writeFileSync(join(outDir, 'index.html'), html);
  console.log(`[Max] Dashboard generated: ${join(outDir, 'index.html')}`);
}
