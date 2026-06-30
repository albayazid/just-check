/**
 * Pure helpers for the chat route.
 *
 * Extracted from `./route` so the richest metering/abort/continuation logic
 * is unit-testable without a live AI stream. The route handles HTTP + I/O
 * orchestration; this file holds the pure transformations.
 *
 * Batch D2 extraction (behavior-preserving). See plans/testing.md §7.
 */
import { countTokens } from "gpt-tokenizer";
import type { UIMessage } from "ai";
import type {
  AssistantResponseMetadata,
  StepData,
  TotalUsage,
} from "@/lib/conversation-history";

// ---------------------------------------------------------------------------
// #5 — Routing context
// ---------------------------------------------------------------------------

/**
 * Inspects the message list to decide whether the model route needs
 * image/vision capability. Drives `resolveModelRoute`, so a wrong result here
 * bills the user against the wrong model.
 */
export function detectRoutingContext(
  messages: UIMessage[],
): { hasImages: boolean; hasFiles: boolean } {
  const hasImages = messages.some((m) =>
    m.parts.some((p) => p.type === "file" && p.mediaType.startsWith("image/")),
  );
  const hasFiles = messages.some((m) => m.parts.some((p) => p.type === "file"));
  return { hasImages, hasFiles };
}

// ---------------------------------------------------------------------------
// #6 — Continuation accumulator restore
// ---------------------------------------------------------------------------

export interface AccumulatorState {
  stepCount: number;
  toolCallsCount: number;
  /** Mutable Set — onStepFinish adds tool names to it during streaming. */
  toolsCalled: Set<string>;
  usage: TotalUsage;
  previousStepData: StepData[];
}

/**
 * Restores the accumulated step/tool/usage counters from a prior assistant
 * message's metadata (used when a request is a continuation, e.g. a client-side
 * tool result, rather than a new user turn). Returns zeroed defaults when there
 * is no prior metadata to restore from.
 *
 * The returned `toolsCalled` Set is fresh and mutable so the streaming
 * callbacks can add to it.
 */
export function restoreAccumulators(
  prevMeta: AssistantResponseMetadata | null,
): AccumulatorState {
  const defaults: AccumulatorState = {
    stepCount: 0,
    toolCallsCount: 0,
    toolsCalled: new Set<string>(),
    usage: {
      totalUsedTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      inputTokenDetails: undefined,
      outputTokenDetails: undefined,
    },
    previousStepData: [],
  };

  if (!prevMeta || !prevMeta.totalUsage) {
    return defaults;
  }

  return {
    stepCount: prevMeta.stepCount || 0,
    toolCallsCount: prevMeta.toolCallsCount || 0,
    toolsCalled: new Set(prevMeta.toolsCalled || []),
    usage: { ...prevMeta.totalUsage },
    previousStepData: [...(prevMeta.step_data || [])],
  };
}

// ---------------------------------------------------------------------------
// #2 — Abort-step estimation
// ---------------------------------------------------------------------------

export interface EstimateAbortedStepArgs {
  runningStepOutputText: string;
  systemPrompt: string;
  /** The input messages for the aborted step (`.content` is string or part[]). */
  stepInputMessages: { content: string | { text?: string }[] }[];
}

/**
 * Synthesizes a `StepData` for a step that was running when the stream was
 * aborted — the provider never reported final token counts, so we estimate
 * using gpt-tokenizer (GPT BPE) with a 1.3x over-estimate to avoid
 * under-charging. Pure given its inputs (countTokens is deterministic).
 */
export function estimateAbortedStep({
  runningStepOutputText,
  systemPrompt,
  stepInputMessages,
}: EstimateAbortedStepArgs): StepData {
  const estimatedOutputTokens = Math.ceil(countTokens(runningStepOutputText) * 1.3);
  const inputText =
    systemPrompt +
    stepInputMessages
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) return m.content.map((p) => p.text || "").join("");
        return "";
      })
      .join("");
  const estimatedInputTokens = Math.ceil(countTokens(inputText) * 1.3);

  return {
    timestamp: new Date().toISOString(),
    finishReason: "abort",
    usage: {
      totalTokens: estimatedInputTokens + estimatedOutputTokens,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
    },
    toolCallsCount: 0,
    warnings: [],
    providerMetadata: {},
  };
}

// ---------------------------------------------------------------------------
// #3 — Current-request token resolution
// ---------------------------------------------------------------------------

export type CurrentRequestTokens = {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  // Inner fields are required (matching TotalUsage's detail shape) so the
  // downstream TotalUsage assignment type-checks. The wrappers stay optional.
  inputTokenDetails?: {
    noCacheTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  outputTokenDetails?: {
    textTokens: number;
    reasoningTokens: number;
  };
};

/**
 * Resolves the token usage for the current request. Three-way fallback:
 *   1. The usage streamText reported in its onFinish (covers normal completion)
 *   2. The sum of per-step usage in currentStepData (covers abort scenarios
 *      where streamText's onFinish fires with null usage)
 *   3. undefined (no usage available)
 */
export function resolveCurrentRequestTokens(
  streamOnFinishUsage: CurrentRequestTokens | undefined,
  currentStepData: StepData[],
): CurrentRequestTokens | undefined {
  if (streamOnFinishUsage?.inputTokens != null) {
    return streamOnFinishUsage;
  }
  if (currentStepData.length > 0) {
    return {
      totalTokens: currentStepData.reduce((sum, s) => sum + (s.usage.totalTokens || 0), 0),
      inputTokens: currentStepData.reduce((sum, s) => sum + (s.usage.inputTokens || 0), 0),
      outputTokens: currentStepData.reduce((sum, s) => sum + (s.usage.outputTokens || 0), 0),
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// #4 — Token-detail merge helpers (refactored from the two IIFEs)
// ---------------------------------------------------------------------------

export function mergeInputTokenDetails(
  current: CurrentRequestTokens["inputTokenDetails"],
  accumulated: TotalUsage["inputTokenDetails"],
): { noCacheTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | undefined {
  if (!current && !accumulated) return undefined;
  return {
    noCacheTokens: (accumulated?.noCacheTokens || 0) + (current?.noCacheTokens || 0),
    cacheReadTokens: (accumulated?.cacheReadTokens || 0) + (current?.cacheReadTokens || 0),
    cacheWriteTokens: (accumulated?.cacheWriteTokens || 0) + (current?.cacheWriteTokens || 0),
  };
}

export function mergeOutputTokenDetails(
  current: CurrentRequestTokens["outputTokenDetails"],
  accumulated: TotalUsage["outputTokenDetails"],
): { textTokens: number; reasoningTokens: number } | undefined {
  if (!current && !accumulated) return undefined;
  return {
    textTokens: (accumulated?.textTokens || 0) + (current?.textTokens || 0),
    reasoningTokens: (accumulated?.reasoningTokens || 0) + (current?.reasoningTokens || 0),
  };
}

// ---------------------------------------------------------------------------
// #1 — Server metadata assembly
// ---------------------------------------------------------------------------

export interface AssembleServerMetadataArgs {
  UIModelId: string;
  internalModelId: string;
  provider: string;
  conversationMode: string | null;
  hasFiles: boolean;
  isAborted: boolean;
  finishReason: string | undefined;
  accumulatedUsage: TotalUsage;
  accumulatedStepCount: number;
  accumulatedToolCallsCount: number;
  accumulatedToolsCalled: Set<string>;
  currentRequestTokens: CurrentRequestTokens | undefined;
  previousStepData: StepData[];
  currentStepData: StepData[];
}

/**
 * Builds the server-only `AssistantResponseMetadata` object that gets persisted
 * with the assistant message. Combines accumulated (continuation) counters with
 * the current request's step data and token usage.
 */
export function assembleServerMetadata(
  args: AssembleServerMetadataArgs,
): AssistantResponseMetadata {
  const {
    UIModelId,
    internalModelId,
    provider,
    conversationMode,
    hasFiles,
    isAborted,
    finishReason,
    accumulatedUsage,
    accumulatedStepCount,
    accumulatedToolCallsCount,
    accumulatedToolsCalled,
    currentRequestTokens,
    previousStepData,
    currentStepData,
  } = args;

  return {
    model_data: { UIModelId, internalModelId, provider },
    mode: conversationMode,
    hasAttachments: hasFiles,
    finishReason: isAborted ? "abort" : finishReason || "unknown",
    totalUsage: {
      totalUsedTokens:
        accumulatedUsage.totalUsedTokens + (currentRequestTokens?.totalTokens || 0),
      totalInputTokens:
        accumulatedUsage.totalInputTokens + (currentRequestTokens?.inputTokens || 0),
      totalOutputTokens:
        accumulatedUsage.totalOutputTokens + (currentRequestTokens?.outputTokens || 0),
      inputTokenDetails: mergeInputTokenDetails(
        currentRequestTokens?.inputTokenDetails,
        accumulatedUsage.inputTokenDetails,
      ),
      outputTokenDetails: mergeOutputTokenDetails(
        currentRequestTokens?.outputTokenDetails,
        accumulatedUsage.outputTokenDetails,
      ),
    },
    stepCount: accumulatedStepCount + currentStepData.length,
    toolCallsCount:
      accumulatedToolCallsCount +
      currentStepData.reduce((acc, step) => acc + step.toolCallsCount, 0),
    toolsCalled: Array.from(accumulatedToolsCalled),
    step_data: [...previousStepData, ...currentStepData],
  };
}
