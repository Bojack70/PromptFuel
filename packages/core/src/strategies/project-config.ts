import type { StrategyContext, StrategyRecommendation } from './types.js';
import { generateClaudeMd, generateCursorRules } from './generators.js';

export function analyzeProjectConfig(context: StrategyContext): StrategyRecommendation[] {
  const results: StrategyRecommendation[] = [];
  if (!context.projectFiles) return results;

  const hasPackageJson = context.projectFiles.some(f => f === 'package.json');
  const hasClaude = context.projectFiles.some(f =>
    f === 'CLAUDE.md' || f === '.claude' || f.endsWith('/CLAUDE.md')
  );
  const hasCursorRules = context.projectFiles.some(f =>
    f === '.cursorrules' || f.includes('.cursor/rules')
  );

  // Recommend CLAUDE.md
  if (!hasClaude && hasPackageJson) {
    const content = generateClaudeMd(context);
    results.push({
      id: 'create-claude-md',
      name: 'Create CLAUDE.md',
      category: 'project-config',
      description:
        'A CLAUDE.md file gives Claude persistent context about your project — tech stack, conventions, architecture. ' +
        'This eliminates the need to re-explain project details in every conversation, saving thousands of tokens per session.',
      impact: 'high',
      estimatedTokenSavings: 5000,
      estimatedCostSavings: 0.015,
      actionDescription: 'Create a CLAUDE.md file with auto-generated project context',
      generatedContent: content,
      targetFile: 'CLAUDE.md',
      createsFile: true,
    });
  }

  // Recommend .cursorrules
  if (!hasCursorRules && hasPackageJson) {
    const content = generateCursorRules(context);
    results.push({
      id: 'create-cursorrules',
      name: 'Create .cursorrules',
      category: 'project-config',
      description:
        'A .cursorrules file gives Cursor AI persistent project context, preventing redundant explanations about ' +
        'your tech stack and coding conventions in every prompt.',
      impact: 'medium',
      estimatedTokenSavings: 3000,
      estimatedCostSavings: 0.009,
      actionDescription: 'Create a .cursorrules file for Cursor users',
      generatedContent: content,
      targetFile: '.cursorrules',
      createsFile: true,
    });
  }

  // Check for oversized README being used as context
  const readme = context.fileContents?.['README.md'];
  if (readme && readme.length > 5000 && !hasClaude) {
    results.push({
      id: 'readme-too-large',
      name: 'README.md is too large for AI context',
      category: 'project-config',
      description:
        `Your README.md is ${Math.round(readme.length / 1000)}KB. If you're pasting it into AI conversations, ` +
        'consider creating a compact CLAUDE.md or system prompt with just the essential project context.',
      impact: 'medium',
      estimatedTokenSavings: Math.round(readme.length / 4), // rough char-to-token ratio
      estimatedCostSavings: (readme.length / 4 / 1_000_000) * 3.0,
      actionDescription: 'Create a compact project context file instead of using the full README',
    });
  }

  return results;
}
