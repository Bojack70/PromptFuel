import React from 'react';
import type { WarningLevel } from '@promptfuel/core';

interface ContextMeterProps {
  percentUsed: number;
  remainingTokens: number;
  warning: WarningLevel;
}

const WARNING_COLORS: Record<WarningLevel, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
};

export function ContextMeter({ percentUsed, remainingTokens, warning }: ContextMeterProps) {
  const color = WARNING_COLORS[warning];

  return (
    <div className="pf-context-meter">
      <div className="pf-cm-title">Context Window</div>
      <div className="pf-cm-bar-container">
        <div
          className="pf-cm-bar"
          style={{ width: `${Math.min(percentUsed, 100)}%`, backgroundColor: color }}
        />
      </div>
      <div className="pf-cm-label">
        {percentUsed}% used — {remainingTokens.toLocaleString()} tokens remaining
      </div>
    </div>
  );
}
