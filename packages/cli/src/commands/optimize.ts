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
}

export async function runOptimize(
  promptArg: string | undefined,
  options: OptimizeOptions,
): Promise<void> {
  const { model, copy, outputOptimized, budget, intent } = options;

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

  const verbosityBar = '\u2588'.repeat(Math.round(result.verbosityScore / 10)) +
    '\u2591'.repeat(10 - Math.round(result.verbosityScore / 10));

  const intentLabel = result.intent ? `${result.intent.type} (${Math.round(result.intent.confidence * 100)}% confidence)` : 'general';
  const budgetLine = budget !== undefined
    ? `  Budget : ${budget.toLocaleString('en-US')} tokens${result.budget ? ` | met: ${result.budget.met ? 'yes' : 'no'} | gap: ${result.budget.remainingGap}` : ''}`
    : null;

  const lines: string[] = [
    '',
    separator('\u2550', 60),
    '  PromptFuel \u2014 Prompt Optimizer',
    separator('\u2550', 60),
    '',
    `  Model  : ${model}`,
    `  Intent : ${intentLabel}`,
    ...(budgetLine ? [budgetLine] : []),
    `  Input  cost rate: $${modelInfo.input.toFixed(2)}/1M tokens`,
    `  Output cost rate: $${modelInfo.output.toFixed(2)}/1M tokens`,
    '',
    separator('─', 60),
    '  VERBOSITY SCORE',
    separator('─', 60),
    `  [${verbosityBar}] ${result.verbosityScore}/100`,
    '  (higher = more verbose / more room to optimize)',
    '',
    separator('─', 60),
    '  ORIGINAL PROMPT',
    separator('─', 60),
    `  "${truncate(promptText, 120)}"`,
    '',
    `  Tokens : ${result.originalTokens.toLocaleString('en-US')} input + est. ${originalTokenCount.estimatedOutputTokens.toLocaleString('en-US')} output`,
    `  Cost   : ${formatCost(originalCost.totalCost)} (input ${formatCost(originalCost.inputCost)} + output ${formatCost(originalCost.outputCost)})`,
    '',
    separator('─', 60),
    '  OPTIMIZED PROMPT',
    separator('─', 60),
    `  "${truncate(result.optimizedPrompt, 120)}"`,
    '',
    `  Tokens : ${result.optimizedTokens.toLocaleString('en-US')} input + est. ${optimizedTokenCount.estimatedOutputTokens.toLocaleString('en-US')} output`,
    `  Cost   : ${formatCost(optimizedCost.totalCost)} (input ${formatCost(optimizedCost.inputCost)} + output ${formatCost(optimizedCost.outputCost)})`,
    '',
    separator('─', 60),
    '  SAVINGS SUMMARY',
    separator('─', 60),
    `  Token reduction  : ${result.tokenReduction.toLocaleString('en-US')} tokens (${result.reductionPercent}%)`,
    `  Cost savings     : ${formatCost(costSavings)}`,
    '',
  ];

  if (result.suggestions.length > 0) {
    lines.push(separator('─', 60));
    lines.push(`  SUGGESTIONS (${result.suggestions.length} found)`);
    lines.push(separator('─', 60));
    for (let i = 0; i < result.suggestions.length; i++) {
      const rendered = renderSuggestion(result.suggestions[i], i);
      lines.push(...rendered);
      lines.push('');
    }
  } else {
    lines.push('  No specific suggestions — prompt looks clean!');
    lines.push('');
  }

  lines.push(separator('\u2550', 60));
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');

  if (copy) {
    try {
      await clipboard.write(result.optimizedPrompt);
      process.stdout.write('  Optimized prompt copied to clipboard.\n\n');
    } catch {
      process.stderr.write('  Warning: could not copy to clipboard.\n\n');
    }
  }

  // Interactive "Use this instead?" prompt
  if (process.stdin.isTTY && !copy && result.tokenReduction > 0) {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question('  Use this optimized version? [Y/n] ', resolve);
    });
    rl.close();

    if (!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      try {
        await clipboard.write(result.optimizedPrompt);
        process.stdout.write('\n  ✓ Optimized prompt copied to clipboard!\n\n');
      } catch {
        process.stdout.write('\n  Optimized prompt:\n');
        process.stdout.write(`  ${result.optimizedPrompt}\n\n`);
      }
    }
  }
}
