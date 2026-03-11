// Post-build onboarding message
const g = '\x1b[32m';  // green
const b = '\x1b[34m';  // blue
const y = '\x1b[33m';  // yellow
const c = '\x1b[36m';  // cyan
const d = '\x1b[2m';   // dim
const r = '\x1b[0m';   // reset
const w = '\x1b[1m';   // bold

console.log(`
${g}${w}  ✓ PromptFuel built successfully.${r}
${d}  ─────────────────────────────────────────────────────${r}

${w}  Get started:${r}

  ${c}Analyze a prompt${r}
  ${d}$${r} npx promptfuel analyze ${y}"Explain how React hooks work"${r}

  ${c}Optimize a prompt${r}
  ${d}$${r} npx promptfuel optimize ${y}"I would like you to please explain..."${r}

  ${c}Optimize with a token budget${r}
  ${d}$${r} npx promptfuel optimize ${y}"Your verbose prompt"${r} ${b}--budget 50${r}

  ${c}Analyze your project for token-saving strategies${r}
  ${d}$${r} npx promptfuel strategies ${y}./my-project${r}

  ${c}Open the web dashboard${r}
  ${d}$${r} npx promptfuel dashboard

  ${c}See all commands${r}
  ${d}$${r} npx promptfuel --help

${d}  ─────────────────────────────────────────────────────${r}
  ${d}Tip: if the above commands don't work yet, use this instead:${r}
  ${d}     replace "npx promptfuel" with "node packages/cli/dist/index.js"${r}
  ${d}     e.g.  node packages/cli/dist/index.js dashboard${r}
  ${d}     (this is only needed until the package is available on npm)${r}
`);
