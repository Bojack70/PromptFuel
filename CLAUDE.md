# PromptFuel Project Instructions

## Model Intelligence Routing
Actively suggest a model switch based on these boundaries. All enforcement rules (Pre-Action Checkpoint, 2-Fail Rule, STOP behavior) are defined in the global CLAUDE.md — they apply here unconditionally.

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
- 2-Fail Rule: triggered per global rules (2 failed attempts → suggest Opus and STOP)
- High-Stakes: Any change to core database schema, security/auth logic, or central state management
- Research/Strategy Rule: Task requires deriving an answer from conflicting or ambiguous evidence (not just retrieving and summarizing), OR the output directly drives a high-stakes product/business decision (positioning, pricing, pivots)
- After Opus resolves the problem, IMMEDIATELY suggest /model sonnet
