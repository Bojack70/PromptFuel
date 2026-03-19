import { runUninstall } from './commands/uninstall.js';

// Runs automatically before `npm uninstall -g promptfuel`.
// Silent fail — never block or break the uninstall.
runUninstall().catch(() => {});
