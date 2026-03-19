import React, { useRef } from 'react';

// ── Design tokens (from reference landing.html) ──────────────────────────────
const C = {
  bg:             'hsl(40, 20%, 97%)',
  fg:             'hsl(220, 20%, 12%)',
  card:           'hsl(0, 0%, 100%)',
  primary:        'hsl(217, 91%, 55%)',
  primaryFg:      'hsl(0, 0%, 100%)',
  secondary:      'hsl(214, 15%, 92%)',
  secondaryFg:    'hsl(220, 20%, 20%)',
  muted:          'hsl(214, 10%, 93%)',
  mutedFg:        'hsl(220, 10%, 42%)',
  border:         'hsl(214, 10%, 88%)',
  surfaceCode:    'hsl(214, 15%, 96%)',
  surfaceElevated:'hsl(214, 12%, 94%)',
  textBright:     'hsl(220, 20%, 10%)',
  textDim:        'hsl(220, 10%, 55%)',
  gradient:       'linear-gradient(135deg, hsl(217, 91%, 55%), hsl(230, 80%, 50%))',
  shadowGlowSm:   '0 0 30px -8px hsla(217, 91%, 55%, 0.15)',
  radius:         '12px',
  mono:           "'JetBrains Mono', monospace",
};

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const FlameIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

const GitHubIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const TerminalIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function GradientText({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      background: C.gradient,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }}>
      {children}
    </span>
  );
}

function TerminalWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderRadius: C.radius,
      border: `1px solid ${C.border}`,
      background: C.surfaceCode,
      overflow: 'hidden',
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'hsla(0,84%,60%,0.6)' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'hsla(217,91%,55%,0.4)' }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'hsla(220,10%,42%,0.2)' }} />
        <span style={{ marginLeft: 8, fontSize: 12, color: C.textDim, fontFamily: C.mono }}>{title}</span>
      </div>
      <div style={{ padding: '20px 24px', textAlign: 'left', fontSize: 14, lineHeight: 1.7, fontFamily: C.mono }}>
        {children}
      </div>
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: '🧠', title: 'Intent Detection', desc: 'Classifies prompts into 6 intent types — debug, code-gen, refactor, explain, creative, general — with confidence scoring. Optimization adapts automatically per intent.' },
  { icon: '🎯', title: 'Token Budget Targeting', desc: 'Set a target token count and auto-select the right compression level (1–4) to hit your budget without losing meaning.' },
  { icon: '✏️', title: 'Smart Prompt Rewriter', desc: '4-pass rewriter — verbose phrases, sentence compression, voice transform, question restructuring — gated by detected intent to avoid over-optimizing.' },
  { icon: '#',  title: 'Token Counter', desc: 'Exact token counts for OpenAI models via tiktoken, ~94% accurate for Claude. Know your token cost before you send.' },
  { icon: '💲', title: 'Cost Calculator', desc: 'Real-time cost estimates with per-model pricing for 23 models — GPT-4o, o1, o3, Claude Opus/Sonnet/Haiku, Gemini and more.' },
  { icon: '⚡', title: 'Context Monitor', desc: 'Visual progress bar showing how much of your context window you\'ve used, with color-coded warnings as you approach the limit.' },
  { icon: '💡', title: 'Strategy Advisor', desc: 'Analyzes your project config, conversation history, model usage, and prompt patterns — then surfaces actionable token-saving recommendations.' },
  { icon: '🗂️', title: 'Cache Analysis', desc: 'Clusters your prompts to identify prompt-prefix caching opportunities. Shows which clusters benefit most and provides a step-by-step setup guide.' },
  { icon: '📊', title: 'Claude Code Insights', desc: 'Run `pf insights` to see real token usage and cost across all your Claude Code projects — by project, by model, with cache hit totals. Full details in the dashboard.' },
  { icon: '🔌', title: 'MCP Server', desc: '6 tools + auto-optimize mode inside Claude Code. The optimize_prompt tool supports budget (target token count), intent override, and aggressive compression. Say "enable auto optimize" once and every message is automatically optimized for the session — no command needed.' },
  { icon: '🌍', title: 'Web Dashboard', desc: 'Opens directly to the Insights tab — powered by real Claude Code usage data. Plus Analyze & Optimize, History, and Strategies tabs.' },
  { icon: '🌐', title: 'Chrome Extension', desc: 'Floating widget on ChatGPT, Claude, and Gemini that shows live token count and cost estimate as you type — before you hit send.' },
  { icon: '⌨️', title: 'Interactive TUI', desc: 'Run promptfuel with no arguments to launch a full terminal UI — analyze, optimize, and browse history without leaving the shell.' },
  { icon: '📦', title: 'Batch Processing', desc: 'Analyze or optimize multiple prompts at once from a JSON file. Ideal for auditing prompt libraries or pre-processing datasets offline.' },
  { icon: '📈', title: 'Verbosity Scoring', desc: 'Every prompt gets a 0–100 verbosity score before and after optimization. Know exactly how bloated your writing is and how much the rewriter cleaned it up.' },
  { icon: '🔒', title: 'Fully Local & Private', desc: 'Zero API calls — everything runs locally on your machine. Rule-based and deterministic. No data is sent anywhere, no account required.' },
];

const PIPELINE = [
  { num: '01', title: 'Intent Detection', desc: 'debug · code-gen · refactor · explain · creative · general' },
  { num: '02', title: 'Pattern Protection', desc: 'Preserve "step by step", code blocks, scope constraints, tone instructions' },
  { num: '03', title: '4-Pass Rewriter', desc: 'Verbose phrases → sentence compression → voice transform → question restructuring' },
  { num: '04', title: 'Budget Compression', desc: 'Progressive levels 1→4 until your target token count is met' },
  { num: '05', title: 'Result', desc: 'Optimized prompt + intent + token savings + cost estimate' },
];

const QUICKSTART_USERS = [
  { label: '1. Install — run this from your system terminal', code: 'npm install -g promptfuel --no-fund', note: 'Permission error? Either use: sudo npm install -g promptfuel --no-fund  —  or install Node via nvm (recommended, no sudo needed).' },
  { header: 'Once installed — run these from any terminal or Claude Code:' },
  { label: 'Auto-optimize every message (say this once in Claude Code chat)', code: 'enable auto optimize' },
  { label: 'Optimize a prompt',          code: 'pf optimize "I would like you to please explain how React hooks work in detail"' },
  { label: 'Maximum compression',        code: 'pf optimize "You should basically just simply explain how this very complex system works" --aggressive' },
  { label: 'With a token budget',        code: 'pf optimize "Please help me debug this error step by step" --budget 10' },
  { label: 'Analyze project for savings',code: 'pf strategies' },
  { label: 'Claude Code usage insights', code: 'pf insights' },
  { label: 'Full dashboard (Insights tab)', code: 'pf dashboard' },
  { label: 'Interactive TUI',            code: 'pf' },
  { label: 'See all commands',           code: 'pf --help' },
  { label: 'Uninstall (removes alias + MCP config automatically)', code: 'pf uninstall' },
];

const QUICKSTART_DEVS = [
  { label: '1. Clone the repo',          code: 'git clone https://github.com/Bojack70/PromptFuel.git && cd PromptFuel' },
  { label: '2. Install & build',         code: 'pnpm install && pnpm build' },
  { label: '3. Run any command',         code: 'pf --help' },
];

const SDK_EXAMPLE = `import { PromptFuel } from '@promptfuel/sdk';

const pf = new PromptFuel({ model: 'gpt-4o' });

// Optimize a prompt — intent detected automatically
const result = pf.optimize(
  'I would like you to please explain how database indexing works in detail'
);

console.log(result.intent);           // { type: "explain", confidence: 0.6 }
console.log(result.optimizedPrompt);  // "Explain how database indexing works in detail"
console.log(result.reductionPercent); // 42

// Check cost before sending
const analysis = pf.analyze(result.optimizedPrompt);
console.log(analysis.cost.total);     // "$0.000023"

// Monitor context window usage
const monitor = pf.createMonitor('claude-sonnet-4-6');
monitor.addMessage({ role: 'user', content: result.optimizedPrompt });
console.log(monitor.getStatus().percentUsed); // 34.2`;

// ── Component ─────────────────────────────────────────────────────────────────
export function Landing() {
  const featuresRef  = useRef<HTMLElement>(null);
  const quickstartRef = useRef<HTMLElement>(null);

  const scrollTo = (ref: React.RefObject<HTMLElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div style={{ background: C.bg, color: C.fg, fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.6 }}>
      <style>{`
        @keyframes pulse-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        .pf-feature-card:hover { border-color: hsla(217,91%,55%,0.3) !important; background: hsl(214,12%,94%) !important; }
        .pf-btn-primary:hover  { transform: scale(1.05) !important; }
        .pf-btn-secondary:hover { background: hsl(214,12%,94%) !important; }
        .pf-nav-link:hover     { color: hsl(220,20%,12%) !important; }
        .pf-footer-link:hover  { color: hsl(220,20%,12%) !important; }
      `}</style>

      {/* ══ NAVBAR ══════════════════════════════════════════════════════════ */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        borderBottom: `1px solid hsla(214,10%,88%,0.5)`,
        background: 'hsla(40,20%,97%,0.8)',
        backdropFilter: 'blur(20px)',
      }}>
        <div style={{
          maxWidth: '72rem', margin: '0 auto', padding: '0 1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '3.5rem',
        }}>
          <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.125rem', color: C.fg, textDecoration: 'none' }}>
            <span style={{ color: C.primary }}><FlameIcon size={20} /></span>
            PromptFuel
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, fontSize: '0.875rem' }}>
            <button onClick={() => scrollTo(featuresRef)} className="pf-nav-link" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.mutedFg, fontSize: '0.875rem', padding: 0, transition: 'color 0.2s' }}>
              Features
            </button>
            <button onClick={() => scrollTo(quickstartRef)} className="pf-nav-link" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.mutedFg, fontSize: '0.875rem', padding: 0, transition: 'color 0.2s' }}>
              Quick Start
            </button>
            <a href="https://github.com/Bojack70/PromptFuel" target="_blank" rel="noopener noreferrer" className="pf-nav-link" style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.mutedFg, textDecoration: 'none', transition: 'color 0.2s' }}>
              <GitHubIcon size={16} /> GitHub
            </a>
            <a href="#/app" target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center',
              background: C.gradient, color: C.primaryFg,
              fontWeight: 600, padding: '0.4rem 1rem', borderRadius: '0.5rem',
              textDecoration: 'none', fontSize: '0.875rem',
            }}>
              Dashboard →
            </a>
          </div>
        </div>
      </nav>

      {/* ══ HERO ════════════════════════════════════════════════════════════ */}
      <section style={{
        position: 'relative', minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', padding: '1rem', paddingTop: '3.5rem',
      }}>
        {/* Animated glow blob */}
        <div style={{
          position: 'absolute', top: '33%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: 'hsla(217,91%,55%,0.05)',
          filter: 'blur(120px)', pointerEvents: 'none',
          animation: 'pulse-glow 3s ease-in-out infinite',
        }} />

        <div style={{ position: 'relative', zIndex: 10, maxWidth: '56rem', margin: '0 auto', textAlign: 'center' }}>

          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            borderRadius: 9999, border: '1px solid hsla(217,91%,55%,0.3)',
            background: C.surfaceElevated, padding: '0.375rem 1rem',
            fontSize: '0.875rem', color: C.mutedFg, marginBottom: '2rem',
          }}>
            <span style={{ color: C.primary }}><FlameIcon size={16} /></span>
            Open-source prompt optimization toolkit
          </div>

          <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: '1.5rem' }}>
            Save tokens.{' '}
            <GradientText>Cut costs.</GradientText>
            <br />Write better prompts.
          </h1>

          <p style={{ fontSize: 'clamp(1rem, 2vw, 1.25rem)', color: C.mutedFg, maxWidth: '40rem', margin: '0 auto 2.5rem', lineHeight: 1.7 }}>
            Intent-aware prompt optimization, token budget targeting, and cost intelligence — across ChatGPT, Claude, Gemini, and 23 models. Zero API calls required.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: '3rem' }}>
            <button onClick={() => scrollTo(quickstartRef)} className="pf-btn-primary" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: C.gradient, color: C.primaryFg,
              fontWeight: 600, padding: '0.75rem 1.5rem', borderRadius: '0.5rem',
              boxShadow: C.shadowGlowSm, border: 'none', cursor: 'pointer',
              transition: 'transform 0.2s', fontSize: '1rem',
            }}>
              <TerminalIcon size={16} /> Get Started
            </button>
            <a href="https://github.com/Bojack70/PromptFuel" target="_blank" rel="noopener noreferrer" className="pf-btn-secondary" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              border: `1px solid ${C.border}`, background: C.secondary,
              color: C.secondaryFg, fontWeight: 500,
              padding: '0.75rem 1.5rem', borderRadius: '0.5rem', textDecoration: 'none',
              transition: 'background 0.2s', fontSize: '1rem',
            }}>
              <GitHubIcon size={16} /> View on GitHub →
            </a>
          </div>

          {/* Terminal demo */}
          <div style={{ maxWidth: '40rem', margin: '0 auto' }}>
            <TerminalWindow title="terminal">
              <p style={{ color: C.mutedFg }}>
                pf optimize "Can you please help me debug this error step by step"
              </p>
              <p style={{ marginTop: 12, color: C.mutedFg }}>
                <span style={{ color: C.primary, fontWeight: 600 }}>INTENT</span>{' '}
                debug{' '}
                <span style={{ color: C.textDim }}>(83% confidence)</span>
              </p>
              <p style={{ color: C.mutedFg }}>
                <span style={{ color: C.primary, fontWeight: 600 }}>OPTIMIZED</span>{' '}
                <span style={{ color: C.textBright }}>"Debug this error step by step."</span>
              </p>
              <p style={{ color: C.mutedFg }}>
                <span style={{ color: C.primary, fontWeight: 600 }}>SAVINGS</span>{' '}
                <span style={{ background: C.gradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', fontWeight: 600 }}>
                  50% token reduction
                </span>
              </p>
            </TerminalWindow>
          </div>
        </div>
      </section>

      {/* ══ FEATURES ════════════════════════════════════════════════════════ */}
      <section ref={featuresRef} style={{ padding: '6rem 1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, marginBottom: '1rem' }}>
            Everything you need to <GradientText>cut AI costs</GradientText>
          </h2>
          <p style={{ color: C.mutedFg, fontSize: '1.125rem', maxWidth: '36rem', margin: '0 auto' }}>
            A complete toolkit spanning CLI, browser extension, web dashboard, and SDK.
          </p>
        </div>
        <div style={{
          maxWidth: '72rem', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem',
        }}>
          {FEATURES.map(f => (
            <div key={f.title} className="pf-feature-card" style={{
              borderRadius: C.radius, border: `1px solid ${C.border}`,
              background: C.card, padding: '1.5rem',
              transition: 'border-color 0.3s, background 0.3s',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '2.5rem', height: '2.5rem', borderRadius: '0.5rem',
                background: 'hsla(217,91%,55%,0.1)', marginBottom: '1rem', fontSize: '1.25rem',
              }}>
                {f.icon}
              </div>
              <h3 style={{ fontWeight: 600, fontSize: '1.125rem', marginBottom: '0.5rem' }}>{f.title}</h3>
              <p style={{ color: C.mutedFg, fontSize: '0.875rem', lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ HOW IT WORKS ════════════════════════════════════════════════════ */}
      <section style={{ padding: '6rem 1rem', background: C.muted }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, marginBottom: '1rem' }}>
            How the <GradientText>pipeline</GradientText> works
          </h2>
          <p style={{ color: C.mutedFg, fontSize: '1.125rem', maxWidth: '36rem', margin: '0 auto' }}>
            100% local. Rule-based and deterministic. No API calls.
          </p>
        </div>
        <div style={{
          maxWidth: '56rem', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1.5rem',
        }}>
          {PIPELINE.map(step => (
            <div key={step.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{
                width: '3rem', height: '3rem', borderRadius: '50%',
                background: C.surfaceElevated, border: `1px solid ${C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.875rem', color: C.primary,
                marginBottom: '0.75rem', fontFamily: C.mono,
              }}>
                {step.num}
              </div>
              <h3 style={{ fontWeight: 600, fontSize: '0.875rem' }}>{step.title}</h3>
              <p style={{ color: C.mutedFg, fontSize: '0.75rem', marginTop: '0.25rem' }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ CODE DEMO ═══════════════════════════════════════════════════════ */}
      <section style={{ padding: '6rem 1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, marginBottom: '1rem' }}>
            Use it <GradientText>programmatically</GradientText>
          </h2>
          <p style={{ color: C.mutedFg, fontSize: '1.125rem', maxWidth: '36rem', margin: '0 auto' }}>
            npm SDK for Node.js apps — analyze, optimize, and monitor tokens in your codebase.
          </p>
        </div>
        <div style={{ maxWidth: '64rem', margin: '0 auto' }}>
          <TerminalWindow title="sdk-example.ts">
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: C.mutedFg, fontSize: '0.875rem', lineHeight: 1.7 }}>
              {SDK_EXAMPLE}
            </pre>
          </TerminalWindow>
        </div>
      </section>

      {/* ══ QUICK START ═════════════════════════════════════════════════════ */}
      <section ref={quickstartRef} style={{ padding: '6rem 1rem', background: C.muted }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.25rem)', fontWeight: 700, marginBottom: '1rem' }}>
            <GradientText>Quick Start</GradientText>
          </h2>
          <p style={{ color: C.mutedFg, fontSize: '1.125rem', maxWidth: '36rem', margin: '0 auto' }}>
            Install once, then use <code style={{ fontFamily: C.mono, fontSize: '1rem', color: C.primary }}>pf</code> from anywhere.
          </p>
        </div>

        <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
          {/* For users */}
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem', fontFamily: C.mono }}>
            For users
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '3rem' }}>
            {QUICKSTART_USERS.map((step, i) => (
              'header' in step ? (
                <p key={i} style={{ fontSize: '0.75rem', fontWeight: 700, color: C.primary, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.5rem', marginBottom: '-0.25rem', fontFamily: C.mono }}>
                  {step.header}
                </p>
              ) : (
              <div key={step.label} style={{ borderRadius: '0.5rem', border: `1px solid ${C.border}`, background: C.surfaceCode, padding: '1rem' }}>
                <p style={{ fontSize: '0.75rem', color: C.mutedFg, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', fontFamily: C.mono }}>
                  {step.label}
                </p>
                <code style={{ fontSize: '0.875rem', color: C.fg, wordBreak: 'break-all', fontFamily: C.mono }}>
                  {step.code}
                </code>
                {'note' in step && (
                  <p style={{ fontSize: '0.75rem', color: C.mutedFg, marginTop: '0.5rem', fontFamily: C.mono }}>
                    {step.note}
                  </p>
                )}
              </div>
              )
            ))}
          </div>

          {/* For developers */}
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: C.mutedFg, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem', fontFamily: C.mono }}>
            For developers (contributing / running from source)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {QUICKSTART_DEVS.map(step => (
              <div key={step.label} style={{ borderRadius: '0.5rem', border: `1px solid ${C.border}`, background: C.surfaceCode, padding: '1rem' }}>
                <p style={{ fontSize: '0.75rem', color: C.mutedFg, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', fontFamily: C.mono }}>
                  {step.label}
                </p>
                <code style={{ fontSize: '0.875rem', color: C.fg, wordBreak: 'break-all', fontFamily: C.mono }}>
                  {step.code}
                </code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ FOOTER ══════════════════════════════════════════════════════════ */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: '3rem 1rem' }}>
        <div style={{
          maxWidth: '64rem', margin: '0 auto',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.125rem' }}>
            <span style={{ color: C.primary }}><FlameIcon size={20} /></span>
            PromptFuel
          </div>
          <p style={{ fontSize: '0.875rem', color: C.mutedFg }}>Open-source · MIT License · Zero API calls</p>
          <a href="https://github.com/Bojack70/PromptFuel" target="_blank" rel="noopener noreferrer" className="pf-footer-link" style={{
            fontSize: '0.875rem', color: C.mutedFg, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'color 0.2s',
          }}>
            <GitHubIcon size={16} /> GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
