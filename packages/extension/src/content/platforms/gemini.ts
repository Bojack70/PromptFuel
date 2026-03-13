import type { PlatformAdapter } from './types.js';

let inputHandler: (() => void) | null = null;
let inputObserver: MutationObserver | null = null;

export const geminiAdapter: PlatformAdapter = {
  name: 'gemini',

  getInputElement(): Element | null {
    // Gemini uses a rich text editor (contenteditable)
    return (
      document.querySelector('div[contenteditable="true"][aria-label]') ??
      document.querySelector('rich-textarea div[contenteditable="true"]') ??
      document.querySelector('div[contenteditable="true"].ql-editor') ??
      document.querySelector('div[contenteditable="true"]')
    );
  },

  getInputText(): string {
    const el = this.getInputElement();
    return el?.textContent ?? '';
  },

  setInputText(text: string): void {
    const el = this.getInputElement();
    if (!el) return;
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  },

  getInjectionPoint(): Element | null {
    const el = this.getInputElement();
    return el?.closest('form') ?? el?.parentElement ?? null;
  },

  getConversationMessages(): string[] {
    const messages: string[] = [];
    const elements = document.querySelectorAll(
      '[data-message-author-role], model-response, user-query'
    );
    for (const el of elements) {
      const text = el.textContent?.trim();
      if (text) messages.push(text);
    }
    return messages;
  },

  getSelectedModel(): string | null {
    // Gemini's model button: data-test-id="bard-mode-menu-button"
    // Label span shows short text like "Pro", "Flash", "2.5 Flash", "3.1 Pro", etc.
    const btn = document.querySelector('[data-test-id="bard-mode-menu-button"]');
    if (btn) {
      const label = btn.querySelector('.logo-pill-label-container span, [data-test-id="logo-pill-label-container"] span');
      const text = (label ?? btn).textContent?.toLowerCase().trim() ?? '';
      // Order matters: match more specific strings first
      if (text.includes('3.1 pro') || text === '3.1 pro') return 'gemini-3.1-pro';
      if (text.includes('3 flash') || text === '3 flash') return 'gemini-3-flash';
      if (text.includes('2.5 flash lite') || text.includes('2.5 flash-lite')) return 'gemini-2.5-flash-lite';
      if (text.includes('2.5 flash')) return 'gemini-2.5-flash';
      if (text.includes('2.5 pro')) return 'gemini-2.5-pro';
      if (text.includes('2.0 flash lite') || text.includes('flash lite')) return 'gemini-2.0-flash-lite';
      if (text.includes('2.0 flash') || text === 'flash') return 'gemini-2.0-flash';
      if (text.includes('1.5 flash')) return 'gemini-1.5-flash';
      if (text.includes('1.5 pro')) return 'gemini-1.5-pro';
      if (text === 'pro') return 'gemini-3.1-pro'; // default "Pro" = latest
    }
    return null;
  },

  attachInputListener(callback: (text: string) => void): void {
    const el = this.getInputElement();
    if (!el) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const debounced = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        callback(this.getInputText());
      }, 300);
    };

    inputObserver = new MutationObserver(debounced);
    inputObserver.observe(el, { childList: true, subtree: true, characterData: true });
    inputHandler = debounced;
    el.addEventListener('input', debounced);
  },

  detachInputListener(): void {
    const el = this.getInputElement();
    if (el && inputHandler) {
      el.removeEventListener('input', inputHandler);
      inputHandler = null;
    }
    if (inputObserver) {
      inputObserver.disconnect();
      inputObserver = null;
    }
  },
};
