import { readConfig, writeConfig } from '../config.js';
import { getModelInfo } from '@promptfuel/core';

export async function runConfig(args: string[]): Promise<void> {
  const [key, value] = args;

  // pf config — show current config
  if (!key) {
    const config = readConfig();
    const model = config.model ?? 'claude-sonnet-4-6 (default)';
    process.stdout.write(`\n  PromptFuel config\n\n  model  ${model}\n\n`);
    return;
  }

  if (key === 'model') {
    if (!value) {
      process.stderr.write('Usage: pf config model <model-name>\n');
      process.stderr.write('Example: pf config model claude-opus-4-6\n');
      process.exit(1);
    }

    // Validate model exists
    try {
      getModelInfo(value);
    } catch {
      process.stderr.write(`Error: unknown model "${value}"\n`);
      process.stderr.write('Run: pf config models  to see available models\n');
      process.exit(1);
    }

    const config = readConfig();
    config.model = value;
    writeConfig(config);
    process.stdout.write(`\n  ✓ Default model set to ${value}\n\n`);
    return;
  }

  if (key === 'models') {
    const { listModels } = await import('@promptfuel/core');
    const models = listModels();
    process.stdout.write('\n  Available models:\n');
    for (const m of models) process.stdout.write(`    ${m}\n`);
    process.stdout.write('\n');
    return;
  }

  process.stderr.write(`Unknown config key: ${key}\n`);
  process.stderr.write('Usage: pf config model <model-name>\n');
  process.exit(1);
}
