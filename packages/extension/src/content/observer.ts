export type ObserverCallback = (element: Element) => void;

interface ObserverConfig {
  selector: string;
  onFound: ObserverCallback;
  onRemoved?: ObserverCallback;
  parent?: Element;
}

export class DOMObserver {
  private observer: MutationObserver | null = null;
  private configs: ObserverConfig[] = [];

  constructor() {
    this.observer = new MutationObserver(this.handleMutations.bind(this));
  }

  watch(config: ObserverConfig): void {
    this.configs.push(config);

    // Check if element already exists
    const parent = config.parent ?? document;
    const existing = parent.querySelector(config.selector);
    if (existing) {
      config.onFound(existing);
    }
  }

  start(target?: Element): void {
    const root = target ?? document.body;
    // Only observe childList and attributes on the body — NOT characterData,
    // which fires on every keystroke/streaming token across the entire page.
    // Input text changes are handled by platform adapters' own listeners.
    this.observer?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'contenteditable'],
    });
  }

  stop(): void {
    this.observer?.disconnect();
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      // Check added nodes
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          this.checkElement(node);
        }
      }

      // Check removed nodes
      for (const node of mutation.removedNodes) {
        if (node instanceof Element) {
          for (const config of this.configs) {
            if (node.matches(config.selector) || node.querySelector(config.selector)) {
              config.onRemoved?.(node);
            }
          }
        }
      }

      // For characterData changes, check parent element
      if (mutation.type === 'characterData' && mutation.target.parentElement) {
        this.checkElement(mutation.target.parentElement);
      }
    }
  }

  private checkElement(element: Element): void {
    for (const config of this.configs) {
      if (element.matches(config.selector)) {
        config.onFound(element);
      }
      const child = element.querySelector(config.selector);
      if (child) {
        config.onFound(child);
      }
    }
  }
}
