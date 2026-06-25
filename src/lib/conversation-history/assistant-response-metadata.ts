/**
 * Assistant Response Metadata Types
 *
 * Defines the structure for AI response metadata stored in message.metadata.
 * Includes model info, token usage, step data, and tool call tracking.
 */

/**
 * Model information for the AI response
 */
export interface ModelData {
  /** The UI-facing model ID (e.g., 'gpt-4', 'claude-sonnet-4-5') */
  UIModelId: string;
  /** The actual technical model ID used from the provider */
  internalModelId: string;
  /** The provider name (e.g., 'openai', 'anthropic') */
  provider: string;
}

/**
 * Token usage breakdown for a step or total response (AI SDK v6)
 */
export interface StepUsage {
  /** Total tokens for this step */
  totalTokens: number;
  /** Input/prompt tokens */
  inputTokens: number;
  /** Output/completion tokens */
  outputTokens: number;

  // AI SDK v6 detailed breakdowns (optional)
  inputTokenDetails?: {
    /** Non-cached input tokens */
    noCacheTokens?: number;
    /** Cached tokens read */
    cacheReadTokens?: number;
    /** Cached tokens written */
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    /** Output text tokens */
    textTokens?: number;
    /** Reasoning tokens (moved from top-level in v5) */
    reasoningTokens?: number;
  };
}

/**
 * Complete token usage for the entire response (AI SDK v6)
 */
export interface TotalUsage {
  // Primary aggregate totals (maps directly to AI SDK v6 top-level fields)
  /** Sum of all tokens used */
  totalUsedTokens: number;
  /** Total input/prompt tokens */
  totalInputTokens: number;
  /** Total output/completion tokens */
  totalOutputTokens: number;

  // AI SDK v6 detailed breakdowns (optional)
  inputTokenDetails?: {
    noCacheTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  outputTokenDetails?: {
    textTokens: number;
    reasoningTokens: number;
  };
}

/**
 * Metadata for a single step in the AI response
 */
export interface StepData {
  /** ISO timestamp when this step finished */
  timestamp: string;
  /** Why the step finished (stop, length, tool-calls, etc.) */
  finishReason: string;
  /** Token usage for this step */
  usage: StepUsage;
  /** Number of tool calls in this step */
  toolCallsCount: number;
  /** Warnings from the provider */
  warnings: any[];
  /** Provider-specific metadata */
  providerMetadata: Record<string, unknown>;
}

/**
 * Complete assistant response metadata stored in message.metadata
 * Extends MessageMetadata with a full index signature to be assignable to the generic metadata type.
 */
export interface AssistantResponseMetadata {
  /** Information about the model used */
  model_data: ModelData;
  /** Active chat mode when this response was generated (null = Default). Persisted per-message. */
  mode?: string | null;
  /** Whether the response has file attachments */
  hasAttachments: boolean;
  /** Why the response finished */
  finishReason: string;
  /** Total token usage for the entire response */
  totalUsage: TotalUsage;
  /** Number of steps executed */
  stepCount: number;
  /** Total number of tool calls */
  toolCallsCount: number;
  /** List of unique tool names called */
  toolsCalled: string[];
  /** Array of step-by-step metadata */
  step_data: StepData[];

  // Index signature to be compatible with MessageMetadata
  [key: string]: unknown;
}

/**
 * Input for creating assistant response metadata
 */
export interface CreateAssistantMetadataInput {
  UIModelId: string;
  internalModelId: string;
  provider: string;
  hasAttachments?: boolean;
}
