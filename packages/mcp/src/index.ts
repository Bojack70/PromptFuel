#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { optimize, countTokens, calculateCost, formatCost, listModels } from '@promptfuel/core';

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

// ── Start server ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
