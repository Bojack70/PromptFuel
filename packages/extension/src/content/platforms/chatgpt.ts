import type { PlatformAdapter } from './types.js';
export type { PlatformAdapter } from './types.js';

const SELECTORS = {
  textarea: '#prompt-textarea, textarea[data-id="root"], div[contenteditable="true"][id="prompt-textarea"]',
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
  messageContainer: '[data-message-author-role]',
  inputArea: 'form, .relative.flex',
};

let inputHandler: (() => void) | null = null;
let inputObserver: MutationObserver | null = null;

export const chatgptAdapter: PlatformAdapter = {
  name: 'chatgpt',

  getInputElement(): Element | null {
    return document.querySelector(SELECTORS.textarea);
  },

  getInputText(): string {
    const el = this.getInputElement();
    if (!el) return '';

    if (el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    // ContentEditable div
    return el.textContent ?? '';
  },

  setInputText(text: string): void {
    const el = this.getInputElement();
    if (!el) return;

    if (el instanceof HTMLTextAreaElement) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // ContentEditable div
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  },

  getInjectionPoint(): Element | null {
    const input = this.getInputElement();
    if (!input) return null;
    // Inject near the form/input area parent
    return input.closest('form') ?? input.parentElement;
  },

  getConversationMessages(): string[] {
    const messages: string[] = [];
    const elements = document.querySelectorAll(SELECTORS.messageContainer);
    for (const el of elements) {
      const text = el.textContent?.trim();
      if (text) messages.push(text);
    }
    return messages;
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

    if (el instanceof HTMLTextAreaElement) {
      inputHandler = debounced;
      el.addEventListener('input', debounced);
    } else {
      // ContentEditable — use MutationObserver
      inputObserver = new MutationObserver(debounced);
      inputObserver.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      // Also listen for input events
      inputHandler = debounced;
      el.addEventListener('input', debounced);
    }
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
