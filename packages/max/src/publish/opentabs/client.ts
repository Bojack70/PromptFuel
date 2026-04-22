/**
 * OpenTabs client — shells out to the `opentabs` CLI to invoke browser tools.
 *
 * Why subprocess instead of raw HTTP/MCP: keeps Max's "zero runtime npm deps"
 * constraint, reuses OpenTabs' own auth/permission handling, and avoids
 * implementing JSON-RPC ourselves. Latency of ~100ms/call is fine for
 * posting a few times per day.
 *
 * Requires `opentabs start` to be running locally (http://127.0.0.1:9515).
 */

import { spawn } from 'node:child_process';

export interface Tab {
  id: number;
  title: string;
  url: string;
  active?: boolean;
  windowId?: number;
  groupId?: number;
  connectionId?: string;
}

/** Raw tool invocation. Throws if the CLI exits non-zero or output isn't JSON. */
export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn('opentabs', ['tool', 'call', name, JSON.stringify(args)], {
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => reject(new Error(`[opentabs] spawn failed: ${err.message}`)));

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`[opentabs] ${name} exit=${code}: ${stderr || stdout}`));
      }
      const trimmed = stdout.trim();
      if (!trimmed) return resolve(undefined as T);
      try {
        resolve(JSON.parse(trimmed) as T);
      } catch {
        // Some tools return no output on success — return the raw string
        resolve(trimmed as unknown as T);
      }
    });
  });
}

/** List all tabs across all connected browser profiles. */
export function listTabs(): Promise<Tab[]> {
  return callTool<Tab[]>('browser_list_tabs');
}

/** Open a new tab at the given URL. Returns the new tab's metadata. */
export function openTab(url: string, connectionId?: string): Promise<Tab> {
  return callTool<Tab>('browser_open_tab', connectionId ? { url, connectionId } : { url });
}

export function navigateTab(tabId: number, url: string): Promise<Tab> {
  return callTool<Tab>('browser_navigate_tab', { tabId, url });
}

export function focusTab(tabId: number): Promise<void> {
  return callTool('browser_focus_tab', { tabId });
}

export function closeTab(tabId: number): Promise<void> {
  return callTool('browser_close_tab', { tabId });
}

export function typeText(tabId: number, selector: string, text: string, clear = true): Promise<void> {
  return callTool('browser_type_text', { tabId, selector, text, clear });
}

export function clickElement(tabId: number, selector: string): Promise<{ tag: string; text: string }> {
  return callTool('browser_click_element', { tabId, selector });
}

export function pressKey(
  tabId: number,
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
  selector?: string,
): Promise<void> {
  // OpenTabs server expects `modifiers` as a nested object — NOT spread at top level.
  // Verified by reading platform/browser-extension/src/browser-commands/key-press-command.ts
  // (server reads `params.modifiers.meta`, etc.). Previous spread version silently
  // dropped all modifiers so e.g. pressKey('v', {meta:true}) became plain 'v'.
  const args: Record<string, unknown> = { tabId, key, modifiers };
  if (selector) args.selector = selector;
  return callTool('browser_press_key', args);
}

export function waitForElement(tabId: number, selector: string, timeoutMs = 15000, visible = true): Promise<void> {
  return callTool('browser_wait_for_element', { tabId, selector, timeout: timeoutMs, visible });
}

export function getTabInfo(tabId: number): Promise<{ id: number; url: string; title: string; status: string }> {
  return callTool('browser_get_tab_info', { tabId });
}

/**
 * Execute JavaScript in a tab. Use `return X;` at the top level to get a value
 * back — the tool wraps `code` in a function body, so IIFE patterns like
 * `(function(){ return X })();` evaluate X but the wrapper still returns undefined.
 *
 * OpenTabs (v0.0.102) responds with `{value: {value: X}}` — we unwrap both layers
 * here so callers see T directly. If the response shape drifts, fall back to the
 * raw payload.
 */
export async function executeScript<T = unknown>(tabId: number, code: string): Promise<T> {
  const raw = await callTool<unknown>('browser_execute_script', { tabId, code });
  // Unwrap {value: {value: X}} → X. Tolerate {value: X} or X directly.
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const inner = (raw as { value: unknown }).value;
    if (inner && typeof inner === 'object' && 'value' in (inner as Record<string, unknown>)) {
      return (inner as { value: T }).value;
    }
    return inner as T;
  }
  return raw as T;
}

export interface QueryElement {
  tagName: string;
  text: string;
  attributes: Record<string, string>;
}

/**
 * OpenTabs returns `{ count, elements }` — we unwrap and return just the array
 * because callers always want the elements list.
 */
export async function queryElements(
  tabId: number,
  selector: string,
  attrs: string[] = [],
  limit = 20,
): Promise<QueryElement[]> {
  const res = await callTool<{ count: number; elements: QueryElement[] }>('browser_query_elements', {
    tabId,
    selector,
    attributes: attrs,
    limit,
  });
  return res?.elements ?? [];
}

/** Sleep for ms — useful between actions to mimic human timing. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sleep a random duration in [minMs, maxMs]. */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return sleep(ms);
}
