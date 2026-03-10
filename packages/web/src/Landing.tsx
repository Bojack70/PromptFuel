import React, { useState, useEffect, useRef } from 'react';
import { listModels, getContextWindow } from '@promptfuel/core';
import { LiveDemo } from './components/LiveDemo.js';

// ── Responsive hook ──
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// ── Pricing data (inline to avoid extra imports) ──
const MODEL_DATA: Record<string, { input: number; output: number; context: number; label: string }> = {
  'gpt-4o':           { input: 2.50,  output: 10.00, context: 128000, label: 'GPT-4o' },
  'gpt-4o-mini':      { input: 0.15,  output: 0.60,  context: 128000, label: 'GPT-4o Mini' },
  'gpt-4-turbo':      { input: 10.00, output: 30.00, context: 128000, label: 'GPT-4 Turbo' },
  'gpt-3.5-turbo':    { input: 0.50,  output: 1.50,  context: 16385,  label: 'GPT-3.5 Turbo' },
  'o1':               { input: 15.00, output: 60.00, context: 200000, label: 'o1' },
  'o1-mini':          { input: 3.00,  output: 12.00, context: 128000, label: 'o1 Mini' },
  'o3':               { input: 10.00, output: 40.00, context: 200000, label: 'o3' },
  'o3-mini':          { input: 1.10,  output: 4.40,  context: 200000, label: 'o3 Mini' },
  'claude-opus-4-6':  { input: 15.00, output: 75.00, context: 200000, label: 'Claude Opus' },
  'claude-sonnet-4-6':{ input: 3.00,  output: 15.00, context: 200000, label: 'Claude Sonnet' },
  'claude-haiku-4-5': { input: 0.80,  output: 4.00,  context: 200000, label: 'Claude Haiku' },
  'claude-3.5-sonnet':{ input: 3.00,  output: 15.00, context: 200000, label: 'Claude 3.5 Sonnet' },
  'claude-3-opus':    { input: 15.00, output: 75.00, context: 200000, label: 'Claude 3 Opus' },
  'claude-3-haiku':   { input: 0.25,  output: 1.25,  context: 200000, label: 'Claude 3 Haiku' },
};

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3', 'o3-mini'];
const ANTHROPIC_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-3.5-sonnet', 'claude-3-opus', 'claude-3-haiku'];

function formatContext(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toString();
}

// ── Section refs for smooth scroll ──
const NAV_ITEMS = ['Features', 'How It Works', 'Models', 'Roadmap', 'Get Started'] as const;

export function Landing() {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [installTab, setInstallTab] = useState<'cli' | 'sdk' | 'extension'>('cli');
  const [mobileNav, setMobileNav] = useState(false);

  const featuresRef = useRef<HTMLDivElement>(null);
  const howRef = useRef<HTMLDivElement>(null);
  const modelsRef = useRef<HTMLDivElement>(null);
  const roadmapRef = useRef<HTMLDivElement>(null);
  const getStartedRef = useRef<HTMLDivElement>(null);

  const sectionRefs: Record<string, React.RefObject<HTMLDivElement | null>> = {
    'Features': featuresRef,
    'How It Works': howRef,
    'Models': modelsRef,
    'Roadmap': roadmapRef,
    'Get Started': getStartedRef,
  };

  const scrollTo = (label: string) => {
    sectionRefs[label]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNav(false);
  };

  return (
    <div style={{ background: '#ffffff', color: '#1a1a2e', fontFamily: "'Inter', sans-serif" }}>

      {/* ═══════ 1. NAVBAR ═══════ */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(8px)', borderBottom: '1px solid #e5e7eb',
      }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '0 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56,
        }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', letterSpacing: -0.5 }}>
            PromptFuel
          </span>

          {isMobile ? (
            <button onClick={() => setMobileNav(!mobileNav)} style={hamburgerStyle}>
              {mobileNav ? '✕' : '☰'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              {NAV_ITEMS.map(item => (
                <button key={item} onClick={() => scrollTo(item)} style={navLinkStyle}>
                  {item}
                </button>
              ))}
              <a href="#/app" style={navCTAStyle}>Open Dashboard</a>
            </div>
          )}
        </div>
        {/* Mobile dropdown */}
        {isMobile && mobileNav && (
          <div style={{ padding: '8px 24px 16px', borderTop: '1px solid #e5e7eb' }}>
            {NAV_ITEMS.map(item => (
              <button key={item} onClick={() => scrollTo(item)} style={{ ...navLinkStyle, display: 'block', padding: '10px 0' }}>
                {item}
              </button>
            ))}
            <a href="#/app" style={{ ...navCTAStyle, display: 'inline-block', marginTop: 8 }}>Open Dashboard</a>
          </div>
        )}
      </nav>

      {/* ═══════ 2. HERO ═══════ */}
      <section style={{ ...sectionPadding, textAlign: 'center', paddingTop: isMobile ? 60 : 100, paddingBottom: isMobile ? 40 : 80 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontSize: isMobile ? 32 : 48, fontWeight: 700, lineHeight: 1.15, marginBottom: 20, letterSpacing: -1 }}>
            Save tokens. Cut costs.{isMobile ? ' ' : <br />}Write better prompts.
          </h1>
          <p style={{ fontSize: isMobile ? 16 : 18, color: '#6b7280', lineHeight: 1.7, marginBottom: 32, maxWidth: 600, margin: '0 auto 32px' }}>
            PromptFuel helps you spend less on AI with intent-aware prompt optimization, token budget targeting, and cost intelligence — across ChatGPT, Claude, and 14+ models.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('Get Started')} style={heroPrimaryBtn}>
              Get Started
            </button>
            <a href="#/app" style={heroSecondaryBtn}>
              Open Dashboard
            </a>
          </div>
        </div>

        {/* Terminal block */}
        <div style={{
          maxWidth: 560, margin: '48px auto 0', background: '#1a1a2e', borderRadius: 10,
          padding: '20px 24px', textAlign: 'left', fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: 13, lineHeight: 1.8, color: '#a5b4fc', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>$ npx promptfuel optimize "verbose prompt" --budget 30</div>
          <div><span style={{ color: '#22c55e' }}>✓</span> <span style={{ color: '#e2e8f0' }}>Intent:</span> <span style={{ color: '#c084fc' }}>debug</span> <span style={{ color: '#6b7280' }}>(87% confidence)</span></div>
          <div><span style={{ color: '#22c55e' }}>✓</span> <span style={{ color: '#e2e8f0' }}>Original:</span> 47 tokens</div>
          <div><span style={{ color: '#22c55e' }}>✓</span> <span style={{ color: '#e2e8f0' }}>Optimized:</span> 26 tokens — <span style={{ color: '#c084fc' }}>Level 2 compression</span></div>
          <div><span style={{ color: '#22c55e' }}>✓</span> <span style={{ color: '#38bdf8' }}>Saved 44%</span> — $0.000052/call</div>
        </div>
      </section>

      {/* ═══════ 3. STATS BAR ═══════ */}
      <section style={{ background: '#f8fafc', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '28px 24px',
          display: 'flex', justifyContent: 'center', gap: isMobile ? 32 : 80,
          flexWrap: 'wrap', textAlign: 'center',
        }}>
          {[
            { value: '150+', label: 'Optimization Rules' },
            { value: '14+', label: 'Supported Models' },
            { value: '~94%', label: 'Token Accuracy' },
            { value: '5', label: 'Intent Types' },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e' }}>{s.value}</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ 4. LIVE DEMO ═══════ */}
      <section style={{ ...sectionPadding }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Try It Now</SectionTitle>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 15, marginBottom: 32, marginTop: -16 }}>
            Paste a prompt and see intent detection, token budget targeting, and optimization suggestions.
          </p>
          <LiveDemo />
        </div>
      </section>

      {/* ═══════ 5. FEATURES GRID ═══════ */}
      <section ref={featuresRef} style={{ ...sectionPadding, background: '#f8fafc' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Features</SectionTitle>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 20,
          }}>
            {FEATURES.map(f => (
              <div key={f.title} style={featureCardStyle}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ 6. HOW IT WORKS ═══════ */}
      <section ref={howRef} style={{ ...sectionPadding }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>How It Works</SectionTitle>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            gap: isMobile ? 32 : 60, flexDirection: isMobile ? 'column' : 'row',
            position: 'relative',
          }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ textAlign: 'center', flex: 1, position: 'relative' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%', background: '#2563eb', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, fontWeight: 700, marginBottom: 16,
                }}>
                  {i + 1}
                </div>
                {/* Connecting line */}
                {!isMobile && i < STEPS.length - 1 && (
                  <div style={{
                    position: 'absolute', top: 24, left: '60%', width: '80%',
                    height: 2, background: '#e5e7eb',
                  }} />
                )}
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{step.title}</div>
                <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ 7. BEFORE / AFTER SHOWCASE ═══════ */}
      <section style={{ ...sectionPadding, background: '#f8fafc' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Before &amp; After</SectionTitle>
          <div style={{ maxWidth: 780, margin: '0 auto' }}>
            {/* Intent badge */}
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <span style={{
                display: 'inline-block', background: '#f5f3ff', border: '1px solid #c4b5fd',
                borderRadius: 24, padding: '5px 16px', fontSize: 13, fontWeight: 600,
                color: '#7c3aed',
              }}>
                Intent: debug (87% confidence)
              </span>
            </div>
            <div style={{
              display: 'flex', gap: 20, flexDirection: isMobile ? 'column' : 'row',
            }}>
              {/* Before */}
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#ef4444', marginBottom: 10 }}>
                  Before — 31 tokens
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
                  Can you please help me debug this issue <span style={{ background: '#fde68a', padding: '0 3px', borderRadius: 3 }}>step by step</span> and provide a detailed and comprehensive explanation of why the function returns null?
                </div>
              </div>
              {/* After */}
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: '#16a34a', marginBottom: 10 }}>
                  After — 14 tokens
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: '#374151' }}>
                  Debug why function returns null. Explain <span style={{ background: '#bbf7d0', padding: '0 3px', borderRadius: 3 }}>step by step</span>.
                </div>
              </div>
            </div>
            {/* Badges */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-block', background: '#f0fdf4', border: '2px solid #16a34a',
                borderRadius: 24, padding: '6px 20px', fontSize: 14, fontWeight: 700,
                color: '#16a34a',
              }}>
                55% fewer tokens
              </span>
              <span style={{
                display: 'inline-block', background: '#f5f3ff', border: '2px solid #7c3aed',
                borderRadius: 24, padding: '6px 20px', fontSize: 14, fontWeight: 700,
                color: '#7c3aed',
              }}>
                "step by step" preserved
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ 8. SUPPORTED MODELS ═══════ */}
      <section ref={modelsRef} style={{ ...sectionPadding }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Supported Models</SectionTitle>
          <div style={{ display: 'flex', gap: 24, flexDirection: isMobile ? 'column' : 'row' }}>
            {/* OpenAI */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>OpenAI</div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={thStyle}>Model</th>
                      <th style={thStyle}>Input</th>
                      <th style={thStyle}>Output</th>
                      <th style={thStyle}>Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {OPENAI_MODELS.map(id => {
                      const m = MODEL_DATA[id];
                      return (
                        <tr key={id}>
                          <td style={tdStyle}>{m.label}</td>
                          <td style={tdStyle}>${m.input.toFixed(2)}</td>
                          <td style={tdStyle}>${m.output.toFixed(2)}</td>
                          <td style={tdStyle}>{formatContext(m.context)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Anthropic */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Anthropic</div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={thStyle}>Model</th>
                      <th style={thStyle}>Input</th>
                      <th style={thStyle}>Output</th>
                      <th style={thStyle}>Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ANTHROPIC_MODELS.map(id => {
                      const m = MODEL_DATA[id];
                      return (
                        <tr key={id}>
                          <td style={tdStyle}>{m.label}</td>
                          <td style={tdStyle}>${m.input.toFixed(2)}</td>
                          <td style={tdStyle}>${m.output.toFixed(2)}</td>
                          <td style={tdStyle}>{formatContext(m.context)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 16 }}>
            Prices per 1M tokens (USD). Context window in tokens.
          </p>
        </div>
      </section>

      {/* ═══════ 9. ROADMAP ═══════ */}
      <section ref={roadmapRef} style={{ ...sectionPadding }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Roadmap</SectionTitle>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: 15, marginBottom: 40, marginTop: -16 }}>
            Upcoming features across three tiers.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 24,
          }}>
            {ROADMAP_TIERS.map(tier => (
              <div key={tier.name} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{
                  fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                  color: tier.color, textAlign: 'center',
                }}>
                  {tier.name}
                </div>
                {tier.items.map(item => (
                  <div key={item.title} style={{
                    background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10,
                    padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e' }}>{item.title}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                        background: '#f0f9ff', color: '#2563eb', padding: '3px 8px', borderRadius: 4,
                      }}>Coming Soon</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>{item.desc}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ 10. GET STARTED (TABBED INSTALL) ═══════ */}
      <section ref={getStartedRef} style={{ ...sectionPadding, background: '#f8fafc' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px' }}>
          <SectionTitle>Get Started</SectionTitle>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
              {(['cli', 'sdk', 'extension'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setInstallTab(tab)}
                  style={{
                    ...installTabStyle,
                    background: installTab === tab ? '#2563eb' : '#ffffff',
                    color: installTab === tab ? '#ffffff' : '#6b7280',
                    border: installTab === tab ? '1px solid #2563eb' : '1px solid #e5e7eb',
                  }}
                >
                  {tab === 'cli' ? 'CLI' : tab === 'sdk' ? 'SDK' : 'Chrome Extension'}
                </button>
              ))}
            </div>

            {installTab === 'cli' && (
              <div>
                <CodeBlock>{`# Install\nnpm install -g @promptfuel/cli\n\n# Optimize a prompt\npromptfuel optimize "your verbose prompt here"\n\n# Count tokens\npromptfuel tokens "your prompt" --model gpt-4o\n\n# Launch the dashboard\npromptfuel dashboard`}</CodeBlock>
              </div>
            )}

            {installTab === 'sdk' && (
              <div>
                <CodeBlock>{`npm install @promptfuel/core`}</CodeBlock>
                <div style={{ height: 12 }} />
                <CodeBlock>{`import { optimize, countTokens, calculateCost } from '@promptfuel/core';\n\n// Intent-aware optimization with token budget targeting\nconst result = optimize(\n  "Please help me debug this step by step",\n  "gpt-4o",\n  { targetTokens: 20 }\n);\n\nconsole.log(result.intent);           // "debug" (87% confidence)\nconsole.log(result.optimizedPrompt);   // "Debug this step by step"\nconsole.log(result.budget);            // { level: 2, withinBudget: true }\nconsole.log(\`Saved \${result.reductionPercent}% tokens\`);\n\nconst cost = calculateCost(result.outputTokens, 500, "gpt-4o");\nconsole.log(cost.totalCost);`}</CodeBlock>
              </div>
            )}

            {installTab === 'extension' && (
              <div>
                <CodeBlock>{`# Clone and build\ngit clone https://github.com/user/promptfuel.git\ncd promptfuel\npnpm install && pnpm build\n\n# Load in Chrome\n# 1. Open chrome://extensions\n# 2. Enable "Developer mode"\n# 3. Click "Load unpacked"\n# 4. Select packages/extension/dist`}</CodeBlock>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ═══════ 10. FOOTER ═══════ */}
      <footer style={{
        maxWidth: 1100, margin: '0 auto', padding: '24px',
        textAlign: 'center', color: '#9ca3af', fontSize: 13,
        borderTop: '1px solid #e5e7eb',
      }}>
        PromptFuel &middot; MIT License &middot; Open Source
      </footer>
    </div>
  );
}

// ── Sub-components ──

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 40,
      letterSpacing: -0.5, color: '#1a1a2e',
    }}>
      {children}
    </h2>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={{
      background: '#1a1a2e', color: '#e2e8f0', borderRadius: 8,
      padding: '16px 20px', fontSize: 13, lineHeight: 1.7, overflowX: 'auto',
      fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    }}>
      {children}
    </pre>
  );
}

// ── Data ──

const FEATURES = [
  { icon: '✏️', title: 'Smart Rewriter', desc: 'Intent-aware optimization with 150+ rules — automatically gates passes based on detected prompt intent to preserve critical phrases.' },
  { icon: '🔢', title: 'Token Counter', desc: 'Exact token counts for OpenAI models and ~94% accuracy for Claude models.' },
  { icon: '💰', title: 'Cost Calculator', desc: 'Real-time per-model pricing across 14+ models from OpenAI and Anthropic.' },
  { icon: '📊', title: 'Context Monitor', desc: 'Visual progress bar showing context window usage with color-coded warnings.' },
  { icon: '📈', title: 'Cost Intelligence Dashboard', desc: 'Reads your real Claude Code usage data to show total tokens, costs, session breakdowns, and 5 actionable savings cards.' },
  { icon: '🎯', title: 'Intent Detection', desc: 'Classifies prompts into 5 intent types (code-gen, debug, explain, refactor, general) with confidence scoring to tailor optimization.' },
  { icon: '📐', title: 'Token Budget Targeting', desc: 'Set a target token count and PromptFuel auto-selects the right compression level (1-4) to hit your budget.' },
  { icon: '🧩', title: 'Chrome Extension', desc: 'Floating widget that works directly on ChatGPT and Claude web interfaces.' },
  { icon: '🗄️', title: 'Cache Savings Analyzer', desc: 'Finds repeated prompt patterns via Jaccard similarity clustering and estimates semantic caching savings.' },
];

const ROADMAP_TIERS = [
  {
    name: 'Pro',
    color: '#2563eb',
    items: [
      { title: 'Prompt A/B Cost Analyzer', desc: 'Compare cost and quality of prompt variants side-by-side.' },
      { title: 'Team Spend Analytics', desc: 'Aggregated token usage and cost dashboards across your team.' },
      { title: 'Real-Time Anomaly Alerts', desc: 'Instant notifications when spending spikes unexpectedly.' },
    ],
  },
  {
    name: 'Business',
    color: '#7c3aed',
    items: [
      { title: 'Cost Governance & Budget Controls', desc: 'Set hard spending limits and approval workflows per project.' },
      { title: 'Intent Learning', desc: 'Custom intent types that learn from your prompt history and adapt optimization rules over time.' },
      { title: 'Cost Forecasting', desc: 'Predict next-month AI spend based on usage trends and growth.' },
    ],
  },
  {
    name: 'Enterprise',
    color: '#059669',
    items: [
      { title: 'Multi-Provider Failover', desc: 'Automatic model fallback across OpenAI, Anthropic, and more.' },
      { title: 'SSO + Compliance', desc: 'Enterprise authentication with SOC 2 and audit logging.' },
      { title: 'Cost Intelligence API', desc: 'Embed PromptFuel analytics into your own internal tools.' },
    ],
  },
];

const STEPS = [
  { title: 'Paste your prompt', desc: 'Type or paste any prompt into the analyzer — works with any AI model.' },
  { title: 'Get instant analysis', desc: 'See intent detection, token counts, cost estimates, context usage, and optimization suggestions across Analyze, History, Strategies, and Insights tabs.' },
  { title: 'Apply optimization', desc: 'One click to apply suggestions — save tokens and reduce API costs immediately.' },
];

// ── Styles ──

const sectionPadding: React.CSSProperties = {
  padding: '80px 0',
};

const navLinkStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 14, color: '#6b7280',
  cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontWeight: 500,
  padding: 0,
};

const navCTAStyle: React.CSSProperties = {
  background: '#1a1a2e', color: '#ffffff', padding: '8px 18px',
  borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none',
  fontFamily: "'Inter', sans-serif",
};

const hamburgerStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 22, cursor: 'pointer',
  color: '#1a1a2e', padding: 4,
};

const heroPrimaryBtn: React.CSSProperties = {
  background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: 8,
  padding: '12px 28px', fontSize: 16, fontWeight: 600, cursor: 'pointer',
  fontFamily: "'Inter', sans-serif",
};

const heroSecondaryBtn: React.CSSProperties = {
  background: 'transparent', color: '#2563eb', border: '2px solid #2563eb',
  borderRadius: 8, padding: '10px 28px', fontSize: 16, fontWeight: 600,
  cursor: 'pointer', textDecoration: 'none', fontFamily: "'Inter', sans-serif",
  display: 'inline-flex', alignItems: 'center',
};

const featureCardStyle: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10,
  padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const installTabStyle: React.CSSProperties = {
  borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 12,
  fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151',
};
