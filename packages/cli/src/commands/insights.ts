import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { calculateCost, formatCost } from '@promptfuel/core';
import { ttyWrite, writeReportFile } from '../output.js';

interface ProjectStats {
  name: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUSD: number;
}

function folderToName(folder: string): string {
  // Folder is the abs path with '/' replaced by '-', e.g. '-Users-faizan-Desktop-foo'
  // Strip home prefix and return the last meaningful segment
  const home = homedir().replace(/\//g, '-');
  let stripped = folder.startsWith(home) ? folder.slice(home.length) : folder;
  stripped = stripped.replace(/^-/, '');
  const parts = stripped.split('-').filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

export async function runInsights(): Promise<void> {
  const claudeDir = join(homedir(), '.claude', 'projects');

  if (!existsSync(claudeDir)) {
    process.stdout.write('  No Claude Code usage data found at ~/.claude/projects/\n');
    return;
  }

  const projectFolders = readdirSync(claudeDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const projects: ProjectStats[] = [];
  const modelTotals = new Map<string, { input: number; output: number; cost: number }>();
  let totalSessions = 0;

  for (const folder of projectFolders) {
    const folderPath = join(claudeDir, folder);
    const jsonlFiles = readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));

    const stats: ProjectStats = {
      name: folderToName(folder),
      sessions: jsonlFiles.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUSD: 0,
    };

    // Deduplicate by message ID — streaming sends multiple partial entries per message
    const seen = new Map<string, { input: number; output: number; cacheRead: number; model: string }>();

    for (const file of jsonlFiles) {
      try {
        const lines = readFileSync(join(folderPath, file), 'utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== 'assistant' || !entry.message?.usage) continue;
            const u = entry.message.usage;
            const msgId: string = entry.message.id ?? entry.uuid;
            if (!msgId) continue;
            // Always overwrite — last entry for a message has final token counts
            seen.set(msgId, {
              input: u.input_tokens ?? 0,
              output: u.output_tokens ?? 0,
              cacheRead: u.cache_read_input_tokens ?? 0,
              model: entry.message.model ?? 'unknown',
            });
          } catch { /* bad JSON line */ }
        }
      } catch { /* file read error */ }
    }

    for (const { input, output, cacheRead, model } of seen.values()) {
      stats.inputTokens += input;
      stats.outputTokens += output;
      stats.cacheReadTokens += cacheRead;

      try {
        const cost = calculateCost(input, output, model);
        stats.costUSD += cost.totalCost;

        const m = modelTotals.get(model) ?? { input: 0, output: 0, cost: 0 };
        m.input += input;
        m.output += output;
        m.cost += cost.totalCost;
        modelTotals.set(model, m);
      } catch { /* unsupported model — skip cost */ }
    }

    totalSessions += stats.sessions;
    projects.push(stats);
  }

  const sorted = projects.sort((a, b) => b.costUSD - a.costUSD);
  const totalCost = sorted.reduce((s, p) => s + p.costUSD, 0);
  const totalTokens = sorted.reduce((s, p) => s + p.inputTokens + p.outputTokens, 0);
  const totalCacheRead = sorted.reduce((s, p) => s + p.cacheReadTokens, 0);
  const sortedModels = [...modelTotals.entries()].sort((a, b) => b[1].cost - a[1].cost);

  // Build full markdown report
  const mdLines: string[] = [
    '# PromptFuel — Claude Code Insights',
    '',
    `**${projectFolders.length} projects** · **${totalSessions} sessions**`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total tokens | ${totalTokens.toLocaleString('en-US')} |`,
    `| Est. cost | ${formatCost(totalCost)} |`,
    `| Cache hits | ${totalCacheRead.toLocaleString('en-US')} tokens |`,
    '',
    '## Top Projects',
    '',
    '| Project | Tokens | Cost |',
    '|---------|--------|------|',
  ];

  for (const p of sorted.slice(0, 5)) {
    const tokens = (p.inputTokens + p.outputTokens).toLocaleString('en-US');
    mdLines.push(`| ${p.name} | ${tokens} | ${formatCost(p.costUSD)} |`);
  }

  if (sortedModels.length > 0) {
    mdLines.push('');
    mdLines.push('## Models');
    mdLines.push('');
    mdLines.push('| Model | Tokens | Cost |');
    mdLines.push('|-------|--------|------|');
    for (const [model, data] of sortedModels) {
      const tokens = (data.input + data.output).toLocaleString('en-US');
      mdLines.push(`| ${model} | ${tokens} | ${formatCost(data.cost)} |`);
    }
  }

  mdLines.push('');
  mdLines.push('*Run `pf dashboard` for full details (heaviest prompts, session health, action cards)*');

  // Dual-mode output
  const reportPath = writeReportFile('insights', mdLines.join('\n'));

  if (reportPath) {
    // Claude Code context — output just the file path
    process.stdout.write(reportPath + '\n');
  } else {
    // Regular terminal — full inline output
    const W = 52;
    const div = '═'.repeat(W);
    const thin = '─'.repeat(W);

    const lines: string[] = [
      '',
      `  PromptFuel — Claude Code Insights`,
      `  ${div}`,
      '',
      `  ${projectFolders.length} projects · ${totalSessions} sessions`,
      `  Total tokens : ${totalTokens.toLocaleString('en-US')}`,
      `  Est. cost    : ${formatCost(totalCost)}`,
      `  Cache hits   : ${totalCacheRead.toLocaleString('en-US')} tokens`,
      '',
      `  TOP PROJECTS`,
      `  ${thin}`,
    ];

    for (const p of sorted.slice(0, 5)) {
      const tokens = (p.inputTokens + p.outputTokens).toLocaleString('en-US');
      const cost = formatCost(p.costUSD);
      lines.push(`  ${p.name.slice(0, 22).padEnd(22)}  ${tokens.padStart(12)}  ${cost}`);
    }

    if (sortedModels.length > 0) {
      lines.push('');
      lines.push(`  MODELS`);
      lines.push(`  ${thin}`);
      for (const [model, data] of sortedModels) {
        const tokens = (data.input + data.output).toLocaleString('en-US');
        const cost = formatCost(data.cost);
        lines.push(`  ${model.slice(0, 24).padEnd(24)}  ${tokens.padStart(12)}  ${cost}`);
      }
    }

    lines.push('');
    lines.push(`  → Full details: promptfuel dashboard`);
    lines.push('');
    ttyWrite(lines.join('\n') + '\n');
  }
}
