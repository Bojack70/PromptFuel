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

  const changeLines = result.suggestions.map((s) => {
    const saved = s.tokensSaved > 0 ? ` (-${s.tokensSaved}t)` : '';
    return `  ✂ ${s.description}${saved}`;
  });

  const lines: string[] = [
    '',
    `  PromptFuel  ${model}  ·  ${intentLabel}${budgetLine ? `  ·  budget ${budget}t` : ''}`,
    '',
    `  BEFORE  "${truncate(promptText, 100)}"`,
    `  AFTER   "${truncate(result.optimizedPrompt, 100)}"`,
    '',
    ...(changeLines.length > 0 ? changeLines : ['  ✓ Prompt looks clean, no changes needed']),
    '',
    `  Saved ${result.tokenReduction} tokens (${result.reductionPercent}%)  ·  ${result.originalTokens} → ${result.optimizedTokens} tokens  ·  ${formatCost(costSavings)} saved`,
    '',
  ];

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
