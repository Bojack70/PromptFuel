/**
 * Static HTML dashboard generator.
 * Reads snapshots, content log, and experiments to produce a self-contained index.html.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DaySnapshot } from '../analytics/collector.js';
import type { ContentLogEntry } from '../content/history.js';
import type { ExperimentEntry } from '../experiments/tracker.js';

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

export function generateDashboard(dataDir: string): void {
  const snapshots = loadAllSnapshots(dataDir);
  const contentLog = loadContentLog(dataDir);
  const experiments = loadExperimentData(dataDir);

  const outDir = join(dataDir, 'dashboard');
  mkdirSync(outDir, { recursive: true });

  // Prepare chart data
  const dates = snapshots.map((s) => s.date);
  const stars = snapshots.map((s) => s.github.stars);
  const forks = snapshots.map((s) => s.github.forks);
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
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; }
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
  .badge-twitter { background: #1d4ed8; color: #fff; }
  .badge-devto { background: #166534; color: #fff; }
  .badge-pass { background: #166534; color: #fff; }
  .badge-fail { background: #991b1b; color: #fff; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<h1>Max Agent Dashboard</h1>
<p class="subtitle">Generated ${new Date().toISOString().split('T')[0]} · ${snapshots.length} snapshots · ${contentLog.length} posts · ${experiments.length} experiments</p>

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
    <div><span class="value">${contentLog.length}</span><span class="delta flat">${contentLog.filter((e) => e.platform === 'twitter').length} tweets · ${contentLog.filter((e) => e.platform === 'devto').length} articles</span></div>
  </div>
  <div class="card">
    <h3>Avg Quality Score</h3>
    <div><span class="value">${experiments.length > 0 ? (experiments.reduce((s, e) => s + e.qualityScores.average, 0) / experiments.length).toFixed(1) : '—'}</span><span class="delta flat">/10</span></div>
  </div>
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
