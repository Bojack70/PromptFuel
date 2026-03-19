# PromptFuel — User Guide

A complete toolkit for intent-aware prompt optimization, token budget targeting, cost intelligence, and context monitoring for ChatGPT, Claude, and Gemini.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Uninstall](#uninstall)
- [CLI Tool](#cli-tool)
  - [Optimize Command](#optimize-command)
  - [Analyze Command](#analyze-command)
  - [Batch Command](#batch-command)
  - [Strategy Advisor](#strategy-advisor)
  - [Claude Code Insights](#claude-code-insights)
  - [Interactive TUI](#interactive-tui)
  - [Web Dashboard](#web-dashboard)
- [MCP Server for Claude Code](#mcp-server-for-claude-code)
- [Chrome Extension](#chrome-extension)
- [Web Interface](#web-interface)
  - [Insights Tab](#insights-tab)
- [SDK for Developers](#sdk-for-developers)
  - [Basic Usage](#basic-usage)
  - [Intent Detection](#intent-detection)
  - [Token Budget Targeting](#token-budget-targeting)
  - [Context Monitoring](#context-monitoring)
  - [Claude Cache Analysis](#claude-cache-analysis)
  - [Custom Optimization Rules](#custom-optimization-rules)
  - [Express Middleware](#express-middleware)
- [Supported Models](#supported-models)
- [How Optimization Works](#how-optimization-works)
- [Development](#development)

---

## Quick Start

```bash
# Install globally — automatically adds "pf" alias + configures MCP for Claude Code
npm install -g promptfuel --no-fund

# Optimize a prompt (intent detected automatically)
pf optimize "I would like you to please explain how React hooks work in detail"

# Optimize with a token budget
pf optimize "Please help me debug this error step by step" --budget 10

# Auto-optimize every message in Claude Code (say this once in Claude Code)
enable auto optimize

# See your Claude Code token usage across all projects
pf insights

# Launch the interactive dashboard
pf
```

---

## Installation

PromptFuel requires **Node.js 18+**.

```bash
# Install globally (recommended)
npm install -g promptfuel --no-fund
```

This automatically:
- Installs the `promptfuel` binary and `pf` alias
- Configures the MCP server in `~/.claude/mcp.json` for Claude Code

**For development (running from source):**

```bash
git clone https://github.com/Bojack70/PromptFuel.git
cd PromptFuel
pnpm install
pnpm build
```

---

## Uninstall

```bash
# Option 1: Use the uninstall command (removes alias + MCP config, then shows npm command)
pf uninstall

# Option 2: Just run npm uninstall — preuninstall hook cleans up automatically
npm uninstall -g promptfuel
```

Both options remove:
- The `alias pf="promptfuel"` line from your shell config (`.zshenv` / `.bashrc` / `config.fish`)
- The `promptfuel` entry from `~/.claude/mcp.json`

---

## CLI Tool

### Optimize Command

Get intent-aware optimization suggestions and a cleaned-up version of your prompt.

```bash
pf optimize "Your verbose prompt" --model gpt-4o
```

**Example with intent detection:**

```bash
$ pf optimize "Can you please help me debug this error step by step and provide a detailed explanation"
```

Output:

```
────────────────────────────────────────────────────
  PromptFuel — Prompt Optimizer
────────────────────────────────────────────────────

  Model  : gpt-4o
  Intent : debug (83% confidence)
  Signals: error-keyword, reasoning-marker

────────────────────────────────────────────────────
  ORIGINAL PROMPT
────────────────────────────────────────────────────
  "Can you please help me debug this error step by step
   and provide a detailed explanation"

  Tokens : 20 input

────────────────────────────────────────────────────
  OPTIMIZED PROMPT
────────────────────────────────────────────────────
  "Debug this error step by step. Explain why."

  Tokens : 10 input

────────────────────────────────────────────────────
  SAVINGS SUMMARY
────────────────────────────────────────────────────
  Token reduction  : 10 tokens (50%)

────────────────────────────────────────────────────
  SUGGESTIONS
────────────────────────────────────────────────────
  1. [filler] Remove filler phrase: "Can you please help me"
  2. [rewrite-verbose-phrase] "provide a detailed explanation" → "Explain why"
  3. [intent-protected] Preserved "step by step" (debug intent)
────────────────────────────────────────────────────
```

**With a token budget:**

```bash
$ pf optimize "verbose prompt here" --budget 15
```

PromptFuel progressively applies compression levels (1–4) until your token target is met:

| Level | What it applies |
| --- | --- |
| 1 (light) | Filler removal, formatting cleanup |
| 2 (moderate) | + redundancy, duplicates, verbose phrases, sentence compression |
| 3 (aggressive) | + all detectors, all rewriter passes |
| 4 (maximum) | + context truncation |

Intent-gating applies at every level — protected patterns (e.g. "step by step" in debug prompts) are never removed regardless of compression level.

**Useful flags:**

```bash
# Copy the optimized prompt to clipboard
pf optimize "verbose prompt" --copy

# Set a token budget target
pf optimize "verbose prompt" --budget 20

# Override intent detection manually
pf optimize "verbose prompt" --intent debug

# Maximum compression (removes hedge adverbs, weak qualifiers, low-value openers)
pf optimize "verbose prompt" --aggressive

# Output only the optimized text (great for piping)
pf optimize "verbose prompt" --output | pbcopy

# Use a specific model for token counting
pf optimize "verbose prompt" --model claude-sonnet-4-6
```

### Analyze Command

Count tokens and estimate costs for a prompt.

```bash
pf analyze "Your prompt here" --model gpt-4o
```

**Example:**

```bash
$ pf analyze "Write a Python function that calculates fibonacci numbers recursively"
```

Output:

```
══════════════════════════════════════════════════
  PromptFuel — Prompt Analysis
══════════════════════════════════════════════════

  Model        : gpt-4o
  Context      : 128,000 tokens

──────────────────────────────────────────────────
  TOKEN BREAKDOWN
──────────────────────────────────────────────────
  Input tokens         : 10
  Est. output tokens   : 800
  Total tokens         : 810

──────────────────────────────────────────────────
  COST ESTIMATE
──────────────────────────────────────────────────
  Input cost           : $0.000025   (@ $2.50/1M tokens)
  Est. output cost     : $0.0080     (@ $10.00/1M tokens)
  Total cost           : $0.0080

──────────────────────────────────────────────────
  CONTEXT WINDOW USAGE
──────────────────────────────────────────────────
  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%  [OK]
  10 / 128,000 tokens used
  127,990 tokens remaining
══════════════════════════════════════════════════
```

You can also pipe input from stdin:

```bash
echo "Explain quantum computing" | pf analyze --model claude-sonnet-4-6
cat my-prompt.txt | pf analyze
```

### Batch Command

Analyze multiple prompts at once from a JSON file.

```bash
pf batch prompts.json --model gpt-4o
```

**Input file format — simple string array:**

```json
[
  "Explain how React hooks work",
  "Write a Python function for binary search",
  "Summarize the key points of machine learning"
]
```

**Input file format — objects with names and per-prompt models:**

```json
[
  {
    "name": "Code generation",
    "content": "I would like you to please write a Python function that calculates the factorial of a number."
  },
  {
    "name": "Claude task",
    "content": "Summarize this article in 3 bullet points",
    "model": "claude-sonnet-4-6"
  }
]
```

### Strategy Advisor

Scan your project directory for actionable token-saving recommendations.

```bash
pf strategies

# Scan a specific directory
pf strategies ./my-project
```

### Claude Code Insights

Read your real Claude Code session data and show token usage + cost across all projects.

```bash
pf insights
```

For the full breakdown with heaviest prompts, session details, and 5 action cards, run `pf dashboard`.

### Interactive TUI

Launch a full-screen terminal UI by running `pf` with no arguments:

```bash
pf
```

**Keyboard shortcuts:**

| Key | Action |
| --- | --- |
| `q` | Quit |
| `o` | Optimize current prompt |
| `m` | Cycle through models |
| `c` | Copy optimized prompt |
| `Tab` | Switch between panels |

### Web Dashboard

Open a full insights dashboard in your browser:

```bash
pf dashboard

# Use a custom port
pf dashboard --port 4000
```

Starts a local server at `http://localhost:3939` and opens the **Insights tab** with your real Claude Code usage data.

### All CLI Commands

```
$ pf                          Launch interactive TUI
$ pf setup                    Add "pf" alias + configure MCP (run once)
$ pf uninstall                Remove alias + MCP config, then npm uninstall
$ pf optimize <prompt>        Optimize a prompt
$ pf analyze <prompt>         Analyze token count & cost
$ pf strategies [dir]         Analyze project for token-saving strategies
$ pf insights                 Show Claude Code usage across all projects
$ pf dashboard                Open web dashboard (Insights tab)
$ pf batch <file.json>        Batch analyze prompts

Options:
  --model, -m       Model (default: gpt-4o)
  --budget, -b      Target token count for budget-aware compression (levels 1-4)
  --intent, -i      Override intent detection (debug|code-gen|refactor|explain|creative|general)
  --aggressive, -a  Maximum compression
  --copy, -c        Copy optimized prompt to clipboard
  --output, -o      Output only the optimized prompt (for piping)
  --port, -p        Port for web dashboard (default: 3939)
```

---

## MCP Server for Claude Code

PromptFuel includes an MCP server (`@promptfuel/mcp`) that brings all its tools directly into Claude Code — no terminal switching required.

### Setup (one-time)

Run after installing:

```bash
pf setup
```

Or it runs automatically as part of `npm install -g promptfuel`. Restart Claude Code once, then tools are available in every conversation.

### Available Tools (6)

| Tool | What it does |
| --- | --- |
| `optimize_prompt` | Optimize a prompt — supports `budget` (target token count), `intent` override, `aggressive` compression |
| `count_tokens` | Count tokens + estimated API cost for a model |
| `compare_models` | Compare cost of a prompt across multiple models |
| `analyze_strategies` | Scan a project directory for token-saving recommendations |
| `list_models` | List all 23 supported model IDs |
| `claude_insights` | Read `~/.claude/projects/` and show token usage + cost |

### Auto-Optimize Mode

Say this once in Claude Code:

```
enable auto optimize
```

Every subsequent message is automatically optimized for the rest of the session. Claude shows a one-line savings summary per message:

```
✓ Optimized: saved 14 tokens (41% reduction)
```

### Usage Examples

```
enable auto optimize

Optimize this prompt: "Can you please help me understand how async/await works"

optimize_prompt "Debug this error step by step" budget:200 aggressive:true

optimize_prompt "Can you please refactor this function" intent:refactor

Count the tokens in my system prompt for claude-sonnet-4-6

Compare the cost of this prompt across GPT-4o, Claude Sonnet, and Haiku

Scan this project for token-saving opportunities

Show my Claude Code usage insights
```

### Manual Config

```json
// ~/.claude/mcp.json
{
  "mcpServers": {
    "promptfuel": {
      "command": "npx",
      "args": ["@promptfuel/mcp"]
    }
  }
}
```

---

## Chrome Extension

The Chrome extension adds real-time token and cost monitoring directly inside ChatGPT, Claude, and Gemini.

### Installation

```bash
# Build the extension
pnpm --filter @promptfuel/extension build
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `packages/extension/dist` folder
5. Navigate to ChatGPT, Claude, or Gemini

### Features

**Floating Badge** — appears in the bottom-right corner showing:
- Current token count
- Estimated cost

Click the badge to expand the **detail panel**:

- **Token Breakdown** — input tokens and estimated output tokens
- **Cost Estimate** — input cost, output cost, and total
- **Context Window** — progress bar with color-coded warnings (green/yellow/orange/red)
- **Optimize** — click to see suggestions for the current prompt
- **Side-by-Side Compare** — view original vs optimized prompt side by side
- **Apply Optimized** — replace your prompt with the optimized version
- **Model Selector** — switch between models (auto-detected from the page)

**Popup** (click the extension icon):
- Current session stats (tokens used, cost)
- Spending trends (today, this week, week-over-week change)
- Average tokens per prompt
- Reset session button

### Supported Sites

| Site | URL Patterns |
| --- | --- |
| ChatGPT | `chat.openai.com/*`, `chatgpt.com/*` |
| Claude | `claude.ai/*` |
| Gemini | `gemini.google.com/*` |

Model is auto-detected from the page with retry logic (0 / 500ms / 1.5s / 3s). Manual model selection in the widget overrides auto-detection.

---

## Web Interface

A standalone web app for analyzing and optimizing prompts in the browser.

### Running Locally

```bash
# Development server
pnpm --filter @promptfuel/web dev

# Build for production
pnpm --filter @promptfuel/web build
```

### Features

1. **Paste or type** your prompt in the text area
2. Analysis runs automatically as you type (200ms debounce)
3. **Intent badge** — shows detected intent type and confidence score
4. See four stat cards: Input Tokens, Est. Output, Total Tokens, Estimated Cost
5. **Cost Breakdown** — input vs output cost details
6. **Context Window** — visual bar with percentage and remaining tokens
7. **Optimization Suggestions** — listed with rule types, token savings, and verbosity score
8. **Token Budget Slider** — set a target token count and see compression level applied
9. **Show Optimized Prompt** — toggle to preview the cleaned-up version
10. **Apply Optimization** — replaces the textarea content with the optimized prompt
11. **Copy Optimized** — copies the optimized prompt to clipboard
12. **Model Selector** — choose from 23+ models

### Insights Tab

The Insights tab provides deep cost intelligence by reading your real Claude Code usage data.

**How it works:**
- Automatically reads JSONL conversation files from `~/.claude/projects/`
- Parses token counts, model usage, timestamps, and costs from each session
- No data is sent anywhere — everything runs locally in your browser

**What you see:**
- **Usage overview** — total tokens, total cost, usage breakdown by date and model
- **Session breakdown** — per-session costs with drill-down into individual prompts
- **Heaviest prompts** — your most expensive prompts ranked by token count

**5 Action Cards:**

| Card | What it does |
| --- | --- |
| **Auto-Optimize Prompts** | Batch-runs the optimizer on your most expensive prompts and shows potential savings |
| **Model Savings Calculator** | Compares your current model costs against cheaper alternatives |
| **Session Health Alerts** | Flags sessions with unusually high spend or token usage |
| **CLAUDE.md Generator** | Generates a project context file so Claude doesn't re-read your entire project every session |
| **Cache Savings Analyzer** | Clusters similar prompts via Jaccard similarity and estimates how much semantic caching would save |

Each card shows estimated savings and provides actionable next steps.

---

## SDK for Developers

Install the SDK in your project to analyze prompts programmatically.

```bash
npm install @promptfuel/sdk
```

### Basic Usage

```typescript
import { PromptFuel } from '@promptfuel/sdk';

const pf = new PromptFuel({ model: 'gpt-4o' });

// Analyze a prompt
const analysis = pf.analyze('Explain how database indexing works');
console.log(analysis.tokens.input);     // 7
console.log(analysis.cost.total);       // "$0.003008"

// Optimize a prompt (intent is detected automatically)
const result = pf.optimize(
  'I would like you to please explain how database indexing works in detail'
);
console.log(result.intent);             // { type: "explain", confidence: 0.6, ... }
console.log(result.tokenReduction);     // 8
console.log(result.reductionPercent);   // 42
console.log(result.optimizedPrompt);    // "Explain how database indexing works in detail"

// List all supported models
console.log(PromptFuel.listModels());
```

### Intent Detection

Every call to `optimize()` automatically classifies the prompt into one of 6 intent types.

```typescript
import { optimize, detectIntent } from '@promptfuel/core';

const intent = detectIntent('Help me debug this error step by step');
console.log(intent.type);           // "debug"
console.log(intent.confidence);     // 0.83
console.log(intent.matchedSignals); // ["error-keyword", "reasoning-marker"]

// "step by step" is preserved for debug prompts
const result = optimize('Please help me debug this error step by step', 'gpt-4o');
console.log(result.optimizedPrompt); // "Debug this error step by step"
```

**6 intent types and what they protect:**

| Intent | Triggers on | What it protects |
| --- | --- | --- |
| `debug` | error, bug, stack trace, "step by step" | Reasoning markers, error messages, code blocks |
| `code-gen` | "write a function", framework names | Code blocks |
| `refactor` | "refactor", "clean up", scope constraints | "only change X", "don't touch Y" |
| `explain` | "explain", "how does X work", ELI5 | Simplicity requests |
| `creative` | "write a story", tone/style instructions | Tone and style directives |
| `general` | No strong signals detected | Nothing — full optimization applied |

You can override intent detection manually:

```typescript
const result = optimize('some prompt', 'gpt-4o', { intent: 'code-gen' });
```

### Token Budget Targeting

Set a target token count and PromptFuel progressively compresses until it fits.

```typescript
import { optimize } from '@promptfuel/core';

const result = optimize(
  'Please help me debug this step by step and provide a detailed and comprehensive explanation',
  'gpt-4o',
  { targetTokens: 12 }
);

console.log(result.budget);
// { levelApplied: 2, targetMet: true, remainingGap: 0, targetTokens: 12 }
console.log(result.optimizedTokens); // 10

// Combine with intent override
const r2 = optimize('some prompt', 'gpt-4o', { targetTokens: 20, intent: 'code-gen' });
```

**Budget compression levels:**

| Level | Detectors | Rewriter Passes | Context Truncation |
| --- | --- | --- | --- |
| 1 (light) | filler, formatting | none | no |
| 2 (moderate) | + redundancy, duplicates | verbose-phrases, sentence-compression | no |
| 3 (aggressive) | all 7 detectors | all 4 passes | no |
| 4 (maximum) | all 7 detectors | all 4 passes | yes |

### Context Monitoring

Track token usage across a multi-turn conversation.

```typescript
import { PromptFuel } from '@promptfuel/sdk';

const pf = new PromptFuel({ model: 'gpt-4o' });
const monitor = pf.createMonitor();

monitor.addMessage({ role: 'system', content: 'You are a helpful assistant.' });
monitor.addMessage({ role: 'user', content: 'Explain React hooks.' });
monitor.addMessage({ role: 'assistant', content: 'React hooks are functions...' });

const status = monitor.getStatus();
console.log(status.percentUsed);      // 0 (of 128k context)
console.log(status.warning);          // "green"
console.log(status.remainingTokens);  // 127953

monitor.clear(); // reset for new conversation
```

**Warning levels:**

| Level | Context Used | Meaning |
| --- | --- | --- |
| `green` | < 50% | Plenty of room |
| `yellow` | 50–75% | Getting full |
| `orange` | 75–90% | Running low |
| `red` | 90%+ | Near limit, responses may be truncated |

### Claude Cache Analysis

Track how effectively Claude's prompt caching is working.

```typescript
import { ContextMonitor } from '@promptfuel/sdk';

const monitor = new ContextMonitor('claude-sonnet-4-6');

monitor.addMessage({
  role: 'system',
  content: 'You are a code review assistant...',
  cacheCreationTokens: 500,
  cacheReadTokens: 0,
});

monitor.addMessage({
  role: 'user',
  content: 'Review this function...',
  cacheCreationTokens: 0,
  cacheReadTokens: 500,
});

const cacheStats = monitor.getCacheStats();
console.log(cacheStats.cacheHitRate);          // 50 (percent)
console.log(cacheStats.estimatedCacheSavings); // $0.001275
```

### Custom Optimization Rules

Add your own domain-specific optimization rules.

```typescript
import { registerRule, unregisterRule, optimize } from '@promptfuel/sdk';

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

unregisterRule('no-politeness');
```

### Express Middleware

Add token monitoring to your API routes.

```typescript
import express from 'express';
import { promptFuelMiddleware } from '@promptfuel/sdk/middleware';

const app = express();
app.use(express.json());

app.use('/api/chat', promptFuelMiddleware({ model: 'gpt-4o', warnAt: 0.75 }));
// Adds headers: X-PromptFuel-Input-Tokens, X-PromptFuel-Estimated-Cost, etc.
```

---

## Supported Models

### OpenAI

| Model | Input Cost | Output Cost | Context Window |
| --- | --- | --- | --- |
| `gpt-4o` | $2.50/1M | $10.00/1M | 128,000 |
| `gpt-4o-mini` | $0.15/1M | $0.60/1M | 128,000 |
| `gpt-4-turbo` | $10.00/1M | $30.00/1M | 128,000 |
| `gpt-3.5-turbo` | $0.50/1M | $1.50/1M | 16,385 |
| `o1` | $15.00/1M | $60.00/1M | 200,000 |
| `o1-mini` | $3.00/1M | $12.00/1M | 128,000 |
| `o3` | $10.00/1M | $40.00/1M | 200,000 |
| `o3-mini` | $1.10/1M | $4.40/1M | 200,000 |

### Anthropic (Claude)

| Model | Input Cost | Output Cost | Context Window |
| --- | --- | --- | --- |
| `claude-opus-4-6` | $15.00/1M | $75.00/1M | 200,000 |
| `claude-sonnet-4-6` | $3.00/1M | $15.00/1M | 200,000 |
| `claude-haiku-4-5` | $0.80/1M | $4.00/1M | 200,000 |
| `claude-3.5-sonnet` | $3.00/1M | $15.00/1M | 200,000 |
| `claude-3-opus` | $15.00/1M | $75.00/1M | 200,000 |
| `claude-3-haiku` | $0.25/1M | $1.25/1M | 200,000 |

### Google (Gemini)

| Model | Input Cost | Output Cost | Context Window |
| --- | --- | --- | --- |
| `gemini-3.1-pro` | $2.00/1M | $12.00/1M | 1,000,000 |
| `gemini-2.5-pro` | $1.25/1M | $10.00/1M | 1,000,000 |
| `gemini-3-flash` | $0.50/1M | $3.00/1M | 1,000,000 |
| `gemini-2.5-flash` | $0.30/1M | $2.50/1M | 1,000,000 |
| `gemini-2.5-flash-lite` | $0.10/1M | $0.40/1M | 1,000,000 |
| `gemini-2.0-flash` | $0.10/1M | $0.40/1M | 1,000,000 |
| `gemini-2.0-flash-lite` | $0.075/1M | $0.30/1M | 1,000,000 |
| `gemini-1.5-pro` | $1.25/1M | $5.00/1M | 2,000,000 |
| `gemini-1.5-flash` | $0.075/1M | $0.30/1M | 1,000,000 |

Use the `--model` flag (CLI) or `model` option (SDK) to select a model. Default is `gpt-4o`.

---

## How Optimization Works

PromptFuel uses a rule-based optimization pipeline (no API calls — everything runs locally).

### Optimization Pipeline

```
Your prompt
  ↓
1. Intent detection → debug | code-gen | refactor | explain | creative | general
  ↓
2. Pattern protection → preserve "step by step", code blocks, scope constraints, tone directives
  ↓
3. Optimization (intent-gated — some passes skipped based on intent)
   ├── Filler removal (41 phrases)
   ├── Formatting cleanup
   ├── Redundancy + duplicate detection
   ├── 150+ verbose phrase replacements
   ├── Question restructuring (indirect → direct)
   ├── Passive → active voice
   └── Sentence compression
  ↓
4. Budget compression (if --budget set)
   Level 1 → 2 → 3 → 4 until target met
  ↓
5. Pattern restoration → protected phrases restored to original text
  ↓
6. Custom rules (if registered)
  ↓
Optimized prompt + intent + budget result + suggestions + token savings
```

### Built-in Rules

| Rule | What it does | Example |
| --- | --- | --- |
| **Filler removal** | Removes 40+ unnecessary phrases | "I would like you to" → removed |
| **Redundancy** | Detects repeated n-grams and near-duplicate sentences | "Be fast. Make it fast." → merge |
| **Duplicate detection** | Finds instructions that say the same thing differently | "Be concise. Keep it brief." → merge |
| **Formatting cleanup** | Removes excess whitespace, blank lines, over-structured markdown | 5 blank lines → 2 |
| **Negative instructions** | Rephrases "don't" as positive directives | "Don't be verbose" → "Be concise" |
| **Weak hedging** | Removes tentative language | "Try to explain" → "Explain" |

### Verbosity Score

Every prompt gets a verbosity score from 0 (concise) to 100 (very verbose):

| Score | Meaning | Action |
| --- | --- | --- |
| 0–20 | Clean and concise | No optimization needed |
| 20–40 | Slightly verbose | Minor improvements possible |
| 40–60 | Moderately verbose | Worth optimizing |
| 60–80 | Very verbose | Significant savings available |
| 80–100 | Extremely verbose | Major rewrite recommended |

### Token Accuracy

- **OpenAI models**: Uses `tiktoken` for exact token counts (100% accurate)
- **Claude models**: Uses `cl100k_base` encoding as a proxy with a 0.97 correction factor (~94% accurate)

---

## Development

### Project Structure

```
promptfuel/
├── packages/
│   ├── core/        # Shared engine (tokenizer, optimizer, intent, rewriter, cost, monitor, strategies)
│   ├── sdk/         # npm package for developers
│   ├── cli/         # Terminal commands, TUI dashboard, web server, insights reader
│   ├── web/         # React web dashboard
│   ├── mcp/         # MCP server for Claude Code (6 tools + auto-optimize prompt)
│   └── extension/   # Chrome extension (Manifest V3, ChatGPT + Claude + Gemini)
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Watch mode (all packages)
pnpm test             # Run all tests (124 core tests)
pnpm lint             # Lint all packages
pnpm clean            # Remove all dist folders
```

### Package-specific

```bash
pnpm --filter @promptfuel/core test        # Run core tests
pnpm --filter @promptfuel/cli build        # Build CLI
pnpm --filter @promptfuel/web dev          # Start web dev server
pnpm --filter @promptfuel/mcp build        # Build MCP server
pnpm --filter @promptfuel/extension build  # Build Chrome extension
```
