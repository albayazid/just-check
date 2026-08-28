import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

export type ModelProvider = 'openrouter';

export type Modality = 'text' | 'image' | 'audio' | 'video';

/**
 * Provider-specific metadata for model configuration.
 * This is used to pass additional options to the AI SDK provider.
 * For OpenRouter, this is typically used for reasoning/thinking mode.
 */
export type ProviderOptions = SharedV3ProviderOptions;

// Model interface for internal models' detailed information. Optional fields are currently mainly for future use. 
export interface Model {
    /** The vocal name */
    name: string;
    /** The unique identifier for the model (also used by AI SDK) */
    id: string;
    /** The model provider name */
    provider: ModelProvider;
    /** Maximum context length in tokens */
    contextLength?: number;

    // Pricing (usually per 1M tokens for consistency, or specify per 1k)
    pricing: {
        input: number;
        output: number;
        cachedInput?: number;
        cachedOutput?: number;
        reasoning?: number;
        cachedReasoning?: number;
    };

    capabilities?: {
        /** Whether the model has native reasoning capabilities (like O1 or DeepSeek R1) */
        canReason: boolean;
        /** Whether the model supports tool calling */
        supportsToolCalling: boolean;
        /** Whether the model supports file uploads (PDF, etc.) */
        supportsFiles: boolean;
    };

    inputModalities?: Modality[];
    outputModalities?: Modality[];

    /** Friendly description of what this model is best for */
    description?: string;

    /**
     * Optional provider-specific metadata.
     * Used to pass additional options to the AI SDK provider.
     */
    providerMetadata?: ProviderOptions;
}

export interface UIModel {
    /** The name shown to the user in the model selector */
    name: string;
    /** The internal ID for this UI persona (e.g., "fast", "thinker") */
    id: string;
    /** A user-friendly description of what this persona is good for */
    description: string;
}
