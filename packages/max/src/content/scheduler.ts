/**
 * Content scheduler — decides what to post today based on warmup stage,
 * day of week, and recent post history.
 */

import type { ContentCategory } from './templates.js';
import type { ContentLogEntry } from './history.js';
import type { CalendarDay } from './calendar.js';

export type WarmupStage = 'warmup' | 'transition' | 'active';

export interface DailyPlan {
  bluesky: { category: ContentCategory } | null;
  devto: { category: ContentCategory } | null;
  stage: WarmupStage;
}

interface StateJson {
  warmupStartDate: string;
  accountStatus: { bluesky: string; devto: string };
  [key: string]: unknown;
}

const WARMUP_START = '2026-03-24';

// Categories ordered for rotation. 'stats' excluded during warmup.
// General-topic categories (ai_general, economics, philosophy) included in active
// rotation but excluded from warmup — during warmup we establish PromptFuel's identity first.
const ALL_CATEGORIES: ContentCategory[] = [
  'tip', 'comparison', 'tutorial', 'launch', 'opinion', 'stats',
  'ai_general', 'economics', 'philosophy', 'short_story',
  'mystery_interactive', 'character_dark',
  // Substack-native categories — also scheduled for Bluesky/Dev.to (they have prompts for both)
  'letter', 'field_notes', 'essay_long', 'contrarian', 'thread_story',
  // Signature narrative style — low cadence (Medium only, ~1x/month)
  'window_seat',
];
const WARMUP_CATEGORIES: ContentCategory[] = ['tip', 'comparison', 'tutorial', 'opinion', 'launch'];

// Hard-promo categories: explicitly sell PromptFuel. Cap at 2/week.
export const PROMO_CATEGORIES: ContentCategory[] = ['launch', 'stats'];
// Pure audience-building: no product mention. Ensure at least 2/week.
export const AUDIENCE_CATEGORIES: ContentCategory[] = ['ai_general', 'economics', 'philosophy', 'short_story', 'mystery_interactive', 'character_dark', 'window_seat'];

// Dev.to posting days by stage (0=Sun, 1=Mon, ... 6=Sat)
export const DEVTO_DAYS: Record<WarmupStage, number[]> = {
  warmup: [2],        // Tuesday
  transition: [2, 4], // Tue + Thu
  active: [1, 3, 5],  // Mon + Wed + Fri
};

// Substack mirrors Dev.to cadence — Note posted same days as Dev.to article
export const SUBSTACK_DAYS: Record<WarmupStage, number[]> = {
  warmup: [2],        // Tuesday
  transition: [2, 4], // Tue + Thu
  active: [1, 3, 5],  // Mon + Wed + Fri
};

// Medium engage (clap + comment) — Mon/Wed/Fri, not stage-aware
export const MEDIUM_ENGAGE_DAYS: number[] = [1, 3, 5];

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
  platform: 'bluesky' | 'devto',
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

  // Count promo posts in the last 7 to enforce the 2/week cap
  const recentPromoCount = recent.slice(-7).filter((e) => PROMO_CATEGORIES.includes(e.category)).length;
  const promoCapReached = recentPromoCount >= 2;

  // Pick the first category not used recently, respecting the promo cap
  for (const cat of pool) {
    if (recentCategories.includes(cat)) continue;
    if (promoCapReached && PROMO_CATEGORIES.includes(cat)) continue;
    return cat;
  }

  // All non-promo options exhausted — cycle from start, still respecting cap
  for (const cat of pool) {
    if (promoCapReached && PROMO_CATEGORIES.includes(cat)) continue;
    return cat;
  }

  return pool[0];
}

function alreadyPostedToday(
  history: ContentLogEntry[],
  platform: 'bluesky' | 'devto',
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
      bluesky: calendarDay.bluesky && !alreadyPostedToday(history, 'bluesky')
        ? { category: calendarDay.bluesky }
        : null,
      devto: calendarDay.devto && !alreadyPostedToday(history, 'devto')
        ? { category: calendarDay.devto }
        : null,
      stage,
    };
  }

  // Fallback: ad-hoc rotation
  const utcDay = new Date().getUTCDay();

  let bluesky: DailyPlan['bluesky'] = null;
  if (!alreadyPostedToday(history, 'bluesky')) {
    const recent = recentForPlatform(history, 'bluesky', 10);
    bluesky = { category: pickCategory(recent, stage) };
  }

  let devto: DailyPlan['devto'] = null;
  if (DEVTO_DAYS[stage].includes(utcDay) && !alreadyPostedToday(history, 'devto')) {
    const recent = recentForPlatform(history, 'devto', 10);
    devto = { category: pickCategory(recent, stage) };
  }

  return { bluesky, devto, stage };
}
