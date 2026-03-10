import { countTokens, calculateCost, formatCost, monitorContext, type Message } from '@promptfuel/core';

export interface MiddlewareOptions {
  model?: string;
  warnAt?: number; // 0-1 ratio, default 0.75
  headerPrefix?: string;
}

interface RequestLike {
  body?: { messages?: Message[]; prompt?: string; model?: string };
}

interface ResponseLike {
  setHeader?(name: string, value: string): void;
  set?(name: string, value: string): void;
}

type NextFunction = () => void | Promise<void>;

export function promptFuelMiddleware(options: MiddlewareOptions = {}) {
  const {
    model: defaultModel = 'gpt-4o',
    warnAt = 0.75,
    headerPrefix = 'X-PromptFuel',
  } = options;

  return (req: RequestLike, res: ResponseLike, next: NextFunction) => {
    const body = req.body;
    if (!body) {
      next();
      return;
    }

    const model = body.model ?? defaultModel;
    const setHeader = (name: string, value: string) => {
      if (res.setHeader) res.setHeader(name, value);
      else if (res.set) res.set(name, value);
    };

    // Single prompt analysis
    if (body.prompt) {
      const tokens = countTokens(body.prompt, model);
      const cost = calculateCost(tokens.inputTokens, tokens.estimatedOutputTokens, model);

      setHeader(`${headerPrefix}-Input-Tokens`, String(tokens.inputTokens));
      setHeader(`${headerPrefix}-Estimated-Output-Tokens`, String(tokens.estimatedOutputTokens));
      setHeader(`${headerPrefix}-Estimated-Cost`, formatCost(cost.totalCost));
    }

    // Conversation context monitoring
    if (body.messages && Array.isArray(body.messages)) {
      const status = monitorContext(body.messages, model);

      setHeader(`${headerPrefix}-Context-Tokens`, String(status.totalTokens));
      setHeader(`${headerPrefix}-Context-Percent`, String(status.percentUsed));
      setHeader(`${headerPrefix}-Context-Warning`, status.warning);
      setHeader(`${headerPrefix}-Context-Remaining`, String(status.remainingTokens));

      if (status.percentUsed / 100 >= warnAt) {
        setHeader(`${headerPrefix}-Context-Alert`, `Context ${status.percentUsed}% full`);
      }
    }

    next();
  };
}
