import React, { useState, useRef, useCallback } from 'react';
import {
  countTokens,
  calculateCost,
  formatCost,
  optimize,
  type OptimizeOutput,
} from '@promptfuel/core';

const MODEL = 'gpt-4o';

const INTENT_COLORS: Record<string, string> = {
  debug: '#ef4444',
  'code-gen': '#3b82f6',
  refactor: '#8b5cf6',
  explain: '#06b6d4',
  creative: '#f59e0b',
  general: '#64748b',
};

export function LiveDemo() {
  const [prompt, setPrompt] = useState('');
  const [tokens, setTokens] = useState(0);
  const [cost, setCost] = useState('');
  const [result, setResult] = useState<OptimizeOutput | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [targetTokens, setTargetTokens] = useState<number | undefined>(undefined);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleInput = useCallback((text: string) => {
    setPrompt(text);
    setResult(null);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!text.trim()) {
        setTokens(0);
        setCost('');
        return;
      }
      const t = countTokens(text, MODEL);
      const c = calculateCost(t.inputTokens, t.estimatedOutputTokens, MODEL);
      setTokens(t.inputTokens);
      setCost(formatCost(c.totalCost));
    }, 150);
  }, []);

  const handleOptimize = () => {
    if (!prompt.trim()) return;
    setOptimizing(true);
    setTimeout(() => {
      const res = optimize(prompt, MODEL, targetTokens ? { targetTokens } : undefined);
      setResult(res);
      setOptimizing(false);
    }, 300);
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>Try it — paste a prompt</span>
          {tokens > 0 && (
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {tokens.toLocaleString()} tokens &middot; {cost}
            </span>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="e.g. Please provide me with a detailed and comprehensive explanation of how the process of photosynthesis works in plants..."
          rows={4}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleOptimize}
            disabled={!prompt.trim() || optimizing}
            style={{
              ...btnPrimaryStyle,
              opacity: !prompt.trim() || optimizing ? 0.5 : 1,
              cursor: !prompt.trim() || optimizing ? 'default' : 'pointer',
            }}
          >
            {optimizing ? 'Optimizing...' : 'Optimize'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#6b7280' }}>Budget:</label>
            <input
              type="number"
              min={1}
              placeholder="tokens"
              value={targetTokens ?? ''}
              onChange={(e) => {
                const num = e.target.value ? parseInt(e.target.value, 10) : undefined;
                setTargetTokens(num && num > 0 ? num : undefined);
              }}
              style={{
                background: '#f8fafc', color: '#1a1a2e', border: '1px solid #e5e7eb',
                borderRadius: 6, padding: '6px 8px', fontSize: 12, width: 80,
              }}
            />
          </div>
        </div>
      </div>

      {result && (result.suggestions.length > 0 || result.tokenReduction > 0) && (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          {/* Intent + Budget badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {result.intent && result.intent.type !== 'general' && (
              <>
                <span style={{
                  background: INTENT_COLORS[result.intent.type] || '#64748b',
                  color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                }}>
                  {result.intent.type}
                </span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>
                  {Math.round(result.intent.confidence * 100)}% confidence
                </span>
              </>
            )}
            {result.budget && (
              <span style={{
                background: result.budget.targetMet ? '#22c55e' : '#f59e0b',
                color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
              }}>
                L{result.budget.levelApplied} {result.budget.targetMet ? 'target met' : `${result.budget.remainingGap} over`}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {/* Before */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#ef4444', marginBottom: 6 }}>
                Before — {result.originalTokens} tokens
              </div>
              <div style={{ ...resultBoxStyle, borderColor: '#fecaca' }}>
                {prompt}
              </div>
            </div>
            {/* After */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#16a34a', marginBottom: 6 }}>
                After — {result.optimizedTokens} tokens
              </div>
              <div style={{ ...resultBoxStyle, borderColor: '#bbf7d0' }}>
                {result.optimizedPrompt}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <span style={{
              display: 'inline-block', background: '#f0fdf4', color: '#16a34a',
              padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
            }}>
              {result.reductionPercent}% fewer tokens &middot; {result.tokenReduction} tokens saved
            </span>
          </div>
        </div>
      )}

      {result && result.suggestions.length === 0 && result.tokenReduction <= 0 && (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16, textAlign: 'center', color: '#16a34a', fontSize: 14 }}>
          Your prompt is already well-optimized!
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  maxWidth: 720,
  margin: '0 auto',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: '#f8fafc',
  color: '#1a1a2e',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 14,
  fontSize: 14,
  lineHeight: 1.6,
  resize: 'vertical',
  fontFamily: "'Inter', sans-serif",
  marginBottom: 10,
};

const btnPrimaryStyle: React.CSSProperties = {
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "'Inter', sans-serif",
};

const resultBoxStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid',
  borderRadius: 8,
  padding: 12,
  fontSize: 13,
  lineHeight: 1.6,
  color: '#374151',
  minHeight: 80,
};
