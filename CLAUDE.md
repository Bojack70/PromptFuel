# PromptFuel Project Instructions

## Model Intelligence Routing
Actively suggest a model switch based on these boundaries.

**Enforcement rule: When a switch is warranted, suggest it and STOP. Do not proceed until the user explicitly confirms or declines. A suggestion followed by self-override is not a suggestion.**

**Routing discipline: Every task, no exceptions — route first, then act. Even when the answer is "stay on current model", say it out loud before starting.**

### Suggest /model haiku IF:
- Pure boilerplate (e.g., "Add JSDoc to these 10 functions")
- Verification tasks (e.g., "Check for typos", "Run the linter")
- Single-file unit tests where the logic is already clear

### Suggest /model sonnet IF currently on Opus and:
- Implementing a feature across 1-3 files
- Performing standard bug fixes
- Follow-up work after Opus has resolved the hard problem — do not stay on Opus

### Suggest /model opus IF:
- 3-File Rule: Change impacts >3 unrelated modules or requires tracing logic across the system
- 2-Fail Rule: Implementation fails tests twice on Sonnet — stop and suggest Opus for a deep audit
- High-Stakes: Any change to core database schema, security/auth logic, or central state management
- Research/Strategy Rule: Task requires deriving an answer from conflicting or ambiguous evidence (not just retrieving and summarizing), OR the output directly drives a high-stakes product/business decision (positioning, pricing, pivots)
- After Opus resolves the problem, IMMEDIATELY suggest /model sonnet

### 2-Fail Rule — Strict Clarifications
- **What counts as a failure:** User reports the fix didn't work, OR a new version is published/deployed without user confirming the previous one worked. "Different approach" does not reset the counter.
- **What STOP means:** Output the model switch suggestion, then write nothing else — no code, no commands, no publishes. Wait for the user to explicitly confirm the switch or explicitly say "keep going on Sonnet."
- **Publishing counts as attempts:** Each published fix version = one attempt. If the bug persists after 2 published versions, the rule is triggered regardless of how different the approaches felt.
- **No self-override:** Suggesting a switch and then immediately continuing anyway is a rule violation, not compliance.
