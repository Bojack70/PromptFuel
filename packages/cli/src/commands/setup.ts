import fs from 'fs';
import os from 'os';
import path from 'path';

const ALIAS_LINE = '\nalias pf="promptfuel"\n';
const MARKER = '# promptfuel alias';
const FULL_BLOCK = `\n${MARKER}\nalias pf="promptfuel"\n`;

function detectShellConfig(): { shell: string; configFile: string } | null {
  const shell = process.env.SHELL ?? '';
  const home = os.homedir();

  if (shell.includes('zsh')) return { shell: 'zsh', configFile: path.join(home, '.zshrc') };
  if (shell.includes('bash')) {
    // macOS bash uses .bash_profile, Linux uses .bashrc
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

export async function runSetup(): Promise<void> {
  const detected = detectShellConfig();

  if (!detected) {
    process.stdout.write([
      '',
      '  Could not detect your shell automatically.',
      '  Add this line manually to your shell config (~/.zshrc, ~/.bashrc, etc.):',
      '',
      '    alias pf="promptfuel"',
      '',
      '  Then reload with: source ~/.zshrc (or equivalent)',
      '',
    ].join('\n'));
    return;
  }

  const { shell, configFile } = detected;

  // Check if already installed
  const existing = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  if (existing.includes('alias pf="promptfuel"')) {
    process.stdout.write([
      '',
      `  ✓ Alias already set up in ${configFile}`,
      '',
      '  Run: pf optimize "your prompt here"',
      '',
    ].join('\n'));
    return;
  }

  // Append alias
  fs.appendFileSync(configFile, FULL_BLOCK, 'utf8');

  process.stdout.write([
    '',
    `  ✓ Added alias pf="promptfuel" to ${configFile}`,
    '',
    '  Reload your shell to activate:',
    `    source ${configFile}`,
    '',
    '  Then use:',
    '    pf optimize "your prompt here"',
    '    pf analyze "your prompt here"',
    '    pf optimize "your prompt" --aggressive',
    '',
  ].join('\n'));
}
