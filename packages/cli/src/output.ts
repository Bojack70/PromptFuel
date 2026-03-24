import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Write output directly to the controlling terminal (/dev/tty) when stdout is
 * being captured (e.g. by Claude Code's bash tool). This prevents long output
 * from being collapsed in the chat interface.
 *
 * Falls back to process.stdout when /dev/tty is unavailable (CI, headless).
 */
export function ttyWrite(text: string): void {
  if (!process.stdout.isTTY) {
    try {
      const fd = fs.openSync('/dev/tty', 'w');
      fs.writeSync(fd, text);
      fs.closeSync(fd);
      return;
    } catch { /* /dev/tty not available — fall through */ }
  }
  process.stdout.write(text);
}

/**
 * Check if we're running in a piped/captured context (e.g. Claude Code bash tool).
 */
export function isCapturedContext(): boolean {
  return !process.stdout.isTTY;
}

/**
 * Write a full report to a temp file and output just the file path to stdout.
 * In Claude Code, Claude sees the file path as the bash result and reads
 * the file automatically — presenting its contents as text that never collapses.
 *
 * Returns the file path written, or null if in TTY mode (caller should
 * render inline instead).
 */
export function writeReportFile(reportName: string, content: string): string | null {
  if (process.stdout.isTTY) return null;

  const tmpDir = path.join(os.tmpdir(), 'promptfuel');
  fs.mkdirSync(tmpDir, { recursive: true });

  const filePath = path.join(tmpDir, `${reportName}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}
