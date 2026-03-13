import { countTokens, calculateCost, formatCost, optimize, monitorContext } from '@promptfuel/core';
import type { PlatformAdapter } from './platforms/types.js';
import { chatgptAdapter } from './platforms/chatgpt.js';
import { claudeAdapter } from './platforms/claude.js';
import { geminiAdapter } from './platforms/gemini.js';
import { DOMObserver } from './observer.js';

let currentModel = 'gpt-4o';
let widgetContainer: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let lastPageDetectedModel: string | null = null; // last model read from the page
let userOverrodeModel = false; // true when user manually picked from widget dropdown

function detectPlatform(): PlatformAdapter | null {
  const host = window.location.hostname;
  if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) {
    return chatgptAdapter;
  }
  if (host.includes('claude.ai')) {
    currentModel = 'claude-sonnet-4-6';
    return claudeAdapter;
  }
  if (host.includes('gemini.google.com')) {
    currentModel = 'gemini-2.5-pro';
    return geminiAdapter;
  }
  return null;
}

function createWidget(): void {
  if (widgetContainer) return;

  widgetContainer = document.createElement('div');
  widgetContainer.id = 'promptfuel-widget-host';
  shadowRoot = widgetContainer.attachShadow({ mode: 'open' });

  // Inject styles into shadow DOM
  const style = document.createElement('style');
  style.textContent = getWidgetStyles();
  shadowRoot.appendChild(style);

  // Create widget UI using DOM API (no innerHTML — prevents XSS risk)
  const widget = document.createElement('div');
  widget.id = 'pf-widget';

  // Badge
  const badge = document.createElement('div');
  badge.className = 'pf-badge';
  badge.id = 'pf-badge';

  const tokenCount = document.createElement('span');
  tokenCount.id = 'pf-token-count';
  tokenCount.textContent = '0 tokens';

  const sep = document.createElement('span');
  sep.className = 'pf-separator';
  sep.textContent = '|';

  const costSpan = document.createElement('span');
  costSpan.id = 'pf-cost';
  costSpan.textContent = '$0.00';

  const expandBtn = document.createElement('span');
  expandBtn.className = 'pf-expand-btn';
  expandBtn.id = 'pf-expand';
  expandBtn.textContent = '\u25BC';

  badge.append(tokenCount, sep, costSpan, expandBtn);

  // Panel
  const panel = document.createElement('div');
  panel.className = 'pf-panel';
  panel.id = 'pf-panel';
  panel.style.display = 'none';

  // Helper to build a panel section
  function makeSection(...children: Node[]): HTMLDivElement {
    const sec = document.createElement('div');
    sec.className = 'pf-panel-section';
    sec.append(...children);
    return sec;
  }
  function makeTitle(text: string): HTMLDivElement {
    const t = document.createElement('div');
    t.className = 'pf-panel-title';
    t.textContent = text;
    return t;
  }
  function makeRow(label: string, valueId: string, valueText: string, extraClass?: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'pf-row' + (extraClass ? ' ' + extraClass : '');
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.id = valueId;
    v.textContent = valueText;
    row.append(l, v);
    return row;
  }

  // Token Breakdown section
  panel.appendChild(makeSection(
    makeTitle('Token Breakdown'),
    makeRow('Input:', 'pf-input-tokens', '0'),
    makeRow('Est. Output:', 'pf-output-tokens', '~0'),
  ));

  // Cost Estimate section
  panel.appendChild(makeSection(
    makeTitle('Cost Estimate'),
    makeRow('Input:', 'pf-input-cost', '$0.00'),
    makeRow('Output:', 'pf-output-cost', '$0.00'),
    makeRow('Total:', 'pf-total-cost', '$0.00', 'pf-total'),
  ));

  // Context Window section
  const ctxBarContainer = document.createElement('div');
  ctxBarContainer.className = 'pf-context-bar-container';
  const ctxBar = document.createElement('div');
  ctxBar.className = 'pf-context-bar';
  ctxBar.id = 'pf-context-bar';
  ctxBarContainer.appendChild(ctxBar);
  const ctxRow = document.createElement('div');
  ctxRow.className = 'pf-row';
  const ctxLabel = document.createElement('span');
  ctxLabel.id = 'pf-context-label';
  ctxLabel.textContent = '0% used';
  const ctxRemaining = document.createElement('span');
  ctxRemaining.id = 'pf-context-remaining';
  ctxRow.append(ctxLabel, ctxRemaining);
  panel.appendChild(makeSection(makeTitle('Context Window'), ctxBarContainer, ctxRow));

  // Optimize section
  const optBtn = document.createElement('button');
  optBtn.className = 'pf-btn';
  optBtn.id = 'pf-optimize-btn';
  optBtn.textContent = 'Optimize Prompt';

  const optResult = document.createElement('div');
  optResult.id = 'pf-optimize-result';
  optResult.style.display = 'none';
  optResult.append(
    makeTitle('Savings'),
    makeRow('Tokens saved:', 'pf-tokens-saved', '0'),
    makeRow('Reduction:', 'pf-reduction', '0%'),
  );
  const suggestionsDiv = document.createElement('div');
  suggestionsDiv.id = 'pf-suggestions';
  optResult.appendChild(suggestionsDiv);

  const compareBtn = document.createElement('button');
  compareBtn.className = 'pf-btn pf-btn-secondary';
  compareBtn.id = 'pf-compare-btn';
  compareBtn.style.marginTop = '8px';
  compareBtn.textContent = 'Side-by-Side Compare';
  optResult.appendChild(compareBtn);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'pf-btn pf-btn-apply';
  applyBtn.id = 'pf-apply-btn';
  applyBtn.style.marginTop = '4px';
  applyBtn.textContent = 'Apply Optimized';
  optResult.appendChild(applyBtn);

  panel.appendChild(makeSection(optBtn, optResult));

  // Compare panel
  const comparePanel = document.createElement('div');
  comparePanel.id = 'pf-compare-panel';
  comparePanel.style.display = 'none';
  comparePanel.className = 'pf-panel-section';

  const compareGrid = document.createElement('div');
  compareGrid.className = 'pf-compare-grid';

  function makeCompareCol(headerClass: string, headerText: string, textId: string): HTMLDivElement {
    const col = document.createElement('div');
    col.className = 'pf-compare-col';
    const hdr = document.createElement('div');
    hdr.className = 'pf-compare-header ' + headerClass;
    hdr.textContent = headerText;
    const txt = document.createElement('div');
    txt.className = 'pf-compare-text';
    txt.id = textId;
    col.append(hdr, txt);
    return col;
  }
  compareGrid.append(
    makeCompareCol('pf-original-header', 'Original', 'pf-original-text'),
    makeCompareCol('pf-optimized-header', 'Optimized', 'pf-optimized-text'),
  );
  comparePanel.appendChild(makeTitle('Side-by-Side Comparison'));
  comparePanel.appendChild(compareGrid);

  const statsRow = document.createElement('div');
  statsRow.className = 'pf-row pf-compare-stats';
  statsRow.style.marginTop = '6px';
  const beforeSpan = document.createElement('span');
  beforeSpan.id = 'pf-compare-before';
  const arrowSpan = document.createElement('span');
  arrowSpan.id = 'pf-compare-arrow';
  arrowSpan.textContent = '\u2192';
  const afterSpan = document.createElement('span');
  afterSpan.id = 'pf-compare-after';
  statsRow.append(beforeSpan, arrowSpan, afterSpan);
  comparePanel.appendChild(statsRow);
  panel.appendChild(comparePanel);

  // Model select section
  const settingsSection = document.createElement('div');
  settingsSection.className = 'pf-panel-section pf-settings';
  const modelLabel = document.createElement('label');
  modelLabel.className = 'pf-label';
  modelLabel.textContent = 'Model:';
  const modelSelect = document.createElement('select');
  modelSelect.id = 'pf-model-select';
  modelSelect.className = 'pf-select';
  const models = [
    ['gpt-4o', 'GPT-4o'], ['gpt-4o-mini', 'GPT-4o Mini'],
    ['gpt-4-turbo', 'GPT-4 Turbo'], ['gpt-3.5-turbo', 'GPT-3.5 Turbo'],
    ['claude-opus-4-6', 'Claude Opus'], ['claude-sonnet-4-6', 'Claude Sonnet'],
    ['claude-haiku-4-5', 'Claude Haiku'],
    ['gemini-3.1-pro', 'Gemini 3.1 Pro'], ['gemini-3-flash', 'Gemini 3 Flash'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'], ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
    ['gemini-2.0-flash', 'Gemini 2.0 Flash'], ['gemini-2.0-flash-lite', 'Gemini 2.0 Flash Lite'],
    ['gemini-1.5-pro', 'Gemini 1.5 Pro'], ['gemini-1.5-flash', 'Gemini 1.5 Flash'],
  ];
  for (const [val, lbl] of models) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = lbl;
    modelSelect.appendChild(opt);
  }
  settingsSection.append(modelLabel, modelSelect);
  panel.appendChild(settingsSection);

  widget.append(badge, panel);
  shadowRoot.appendChild(widget);

  document.body.appendChild(widgetContainer);

  // Event handlers (using direct element references from DOM construction above)
  badge.addEventListener('click', () => {
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    expandBtn.textContent = isOpen ? '\u25BC' : '\u25B2';
  });

  modelSelect.addEventListener('change', () => {
    currentModel = modelSelect.value;
    userOverrodeModel = true;
    try {
      chrome.runtime.sendMessage({ type: 'SET_MODEL', model: currentModel });
    } catch { /* service worker may be inactive */ }
  });

  let lastOriginalText = '';
  let lastOptimizedText = '';

  optBtn.addEventListener('click', () => {
    const adapter = detectPlatform();
    if (!adapter) return;
    const text = adapter.getInputText();
    if (!text) return;

    lastOriginalText = text;
    const result = optimize(text, currentModel);
    lastOptimizedText = result.optimizedPrompt;

    optResult.style.display = 'block';
    comparePanel.style.display = 'none';
    const savedEl = shadowRoot?.getElementById('pf-tokens-saved');
    const reductionEl = shadowRoot?.getElementById('pf-reduction');
    if (savedEl) savedEl.textContent = String(result.tokenReduction);
    if (reductionEl) reductionEl.textContent = `${result.reductionPercent}%`;
    suggestionsDiv.replaceChildren();
    for (const s of result.suggestions.slice(0, 5)) {
      const div = document.createElement('div');
      div.className = 'pf-suggestion';
      div.textContent = `\u2022 ${s.description}`;
      suggestionsDiv.appendChild(div);
    }
  });

  // Side-by-side compare button
  compareBtn.addEventListener('click', () => {
    if (!lastOriginalText || !lastOptimizedText) return;
    const origTextEl = shadowRoot?.getElementById('pf-original-text');
    const optTextEl = shadowRoot?.getElementById('pf-optimized-text');

    const isVisible = comparePanel.style.display !== 'none';
    comparePanel.style.display = isVisible ? 'none' : 'block';

    if (origTextEl) origTextEl.textContent = lastOriginalText;
    if (optTextEl) optTextEl.textContent = lastOptimizedText;

    const origTokens = countTokens(lastOriginalText, currentModel).inputTokens;
    const optTokens = countTokens(lastOptimizedText, currentModel).inputTokens;
    beforeSpan.textContent = `${origTokens} tokens`;
    afterSpan.textContent = `${optTokens} tokens`;
  });

  // Apply optimized button
  applyBtn.addEventListener('click', () => {
    if (!lastOptimizedText) return;
    const adapter = detectPlatform();
    if (!adapter) return;
    adapter.setInputText(lastOptimizedText);
    updateWidget(lastOptimizedText);
  });
}

function updateWidget(text: string): void {
  if (!shadowRoot) return;

  const tokens = countTokens(text, currentModel);
  const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, currentModel);
  const context = monitorContext([{ role: 'user', content: text }], currentModel);

  const $ = (id: string) => shadowRoot?.getElementById(id);

  const tokenCountEl = $('pf-token-count');
  const costEl = $('pf-cost');
  const inputTokensEl = $('pf-input-tokens');
  const outputTokensEl = $('pf-output-tokens');
  const inputCostEl = $('pf-input-cost');
  const outputCostEl = $('pf-output-cost');
  const totalCostEl = $('pf-total-cost');
  const contextBarEl = $('pf-context-bar');
  const contextLabelEl = $('pf-context-label');
  const contextRemainingEl = $('pf-context-remaining');

  if (tokenCountEl) tokenCountEl.textContent = `${tokens.inputTokens.toLocaleString()} tokens`;
  if (costEl) costEl.textContent = formatCost(cost.totalCost);
  if (inputTokensEl) inputTokensEl.textContent = tokens.inputTokens.toLocaleString();
  if (outputTokensEl) outputTokensEl.textContent = `~${tokens.estimatedOutputTokens.toLocaleString()}`;
  if (inputCostEl) inputCostEl.textContent = formatCost(cost.inputCost);
  if (outputCostEl) outputCostEl.textContent = formatCost(cost.outputCost);
  if (totalCostEl) totalCostEl.textContent = formatCost(cost.totalCost);

  if (contextBarEl) {
    contextBarEl.style.width = `${Math.min(context.percentUsed, 100)}%`;
    const colors = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444' };
    contextBarEl.style.backgroundColor = colors[context.warning];
  }
  if (contextLabelEl) contextLabelEl.textContent = `${context.percentUsed}% used`;
  if (contextRemainingEl) contextRemainingEl.textContent = `${context.remainingTokens.toLocaleString()} remaining`;
}

function getWidgetStyles(): string {
  return `
    #pf-widget {
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
    }
    .pf-badge {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 6px 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      transition: background 0.2s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .pf-badge:hover { background: #334155; }
    .pf-separator { color: #475569; }
    .pf-expand-btn { font-size: 10px; color: #94a3b8; }
    .pf-panel {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 8px;
      min-width: 260px;
      max-width: 480px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .pf-panel-section {
      padding: 8px 0;
      border-bottom: 1px solid #334155;
    }
    .pf-panel-section:last-child { border-bottom: none; }
    .pf-panel-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .pf-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .pf-total { font-weight: 700; color: #38bdf8; }
    .pf-context-bar-container {
      background: #0f172a;
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    .pf-context-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s, background-color 0.3s;
      width: 0%;
      background: #22c55e;
    }
    .pf-btn {
      width: 100%;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .pf-btn:hover { background: #2563eb; }
    .pf-btn-secondary {
      background: #334155;
      color: #e2e8f0;
    }
    .pf-btn-secondary:hover { background: #475569; }
    .pf-btn-apply {
      background: #22c55e;
      color: #0f172a;
      font-weight: 600;
    }
    .pf-btn-apply:hover { background: #16a34a; }
    .pf-suggestion {
      font-size: 12px;
      color: #cbd5e1;
      padding: 3px 0;
    }
    .pf-compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .pf-compare-col {
      min-width: 0;
    }
    .pf-compare-header {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 700;
      padding: 4px 6px;
      border-radius: 4px 4px 0 0;
    }
    .pf-original-header {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pf-optimized-header {
      background: #14532d;
      color: #86efac;
    }
    .pf-compare-text {
      background: #0f172a;
      padding: 8px;
      border-radius: 0 0 4px 4px;
      font-size: 11px;
      line-height: 1.5;
      max-height: 150px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .pf-compare-stats {
      justify-content: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
    }
    #pf-compare-arrow { color: #38bdf8; }
    .pf-settings { display: flex; align-items: center; gap: 8px; }
    .pf-label { font-size: 12px; color: #94a3b8; }
    .pf-select {
      flex: 1;
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
    }
  `;
}

function syncModelFromPage(adapter: ReturnType<typeof detectPlatform>): void {
  if (!adapter) return;
  const detected = adapter.getSelectedModel();
  if (!detected) return;

  const pageModelChanged = detected !== lastPageDetectedModel;
  lastPageDetectedModel = detected;

  // If page model changed, clear user override so we follow the page again
  if (pageModelChanged) userOverrodeModel = false;

  // Don't overwrite a manual widget selection unless the page model actually changed
  if (userOverrodeModel) return;

  const modelSelect = shadowRoot?.getElementById('pf-model-select') as HTMLSelectElement | null;
  if (detected !== currentModel) {
    currentModel = detected;
    if (modelSelect) modelSelect.value = currentModel;
    try {
      chrome.runtime.sendMessage({ type: 'SET_MODEL', model: currentModel });
    } catch { /* service worker may be inactive */ }
  } else if (modelSelect && modelSelect.value !== currentModel) {
    modelSelect.value = currentModel;
  }
}

function syncModelWithRetry(adapter: ReturnType<typeof detectPlatform>): void {
  // Try immediately, then retry at 500ms / 1.5s / 3s to handle slow renders
  [0, 500, 1500, 3000].forEach((delay) => {
    setTimeout(() => syncModelFromPage(adapter), delay);
  });
}

// Main initialization
function init(): void {
  const adapter = detectPlatform();
  if (!adapter) return;

  // Auto-detect model from the page, poll every 2s for changes (model switcher)
  const modelPollInterval = setInterval(() => syncModelFromPage(adapter), 2000);
  // Stop polling after 5 min to avoid idle overhead
  setTimeout(() => clearInterval(modelPollInterval), 5 * 60 * 1000);

  const observer = new DOMObserver();

  // Watch for the input element to appear
  const inputSelector = adapter.name === 'chatgpt'
    ? '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"]'
    : adapter.name === 'gemini'
      ? 'div[contenteditable="true"][aria-label], rich-textarea div[contenteditable="true"], div[contenteditable="true"].ql-editor, div[contenteditable="true"]'
      : '.ProseMirror[contenteditable="true"], div[contenteditable="true"]';

  observer.watch({
    selector: inputSelector,
    onFound: () => {
      createWidget();
      syncModelWithRetry(adapter);
      // Detach first to prevent stacking listeners on repeated onFound calls
      adapter.detachInputListener();
      adapter.attachInputListener((text) => {
        if (text.length > 0) {
          updateWidget(text);
        }
      });
    },
    onRemoved: () => {
      adapter.detachInputListener();
    },
  });

  observer.start();
}

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
