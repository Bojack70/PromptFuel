import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  countTokens,
  calculateCost,
  formatCost,
  optimize,
  monitorContext,
  analyzeStrategies,
  listModels,
  getContextWindow,
  type OptimizeOutput,
  type ContextStatus,
  type StrategyAnalysis,
  type StrategyContext,
} from '@promptfuel/core';

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'claude-opus-4-6', label: 'Claude Opus' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku' },
];

type Tab = 'analyze' | 'history' | 'strategies' | 'insights';

interface AnalysisState {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  contextStatus: ContextStatus;
  optimization: OptimizeOutput | null;
}

interface HistoryEntry {
  timestamp: number;
  originalPrompt: string;
  optimizedPrompt: string;
  model: string;
  tokensSaved: number;
  costSaved: number;
}

interface ClaudeCodeData {
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
  cacheAnalysis?: {
    clusters: Array<{
      id: number;
      representative: string;
      promptCount: number;
      totalTokens: number;
      totalCost: number;
      cacheableTokens: number;
      cacheableCost: number;
      avgSimilarity: number;
      samplePrompts: string[];
    }>;
    totalPrompts: number;
    cacheablePrompts: number;
    estimatedCacheHitRate: number;
    estimatedMonthlySavings: number;
    estimatedMonthlyTokenSavings: number;
    topPatterns: Array<{ pattern: string; count: number; savings: number }>;
    setupGuides: Array<{
      id: string;
      name: string;
      description: string;
      difficulty: 'easy' | 'medium' | 'advanced';
      infrastructure: string;
      steps: string[];
      estimatedSetupTime: string;
    }>;
  };
}

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem('promptfuel-history') || '[]');
  } catch { return []; }
}

function saveHistory(entries: HistoryEntry[]) {
  localStorage.setItem('promptfuel-history', JSON.stringify(entries.slice(-100)));
}

const DISMISSED_KEY = 'promptfuel-dismissed-actions';
const PLAN_KEY = 'promptfuel-claude-plan';
type ClaudePlan = 'pro' | 'max' | 'team' | 'enterprise';

function loadDismissedActions(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); }
  catch { return []; }
}

function saveDismissedActions(ids: string[]) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
}

function loadSavedPlan(): ClaudePlan | null {
  const saved = localStorage.getItem(PLAN_KEY);
  if (saved === 'pro' || saved === 'max' || saved === 'team' || saved === 'enterprise') return saved;
  return null;
}

function savePlan(plan: ClaudePlan) {
  localStorage.setItem(PLAN_KEY, plan);
}

function inferPlan(byModel: Array<{ model: string; messages: number }>, totalMessages: number): ClaudePlan {
  const opusMessages = byModel.find(m => m.model.includes('opus'))?.messages ?? 0;
  const opusRatio = opusMessages / Math.max(totalMessages, 1);
  // Heavy Opus usage (>30% and >20 messages) suggests Max/Enterprise (unlimited Opus)
  return (opusRatio > 0.3 && opusMessages > 20) ? 'max' : 'pro';
}

export function Dashboard({ initialTab }: { initialTab?: string } = {}) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'analyze');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('gpt-4o');
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [strategyInput, setStrategyInput] = useState('');
  const [strategyResult, setStrategyResult] = useState<StrategyAnalysis | null>(null);
  const [claudeData, setClaudeData] = useState<ClaudeCodeData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [claudePlan, setClaudePlan] = useState<ClaudePlan>(loadSavedPlan() || 'pro');
  const [targetTokens, setTargetTokens] = useState<number | undefined>(undefined);
  const [aggressive, setAggressive] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchClaudeData = useCallback(() => {
    setInsightsLoading(true);
    fetch('/__claude-data')
      .then(r => { if (!r.ok) throw new Error('Not available'); return r.json(); })
      .then(data => setClaudeData(data))
      .catch(() => {})
      .finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => { fetchClaudeData(); }, [fetchClaudeData]);

  // Auto-infer plan from usage data if the user hasn't manually overridden
  useEffect(() => {
    if (!claudeData || loadSavedPlan()) return;
    setClaudePlan(inferPlan(claudeData.byModel, claudeData.totalMessages));
  }, [claudeData]);

  const handlePlanChange = useCallback((plan: ClaudePlan) => {
    setClaudePlan(plan);
    savePlan(plan);
  }, []);

  const analyze = useCallback((text: string, mdl: string, budget?: number, isAggressive?: boolean) => {
    if (!text.trim()) {
      setAnalysis(null);
      return;
    }

    const tokens = countTokens(text, mdl);
    const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, mdl);
    const contextStatus = monitorContext(
      [{ role: 'user', content: text }],
      mdl,
    );
    const optimization = optimize(text, mdl, {
      ...(budget ? { targetTokens: budget } : {}),
      ...(isAggressive ? { aggressive: true } : {}),
    });

    setAnalysis({
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.estimatedOutputTokens,
      inputCost: cost.inputCost,
      outputCost: cost.outputCost,
      totalCost: cost.totalCost,
      contextStatus,
      optimization,
    });
  }, []);

  const handleInput = (text: string) => {
    setPrompt(text);
    setCopied(false);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => analyze(text, model, targetTokens, aggressive), 100);
  };

  const handleModelChange = (mdl: string) => {
    setModel(mdl);
    if (prompt.trim()) analyze(prompt, mdl, targetTokens, aggressive);
  };

  const handleBudgetChange = (value: string) => {
    const num = value ? parseInt(value, 10) : undefined;
    const budget = num && num > 0 ? num : undefined;
    setTargetTokens(budget);
    if (prompt.trim()) {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => analyze(prompt, model, budget, aggressive), 300);
    }
  };

  const handleAggressiveToggle = () => {
    const next = !aggressive;
    setAggressive(next);
    if (prompt.trim()) analyze(prompt, model, targetTokens, next);
  };

  const handleCopyOptimized = async () => {
    if (!analysis?.optimization) return;
    try {
      await navigator.clipboard.writeText(analysis.optimization.optimizedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleApplyOptimized = () => {
    if (!analysis?.optimization) return;

    // Save to history
    const entry: HistoryEntry = {
      timestamp: Date.now(),
      originalPrompt: prompt,
      optimizedPrompt: analysis.optimization.optimizedPrompt,
      model,
      tokensSaved: analysis.optimization.tokenReduction,
      costSaved: analysis.totalCost - calculateCost(
        analysis.optimization.optimizedTokens,
        countTokens(analysis.optimization.optimizedPrompt, model).estimatedOutputTokens,
        model,
      ).totalCost,
    };
    const updated = [...history, entry];
    setHistory(updated);
    saveHistory(updated);

    setPrompt(analysis.optimization.optimizedPrompt);
    analyze(analysis.optimization.optimizedPrompt, model);
  };

  const handleAnalyzeStrategies = () => {
    if (!strategyInput.trim()) return;

    // Parse conversation from pasted text (each line = alternating user/assistant)
    const lines = strategyInput.split('\n').filter(l => l.trim());
    const conversation: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      conversation.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: lines[i].trim(),
      });
    }

    const context: StrategyContext = {
      conversation,
      model,
    };

    setStrategyResult(analyzeStrategies(context));
  };

  const totalHistorySavings = history.reduce((s, h) => s + h.tokensSaved, 0);
  const totalHistoryCostSavings = history.reduce((s, h) => s + h.costSaved, 0);

  // === Insights computations ===
  const insights = useMemo(() => {
    // Pre-compute token counts for all entries (reused across sections)
    const entriesWithTokens = history.map(entry => {
      const orig = countTokens(entry.originalPrompt, entry.model);
      const opt = countTokens(entry.optimizedPrompt, entry.model);
      return {
        ...entry,
        origInputTokens: orig.inputTokens,
        origOutputTokens: orig.estimatedOutputTokens,
        origTotalTokens: orig.inputTokens + orig.estimatedOutputTokens,
        optInputTokens: opt.inputTokens,
        optOutputTokens: opt.estimatedOutputTokens,
        optTotalTokens: opt.inputTokens + opt.estimatedOutputTokens,
      };
    });

    // Summary stats
    const totalOptimizations = history.length;
    const totalTokensSaved = totalHistorySavings;
    const totalCostSaved = Math.abs(totalHistoryCostSavings);

    // Total tokens used (original prompts — what the user actually typed)
    const totalTokensUsed = entriesWithTokens.reduce((s, e) => s + e.origTotalTokens, 0);
    const totalInputTokensUsed = entriesWithTokens.reduce((s, e) => s + e.origInputTokens, 0);
    const totalOutputTokensUsed = entriesWithTokens.reduce((s, e) => s + e.origOutputTokens, 0);
    const totalCostUsed = entriesWithTokens.reduce((s, e) => {
      const c = calculateCost(e.origInputTokens, e.origOutputTokens, e.model);
      return s + c.totalCost;
    }, 0);

    // Token usage over time (by date)
    const usageByDateMap = new Map<string, { tokens: number; cost: number; count: number }>();
    for (const entry of entriesWithTokens) {
      const dateKey = new Date(entry.timestamp).toLocaleDateString();
      const existing = usageByDateMap.get(dateKey) || { tokens: 0, cost: 0, count: 0 };
      existing.tokens += entry.origTotalTokens;
      existing.cost += calculateCost(entry.origInputTokens, entry.origOutputTokens, entry.model).totalCost;
      existing.count++;
      usageByDateMap.set(dateKey, existing);
    }
    const usageByDate = [...usageByDateMap.entries()]
      .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
      .slice(0, 14);
    const maxDayUsage = Math.max(...usageByDate.map(d => d[1].tokens), 1);

    // Avg reduction %
    let avgReduction = 0;
    const reductions: number[] = [];
    for (const entry of entriesWithTokens) {
      if (entry.origInputTokens > 0) {
        reductions.push((entry.tokensSaved / entry.origInputTokens) * 100);
      }
    }
    if (reductions.length > 0) {
      avgReduction = Math.round(reductions.reduce((a, b) => a + b, 0) / reductions.length);
    }

    // Group by date (last 14 days)
    const byDateMap = new Map<string, number>();
    for (const entry of history) {
      const dateKey = new Date(entry.timestamp).toLocaleDateString();
      byDateMap.set(dateKey, (byDateMap.get(dateKey) || 0) + entry.tokensSaved);
    }
    const byDate = [...byDateMap.entries()]
      .sort((a, b) => {
        const da = new Date(a[0]).getTime();
        const db = new Date(b[0]).getTime();
        return db - da;
      })
      .slice(0, 14);
    const maxDayTokens = Math.max(...byDate.map(d => d[1]), 1);

    // Group by model
    const byModelMap = new Map<string, { count: number; tokensSaved: number; costSaved: number }>();
    for (const entry of history) {
      const existing = byModelMap.get(entry.model) || { count: 0, tokensSaved: 0, costSaved: 0 };
      existing.count++;
      existing.tokensSaved += entry.tokensSaved;
      existing.costSaved += Math.abs(entry.costSaved);
      byModelMap.set(entry.model, existing);
    }
    const byModel = [...byModelMap.entries()].sort((a, b) => b[1].count - a[1].count);
    const maxModelCount = Math.max(...byModel.map(m => m[1].count), 1);

    // Top 10 heaviest prompts (by total original token count — input + estimated output)
    const heaviest = [...entriesWithTokens]
      .sort((a, b) => b.origTotalTokens - a.origTotalTokens)
      .slice(0, 10)
      .map(e => ({
        prompt: e.originalPrompt,
        origTotalTokens: e.origTotalTokens,
        origInputTokens: e.origInputTokens,
        origOutputTokens: e.origOutputTokens,
        cost: calculateCost(e.origInputTokens, e.origOutputTokens, e.model).totalCost,
        tokensSaved: e.tokensSaved,
        reduction: e.origInputTokens > 0 ? Math.round((e.tokensSaved / e.origInputTokens) * 100) : 0,
        model: e.model,
        timestamp: e.timestamp,
      }));

    // Rule breakdown — re-run optimize() on each entry
    const ruleCounts = new Map<string, number>();
    for (const entry of history) {
      const result = optimize(entry.originalPrompt, entry.model);
      for (const s of result.suggestions) {
        ruleCounts.set(s.rule, (ruleCounts.get(s.rule) || 0) + 1);
      }
    }
    const ruleBreakdown = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]);
    const maxRuleCount = Math.max(...ruleBreakdown.map(r => r[1]), 1);

    // Dynamic tips
    const tips: string[] = [];
    if (byModel.length > 0) {
      const topModel = byModel[0][0];
      const modelLabel = MODELS.find(m => m.value === topModel)?.label || topModel;
      const cheaperModels = ['gpt-4o-mini', 'gpt-3.5-turbo', 'claude-haiku-4-5'];
      if (!cheaperModels.includes(topModel)) {
        const cheaperLabel = MODELS.find(m => cheaperModels.includes(m.value))?.label || 'a cheaper model';
        tips.push(`You use ${modelLabel} most — consider ${cheaperLabel} for simple prompts to reduce costs.`);
      }
    }
    const avgTokens = entriesWithTokens.length > 0
      ? Math.round(entriesWithTokens.reduce((s, e) => s + e.origInputTokens, 0) / entriesWithTokens.length)
      : 0;
    if (avgTokens > 0) {
      const verbosity = avgTokens > 500 ? 'above average verbosity' : 'relatively concise';
      tips.push(`Your prompts average ${avgTokens.toLocaleString('en-US')} input tokens — ${verbosity}.`);
    }
    if (ruleBreakdown.length > 0) {
      const topRule = ruleBreakdown[0];
      const topRulePercent = Math.round((topRule[1] / totalOptimizations) * 100);
      tips.push(`"${topRule[0]}" is your #1 issue — triggered in ${topRulePercent}% of optimizations.`);
    }
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const thisWeekTokens = history.filter(e => e.timestamp > oneWeekAgo).reduce((s, e) => s + e.tokensSaved, 0);
    const lastWeekTokens = history.filter(e => e.timestamp > twoWeeksAgo && e.timestamp <= oneWeekAgo).reduce((s, e) => s + e.tokensSaved, 0);
    if (thisWeekTokens > 0) {
      const trend = lastWeekTokens === 0 ? 'a great start' : thisWeekTokens > lastWeekTokens ? `up from ${lastWeekTokens.toLocaleString('en-US')} last week` : `down from ${lastWeekTokens.toLocaleString('en-US')} last week`;
      tips.push(`You've saved ${thisWeekTokens.toLocaleString('en-US')} tokens this week — ${trend}.`);
    }

    // Claude Code efficiency tips (static best practices)
    const claudeCodeTips: Array<{ title: string; description: string }> = [
      {
        title: 'Use CLAUDE.md as a context pointer file',
        description: 'Keep CLAUDE.md under 100 lines as a lightweight map. Link to detailed files (tech stack, API specs, current task) rather than inlining everything — Claude only loads deep context when the task requires it, saving tokens on every session start.',
      },
      {
        title: 'Be specific, skip the pleasantries',
        description: 'Instead of "Can you please help me refactor the auth module?", write "Refactor auth module to use JWT instead of sessions." Direct prompts use fewer tokens and get better results.',
      },
      {
        title: 'State journal before /compact',
        description: 'Before running /compact, ask Claude to save the current goal, last 3 decisions, and any gotchas to .claude/MEMORY.md. Default summaries lose the "why" — a state journal preserves what matters through compaction.',
      },
      {
        title: 'Prefer Haiku for simple tasks',
        description: 'Use Claude Haiku for boilerplate generation, formatting, and simple edits. Reserve Opus/Sonnet for architecture decisions, complex debugging, and multi-file refactors.',
      },
      {
        title: 'Offload heavy work to subagents',
        description: 'Use the main session as a project manager. Delegate log analysis, multi-file grep, test generation, and boilerplate to subagents — they return concise summaries without eating your main context window.',
      },
      {
        title: 'Reference files by path, not content',
        description: 'Say "Update the handler in src/api/users.ts" instead of pasting the entire file. Claude Code can read files directly — pasting code into prompts wastes tokens.',
      },
      {
        title: 'Fresh sessions with zero re-priming',
        description: 'Start new sessions for unrelated tasks to avoid context pollution. A well-structured CLAUDE.md pointer file means Claude picks up project context automatically — no setup time needed.',
      },
      {
        title: 'Use headless mode for CI/automation',
        description: 'For repetitive tasks like code review or test generation, use claude -p "prompt" in scripts. Headless mode skips the interactive overhead and is more token-efficient.',
      },
    ];

    return {
      totalOptimizations,
      totalTokensSaved,
      totalCostSaved,
      avgReduction,
      totalTokensUsed,
      totalInputTokensUsed,
      totalOutputTokensUsed,
      totalCostUsed,
      usageByDate,
      maxDayUsage,
      byDate,
      maxDayTokens,
      byModel,
      maxModelCount,
      heaviest,
      ruleBreakdown,
      maxRuleCount,
      tips,
      claudeCodeTips,
    };
  }, [history, totalHistorySavings, totalHistoryCostSavings]);

  // === Optimization Actions computations (based on Claude Code real usage) ===
  const actions = useMemo(() => {
    if (!claudeData || claudeData.totalMessages === 0) return null;
    const canUseOpusPlan = claudePlan === 'max' || claudePlan === 'enterprise';

    // --- Action 1: Auto-Optimize Heaviest Prompts ---
    // Only process prompts that actually exist
    const optimizedPrompts = claudeData.heaviestPrompts.map(entry => {
      const result = optimize(entry.prompt, entry.model || 'claude-opus-4-6');
      const originalCost = entry.costUSD;
      const tokenSavingsRatio = result.originalTokens > 0
        ? result.tokenReduction / result.originalTokens : 0;
      const estimatedCostSaved = originalCost * tokenSavingsRatio;
      return {
        ...entry,
        optimized: result,
        estimatedCostSaved,
      };
    });
    // Minimum 3-token threshold: 1-2 token deltas are rounding/whitespace noise, not real savings
    const optimizablePrompts = optimizedPrompts.filter(p => p.optimized.tokenReduction >= 3);
    const promptOptimizationSavings = optimizablePrompts.reduce((s, p) => s + p.estimatedCostSaved, 0);
    // Only show this action if there are actual optimizable prompts
    const hasPromptOptimizations = optimizablePrompts.length > 0;

    // --- Action 2: Model Savings Calculator ---
    // Determine the cheapest model the user already uses as the comparison target
    const PRICING_PER_M: Record<string, { input: number; output: number }> = {
      'opus': { input: 15.0, output: 75.0 },
      'sonnet': { input: 3.0, output: 15.0 },
      'haiku': { input: 0.8, output: 4.0 },
    };
    // Find cheapest model in user's data to use as comparison baseline
    const userModelTiers = claudeData.byModel.map(m => {
      if (m.model.includes('haiku')) return 'haiku';
      if (m.model.includes('sonnet')) return 'sonnet';
      if (m.model.includes('opus')) return 'opus';
      return 'sonnet'; // fallback
    });
    const hasMultipleModelTiers = new Set(userModelTiers).size > 1;
    // Compare expensive models against the cheapest tier available
    const cheapestTier = userModelTiers.includes('haiku') ? 'haiku' : 'sonnet';
    const cheapestPricing = PRICING_PER_M[cheapestTier];
    const cheapestLabel = cheapestTier === 'haiku' ? 'Haiku' : 'Sonnet';

    const modelSavings = claudeData.byModel.map(m => {
      const actualCost = m.costUSD;
      const tier = m.model.includes('haiku') ? 'haiku' : m.model.includes('sonnet') ? 'sonnet' : m.model.includes('opus') ? 'opus' : 'sonnet';
      // Compare against cheapest tier
      const altCost =
        (m.inputTokens * cheapestPricing.input) / 1_000_000 +
        (m.outputTokens * cheapestPricing.output) / 1_000_000 +
        (m.cacheTokens * cheapestPricing.input * 0.1) / 1_000_000;
      const savings = actualCost - altCost;
      const isExpensive = tier === 'opus' || (tier === 'sonnet' && cheapestTier === 'haiku');
      return {
        model: m.model,
        displayName: m.model.replace('claude-', '').replace(/-20\d{6}$/, ''),
        messages: m.messages,
        actualCost,
        altCost,
        savings: Math.max(savings, 0),
        isExpensive,
        tier,
        recommendation: tier === 'opus'
          ? `Use ${cheapestLabel} for simple tasks (confirmations, small edits)`
          : tier === 'sonnet' && cheapestTier === 'haiku'
            ? 'Consider Haiku for boilerplate and formatting'
            : tier === cheapestTier
              ? 'Already cost-efficient'
              : 'Good balance of cost and capability',
      };
    });
    const totalModelSavings = modelSavings.reduce((s, m) => s + m.savings, 0);
    // Only show if there's meaningful savings (>$1) and user uses expensive models
    const hasModelSavings = totalModelSavings > 1 && modelSavings.some(m => m.isExpensive);

    // --- Action 3: Session Health Alerts ---
    const sessionHealth = claudeData.sessions.map(s => {
      const costPerMsg = s.messages > 0 ? s.costUSD / s.messages : 0;
      let grade: string;
      const issues: string[] = [];
      let friendlyIssue = '';  // plain-English explanation shown in the card

      if (s.messages > 200) {
        grade = 'F';
        issues.push(`${s.messages} messages — extreme context bloat`);
        friendlyIssue = `${s.messages} messages — Claude re-reads your entire history on every reply. Very costly. Start a fresh session or run /compact immediately.`;
      } else if (s.messages > 100) {
        grade = 'D';
        issues.push(`${s.messages} messages — heavy context accumulation`);
        friendlyIssue = `${s.messages} messages — conversation is very long. Each reply carries the weight of everything said before, driving up cost.`;
      } else if (s.messages > 50) {
        grade = 'C';
        issues.push(`${s.messages} messages — consider /compact`);
        friendlyIssue = `${s.messages} messages — getting long. Run /compact to compress history so Claude only remembers what matters.`;
      } else if (costPerMsg > 2) {
        grade = 'C';
        issues.push(`$${costPerMsg.toFixed(2)}/msg — high cost per message`);
        friendlyIssue = `$${costPerMsg.toFixed(2)} per message — each back-and-forth is expensive. Try shorter, more focused prompts.`;
      } else if (s.messages > 30 && costPerMsg > 1) {
        grade = 'B';
        issues.push('Moderate context usage');
        friendlyIssue = `${s.messages} messages at $${costPerMsg.toFixed(2)}/msg — manageable but worth watching.`;
      } else {
        grade = 'A';
        friendlyIssue = 'Session is healthy — short and focused.';
      }

      if (costPerMsg > 3) {
        issues.push(`$${costPerMsg.toFixed(2)}/msg — very expensive per interaction`);
      }
      if (s.costUSD > 50) {
        issues.push(`$${s.costUSD.toFixed(2)} total — consider splitting into multiple sessions`);
        if (!friendlyIssue.includes('split')) {
          friendlyIssue += ` Total cost $${s.costUSD.toFixed(2)} — this session is doing too much. Break it into smaller focused sessions.`;
        }
      }

      // Estimate /compact savings: for sessions >50 msgs, compacting every 50 could save ~30% of cache costs
      const compactSavings = s.messages > 50
        ? s.costUSD * 0.3 * ((s.messages - 50) / s.messages)
        : 0;

      return {
        ...s,
        costPerMsg,
        grade,
        issues,
        friendlyIssue,
        compactSavings,
      };
    });
    const totalSessionSavings = sessionHealth.reduce((s, h) => s + h.compactSavings, 0);
    const unhealthySessions = sessionHealth.filter(s => s.grade !== 'A' && s.grade !== 'B');
    const worstSession = sessionHealth.length > 0
      ? [...sessionHealth].sort((a, b) => b.costUSD - a.costUSD)[0]
      : null;
    // Only show if there are sessions that need attention
    const hasSessionIssues = unhealthySessions.length > 0;

    // --- Action 4: Generate CLAUDE.md ---
    // Use the user's most-used model for strategy analysis
    const primaryModel = claudeData.byModel[0]?.model || 'claude-sonnet-4-6';
    const strategyAnalysis = analyzeStrategies({ model: primaryModel });
    const claudeMdLines: string[] = [
      '# CLAUDE.md — Auto-generated by PromptFuel',
      '',
      '## Model Intelligence Routing',
      'Actively suggest a model switch based on these boundaries.',
      '',
      '**Enforcement rule: When a switch is warranted, suggest it and STOP. Do not proceed until the user explicitly confirms or declines. A suggestion followed by self-override is not a suggestion.**',
      '',
      '**Routing discipline: Every task, no exceptions — route first, then act. Even when the answer is "stay on current model", say it out loud before starting.**',
      '',
      '**No-exemption list: The routing declaration is required even for:**',
      '- Conversational or explanatory questions ("what does X do?")',
      '- Small single-file edits or UI tweaks',
      '- Tasks where the answer is obviously "stay on current model"',
      '- Follow-up tasks immediately after a previous routing decision',
      '',
      '**Format — always one line before any answer or action:**',
      '> Routing: stay on Sonnet — [reason]',
      '> Routing: suggest /model opus — [reason]. Waiting for confirmation before proceeding.',
      '',
      '**Recurring failure pattern to avoid:** Silently skipping the routing declaration and proceeding directly to the answer or edit. This is the same failure as self-overriding — acting without declaring. If this rule has been missed, do not rationalize it; acknowledge and correct going forward.',
    ];
    // Build model setup tip and behavioral rules — adapted to the user's actual plan
    const opusData = claudeData.byModel.find(m => m.model.includes('opus'));
    const sonnetData = claudeData.byModel.find(m => m.model.includes('sonnet'));
    const haikuData = claudeData.byModel.find(m => m.model.includes('haiku'));
    let modelSetupTip = '';

    if (canUseOpusPlan) {
      // Max / Enterprise — opusplan handles routing automatically
      if (opusData && sonnetData) {
        modelSetupTip = 'You use both Opus and Sonnet. Run /model opusplan or add "model": "opusplan" to your settings — this automatically uses Opus for planning and Sonnet for execution, giving you the best of both without manual switching.';
      } else if (opusData && !sonnetData) {
        modelSetupTip = 'All your usage is on Opus. Run /model opusplan to automatically use Sonnet for execution tasks — Sonnet is 5x cheaper and the switch happens at natural plan→execute boundaries.';
      } else {
        modelSetupTip = 'Run /model opusplan to get Opus reasoning during planning and Sonnet speed during execution automatically.';
      }
      claudeMdLines.push(
        '',
        '### Suggest /model haiku IF:',
        '- Pure boilerplate (e.g., "Add JSDoc to these 10 functions")',
        '- Verification tasks (e.g., "Check for typos", "Run the linter")',
        '- Single-file unit tests where the logic is already clear',
        '',
        '### Suggest /model opus IF:',
        '- 3-File Rule: Change impacts >3 unrelated modules or requires tracing logic across the system',
        '- 2-Fail Rule: Implementation fails tests twice on Sonnet — stop and suggest Opus for a deep audit',
        '- High-Stakes: Any change to core database schema, security/auth logic, or central state management',
        '- Research/Strategy Rule: Task requires deriving an answer from conflicting or ambiguous evidence, OR the output directly drives a high-stakes product/business decision (positioning, pricing, pivots)',
        '',
        '### 2-Fail Rule — Strict Clarifications',
        '- What counts as a failure: user reports fix didn\'t work, OR a new version published without user confirming previous one worked. "Different approach" does not reset the counter.',
        '- What STOP means: output the suggestion, then write nothing — no code, no commands, no publishes. Wait for explicit confirmation.',
        '- Each published fix version = one attempt. Bug persists after 2 published versions = rule triggered.',
        '- No self-override: suggesting a switch then continuing anyway is a rule violation.',
        '',
        'All other tasks stay on the current model. opusplan handles Opus/Sonnet routing automatically.',
      );
    } else {
      // Pro / Team Standard — no opusplan, bidirectional routing to preserve Opus quota
      if (opusData) {
        modelSetupTip = 'Your Opus quota is limited on Pro. The rules below tell Claude when to suggest switching UP to Opus and when to suggest switching DOWN — so every Opus message counts.';
      } else if (haikuData) {
        modelSetupTip = 'Great cost discipline using Haiku. The rules below define when to escalate to Sonnet or Opus, and when to drop back down.';
      } else {
        modelSetupTip = 'Your Opus quota is limited on Pro. The rules below tell Claude when to suggest switching models in either direction — up for hard problems, down to save quota.';
      }
      claudeMdLines.push(
        '',
        '### Suggest /model haiku IF:',
        '- Pure boilerplate (e.g., "Add JSDoc to these 10 functions")',
        '- Verification tasks (e.g., "Check for typos", "Run the linter")',
        '- Single-file unit tests where the logic is already clear',
        '',
        '### Suggest /model sonnet IF currently on Opus and:',
        '- Implementing a feature across 1-3 files',
        '- Performing standard bug fixes',
        '- Follow-up work after Opus has resolved the hard problem — do not stay on Opus',
        '',
        '### Suggest /model opus IF:',
        '- 3-File Rule: Change impacts >3 unrelated modules or requires tracing logic across the system',
        '- 2-Fail Rule: Implementation fails tests twice on Sonnet — stop and suggest Opus for a deep audit',
        '- High-Stakes: Any change to core database schema, security/auth logic, or central state management',
        '- Research/Strategy Rule: Task requires deriving an answer from conflicting or ambiguous evidence, OR the output directly drives a high-stakes product/business decision (positioning, pricing, pivots)',
        '- After Opus resolves the problem, IMMEDIATELY suggest /model sonnet',
        '',
        '### 2-Fail Rule — Strict Clarifications',
        '- What counts as a failure: user reports fix didn\'t work, OR a new version published without user confirming previous one worked. "Different approach" does not reset the counter.',
        '- What STOP means: output the suggestion, then write nothing — no code, no commands, no publishes. Wait for explicit confirmation.',
        '- Each published fix version = one attempt. Bug persists after 2 published versions = rule triggered.',
        '- No self-override: suggesting a switch then continuing anyway is a rule violation.',
      );
    }

    // Session guidelines based on actual session patterns — with mitigations for each guideline's trade-off
    claudeMdLines.push('', '## Session Guidelines');
    const avgMsgsPerSession = claudeData.totalMessages / Math.max(claudeData.totalSessions, 1);

    if (worstSession && worstSession.messages > 50) {
      claudeMdLines.push(
        `- Before running /compact, ALWAYS update .claude/MEMORY.md with: the current goal, last 3 technical decisions, and any gotchas discovered. Then run /compact, then re-read the memory file.`,
      );
    }
    if (avgMsgsPerSession > 30) {
      claudeMdLines.push(
        '- Start fresh sessions for unrelated tasks. Keep CLAUDE.md under 100 lines as a "pointer file" — link to detailed docs (tech stack, API specs, current task) rather than inlining everything.',
        '- For long sessions, delegate heavy work (log analysis, grep, test generation, boilerplate) to subagents. The main session stays as a clean project manager — return only concise summaries.',
      );
    } else {
      claudeMdLines.push('- Your sessions are well-sized — keep maintaining focused sessions');
    }

    // Context management rules
    claudeMdLines.push(
      '',
      '## Context Management',
      '- Use a tiered docs system: CLAUDE.md is the map, detailed context lives in separate files read on-demand',
      '- Only load deep context files when the task specifically requires them',
    );

    claudeMdLines.push(
      '',
      '## Prompt Style',
      '- Be direct — skip pleasantries and filler phrases',
      '- Reference files by path instead of pasting content',
      '- Batch related changes into single prompts',
      '- Use imperative instructions: "Add X to Y" not "Could you please add X to Y?"',
      '',
      '## Token Optimization Rules',
    );
    if (strategyAnalysis.recommendations.length > 0) {
      for (const rec of strategyAnalysis.recommendations.slice(0, 5)) {
        claudeMdLines.push(`- ${rec.name}: ${rec.description}`);
      }
    } else {
      claudeMdLines.push(
        '- Remove filler words and redundant phrases',
        '- Use structured prompts with clear sections',
        '- Avoid repeating instructions within a session',
      );
    }
    const claudeMdContent = claudeMdLines.join('\n');

    // --- Action 5: Cache Savings Analysis ---
    const hasCacheOpportunity = !!(claudeData.cacheAnalysis
      && claudeData.cacheAnalysis.clusters.length > 0
      && claudeData.cacheAnalysis.estimatedMonthlySavings > 0.01);
    const cacheSavings = claudeData.cacheAnalysis?.estimatedMonthlySavings ?? 0;

    // --- Action 6: Cost Reduction Summary ---
    const claudeMdSavings = Math.max(totalModelSavings * 0.1, totalSessionSavings * 0.05);
    const totalPotentialSavings = promptOptimizationSavings + totalModelSavings + totalSessionSavings + claudeMdSavings + cacheSavings;
    const totalCost = claudeData.totals.estimatedCostUSD;
    const savingsPercent = totalCost > 0 ? Math.min(Math.round((totalPotentialSavings / totalCost) * 100), 99) : 0;

    // Build list of which action cards to show
    const visibleActions: string[] = [];
    if (hasPromptOptimizations) visibleActions.push('prompts');
    if (hasModelSavings) visibleActions.push('models');
    if (hasSessionIssues) visibleActions.push('sessions');
    if (hasCacheOpportunity) visibleActions.push('cache');
    visibleActions.push('claudemd'); // Always show — every user benefits from CLAUDE.md

    // Build savings breakdown, only including non-zero categories
    const savingsBreakdown: Array<{ label: string; amount: number; color: string }> = [];
    if (totalModelSavings > 0.5) savingsBreakdown.push({ label: 'Model Routing', amount: totalModelSavings, color: '#8b5cf6' });
    if (totalSessionSavings > 0.5) savingsBreakdown.push({ label: 'Session Hygiene', amount: totalSessionSavings, color: '#06b6d4' });
    if (promptOptimizationSavings > 0.01) savingsBreakdown.push({ label: 'Prompt Optimization', amount: promptOptimizationSavings, color: '#f97316' });
    if (cacheSavings > 0.01) savingsBreakdown.push({ label: 'Semantic Caching', amount: cacheSavings, color: '#3b82f6' });
    if (claudeMdSavings > 0.5) savingsBreakdown.push({ label: 'CLAUDE.md', amount: claudeMdSavings, color: '#22c55e' });

    // --- Heaviest prompts with per-prompt suggestions ---
    // Each suggestion maps to one of the action cards so the user knows exactly where to act.
    type PromptSuggestion = { label: string; actionId: string; color: string; bg: string };
    const heaviestWithSuggestions = claudeData.heaviestPrompts.slice(0, 5).map(entry => {
      const optResult = optimize(entry.prompt, entry.model || 'claude-sonnet-4-6');
      let suggestion: PromptSuggestion | null = null;

      if (optResult.tokenReduction >= 3) {
        // Optimizer can meaningfully shorten this prompt
        suggestion = {
          label: `Optimize −${optResult.tokenReduction} tokens`,
          actionId: 'prompts',
          color: '#059669',
          bg: '#d1fae5',
        };
      } else if (entry.inputTokens > 600) {
        // Very long input — likely contains pasted context that belongs in CLAUDE.md
        suggestion = {
          label: 'Move context → CLAUDE.md',
          actionId: 'claudemd',
          color: '#7c3aed',
          bg: '#ede9fe',
        };
      } else if (entry.outputTokens > entry.inputTokens * 2 && entry.outputTokens > 800) {
        // Claude generated a lot — task was large, suggest splitting sessions
        suggestion = {
          label: 'Split into smaller tasks',
          actionId: 'sessions',
          color: '#d97706',
          bg: '#fef3c7',
        };
      } else if (entry.model?.includes('opus') && !entry.model?.includes('haiku')) {
        // Using an expensive model — model savings card can help
        suggestion = {
          label: `Try ${cheapestLabel} for this task`,
          actionId: 'models',
          color: '#2563eb',
          bg: '#dbeafe',
        };
      } else if (hasSessionIssues) {
        // Heavy prompt in a session with known issues
        suggestion = {
          label: 'Review session health',
          actionId: 'sessions',
          color: '#d97706',
          bg: '#fef3c7',
        };
      }

      return { ...entry, suggestion };
    });

    return {
      optimizedPrompts,
      optimizablePrompts,
      promptOptimizationSavings,
      hasPromptOptimizations,
      modelSavings,
      totalModelSavings,
      hasModelSavings,
      cheapestLabel,
      sessionHealth,
      totalSessionSavings,
      unhealthySessions,
      worstSession,
      hasSessionIssues,
      hasCacheOpportunity,
      cacheSavings,
      claudeMdContent,
      modelSetupTip,
      claudeMdSavings,
      totalPotentialSavings,
      savingsPercent,
      visibleActions,
      savingsBreakdown,
      heaviestWithSuggestions,
    };
  }, [claudeData, claudePlan]);

  // --- State for actions UI ---
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [claudeMdSaved, setClaudeMdSaved] = useState(false);
  const [dismissedActions, setDismissedActions] = useState<string[]>(loadDismissedActions);

  const handleDismissAction = (actionId: string) => {
    const updated = [...dismissedActions, actionId];
    setDismissedActions(updated);
    saveDismissedActions(updated);
    if (expandedAction === actionId) setExpandedAction(null);
  };

  const handleRefresh = () => {
    setClaudeMdSaved(false);
    setExpandedAction(null);
    fetchClaudeData();
  };

  const handleCopyAction = async (text: string, actionId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAction(actionId);
      setTimeout(() => setCopiedAction(null), 2000);
    } catch {}
  };

  const handleSaveClaudeMd = async () => {
    if (!actions) return;
    try {
      const res = await fetch('/__claude-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write-claude-md', content: actions.claudeMdContent }),
      });
      const data = await res.json();
      if (data.success) setClaudeMdSaved(true);
    } catch {}
  };

  const warningColor: Record<string, string> = {
    green: '#059669',
    yellow: '#d97706',
    orange: '#ea580c',
    red: '#dc2626',
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', margin: '0 auto', padding: '32px 40px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: 0 }}>PromptFuel</h1>
          <span style={{ fontSize: 12, color: '#64748b', background: '#e2e8f0', padding: '3px 8px', borderRadius: 4 }}>
            Token Optimizer & Insights
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 13, color: '#64748b' }}>Model:</label>
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              background: '#ffffff', color: '#1e293b', border: '1px solid #e2e8f0',
              borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
            }}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #e2e8f0' }}>
        {([
          { key: 'insights' as Tab, label: 'Claude Code Insights' },
          { key: 'analyze' as Tab, label: 'Analyze & Optimize' },
          { key: 'history' as Tab, label: `History (${history.length})` },
          { key: 'strategies' as Tab, label: 'Strategies' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...tabBtnStyle,
              background: 'transparent',
              color: tab === t.key ? '#3b82f6' : '#64748b',
              borderBottom: tab === t.key ? '2px solid #3b82f6' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === ANALYZE TAB === */}
      {tab === 'analyze' && (
        <>
          {/* Budget + Aggressive — only relevant for this tab */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 13, color: '#64748b' }}>Token Budget:</label>
            <input
              type="number"
              min={1}
              placeholder="target tokens"
              value={targetTokens ?? ''}
              onChange={(e) => handleBudgetChange(e.target.value)}
              style={{
                background: '#ffffff', color: '#1e293b', border: '1px solid #e2e8f0',
                borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 110,
              }}
            />
            <button
              onClick={handleAggressiveToggle}
              title="Removes hedge adverbs (very/really), weak qualifiers (just/simply/kind of), and low-value openers (basically/in summary)"
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                background: aggressive ? '#ef4444' : '#f1f5f9',
                color: aggressive ? '#ffffff' : '#64748b',
                border: aggressive ? '1px solid #ef4444' : '1px solid #e2e8f0',
                borderRadius: 6, padding: '6px 10px', fontSize: 13, fontWeight: aggressive ? 600 : 400,
              }}
            >
              ⚡ Aggressive
            </button>
          </div>

          <div style={{ marginBottom: 24 }}>
            <textarea
              value={prompt}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="Paste or type your prompt here..."
              rows={8}
              style={{
                width: '100%', background: '#ffffff', color: '#1e293b',
                border: '1px solid #e2e8f0', borderRadius: 8, padding: 16,
                fontSize: 14, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}
            />
          </div>

          {analysis && (
            <>
              {analysis.optimization && (analysis.optimization.suggestions.length > 0 || analysis.optimization.tokenReduction > 0) && (
                <div style={{ ...sectionStyle, marginBottom: 20 }}>
                  <div style={{ ...sectionHeader, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      Optimization Suggestions
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#059669' }}>
                        Save {analysis.optimization.tokenReduction} tokens ({analysis.optimization.reductionPercent}%)
                      </span>
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      Verbosity: {analysis.optimization.verbosityScore}/100
                    </span>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    {analysis.optimization.suggestions.map((s, i) => (
                      <div key={i} style={{
                        padding: '8px 12px', marginBottom: 4,
                        background: '#f8fafc', borderRadius: 6, fontSize: 13,
                        borderLeft: `3px solid ${ruleColor(s.rule)}`,
                        border: '1px solid #e2e8f0',
                        borderLeftWidth: 3,
                        borderLeftStyle: 'solid',
                        borderLeftColor: ruleColor(s.rule),
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#1e293b' }}>{s.description}</span>
                          <span style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', marginLeft: 12 }}>
                            {s.rule}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <pre style={{
                    marginTop: 12, padding: 12, background: '#f0fdf4',
                    borderRadius: 6, fontSize: 13, lineHeight: 1.5,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    border: '1px solid #bbf7d0', color: '#1e293b',
                  }}>
                    {analysis.optimization.optimizedPrompt}
                  </pre>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={handleApplyOptimized} style={{ ...btnStyle, background: '#059669', color: '#ffffff' }}>
                      Apply Optimization
                    </button>
                    <button onClick={handleCopyOptimized} style={btnStyle}>
                      {copied ? 'Copied!' : 'Copy Optimized'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                <StatCard label="Input Tokens" value={analysis.inputTokens.toLocaleString('en-US')} />
                <StatCard label="Est. Output Tokens" value={analysis.outputTokens.toLocaleString('en-US')} />
                <StatCard label="Total Tokens" value={(analysis.inputTokens + analysis.outputTokens).toLocaleString('en-US')} />
                <StatCard label="Estimated Cost" value={formatCost(analysis.totalCost)} highlight />
              </div>

              <div style={{ ...sectionStyle, marginBottom: 20 }}>
                <div style={sectionHeader}>Cost Breakdown</div>
                <div style={{ display: 'flex', gap: 32 }}>
                  <div><span style={{ color: '#64748b', fontSize: 12 }}>Input: </span><span style={{ fontWeight: 600, color: '#1e293b' }}>{formatCost(analysis.inputCost)}</span></div>
                  <div><span style={{ color: '#64748b', fontSize: 12 }}>Output: </span><span style={{ fontWeight: 600, color: '#1e293b' }}>{formatCost(analysis.outputCost)}</span></div>
                  <div><span style={{ color: '#64748b', fontSize: 12 }}>Total: </span><span style={{ fontWeight: 600, color: '#3b82f6' }}>{formatCost(analysis.totalCost)}</span></div>
                </div>
              </div>

              {analysis.optimization?.intent && analysis.optimization.intent.type !== 'general' && (
                <div style={{ ...sectionStyle, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={sectionHeader}>Detected Intent</span>
                    <span style={{
                      background: ({ debug: '#ef4444', 'code-gen': '#3b82f6', refactor: '#8b5cf6', explain: '#06b6d4', creative: '#f59e0b', general: '#64748b' } as Record<string, string>)[analysis.optimization.intent.type] || '#64748b',
                      color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    }}>
                      {analysis.optimization.intent.type}
                    </span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {Math.round(analysis.optimization.intent.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    Some optimization rules adjusted for {analysis.optimization.intent.type} prompts
                  </div>
                </div>
              )}

              {analysis.optimization?.budget && (
                <div style={{ ...sectionStyle, marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={sectionHeader}>Token Budget</span>
                    <span style={{
                      background: analysis.optimization.budget.targetMet ? '#22c55e' : '#f59e0b',
                      color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    }}>
                      {analysis.optimization.budget.targetMet ? 'Target Met' : 'Over Budget'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    Level {analysis.optimization.budget.levelApplied} compression applied.{' '}
                    {analysis.optimization.budget.targetMet
                      ? `Optimized to ${analysis.optimization.optimizedTokens} / ${analysis.optimization.budget.targetTokens} tokens.`
                      : `${analysis.optimization.budget.remainingGap} tokens over target (${analysis.optimization.budget.targetTokens}).`
                    }
                  </div>
                </div>
              )}

              <div style={{ ...sectionStyle, marginBottom: 20 }}>
                <div style={sectionHeader}>
                  Context Window
                  <span style={{ color: warningColor[analysis.contextStatus.warning], marginLeft: 8, fontSize: 12 }}>
                    {analysis.contextStatus.warning.toUpperCase()}
                  </span>
                </div>
                <div style={{ background: '#e2e8f0', borderRadius: 6, height: 24, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%', borderRadius: 6, transition: 'width 0.3s',
                    width: `${Math.min(analysis.contextStatus.percentUsed, 100)}%`,
                    background: warningColor[analysis.contextStatus.warning],
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b' }}>
                  <span>{analysis.contextStatus.percentUsed}% used</span>
                  <span>{analysis.contextStatus.remainingTokens.toLocaleString('en-US')} remaining of {analysis.contextStatus.contextWindow.toLocaleString('en-US')}</span>
                </div>
              </div>

            </>
          )}

          {!analysis && (
            <div style={{ color: '#1e293b' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#1e293b' }}>What this tab does</div>
                <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px 0', lineHeight: 1.6 }}>
                  Paste any single prompt and PromptFuel will instantly show you how many tokens it uses, what it will cost, and how to make it shorter — without changing what you're asking.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    'Token count + cost estimate for your chosen model',
                    'How much of the context window you\'re using',
                    'Detected intent (debugging, code-gen, explanation, etc.)',
                    'Exact list of what was removed and why',
                    'A ready-to-copy optimized version of your prompt',
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151' }}>
                      <span style={{ color: '#059669', fontWeight: 700, marginTop: 1 }}>✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, color: '#1e293b' }}>Example</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', letterSpacing: '0.5px', marginBottom: 6 }}>BEFORE — 23 tokens</div>
                    <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                      I was wondering if you could please provide me with a detailed and comprehensive explanation of how React hooks work in detail.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', letterSpacing: '0.5px', marginBottom: 6 }}>AFTER — 12 tokens</div>
                    <div style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#1e293b', lineHeight: 1.6 }}>
                      Provide a detailed explanation of how React hooks work in detail.
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                  Removed filler: "I was wondering if you could", "please", "comprehensive" — intent preserved: "detailed" kept, 48% fewer tokens.
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* === HISTORY TAB === */}
      {tab === 'history' && (
        <>
          {history.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
              <StatCard label="Total Optimizations" value={history.length.toString()} />
              <StatCard label="Tokens Saved" value={totalHistorySavings.toLocaleString('en-US')} highlight />
              <StatCard label="Cost Saved" value={formatCost(Math.abs(totalHistoryCostSavings))} />
            </div>
          )}

          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
              <p style={{ fontSize: 16, marginBottom: 8, color: '#64748b' }}>No optimization history yet</p>
              <p style={{ fontSize: 13 }}>Apply optimizations in the Analyze tab to start tracking savings</p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={sectionHeader}>Recent Optimizations</div>
                <button
                  onClick={() => { setHistory([]); saveHistory([]); }}
                  style={{ ...btnStyle, fontSize: 11, padding: '4px 10px' }}
                >
                  Clear History
                </button>
              </div>
              {[...history].reverse().map((entry, i) => (
                <div key={i} style={{ ...sectionStyle, marginBottom: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>
                      {new Date(entry.timestamp).toLocaleString()} | {entry.model}
                    </span>
                    <span style={{ color: '#059669', fontSize: 12, fontWeight: 600 }}>
                      -{entry.tokensSaved} tokens
                    </span>
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: '#dc2626', fontSize: 11 }}>BEFORE: </span>
                    <span style={{ color: '#64748b' }}>
                      {entry.originalPrompt.length > 100 ? entry.originalPrompt.slice(0, 97) + '...' : entry.originalPrompt}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: '#059669', fontSize: 11 }}>AFTER: </span>
                    <span style={{ color: '#1e293b' }}>
                      {entry.optimizedPrompt.length > 100 ? entry.optimizedPrompt.slice(0, 97) + '...' : entry.optimizedPrompt}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* === STRATEGIES TAB === */}
      {tab === 'strategies' && (
        <>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#1e293b' }}>Two ways to get strategies for your project</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                {
                  badge: 'OPTION A',
                  badgeColor: '#2563eb',
                  badgeBg: '#dbeafe',
                  title: 'Paste a conversation below',
                  desc: 'Copy any conversation from Claude or ChatGPT and paste it into the box below. Works for any AI tool — no install needed.',
                },
                {
                  badge: 'OPTION B',
                  badgeColor: '#059669',
                  badgeBg: '#d1fae5',
                  title: 'Scan your project folder from the terminal',
                  desc: 'Gets project-level recommendations based on your actual files (CLAUDE.md, package.json, README, etc.).',
                  code: 'pf strategies',
                  hint: '📟 Run in your terminal from inside your project folder',
                },
                {
                  badge: 'OPTION C',
                  badgeColor: '#7c3aed',
                  badgeBg: '#ede9fe',
                  title: 'Ask Claude Code directly (MCP)',
                  desc: 'If you have the PromptFuel MCP server set up, just ask Claude in chat:',
                  code: 'Use analyze_strategies to scan this project',
                  hint: '💬 Type this in Claude Code chat (run pf setup first if not configured)',
                },
              ].map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: opt.badgeBg, color: opt.badgeColor, whiteSpace: 'nowrap', marginTop: 2 }}>
                    {opt.badge}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{opt.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: opt.code ? 6 : 0 }}>{opt.desc}</div>
                    {opt.code && (
                      <>
                        <code style={{ fontSize: 12, color: '#1e40af', fontFamily: 'monospace', background: '#eff6ff', padding: '2px 8px', borderRadius: 4 }}>{opt.code}</code>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{opt.hint}</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...sectionStyle, marginBottom: 20 }}>
            <div style={sectionHeader}>Conversation Analysis</div>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
              Paste your conversation transcript below (one message per line, alternating user/assistant).
              We'll analyze it for token-saving opportunities.
            </p>
            <textarea
              value={strategyInput}
              onChange={(e) => setStrategyInput(e.target.value)}
              placeholder={'User: How does React work?\nAssistant: React works by...\nUser: Can you explain more about hooks?\n...'}
              rows={6}
              style={{
                width: '100%', background: '#f8fafc', color: '#1e293b',
                border: '1px solid #e2e8f0', borderRadius: 6, padding: 12,
                fontSize: 13, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <button onClick={handleAnalyzeStrategies} style={{ ...btnStyle, marginTop: 8, background: '#3b82f6', color: '#ffffff' }}>
              Analyze Strategies
            </button>
          </div>

          {strategyResult && (
            <>
              {strategyResult.recommendations.length === 0 ? (
                <div style={{ ...sectionStyle, textAlign: 'center', padding: 32, color: '#059669' }}>
                  No issues found — your conversation looks well-optimized!
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <StatCard label="Recommendations" value={strategyResult.recommendations.length.toString()} />
                    <StatCard label="Potential Token Savings" value={strategyResult.totalEstimatedTokenSavings.toLocaleString('en-US')} highlight />
                    <StatCard label="Potential Cost Savings" value={formatCost(strategyResult.totalEstimatedCostSavings)} />
                  </div>

                  {strategyResult.recommendations.map((rec, i) => (
                    <div key={i} style={{
                      ...sectionStyle, marginBottom: 12,
                      borderLeft: `3px solid ${rec.impact === 'high' ? '#dc2626' : rec.impact === 'medium' ? '#d97706' : '#94a3b8'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                            background: rec.impact === 'high' ? '#fee2e2' : rec.impact === 'medium' ? '#fef3c7' : '#f1f5f9',
                            color: rec.impact === 'high' ? '#dc2626' : rec.impact === 'medium' ? '#d97706' : '#64748b',
                          }}>
                            {rec.impact.toUpperCase()}
                          </span>
                          <span style={{ fontWeight: 600, color: '#1e293b' }}>{rec.name}</span>
                        </div>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{rec.category}</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px 0', lineHeight: 1.5 }}>
                        {rec.description}
                      </p>
                      <div style={{ fontSize: 12, color: '#059669' }}>
                        {rec.estimatedTokenSavings > 0 && <span>~{rec.estimatedTokenSavings.toLocaleString('en-US')} tokens saved</span>}
                        {rec.estimatedTokenSavings > 0 && rec.estimatedCostSavings > 0 && <span> | </span>}
                        {rec.estimatedCostSavings > 0 && <span>~{formatCost(rec.estimatedCostSavings)} saved</span>}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {!strategyResult && !strategyInput && (
            <div style={{ color: '#1e293b' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: '#1e293b' }}>What this tab does</div>
                <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 4px 0', lineHeight: 1.6 }}>
                  Paste a back-and-forth conversation (User + Assistant turns) and PromptFuel will look at the <em>whole conversation</em> — not just one message — to find structural patterns that are wasting tokens.
                </p>
                <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px 0', lineHeight: 1.6 }}>
                  Unlike the Analyze tab which rewrites a single prompt, Strategies tells you <em>how to work differently</em> — e.g. stop repeating context, break big tasks into smaller ones, or use a cheaper model for simple messages.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    'Detects repeated context across messages',
                    'Flags messages that are too long and should be split',
                    'Identifies when you\'re using an expensive model unnecessarily',
                    'Estimates total tokens + cost you could save',
                    'Each recommendation ranked HIGH / MEDIUM / LOW impact',
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151' }}>
                      <span style={{ color: '#3b82f6', fontWeight: 700, marginTop: 1 }}>✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: '#1e293b' }}>Example conversation to paste</div>
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '12px 14px', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.8, color: '#374151' }}>
                  <div><span style={{ color: '#2563eb', fontWeight: 600 }}>User:</span> I'm building a React app. How do I fetch data?</div>
                  <div><span style={{ color: '#7c3aed', fontWeight: 600 }}>Assistant:</span> You can use useEffect with fetch or a library like axios...</div>
                  <div><span style={{ color: '#2563eb', fontWeight: 600 }}>User:</span> I'm building a React app. Can you show me a useEffect example?</div>
                  <div><span style={{ color: '#7c3aed', fontWeight: 600 }}>Assistant:</span> Sure, here's a useEffect example...</div>
                  <div><span style={{ color: '#2563eb', fontWeight: 600 }}>User:</span> I'm building a React app. Now how do I handle errors?</div>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
                  Strategies would flag: "Repeated context — you're sending 'I'm building a React app' every message. Set it once in a system prompt or CLAUDE.md instead." (HIGH impact, ~30 tokens saved per message)
                </div>
              </div>

            </div>
          )}
        </>
      )}


      {/* === INSIGHTS TAB === */}
      {tab === 'insights' && (
        <>
          {/* ── Empty state ── */}
          {(!claudeData || claudeData.totalMessages === 0) && (
            <div style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                No insights yet
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 32, maxWidth: 360, margin: '0 auto 32px' }}>
                This tab is for <strong>Claude Code users only</strong>. It reads your local <code style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 3 }}>~/.claude/</code> usage logs to show token spend, cost, and savings opportunities. ChatGPT / OpenAI users — this tab won't have data for you.
              </div>

              {/* Steps */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420, margin: '0 auto', textAlign: 'left' }}>
                {[
                  {
                    step: '1',
                    label: 'Install PromptFuel',
                    hint: '📟 Your system terminal — iTerm, Terminal.app, VS Code terminal, or Claude Code\'s built-in terminal',
                    code: 'npm install -g promptfuel --no-fund',
                  },
                  {
                    step: '2',
                    label: 'Get a quick CLI summary',
                    hint: '📟 Any terminal including Claude Code — prints token usage & cost across all Claude Code projects',
                    code: 'pf insights',
                  },
                  {
                    step: '3',
                    label: 'Open the full dashboard',
                    hint: '📟 Any terminal including Claude Code — opens this page locally with your real ~/.claude/ data loaded',
                    code: 'pf dashboard',
                  },
                ].map(item => (
                  <div key={item.step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {item.step}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{item.hint}</div>
                      <code style={{ fontSize: 12, color: '#3b82f6', fontFamily: 'monospace', background: '#eff6ff', padding: '2px 8px', borderRadius: 4 }}>{item.code}</code>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, fontSize: 12, color: '#94a3b8' }}>
                No data leaves your machine — everything is read from <code style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>~/.claude/</code> locally.
              </div>
            </div>
          )}

          {/* ── Claude Code Usage ── */}
          {claudeData && claudeData.totalMessages > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Claude Code Usage
                </div>
                <button
                  onClick={handleRefresh}
                  disabled={insightsLoading}
                  style={{
                    background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
                    padding: '4px 12px', fontSize: 12, color: '#64748b',
                    cursor: insightsLoading ? 'not-allowed' : 'pointer', opacity: insightsLoading ? 0.5 : 1,
                  }}
                >
                  {insightsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {/* Row 1: Tokens + Cost */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                {/* Total Tokens card */}
                <div style={crd}>
                  <div style={crdLbl}>Total Tokens</div>
                  <div style={crdHero}>{fmtNum(claudeData.totals.totalTokens)}</div>
                  <div style={crdSub}>{claudeData.totalMessages} messages</div>
                  <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { label: 'Input', val: claudeData.totals.inputTokens },
                      { label: 'Output', val: claudeData.totals.outputTokens },
                      { label: 'Cache', val: claudeData.totals.cacheReadTokens + claudeData.totals.cacheCreateTokens },
                    ].map(item => {
                      const pct = claudeData.totals.totalTokens > 0 ? (item.val / claudeData.totals.totalTokens) * 100 : 0;
                      return (
                        <div key={item.label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                            <span style={{ color: '#374151', fontWeight: 500 }}>{item.label}</span>
                            <span style={{ color: '#64748b' }}>{fmtNum(item.val)} / {Math.round(pct)}%</span>
                          </div>
                          <div style={barTrack}>
                            <div style={{ ...barFill, width: `${Math.max(pct, 1)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Estimated Cost card */}
                <div style={crd}>
                  <div style={crdLbl}>Estimated Cost</div>
                  <div style={crdHero}>${claudeData.totals.estimatedCostUSD.toFixed(2)}</div>
                  <div style={crdSub}>{claudeData.totalSessions} sessions</div>
                  <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #e2e8f0' }}>
                      <span>Model</span>
                      <div style={{ display: 'flex', gap: 24 }}>
                        <span style={{ width: 50, textAlign: 'right' }}>Msgs</span>
                        <span style={{ width: 70, textAlign: 'right' }}>Cost</span>
                      </div>
                    </div>
                    {claudeData.byModel.map(m => (
                      <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                        <span style={{ color: '#374151' }}>{m.model.replace('claude-', '').replace(/-20\d{6}$/, '')}</span>
                        <div style={{ display: 'flex', gap: 24 }}>
                          <span style={{ width: 50, textAlign: 'right', color: '#64748b' }}>{m.messages}</span>
                          <span style={{ width: 70, textAlign: 'right', color: '#1e293b', fontWeight: 600 }}>${m.costUSD.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Daily Usage + Heaviest Prompts */}
              <div style={{ display: 'grid', gridTemplateColumns: claudeData.byDate.length > 0 && claudeData.heaviestPrompts.length > 0 ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
                {claudeData.byDate.length > 0 && (
                  <div style={crd}>
                    <div style={crdLbl}>Daily Usage</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {(() => {
                        const maxT = Math.max(...claudeData.byDate.map(d => d.inputTokens + d.outputTokens + d.cacheTokens), 1);
                        return claudeData.byDate.slice(-7).map(day => {
                          const t = day.inputTokens + day.outputTokens + day.cacheTokens;
                          const pct = (t / maxT) * 100;
                          return (
                            <div key={day.date}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                                <span style={{ color: '#374151', fontWeight: 500 }}>{day.date.slice(5)}</span>
                                <span style={{ color: '#64748b' }}>{fmtNum(t)} / ${day.costUSD.toFixed(2)}</span>
                              </div>
                              <div style={barTrack}>
                                <div style={{ ...barFill, width: `${Math.max(pct, 2)}%` }} />
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {claudeData.heaviestPrompts.length > 0 && actions?.heaviestWithSuggestions && (
                  <div style={crd}>
                    <div style={crdLbl}>Heaviest Prompts</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', fontWeight: 600, paddingBottom: 8, borderBottom: '1px solid #e2e8f0' }}>
                      <span>Prompt</span>
                      <span style={{ width: 60, textAlign: 'right' }}>Cost</span>
                    </div>
                    {actions.heaviestWithSuggestions.map((e, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 13 }}>
                          <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 12 }}>
                            {e.prompt.slice(0, 55)}{e.prompt.length > 55 ? '...' : ''}
                          </span>
                          <span style={{ color: '#1e293b', fontWeight: 600, flexShrink: 0 }}>${e.costUSD.toFixed(2)}</span>
                        </div>
                        {e.suggestion && (
                          <div
                            style={{
                              display: 'inline-block',
                              marginTop: 5,
                              padding: '2px 8px',
                              borderRadius: 10,
                              fontSize: 11,
                              fontWeight: 600,
                              color: e.suggestion.color,
                              background: e.suggestion.bg,
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => {
                              setExpandedAction(e.suggestion!.actionId);
                              setTimeout(() => {
                                document.getElementById('optimization-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }, 50);
                            }}
                          >
                            ↓ {e.suggestion.label}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Sessions table */}
              {claudeData.sessions.length > 0 && (
                <div style={{ ...crd, marginBottom: 16 }}>
                  <div style={crdLbl}>Sessions</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thSt}>Session</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Date</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Messages</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Tokens</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...claudeData.sessions].sort((a, b) => b.costUSD - a.costUSD).slice(0, 8).map(s => (
                          <tr key={s.sessionId}>
                            <td style={tdSt}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{s.sessionId.slice(0, 8)}</span></td>
                            <td style={{ ...tdSt, textAlign: 'right', color: '#374151' }}>{s.startTime ? s.startTime.slice(0, 10) : '\u2014'}</td>
                            <td style={{ ...tdSt, textAlign: 'right', color: '#64748b' }}>{s.messages}</td>
                            <td style={{ ...tdSt, textAlign: 'right', color: '#374151' }}>{fmtNum(s.totalTokens)}</td>
                            <td style={{ ...tdSt, textAlign: 'right', color: '#1e293b', fontWeight: 600 }}>${s.costUSD.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Optimization Actions ── */}
          {actions && actions.visibleActions.length > 0 && (
            <>
              <div id="optimization-actions" style={{ fontSize: 13, color: '#64748b', marginBottom: 20, marginTop: claudeData && claudeData.totalMessages > 0 ? 8 : 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Optimization Actions
              </div>

              {/* Savings summary */}
              {actions.totalPotentialSavings > 1 && (
                <div style={{ ...crd, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={crdLbl}>Total Potential Savings</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>If you applied all recommendations</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 32, fontWeight: 800, color: '#059669', lineHeight: 1 }}>
                        ~${actions.totalPotentialSavings.toFixed(0)}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        ~{actions.savingsPercent}% reduction
                      </div>
                    </div>
                  </div>
                  {actions.savingsBreakdown.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(actions.savingsBreakdown.length, 4)}, 1fr)`, gap: 12, marginTop: 20 }}>
                      {actions.savingsBreakdown.map(item => (
                        <div key={item.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{item.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>
                            ${item.amount < 1 ? item.amount.toFixed(2) : item.amount.toFixed(0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action: Auto-Optimize Prompts */}
              {actions.hasPromptOptimizations && !dismissedActions.includes('prompts') && (
                <div style={{ ...crd, marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpandedAction(expandedAction === 'prompts' ? null : 'prompts')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Auto-Optimize Heaviest Prompts</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: '#059669' }}>
                        {actions.optimizablePrompts.length} optimizable · Save ~${actions.promptOptimizationSavings.toFixed(2)}
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedAction === 'prompts' ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {expandedAction === 'prompts' && (
                    <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                      {actions.optimizablePrompts.map((entry, i) => (
                        <div key={i} style={{ padding: '12px 0', borderTop: i === 0 ? '1px solid #e2e8f0' : 'none', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>
                              {entry.model.replace('claude-', '').replace(/-20\d{6}$/, '')} &middot; ${entry.costUSD.toFixed(2)}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, color: '#059669' }}>-{entry.optimized.tokenReduction} tokens ({entry.optimized.reductionPercent}%)</span>
                              <button onClick={() => handleCopyAction(entry.optimized.optimizedPrompt, `prompt-${i}`)} style={btnClean}>
                                {copiedAction === `prompt-${i}` ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
                            {entry.prompt.length > 100 ? entry.prompt.slice(0, 97) + '...' : entry.prompt}
                          </div>
                          <div style={{ fontSize: 13, color: '#374151' }}>
                            &rarr; {entry.optimized.optimizedPrompt.length > 100
                              ? entry.optimized.optimizedPrompt.slice(0, 97) + '...'
                              : entry.optimized.optimizedPrompt}
                          </div>
                        </div>
                      ))}
                      <button onClick={() => handleDismissAction('prompts')} style={{ ...btnClean, marginTop: 12 }}>
                        Mark as Done
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Action: Model Savings */}
              {actions.hasModelSavings && !dismissedActions.includes('models') && (
                <div style={{ ...crd, marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpandedAction(expandedAction === 'models' ? null : 'models')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Model Savings Calculator</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: '#059669' }}>Save ~${actions.totalModelSavings.toFixed(0)} via {actions.cheapestLabel}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedAction === 'models' ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {expandedAction === 'models' && (
                    <div style={{ marginTop: 16, overflowX: 'auto' }} onClick={e => e.stopPropagation()}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={thSt}>Model</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Messages</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Actual</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>If {actions.cheapestLabel}</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Savings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {actions.modelSavings.map(m => (
                            <tr key={m.model}>
                              <td style={tdSt}>{m.displayName}</td>
                              <td style={{ ...tdSt, textAlign: 'right', color: '#64748b' }}>{m.messages}</td>
                              <td style={{ ...tdSt, textAlign: 'right' }}>${m.actualCost.toFixed(2)}</td>
                              <td style={{ ...tdSt, textAlign: 'right', color: '#059669' }}>${m.altCost.toFixed(2)}</td>
                              <td style={{ ...tdSt, textAlign: 'right', fontWeight: 600, color: m.savings > 0 ? '#059669' : '#94a3b8' }}>
                                {m.savings > 0 ? `$${m.savings.toFixed(2)}` : '\u2014'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {actions.totalModelSavings > 10 && claudeData && claudeData.totals.estimatedCostUSD > 0 && (
                        <div style={{ fontSize: 13, color: '#64748b', marginTop: 16, lineHeight: 1.5 }}>
                          {Math.round((actions.totalModelSavings / claudeData.totals.estimatedCostUSD) * 100)}% of your cost could be saved by using {actions.cheapestLabel} for simple tasks like confirmations and small edits.
                        </div>
                      )}
                      <button onClick={() => handleDismissAction('models')} style={{ ...btnClean, marginTop: 12 }}>
                        Mark as Done
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Action: Session Health */}
              {actions.hasSessionIssues && !dismissedActions.includes('sessions') && (
                <div id="action-sessions" style={{ ...crd, marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpandedAction(expandedAction === 'sessions' ? null : 'sessions')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Session Health</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        {actions.unhealthySessions.length} {actions.unhealthySessions.length === 1 ? 'session needs' : 'sessions need'} attention
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedAction === 'sessions' ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {expandedAction === 'sessions' && (
                    <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>

                      {/* What is a session? */}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 }}>
                        <span style={{ fontWeight: 600 }}>What is a session?</span> A session is a single Claude Code conversation — from when you open it to when you close or switch tasks. The longer a session runs, the more Claude has to carry in memory. Every reply reads your <em>entire</em> conversation history, so a 200-message session costs much more per reply than a 20-message one.
                      </div>

                      {/* Grade legend */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                        {[
                          { grade: 'A', label: 'Healthy', color: '#059669', bg: '#d1fae5', tip: 'Short, focused session' },
                          { grade: 'B', label: 'Monitor', color: '#64748b', bg: '#f1f5f9', tip: 'Getting long — keep an eye on it' },
                          { grade: 'C', label: 'Caution', color: '#d97706', bg: '#fef3c7', tip: 'Run /compact to trim history' },
                          { grade: 'D', label: 'Heavy', color: '#ea580c', bg: '#ffedd5', tip: 'Very long — costs rising fast' },
                          { grade: 'F', label: 'Critical', color: '#dc2626', bg: '#fee2e2', tip: 'Extremely bloated — start fresh' },
                        ].map(g => (
                          <div key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: g.bg, fontSize: 11 }}>
                            <span style={{ fontWeight: 800, color: g.color }}>{g.grade}</span>
                            <span style={{ color: g.color, fontWeight: 600 }}>{g.label}</span>
                            <span style={{ color: '#94a3b8' }}>·</span>
                            <span style={{ color: '#64748b' }}>{g.tip}</span>
                          </div>
                        ))}
                      </div>

                      {/* Worst session callout */}
                      {actions.worstSession && (actions.worstSession.grade === 'D' || actions.worstSession.grade === 'F') && (
                        <div style={{ fontSize: 13, color: '#7c2d12', marginBottom: 16, padding: '12px 14px', background: '#fff7ed', borderRadius: 8, lineHeight: 1.5, border: '1px solid #fed7aa' }}>
                          <span style={{ fontWeight: 600 }}>Worst session:</span> ${actions.worstSession.costUSD.toFixed(2)} across {actions.worstSession.messages} messages.
                          {actions.worstSession.compactSavings > 0 && ` Running /compact earlier could have saved ~$${actions.worstSession.compactSavings.toFixed(0)}.`}
                        </div>
                      )}

                      {/* Session rows */}
                      {[...actions.sessionHealth]
                        .sort((a, b) => b.costUSD - a.costUSD)
                        .slice(0, 8)
                        .map((s, i) => {
                          const gc: Record<string, string> = { A: '#059669', B: '#64748b', C: '#d97706', D: '#ea580c', F: '#dc2626' };
                          const gb: Record<string, string> = { A: '#d1fae5', B: '#f1f5f9', C: '#fef3c7', D: '#ffedd5', F: '#fee2e2' };
                          return (
                            <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{
                                    fontSize: 13, fontWeight: 800, color: gc[s.grade] || '#94a3b8',
                                    background: gb[s.grade] || '#f1f5f9',
                                    width: 26, height: 26, borderRadius: 6,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                  }}>{s.grade}</span>
                                  <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{s.sessionId.slice(0, 8)}</span>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 600 }}>${s.costUSD.toFixed(2)}</span>
                                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 6 }}>{s.messages} msgs</span>
                                </div>
                              </div>
                              {s.friendlyIssue && s.grade !== 'A' && (
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 5, lineHeight: 1.5, paddingLeft: 36 }}>
                                  {s.friendlyIssue}
                                </div>
                              )}
                            </div>
                          );
                        })}

                      {/* /compact explainer */}
                      {actions.totalSessionSavings > 0 && (
                        <div style={{ marginTop: 16, padding: '12px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 4 }}>What is /compact?</div>
                          <div style={{ fontSize: 12, color: '#15803d', lineHeight: 1.6 }}>
                            Type <code style={{ background: '#dcfce7', padding: '1px 5px', borderRadius: 4 }}>/compact</code> in Claude Code to compress your conversation history into a short summary. Claude forgets the raw back-and-forth but keeps the key decisions — so it stays smart without carrying all the weight. Estimated saving: ~${actions.totalSessionSavings.toFixed(0)}.
                          </div>
                        </div>
                      )}

                      <button onClick={() => handleDismissAction('sessions')} style={{ ...btnClean, marginTop: 14 }}>
                        Mark as Done
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Action: Semantic Cache Savings */}
              {actions.hasCacheOpportunity && claudeData.cacheAnalysis && !dismissedActions.includes('cache') && (
                <div style={{ ...crd, marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpandedAction(expandedAction === 'cache' ? null : 'cache')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Semantic Cache Savings</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600 }}>
                        {claudeData.cacheAnalysis.estimatedCacheHitRate.toFixed(0)}% hit rate
                      </span>
                      <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
                        Save ${actions.cacheSavings.toFixed(2)}
                      </span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedAction === 'cache' ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>
                  {expandedAction === 'cache' && (
                    <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                      {/* Stats grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                        {[
                          { label: 'Cacheable Prompts', value: `${claudeData.cacheAnalysis.cacheablePrompts} / ${claudeData.cacheAnalysis.totalPrompts}` },
                          { label: 'Cache Hit Rate', value: `${claudeData.cacheAnalysis.estimatedCacheHitRate.toFixed(1)}%` },
                          { label: 'Token Savings', value: claudeData.cacheAnalysis.estimatedMonthlyTokenSavings.toLocaleString('en-US') },
                        ].map(s => (
                          <div key={s.label} style={{ background: '#f8fafc', borderRadius: 8, padding: 12, border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{s.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{s.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Top repeated patterns */}
                      {claudeData.cacheAnalysis.topPatterns.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Top Repeated Patterns
                          </div>
                          {claudeData.cacheAnalysis.topPatterns.map((p, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                              <div style={{ fontSize: 13, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 12 }}>
                                {p.pattern}
                              </div>
                              <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                                <span style={{ fontSize: 12, color: '#64748b' }}>{p.count}x</span>
                                <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>${p.savings.toFixed(2)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Cluster details */}
                      {claudeData.cacheAnalysis.clusters.slice(0, 5).map(cluster => (
                        <div key={cluster.id} style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 8, border: '1px solid #e2e8f0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                              Cluster #{cluster.id}
                            </span>
                            <div style={{ display: 'flex', gap: 12 }}>
                              <span style={{ fontSize: 12, color: '#64748b' }}>{cluster.promptCount} prompts</span>
                              <span style={{ fontSize: 12, color: '#3b82f6' }}>{(cluster.avgSimilarity * 100).toFixed(0)}% similar</span>
                              <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>${cluster.cacheableCost.toFixed(2)} savings</span>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cluster.representative}
                          </div>
                        </div>
                      ))}

                      {/* Setup guides */}
                      {claudeData.cacheAnalysis.setupGuides.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Setup Guides
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                            {claudeData.cacheAnalysis.setupGuides.map(guide => {
                              const diffColor: Record<string, { bg: string; fg: string }> = {
                                easy: { bg: '#d1fae5', fg: '#059669' },
                                medium: { bg: '#fef3c7', fg: '#d97706' },
                                advanced: { bg: '#fee2e2', fg: '#dc2626' },
                              };
                              const dc = diffColor[guide.difficulty] || diffColor.easy;
                              return (
                                <div key={guide.id} style={{ background: '#ffffff', borderRadius: 8, padding: 12, border: '1px solid #e2e8f0' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{guide.name}</span>
                                    <span style={{ fontSize: 10, fontWeight: 600, color: dc.fg, background: dc.bg, padding: '2px 6px', borderRadius: 4 }}>
                                      {guide.difficulty}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 8 }}>
                                    {guide.description}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                    Setup: {guide.estimatedSetupTime}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <button onClick={() => handleDismissAction('cache')} style={{ ...btnClean, marginTop: 12 }}>
                        Mark as Done
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Action: Generate CLAUDE.md */}
              {!dismissedActions.includes('claudemd') && (
              <div style={{ ...crd, marginBottom: 12, cursor: 'pointer' }} onClick={() => setExpandedAction(expandedAction === 'claudemd' ? null : 'claudemd')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Generate CLAUDE.md</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Reduce repeated context</span>
                    <span style={{ color: '#94a3b8', fontSize: 11 }}>{expandedAction === 'claudemd' ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>
                {expandedAction === 'claudemd' && (
                  <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
                      A CLAUDE.md file gives Claude Code persistent project context. Keep it lean as a pointer file — link to detailed docs for deep context, use state journaling before /compact, and offload heavy tasks to subagents.
                    </div>
                    {/* Model setup instruction — action the user takes, not CLAUDE.md content */}
                    <div style={{
                      background: (claudePlan === 'max' || claudePlan === 'enterprise') ? '#eff6ff' : '#fefce8',
                      border: `1px solid ${(claudePlan === 'max' || claudePlan === 'enterprise') ? '#bfdbfe' : '#fde68a'}`,
                      borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, lineHeight: 1.6,
                      color: (claudePlan === 'max' || claudePlan === 'enterprise') ? '#1e40af' : '#92400e',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ fontWeight: 600 }}>Setup: Model Routing</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {(['pro', 'max', 'team', 'enterprise'] as ClaudePlan[]).map(p => (
                            <button
                              key={p}
                              onClick={() => handlePlanChange(p)}
                              style={{
                                fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px',
                                padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                                border: claudePlan === p ? 'none' : '1px solid #e2e8f0',
                                background: claudePlan === p
                                  ? ((p === 'max' || p === 'enterprise') ? '#dbeafe' : '#fef3c7')
                                  : '#f8fafc',
                                color: claudePlan === p
                                  ? ((p === 'max' || p === 'enterprise') ? '#1d4ed8' : '#b45309')
                                  : '#94a3b8',
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                      {actions.modelSetupTip}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      CLAUDE.md content — behavioral rules Claude can follow
                    </div>
                    <pre style={{
                      background: '#f8fafc', borderRadius: 8, padding: 16,
                      fontSize: 12, lineHeight: 1.6, color: '#374151',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 240, overflow: 'auto',
                      border: '1px solid #e2e8f0',
                    }}>
                      {actions.claudeMdContent}
                    </pre>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button onClick={() => handleCopyAction(actions.claudeMdContent, 'claudemd')} style={btnClean}>
                        {copiedAction === 'claudemd' ? 'Copied' : 'Copy to Clipboard'}
                      </button>
                      <button
                        onClick={handleSaveClaudeMd}
                        style={{ ...btnClean, background: claudeMdSaved ? '#d1fae5' : '#059669', color: claudeMdSaved ? '#059669' : '#ffffff', borderColor: claudeMdSaved ? '#6ee7b7' : '#059669' }}
                      >
                        {claudeMdSaved ? 'Saved!' : 'Save to Project Root'}
                      </button>
                      <button onClick={() => handleDismissAction('claudemd')} style={btnClean}>
                        Mark as Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Restore dismissed cards */}
              {dismissedActions.length > 0 && (
                <button
                  onClick={() => { setDismissedActions([]); saveDismissedActions([]); }}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', marginTop: 8, marginBottom: 8 }}
                >
                  Restore {dismissedActions.length} dismissed card{dismissedActions.length > 1 ? 's' : ''}
                </button>
              )}
            </>
          )}

          {/* ── PromptFuel Optimizations ── */}
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20, marginTop: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            PromptFuel Optimizations
          </div>

          {history.length > 0 ? (
            <>
              {/* Stats row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                {[
                  { label: 'Optimizations', val: insights.totalOptimizations.toString(), color: '#1e293b' },
                  { label: 'Tokens Saved', val: fmtNum(insights.totalTokensSaved), color: '#059669' },
                  { label: 'Cost Saved', val: formatCost(insights.totalCostSaved), color: '#1e293b' },
                  { label: 'Avg Reduction', val: `${insights.avgReduction}%`, color: '#1e293b' },
                ].map(item => (
                  <div key={item.label} style={crd}>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{item.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 4 }}>{item.val}</div>
                  </div>
                ))}
              </div>

              {/* Rules + Savings in 2-col */}
              <div style={{ display: 'grid', gridTemplateColumns: insights.ruleBreakdown.length > 0 && insights.byDate.length > 0 ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
                {insights.ruleBreakdown.length > 0 && (
                  <div style={crd}>
                    <div style={crdLbl}>Top Rules Triggered</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {insights.ruleBreakdown.slice(0, 6).map(([rule, count]) => {
                        const pct = (count / insights.maxRuleCount) * 100;
                        return (
                          <div key={rule}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                              <span style={{ color: '#374151', fontWeight: 500 }}>{rule}</span>
                              <span style={{ color: '#64748b' }}>{count} hits</span>
                            </div>
                            <div style={barTrack}>
                              <div style={{ ...barFill, width: `${Math.max(pct, 2)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {insights.byDate.length > 0 && (
                  <div style={crd}>
                    <div style={crdLbl}>Savings Over Time</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {insights.byDate.slice(0, 7).map(([date, tokens]) => {
                        const pct = (tokens / insights.maxDayTokens) * 100;
                        return (
                          <div key={date}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                              <span style={{ color: '#374151', fontWeight: 500 }}>{date}</span>
                              <span style={{ color: '#059669' }}>{tokens.toLocaleString('en-US')} saved</span>
                            </div>
                            <div style={barTrack}>
                              <div style={{ ...barFill, background: '#059669', width: `${Math.max(pct, 2)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ ...crd, textAlign: 'center', padding: '40px 24px', marginBottom: 16 }}>
              <div style={{ fontSize: 15, color: '#64748b', marginBottom: 4 }}>No optimization data yet</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>Apply optimizations in the Analyze tab to track savings</div>
            </div>
          )}

          {/* ── Tips ── */}
          {insights.claudeCodeTips.length > 0 && (
            <>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, marginTop: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Tips
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {insights.claudeCodeTips.slice(0, 4).map((tip, i) => (
                  <div key={i} style={{ ...crd, padding: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>{tip.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{tip.description}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {insights.tips.length > 0 && (
            <div style={{ ...crd, marginBottom: 16 }}>
              <div style={crdLbl}>Your Patterns</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.tips.map((tip, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, padding: '8px 0', borderBottom: i < insights.tips.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 40, color: '#94a3b8', fontSize: 12 }}>
        PromptFuel — Open source token optimizer & cost analyzer
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: '#ffffff', borderRadius: 8, padding: 16,
      border: highlight ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
      boxShadow: highlight ? '0 1px 3px rgba(59,130,246,0.08)' : '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: highlight ? '#3b82f6' : '#1e293b' }}>
        {value}
      </div>
    </div>
  );
}

function ruleColor(rule: string): string {
  const colors: Record<string, string> = {
    filler: '#d97706',
    redundancy: '#ea580c',
    'duplicate-instruction': '#dc2626',
    formatting: '#7c3aed',
    'negative-instruction': '#db2777',
    'weak-hedging': '#0891b2',
    'missing-format': '#64748b',
    'rewrite-compression': '#059669',
    'rewrite-voice': '#4f46e5',
    'rewrite-question': '#d97706',
    'rewrite-verbose-phrase': '#d97706',
    'rewrite-structure': '#7c3aed',
  };
  return colors[rule] ?? '#3b82f6';
}

const sectionStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 8,
  padding: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const sectionHeader: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#1e293b',
  marginBottom: 12,
};

const btnStyle: React.CSSProperties = {
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};

const tabBtnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '6px 6px 0 0',
  padding: '10px 20px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
  transition: 'all 0.15s',
};

// ── Clean card styles (Insights tab) ──

const crd: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const crdLbl: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: '#64748b',
  marginBottom: 8,
};

const crdHero: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  color: '#1e293b',
  lineHeight: 1,
};

const crdSub: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  marginTop: 6,
};

const barTrack: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: '#e2e8f0',
};

const barFill: React.CSSProperties = {
  height: '100%',
  borderRadius: 3,
  background: '#94a3b8',
  transition: 'width 0.3s',
};

const thSt: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  padding: '0 12px 10px',
  borderBottom: '1px solid #e2e8f0',
  textAlign: 'left',
};

const tdSt: React.CSSProperties = {
  fontSize: 13,
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  color: '#374151',
};

const btnClean: React.CSSProperties = {
  background: '#f1f5f9',
  color: '#1e293b',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}
