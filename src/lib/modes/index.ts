/**
 * Chat Modes
 *
 * A "mode" is a named, toggleable behavioral lens layered on top of Lumy's
 * default persona. When active, its `promptSection` is injected into the system
 * prompt to change how the assistant responds within that conversation
 * (e.g. Study Mode acts as a Socratic tutor instead of an answer engine).
 *
 * Modes are resolved per-conversation from `conversations.metadata.mode` and
 * read server-side in the chat route. `null` / unknown ids mean Default mode
 * (no extra section).
 *
 * Adding a new mode = add one entry to MODES. No other plumbing required.
 */

export interface Mode {
  /** The unique identifier persisted in `conversations.metadata.mode` */
  id: string;
  /** The name shown to the user in the mode selector */
  name: string;
  /** Compact label shown in the active-mode badge */
  shortName: string;
  /** A user-facing description of what this mode does */
  description: string;
  /** The text injected into the system prompt when this mode is active */
  promptSection: string;
}

const STUDY_MODE_PROMPT_SECTION = `You are in STUDY MODE — the user is here to learn, not to collect answers. Act as a patient Socratic tutor.

Your goal is to build the user's independent problem-solving ability, not to deliver answers on demand. Guide with questions, hints, analogies, and incremental explanations calibrated to their level. Prioritize underlying principles and intuition over correctness. Increase assistance gradually — offer subtle hints first, then more explicit guidance, and provide a full solution only when the user has made a sincere attempt or explicitly asks for it. When you do reveal a solution, explain the reasoning, highlight the key insight, and connect it to broader concepts so they can apply it elsewhere. Treat mistakes as useful diagnostic information. Be warm, encouraging, and intellectually curious. Optimize for lasting comprehension over task completion.

This is a lens over Lumy's normal personality — keep your warm, human, curious voice. Just redirect from handing over answers to building understanding. Never moralize about effort or "doing the work."`;

export const MODES: Mode[] = [
  {
    id: 'study',
    name: 'Study Mode',
    shortName: 'Study',
    description: 'Learn through guided questions and hints instead of direct answers.',
    promptSection: STUDY_MODE_PROMPT_SECTION,
  },
];

/**
 * Look up a mode by id. Returns null for null/undefined/unknown ids
 * (which resolves to Default mode).
 */
export function getModeById(id: string | null | undefined): Mode | null {
  if (!id) return null;
  return MODES.find((mode) => mode.id === id) ?? null;
}

/**
 * Returns the prompt section for a mode, or an empty string for
 * null/undefined/unknown ids (Default mode contributes nothing).
 */
export function getModePromptSection(id: string | null | undefined): string {
  return getModeById(id)?.promptSection ?? '';
}
