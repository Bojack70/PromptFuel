import { readFileSync } from 'node:fs';
import { countTokens, calculateCost, optimize, formatCost, getModelInfo } from '@promptfuel/core';

interface BatchPrompt {
  name?: string;
  content: string;
  model?: string;
}

interface BatchResult {
  name: string;
  originalTokens: number;
  optimizedTokens: number;
  tokensSaved: number;
  reductionPercent: number;
  originalCost: number;
  optimizedCost: number;
  costSaved: number;
  topSuggestion: string;
}

function separator(char = '─', width = 70): string {
  return char.repeat(width);
}

export async function runBatch(fileArg: string | undefined, model: string): Promise<void> {
  if (!fileArg) {
    process.stderr.write('Error: provide a JSON file path.\n');
    process.stderr.write('  Usage: promptfuel batch prompts.json --model gpt-4o\n');
    process.stderr.write('\n  File format: [{ "name": "My Prompt", "content": "..." }, ...]\n');
    process.stderr.write('  Or: ["prompt text 1", "prompt text 2", ...]\n');
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(fileArg, 'utf-8');
  } catch {
    process.stderr.write(`Error: could not read file "${fileArg}".\n`);
    process.exit(1);
  }

  let prompts: BatchPrompt[];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      prompts = parsed.map((item, i) => {
        if (typeof item === 'string') {
          return { name: `Prompt ${i + 1}`, content: item };
        }
        if (typeof item?.content !== 'string' || !item.content.trim()) {
          process.stderr.write(`Warning: entry ${i + 1} has no valid "content" string, skipping.\n`);
          return null;
        }
        return { name: item.name ?? `Prompt ${i + 1}`, content: item.content, model: item.model };
      }).filter((p): p is BatchPrompt => p !== null);
    } else {
      process.stderr.write('Error: JSON file must contain an array.\n');
      process.exit(1);
    }
  } catch {
    process.stderr.write('Error: invalid JSON in file.\n');
    process.exit(1);
  }

  if (prompts.length === 0) {
    process.stderr.write('Error: no prompts found in file.\n');
    process.exit(1);
  }

  const results: BatchResult[] = [];

  for (const prompt of prompts) {
    const m = prompt.model ?? model;
    const tokens = countTokens(prompt.content, m);
    const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, m);
    const optimized = optimize(prompt.content, m);
    const optTokens = countTokens(optimized.optimizedPrompt, m);
    const optCost = calculateCost(optTokens.inputTokens, optTokens.estimatedOutputTokens, m);

    results.push({
      name: prompt.name ?? 'Unnamed',
      originalTokens: tokens.inputTokens,
      optimizedTokens: optTokens.inputTokens,
      tokensSaved: optimized.tokenReduction,
      reductionPercent: optimized.reductionPercent,
      originalCost: cost.totalCost,
      optimizedCost: optCost.totalCost,
      costSaved: cost.totalCost - optCost.totalCost,
      topSuggestion: optimized.suggestions[0]?.description ?? 'None',
    });
  }

  // Sort by savings potential (highest first)
  results.sort((a, b) => b.tokensSaved - a.tokensSaved);

  const totalOrigTokens = results.reduce((s, r) => s + r.originalTokens, 0);
  const totalOptTokens = results.reduce((s, r) => s + r.optimizedTokens, 0);
  const totalCostSaved = results.reduce((s, r) => s + r.costSaved, 0);
  const totalOrigCost = results.reduce((s, r) => s + r.originalCost, 0);
  const optimizable = results.filter(r => r.tokensSaved > 0).length;

  const lines: string[] = [
    '',
    separator('═', 70),
    '  PromptFuel — Batch Analysis Report',
    separator('═', 70),
    '',
    `  Model     : ${model}`,
    `  Prompts   : ${prompts.length} analyzed`,
    `  Optimizable: ${optimizable} of ${prompts.length} (${Math.round((optimizable / prompts.length) * 100)}%)`,
    '',
    separator(),
    '  SUMMARY',
    separator(),
    `  Total input tokens       : ${totalOrigTokens.toLocaleString()}`,
    `  After optimization       : ${totalOptTokens.toLocaleString()}`,
    `  Total tokens saved       : ${(totalOrigTokens - totalOptTokens).toLocaleString()} (${totalOrigTokens > 0 ? Math.round(((totalOrigTokens - totalOptTokens) / totalOrigTokens) * 100) : 0}%)`,
    `  Total estimated cost     : ${formatCost(totalOrigCost)}`,
    `  After optimization       : ${formatCost(totalOrigCost - totalCostSaved)}`,
    `  Potential savings        : ${formatCost(totalCostSaved)}`,
    '',
    separator(),
    '  TOP OPTIMIZATION OPPORTUNITIES (ranked by token savings)',
    separator(),
  ];

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const r = results[i];
    lines.push(`  ${i + 1}. "${truncate(r.name, 40)}"`);
    lines.push(`     Tokens: ${r.originalTokens} → ${r.optimizedTokens} (-${r.tokensSaved}, ${r.reductionPercent}%)`);
    lines.push(`     Cost:   ${formatCost(r.originalCost)} → ${formatCost(r.optimizedCost)} (save ${formatCost(r.costSaved)})`);
    lines.push(`     Tip:    ${truncate(r.topSuggestion, 60)}`);
    lines.push('');
  }

  if (results.length > 10) {
    lines.push(`  ... and ${results.length - 10} more prompts analyzed`);
    lines.push('');
  }

  lines.push(separator('═', 70));
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
