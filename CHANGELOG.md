# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-09

### Added
- **Intent Detection** — classifies prompts into 6 types (debug, code-gen, refactor, explain, creative, general) with confidence scoring
- **4-Pass Rewriter** — verbose phrases, sentence compression, voice transform, question restructuring; gated per intent
- **Token Budget Targeting** — progressive compression levels 1–4 to hit a target token count
- **Token Counter** — exact counts for OpenAI models via tiktoken; ~94% accurate for Claude
- **Cost Calculator** — real-time cost estimates for 14 models (GPT-4o, o1, o3, Claude Opus/Sonnet/Haiku, and more)
- **Context Monitor** — tracks context window usage with color-coded warnings
- **Strategy Advisor** — analyzes project config, conversation history, model usage, and prompt patterns for savings
- **Cache Analysis** — clusters prompts to identify prompt-prefix caching opportunities with setup guides
- **CLI Tool** (`@promptfuel/cli`) — `analyze`, `optimize`, `batch`, `strategies`, `dashboard` commands + interactive TUI
- **Web Dashboard** (`@promptfuel/web`) — Insights, Analyze & Optimize, History, and Strategies tabs; Claude Code usage stats
- **Chrome Extension** (`@promptfuel/extension`) — live token count and cost on ChatGPT and Claude
- **npm SDK** (`@promptfuel/sdk`) — `optimize`, `detectIntent`, `calculateCost`, `monitorContext`, `analyzeCacheOpportunity`
- **Core library** (`@promptfuel/core`) — shared engine powering all surfaces; zero API calls, fully local
