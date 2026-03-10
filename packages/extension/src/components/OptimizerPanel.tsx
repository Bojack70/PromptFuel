import React from 'react';
import type { OptimizeOutput } from '@promptfuel/core';

interface OptimizerPanelProps {
  result: OptimizeOutput | null;
  onOptimize: () => void;
}

export function OptimizerPanel({ result, onOptimize }: OptimizerPanelProps) {
  return (
    <div className="pf-optimizer-panel">
      <button className="pf-opt-btn" onClick={onOptimize}>
        Optimize Prompt
      </button>
      {result && (
        <div className="pf-opt-result">
          <div className="pf-opt-savings">
            Savings: {result.tokenReduction} tokens ({result.reductionPercent}%)
          </div>
          {result.suggestions.slice(0, 5).map((s, i) => (
            <div key={i} className="pf-opt-suggestion">
              <span className="pf-opt-rule">[{s.rule}]</span> {s.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
