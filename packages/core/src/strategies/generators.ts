import type { StrategyContext } from './types.js';

export function generateClaudeMd(context: StrategyContext): string {
  const sections: string[] = [];
  let projectName = 'Unknown Project';
  let projectDesc = '';

  // Parse package.json
  if (context.fileContents?.['package.json']) {
    try {
      const pkg = JSON.parse(context.fileContents['package.json']);
      projectName = pkg.name ?? projectName;
      projectDesc = pkg.description ?? '';

      sections.push(`# ${projectName}\n`);
      if (projectDesc) sections.push(`${projectDesc}\n`);

      // Tech stack from dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (Object.keys(deps).length > 0) {
        sections.push('## Tech Stack\n');
        const keyDeps = Object.keys(deps).filter(d => !d.startsWith('@types/'));
        for (const dep of keyDeps.slice(0, 20)) {
          sections.push(`- ${dep}`);
        }
        if (keyDeps.length > 20) {
          sections.push(`- ... and ${keyDeps.length - 20} more`);
        }
        sections.push('');
      }

      // Scripts / commands
      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        sections.push('## Key Commands\n');
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          sections.push(`- \`${name}\`: \`${cmd}\``);
        }
        sections.push('');
      }
    } catch {
      sections.push(`# ${projectName}\n`);
    }
  } else {
    sections.push(`# ${projectName}\n`);
  }

  // TypeScript config
  if (context.fileContents?.['tsconfig.json'] || context.fileContents?.['tsconfig.base.json']) {
    const tsRaw = context.fileContents['tsconfig.json'] ?? context.fileContents['tsconfig.base.json'] ?? '';
    try {
      const ts = JSON.parse(tsRaw);
      sections.push('## TypeScript Configuration\n');
      const co = ts.compilerOptions ?? {};
      if (co.target) sections.push(`- Target: ${co.target}`);
      if (co.module) sections.push(`- Module: ${co.module}`);
      if (co.strict) sections.push('- Strict mode: enabled');
      if (co.jsx) sections.push(`- JSX: ${co.jsx}`);
      sections.push('');
    } catch { /* ignore */ }
  }

  // Project structure
  if (context.projectFiles && context.projectFiles.length > 0) {
    sections.push('## Project Structure\n');
    const topDirs = new Set<string>();
    for (const f of context.projectFiles) {
      const parts = f.split('/');
      if (parts.length > 1 && !parts[0].startsWith('.') && parts[0] !== 'node_modules') {
        topDirs.add(parts[0]);
      }
    }
    for (const dir of Array.from(topDirs).sort()) {
      const count = context.projectFiles.filter(f => f.startsWith(dir + '/')).length;
      sections.push(`- \`${dir}/\` (${count} files)`);
    }
    sections.push('');
  }

  // Detect monorepo
  const isMonorepo = context.projectFiles?.some(f =>
    f === 'pnpm-workspace.yaml' || f === 'lerna.json' || f.startsWith('packages/')
  );
  if (isMonorepo) {
    sections.push('## Architecture\n');
    sections.push('This is a **monorepo** project. Key packages:');
    const packages = context.projectFiles
      ?.filter(f => f.match(/^packages\/[^/]+\/package\.json$/))
      .map(f => f.split('/')[1]) ?? [];
    for (const pkg of packages) {
      sections.push(`- \`packages/${pkg}/\``);
    }
    sections.push('');
  }

  // Conventions
  sections.push('## Conventions\n');
  sections.push('- Follow existing code patterns and naming conventions');
  sections.push('- Write TypeScript with strict mode');
  sections.push('- Keep changes minimal and focused');
  sections.push('- Test changes before committing');
  sections.push('');

  // Common tasks
  sections.push('## Common Tasks\n');
  sections.push('- <!-- Add common development tasks here -->');
  sections.push('- <!-- e.g., "To add a new feature, create a file in src/features/" -->');
  sections.push('');

  return sections.join('\n');
}

export function generateCursorRules(context: StrategyContext): string {
  const lines: string[] = [];
  let lang = 'TypeScript';
  let framework = '';

  if (context.fileContents?.['package.json']) {
    try {
      const pkg = JSON.parse(context.fileContents['package.json']);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.react) framework = 'React';
      else if (deps.vue) framework = 'Vue';
      else if (deps.angular) framework = 'Angular';
      else if (deps.express) framework = 'Express';
      else if (deps.next) framework = 'Next.js';

      lines.push(`# Project: ${pkg.name ?? 'Unknown'}`);
      if (pkg.description) lines.push(`# ${pkg.description}`);
      lines.push('');
      lines.push(`Language: ${lang}`);
      if (framework) lines.push(`Framework: ${framework}`);
      lines.push('');

      // Code style
      lines.push('## Code Style');
      lines.push('- Use TypeScript strict mode');
      lines.push('- Prefer const over let, avoid var');
      lines.push('- Use async/await over raw promises');
      lines.push('- Keep functions small and focused');
      if (deps.react) {
        lines.push('- Use functional components with hooks');
        lines.push('- Prefer named exports');
      }
      lines.push('');

      // Project structure
      if (context.projectFiles) {
        lines.push('## Project Structure');
        const srcFiles = context.projectFiles.filter(f => f.startsWith('src/'));
        const topSrcDirs = new Set<string>();
        for (const f of srcFiles) {
          const parts = f.split('/');
          if (parts.length > 2) topSrcDirs.add(parts[1]);
        }
        for (const dir of Array.from(topSrcDirs).sort()) {
          lines.push(`- src/${dir}/`);
        }
        lines.push('');
      }
    } catch { /* ignore */ }
  }

  if (lines.length === 0) {
    lines.push('# Project Rules');
    lines.push('');
    lines.push('- Follow existing code patterns');
    lines.push('- Write clean, readable code');
    lines.push('- Add tests for new features');
  }

  return lines.join('\n');
}

export function generateConversationSummary(
  messages: Array<{ role: string; content: string }>,
  upToIndex: number,
): string {
  const relevant = messages.slice(0, upToIndex);
  const userMsgs = relevant.filter(m => m.role === 'user');
  const assistantMsgs = relevant.filter(m => m.role === 'assistant');

  const lines: string[] = ['# Conversation Summary\n'];

  // Extract key topics from user messages
  lines.push('## Topics Discussed\n');
  for (const msg of userMsgs) {
    const firstLine = msg.content.split('\n')[0].trim();
    if (firstLine.length > 0) {
      const summary = firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine;
      lines.push(`- ${summary}`);
    }
  }
  lines.push('');

  // Extract key decisions from assistant messages
  const decisionKeywords = /\b(?:decided|chose|using|will use|implemented|created|built|recommend|should use)\b/i;
  const decisions: string[] = [];
  for (const msg of assistantMsgs) {
    const sentences = msg.content.split(/[.!?]\s+/);
    for (const s of sentences) {
      if (decisionKeywords.test(s) && s.trim().length > 10 && s.trim().length < 200) {
        decisions.push(s.trim());
      }
    }
  }

  if (decisions.length > 0) {
    lines.push('## Key Decisions\n');
    for (const d of decisions.slice(0, 10)) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  lines.push(`\n_Summary of ${relevant.length} messages (${userMsgs.length} user, ${assistantMsgs.length} assistant)_`);

  return lines.join('\n');
}

export function extractCommonContext(
  userMessages: Array<{ role: string; content: string }>,
): string {
  if (userMessages.length < 2) return '';

  // Extract sentences/lines from each message
  const messageSentences = userMessages.map(m =>
    m.content.split(/[.!?\n]+/).map(s => s.trim().toLowerCase()).filter(s => s.length > 20)
  );

  // Find sentences that appear in multiple messages
  const sentenceCounts = new Map<string, { count: number; original: string }>();
  for (const sentences of messageSentences) {
    const seen = new Set<string>();
    for (const s of sentences) {
      const normalized = s.replace(/\s+/g, ' ');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        const existing = sentenceCounts.get(normalized);
        if (existing) {
          existing.count++;
        } else {
          sentenceCounts.set(normalized, { count: 1, original: s });
        }
      }
    }
  }

  // Collect repeated context
  const repeated: string[] = [];
  for (const [, { count, original }] of sentenceCounts) {
    if (count >= 2) {
      repeated.push(original);
    }
  }

  if (repeated.length === 0) return '';

  const lines = [
    '# Shared Project Context',
    '',
    'The following context was repeated across multiple messages. Place this in your system prompt or CLAUDE.md to avoid re-sending it:',
    '',
    ...repeated.map(r => `- ${r.charAt(0).toUpperCase() + r.slice(1)}`),
    '',
  ];

  return lines.join('\n');
}
