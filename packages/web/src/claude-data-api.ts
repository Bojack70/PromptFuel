import type { Plugin } from 'vite';
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, basename, resolve, dirname } from 'path';
import { homedir } from 'os';
import { analyzeCacheOpportunity, type CachePromptEntry } from '@promptfuel/core';

// Pricing per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

function getPrice(model: string) {
  return PRICING[model] || { input: 3.0, output: 15.0 };
}

function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreateTokens: number,
) {
  const price = getPrice(model);
  // cache_read costs 90% less than input; cache_creation costs same as input
  const inputCost = (inputTokens * price.input) / 1_000_000;
  const outputCost = (outputTokens * price.output) / 1_000_000;
  const cacheReadCost = (cacheReadTokens * price.input * 0.1) / 1_000_000;
  const cacheCreateCost = (cacheCreateTokens * price.input) / 1_000_000;
  return inputCost + outputCost + cacheReadCost + cacheCreateCost;
}

interface ParsedMessage {
  sessionId: string;
  type: 'user' | 'assistant';
  timestamp: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  promptText?: string;
}

async function findJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'subagents') continue;
        const nested = await findJsonlFiles(fullPath);
        results.push(...nested);
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
  return results;
}

async function parseAllSessions() {
  const claudeDir = join(homedir(), '.claude', 'projects');
  const files = await findJsonlFiles(claudeDir);

  const allMessages: ParsedMessage[] = [];
  const sessionSet = new Set<string>();

  for (const filePath of files) {
    const sessionId = basename(filePath, '.jsonl');
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n').filter(Boolean);
    // Keep track of the last user prompt per session so we can pair it with the next assistant response
    let lastUserPrompt: { text: string; timestamp: string } | null = null;

    for (const line of lines) {
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      const sid = record.sessionId || sessionId;

      if (record.type === 'user' && record.message?.role === 'user') {
        sessionSet.add(sid);
        // Extract prompt text from first text content block
        const content = record.message.content;
        let text = '';
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          const textBlock = content.find((b: any) => b.type === 'text' && b.text);
          if (textBlock) text = textBlock.text;
        }
        // Skip tool_result messages (they're not real user prompts)
        if (Array.isArray(content) && content.length > 0 && content[0].type === 'tool_result') {
          continue;
        }
        if (text) {
          lastUserPrompt = { text, timestamp: record.timestamp || '' };
        }
      }

      if (record.type === 'assistant' && record.message?.role === 'assistant') {
        const usage = record.message.usage;
        if (!usage) continue;
        // Skip synthetic/test messages
        const model = record.message.model || '';
        if (model.startsWith('<') || !model) continue;

        sessionSet.add(sid);
        const msg: ParsedMessage = {
          sessionId: sid,
          type: 'assistant',
          timestamp: record.timestamp || '',
          model: record.message.model || '',
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheCreateTokens: usage.cache_creation_input_tokens || 0,
        };

        // Associate the last user prompt with this assistant response
        if (lastUserPrompt) {
          msg.promptText = lastUserPrompt.text;
          lastUserPrompt = null;
        }

        allMessages.push(msg);
      }
    }
  }

  return { messages: allMessages, sessionIds: [...sessionSet] };
}

function aggregate(messages: ParsedMessage[], sessionIds: string[]) {
  // Totals
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreateTokens = 0;
  let totalCostUSD = 0;

  // By date
  const byDateMap = new Map<string, {
    inputTokens: number; outputTokens: number; cacheTokens: number;
    messages: number; costUSD: number;
  }>();

  // By model
  const byModelMap = new Map<string, {
    inputTokens: number; outputTokens: number; cacheTokens: number;
    messages: number; costUSD: number;
  }>();

  // Sessions
  const sessionMap = new Map<string, {
    startTime: string; messages: number; totalTokens: number; costUSD: number;
  }>();

  // Heaviest prompts (by total tokens in the response)
  const promptEntries: Array<{
    prompt: string; timestamp: string; model: string;
    inputTokens: number; outputTokens: number; totalTokens: number; costUSD: number;
  }> = [];

  for (const msg of messages) {
    const cost = computeCost(
      msg.model || '',
      msg.inputTokens,
      msg.outputTokens,
      msg.cacheReadTokens,
      msg.cacheCreateTokens,
    );

    inputTokens += msg.inputTokens;
    outputTokens += msg.outputTokens;
    cacheReadTokens += msg.cacheReadTokens;
    cacheCreateTokens += msg.cacheCreateTokens;
    totalCostUSD += cost;

    // By date
    const dateKey = msg.timestamp ? msg.timestamp.slice(0, 10) : 'unknown';
    const dateEntry = byDateMap.get(dateKey) || {
      inputTokens: 0, outputTokens: 0, cacheTokens: 0, messages: 0, costUSD: 0,
    };
    dateEntry.inputTokens += msg.inputTokens;
    dateEntry.outputTokens += msg.outputTokens;
    dateEntry.cacheTokens += msg.cacheReadTokens + msg.cacheCreateTokens;
    dateEntry.messages++;
    dateEntry.costUSD += cost;
    byDateMap.set(dateKey, dateEntry);

    // By model
    const modelKey = msg.model || 'unknown';
    const modelEntry = byModelMap.get(modelKey) || {
      inputTokens: 0, outputTokens: 0, cacheTokens: 0, messages: 0, costUSD: 0,
    };
    modelEntry.inputTokens += msg.inputTokens;
    modelEntry.outputTokens += msg.outputTokens;
    modelEntry.cacheTokens += msg.cacheReadTokens + msg.cacheCreateTokens;
    modelEntry.messages++;
    modelEntry.costUSD += cost;
    byModelMap.set(modelKey, modelEntry);

    // Session
    const sessionEntry = sessionMap.get(msg.sessionId) || {
      startTime: msg.timestamp, messages: 0, totalTokens: 0, costUSD: 0,
    };
    if (!sessionEntry.startTime || msg.timestamp < sessionEntry.startTime) {
      sessionEntry.startTime = msg.timestamp;
    }
    sessionEntry.messages++;
    sessionEntry.totalTokens += msg.inputTokens + msg.outputTokens + msg.cacheReadTokens + msg.cacheCreateTokens;
    sessionEntry.costUSD += cost;
    sessionMap.set(msg.sessionId, sessionEntry);

    // Heaviest prompts
    if (msg.promptText) {
      const total = msg.inputTokens + msg.outputTokens + msg.cacheReadTokens + msg.cacheCreateTokens;
      promptEntries.push({
        prompt: msg.promptText.slice(0, 300),
        timestamp: msg.timestamp,
        model: msg.model || 'unknown',
        inputTokens: msg.inputTokens,
        outputTokens: msg.outputTokens,
        totalTokens: total,
        costUSD: cost,
      });
    }
  }

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;

  const byDate = [...byDateMap.entries()]
    .filter(([k]) => k !== 'unknown')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({ date, ...d }));

  const byModel = [...byModelMap.entries()]
    .sort((a, b) => b[1].messages - a[1].messages)
    .map(([model, d]) => ({ model, ...d }));

  const heaviestPrompts = promptEntries
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10);

  const sessions = [...sessionMap.entries()]
    .sort((a, b) => (a[1].startTime || '').localeCompare(b[1].startTime || ''))
    .map(([sessionId, d]) => ({ sessionId, ...d }));

  // Cache analysis — run on all prompt entries
  const cacheEntries: CachePromptEntry[] = promptEntries.map(p => ({
    prompt: p.prompt,
    tokens: p.inputTokens,
    cost: p.costUSD,
    model: p.model,
    timestamp: p.timestamp,
  }));
  const cacheAnalysis = analyzeCacheOpportunity(cacheEntries);

  return {
    totalSessions: sessionIds.length,
    totalMessages: messages.length,
    totals: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreateTokens,
      totalTokens,
      estimatedCostUSD: totalCostUSD,
    },
    byDate,
    byModel,
    heaviestPrompts,
    sessions,
    cacheAnalysis,
  };
}

export function claudeDataPlugin(): Plugin {
  return {
    name: 'claude-data-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__claude-data') return next();

        try {
          const { messages, sessionIds } = await parseAllSessions();
          const data = aggregate(messages, sessionIds);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // POST /__claude-action — write CLAUDE.md to disk
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__claude-action' || req.method !== 'POST') return next();

        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString());

          if (body.action === 'write-claude-md') {
            const content = body.content as string;
            if (!content) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing content' }));
              return;
            }
            // Default to CLAUDE.md in the project root (cwd)
            const targetPath = resolve(body.path || join(process.cwd(), 'CLAUDE.md'));
            await writeFile(targetPath, content, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, path: targetPath }));
          } else {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `Unknown action: ${body.action}` }));
          }
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}
