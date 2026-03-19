import fs from 'fs';
import os from 'os';
import path from 'path';

const MARKER = '# promptfuel alias';
const ALIAS_LINE = 'alias pf="promptfuel"';

function removeAlias(): { status: 'removed' | 'notFound' | 'unknown'; configFile?: string } {
  const shell = process.env.SHELL ?? '';
  const home = os.homedir();

  let configFile: string;
  if (shell.includes('zsh')) {
    configFile = path.join(home, '.zshenv');
  } else if (shell.includes('bash')) {
    const bashProfile = path.join(home, '.bash_profile');
    configFile = process.platform === 'darwin' && fs.existsSync(bashProfile)
      ? bashProfile
      : path.join(home, '.bashrc');
  } else if (shell.includes('fish')) {
    configFile = path.join(home, '.config', 'fish', 'config.fish');
  } else {
    return { status: 'unknown' };
  }

  if (!fs.existsSync(configFile)) return { status: 'notFound', configFile };

  const content = fs.readFileSync(configFile, 'utf8');
  if (!content.includes(ALIAS_LINE)) return { status: 'notFound', configFile };

  // Remove the marker line, alias line, and surrounding blank lines we added
  const cleaned = content
    .replace(new RegExp(`\\n${MARKER}\\n${ALIAS_LINE}\\n`, 'g'), '\n')
    .replace(new RegExp(`${MARKER}\\n${ALIAS_LINE}\\n?`, 'g'), '');

  fs.writeFileSync(configFile, cleaned, 'utf8');
  return { status: 'removed', configFile };
}

function removeMcp(): { status: 'removed' | 'notFound' | 'error'; error?: string } {
  try {
    const mcpFile = path.join(os.homedir(), '.claude', 'mcp.json');
    if (!fs.existsSync(mcpFile)) return { status: 'notFound' };

    const config = JSON.parse(fs.readFileSync(mcpFile, 'utf8')) as Record<string, unknown>;
    const servers = config.mcpServers as Record<string, unknown> | undefined;

    if (!servers?.promptfuel) return { status: 'notFound' };

    delete servers.promptfuel;
    config.mcpServers = servers;

    fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return { status: 'removed' };
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
}

export async function runUninstall(): Promise<void> {
  const lines: string[] = ['', '  Uninstalling PromptFuel...', ''];

  const alias = removeAlias();
  if (alias.status === 'removed') {
    lines.push(`  ✓ Removed pf alias from ${alias.configFile}`);
  } else if (alias.status === 'notFound') {
    lines.push(`  · pf alias not found in ${alias.configFile ?? 'shell config'} — skipping`);
  } else {
    lines.push('  · Could not detect shell — remove manually:');
    lines.push(`    Delete the line: ${ALIAS_LINE}`);
  }

  const mcp = removeMcp();
  if (mcp.status === 'removed') {
    lines.push('  ✓ Removed promptfuel MCP server from ~/.claude/mcp.json');
  } else if (mcp.status === 'notFound') {
    lines.push('  · MCP entry not found — skipping');
  } else {
    lines.push(`  ⚠ Could not update ~/.claude/mcp.json: ${mcp.error}`);
    lines.push('    Remove manually: delete the "promptfuel" key under mcpServers');
  }

  lines.push('');
  lines.push('  Run: npm uninstall -g promptfuel');
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}
