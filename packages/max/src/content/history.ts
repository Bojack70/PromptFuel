/**
 * Content history — tracks every post Max has ever published.
 * Stored in data/content-log.json as a JSON array.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentCategory } from './templates.js';

export interface ContentLogEntry {
  date: string;
  timestamp: string;
  platform: 'twitter' | 'devto';
  category: ContentCategory;
  title?: string;
  content: string;
  postId: string;
  postUrl?: string;
}

export function loadHistory(dataDir: string): ContentLogEntry[] {
  const file = join(dataDir, 'content-log.json');
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

export function appendHistory(dataDir: string, entry: ContentLogEntry): void {
  const entries = loadHistory(dataDir);
  entries.push(entry);
  writeFileSync(join(dataDir, 'content-log.json'), JSON.stringify(entries, null, 2));
}
