# PromptFuel

**Save tokens. Cut costs. Write better prompts.**

PromptFuel is an open-source toolkit that helps you spend less on AI with intent-aware prompt optimization, token budget targeting, and cost intelligence — across ChatGPT, Claude, and 14+ models.

It works as a **CLI tool**, a **Chrome extension**, a **web dashboard**, and an **npm SDK** — all powered by a shared local engine with zero API calls required.

---

## What It Does

| Feature | What you get |
| --- | --- |
| **Intent Detection** | Classifies prompts into 6 intent types (debug, code-gen, refactor, explain, creative, general) with confidence scoring — optimization adapts automatically to preserve critical phrases like "step by step" in debug prompts |
| **Token Budget Targeting** | Set a target token count and PromptFuel auto-selects the right compression level (1–4) to hit your budget |
| **Smart Prompt Rewriter** | Intent-aware rewriter with 150+ rules — automatically gates passes based on detected intent to avoid over-optimizing |
| **Token Counter** | Exact token counts for OpenAI models, ~94% accurate for Claude |
| **Cost Calculator** | Real-time cost estimates with per-model pricing for 14+ models |
| **Context Monitor** | Visual progress bar showing how much of your context window you've used |
| **Strategy Advisor** | Scans your project and suggests actionable ways to save tokens — like creating a CLAUDE.md so Claude doesn't re-read everything |
| **Web Dashboard** | Browser-based dashboard with 4 tabs — Analyze & Optimize, History, Strategies, and an **Insights** tab that reads your real Claude Code usage data to surface costs, session breakdowns, and 5 actionable savings cards |
| **Cache Savings Analyzer** | Clusters similar prompts via Jaccard similarity to estimate semantic caching savings and provides setup guides |
| **Chrome Extension** | Floating widget on ChatGPT & Claude that shows tokens + cost in real-time |

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Optimize a prompt (intent is detected automatically)
npx promptfuel optimize "I would like you to please explain how React hooks work in detail"

# Optimize with a token budget target
npx promptfuel optimize "Please help me debug this error step by step" --budget 10
```

---

## CLI Tool

### Optimize a Prompt

The `optimize` command detects prompt intent, rewrites for maximum token savings, and shows a detailed before/after comparison:

```bash
promptfuel optimize "Can you please help me debug this error step by step and provide a detailed explanation"
```

**Output:**
```
════════════════════════════════════════════════════════════
  PromptFuel — Prompt Optimizer
════════════════════════════════════════════════════════════

  INTENT
  Type : debug (83% confidence)
  Signals : error-keyword, reasoning-marker

  ORIGINAL PROMPT
  "Can you please help me debug this error step by step
   and provide a detailed explanation"
  Tokens : 20 input

  OPTIMIZED PROMPT
  "Debug this error step by step. Explain why."
  Tokens : 10 input

  SAVINGS SUMMARY
  Token reduction  : 10 tokens (50%)

  SUGGESTIONS (3 found)
  1. [filler] Remove filler phrase: "Can you please help me"
  2. [rewrite-verbose-phrase] "provide a detailed explanation" → "Explain why"
  3. [intent-protected] Preserved "step by step" (debug intent)

  Use this optimized version? [Y/n]
════════════════════════════════════════════════════════════
```

When you confirm, the optimized prompt is copied to your clipboard.

**With a token budget:**

```bash
promptfuel optimize "verbose prompt here" --budget 15
```

PromptFuel progressively applies compression levels (1–4) until your token target is met:

| Level | What it applies |
| --- | --- |
| 1 (light) | Filler removal, formatting cleanup |
| 2 (moderate) | - redundancy, duplicates, verbose phrases, sentence compression |
| 3 (aggressive) | - all detectors, all rewriter passes |
| 4 (maximum) | - context truncation |

**What the rewriter handles:**
- 150+ verbose phrase replacements ("due to the fact that" → "because", "in order to" → "to")
- Indirect question restructuring ("Can you tell me what X is" → "What is X?")
- Passive voice simplification ("It should be noted that X" → "X")
- Meta-commentary removal ("As I mentioned earlier" → removed)
- Intensifier reduction ("very unique" → "unique")
- Filler phrase removal ("I would like you to" → removed)
- Formatting cleanup (excess whitespace, redundant structure)
- Intent-aware gating — skips passes that would harm specific intent types (e.g. skips question-restructuring for debug prompts, preserves tone instructions for creative prompts)

**Useful flags:**

```bash
# Copy optimized prompt to clipboard automatically
promptfuel optimize "verbose prompt" --copy

# Set a token budget target
promptfuel optimize "verbose prompt" --budget 20

# Override intent detection manually
promptfuel optimize "verbose prompt" --intent debug

# Output only the optimized text (great for piping)
promptfuel optimize "verbose prompt" --output | pbcopy

# Use a specific model for token counting
promptfuel optimize "verbose prompt" --model claude-sonnet-4-6
```

### Analyze Token Count & Cost

```bash
promptfuel analyze "Explain how React hooks work" --model gpt-4o
```

Shows token count, estimated output tokens, cost breakdown, and context window usage.

```bash
# Pipe from stdin
echo "Your prompt" | promptfuel analyze
cat my-prompt.txt | promptfuel analyze --model claude-haiku-4-5
```

### Token-Saving Strategy Advisor

The `strategies` command scans your project directory and recommends actionable ways to save tokens:

```bash
promptfuel strategies
```

**Output:**
```
════════════════════════════════════════════════════════════
  PromptFuel — Token-Saving Strategy Advisor
════════════════════════════════════════════════════════════

  Project: my-app | 142 files scanned | Model: gpt-4o

  RECOMMENDATIONS (3 found)

  1. [HIGH] Create CLAUDE.md
     A CLAUDE.md file gives Claude persistent context about your
     project — tech stack, conventions, architecture. This eliminates
     the need to re-explain project details in every conversation,
     saving thousands of tokens per session.

     Estimated savings: ~5,000 tokens
     Cost savings: ~$0.0150
     Action: Create a CLAUDE.md file with auto-generated project context

  2. [MED] Create .cursorrules
     A .cursorrules file gives Cursor AI persistent project context,
     preventing redundant explanations about your tech stack.

     Estimated savings: ~3,000 tokens
     Action: Create a .cursorrules file for Cursor users

  TOTAL POTENTIAL SAVINGS
  Tokens : ~8,000
  Cost   : ~$0.0240

  Preview: CLAUDE.md
  ─────────────────────────────────
  │ # my-app
  │ A React application for...
  │ ## Tech Stack
  │ - react
  │ - typescript
  │ ...
  ─────────────────────────────────

  Create CLAUDE.md? [Y/n]
════════════════════════════════════════════════════════════
```

**What it detects:**

| Strategy | What it checks | Impact |
| --- | --- | --- |
| Missing CLAUDE.md | No project context file for Claude | HIGH — saves ~5,000 tokens/session |
| Missing .cursorrules | No Cursor rules file | MEDIUM — saves ~3,000 tokens/session |
| Oversized README | README > 5KB used as AI context | MEDIUM |
| Repeated context | Same text pasted across multiple messages | HIGH |
| Conversation pruning | Old messages no longer referenced | HIGH |
| Long messages | Single message > 2,000 tokens | MEDIUM |
| Expensive model | Using $15/1M model for simple prompts | MEDIUM |
| Missing format constraints | No output format guidance in prompts | HIGH — reduces output by 30-60% |
| High verbosity | Prompts consistently score > 40/100 verbosity | MEDIUM |
| System prompt bloat | Initial prompt > 500 tokens in long conversation | HIGH |
| Claude cache opportunity | Claude users without prompt caching | HIGH |

```bash
# Scan a specific directory
promptfuel strategies ./my-project

# Alias
promptfuel save
```

### Web Dashboard

Open a full insights dashboard in your browser:

```bash
promptfuel dashboard
```

This starts a local server at `http://localhost:3939` and opens your browser automatically.

The dashboard has four tabs:

- **Analyze & Optimize** — Paste a prompt, see intent detection, token counts, costs, and optimization suggestions in real-time. Apply optimizations with one click.
- **History** — Track all your optimizations over time. See total tokens saved, cost saved, and before/after for each optimization.
- **Strategies** — Paste a conversation transcript to analyze it for token-saving opportunities.
- **Insights** — Reads your real Claude Code usage data from `~/.claude/projects/` JSONL files and surfaces total tokens, costs, usage breakdowns by date and model, session details, and heaviest prompts. Includes 5 action cards:
  - **Auto-Optimize Prompts** — batch-optimize your most expensive prompts
  - **Model Savings Calculator** — see how much you'd save switching models
  - **Session Health Alerts** — flags sessions with unusually high spend
  - **CLAUDE.md Generator** — generates a project context file to reduce repeat explanations
  - **Cache Savings Analyzer** — clusters similar prompts and estimates semantic cache savings

```bash
# Use a custom port
promptfuel dashboard --port 4000
```

### Interactive TUI

Launch a terminal dashboard with live token counting as you type:

```bash
promptfuel
```

**Keyboard shortcuts:**

| Key | Action |
| --- | --- |
| `q` | Quit |
| `o` | Optimize current prompt |
| `m` | Cycle through models |
| `c` | Copy optimized prompt |

### Batch Analysis

Analyze multiple prompts from a JSON file:

```bash
promptfuel batch prompts.json --model gpt-4o
```

**Input format:**
```json
[
  "Explain how React hooks work",
  "Write a Python function for binary search",
  { "name": "Claude task", "content": "Summarize this article", "model": "claude-sonnet-4-6" }
]
```

### All CLI Commands

```
$ promptfuel                        Launch interactive TUI
$ promptfuel dashboard              Open web dashboard in browser
$ promptfuel analyze <prompt>       Analyze token count & cost
$ promptfuel optimize <prompt>      Optimize a prompt
$ promptfuel strategies [dir]       Analyze project for token-saving strategies
$ promptfuel batch <file.json>      Batch analyze prompts

Options:
  --model, -m     Model to use (default: gpt-4o)
  --budget, -b    Target token count for budget-aware compression (levels 1-4)
  --intent, -i    Override intent detection (debug|code-gen|refactor|explain|creative|general)
  --copy, -c      Copy optimized prompt to clipboard
  --output, -o    Output only the optimized prompt (for piping)
  --port, -p      Port for web dashboard (default: 3939)
```

---

## Chrome Extension

The Chrome extension adds real-time token and cost monitoring directly inside ChatGPT and Claude.

### Installation

```bash
pnpm --filter @promptfuel/extension build
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select `packages/extension/dist`
4. Go to [chat.openai.com](https://chat.openai.com) or [claude.ai](https://claude.ai)

### What You Get

**Floating badge** in the bottom-right corner showing token count and cost as you type.

Click it to expand the detail panel:
- **Token Breakdown** — input tokens and estimated output
- **Cost Estimate** — input, output, and total cost
- **Context Window** — progress bar with color warnings (green/yellow/orange/red)
- **Optimize** — get optimization suggestions for your current prompt
- **Side-by-Side Compare** — see original vs optimized prompt
- **Apply Optimized** — replace your prompt with the optimized version
- **Model Selector** — switch between models

**Popup** (click the extension icon in the toolbar):
- Session stats (tokens used, total cost)
- Spending trends (today, this week, week-over-week)
- Average tokens per prompt

### Supported Sites

| Site | URLs |
| --- | --- |
| ChatGPT | `chat.openai.com`, `chatgpt.com` |
| Claude | `claude.ai` |

---

## SDK for Developers

Use PromptFuel programmatically in your Node.js apps.

```bash
npm install @promptfuel/sdk
```

### Basic Usage

```typescript
import { PromptFuel } from '@promptfuel/sdk';

const pf = new PromptFuel({ model: 'gpt-4o' });

// Analyze a prompt
const analysis = pf.analyze('Explain how database indexing works');
console.log(analysis.tokens.input);   // 7
console.log(analysis.cost.total);     // "$0.003008"

// Optimize a prompt (intent is detected automatically)
const result = pf.optimize('I would like you to please explain how database indexing works in detail');
console.log(result.intent);             // { type: "explain", confidence: 0.6, matchedSignals: [...] }
console.log(result.optimizedPrompt);    // "Explain how database indexing works in detail"
console.log(result.reductionPercent);   // 42
console.log(result.suggestions.length); // 2

// List all supported models
console.log(PromptFuel.listModels());
```

### Intent Detection

Every call to `optimize()` automatically detects the prompt's intent:

```typescript
import { optimize, detectIntent } from '@promptfuel/core';

// Standalone intent detection
const intent = detectIntent('Help me debug this error step by step');
console.log(intent.type);           // "debug"
console.log(intent.confidence);     // 0.83
console.log(intent.matchedSignals); // ["error-keyword", "reasoning-marker"]

// Intent affects optimization — "step by step" is preserved for debug prompts
const result = optimize('Please help me debug this error step by step', 'gpt-4o');
console.log(result.optimizedPrompt); // "Debug this error step by step"
console.log(result.intent);          // { type: "debug", confidence: 0.83, ... }
```

**6 intent types:**

| Intent | Triggers on | What it protects |
| --- | --- | --- |
| `debug` | error, bug, stack trace, "step by step" | Reasoning markers, error messages, code blocks |
| `code-gen` | "write a function", framework names | Code blocks |
| `refactor` | "refactor", "clean up", scope constraints | "only change X", "don't touch Y" |
| `explain` | "explain", "how does X work", ELI5 | Simplicity requests |
| `creative` | "write a story", tone/style instructions | Tone and style directives |
| `general` | No strong signals detected | Nothing — full optimization applied |

### Token Budget Targeting

Set a target token count and PromptFuel progressively compresses until it fits:

```typescript
import { optimize } from '@promptfuel/core';

const result = optimize(
  'Please help me debug this step by step and provide a detailed and comprehensive explanation',
  'gpt-4o',
  { targetTokens: 12 }
);

console.log(result.budget);
// {
//   levelApplied: 2,      // compression level used (1-4)
//   targetMet: true,       // whether the budget was hit
//   remainingGap: 0,       // tokens over budget (0 if met)
//   targetTokens: 12
// }
console.log(result.optimizedTokens); // 10
console.log(result.intent);          // { type: "debug", ... }

// You can also override intent manually
const r2 = optimize('some prompt', 'gpt-4o', { targetTokens: 20, intent: 'code-gen' });
```

### Context Monitoring

Track token usage across a multi-turn conversation:

```typescript
const monitor = pf.createMonitor();

monitor.addMessage({ role: 'user', content: 'Explain React hooks.' });
monitor.addMessage({ role: 'assistant', content: 'React hooks are...' });

const status = monitor.getStatus();
console.log(status.percentUsed);      // 0 (of 128K context)
console.log(status.warning);          // "green"
console.log(status.remainingTokens);  // 127953
```

**Warning levels:**

| Level | Context Used | Meaning |
| --- | --- | --- |
| `green` | < 50% | Plenty of room |
| `yellow` | 50–75% | Getting full |
| `orange` | 75–90% | Running low |
| `red` | 90%+ | Near limit, responses may truncate |

### Custom Optimization Rules

Add domain-specific rules to the optimizer:

```typescript
import { registerRule, optimize } from '@promptfuel/sdk';

registerRule({
  name: 'no-politeness',
  detect: (text) => {
    const results = [];
    if (/\bplease\b/i.test(text)) {
      results.push({
        original: 'please', optimized: '', tokensSaved: 0,
        rule: 'no-politeness',
        description: 'Remove "please" — LLMs respond the same without it',
      });
    }
    return results;
  },
  apply: (text) => text.replace(/\bplease\s*/gi, '').trim(),
});

const result = optimize('Please write a sort function.', 'gpt-4o');
// → "Write a sort function."
```

### Express Middleware

Add token monitoring headers to your API routes:

```typescript
import { promptFuelMiddleware } from '@promptfuel/sdk/middleware';

app.use('/api/chat', promptFuelMiddleware({ model: 'gpt-4o', warnAt: 0.75 }));
// Adds headers: X-PromptFuel-Input-Tokens, X-PromptFuel-Estimated-Cost, etc.
```

---

## Supported Models

### OpenAI

| Model | Input | Output | Context |
| --- | --- | --- | --- |
| `gpt-4o` | $2.50/1M | $10.00/1M | 128K |
| `gpt-4o-mini` | $0.15/1M | $0.60/1M | 128K |
| `gpt-4-turbo` | $10.00/1M | $30.00/1M | 128K |
| `gpt-3.5-turbo` | $0.50/1M | $1.50/1M | 16K |
| `o1` | $15.00/1M | $60.00/1M | 200K |
| `o1-mini` | $3.00/1M | $12.00/1M | 128K |
| `o3` | $10.00/1M | $40.00/1M | 200K |
| `o3-mini` | $1.10/1M | $4.40/1M | 200K |

### Anthropic (Claude)

| Model | Input | Output | Context |
| --- | --- | --- | --- |
| `claude-opus-4-6` | $15.00/1M | $75.00/1M | 200K |
| `claude-sonnet-4-6` | $3.00/1M | $15.00/1M | 200K |
| `claude-haiku-4-5` | $0.80/1M | $4.00/1M | 200K |
| `claude-3.5-sonnet` | $3.00/1M | $15.00/1M | 200K |
| `claude-3-opus` | $15.00/1M | $75.00/1M | 200K |
| `claude-3-haiku` | $0.25/1M | $1.25/1M | 200K |

Default model is `gpt-4o`. Use `--model` (CLI) or `model` option (SDK) to switch.

---

## How It Works

PromptFuel runs entirely locally — no API calls, no data sent anywhere. Everything is rule-based and deterministic.

### Optimization Pipeline

```
Your prompt
  ↓
1. Intent detection (debug | code-gen | refactor | explain | creative | general)
  ↓
2. Pattern protection (preserve "step by step", code blocks, scope constraints, etc.)
  ↓
3. Optimization (intent-gated)
   ├── Filler removal (41 phrases)
   ├── Formatting cleanup
   ├── 150+ verbose phrase replacements
   ├── Question restructuring (indirect → direct)
   ├── Passive → active voice
   └── Sentence compression
  ↓
4. Budget compression (if --budget set)
   Level 1 → 2 → 3 → 4 until target met
  ↓
5. Pattern restoration (protected phrases restored)
  ↓
6. Custom rules (if registered)
  ↓
Optimized prompt + intent + budget result + suggestions + token savings
```

### Token Accuracy

- **OpenAI models**: Exact counts via `tiktoken` library (100% accurate)
- **Claude models**: Uses `cl100k_base` encoding with 0.97 correction factor (~94% accurate)

### Verbosity Score

Every prompt gets a score from 0 (concise) to 100 (very verbose):

| Score | Meaning |
| --- | --- |
| 0–20 | Clean and concise |
| 20–40 | Slightly verbose |
| 40–60 | Worth optimizing |
| 60–80 | Very verbose |
| 80–100 | Major rewrite recommended |

---

## Project Structure

```
promptfuel/
├── packages/
│   ├── core/        # Shared engine (tokenizer, optimizer, intent, rewriter, cost, monitor, strategies)
│   ├── sdk/         # npm package for developers
│   ├── cli/         # Terminal commands, TUI dashboard, web server
│   ├── web/         # React web dashboard
│   └── extension/   # Chrome extension (Manifest V3)
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Architecture:**
```
@promptfuel/cli ──────┐
@promptfuel/sdk ──────┤
@promptfuel/web ──────┼──► @promptfuel/core
@promptfuel/extension ┘
```

All consumer packages depend on `@promptfuel/core`. No cross-dependencies.

---

## Development

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Watch mode (all packages)
pnpm test             # Run all tests (71 tests across 6 files)
pnpm lint             # Lint all packages
pnpm clean            # Remove all dist folders
```

**Package-specific:**
```bash
pnpm --filter @promptfuel/core test        # Run core tests
pnpm --filter @promptfuel/cli build        # Build CLI
pnpm --filter @promptfuel/web dev          # Web dev server
pnpm --filter @promptfuel/extension build  # Build Chrome extension
```

---

## License

MIT
