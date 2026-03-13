import { runSetup } from './commands/setup.js';

// Runs automatically after `npm install -g promptfuel`.
// Silent fail — never block or break the install.
runSetup().catch(() => {});
