import { spawn } from 'child_process';

// Runs automatically after `npm install -g promptfuel`.
// Spawns `promptfuel setup` and waits for it to finish so the banner
// is fully printed before postinstall exits. stdio:inherit writes
// directly to the real terminal, bypassing npm's output suppression.
const child = spawn('promptfuel', ['setup'], { stdio: 'inherit' });
child.on('error', () => {});
await new Promise<void>(resolve => child.on('close', () => resolve()));
