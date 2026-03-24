import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { analyzeStrategies, formatCost } from '@promptfuel/core';
import type { StrategyContext, StrategyRecommendation } from '@promptfuel/core';
import { ttyWrite } from '../output.js';

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

  ttyWrite('\n  Scanning project...\n');

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

  // Display results — compact format to stay under Claude Code's collapse threshold
  const lines: string[] = [''];

  if (analysis.recommendations.length === 0) {
    lines.push(`  PromptFuel Strategies  ·  ${analysis.projectSummary.split('|')[0].trim()}`);
    lines.push('  ✓ No recommendations — project looks well-optimized!');
  } else {
    const total = `~${analysis.totalEstimatedTokenSavings.toLocaleString('en-US')} tokens  ·  ~${formatCost(analysis.totalEstimatedCostSavings)} saveable`;
    lines.push(`  PromptFuel Strategies  ·  ${analysis.recommendations.length} recommendation${analysis.recommendations.length !== 1 ? 's' : ''}  ·  ${total}`);
    lines.push('');
    for (let i = 0; i < analysis.recommendations.length; i++) {
      const rec = analysis.recommendations[i];
      const savings = rec.estimatedTokenSavings > 0 ? `  ·  ~${rec.estimatedTokenSavings.toLocaleString('en-US')} tokens` : '';
      lines.push(`  ${i + 1}. ${impactBadge(rec.impact)} ${rec.name}${savings}`);
      lines.push(`     ${rec.description}`);
    }
  }

  lines.push('');
  ttyWrite(lines.join('\n') + '\n');

  // Interactive execution for file-creating recommendations
  if (!process.stdin.isTTY) return;

  const creatableRecs = analysis.recommendations.filter(r => r.createsFile && r.generatedContent);
  for (const rec of creatableRecs) {
    const targetPath = join(projectDir, rec.targetFile!);
    if (existsSync(targetPath)) continue;

    ttyWrite('\n');
    ttyWrite(`  Preview: ${rec.targetFile}\n`);
    ttyWrite(separator('─', 60) + '\n');

    // Show first 20 lines of content
    const previewLines = rec.generatedContent!.split('\n').slice(0, 20);
    for (const line of previewLines) {
      ttyWrite(`  │ ${line}\n`);
    }
    if (rec.generatedContent!.split('\n').length > 20) {
      ttyWrite(`  │ ... (${rec.generatedContent!.split('\n').length - 20} more lines)\n`);
    }
    ttyWrite(separator('─', 60) + '\n');

    const answer = await ask(`\n  Create ${rec.targetFile}? [Y/n] `);

    if (!answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      try {
        writeFileSync(targetPath, rec.generatedContent!, 'utf-8');
        ttyWrite(`  ✓ Created ${rec.targetFile}\n`);
      } catch (err) {
        process.stderr.write(`  ✗ Failed to create ${rec.targetFile}: ${err}\n`);
      }
    } else {
      ttyWrite(`  Skipped ${rec.targetFile}\n`);
    }
  }

  ttyWrite('\n');
}
