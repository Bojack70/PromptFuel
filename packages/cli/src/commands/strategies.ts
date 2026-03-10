import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { analyzeStrategies, formatCost } from '@promptfuel/core';
import type { StrategyContext, StrategyRecommendation } from '@promptfuel/core';

function separator(char = '─', width = 60): string {
  return char.repeat(width);
}

function scanDirectory(dir: string, maxDepth: number, currentDepth = 0): string[] {
  const results: string[] = [];
  if (currentDepth > maxDepth) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden, node_modules, dist, .git
      if (entry.name.startsWith('.') && entry.name !== '.cursorrules') continue;
      if (['node_modules', 'dist', 'build', '.git', 'coverage'].includes(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      const relPath = relative(dir, fullPath);

      if (entry.isFile()) {
        results.push(relPath);
      } else if (entry.isDirectory()) {
        const subFiles = scanDirectory(fullPath, maxDepth, currentDepth + 1);
        results.push(...subFiles.map(f => join(entry.name, f)));
      }
    }
  } catch { /* permission errors etc */ }

  return results;
}

function impactBadge(impact: string): string {
  switch (impact) {
    case 'high': return '\x1b[31m[HIGH]\x1b[0m';
    case 'medium': return '\x1b[33m[MED]\x1b[0m';
    case 'low': return '\x1b[90m[LOW]\x1b[0m';
    default: return `[${impact.toUpperCase()}]`;
  }
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export interface StrategiesOptions {
  model: string;
}

export async function runStrategies(
  dirArg: string | undefined,
  options: StrategiesOptions,
): Promise<void> {
  const projectDir = dirArg || process.cwd();

  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    process.stderr.write(`Error: "${projectDir}" is not a valid directory.\n`);
    process.exit(1);
  }

  process.stdout.write('\n  Scanning project...\n');

  // Scan project files
  const projectFiles = scanDirectory(projectDir, 3);
  const fileContents: Record<string, string> = {};

  // Read key files
  const keyFiles = [
    'package.json', 'README.md', 'CLAUDE.md', '.cursorrules',
    'tsconfig.json', 'tsconfig.base.json',
  ];
  for (const f of keyFiles) {
    const path = join(projectDir, f);
    if (existsSync(path)) {
      try {
        fileContents[f] = readFileSync(path, 'utf-8');
      } catch { /* ignore read errors */ }
    }
  }

  const context: StrategyContext = {
    projectDir,
    projectFiles,
    fileContents,
    model: options.model,
  };

  const analysis = analyzeStrategies(context);

  // Display results
  const lines: string[] = [
    '',
    separator('═', 60),
    '  PromptFuel — Token-Saving Strategy Advisor',
    separator('═', 60),
    '',
    `  ${analysis.projectSummary}`,
    '',
  ];

  if (analysis.recommendations.length === 0) {
    lines.push('  ✓ No recommendations — your project looks well-optimized!');
    lines.push('');
  } else {
    lines.push(separator('─', 60));
    lines.push(`  RECOMMENDATIONS (${analysis.recommendations.length} found)`);
    lines.push(separator('─', 60));
    lines.push('');

    for (let i = 0; i < analysis.recommendations.length; i++) {
      const rec = analysis.recommendations[i];
      lines.push(`  ${i + 1}. ${impactBadge(rec.impact)} ${rec.name}`);
      lines.push(`     ${rec.description}`);
      lines.push('');
      if (rec.estimatedTokenSavings > 0) {
        lines.push(`     Estimated savings: ~${rec.estimatedTokenSavings.toLocaleString()} tokens`);
      }
      if (rec.estimatedCostSavings > 0) {
        lines.push(`     Cost savings: ~${formatCost(rec.estimatedCostSavings)}`);
      }
      lines.push(`     Action: ${rec.actionDescription}`);
      lines.push('');
    }

    lines.push(separator('─', 60));
    lines.push(`  TOTAL POTENTIAL SAVINGS`);
    lines.push(separator('─', 60));
    lines.push(`  Tokens : ~${analysis.totalEstimatedTokenSavings.toLocaleString()}`);
    lines.push(`  Cost   : ~${formatCost(analysis.totalEstimatedCostSavings)}`);
    lines.push('');
  }

  lines.push(separator('═', 60));
  process.stdout.write(lines.join('\n') + '\n');

  // Interactive execution for file-creating recommendations
  if (!process.stdin.isTTY) return;

  const creatableRecs = analysis.recommendations.filter(r => r.createsFile && r.generatedContent);
  for (const rec of creatableRecs) {
    const targetPath = join(projectDir, rec.targetFile!);
    if (existsSync(targetPath)) continue;

    process.stdout.write('\n');
    process.stdout.write(`  Preview: ${rec.targetFile}\n`);
    process.stdout.write(separator('─', 60) + '\n');

    // Show first 20 lines of content
    const previewLines = rec.generatedContent!.split('\n').slice(0, 20);
    for (const line of previewLines) {
      process.stdout.write(`  │ ${line}\n`);
    }
    if (rec.generatedContent!.split('\n').length > 20) {
      process.stdout.write(`  │ ... (${rec.generatedContent!.split('\n').length - 20} more lines)\n`);
    }
    process.stdout.write(separator('─', 60) + '\n');

    const answer = await ask(`\n  Create ${rec.targetFile}? [Y/n] `);

    if (!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      try {
        writeFileSync(targetPath, rec.generatedContent!, 'utf-8');
        process.stdout.write(`  ✓ Created ${rec.targetFile}\n`);
      } catch (err) {
        process.stderr.write(`  ✗ Failed to create ${rec.targetFile}: ${err}\n`);
      }
    } else {
      process.stdout.write(`  Skipped ${rec.targetFile}\n`);
    }
  }

  process.stdout.write('\n');
}
