import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.promptfuel');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface PromptFuelConfig {
  model?: string;
}

export function readConfig(): PromptFuelConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch { /* malformed — ignore */ }
  return {};
}

export function writeConfig(config: PromptFuelConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function getDefaultModel(): string {
  return readConfig().model ?? DEFAULT_MODEL;
}
