import fs from 'fs';
import os from 'os';
import path from 'path';
import meow from 'meow';
import { getDefaultModel } from './config.js';
import { runAnalyze } from './commands/analyze.js';
import { runOptimize } from './commands/optimize.js';
import { runBatch } from './commands/batch.js';

const defaultModel = getDefaultModel();

const cli = meow(`
  Commands
    pf                        Launch interactive TUI
    pf setup                  Add "pf" alias to your shell (run once)
    pf uninstall              Remove alias + MCP config, then npm uninstall
    pf optimize <prompt>      Optimize a prompt
    pf analyze <prompt>       Analyze token count & cost
    pf strategies [dir]       Analyze project for token-saving strategies
    pf insights               Claude Code token usage across all projects
    pf dashboard              Open web dashboard (Insights tab)
    pf batch <file.json>      Batch analyze prompts from JSON
    pf config model <name>    Set default model (saved to ~/.promptfuel/config.json)
    pf config models          List all available models

  Flags
    -m  Model (default: ${defaultModel})   -c  Copy to clipboard
    -b  Token budget               -a  Aggressive compression
    -o  Output only (for piping)   -p  Dashboard port (default: 3939)
`, {
  importMeta: import.meta,
  flags: {
    model: { type: 'string', shortFlag: 'm', default: defaultModel },
    copy: { type: 'boolean', shortFlag: 'c', default: false },
    output: { type: 'boolean', shortFlag: 'o', default: false },
    port: { type: 'number', shortFlag: 'p', default: 3939 },
    budget: { type: 'number', shortFlag: 'b' },
    intent: { type: 'string', shortFlag: 'i' },
    aggressive: { type: 'boolean', shortFlag: 'a', default: false },
  },
});

const [command, ...rest] = cli.input;
const promptArg = rest.join(' ');
const model = cli.flags.model;

async function runFirstTimeSetup() {
  const flagFile = path.join(os.homedir(), '.promptfuel', '.setup_done');
  if (fs.existsSync(flagFile)) return;
  const { runSetup } = await import('./commands/setup.js');
  await runSetup();
  fs.mkdirSync(path.dirname(flagFile), { recursive: true });
  fs.writeFileSync(flagFile, new Date().toISOString(), 'utf8');
}

async function main() {
  // Show onboarding banner on very first run
  if (command !== 'setup' && command !== 'uninstall') {
    await runFirstTimeSetup().catch(() => {});
  }

  switch (command) {
    case 'analyze':
      await runAnalyze(promptArg || undefined, model);
      break;

    case 'optimize':
      await runOptimize(promptArg || undefined, {
        model,
        copy: cli.flags.copy,
        outputOptimized: cli.flags.output,
        budget: cli.flags.budget,
        intent: cli.flags.intent as import('./commands/optimize.js').OptimizeOptions['intent'],
        aggressive: cli.flags.aggressive,
      });
      break;

    case 'batch':
      await runBatch(promptArg || undefined, model);
      break;

    case 'dashboard': {
      const { runDashboard } = await import('./commands/dashboard.js');
      await runDashboard(cli.flags.port);
      break;
    }

    case 'strategies':
    case 'save': {
      const { runStrategies } = await import('./commands/strategies.js');
      await runStrategies(promptArg || undefined, { model });
      break;
    }

    case 'setup': {
      const { runSetup } = await import('./commands/setup.js');
      await runSetup();
      break;
    }

    case 'uninstall': {
      const { runUninstall } = await import('./commands/uninstall.js');
      await runUninstall();
      break;
    }

    case 'config': {
      const { runConfig } = await import('./commands/config.js');
      await runConfig(rest);
      break;
    }

    case 'insights': {
      const { runInsights } = await import('./commands/insights.js');
      await runInsights();
      break;
    }

    case undefined: {
      // No command = launch TUI
      const { launchTUI } = await import('./tui/app.js');
      await launchTUI(model);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      cli.showHelp();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
