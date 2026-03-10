import React, { useState } from 'react';

interface TokenWidgetProps {
  inputTokens: number;
  estimatedOutputTokens: number;
  totalCost: string;
  onExpand: () => void;
  expanded: boolean;
}

export function TokenWidget({ inputTokens, estimatedOutputTokens, totalCost, onExpand, expanded }: TokenWidgetProps) {
  return (
    <div className="pf-token-widget" onClick={onExpand}>
      <span className="pf-tw-tokens">{inputTokens.toLocaleString()} tokens</span>
      <span className="pf-tw-sep">|</span>
      <span className="pf-tw-cost">{totalCost}</span>
      <span className="pf-tw-arrow">{expanded ? '▲' : '▼'}</span>
    </div>
  );
}
