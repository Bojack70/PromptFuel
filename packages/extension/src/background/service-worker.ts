const DEFAULT_MODEL = 'gpt-4o';

interface PromptRecord {
  timestamp: number;
  tokens: number;
  cost: number;
  model: string;
  optimized: boolean;
}

interface StoredSettings {
  model: string;
  autoAnalyze: boolean;
  sessionTokens: number;
  sessionCost: number;
}

interface TrendStats {
  totalPromptsToday: number;
  totalTokensToday: number;
  totalCostToday: number;
  totalPromptsThisWeek: number;
  totalTokensThisWeek: number;
  totalCostThisWeek: number;
  totalCostLastWeek: number;
  weekOverWeekChange: number; // percent
  avgTokensPerPrompt: number;
  totalPromptsAllTime: number;
}

const defaultSettings: StoredSettings = {
  model: DEFAULT_MODEL,
  autoAnalyze: true,
  sessionTokens: 0,
  sessionCost: 0,
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: defaultSettings });
  }
  const historyExists = await chrome.storage.local.get('promptHistory');
  if (!historyExists.promptHistory) {
    await chrome.storage.local.set({ promptHistory: [] });
  }
});

function computeTrendStats(history: PromptRecord[]): TrendStats {
  const now = Date.now();
  const dayMs = 86_400_000;
  const weekMs = 7 * dayMs;

  const todayStart = now - dayMs;
  const thisWeekStart = now - weekMs;
  const lastWeekStart = now - 2 * weekMs;

  const today = history.filter(h => h.timestamp >= todayStart);
  const thisWeek = history.filter(h => h.timestamp >= thisWeekStart);
  const lastWeek = history.filter(h => h.timestamp >= lastWeekStart && h.timestamp < thisWeekStart);

  const totalCostThisWeek = thisWeek.reduce((s, h) => s + h.cost, 0);
  const totalCostLastWeek = lastWeek.reduce((s, h) => s + h.cost, 0);
  const weekOverWeekChange = totalCostLastWeek > 0
    ? Math.round(((totalCostThisWeek - totalCostLastWeek) / totalCostLastWeek) * 100)
    : 0;

  return {
    totalPromptsToday: today.length,
    totalTokensToday: today.reduce((s, h) => s + h.tokens, 0),
    totalCostToday: Math.round(today.reduce((s, h) => s + h.cost, 0) * 1_000_000) / 1_000_000,
    totalPromptsThisWeek: thisWeek.length,
    totalTokensThisWeek: thisWeek.reduce((s, h) => s + h.tokens, 0),
    totalCostThisWeek: Math.round(totalCostThisWeek * 1_000_000) / 1_000_000,
    totalCostLastWeek: Math.round(totalCostLastWeek * 1_000_000) / 1_000_000,
    weekOverWeekChange,
    avgTokensPerPrompt: history.length > 0
      ? Math.round(history.reduce((s, h) => s + h.tokens, 0) / history.length)
      : 0,
    totalPromptsAllTime: history.length,
  };
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get('settings').then((result) => {
      sendResponse(result.settings ?? defaultSettings);
    });
    return true;
  }

  if (message.type === 'SET_MODEL') {
    chrome.storage.local.get('settings').then(async (result) => {
      const settings = result.settings ?? defaultSettings;
      settings.model = message.model;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === 'UPDATE_SESSION') {
    chrome.storage.local.get('settings').then(async (result) => {
      const settings = result.settings ?? defaultSettings;
      settings.sessionTokens += message.tokens ?? 0;
      settings.sessionCost += message.cost ?? 0;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === 'RESET_SESSION') {
    chrome.storage.local.get('settings').then(async (result) => {
      const settings = result.settings ?? defaultSettings;
      settings.sessionTokens = 0;
      settings.sessionCost = 0;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }

  if (message.type === 'SET_AUTO_ANALYZE') {
    chrome.storage.local.get('settings').then(async (result) => {
      const settings = result.settings ?? defaultSettings;
      settings.autoAnalyze = message.enabled;
      await chrome.storage.local.set({ settings });
      sendResponse(settings);
    });
    return true;
  }

  // Cost trend tracking
  if (message.type === 'TRACK_PROMPT') {
    chrome.storage.local.get('promptHistory').then(async (result) => {
      const history: PromptRecord[] = result.promptHistory ?? [];
      history.push({
        timestamp: Date.now(),
        tokens: message.tokens ?? 0,
        cost: message.cost ?? 0,
        model: message.model ?? 'gpt-4o',
        optimized: message.optimized ?? false,
      });
      // Keep last 500 records
      const trimmed = history.length > 500 ? history.slice(-500) : history;
      await chrome.storage.local.set({ promptHistory: trimmed });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_TRENDS') {
    chrome.storage.local.get('promptHistory').then((result) => {
      const history: PromptRecord[] = result.promptHistory ?? [];
      sendResponse(computeTrendStats(history));
    });
    return true;
  }

  if (message.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ promptHistory: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});
