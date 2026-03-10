# PromptFuel — User Guide

A complete toolkit for intent-aware prompt optimization, token budget targeting, cost intelligence, and context monitoring for ChatGPT and Claude.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [CLI Tool](#cli-tool)
  - [Analyze Command](#analyze-command)
  - [Optimize Command](#optimize-command)
  - [Batch Command](#batch-command)
  - [Interactive Dashboard](#interactive-dashboard)
- [Chrome Extension](#chrome-extension)
- [Web Interface](#web-interface)
  - [Insights Tab](#insights-tab)
- [SDK for Developers](#sdk-for-developers)
  - [Basic Usage](#basic-usage)
  - [Intent Detection](#intent-detection)
  - [Token Budget Targeting](#token-budget-targeting)
  - [Context Monitoring](#context-monitoring)
  - [Claude Cache Analysis](#claude-cache-analysis)
  - [Cache Analysis API](#cache-analysis-api)
  - [Custom Optimization Rules](#custom-optimization-rules)
  - [Express Middleware](#express-middleware)
- [Supported Models](#supported-models)
- [How Optimization Works](#how-optimization-works)
- [Development](#development)

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Analyze a prompt
npx promptfuel analyze "Explain how React hooks work"

# Optimize a verbose prompt (intent is detected automatically)
npx promptfuel optimize "I would like you to please explain how React hooks work in detail"

# Optimize with a token budget target
npx promptfuel optimize "Please help me debug this error step by step" --budget 10

# Launch the interactive dashboard
npx promptfuel
```

---

## Installation

PromptFuel requires **Node.js 18+** and **pnpm**.

```bash
# Clone and install
git clone <repo-url>
cd promptfuel
pnpm install
pnpm build
```

To use the CLI globally:

```bash
pnpm --filter @promptfuel/cli build
npm link packages/cli
```

---

## CLI Tool

The CLI provides four modes: `analyze`, `optimize`, `batch`, and an interactive dashboard.

### Analyze Command

Count tokens and estimate costs for a prompt.

```bash
promptfuel analyze "Your prompt here" --model gpt-4o
```

**Example:**

```bash
$ promptfuel analyze "Write a Python function that calculates fibonacci numbers recursively"
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
echo "Explain quantum computing" | promptfuel analyze --model claude-sonnet-4-6
cat my-prompt.txt | promptfuel analyze
```

### Optimize Command

Get intent-aware optimization suggestions and a cleaned-up version of your prompt.

```bash
promptfuel optimize "Your verbose prompt" --model gpt-4o
```

**Example with intent detection:**

```bash
$ promptfuel optimize "Can you please help me debug this error step by step and provide a detailed explanation"
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
$ promptfuel optimize "verbose prompt here" --budget 15
```

PromptFuel progressively applies compression levels (1–4) until your token target is met:

| Level | What it applies |
| --- | --- |
| 1 (light) | Filler removal, formatting cleanup |
| 2 (moderate) | - redundancy, duplicates, verbose phrases, sentence compression |
| 3 (aggressive) | - all detectors, all rewriter passes |
| 4 (maximum) | - context truncation |

**Useful flags:**

```bash
# Copy the optimized prompt to clipboard
promptfuel optimize "verbose prompt" --copy

# Set a token budget target
promptfuel optimize "verbose prompt" --budget 20

# Override intent detection manually
promptfuel optimize "verbose prompt" --intent debug

# Output only the optimized text (great for piping)
promptfuel optimize "verbose prompt" --output | pbcopy

# Use a specific model
promptfuel optimize "verbose prompt" --model claude-haiku-4-5
```

### Batch Command

Analyze multiple prompts at once from a JSON file.

```bash
promptfuel batch prompts.json --model gpt-4o
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
    "content": "I would like you to please write a Python function that calculates the factorial of a number. Please make sure to handle edge cases."
  },
  {
    "name": "Simple question",
    "content": "What is the capital of France?"
  },
  {
    "name": "Claude task",
    "content": "Summarize this article in 3 bullet points",
    "model": "claude-sonnet-4-6"
  }
]
```

**Example output:**

```
══════════════════════════════════════════════════════════
  PromptFuel — Batch Analysis Report
══════════════════════════════════════════════════════════

  Model      : gpt-4o
  Prompts    : 3 analyzed
  Optimizable: 1 of 3 (33%)

────────────────────────────────────────────────────────
  SUMMARY
────────────────────────────────────────────────────────
  Total input tokens       : 62
  After optimization       : 49
  Total tokens saved       : 13 (21%)
  Total estimated cost     : $0.0214
  After optimization       : $0.0201
  Potential savings        : $0.000033

────────────────────────────────────────────────────────
  TOP OPTIMIZATION OPPORTUNITIES (ranked by token savings)
────────────────────────────────────────────────────────
  1. "Code generation"
     Intent: code-gen (75% confidence)
     Tokens: 35 → 22 (-13, 37%)
     Cost:   $0.0088 → $0.0055 (save $0.000033)
     Tip:    Remove filler phrase: "I would like you to"

  2. "Simple question"
     Intent: general
     Tokens: 8 → 8 (-0, 0%)
     Tip:    None

  3. "Claude task"
     Intent: general
     Tokens: 19 → 19 (-0, 0%)
     Tip:    None
══════════════════════════════════════════════════════════
```

### Interactive Dashboard

Launch a full-screen terminal UI by running `promptfuel` with no arguments:

```bash
promptfuel
# or
promptfuel dashboard
```

The dashboard includes:
- **Token Panel** — live token count as you type
- **Cost Panel** — real-time cost estimation
- **Context Bar** — visual progress bar of context window usage
- **Prompt Input** — paste or type your prompt
- **Optimizer View** — suggestions shown after pressing `o`

**Keyboard shortcuts:**
| Key | Action |
| --- | --- |
| `q` | Quit |
| `o` | Optimize current prompt |
| `m` | Cycle through models |
| `c` | Copy optimized prompt |
| `Tab` | Switch between panels |

---

## Chrome Extension

The Chrome extension adds real-time token and cost monitoring directly inside ChatGPT and Claude.

### Installation

```bash
# Build the extension
pnpm --filter @promptfuel/extension build
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `packages/extension/dist` folder
5. Navigate to [chat.openai.com](https://chat.openai.com) or [claude.ai](https://claude.ai)

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
- **Model Selector** — switch between models

**Popup** (click the extension icon):
- Current session stats (tokens used, cost)
- Spending trends (today, this week, week-over-week change)
- Average tokens per prompt
- Model selector
- Reset session button

### Supported Sites

| Site | URL Patterns |
| --- | --- |
| ChatGPT | `chat.openai.com/*`, `chatgpt.com/*` |
| Claude | `claude.ai/*` |

---

## Web Interface

A standalone web app for analyzing and optimizing prompts in the browser.

### Running Locally

```bash
# Development server
pnpm --filter @promptfuel/web dev

# Build for production
pnpm --filter @promptfuel/web build

# Preview production build
pnpm --filter @promptfuel/web preview
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
12. **Model Selector** — choose from 14+ models

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
console.log(analysis.tokens.total);     // 307
console.log(analysis.cost.total);       // "$0.003008"

// Optimize a prompt (intent is detected automatically)
const result = pf.optimize(
  'I would like you to please explain how database indexing works in detail'
);
console.log(result.intent);             // { type: "explain", confidence: 0.6, ... }
console.log(result.tokenReduction);     // 8
console.log(result.reductionPercent);   // 42
console.log(result.optimizedPrompt);    // "Explain how database indexing works in detail"
console.log(result.suggestions.length); // 2

// Switch models
pf.setModel('claude-sonnet-4-6');
const claudeAnalysis = pf.analyze('Same prompt, different pricing');

// List all supported models
console.log(PromptFuel.listModels());
// ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', ...]

// Get model pricing info
const info = PromptFuel.getModelInfo('gpt-4o');
console.log(info);
// { input: 2.50, output: 10.00, context: 128000 }
```

### Intent Detection

Every call to `optimize()` automatically classifies the prompt into one of 6 intent types. You can also use `detectIntent()` standalone.

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

**6 intent types and what they protect:**

| Intent | Triggers on | What it protects |
| --- | --- | --- |
| `debug` | error, bug, stack trace, "step by step" | Reasoning markers, error messages, code blocks |
| `code-gen` | "write a function", framework names | Code blocks |
| `refactor` | "refactor", "clean up", scope constraints | "only change X", "don't touch Y" |
| `explain` | "explain", "how does X work", ELI5 | Simplicity requests |
| `creative` | "write a story", tone/style instructions | Tone and style directives |
| `general` | No strong signals detected | Nothing — full optimization applied |

**What intent-gating does:**

Each intent type has a configuration that controls:
- **Skipped detectors** — e.g. debug skips `weak-hedging` (tentative language is fine in debugging)
- **Skipped rewriter passes** — e.g. debug skips `question-restructuring` and `voice-transform`
- **Protected patterns** — regex patterns whose matches are preserved through optimization (e.g. "step by step", code blocks, error messages)
- **Compression level** — `light`, `moderate`, or `aggressive` default compression

You can override intent detection manually:

```typescript
const result = optimize('some prompt', 'gpt-4o', { intent: 'code-gen' });
console.log(result.intent); // { type: "code-gen", confidence: 1, matchedSignals: ["manual-override"] }
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
// {
//   levelApplied: 2,      // compression level used (1-4)
//   targetMet: true,       // whether the budget was hit
//   remainingGap: 0,       // tokens over budget (0 if met)
//   targetTokens: 12
// }
console.log(result.optimizedTokens); // 10
console.log(result.intent);          // { type: "debug", ... }
```

**How budget compression works:**

The optimizer tries each level in order and stops when the token target is met:

| Level | Detectors | Rewriter Passes | Context Truncation |
| --- | --- | --- | --- |
| 1 (light) | filler, formatting | none | no |
| 2 (moderate) | - redundancy, duplicates | verbose-phrases, sentence-compression | no |
| 3 (aggressive) | all 7 detectors | all 4 passes | no |
| 4 (maximum) | all 7 detectors | all 4 passes | yes |

Intent-gating still applies at each level — protected patterns are never removed regardless of compression level.

You can combine budget targeting with manual intent override:

```typescript
const result = optimize('some prompt', 'gpt-4o', {
  targetTokens: 20,
  intent: 'code-gen',
});
```

### Context Monitoring

Track token usage across a multi-turn conversation.

```typescript
import { PromptFuel } from '@promptfuel/sdk';

const pf = new PromptFuel({ model: 'gpt-4o' });
const monitor = pf.createMonitor();

// Add messages as the conversation progresses
monitor.addMessage({ role: 'system', content: 'You are a helpful assistant.' });
monitor.addMessage({ role: 'user', content: 'Explain React hooks.' });
monitor.addMessage({ role: 'assistant', content: 'React hooks are functions...' });
monitor.addMessage({ role: 'user', content: 'Show me an example with useState.' });

const status = monitor.getStatus();
console.log(status.totalTokens);      // 47
console.log(status.percentUsed);      // 0 (of 128k context)
console.log(status.warning);          // "green"
console.log(status.remainingTokens);  // 127953
console.log(status.contextWindow);    // 128000

// Reset when starting a new conversation
monitor.clear();
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

// Add messages with cache metadata from Claude's API response
monitor.addMessage({
  role: 'system',
  content: 'You are a code review assistant...',
  cacheCreationTokens: 500,   // tokens written to cache (first request)
  cacheReadTokens: 0,
});

monitor.addMessage({
  role: 'user',
  content: 'Review this function...',
  cacheCreationTokens: 0,
  cacheReadTokens: 500,       // cache hit on second request
});

const cacheStats = monitor.getCacheStats();
console.log(cacheStats.cacheHitRate);          // 50 (percent)
console.log(cacheStats.estimatedCacheSavings); // $0.001275
console.log(cacheStats.totalInputTokens);      // 42
```

Cache pricing on Claude:
- **Cache creation**: 1.25x base input price (25% surcharge on first use)
- **Cache read**: 0.1x base input price (90% discount on subsequent reads)

### Cache Analysis API

Analyze prompt history for semantic caching opportunities using `analyzeCacheOpportunity()` from `@promptfuel/core`.

**Input type:**

```typescript
interface CachePromptEntry {
  prompt: string;
  tokens: number;
  cost: number;
  model: string;
  timestamp?: string;
}
```

**Output type:**

```typescript
interface CacheAnalysis {
  clusters: PromptCluster[];        // groups of similar prompts
  totalPrompts: number;
  cacheablePrompts: number;
  estimatedCacheHitRate: number;    // percentage
  estimatedMonthlySavings: number;  // dollars
  estimatedMonthlyTokenSavings: number;
  topPatterns: Array<{ pattern: string; count: number; savings: number }>;
  setupGuides: CacheSetupGuide[];   // 3 guides (easy/medium/advanced)
}
```

**Usage example:**

```typescript
import { analyzeCacheOpportunity } from '@promptfuel/core';

const entries: CachePromptEntry[] = [
  { prompt: 'Explain React hooks', tokens: 5, cost: 0.000013, model: 'gpt-4o' },
  { prompt: 'Explain React hooks in detail', tokens: 7, cost: 0.000018, model: 'gpt-4o' },
  { prompt: 'How do React hooks work?', tokens: 6, cost: 0.000015, model: 'gpt-4o' },
  { prompt: 'Write a Python sort function', tokens: 7, cost: 0.000018, model: 'gpt-4o' },
];

const analysis = analyzeCacheOpportunity(entries);

console.log(analysis.estimatedCacheHitRate);         // e.g. 75
console.log(analysis.estimatedMonthlySavings);       // e.g. 12.50
console.log(analysis.clusters.length);               // e.g. 2
console.log(analysis.topPatterns[0].pattern);        // e.g. "Explain React hooks"
console.log(analysis.setupGuides.map(g => g.name));  // ["Redis", "Momento", "Custom"]
```

The analyzer uses greedy single-pass clustering with Jaccard similarity (0.45 threshold) to group similar prompts. It calculates cost savings assuming a 90% reduction on cached token reads.

### Custom Optimization Rules

Add your own domain-specific optimization rules.

```typescript
import { registerRule, unregisterRule, clearRules, optimize } from '@promptfuel/sdk';
import type { CustomRule } from '@promptfuel/sdk';

// Example: Flag overly polite language
const politenessRule: CustomRule = {
  name: 'no-politeness',
  detect: (text) => {
    const results = [];
    if (/\bplease\b/i.test(text)) {
      results.push({
        original: 'please',
        optimized: '',
        tokensSaved: 0,
        rule: 'no-politeness',
        description: 'Remove "please" — LLMs respond the same without it',
      });
    }
    if (/\bthank you\b/i.test(text)) {
      results.push({
        original: 'thank you',
        optimized: '',
        tokensSaved: 0,
        rule: 'no-politeness',
        description: 'Remove "thank you" — saves tokens without affecting output',
      });
    }
    return results;
  },
  apply: (text) => {
    return text
      .replace(/\bplease\s*/gi, '')
      .replace(/\bthank you\.?\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  },
};

// Register the rule
registerRule(politenessRule);

// Now optimize() includes your custom rule
const result = optimize('Please write a Python sort function. Thank you.', 'gpt-4o');
console.log(result.optimizedPrompt);
// "Write a Python sort function."
console.log(result.suggestions.filter(s => s.rule === 'no-politeness'));
// [{ description: 'Remove "please"...' }, { description: 'Remove "thank you"...' }]

// Remove a specific rule
unregisterRule('no-politeness');

// Or clear all custom rules
clearRules();
```

**Rule structure:**

```typescript
interface CustomRule {
  name: string;                                  // Unique identifier
  detect: (text: string) => OptimizationResult[]; // Find issues (required)
  apply?: (text: string) => string;               // Fix issues (optional)
}
```

- `detect` — analyzes the text and returns suggestions (read-only)
- `apply` — transforms the text (only called if provided)
- Rules with the same `name` replace existing ones on re-register

### Express Middleware

Add token monitoring to your API routes.

```typescript
import express from 'express';
import { promptFuelMiddleware } from '@promptfuel/sdk/middleware';

const app = express();
app.use(express.json());

// Monitor all requests to /api/chat
app.use('/api/chat', promptFuelMiddleware({
  model: 'gpt-4o',
  warnAt: 0.75,   // warn when context is 75%+ full
}));

app.post('/api/chat', (req, res) => {
  // PromptFuel headers are automatically added to the response:
  //   X-PromptFuel-Input-Tokens: 150
  //   X-PromptFuel-Estimated-Output-Tokens: 500
  //   X-PromptFuel-Estimated-Cost: $0.0054

  // For conversation messages (req.body.messages):
  //   X-PromptFuel-Context-Tokens: 2500
  //   X-PromptFuel-Context-Percent: 25
  //   X-PromptFuel-Context-Warning: green
  //   X-PromptFuel-Context-Remaining: 125500
  //   X-PromptFuel-Context-Alert: Context 80% full  (only if over warnAt)

  res.json({ message: 'ok' });
});
```

**Request body formats supported:**

```typescript
// Single prompt
{ "prompt": "Your prompt text" }

// Conversation messages
{ "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
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

Use the `--model` flag (CLI) or `model` option (SDK) to select a model. Default is `gpt-4o`.

Unknown model variants (e.g. `gpt-4o-2024-11-20`) are automatically matched to their base model pricing.

---

## How Optimization Works

PromptFuel uses a rule-based optimization pipeline (no API calls needed — everything runs locally).

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
| **Missing format** | Flags prompts without output format guidance | Suggests adding "Respond in..." |

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
│   ├── cli/         # Terminal commands and TUI dashboard
│   ├── web/         # React web interface
│   └── extension/   # Chrome extension
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm dev              # Watch mode (all packages)
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm clean            # Remove all dist folders
```

### Package-specific

```bash
pnpm --filter @promptfuel/core test     # Run core tests only
pnpm --filter @promptfuel/cli build     # Build CLI only
pnpm --filter @promptfuel/web dev       # Start web dev server
pnpm --filter @promptfuel/extension build  # Build Chrome extension
```

### Running Tests

```bash
$ pnpm --filter @promptfuel/core test

 ✓ src/__tests__/cost.test.ts       (12 tests)
 ✓ src/__tests__/optimizer.test.ts  (13 tests)
 ✓ src/__tests__/tokenizer.test.ts  (9 tests)
 ✓ src/__tests__/monitor.test.ts    (7 tests)

 Test Files  4 passed (4)
      Tests  41 passed (41)
```
