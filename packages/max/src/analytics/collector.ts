/**
 * Unified metrics collector.
 * Gathers GitHub + npm data into a single DaySnapshot and saves to data/snapshots/.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectGitHubMetrics, type GitHubMetrics } from './github.js';
import { collectNpmMetrics, type NpmMetrics } from './npm.js';
import type { MaxConfig } from '../config.js';

export interface DaySnapshot {
  date: string; // YYYY-MM-DD
  collectedAt: string; // ISO 8601
  github: GitHubMetrics;
  npm: NpmMetrics;
  deltas: {
    stars: number;
    forks: number;
    npmDownloadsDay: number;
  };
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function loadPreviousSnapshot(snapshotsDir: string): DaySnapshot | null {
  if (!existsSync(snapshotsDir)) return null;

  // Find the most recent snapshot file
  const files = readdirSync(snapshotsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(readFileSync(join(snapshotsDir, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

export async function collectAndSave(config: MaxConfig): Promise<DaySnapshot> {
  const snapshotsDir = join(config.dataDir, 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });

  // Collect all metrics in parallel
  const [github, npm] = await Promise.all([
    collectGitHubMetrics(config.githubOwner, config.githubRepo, config.githubToken),
    collectNpmMetrics(config.npmPackages),
  ]);

  // Calculate deltas from previous snapshot
  const prev = loadPreviousSnapshot(snapshotsDir);
  const totalNpmDay = Object.values(npm.packages).reduce((s, p) => s + p.downloadsLastDay, 0);

  const snapshot: DaySnapshot = {
    date: today(),
    collectedAt: new Date().toISOString(),
    github,
    npm,
    deltas: {
      stars: prev ? github.stars - prev.github.stars : 0,
      forks: prev ? github.forks - prev.github.forks : 0,
      npmDownloadsDay: totalNpmDay,
    },
  };

  // Save snapshot
  const filePath = join(snapshotsDir, `${snapshot.date}.json`);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

  // Update state.json
  const stateFile = join(config.dataDir, 'state.json');
  const state = existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf-8'))
    : {};

  state.lastDailyRun = snapshot.collectedAt;
  state.lastSnapshotDate = snapshot.date;
  state.totalSnapshots = (state.totalSnapshots ?? 0) + 1;

  writeFileSync(stateFile, JSON.stringify(state, null, 2));

  return snapshot;
}
