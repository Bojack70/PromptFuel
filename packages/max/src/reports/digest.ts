/**
 * Daily digest — formats KPIs + content activity into an HTML email.
 */

import type { DaySnapshot } from '../analytics/collector.js';
import type { ContentLogEntry } from '../content/history.js';
import type { WarmupStage } from '../content/scheduler.js';

interface DigestInput {
  snapshot: DaySnapshot;
  stage: WarmupStage;
  todaysPosts: ContentLogEntry[];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function delta(n: number): string {
  if (n > 0) return `<span style="color:#22c55e">+${fmt(n)}</span>`;
  if (n < 0) return `<span style="color:#ef4444">${fmt(n)}</span>`;
  return `<span style="color:#6b7280">±0</span>`;
}

export function buildDailyDigest(input: DigestInput): { subject: string; html: string } {
  const { snapshot, stage, todaysPosts } = input;
  const s = snapshot;

  const totalDayDownloads = Object.values(s.npm.packages).reduce((sum, p) => sum + p.downloadsLastDay, 0);
  const totalWeekDownloads = Object.values(s.npm.packages).reduce((sum, p) => sum + p.downloadsLastWeek, 0);
  const totalMonthDownloads = Object.values(s.npm.packages).reduce((sum, p) => sum + p.downloadsLastMonth, 0);

  // Package breakdown rows
  const pkgRows = Object.entries(s.npm.packages)
    .map(([name, d]) =>
      `<tr>
        <td style="padding:4px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px">${name}</td>
        <td style="padding:4px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(d.downloadsLastDay)}</td>
        <td style="padding:4px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(d.downloadsLastWeek)}</td>
        <td style="padding:4px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(d.downloadsLastMonth)}</td>
      </tr>`)
    .join('\n');

  // Content activity
  const contentSection = todaysPosts.length > 0
    ? todaysPosts.map((p) => {
        if (p.platform === 'twitter') {
          return `<div style="margin:8px 0;padding:12px;background:#f0f9ff;border-radius:8px;border-left:3px solid #1d9bf0">
            <strong>🐦 Tweet</strong> (${p.category})<br>
            <span style="font-size:14px">${p.content}</span>
          </div>`;
        }
        return `<div style="margin:8px 0;padding:12px;background:#f0fdf4;border-radius:8px;border-left:3px solid #22c55e">
          <strong>📝 Dev.to</strong> (${p.category})<br>
          <a href="${p.postUrl}" style="font-size:14px;color:#2563eb">${p.title}</a>
        </div>`;
      }).join('\n')
    : '<p style="color:#6b7280">No content posted today.</p>';

  const subject = `[Max] ${s.date} — ${fmt(s.github.stars)}⭐ ${delta(s.deltas.stars).replace(/<[^>]+>/g, '')} | ${fmt(totalDayDownloads)} downloads`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">

<h1 style="font-size:20px;margin-bottom:4px">Max Daily Digest</h1>
<p style="color:#6b7280;margin-top:0">${s.date} · Stage: <strong>${stage}</strong></p>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px">GitHub</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr>
    <td style="padding:6px 0">Stars</td>
    <td style="text-align:right"><strong>${fmt(s.github.stars)}</strong> ${delta(s.deltas.stars)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0">Forks</td>
    <td style="text-align:right"><strong>${fmt(s.github.forks)}</strong> ${delta(s.deltas.forks)}</td>
  </tr>
  <tr>
    <td style="padding:6px 0">Views</td>
    <td style="text-align:right"><strong>${fmt(s.github.views.count)}</strong> (${fmt(s.github.views.uniques)} unique)</td>
  </tr>
  <tr>
    <td style="padding:6px 0">Clones</td>
    <td style="text-align:right"><strong>${fmt(s.github.clones.count)}</strong> (${fmt(s.github.clones.uniques)} unique)</td>
  </tr>
</table>

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">npm Downloads</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <tr style="background:#f9fafb">
    <th style="padding:6px 12px;text-align:left">Package</th>
    <th style="padding:6px 12px;text-align:right">Day</th>
    <th style="padding:6px 12px;text-align:right">Week</th>
    <th style="padding:6px 12px;text-align:right">Month</th>
  </tr>
  ${pkgRows}
  <tr style="font-weight:bold;background:#f9fafb">
    <td style="padding:6px 12px">Total</td>
    <td style="padding:6px 12px;text-align:right">${fmt(totalDayDownloads)}</td>
    <td style="padding:6px 12px;text-align:right">${fmt(totalWeekDownloads)}</td>
    <td style="padding:6px 12px;text-align:right">${fmt(totalMonthDownloads)}</td>
  </tr>
</table>

${s.github.referrers.length > 0 ? `
<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Top Referrers</h2>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  ${s.github.referrers.slice(0, 5).map((r) =>
    `<tr><td style="padding:4px 0">${r.referrer}</td><td style="text-align:right">${fmt(r.count)} (${fmt(r.uniques)} unique)</td></tr>`
  ).join('\n')}
</table>` : ''}

<h2 style="font-size:16px;border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-top:24px">Content Activity</h2>
${contentSection}

<hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb">
<p style="font-size:12px;color:#9ca3af;text-align:center">Max Agent · PromptFuel · Autonomous Growth</p>

</body>
</html>`;

  return { subject, html };
}
