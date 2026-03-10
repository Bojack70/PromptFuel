import React from 'react';

interface CostBadgeProps {
  inputCost: string;
  outputCost: string;
  totalCost: string;
}

export function CostBadge({ inputCost, outputCost, totalCost }: CostBadgeProps) {
  return (
    <div className="pf-cost-badge">
      <div className="pf-cb-title">Cost Estimate</div>
      <div className="pf-cb-row">
        <span>Input:</span>
        <span>{inputCost}</span>
      </div>
      <div className="pf-cb-row">
        <span>Output:</span>
        <span>{outputCost}</span>
      </div>
      <div className="pf-cb-row pf-cb-total">
        <span>Total:</span>
        <span>{totalCost}</span>
      </div>
    </div>
  );
}
