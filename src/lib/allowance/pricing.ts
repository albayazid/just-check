import { allInternalModels } from '@/lib/models';

// TODO: P3. Update ModelPricing to handle new detailed pricing instead of such input/output simple pricing.
export interface ModelPricing {
  input: number;   // USD per 1M tokens
  output: number;  // USD per 1M tokens
}

/**
 * Retrieves pricing for a given provider and model ID.
 * Looks up in the internal models registry.
 *
 * @param provider - The model provider (e.g., 'openrouter')
 * @param modelId - The model's technical ID (e.g., 'deepseek/deepseek-v4-flash-0731')
 * @returns ModelPricing if found, otherwise null
 */
export function getModelPricing(provider: string, modelId: string): ModelPricing | null {
  const model = allInternalModels.find(m => m.provider === provider && m.id === modelId);
  if (!model) {
    return null;
  }
  return {
    input: model.pricing.input,
    output: model.pricing.output,
  };
}
