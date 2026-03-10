import type { PlatformAdapter } from './types.js';

const SELECTORS = {
  editor: '.ProseMirror[contenteditable="true"], div[contenteditable="true"].is-editor-empty, div[contenteditable="true"][data-placeholder]',
  messageContainer: '[data-testid="user-message"], [data-testid="assistant-message"], .font-claude-message',
  inputArea: '.composer-parent, fieldset, form',
};

let inputHandler: (() => void) | null = null;
let inputObserver: MutationObserver | null = null;

export const claudeAdapter: PlatformAdapter = {
  name: 'claude',

  getInputElement(): Element | null {
    return document.querySelector(SELECTORS.editor);
  },

  getInputText(): string {
    const el = this.getInputElement();
    if (!el) return '';
    return el.textContent ?? '';
  },

  setInputText(text: string): void {
    const el = this.getInputElement();
    if (!el) return;
    // ProseMirror uses contenteditable paragraphs
    const p = document.createElement('p');
    p.textContent = text;
    el.replaceChildren(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  },

  getInjectionPoint(): Element | null {
    const input = this.getInputElement();
    if (!input) return null;
    return input.closest(SELECTORS.inputArea) ?? input.parentElement;
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

    // ProseMirror uses contenteditable
    inputObserver = new MutationObserver(debounced);
    inputObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

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

export type { PlatformAdapter } from './types.js';
