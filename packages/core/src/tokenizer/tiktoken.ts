import { encodingForModel, type TiktokenModel } from 'js-tiktoken';

const encoderCache = new Map<string, ReturnType<typeof encodingForModel>>();

const MODEL_ALIASES: Record<string, TiktokenModel> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o',
  'gpt-4-turbo': 'gpt-4-turbo',
  'gpt-4': 'gpt-4',
  'gpt-3.5-turbo': 'gpt-3.5-turbo',
  'o1': 'gpt-4o',
  'o1-mini': 'gpt-4o',
  'o1-preview': 'gpt-4o',
  'o3': 'gpt-4o',
  'o3-mini': 'gpt-4o',
};

function getEncoder(model: string) {
  const tiktokenModel = MODEL_ALIASES[model] ?? 'gpt-4o';
  if (!encoderCache.has(tiktokenModel)) {
    encoderCache.set(tiktokenModel, encodingForModel(tiktokenModel));
  }
  return encoderCache.get(tiktokenModel)!;
}

export function countOpenAITokens(text: string, model: string): number {
  if (!text) return 0;
  const encoder = getEncoder(model);
  return encoder.encode(text).length;
}
