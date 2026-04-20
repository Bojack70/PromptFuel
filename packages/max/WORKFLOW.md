# Agent Max — Full Workflow Reference

Canonical map of every automated and manual workflow, the platforms each one touches, and the cadence. Source of truth for "what runs, when, and who triggers it."

---

## 1. Automated (GitHub Actions — nothing for you to do)

| Workflow | When | What it does | Platforms it touches |
|---|---|---|---|
| `max-daily.yml` | 06:00 UTC daily | Collect GitHub/npm analytics → publish today's content | **Bluesky** (API, 1/day), **Dev.to** (API, on scheduled days) |
| `max-weekly.yml` | 03:00 UTC Monday | Data-only: snapshots, engagement, experiments, strategy outcomes, correlation report, dashboard, gh-pages deploy | none (no publishing) |
| `max-post.yml` | manual dispatch | One-off Bluesky post (input: `POST_TEXT`) | **Bluesky** |

Dev.to schedule varies by warmup stage (from `scheduler.ts`):
- **Warmup** (0-14 days from 2026-03-24): Tuesday only
- **Transition** (15-30 days): Tuesday + Thursday
- **Active** (31+ days): Monday + Wednesday + Friday

CI runs **no LLM calls**. Daily reads pre-generated content from `data/pregenerated-content.json`. Weekly is strictly deterministic aggregation + dashboard.

---

## 2. Local — Monday morning (one LLM-heavy run)

```bash
cd packages/max
npx pnpm build
node dist/index.js --mode weekly
```

This is the single command that makes the whole week work. Uses your Claude Code subscription via subprocess (no API cost). Takes ~90s. It:

1. Re-collects snapshots + engagement
2. Evaluates experiments, strategy outcomes, builds strategy memory
3. Generates a **reflection** (Sonnet)
4. Extracts a **structured strategy decision** (Sonnet)
5. Researches **influencer formats** (Sonnet)
6. Generates **HN + LinkedIn + Reddit drafts** (Haiku/Sonnet)
7. Sends the **weekly email digest** (Resend)
8. Builds **next week's calendar** (Sonnet)
9. **Pre-generates all 7 days** of Bluesky + Dev.to + Medium content (Haiku/Sonnet/Opus by category)
10. Commits `pregenerated-content.json`, `calendar.json`, `strategy-log.json`, etc. — push these so the daily workflow sees them.

If you skip this, the daily CI workflow will try to generate content on-demand and fail (CI has no Claude CLI + no API key — that's the whole point of this split).

---

## 3. Local — Daily OpenTabs cadence (in Brave, requires `opentabs start` running)

Needed for platforms with no official API, or where the API is gated.

| Command | Platform | Purpose |
|---|---|---|
| `--mode social-engage` | Twitter, Reddit, HN | Warmup: likes, upvotes (no comments yet) |
| `--mode medium-engage --topic <topic> --verify` | Medium | Clap + comment on relevant articles |
| `--mode social-post --medium` | Medium | Publish today's pre-generated Medium article (on Dev.to days) |
| `--mode social-post --hn` | Hacker News | Submit from weekly draft (human-assisted) |
| `--mode social-post` (default) | Twitter/X | Auto-post to Twitter |
| `--mode social-post --reddit` | Reddit | **On hold** — hardcoded to `r/test` until Nate hits ~50 karma |

Suggested daily routine (5-10 min in Brave):

```bash
node dist/index.js --mode social-engage
node dist/index.js --mode medium-engage --topic programming --verify
# on Dev.to days (Mon/Wed/Fri in active stage):
node dist/index.js --mode social-post --medium
```

---

## 4. Per-platform state summary

| Platform | Route | Status | Cadence |
|---|---|---|---|
| **Bluesky** | AT Protocol API | Live | 1/day, automated in CI |
| **Dev.to** | REST API | Live | 1-3/week, automated in CI (stage-based) |
| **Medium** | OpenTabs (Brave) | Live — body publish still unverified | 1-3/week on Dev.to days |
| **Medium engage** | OpenTabs | Live, verified 2026-04-20 | manual, clap + comment |
| **Twitter/X** | OpenTabs | Live | manual `social-post` |
| **Twitter engage** | OpenTabs | Live | manual `social-engage` |
| **Hacker News** | OpenTabs | Live | manual on strong draft |
| **HN engage** | OpenTabs | Live | manual `social-engage` |
| **LinkedIn** | draft only (no API) | manual copy-paste | weekly draft, you post |
| **Reddit (API)** | OAuth2 | On hold | Reddit approval pending |
| **Reddit (OpenTabs)** | OpenTabs | r/test only | until karma ~50, then rotate real subs |
| **Substack** | OpenTabs | Built, not wired into scheduler | ad-hoc via `--mode publish-substack` |

---

## 5. Ad-hoc utilities (run as needed)

```bash
# Custom Bluesky post
POST_TEXT="..." node dist/index.js --mode post

# Publish a specific Medium article from JSON
node dist/index.js --mode publish-medium --file path/to/article.json --submit

# Publish to Substack (Notes or Newsletter)
node dist/index.js --mode publish-substack --file path/to/post.json --submit

# Standalone content pre-gen (subset of --mode weekly)
node dist/index.js --mode generate-week

# Smoke tests (dry run; form-fill only, no submission)
node dist/index.js --mode social-test-hn
node dist/index.js --mode social-test-reddit
node dist/index.js --mode social-test-medium
node dist/index.js --mode social-test-substack
```

---

## 6. Open items / known gaps

- Substack not yet in `scheduler.ts` `ALL_CATEGORIES` cadence — ad-hoc only
- Reddit API on hold (approval process), OpenTabs route hardcoded to r/test
- Old Twitter + Dub GitHub secrets still present — need deletion (`TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_BEARER_TOKEN`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `DUB_API_KEY`)
- **Medium article publish smoke test** pending: confirm Slate paste fix enables the Publish button on article body. Command: `node dist/index.js --mode publish-medium --file data/article-window-seat.json --submit`
- **`--mode weekly` full LLM run** never verified end-to-end against Pro subscription — Monday is the natural moment to run it for real

---

## 7. Cost policy (reminder)

- **Publishing platforms:** all zero-cost (Bluesky/Dev.to/HN/Medium/Twitter via OpenTabs are free; Reddit API is free if approved)
- **LLM calls:** routed through Claude Code subscription via `claude -p` subprocess (default `MAX_LLM_MODE=cli`). Zero additional $ cost.
- **Paid API mode** (`MAX_LLM_MODE=api` + `ANTHROPIC_API_KEY`): exists only as manual override. Never silently fallen back to. CI has no `ANTHROPIC_API_KEY` by design.

---

## 8. File map

```
packages/max/
├── src/
│   ├── index.ts                    # Mode dispatcher
│   ├── config.ts                   # Env loader
│   ├── analytics/                  # GitHub/npm/engagement collectors
│   ├── content/
│   │   ├── claude.ts               # LLM client (CLI subprocess | API)
│   │   ├── scheduler.ts            # WARMUP_START, DEVTO_DAYS, category rotation
│   │   ├── templates.ts            # Per-category prompts, Medium publication map
│   │   ├── calendar.ts             # Weekly calendar generator
│   │   ├── pregenerate.ts          # Pre-gen all 7 days
│   │   └── quality.ts              # Self-review gate
│   ├── publish/
│   │   ├── bluesky.ts              # AT Protocol
│   │   ├── devto.ts                # REST API
│   │   ├── reddit.ts               # OAuth2 (on hold)
│   │   └── opentabs/               # Browser automation (Twitter/HN/Medium/Substack)
│   │       ├── medium.ts           # Article publish (Slate paste fix)
│   │       ├── medium-engage.ts    # Clap + comment
│   │       ├── substack.ts         # Newsletter + Notes
│   │       └── ...
│   ├── brain/
│   │   ├── weekly.ts               # weeklyReflection (full) + weeklyDataOnly (CI)
│   │   ├── strategy.ts             # Decision extraction + memory
│   │   ├── correlation.ts          # Content-to-metric scoring
│   │   ├── format-research.ts      # Influencer RSS study
│   │   └── drafts.ts               # HN/LinkedIn/Reddit drafts
│   └── dashboard/                  # Static HTML generator → gh-pages
└── data/                           # State, snapshots, engagement, calendar, pregen content
```
