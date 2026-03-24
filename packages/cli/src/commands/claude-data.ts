import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { calculateCost } from '@promptfuel/core';

export interface ClaudeCodeData {
  totalSessions: number;
  totalMessages: number;
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreateTokens: number;
    totalTokens: number;
    estimatedCostUSD: number;
  };
  byDate: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    messages: number;
    costUSD: number;
  }>;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    messages: number;
    costUSD: number;
  }>;
  heaviestPrompts: Array<{
    prompt: string;
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUSD: number;
  }>;
  sessions: Array<{
    sessionId: string;
    startTime: string;
    messages: number;
    totalTokens: number;
    costUSD: number;
  }>;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
      .map((c: any) => c.text)
      .join(' ');
  }
  return '';
}

export function buildClaudeData(): ClaudeCodeData {
  const claudeDir = join(homedir(), '.claude', 'projects');
  const empty: ClaudeCodeData = {
    totalSessions: 0, totalMessages: 0,
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, totalTokens: 0, estimatedCostUSD: 0 },
    byDate: [], byModel: [], heaviestPrompts: [], sessions: [],
  };

  if (!existsSync(claudeDir)) return empty;

  const totals = { ...empty.totals };
  const byDateMap = new Map<string, { inputTokens: number; outputTokens: number; cacheTokens: number; messages: number; costUSD: number }>();
  const byModelMap = new Map<string, { inputTokens: number; outputTokens: number; cacheTokens: number; messages: number; costUSD: number }>();
  const allHeavyPrompts: ClaudeCodeData['heaviestPrompts'] = [];
  const allSessions: ClaudeCodeData['sessions'] = [];
  let totalMessages = 0;

  const projectFolders = readdirSync(claudeDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const folder of projectFolders) {
    const folderPath = join(claudeDir, folder);
    let jsonlFiles: string[];
    try {
      jsonlFiles = readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      try {
        const lines = readFileSync(join(folderPath, file), 'utf-8').split('\n');

        // Two passes: build entry map, then process deduped assistant messages
        const entryMap = new Map<string, { type: string; text: string; timestamp: string }>();
        const assistantMessages = new Map<string, any>(); // message.id → last entry

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (!entry.uuid) continue;

            // Store all entries for parent lookup
            entryMap.set(entry.uuid, {
              type: entry.type ?? '',
              text: entry.type === 'user' ? extractText(entry.message?.content) : '',
              timestamp: entry.timestamp ?? '',
            });

            // Collect assistant messages — overwrite keeps the final (highest output_tokens) entry
            // Skip synthetic/internal messages — not real API calls
            if (entry.type === 'assistant' && entry.message?.usage && entry.message?.id && entry.message.model !== '<synthetic>') {
              assistantMessages.set(entry.message.id, entry);
            }
          } catch { /* bad line */ }
        }

        let sessionStartTime = '';
        let sessionTokens = 0;
        let sessionCost = 0;
        let sessionMessages = 0;

        for (const entry of assistantMessages.values()) {
          const u = entry.message.usage;
          const model: string = entry.message.model ?? 'unknown';
          const input: number = u.input_tokens ?? 0;
          const output: number = u.output_tokens ?? 0;
          const cacheRead: number = u.cache_read_input_tokens ?? 0;
          const cacheCreate: number = (u.cache_creation_input_tokens ?? 0) +
            (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
            (u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
          const ts: string = entry.timestamp ?? '';
          const date = ts.slice(0, 10);

          let cost = 0;
          try { cost = calculateCost(input, output, model).totalCost; } catch { /* unknown model */ }

          // Totals
          totals.inputTokens += input;
          totals.outputTokens += output;
          totals.cacheReadTokens += cacheRead;
          totals.cacheCreateTokens += cacheCreate;
          totals.estimatedCostUSD += cost;
          totalMessages++;

          // By date
          if (date) {
            const d = byDateMap.get(date) ?? { inputTokens: 0, outputTokens: 0, cacheTokens: 0, messages: 0, costUSD: 0 };
            d.inputTokens += input; d.outputTokens += output;
            d.cacheTokens += cacheRead + cacheCreate;
            d.messages++; d.costUSD += cost;
            byDateMap.set(date, d);
          }

          // By model
          const m = byModelMap.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheTokens: 0, messages: 0, costUSD: 0 };
          m.inputTokens += input; m.outputTokens += output;
          m.cacheTokens += cacheRead + cacheCreate;
          m.messages++; m.costUSD += cost;
          byModelMap.set(model, m);

          // Session tracking
          if (!sessionStartTime) sessionStartTime = ts;
          sessionTokens += input + output;
          sessionCost += cost;
          sessionMessages++;

          // Heaviest prompts — find user message via parentUuid
          const parent = entryMap.get(entry.parentUuid ?? '');
          const promptText = parent?.type === 'user' ? parent.text.trim() : '';
          if (promptText && (input + output) > 50) {
            allHeavyPrompts.push({
              prompt: promptText.slice(0, 500),
              timestamp: ts,
              model,
              inputTokens: input,
              outputTokens: output,
              totalTokens: input + output,
              costUSD: cost,
            });
          }
        }

        if (sessionMessages > 0) {
          allSessions.push({ sessionId, startTime: sessionStartTime, messages: sessionMessages, totalTokens: sessionTokens, costUSD: sessionCost });
        }
      } catch { /* file error */ }
    }
  }

  totals.totalTokens = totals.inputTokens + totals.outputTokens;

  return {
    totalSessions: allSessions.length,
    totalMessages,
    totals,
    byDate: [...byDateMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, d]) => ({ date, ...d })),
    byModel: [...byModelMap.entries()].sort((a, b) => b[1].costUSD - a[1].costUSD).map(([model, d]) => ({ model, ...d })),
    heaviestPrompts: allHeavyPrompts.sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20),
    sessions: allSessions.sort((a, b) => b.costUSD - a.costUSD).slice(0, 50),
  };
}
