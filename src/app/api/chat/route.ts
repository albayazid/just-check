import { streamText, convertToModelMessages, UIMessage, consumeStream } from 'ai';
import { getTimeTool, getWeatherTool, webSearchTool, viewWebsiteTool, manageMemoryTool } from '@/lib/tools';
import { chatRatelimit } from '@/lib/ratelimit';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  saveUserMessage,
  saveAssistantMessage,
  getLastMessageFromDB,
  updateMessage,
  type AssistantResponseMetadata,
  type StepData,
  type ModelData,
  type StoredMessage,
  type TotalUsage,
  type StepUsage,
} from '@/lib/conversation-history';
import { resolveModelRoute, getLanguageModel } from '@/lib/models';
import { logMessageTokenUsage } from '@/lib/allowance';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@clerk/nextjs/server';
import {
  detectRoutingContext,
  restoreAccumulators,
  estimateAbortedStep,
  resolveCurrentRequestTokens,
  assembleServerMetadata,
} from './utils';
import { getRemainingAllowance, deductAllowance, getModelPricing, calculateCost } from '@/lib/allowance';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { DEFAULT_AI_CUSTOMIZATION_SETTINGS, type AICustomizationSettings } from '@/types/settings';
import { getSupabaseAdminClient } from '@/lib/supabase-client.server';
import { preprocessMessagesAttachmentsForModel } from '@/lib/storage/message-attachment-preprocessor';
import { validateFileAccess } from '@/lib/storage/file-storage-service';
import { isAttachmentUrl, extractFileIdFromAttachmentUrl } from '@/lib/storage/attachment-url-utils';
import { validateChatMessages } from '@/lib/validation/validate-chat-messages';

// Import raw executors for tool charging
import { executeWebSearch } from '@/lib/tools/executor/web-search-executor';
import { executeViewWebsite } from '@/lib/tools/executor/view-website-executor';

// Import tool input types
import type { WebSearchInput } from '@/lib/tools/web-search';
import type { ViewWebsiteInput } from '@/lib/tools/view-website';
import type { ManageMemoryInput } from '@/lib/tools/memory';
import { getUserMemories } from '@/lib/memory';

const chatBodySchema = z.object({
  messages: z.array(z.any()).min(1),
  id: z.string().uuid(),
  UIModelId: z.string().min(1),
  /** Ephemeral chat mode for this turn (null/unknown = Default). Sent per-message like UIModelId. */
  mode: z.string().nullable().optional(),
  previousMessageId: z.string().uuid().nullable().optional(),
  trigger: z.string().optional(),
  messageId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { success } = await chatRatelimit.limit(clerkUserId);
    if (!success) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
    }

    const parsed = chatBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      );
    }
    const { messages: rawMessages, id: conversationId, UIModelId, mode: bodyMode, previousMessageId: clientPreviousMessageId, trigger, messageId } = parsed.data;

    // Validate message structure and application constraints
    const messageValidation = await validateChatMessages(rawMessages);
    if (!messageValidation.success) {
      return NextResponse.json(
        { error: messageValidation.error, details: messageValidation.details },
        { status: 400 }
      );
    }
    const messages = messageValidation.messages;

    const isRegeneration = trigger === 'regenerate-message';

    // Verify conversation ownership
    const supabase = getSupabaseAdminClient();
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, is_temporary')
      .eq('id', conversationId)
      .eq('clerk_user_id', clerkUserId)
      .is('deleted_at', null)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found or access denied' }, { status: 404 });
    }

    // For regeneration, look up the parent of the message being regenerated
    let regenerationParentId: string | null = null;
    if (isRegeneration && messageId) {
      const { data: regenMsg } = await supabase
        .from('messages')
        .select('previous_message_id')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .single();
      regenerationParentId = regenMsg?.previous_message_id ?? null;
    }

    // Validate clientPreviousMessageId belongs to this conversation
    if (clientPreviousMessageId) {
      const { data: parentMsg } = await supabase
        .from('messages')
        .select('id')
        .eq('id', clientPreviousMessageId)
        .eq('conversation_id', conversationId)
        .single();
      if (!parentMsg) {
        return NextResponse.json({ error: 'Invalid parent message' }, { status: 400 });
      }
    }

    // Get the last message from the client
    const lastMessageInArray = messages[messages.length - 1];
    const isNewUserTurn = lastMessageInArray.role === 'user';

    // Only check allowance for new user messages, not continuations (tool results)
    if (isNewUserTurn) {
      const remainingAllowance = await getRemainingAllowance(clerkUserId);
      if (remainingAllowance <= 0) {
        return NextResponse.json({ error: 'Insufficient allowance' }, { status: 402 });
      }
    }

    // For continuations: look up the assistant message that made the tool call.
    // messageId is the ID of the assistant message being continued. No global timestamp query needed.
    let continuationMessage: StoredMessage | null = null;
    if (!isNewUserTurn && messageId) {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .single();
      continuationMessage = (data as StoredMessage) || null;
    }

    // Calculate Routing Context
    const { hasImages, hasFiles } = detectRoutingContext(messages);

    // Resolve the UI Model to a technical route using the context
    const route = resolveModelRoute(UIModelId, { hasImages });
    
    // Create the model instance using the route
    const modelInstance = getLanguageModel(route);

    // Get model info for metadata
    const internalModelId = route.id;
    const provider = route.provider;

    // Extract provider options for streamText (e.g., for thinking mode)
    // Format: { openrouter: { reasoning: { type: 'enabled' } } }
    const providerOptions = route.providerOptions;

    // Fetch the last message from DB to check for context or continuations
    let lastMessageFromDB = await getLastMessageFromDB(conversationId);

    // Fetch user AI customization settings to build personalized system prompt
    let userAISettings: AICustomizationSettings = DEFAULT_AI_CUSTOMIZATION_SETTINGS;
    try {
      const supabase = getSupabaseAdminClient();
      const { data: existingSettings, error } = await supabase
        .from('user_settings')
        .select('ai_customization_settings')
        .eq('clerk_user_id', clerkUserId)
        .single();

      if (!error && existingSettings?.ai_customization_settings) {
        userAISettings = {
          ...DEFAULT_AI_CUSTOMIZATION_SETTINGS,
          ...existingSettings.ai_customization_settings,
        };
      }
      // Silently ignore errors - will use defaults
    } catch (error) {
      console.error('Failed to fetch settings for system prompt:', error);
      // Continue with default settings
    }

    // Save only if it's a user message and not a regeneration
    let savedUserMessage: StoredMessage | null = null;
    if (isNewUserTurn && !isRegeneration) {
      // Validate file ownership: ensure the user owns all files they're attaching,
      // or the files are already referenced in this conversation.
      const fileParts = lastMessageInArray.parts?.filter(
        (p): p is Extract<typeof p, { type: 'file' }> =>
          p.type === 'file' && typeof p.url === 'string' && isAttachmentUrl(p.url)
      ) ?? [];

      if (fileParts.length > 0) {
        const fileIds = [...new Set(fileParts.map((p) => extractFileIdFromAttachmentUrl(p.url)))];
        const allowed = await validateFileAccess(fileIds, clerkUserId, conversationId);
        if (!allowed) {
          return NextResponse.json(
            { error: 'File not found or access denied' },
            { status: 403 }
          );
        }
      }

      // Use client-provided previousMessageId for branching support.
      // Normal reply: client passes the last message's ID in the current path.
      // Edit/branch: client passes the parent of the message being edited.
      // First message: client passes null.
      savedUserMessage = await saveUserMessage({
        conversationId,
        userMessage: lastMessageInArray,
        previousMessageId: clientPreviousMessageId ?? null,
      });
    }

    // The AI SDK provides aggregated total usage via onFinish's totalUsage callback, which gives all steps summed usage. It works well on a onetime single connection. Like with server side tool calls and resposnes. But this is not the same case in client side tool calls.
    // In case of client side tool calls the stream completely end after a client side tool call. Cause the client can either send or not the tool result. That's why this safety mechanism. But this has some cons. The client side tool calls result comes as a new request.
    // Beside as the stream completely end on a client side tool call, the sdk literally call backs the onFinish. Cause the stream completely ended, unlike a server sdie tool call. Now after getting the client side result back (if client give result back), a new stream starts, as a result the new streams onFinish doesn't account for privious ofFinish usages, rather a fresh count till the stream started.
    // Initialize Metadata Accumulators
    // If this is NOT a new turn (e.g. client side tool result continuation),
    // restore accumulators from the prior assistant message's metadata.
    const continuationPrevMeta = (!isNewUserTurn && continuationMessage && continuationMessage.sender_type === 'assistant')
      ? (continuationMessage.metadata as any as AssistantResponseMetadata | null)
      : null;
    const {
      stepCount: accumulatedStepCount,
      toolCallsCount: accumulatedToolCallsCount,
      // Mutable Set — onStepFinish adds tool names during streaming.
      toolsCalled: accumulatedToolsCalled,
      usage: accumulatedUsage,
      previousStepData,
    } = restoreAccumulators(continuationPrevMeta);

    const currentStepData: StepData[] = [];

    let streamOnFinishUsage: { totalTokens?: number; inputTokens?: number; outputTokens?: number; inputTokenDetails?: any; outputTokenDetails?: any } | undefined;

    // =========================================================================
    // PREPARE ATTACHMENTS FOR MODEL INPUT
    // =========================================================================
    // Keep chat state as stable attachment:// file parts, but send the model either
    // a fresh image URL or extracted text context for non-image files.
    const attachmentResolvedMessages = await preprocessMessagesAttachmentsForModel(messages, clerkUserId, conversationId);
    
    const modelMessages = await convertToModelMessages(attachmentResolvedMessages, {
      // safety net for incomplete tool calls. incomplete tool call may cause errors. 
      // TODO: take a look if our model provider supports incomplete tool calls. cause many returns error. right now ignoring is okay and safe.
      ignoreIncompleteToolCalls: true
    });

    const isTemporaryConversation = !!conversation?.is_temporary;
    const memoryEnabled = !isTemporaryConversation && userAISettings.memoryEnabled !== false;

    let formattedMemoryList: string | undefined;
    if (memoryEnabled) {
      try {
        const memories = await getUserMemories(clerkUserId);
        formattedMemoryList = memories.map((memory) => `- ${memory}`).join('\n');
      } catch (error) {
        console.error('Failed to load user memory markdown:', error);
        formattedMemoryList = '';
      }
    }

    // Resolve the ephemeral chat mode sent per-message (null/unknown = Default).
    const conversationMode = typeof bodyMode === 'string' ? bodyMode : null;

    const systemPrompt = buildSystemPrompt(userAISettings, {
      memoryMarkdown: formattedMemoryList,
      mode: conversationMode,
    });

    // Generate assistant message ID upfront for tool charging
    // For new user turns: generate new ID
    // For continuations: reuse the existing assistant message ID (continuationMessage.id)
    const assistantMessageId = isNewUserTurn 
      ? uuidv4() 
      : continuationMessage?.id ?? uuidv4();

    // Create wrapped tools with user context for charging
    const tools = {
      // Client side tools (made disabled due to some issue need to be considered)
      // TODO: consider what will happen if user get's disconnected. what is user doesn't send back result. also what about charging.
      // getTime: getTimeTool, // No charging for it.
      // getWeather: getWeatherTool, // It is costly and will be charged but it's a client tool. It need to be handled carefully.
      
      // Server side tools with charging via thin wrappers
      webSearch: {
        ...webSearchTool,
        execute: async (input: WebSearchInput) =>
          await executeWebSearch(input, clerkUserId, assistantMessageId)
      },
      viewWebsite: {
        ...viewWebsiteTool,
        execute: async (input: ViewWebsiteInput) =>
          await executeViewWebsite(input, clerkUserId, assistantMessageId)
      },
      ...(memoryEnabled ? {
        manageMemory: {
          ...manageMemoryTool,
          execute: async (input: ManageMemoryInput) =>
            await manageMemoryTool.execute(input, clerkUserId)
        }
      } : {})
    };

    // =========================================================================
    // ABORT TRACKING
    // =========================================================================
    // When a user cancels mid-stream (e.g. clicks "Stop"), streamText fires
    // onFinish with null usage — the provider never reported final token counts.
    // To still record approximate usage and deduct allowance, we track:
    //
    // 1. stepsStarted — incremented in onStepStart, compared against
    //    currentStepData.length (populated in onStepFinish) to detect a
    //    partially-completed step that never called onStepFinish.
    //
    // 2. stepInputMessages — saved in onStepStart so we can estimate input
    //    tokens for the aborted step by concatenating system prompt + messages.
    //
    // 3. runningStepOutputText — accumulated in onChunk from text/reasoning/tool-input
    //    deltas, reset on each onStepStart. On abort, this holds whatever the
    //    model had generated so far in the interrupted step.
    //
    // Token estimation uses gpt-tokenizer (GPT BPE) which is NOT provider-specific.
    // A 1.3x multiplier overestimates to avoid under-charging. This is intentional
    // since exact counts are unavailable on abort — the provider never reported them.
    // TODO: Replace gpt-tokenizer with provider-specific tokenizers for better accuracy. Also keep constant eye on AI SDK updates to know if they have done something good with it.
    let stepsStarted = 0;
    let stepInputMessages: any[] = [];
    let runningStepOutputText = '';

    const result = streamText({
      model: modelInstance,
      messages: modelMessages,
      system: systemPrompt,
      tools,
      providerOptions,
      abortSignal: req.signal,

      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          runningStepOutputText += chunk.text;
        } else if (chunk.type === 'reasoning-delta') {
          runningStepOutputText += chunk.text;
        } else if (chunk.type === 'tool-input-delta') {
          runningStepOutputText += chunk.delta;
        }
      },

      experimental_onStepStart: ({ messages }) => {
        stepsStarted++;
        stepInputMessages = messages;
        runningStepOutputText = '';
      },

      // Track each step as it happens
      onStepFinish: async ({ finishReason, usage, toolCalls, warnings, providerMetadata }) => {
        // Collect Step Data - using AI SDK v6 structure
        const stepUsage: StepUsage = {
          totalTokens: usage.totalTokens || 0,
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          // Include detailed breakdowns if available (v6 feature)
          // Always include all fields for consistent DB storage
          inputTokenDetails: usage.inputTokenDetails
            ? {
              noCacheTokens: usage.inputTokenDetails.noCacheTokens,
              cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
              cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
            }
            : undefined,
          outputTokenDetails: usage.outputTokenDetails
            ? {
              textTokens: usage.outputTokenDetails.textTokens,
              reasoningTokens: usage.outputTokenDetails.reasoningTokens,
            }
            : undefined,
        };

        // Add to current steps
        currentStepData.push({
          timestamp: new Date().toISOString(),
          finishReason,
          usage: stepUsage,
          toolCallsCount: toolCalls?.length || 0,
          warnings: warnings || [],
          providerMetadata: providerMetadata || {},
        });

        // Add to tools called
        if (toolCalls) {
          toolCalls.forEach(tc => {
            if (tc) {
              accumulatedToolsCalled.add(tc.toolName);
            }
          });
        }

      },

      onFinish: ({ finishReason, totalUsage, steps }) => {
        // Capture for later use in onFinish of toUIMessageStreamResponse
        streamOnFinishUsage = totalUsage;
      }
    });

    return result.toUIMessageStreamResponse({
      generateMessageId: () => assistantMessageId,
      consumeSseStream: consumeStream,
      // 1. Define message metadata behavior - ONLY client-safe fields
      messageMetadata: ({ part }) => {

        // Right now it sends metadata directly to client at stream time.
        if (part.type === 'start') {
          return {
            model_data: {
              UIModelId,
            },
            mode: conversationMode,
          };
        }

        // Not sending anything on finish - only server cares about finish metadata
        // if (part.type === 'finish') {
        //   return {};
        // }

        return {};
      },

      // 2. Handle original messages and DB saving
      originalMessages: messages,
      onFinish: async ({ messages: completedMessages, isContinuation, finishReason, isAborted }) => {

        // The assistant message is the last one in the completed messages
        const assistantMessage = completedMessages[completedMessages.length - 1];

        // Don't save empty messages
        if (!assistantMessage.parts || assistantMessage.parts.length === 0) {
          return;
        }

        // =========================================================================
        // BUILD SERVER-ONLY METADATA
        // =========================================================================

        // Account for the step that was running when abort happened
        const hasRunningStep = isAborted && stepsStarted > currentStepData.length;
        if (hasRunningStep) {
          currentStepData.push(
            estimateAbortedStep({ runningStepOutputText, systemPrompt, stepInputMessages }),
          );
        }

        // Use real usage from streamOnFinishUsage when available,
        // otherwise sum from currentStepData (covers abort scenarios where
        // streamText's onFinish fires with null usage)
        const currentRequestTokens = resolveCurrentRequestTokens(streamOnFinishUsage, currentStepData);

        const serverMetadata: AssistantResponseMetadata = assembleServerMetadata({
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
        });

        // Merge client metadata (from streaming) with server metadata. (defensive)
        // Cause server metadata already has all the fields needed.
        const clientMetadata: Record<string, unknown> = (assistantMessage.metadata as Record<string, unknown>) ?? {};
        const fullMetadata: AssistantResponseMetadata = {
          ...clientMetadata,
          ...serverMetadata,
        };

        // Save with enriched metadata
        if (isContinuation && continuationMessage && continuationMessage.sender_type === 'assistant') {
          await updateMessage(continuationMessage.id, {
            content: assistantMessage.parts,
            metadata: fullMetadata,
          });
        } else {
          await saveAssistantMessage({
            conversationId,
            assistantMessage,
            metadata: fullMetadata,
            previousMessageId: isRegeneration ? regenerationParentId : (savedUserMessage?.id || lastMessageFromDB?.id || null),
          });
        }

        // =========================================================================
        // ALLOWANCE DEDUCTION
        // =========================================================================
        // Use currentRequestTokens for cost calculation (covers both normal and abort paths)
        try {

          if (currentRequestTokens && route) {
            const pricing = getModelPricing(route.provider, route.id);
            let cost = 0;

            if (!pricing) {
              console.error(`Pricing not found for model ${route.provider}/${route.id}`);
            } else {
              cost = calculateCost(
                currentRequestTokens.inputTokens || 0,
                currentRequestTokens.outputTokens || 0,
                pricing
              );
              if (cost > 0) {
                await deductAllowance(clerkUserId, cost);
              }
            }

            // Log token usage for analytics
            try {
              const currentUsageTotal: TotalUsage = {
                totalUsedTokens: currentRequestTokens.totalTokens || 0,
                totalInputTokens: currentRequestTokens.inputTokens || 0,
                totalOutputTokens: currentRequestTokens.outputTokens || 0,
                inputTokenDetails: currentRequestTokens.inputTokenDetails,
                outputTokenDetails: currentRequestTokens.outputTokenDetails,
              };
              await logMessageTokenUsage({
                messageId: assistantMessage.id,
                tokenUsage: currentUsageTotal,
                modelInfo: { provider, UIModelId, internalModelId },
                totalCost: cost,
                pricingUsed: pricing ?? { input: 0, output: 0 },
              });
            } catch (logErr) {
              console.error('Failed to log token usage:', logErr);
            }
          }
        } catch (err) {
          console.error('Failed to deduct allowance:', err);
        }
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Failed to process chat' }, { status: 500 });
  }
}
