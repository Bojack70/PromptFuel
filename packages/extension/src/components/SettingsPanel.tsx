import React from 'react';

interface SettingsPanelProps {
  model: string;
  autoAnalyze: boolean;
  onModelChange: (model: string) => void;
  onAutoAnalyzeChange: (enabled: boolean) => void;
}

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'claude-opus-4-6', label: 'Claude Opus' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku' },
];

export function SettingsPanel({ model, autoAnalyze, onModelChange, onAutoAnalyzeChange }: SettingsPanelProps) {
  return (
    <div className="pf-settings-panel">
      <div className="pf-sp-row">
        <label className="pf-sp-label">Model:</label>
        <select
          className="pf-sp-select"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
      <div className="pf-sp-row">
        <label className="pf-sp-label">Auto-analyze:</label>
        <input
          type="checkbox"
          checked={autoAnalyze}
          onChange={(e) => onAutoAnalyzeChange(e.target.checked)}
        />
      </div>
    </div>
  );
}
