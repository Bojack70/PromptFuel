import { countTokens, calculateCost, formatCost, getModelInfo, getContextWindow } from '@promptfuel/core';

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

function buildBar(percent: number, width: number = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function warningLabel(percent: number): string {
  if (percent >= 90) return 'CRITICAL';
  if (percent >= 75) return 'HIGH';
  if (percent >= 50) return 'MODERATE';
  return 'OK';
}

function separator(char = '\u2500', width = 50): string {
  return char.repeat(width);
}

export async function runAnalyze(promptArg: string | undefined, model: string): Promise<void> {
  let promptText: string;

  if (promptArg && promptArg.trim().length > 0) {
    promptText = promptArg.trim();
  } else if (!process.stdin.isTTY) {
    promptText = await readStdin();
  } else {
    process.stderr.write('Error: provide prompt text as an argument or pipe it via stdin.\n');
    process.stderr.write('  Usage: promptfuel analyze "your prompt here"\n');
    process.stderr.write('         echo "your prompt" | promptfuel analyze --model gpt-4o\n');
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
    process.stderr.write('Run `promptfuel analyze --help` for supported models.\n');
    process.exit(1);
  }

  const { inputTokens, estimatedOutputTokens } = countTokens(promptText, model);
  const totalTokens = inputTokens + estimatedOutputTokens;
  const cost = calculateCost(inputTokens, estimatedOutputTokens, model);
  const contextWindow = getContextWindow(model);
  const percentUsed = Math.min(Math.round((inputTokens / contextWindow) * 100), 100);
  const warning = warningLabel(percentUsed);
  const bar = buildBar(percentUsed);

  const lines: string[] = [
    '',
    separator('\u2550'),
    '  PromptFuel \u2014 Prompt Analysis',
    separator('\u2550'),
    '',
    `  Model        : ${model}`,
    `  Context      : ${contextWindow.toLocaleString()} tokens`,
    '',
    separator(),
    '  TOKEN BREAKDOWN',
    separator(),
    `  Input tokens         : ${inputTokens.toLocaleString()}`,
    `  Est. output tokens   : ${estimatedOutputTokens.toLocaleString()}`,
    `  Total tokens         : ${totalTokens.toLocaleString()}`,
    '',
    separator(),
    '  COST ESTIMATE',
    separator(),
    `  Input cost           : ${formatCost(cost.inputCost)}  (@ $${modelInfo.input.toFixed(2)}/1M tokens)`,
    `  Est. output cost     : ${formatCost(cost.outputCost)}  (@ $${modelInfo.output.toFixed(2)}/1M tokens)`,
    `  Total cost           : ${formatCost(cost.totalCost)}`,
    '',
    separator(),
    '  CONTEXT WINDOW USAGE',
    separator(),
    `  [${bar}] ${percentUsed}%  [${warning}]`,
    `  ${inputTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens used`,
    `  ${(contextWindow - inputTokens).toLocaleString()} tokens remaining`,
    '',
    separator('\u2550'),
    '',
  ];

  process.stdout.write(lines.join('\n') + '\n');
}
