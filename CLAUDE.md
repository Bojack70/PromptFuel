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
- After Opus resolves the problem, IMMEDIATELY suggest /model sonnet
