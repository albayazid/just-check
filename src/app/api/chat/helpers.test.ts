import { describe, it, expect } from "vitest";
import { countTokens } from "gpt-tokenizer";
import {
  detectRoutingContext,
  restoreAccumulators,
  estimateAbortedStep,
  resolveCurrentRequestTokens,
  mergeInputTokenDetails,
  mergeOutputTokenDetails,
  assembleServerMetadata,
  type AssembleServerMetadataArgs,
} from "./helpers";
import type { StepData, TotalUsage } from "@/lib/conversation-history";
import { buildAssistantResponseMetadata } from "@/test/factories";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function uiMessage(parts: unknown[]) {
  return { id: "m1", role: "user", parts, metadata: {} } as never;
}
function textPart(text = "hi") {
  return { type: "text", text };
}
function imageFile(mediaType = "image/png") {
  return { type: "file", mediaType, url: `attachment://550e8400-e29b-41d4-a716-446655440000` };
}
function docFile(mediaType = "application/pdf") {
  return { type: "file", mediaType, url: `attachment://550e8400-e29b-41d4-a716-446655440000` };
}

function stepData(overrides: Partial<StepData> = {}): StepData {
  return {
    timestamp: "2026-06-28T00:00:00Z",
    finishReason: "stop",
    usage: { totalTokens: 100, inputTokens: 80, outputTokens: 20 },
    toolCallsCount: 0,
    warnings: [],
    providerMetadata: {},
    ...overrides,
  };
}

function totalUsage(overrides: Partial<TotalUsage> = {}): TotalUsage {
  return {
    totalUsedTokens: 500,
    totalInputTokens: 400,
    totalOutputTokens: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// #5 — detectRoutingContext
// ---------------------------------------------------------------------------

describe("detectRoutingContext", () => {
  it("returns neither flag for a text-only message", () => {
    const { hasImages, hasFiles } = detectRoutingContext([uiMessage([textPart()])]);
    expect(hasImages).toBe(false);
    expect(hasFiles).toBe(false);
  });

  it("detects an image file (sets both hasImages and hasFiles)", () => {
    const { hasImages, hasFiles } = detectRoutingContext([uiMessage([imageFile("image/png")])]);
    expect(hasImages).toBe(true);
    expect(hasFiles).toBe(true);
  });

  it("detects a non-image file (hasFiles only)", () => {
    const { hasImages, hasFiles } = detectRoutingContext([uiMessage([docFile()])]);
    expect(hasImages).toBe(false);
    expect(hasFiles).toBe(true);
  });

  it("matches any image/* mediaType prefix", () => {
    for (const mt of ["image/jpeg", "image/webp", "image/gif"]) {
      expect(detectRoutingContext([uiMessage([imageFile(mt)])]).hasImages, mt).toBe(true);
    }
  });

  it("scans across multiple messages", () => {
    const ctx = detectRoutingContext([
      uiMessage([textPart()]),
      uiMessage([docFile()]),
      uiMessage([imageFile()]),
    ]);
    expect(ctx.hasImages).toBe(true);
    expect(ctx.hasFiles).toBe(true);
  });

  it("returns false for an empty message list", () => {
    const ctx = detectRoutingContext([]);
    expect(ctx.hasImages).toBe(false);
    expect(ctx.hasFiles).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #6 — restoreAccumulators
// ---------------------------------------------------------------------------

describe("restoreAccumulators", () => {
  it("returns zeroed defaults when prevMeta is null", () => {
    const state = restoreAccumulators(null);
    expect(state.stepCount).toBe(0);
    expect(state.toolCallsCount).toBe(0);
    expect(state.toolsCalled.size).toBe(0);
    expect(state.usage).toEqual({
      totalUsedTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      inputTokenDetails: undefined,
      outputTokenDetails: undefined,
    });
    expect(state.previousStepData).toEqual([]);
  });

  it("returns zeroed defaults when prevMeta lacks totalUsage", () => {
    const state = restoreAccumulators(buildAssistantResponseMetadata({ totalUsage: undefined } as never));
    expect(state.stepCount).toBe(0);
    expect(state.usage.totalUsedTokens).toBe(0);
  });

  it("restores counters from a populated prevMeta", () => {
    const prev = buildAssistantResponseMetadata({
      stepCount: 3,
      toolCallsCount: 5,
      toolsCalled: ["web_search", "view_website"],
      totalUsage: totalUsage({ totalUsedTokens: 999 }),
      step_data: [stepData({ finishReason: "stop" })],
    });
    const state = restoreAccumulators(prev);
    expect(state.stepCount).toBe(3);
    expect(state.toolCallsCount).toBe(5);
    expect(state.toolsCalled).toEqual(new Set(["web_search", "view_website"]));
    expect(state.usage.totalUsedTokens).toBe(999);
    expect(state.previousStepData).toHaveLength(1);
  });

  it("returns a fresh mutable Set (adding to it does not mutate the input)", () => {
    const prev = buildAssistantResponseMetadata({ toolsCalled: ["web_search"] });
    const state = restoreAccumulators(prev);
    state.toolsCalled.add("new_tool");
    expect(state.toolsCalled.has("new_tool")).toBe(true);
    expect(prev.toolsCalled).not.toContain("new_tool");
  });

  it("copies totalUsage (not the same reference)", () => {
    const prev = buildAssistantResponseMetadata({ totalUsage: totalUsage({ totalUsedTokens: 42 }) });
    const state = restoreAccumulators(prev);
    state.usage.totalUsedTokens = 0;
    expect(prev.totalUsage!.totalUsedTokens).toBe(42);
  });

  it("copies previousStepData (not the same reference)", () => {
    const sd = stepData();
    const prev = buildAssistantResponseMetadata({ step_data: [sd] });
    const state = restoreAccumulators(prev);
    state.previousStepData.push(stepData({ finishReason: "length" }));
    expect(prev.step_data).toHaveLength(1);
  });

  it("falls back to 0 for missing stepCount/toolCallsCount", () => {
    const prev = buildAssistantResponseMetadata({ stepCount: undefined, toolCallsCount: undefined });
    const state = restoreAccumulators(prev);
    expect(state.stepCount).toBe(0);
    expect(state.toolCallsCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #2 — estimateAbortedStep
// ---------------------------------------------------------------------------

describe("estimateAbortedStep", () => {
  it("returns a StepData with finishReason 'abort' and zero tool calls", () => {
    const sd = estimateAbortedStep({
      runningStepOutputText: "some output",
      systemPrompt: "system",
      stepInputMessages: [{ content: "user input" }],
    });
    expect(sd.finishReason).toBe("abort");
    expect(sd.toolCallsCount).toBe(0);
    expect(sd.warnings).toEqual([]);
    expect(sd.providerMetadata).toEqual({});
    expect(sd.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("estimates output tokens as ceil(countTokens(output) * 1.3)", () => {
    const output = "The quick brown fox jumps over the lazy dog.";
    const sd = estimateAbortedStep({
      runningStepOutputText: output,
      systemPrompt: "",
      stepInputMessages: [],
    });
    const expected = Math.ceil(countTokens(output) * 1.3);
    expect(sd.usage.outputTokens).toBe(expected);
  });

  it("estimates input tokens from systemPrompt + stepInputMessages concatenation", () => {
    const system = "You are helpful.";
    const sd = estimateAbortedStep({
      runningStepOutputText: "",
      systemPrompt: system,
      stepInputMessages: [
        { content: "first message" },
        { content: [{ text: "part1 " }, { text: "part2" }] },
      ],
    });
    // inputText = system + "first message" + "part1 part2"
    const expectedInput = Math.ceil(countTokens(system + "first messagepart1 part2") * 1.3);
    expect(sd.usage.inputTokens).toBe(expectedInput);
  });

  it("totalTokens = inputTokens + outputTokens", () => {
    const sd = estimateAbortedStep({
      runningStepOutputText: "hello world",
      systemPrompt: "system prompt",
      stepInputMessages: [{ content: "user msg" }],
    });
    expect(sd.usage.totalTokens).toBe(sd.usage.inputTokens + sd.usage.outputTokens);
  });

  it("handles empty output and empty input (zero-ish estimates)", () => {
    const sd = estimateAbortedStep({
      runningStepOutputText: "",
      systemPrompt: "",
      stepInputMessages: [],
    });
    expect(sd.usage.outputTokens).toBe(0);
    expect(sd.usage.inputTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #3 — resolveCurrentRequestTokens
// ---------------------------------------------------------------------------

describe("resolveCurrentRequestTokens", () => {
  it("returns streamOnFinishUsage verbatim when inputTokens is non-null", () => {
    const usage = { totalTokens: 300, inputTokens: 200, outputTokens: 100 };
    expect(resolveCurrentRequestTokens(usage, [])).toBe(usage);
  });

  it("returns streamOnFinishUsage when inputTokens is 0 (non-null check)", () => {
    const usage = { totalTokens: 100, inputTokens: 0, outputTokens: 100 };
    expect(resolveCurrentRequestTokens(usage, [])).toBe(usage);
  });

  it("sums per-step usage when streamOnFinishUsage is absent but steps exist", () => {
    const steps = [
      stepData({ usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10 } }),
      stepData({ usage: { totalTokens: 50, inputTokens: 40, outputTokens: 10 } }),
    ];
    const result = resolveCurrentRequestTokens(undefined, steps);
    expect(result).toEqual({ totalTokens: 80, inputTokens: 60, outputTokens: 20 });
  });

  it("returns undefined when streamOnFinishUsage is absent and no steps", () => {
    expect(resolveCurrentRequestTokens(undefined, [])).toBeUndefined();
  });

  it("prefers streamOnFinishUsage over step sum even when steps exist", () => {
    const usage = { totalTokens: 999, inputTokens: 1, outputTokens: 998 };
    const steps = [stepData({ usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0 } })];
    expect(resolveCurrentRequestTokens(usage, steps)).toBe(usage);
  });
});

// ---------------------------------------------------------------------------
// #4 — mergeTokenDetails
// ---------------------------------------------------------------------------

describe("mergeInputTokenDetails", () => {
  it("adds corresponding fields when both are present", () => {
    const result = mergeInputTokenDetails(
      { noCacheTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 3 },
      { noCacheTokens: 20, cacheReadTokens: 15, cacheWriteTokens: 7 },
    );
    expect(result).toEqual({ noCacheTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 10 });
  });

  it("returns the accumulated values when current is undefined", () => {
    expect(mergeInputTokenDetails(undefined, { noCacheTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 }))
      .toEqual({ noCacheTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 1 });
  });

  it("returns the current values when accumulated is undefined", () => {
    expect(mergeInputTokenDetails({ noCacheTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 2 }, undefined))
      .toEqual({ noCacheTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 2 });
  });

  it("returns undefined when both are undefined", () => {
    expect(mergeInputTokenDetails(undefined, undefined)).toBeUndefined();
  });

  it("treats missing inner fields as 0 (defensive || 0 guard)", () => {
    // The type requires all fields, but the runtime guards each with || 0.
    // Cast to exercise that guard.
    const result = mergeInputTokenDetails(
      { noCacheTokens: 5 } as never,
      { cacheReadTokens: 3 } as never,
    );
    expect(result).toEqual({ noCacheTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 0 });
  });
});

describe("mergeOutputTokenDetails", () => {
  it("adds corresponding fields when both are present", () => {
    const result = mergeOutputTokenDetails(
      { textTokens: 100, reasoningTokens: 50 },
      { textTokens: 200, reasoningTokens: 150 },
    );
    expect(result).toEqual({ textTokens: 300, reasoningTokens: 200 });
  });

  it("returns undefined when both are undefined", () => {
    expect(mergeOutputTokenDetails(undefined, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #1 — assembleServerMetadata (the crown jewel)
// ---------------------------------------------------------------------------

describe("assembleServerMetadata", () => {
  function buildArgs(overrides: Partial<AssembleServerMetadataArgs> = {}): AssembleServerMetadataArgs {
    return {
      UIModelId: "fast",
      internalModelId: "deepseek/deepseek-v3.2",
      provider: "openrouter",
      conversationMode: null,
      hasFiles: false,
      isAborted: false,
      finishReason: "stop",
      accumulatedUsage: totalUsage({ totalUsedTokens: 500, totalInputTokens: 400, totalOutputTokens: 100 }),
      accumulatedStepCount: 2,
      accumulatedToolCallsCount: 3,
      accumulatedToolsCalled: new Set(["web_search", "manageMemory"]),
      currentRequestTokens: { totalTokens: 200, inputTokens: 150, outputTokens: 50 },
      previousStepData: [stepData()],
      currentStepData: [stepData({ usage: { totalTokens: 200, inputTokens: 150, outputTokens: 50 }, toolCallsCount: 1 })],
      ...overrides,
    };
  }

  it("sums accumulated + current token totals", () => {
    const meta = assembleServerMetadata(buildArgs());
    expect(meta.totalUsage.totalUsedTokens).toBe(700); // 500 + 200
    expect(meta.totalUsage.totalInputTokens).toBe(550); // 400 + 150
    expect(meta.totalUsage.totalOutputTokens).toBe(150); // 100 + 50
  });

  it("sums accumulated + current step count", () => {
    const meta = assembleServerMetadata(buildArgs({ accumulatedStepCount: 2 }));
    // currentStepData has 1 entry
    expect(meta.stepCount).toBe(3);
  });

  it("sums accumulated + per-step toolCallsCount", () => {
    const meta = assembleServerMetadata(buildArgs({ accumulatedToolCallsCount: 3 }));
    // currentStepData[0].toolCallsCount = 1
    expect(meta.toolCallsCount).toBe(4);
  });

  it("converts the accumulatedToolsCalled Set to an Array", () => {
    const meta = assembleServerMetadata(buildArgs({
      accumulatedToolsCalled: new Set(["web_search", "view_website"]),
    }));
    expect(meta.toolsCalled.sort()).toEqual(["view_website", "web_search"]);
  });

  it("concatenates previousStepData + currentStepData", () => {
    const prev = stepData({ finishReason: "stop" });
    const curr = stepData({ finishReason: "length" });
    const meta = assembleServerMetadata(buildArgs({
      previousStepData: [prev],
      currentStepData: [curr],
    }));
    expect(meta.step_data).toEqual([prev, curr]);
  });

  it("sets finishReason to 'abort' when isAborted is true", () => {
    const meta = assembleServerMetadata(buildArgs({ isAborted: true, finishReason: "stop" }));
    expect(meta.finishReason).toBe("abort");
  });

  it("passes through finishReason when not aborted", () => {
    const meta = assembleServerMetadata(buildArgs({ isAborted: false, finishReason: "length" }));
    expect(meta.finishReason).toBe("length");
  });

  it("defaults finishReason to 'unknown' when not aborted and finishReason is undefined", () => {
    const meta = assembleServerMetadata(buildArgs({ isAborted: false, finishReason: undefined }));
    expect(meta.finishReason).toBe("unknown");
  });

  it("maps model_data, mode, and hasAttachments", () => {
    const meta = assembleServerMetadata(buildArgs({
      UIModelId: "thinker",
      internalModelId: "moonshotai/kimi-k2.6",
      provider: "openrouter",
      conversationMode: "study",
      hasFiles: true,
    }));
    expect(meta.model_data).toEqual({
      UIModelId: "thinker",
      internalModelId: "moonshotai/kimi-k2.6",
      provider: "openrouter",
    });
    expect(meta.mode).toBe("study");
    expect(meta.hasAttachments).toBe(true);
  });

  it("merges inputTokenDetails from current + accumulated", () => {
    const meta = assembleServerMetadata(buildArgs({
      accumulatedUsage: totalUsage({
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10 },
      }),
      currentRequestTokens: {
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        inputTokenDetails: { noCacheTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 5 },
      },
    }));
    expect(meta.totalUsage.inputTokenDetails).toEqual({
      noCacheTokens: 120, cacheReadTokens: 80, cacheWriteTokens: 15,
    });
  });

  it("merges outputTokenDetails from current + accumulated", () => {
    const meta = assembleServerMetadata(buildArgs({
      accumulatedUsage: totalUsage({
        outputTokenDetails: { textTokens: 200, reasoningTokens: 100 },
      }),
      currentRequestTokens: {
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        outputTokenDetails: { textTokens: 50, reasoningTokens: 25 },
      },
    }));
    expect(meta.totalUsage.outputTokenDetails).toEqual({
      textTokens: 250, reasoningTokens: 125,
    });
  });

  it("leaves token detail fields undefined when neither side provides them", () => {
    const meta = assembleServerMetadata(buildArgs({
      accumulatedUsage: totalUsage({ inputTokenDetails: undefined, outputTokenDetails: undefined }),
      currentRequestTokens: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
    }));
    expect(meta.totalUsage.inputTokenDetails).toBeUndefined();
    expect(meta.totalUsage.outputTokenDetails).toBeUndefined();
  });
});
