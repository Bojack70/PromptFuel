import { optimize, formatCost, calculateCost, countTokens, getModelInfo } from '@promptfuel/core';
import type { OptimizationResult, PromptIntentType } from '@promptfuel/core';
import clipboard from 'clipboardy';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', reject);
  });
}

function separator(char = '\u2500', width = 60): string {
  return char.repeat(width);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function renderSuggestion(s: OptimizationResult, idx: number): string[] {
  const lines: string[] = [];
  const tokenSavedLabel = s.tokensSaved > 0 ? ` [-${s.tokensSaved} tokens]` : '';
  lines.push(`  ${idx + 1}. [${s.rule}]${tokenSavedLabel}`);
  lines.push(`     ${s.description}`);
  if (s.original && s.optimized !== s.original) {
    lines.push(`     Original  : "${truncate(s.original, 60)}"`);
    if (s.optimized && s.optimized !== s.original) {
      lines.push(`     Optimized : "${truncate(s.optimized, 60)}"`);
    } else {
      lines.push(`     Optimized : [removed]`);
    }
  }
  return lines;
}

export interface OptimizeOptions {
  model: string;
  copy: boolean;
  outputOptimized: boolean;
  budget?: number;
  intent?: PromptIntentType;
  aggressive?: boolean;
}

export async function runOptimize(
  promptArg: string | undefined,
  options: OptimizeOptions,
): Promise<void> {
  const { model, copy, outputOptimized, budget, intent, aggressive } = options;

  let promptText: string;

  if (promptArg && promptArg.trim().length > 0) {
    promptText = promptArg.trim();
  } else if (!process.stdin.isTTY) {
    promptText = await readStdin();
  } else {
    process.stderr.write('Error: provide prompt text as an argument or pipe it via stdin.\n');
    process.stderr.write('  Usage: promptfuel optimize "your prompt here"\n');
    process.stderr.write('         echo "your prompt" | promptfuel optimize --model gpt-4o\n');
    process.exit(1);
  }

  if (promptText.length === 0) {
    process.stderr.write('Error: prompt text is empty.\n');
    process.exit(1);
  }

  let modelInfo;
  try {
    modelInfo = getModelInfo(model);
  } catch {
    process.stderr.write(`Error: unknown model "${model}".\n`);
    process.exit(1);
  }

  const result = optimize(promptText, model, {
    ...(budget !== undefined ? { targetTokens: budget } : {}),
    ...(intent !== undefined ? { intent } : {}),
    ...(aggressive ? { aggressive: true } : {}),
  });

  const originalTokenCount = countTokens(promptText, model);
  const optimizedTokenCount = countTokens(result.optimizedPrompt, model);

  const originalCost = calculateCost(
    originalTokenCount.inputTokens,
    originalTokenCount.estimatedOutputTokens,
    model,
  );
  const optimizedCost = calculateCost(
    optimizedTokenCount.inputTokens,
    optimizedTokenCount.estimatedOutputTokens,
    model,
  );

  const costSavings = originalCost.totalCost - optimizedCost.totalCost;

  // --output flag: just print the optimized prompt and exit cleanly
  if (outputOptimized) {
    process.stdout.write(result.optimizedPrompt + '\n');
    return;
  }

  const aggressiveLabel = aggressive ? ' · aggressive' : '';
  const budgetLabel = budget !== undefined ? ` · budget ${budget}t` : '';

  // Compact single-line changes summary
  const changesSummary = result.suggestions.length > 0
    ? result.suggestions.map(s => s.description).join(' · ')
    : 'No changes needed';

  let copied = false;
  if (result.tokenReduction > 0) {
    try { await clipboard.write(result.optimizedPrompt); copied = true; } catch { /* headless CI */ }
  }

  const savingsLine = result.tokenReduction > 0
    ? `  ${result.originalTokens} → ${result.optimizedTokens} tokens  ·  ${result.reductionPercent}% saved  ·  ${formatCost(costSavings)}${copied ? '  ·  copied — Ctrl+V to paste' : ''}`
    : `  ${result.originalTokens} tokens  ·  ${formatCost(optimizedCost.totalCost)}`;

  const lines: string[] = [
    '',
    `  PromptFuel  ${model}${aggressiveLabel}${budgetLabel}`,
    `  "${result.optimizedPrompt}"`,
    `  ✂ ${changesSummary}`,
    savingsLine,
    '',
  ];

  process.stdout.write(lines.join('\n') + '\n');
}
