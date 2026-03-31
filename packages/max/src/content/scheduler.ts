/**
 * Content scheduler — decides what to post today based on warmup stage,
 * day of week, and recent post history.
 */

import type { ContentCategory } from './templates.js';
import type { ContentLogEntry } from './history.js';
import type { CalendarDay } from './calendar.js';

export type WarmupStage = 'warmup' | 'transition' | 'active';

export interface DailyPlan {
  twitter: { category: ContentCategory } | null;
  devto: { category: ContentCategory } | null;
  stage: WarmupStage;
}

interface StateJson {
  warmupStartDate: string;
  accountStatus: { twitter: string; devto: string };
  [key: string]: unknown;
}

const WARMUP_START = '2026-03-24';

// Categories ordered for rotation. 'stats' excluded during warmup.
const ALL_CATEGORIES: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'launch', 'opinion', 'stats'];
const WARMUP_CATEGORIES: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'opinion', 'launch'];

// Dev.to posting days by stage (0=Sun, 1=Mon, ... 6=Sat)
const DEVTO_DAYS: Record<WarmupStage, number[]> = {
  warmup: [2],        // Tuesday
  transition: [2, 4], // Tue + Thu
  active: [1, 3, 5],  // Mon + Wed + Fri
};

function daysSince(dateStr: string): number {
  const start = new Date(dateStr + 'T00:00:00Z');
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function getStage(warmupStart: string = WARMUP_START): WarmupStage {
  const days = daysSince(warmupStart);
  if (days <= 14) return 'warmup';
  if (days <= 30) return 'transition';
  return 'active';
}

function recentForPlatform(
  history: ContentLogEntry[],
  platform: 'twitter' | 'devto',
  count: number,
): ContentLogEntry[] {
  return history
    .filter((e) => e.platform === platform)
    .slice(-count);
}

function pickCategory(
  recent: ContentLogEntry[],
  stage: WarmupStage,
): ContentCategory {
  const pool = stage === 'warmup' ? WARMUP_CATEGORIES : ALL_CATEGORIES;
  const recentCategories = recent.slice(-3).map((e) => e.category);

  // Pick the first category not used in the last 3 posts
  for (const cat of pool) {
    if (!recentCategories.includes(cat)) return cat;
  }

  // All recently used — just cycle from the start
  return pool[0];
}

function alreadyPostedToday(
  history: ContentLogEntry[],
  platform: 'twitter' | 'devto',
): boolean {
  const today = new Date().toISOString().split('T')[0];
  return history.some((e) => e.platform === platform && e.date === today);
}

/**
 * Plan today's content. Uses the calendar if available, otherwise falls back
 * to ad-hoc category rotation.
 */
export function planToday(
  state: StateJson,
  history: ContentLogEntry[],
  calendarDay?: CalendarDay | null,
): DailyPlan {
  const stage = getStage(state.warmupStartDate || WARMUP_START);

  // If calendar provides today's plan, use it
  if (calendarDay) {
    return {
      twitter: calendarDay.twitter && !alreadyPostedToday(history, 'twitter')
        ? { category: calendarDay.twitter }
        : null,
      devto: calendarDay.devto && !alreadyPostedToday(history, 'devto')
        ? { category: calendarDay.devto }
        : null,
      stage,
    };
  }

  // Fallback: ad-hoc rotation
  const utcDay = new Date().getUTCDay();

  let twitter: DailyPlan['twitter'] = null;
  if (!alreadyPostedToday(history, 'twitter')) {
    const recent = recentForPlatform(history, 'twitter', 10);
    twitter = { category: pickCategory(recent, stage) };
  }

  let devto: DailyPlan['devto'] = null;
  if (DEVTO_DAYS[stage].includes(utcDay) && !alreadyPostedToday(history, 'devto')) {
    const recent = recentForPlatform(history, 'devto', 10);
    devto = { category: pickCategory(recent, stage) };
  }

  return { twitter, devto, stage };
}
