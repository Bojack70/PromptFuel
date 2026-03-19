import fs from 'fs';
import os from 'os';
import path from 'path';

const MARKER = '# promptfuel alias';
const FULL_BLOCK = `\n${MARKER}\nalias pf="promptfuel"\n`;

function detectShellConfig(): { shell: string; configFile: string } | null {
  const shell = process.env.SHELL ?? '';
  const home = os.homedir();

  if (shell.includes('zsh')) return { shell: 'zsh', configFile: path.join(home, '.zshenv') };
  if (shell.includes('bash')) {
    const bashProfile = path.join(home, '.bash_profile');
    const bashrc = path.join(home, '.bashrc');
    const configFile = process.platform === 'darwin' && fs.existsSync(bashProfile)
      ? bashProfile
      : bashrc;
    return { shell: 'bash', configFile };
  }
  if (shell.includes('fish')) return { shell: 'fish', configFile: path.join(home, '.config', 'fish', 'config.fish') };
  return null;
}

function setupAlias(): { status: 'added' | 'exists' | 'unknown'; configFile?: string } {
  const detected = detectShellConfig();
  if (!detected) return { status: 'unknown' };

  const { configFile } = detected;
  const existing = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  if (existing.includes('alias pf="promptfuel"')) return { status: 'exists', configFile };

  fs.appendFileSync(configFile, FULL_BLOCK, 'utf8');
  return { status: 'added', configFile };
}

function setupMcp(): { status: 'added' | 'exists' | 'error'; error?: string } {
  try {
    const claudeDir = path.join(os.homedir(), '.claude');
    const mcpFile = path.join(claudeDir, 'mcp.json');

    // Ensure ~/.claude/ exists
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

    // Read existing mcp.json or start fresh
    let config: Record<string, unknown> = {};
    if (fs.existsSync(mcpFile)) {
      try { config = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch { /* malformed — overwrite */ }
    }

    // Check if already configured
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    if (servers.promptfuel) return { status: 'exists' };

    // Add promptfuel MCP server
    servers.promptfuel = { command: 'npx', args: ['@promptfuel/mcp'] };
    config.mcpServers = servers;

    fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return { status: 'added' };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}

export async function runSetup(): Promise<void> {
  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  ╔══════════════════════════════════════════════╗');
  lines.push('  ║   PromptFuel installed successfully!         ║');
  lines.push('  ╚══════════════════════════════════════════════╝');
  lines.push('');

  // ── Alias setup ──────────────────────────────────────────────────────────
  const alias = setupAlias();
  if (alias.status === 'added') {
    lines.push(`  ✓ Shell alias added: pf="promptfuel" → ${alias.configFile}`);
    lines.push(`    Run: source ${alias.configFile}  (or open a new terminal)`);
  } else if (alias.status === 'exists') {
    lines.push(`  ✓ Shell alias already set (${alias.configFile})`);
  } else {
    lines.push('  ⚠ Could not detect shell — add to ~/.zshrc manually:');
    lines.push('      alias pf="promptfuel"');
  }

  lines.push('');

  // ── MCP setup ────────────────────────────────────────────────────────────
  const mcp = setupMcp();
  if (mcp.status === 'added') {
    lines.push('  ✓ Claude Code MCP server configured (~/.claude/mcp.json)');
    lines.push('    Restart Claude Code once to activate it.');
  } else if (mcp.status === 'exists') {
    lines.push('  ✓ Claude Code MCP server already configured');
  } else {
    lines.push(`  ⚠ Could not write ~/.claude/mcp.json: ${mcp.error}`);
    lines.push('    Add manually: https://github.com/Bojack70/PromptFuel#mcp');
  }

  // ── Quick start ───────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  Quick start (works in any terminal, including Claude Code):');
  lines.push('    pf optimize "your prompt here"   — optimize & cut tokens');
  lines.push('    pf analyze  "your prompt here"   — token count + cost');
  lines.push('    pf strategies                    — browse prompt strategies');
  lines.push('    pf dashboard                     — open web dashboard');
  lines.push('');

  process.stdout.write(lines.join('\n'));
}
