import meow from 'meow';
import { runAnalyze } from './commands/analyze.js';
import { runOptimize } from './commands/optimize.js';
import { runBatch } from './commands/batch.js';

const cli = meow(`
  Commands
    pf                        Launch interactive TUI
    pf setup                  Add "pf" alias to your shell (run once)
    pf optimize <prompt>      Optimize a prompt
    pf analyze <prompt>       Analyze token count & cost
    pf strategies [dir]       Analyze project for token-saving strategies
    pf insights               Claude Code token usage across all projects
    pf dashboard              Open web dashboard (Insights tab)
    pf batch <file.json>      Batch analyze prompts from JSON

  Flags
    -m  Model (default: gpt-4o)   -c  Copy to clipboard
    -b  Token budget               -a  Aggressive compression
    -o  Output only (for piping)   -p  Dashboard port (default: 3939)
`, {
  importMeta: import.meta,
  flags: {
    model: { type: 'string', shortFlag: 'm', default: 'gpt-4o' },
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

async function main() {
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
