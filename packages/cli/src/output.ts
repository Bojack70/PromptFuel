import fs from 'fs';

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
