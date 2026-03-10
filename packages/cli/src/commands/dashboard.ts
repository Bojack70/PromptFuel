import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function resolveWebDist(): string {
  try {
    const require = createRequire(import.meta.url);
    const webPkgPath = require.resolve('@promptfuel/web/package.json');
    return join(dirname(webPkgPath), 'dist');
  } catch {
    // Fallback: try relative path within monorepo
    const monorepoPath = resolve(dirname(new URL(import.meta.url).pathname), '../../../web/dist');
    if (existsSync(monorepoPath)) return monorepoPath;
    throw new Error('Could not locate @promptfuel/web dist directory');
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', url] : [url];
  execFile(cmd, args, () => { /* ignore errors */ });
}

export async function runDashboard(port: number = 3939): Promise<void> {
  let distDir: string;
  try {
    distDir = resolveWebDist();
  } catch (err) {
    process.stderr.write('Error: Could not find web dashboard build.\n');
    process.stderr.write('Run `pnpm --filter @promptfuel/web build` first.\n');
    process.exit(1);
  }

  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    process.stderr.write('Error: Web dashboard not built (index.html missing).\n');
    process.stderr.write('Run `pnpm --filter @promptfuel/web build` first.\n');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const urlPath = req.url?.split('?')[0] ?? '/';
    let filePath = join(distDir, urlPath === '/' ? 'index.html' : urlPath);

    // Prevent path traversal
    const resolved = resolve(filePath);
    if (!resolved.startsWith(resolve(distDir))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // SPA fallback: serve index.html for non-file routes
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      filePath = indexPath;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const data = readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Error: Port ${port} is already in use.\n`);
      process.stderr.write(`Try: promptfuel dashboard --port ${port + 1}\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    process.stdout.write('\n');
    process.stdout.write('  ╔══════════════════════════════════════════╗\n');
    process.stdout.write('  ║  PromptFuel Dashboard                   ║\n');
    process.stdout.write(`  ║  Running at ${url}              ║\n`);
    process.stdout.write('  ║  Press Ctrl+C to stop                   ║\n');
    process.stdout.write('  ╚══════════════════════════════════════════╝\n');
    process.stdout.write('\n');

    openBrowser(url);
  });

  // Keep process alive until interrupted
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      process.stdout.write('\n  Dashboard stopped.\n\n');
      server.close();
      resolve();
    });
  });
}
