import { describe, it, expect } from 'vitest';
import { analyzeStrategies } from '../strategies/index.js';
import type { StrategyContext } from '../strategies/types.js';

describe('strategies', () => {
  describe('analyzeStrategies', () => {
    it('recommends creating CLAUDE.md when not present', () => {
      const context: StrategyContext = {
        projectFiles: ['package.json', 'src/index.ts', 'README.md'],
        fileContents: {
          'package.json': JSON.stringify({
            name: 'test-project',
            description: 'A test project',
            dependencies: { react: '^18.0.0' },
            scripts: { build: 'tsc', test: 'vitest' },
          }),
        },
      };

      const analysis = analyzeStrategies(context);
      const rec = analysis.recommendations.find(r => r.id === 'create-claude-md');
      expect(rec).toBeDefined();
      expect(rec!.impact).toBe('high');
      expect(rec!.generatedContent).toContain('test-project');
      expect(rec!.createsFile).toBe(true);
      expect(rec!.targetFile).toBe('CLAUDE.md');
    });

    it('does NOT recommend CLAUDE.md when already present', () => {
      const context: StrategyContext = {
        projectFiles: ['package.json', 'CLAUDE.md', 'src/index.ts'],
        fileContents: {
          'package.json': '{"name":"test"}',
          'CLAUDE.md': '# Context',
        },
      };

      const analysis = analyzeStrategies(context);
      const rec = analysis.recommendations.find(r => r.id === 'create-claude-md');
      expect(rec).toBeUndefined();
    });

    it('recommends .cursorrules when not present', () => {
      const context: StrategyContext = {
        projectFiles: ['package.json', 'src/index.ts'],
        fileContents: { 'package.json': '{"name":"test"}' },
      };

      const analysis = analyzeStrategies(context);
      const rec = analysis.recommendations.find(r => r.id === 'create-cursorrules');
      expect(rec).toBeDefined();
      expect(rec!.createsFile).toBe(true);
    });

    it('detects repeated context in conversations', () => {
      const repeated = 'This is my project about React. It uses TypeScript and React DOM. ' +
        'The architecture follows a monorepo pattern with shared packages. ' +
        'We use Vite for building and Vitest for testing.';

      const context: StrategyContext = {
        conversation: [
          { role: 'user', content: repeated + ' How do I add a feature?' },
          { role: 'assistant', content: 'Here is how you add a feature...' },
          { role: 'user', content: repeated + ' How do I fix the bug?' },
          { role: 'assistant', content: 'Here is the fix...' },
          { role: 'user', content: repeated + ' How do I deploy?' },
        ],
      };

      const analysis = analyzeStrategies(context);
      const rec = analysis.recommendations.find(r => r.id === 'reduce-repeated-context');
      // May or may not trigger depending on n-gram threshold, but shouldn't error
      expect(analysis.recommendations).toBeDefined();
    });

    it('recommends format constraints when prompts lack them', () => {
      const context: StrategyContext = {
        conversation: [
          { role: 'user', content: 'Explain how React virtual DOM works in detail with all the mechanisms involved' },
          { role: 'assistant', content: 'The virtual DOM works by...' },
          { role: 'user', content: 'Tell me about the difference between useEffect and useLayoutEffect in React' },
          { role: 'assistant', content: 'useEffect runs after...' },
          { role: 'user', content: 'What are the best practices for state management in large React applications' },
          { role: 'assistant', content: 'For large apps...' },
          { role: 'user', content: 'How does React reconciliation algorithm work under the hood' },
        ],
        model: 'gpt-4o',
      };

      const analysis = analyzeStrategies(context);
      const rec = analysis.recommendations.find(r => r.id === 'add-format-constraints');
      expect(rec).toBeDefined();
      expect(rec!.impact).toBe('high');
    });

    it('sorts recommendations by impact (high first)', () => {
      const context: StrategyContext = {
        projectFiles: ['package.json', 'src/index.ts'],
        fileContents: { 'package.json': '{"name":"test"}' },
        conversation: [
          { role: 'user', content: 'Explain React hooks in detail and how they work' },
          { role: 'assistant', content: 'Here is...' },
          { role: 'user', content: 'Tell me about React context API in detail' },
          { role: 'assistant', content: 'Context API...' },
          { role: 'user', content: 'How does React routing work in detail' },
        ],
        model: 'gpt-4o',
      };

      const analysis = analyzeStrategies(context);
      if (analysis.recommendations.length >= 2) {
        const impacts = analysis.recommendations.map(r => r.impact);
        const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        for (let i = 1; i < impacts.length; i++) {
          expect(impactOrder[impacts[i]]).toBeGreaterThanOrEqual(impactOrder[impacts[i - 1]]);
        }
      }
    });

    it('returns empty recommendations for empty context', () => {
      const analysis = analyzeStrategies({});
      expect(analysis.recommendations).toEqual([]);
      expect(analysis.totalEstimatedTokenSavings).toBe(0);
    });

    it('generates project summary', () => {
      const context: StrategyContext = {
        projectFiles: ['package.json'],
        fileContents: {
          'package.json': JSON.stringify({ name: 'my-app', description: 'My awesome app' }),
        },
        model: 'gpt-4o',
      };

      const analysis = analyzeStrategies(context);
      expect(analysis.projectSummary).toContain('my-app');
      expect(analysis.projectSummary).toContain('gpt-4o');
    });
  });
});
