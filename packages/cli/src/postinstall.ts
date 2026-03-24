import { spawn } from 'child_process';

// Runs automatically after `npm install -g promptfuel`.
// Spawns `promptfuel` directly so output goes to the real terminal,
// bypassing npm's output suppression. This triggers first-run setup
// (banner + alias + MCP config) automatically post-install.
// Silent fail — never block or break the install.
try {
  spawn('promptfuel', [], { stdio: 'inherit' }).on('error', () => {});
} catch {
  // ignore
}
