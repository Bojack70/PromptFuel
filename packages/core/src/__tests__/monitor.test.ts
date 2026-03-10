import { describe, it, expect } from 'vitest';
import { monitorContext, ContextMonitor } from '../index.js';

describe('monitor', () => {
  describe('monitorContext', () => {
    it('returns green for empty messages', () => {
      const status = monitorContext([], 'gpt-4o');
      expect(status.totalTokens).toBe(0);
      expect(status.warning).toBe('green');
      expect(status.percentUsed).toBe(0);
    });

    it('calculates token usage for messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello, how are you?' },
        { role: 'assistant' as const, content: 'I am doing well, thank you!' },
      ];
      const status = monitorContext(messages, 'gpt-4o');
      expect(status.totalTokens).toBeGreaterThan(0);
      expect(status.percentUsed).toBeGreaterThanOrEqual(0);
      expect(status.remainingTokens).toBeLessThan(status.contextWindow);
    });

    it('returns correct warning levels', () => {
      // Create a very long message to trigger higher usage
      const longText = 'word '.repeat(50000);
      const messages = [{ role: 'user' as const, content: longText }];
      const status = monitorContext(messages, 'gpt-4o');
      expect(status.percentUsed).toBeGreaterThan(0);
    });
  });

  describe('ContextMonitor class', () => {
    it('tracks messages', () => {
      const monitor = new ContextMonitor('gpt-4o');
      monitor.addMessage({ role: 'user', content: 'Hello' });
      const status = monitor.getStatus();
      expect(status.totalTokens).toBeGreaterThan(0);
      expect(monitor.getMessages()).toHaveLength(1);
    });

    it('accumulates messages', () => {
      const monitor = new ContextMonitor('gpt-4o');
      monitor.addMessage({ role: 'user', content: 'First message' });
      const status1 = monitor.getStatus();
      monitor.addMessage({ role: 'assistant', content: 'Response message' });
      const status2 = monitor.getStatus();
      expect(status2.totalTokens).toBeGreaterThan(status1.totalTokens);
    });

    it('clears messages', () => {
      const monitor = new ContextMonitor('gpt-4o');
      monitor.addMessage({ role: 'user', content: 'Hello' });
      monitor.clear();
      expect(monitor.getMessages()).toHaveLength(0);
      expect(monitor.getStatus().totalTokens).toBe(0);
    });

    it('allows model change', () => {
      const monitor = new ContextMonitor('gpt-4o');
      monitor.addMessage({ role: 'user', content: 'Test' });
      const status1 = monitor.getStatus();
      monitor.setModel('claude-sonnet-4-6');
      const status2 = monitor.getStatus();
      // Context window differs between models
      expect(status1.contextWindow).not.toBe(status2.contextWindow);
    });
  });
});
