import meow from 'meow';
import { runAnalyze } from './commands/analyze.js';
import { runOptimize } from './commands/optimize.js';
import { runBatch } from './commands/batch.js';

const cli = meow(`
  Usage
    $ promptfuel                       Launch interactive TUI
    $ promptfuel dashboard             Open web dashboard in browser
    $ promptfuel analyze <prompt>      Analyze token count & cost
    $ promptfuel optimize <prompt>     Optimize a prompt
    $ promptfuel strategies [dir]      Analyze project for token-saving strategies
    $ promptfuel batch <file.json>     Batch analyze prompts from JSON file

  Options
    --model, -m     Model to use (default: gpt-4o)
    --copy, -c      Copy optimized prompt to clipboard
    --output, -o    Output only the optimized prompt (for piping)
    --port, -p      Port for web dashboard (default: 3939)
    --budget, -b    Target token budget (e.g. --budget 500)
    --intent, -i    Override intent detection: debug | code-gen | refactor | explain | creative | general

  Examples
    $ promptfuel analyze "Explain how React hooks work"
    $ echo "Your prompt" | promptfuel analyze --model claude-sonnet-4-6
    $ promptfuel optimize "I would like you to please explain..." --copy
    $ promptfuel optimize "verbose prompt" --output | pbcopy
    $ promptfuel optimize "verbose prompt" --budget 300 --intent code-gen
    $ promptfuel dashboard --port 4000
    $ promptfuel strategies ./my-project
    $ promptfuel batch prompts.json --model gpt-4o
`, {
  importMeta: import.meta,
  flags: {
    model: { type: 'string', shortFlag: 'm', default: 'gpt-4o' },
    copy: { type: 'boolean', shortFlag: 'c', default: false },
    output: { type: 'boolean', shortFlag: 'o', default: false },
    port: { type: 'number', shortFlag: 'p', default: 3939 },
    budget: { type: 'number', shortFlag: 'b' },
    intent: { type: 'string', shortFlag: 'i' },
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
