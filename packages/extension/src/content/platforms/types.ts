export interface PlatformAdapter {
  name: string;
  getInputText(): string;
  setInputText(text: string): void;
  getInputElement(): Element | null;
  getInjectionPoint(): Element | null;
  getConversationMessages(): string[];
  attachInputListener(callback: (text: string) => void): void;
  detachInputListener(): void;
}
