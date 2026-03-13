import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatCost } from '@promptfuel/core';

interface Settings {
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
  weekOverWeekChange: number;
  avgTokensPerPrompt: number;
  totalPromptsAllTime: number;
}

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'claude-opus-4-6', label: 'Claude Opus' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku' },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

const sectionStyle = {
  background: '#1e293b',
  borderRadius: '8px',
  padding: '12px',
  marginBottom: '12px',
};

const labelStyle = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  color: '#94a3b8',
  letterSpacing: '0.5px',
  marginBottom: '8px',
};

const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '4px',
};

function Popup() {
  const [settings, setSettings] = useState<Settings>({
    model: 'gpt-4o', autoAnalyze: true, sessionTokens: 0, sessionCost: 0,
  });
  const [trends, setTrends] = useState<TrendStats | null>(null);

  useEffect(() => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (result) => {
        if (chrome.runtime.lastError) return;
        if (result) setSettings(result);
      });
      chrome.runtime.sendMessage({ type: 'GET_TRENDS' }, (result) => {
        if (chrome.runtime.lastError) return;
        if (result) setTrends(result);
      });
    } catch { /* service worker may be inactive */ }
  }, []);

  const handleModelChange = (model: string) => {
    try {
      chrome.runtime.sendMessage({ type: 'SET_MODEL', model }, (result) => {
        if (chrome.runtime.lastError) return;
        if (result) setSettings(result);
      });
    } catch {}
  };

  const handleResetSession = () => {
    try {
      chrome.runtime.sendMessage({ type: 'RESET_SESSION' }, (result) => {
        if (chrome.runtime.lastError) return;
        if (result) setSettings(result);
      });
    } catch {}
  };

  const trendArrow = trends && trends.weekOverWeekChange !== 0
    ? trends.weekOverWeekChange < 0 ? '↓' : '↑'
    : '→';
  const trendColor = trends && trends.weekOverWeekChange < 0 ? '#22c55e' : trends && trends.weekOverWeekChange > 0 ? '#ef4444' : '#94a3b8';

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>PromptFuel</span>
        <span style={{ fontSize: '11px', color: '#64748b', background: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>v1.0</span>
      </div>

      {/* Session Stats */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Current Session</div>
        <div style={rowStyle}>
          <span>Tokens:</span>
          <span style={{ fontWeight: 600 }}>{settings.sessionTokens.toLocaleString()}</span>
        </div>
        <div style={rowStyle}>
          <span>Cost:</span>
          <span style={{ fontWeight: 600, color: '#38bdf8' }}>{formatCost(settings.sessionCost)}</span>
        </div>
      </div>

      {/* Cost Trends */}
      {trends && (
        <div style={sectionStyle}>
          <div style={labelStyle}>Spending Trends</div>
          <div style={rowStyle}>
            <span>Today:</span>
            <span style={{ fontWeight: 600 }}>{formatCost(trends.totalCostToday)} ({trends.totalPromptsToday} prompts)</span>
          </div>
          <div style={rowStyle}>
            <span>This week:</span>
            <span style={{ fontWeight: 600 }}>{formatCost(trends.totalCostThisWeek)}</span>
          </div>
          <div style={{ ...rowStyle, marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #334155' }}>
            <span>Week trend:</span>
            <span style={{ fontWeight: 700, color: trendColor }}>
              {trendArrow} {Math.abs(trends.weekOverWeekChange)}% vs last week
            </span>
          </div>
          <div style={rowStyle}>
            <span>Avg tokens/prompt:</span>
            <span>{trends.avgTokensPerPrompt.toLocaleString()}</span>
          </div>
          <div style={{ ...rowStyle, color: '#64748b', fontSize: '11px' }}>
            <span>Total prompts tracked:</span>
            <span>{trends.totalPromptsAllTime}</span>
          </div>
        </div>
      )}

      {/* Settings */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Settings</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8' }}>Model:</label>
          <select
            value={settings.model}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              flex: 1, background: '#0f172a', color: '#e2e8f0',
              border: '1px solid #334155', borderRadius: '6px',
              padding: '4px 8px', fontSize: '12px',
            }}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleResetSession}
          style={{
            flex: 1, background: '#334155', color: '#e2e8f0',
            border: 'none', borderRadius: '6px', padding: '8px',
            cursor: 'pointer', fontSize: '12px',
          }}
        >
          Reset Session
        </button>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Popup />);
