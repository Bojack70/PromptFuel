#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { optimize, countTokens, calculateCost, formatCost, listModels, analyzeStrategies } from '@promptfuel/core';
import type { StrategyContext } from '@promptfuel/core';

const server = new McpServer({
  name: 'promptfuel',
  version: '1.0.0',
});

// ── Tool: optimize_prompt ──────────────────────────────────────────────────
server.tool(
  'optimize_prompt',
  'Optimize a prompt to reduce token count and cost while preserving meaning. Returns the optimized prompt, token savings, reduction percentage, and specific suggestions.',
  {
    prompt: z.string().describe('The prompt text to optimize'),
    model: z.string().optional().describe('Model ID to calculate costs for (e.g. claude-sonnet-4-6, gpt-4o). Defaults to claude-sonnet-4-6'),
  },
  async ({ prompt, model = 'claude-sonnet-4-6' }) => {
    const result = optimize(prompt, model);
    const lines = [
      `**Optimized Prompt:**`,
      `${result.optimizedPrompt}`,
      ``,
      `**Savings:**`,
      `- Tokens saved: ${result.tokenReduction.toLocaleString('en-US')} (${result.reductionPercent}% reduction)`,
      `- Original: ${result.originalTokens.toLocaleString('en-US')} tokens → Optimized: ${result.optimizedTokens.toLocaleString('en-US')} tokens`,
      `- Estimated cost saved: ${formatCost(calculateCost(result.tokenReduction, 0, model).inputCost)}`,
    ];
    if (result.suggestions.length > 0) {
      lines.push(``, `**What was changed:**`);
      for (const s of result.suggestions.slice(0, 5)) {
        lines.push(`- ${s.description}`);
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: count_tokens ────────────────────────────────────────────────────
server.tool(
  'count_tokens',
  'Count the tokens in a text for a specific model and estimate the API cost.',
  {
    text: z.string().describe('The text to count tokens for'),
    model: z.string().optional().describe('Model ID (e.g. claude-sonnet-4-6, gpt-4o). Defaults to claude-sonnet-4-6'),
  },
  async ({ text, model = 'claude-sonnet-4-6' }) => {
    const tokens = countTokens(text, model);
    const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, model);
    const lines = [
      `**Token Count for \`${model}\`:**`,
      `- Input tokens: ${tokens.inputTokens.toLocaleString('en-US')}`,
      `- Estimated output tokens: ~${tokens.estimatedOutputTokens.toLocaleString('en-US')}`,
      ``,
      `**Estimated Cost:**`,
      `- Input: ${formatCost(cost.inputCost)}`,
      `- Output: ${formatCost(cost.outputCost)}`,
      `- Total: ${formatCost(cost.totalCost)}`,
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: compare_models ──────────────────────────────────────────────────
server.tool(
  'compare_models',
  'Compare the token count and cost of a prompt across multiple AI models to find the most cost-effective option.',
  {
    text: z.string().describe('The prompt text to compare across models'),
    models: z.array(z.string()).optional().describe('List of model IDs to compare. Defaults to the most common models.'),
  },
  async ({ text, models }) => {
    const defaultModels = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'gpt-4o', 'gpt-4o-mini'];
    const targetModels = models ?? defaultModels;

    const rows: string[] = [
      `**Cost Comparison across ${targetModels.length} models:**`,
      ``,
      `| Model | Tokens | Est. Total Cost |`,
      `|-------|--------|-----------------|`,
    ];

    for (const model of targetModels) {
      try {
        const tokens = countTokens(text, model);
        const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, model);
        rows.push(`| ${model} | ${tokens.inputTokens.toLocaleString('en-US')} | ${formatCost(cost.totalCost)} |`);
      } catch {
        rows.push(`| ${model} | — | unsupported |`);
      }
    }

    return { content: [{ type: 'text', text: rows.join('\n') }] };
  }
);

// ── Tool: analyze_strategies ─────────────────────────────────────────────
server.tool(
  'analyze_strategies',
  'Scan a project directory and return actionable token-saving strategy recommendations — things like adding a CLAUDE.md, using prompt caching, or switching models.',
  {
    directory: z.string().optional().describe('Absolute path to the project directory to scan. Defaults to the current working directory.'),
    model: z.string().optional().describe('Model ID to calculate cost savings for. Defaults to claude-sonnet-4-6'),
  },
  async ({ directory, model = 'claude-sonnet-4-6' }) => {
    const projectDir = directory ?? process.cwd();

    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      return { content: [{ type: 'text', text: `Error: "${projectDir}" is not a valid directory.` }] };
    }

    // Scan project files (max depth 3, skip common noise)
    function scanDir(dir: string, depth = 0): string[] {
      if (depth > 3) return [];
      const results: string[] = [];
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') && entry.name !== '.cursorrules') continue;
          if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isFile()) results.push(relative(projectDir, full));
          else if (entry.isDirectory()) results.push(...scanDir(full, depth + 1));
        }
      } catch { /* permission errors */ }
      return results;
    }

    const projectFiles = scanDir(projectDir);
    const fileContents: Record<string, string> = {};
    for (const f of ['package.json', 'README.md', 'CLAUDE.md', '.cursorrules', 'tsconfig.json']) {
      const path = join(projectDir, f);
      if (existsSync(path)) {
        try { fileContents[f] = readFileSync(path, 'utf-8'); } catch { /* ignore */ }
      }
    }

    const context: StrategyContext = { projectDir, projectFiles, fileContents, model };
    const analysis = analyzeStrategies(context);

    if (analysis.recommendations.length === 0) {
      return { content: [{ type: 'text', text: `✓ No recommendations — your project looks well-optimized!\n\n${analysis.projectSummary}` }] };
    }

    const lines = [
      `**PromptFuel Strategy Analysis**`,
      ``,
      analysis.projectSummary,
      ``,
      `**${analysis.recommendations.length} Recommendations:**`,
      ``,
    ];

    for (let i = 0; i < analysis.recommendations.length; i++) {
      const rec = analysis.recommendations[i];
      const impact = rec.impact === 'high' ? '🔴 HIGH' : rec.impact === 'medium' ? '🟡 MED' : '⚪ LOW';
      lines.push(`${i + 1}. ${impact} **${rec.name}**`);
      lines.push(`   ${rec.description}`);
      if (rec.estimatedTokenSavings > 0) lines.push(`   Savings: ~${rec.estimatedTokenSavings.toLocaleString('en-US')} tokens / ~${formatCost(rec.estimatedCostSavings)}`);
      lines.push(`   Action: ${rec.actionDescription}`);
      lines.push('');
    }

    lines.push(`**Total potential savings: ~${analysis.totalEstimatedTokenSavings.toLocaleString('en-US')} tokens / ~${formatCost(analysis.totalEstimatedCostSavings)}**`);

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: claude_insights ────────────────────────────────────────────────
server.tool(
  'claude_insights',
  'Show Claude Code token usage and cost breakdown across all projects by reading ~/.claude/projects/ session logs.',
  {},
  async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');

    const claudeDir = join(homedir(), '.claude', 'projects');
    if (!existsSync(claudeDir)) {
      return { content: [{ type: 'text', text: 'No Claude Code usage data found at ~/.claude/projects/' }] };
    }

    const projectFolders = readdirSync(claudeDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    function folderToName(folder: string): string {
      const home = homedir().replace(/\//g, '-');
      let stripped = folder.startsWith(home) ? folder.slice(home.length) : folder;
      stripped = stripped.replace(/^-/, '');
      const parts = stripped.split('-').filter(Boolean);
      return parts[parts.length - 1] ?? folder;
    }

    const projects: Array<{ name: string; sessions: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUSD: number }> = [];
    const modelTotals = new Map<string, { input: number; output: number; cost: number }>();
    let totalSessions = 0;

    for (const folder of projectFolders) {
      const folderPath = join(claudeDir, folder);
      const jsonlFiles = readdirSync(folderPath).filter((f: string) => f.endsWith('.jsonl'));
      const stats = { name: folderToName(folder), sessions: jsonlFiles.length, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUSD: 0 };

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
              seen.set(msgId, { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, model: entry.message.model ?? 'unknown' });
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
          m.input += input; m.output += output; m.cost += cost.totalCost;
          modelTotals.set(model, m);
        } catch { /* unsupported model */ }
      }

      totalSessions += stats.sessions;
      projects.push(stats);
    }

    const sorted = projects.sort((a, b) => b.costUSD - a.costUSD);
    const totalCost = sorted.reduce((s, p) => s + p.costUSD, 0);
    const totalTokens = sorted.reduce((s, p) => s + p.inputTokens + p.outputTokens, 0);
    const totalCacheRead = sorted.reduce((s, p) => s + p.cacheReadTokens, 0);
    const sortedModels = [...modelTotals.entries()].sort((a, b) => b[1].cost - a[1].cost);

    const lines = [
      `**Claude Code Insights — ${projectFolders.length} projects · ${totalSessions} sessions**`,
      ``,
      `- Total tokens: ${totalTokens.toLocaleString('en-US')}`,
      `- Est. cost: ${formatCost(totalCost)}`,
      `- Cache hits: ${totalCacheRead.toLocaleString('en-US')} tokens`,
      ``,
      `**Top Projects:**`,
    ];

    for (const p of sorted.slice(0, 5)) {
      const tokens = (p.inputTokens + p.outputTokens).toLocaleString('en-US');
      lines.push(`- ${p.name}: ${tokens} tokens · ${formatCost(p.costUSD)}`);
    }

    if (sortedModels.length > 0) {
      lines.push(``, `**Models Used:**`);
      for (const [model, data] of sortedModels) {
        const tokens = (data.input + data.output).toLocaleString('en-US');
        lines.push(`- ${model}: ${tokens} tokens · ${formatCost(data.cost)}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: list_models ─────────────────────────────────────────────────────
server.tool(
  'list_models',
  'List all AI models supported by PromptFuel for token counting and cost estimation.',
  {},
  async () => {
    const models = listModels();
    const text = `**Supported models (${models.length}):**\n${models.map(m => `- ${m}`).join('\n')}`;
    return { content: [{ type: 'text', text }] };
  }
);

// ── Prompt: auto_optimize ─────────────────────────────────────────────────
server.prompt(
  'auto_optimize',
  'Enable auto-optimization mode — every message you send will be automatically optimized before Claude responds',
  async () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: [
          'Auto-optimize mode is now ON.',
          '',
          'For every message I send for the rest of this conversation:',
          '1. Call the optimize_prompt tool on my exact message text.',
          '2. Show a one-line summary: "✓ Optimized: saved X tokens (Y% reduction)" — or "✓ Already concise" if no savings.',
          '3. Then respond to the optimized version as normal.',
          '',
          'Do this automatically and silently for every message without me having to ask.',
        ].join('\n'),
      },
    }],
  })
);

// ── Start server ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
