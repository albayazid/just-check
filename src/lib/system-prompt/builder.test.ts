import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  type BuildSystemPromptOptions,
} from "./builder";
import {
  DEFAULT_AI_CUSTOMIZATION_SETTINGS,
  type AICustomizationSettings,
} from "@/types/settings";

// Stable section markers (the full constant strings are not exported, but each
// section starts with a distinctive header we can anchor on).
const SECTIONS = {
  identity: "You are Lumy",
  behavior: "## Behavior",
  modes: "## Modes",
  capabilities: "## Capabilities",
  tools: "## Tools",
  memoryProtocol: "### Persistent Memory",
  userPreferences: "## User Preferences",
  userMemory: "## User Memory",
} as const;

function withSettings(
  overrides: Partial<AICustomizationSettings> = {},
): AICustomizationSettings {
  return { ...DEFAULT_AI_CUSTOMIZATION_SETTINGS, ...overrides };
}

function build(
  settings: AICustomizationSettings = DEFAULT_AI_CUSTOMIZATION_SETTINGS,
  options: BuildSystemPromptOptions = {},
): string {
  return buildSystemPrompt(settings, options);
}

// Asserts that the markers appear in the prompt in the same relative order as
// the array argument. Uses indexOf so missing markers (value -1) sort first
// and surface a readable failure.
function expectSectionsInOrder(prompt: string, markers: string[]) {
  const positions = markers.map((m) => prompt.indexOf(m));
  for (let i = 1; i < positions.length; i++) {
    expect(
      positions[i],
      `expected "${markers[i]}" (${positions[i]}) to come after "${markers[i - 1]}" (${positions[i - 1]})`,
    ).toBeGreaterThan(positions[i - 1]);
  }
}

describe("buildSystemPrompt — always-present sections", () => {
  const prompt = build();

  it("includes the identity, behavior, capabilities and tools sections", () => {
    expect(prompt).toContain(SECTIONS.identity);
    expect(prompt).toContain(SECTIONS.behavior);
    expect(prompt).toContain(SECTIONS.capabilities);
    expect(prompt).toContain(SECTIONS.tools);
  });

  it("includes the modes section (always present, regardless of active mode)", () => {
    expect(prompt).toContain(SECTIONS.modes);
    expect(prompt).toContain("Current mode: Default.");
  });

  it("does NOT include memory-related sections by default (memory disabled)", () => {
    expect(prompt).not.toContain(SECTIONS.memoryProtocol);
    expect(prompt).not.toContain(SECTIONS.userMemory);
  });

  it("does NOT include a user preferences section for default settings", () => {
    expect(prompt).not.toContain(SECTIONS.userPreferences);
  });
});

describe("buildSystemPrompt — section ordering", () => {
  it("lays out core sections in the documented order", () => {
    const prompt = build();
    expectSectionsInOrder(prompt, [
      SECTIONS.identity,
      SECTIONS.behavior,
      SECTIONS.modes,
      SECTIONS.capabilities,
      SECTIONS.tools,
    ]);
  });

  it("places memory protocol immediately after tools when memory is enabled", () => {
    const prompt = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {
      memoryMarkdown: "- User likes tea",
    });
    expectSectionsInOrder(prompt, [
      SECTIONS.tools,
      SECTIONS.memoryProtocol,
      SECTIONS.userMemory,
    ]);
  });

  it("places user preferences above the memory list (recency bias for memory)", () => {
    const prompt = build(
      withSettings({ customInstructions: "be terse" }),
      { memoryMarkdown: "- User likes tea" },
    );
    expectSectionsInOrder(prompt, [
      SECTIONS.tools,
      SECTIONS.userPreferences,
      SECTIONS.userMemory,
    ]);
  });
});

describe("buildSystemPrompt — modes", () => {
  it("appends the Study prompt section only when study mode is active", () => {
    const study = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, { mode: "study" });
    expect(study).toContain("Current mode: Study Mode.");
    expect(study).toContain("STUDY MODE");
    expect(study).toContain("Socratic tutor");
  });

  it("falls back to Default mode for an unknown mode id (no extra prompt section)", () => {
    const unknown = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {
      mode: "nonexistent",
    });
    expect(unknown).toContain("Current mode: Default.");
    expect(unknown).not.toContain("STUDY MODE");
  });

  it("treats null and undefined mode as Default", () => {
    for (const mode of [null, undefined] as const) {
      const prompt = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, { mode });
      expect(prompt).toContain("Current mode: Default.");
    }
  });
});

describe("buildSystemPrompt — memory", () => {
  it("enables memory protocol and list when memoryMarkdown is a string", () => {
    const prompt = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {
      memoryMarkdown: "- User likes tea\n- User is in Berlin",
    });
    expect(prompt).toContain(SECTIONS.memoryProtocol);
    expect(prompt).toContain(SECTIONS.userMemory);
    expect(prompt).toContain("- User likes tea\n- User is in Berlin");
  });

  it("shows '(empty)' for a whitespace-only memory list", () => {
    const prompt = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {
      memoryMarkdown: "   ",
    });
    expect(prompt).toContain(SECTIONS.memoryProtocol);
    expect(prompt).toContain("## User Memory\n\n(empty)");
  });

  it("does not enable memory when memoryMarkdown is undefined", () => {
    const prompt = build(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {});
    expect(prompt).not.toContain(SECTIONS.memoryProtocol);
    expect(prompt).not.toContain(SECTIONS.userMemory);
  });
});

describe("buildSystemPrompt — user preferences", () => {
  it("omits the preferences section entirely when every field is blank/default", () => {
    expect(build()).not.toContain(SECTIONS.userPreferences);
  });

  describe("individual fields", () => {
    it("emits the AI nickname line and trims surrounding whitespace", () => {
      const prompt = build(withSettings({ aiNickname: "  Lum  " }));
      expect(prompt).toContain(
        'The user calls you "Lum". Respond naturally when they use this name.',
      );
    });

    it("emits the user nickname line", () => {
      const prompt = build(withSettings({ userNickname: "Sam" }));
      expect(prompt).toContain(
        "The user's name is Sam. Address them by name when it fits naturally.",
      );
    });

    it("emits the profession line", () => {
      const prompt = build(withSettings({ userProfession: "nurse" }));
      expect(prompt).toContain(
        "The user is a nurse. Tailor explanations to their professional background when relevant.",
      );
    });

    it("emits the preferred-topics line", () => {
      const prompt = build(withSettings({ preferredTopics: "history, math" }));
      expect(prompt).toContain("The user is interested in: history, math.");
    });

    it("emits the more-about-you line", () => {
      const prompt = build(withSettings({ moreAboutYou: "lives abroad" }));
      expect(prompt).toContain("Additional context about the user: lives abroad");
    });

    it("emits the avoid-topics line", () => {
      const prompt = build(withSettings({ avoidTopics: "politics" }));
      expect(prompt).toContain(
        "Avoid these topics unless explicitly asked: politics",
      );
    });

    it("emits custom instructions tagged as highest priority", () => {
      const prompt = build(withSettings({ customInstructions: "be terse" }));
      expect(prompt).toContain("Custom instructions (highest priority):\nbe terse");
    });

    it("skips fields whose value is only whitespace", () => {
      const prompt = build(
        withSettings({
          aiNickname: "   ",
          userNickname: "\t",
          customInstructions: " ",
        }),
      );
      expect(prompt).not.toContain(SECTIONS.userPreferences);
    });
  });

  describe("aiTone variants", () => {
    it.each([
      ["friendly", "Be warm, approachable, and conversational. Show enthusiasm."],
      ["warmer", "Be especially empathetic and supportive. Acknowledge feelings when appropriate."],
      ["professional", "Maintain a formal, precise, business-like tone."],
      [
        "gen-z",
        "Use modern, casual language. Short sentences. Emojis sparingly if natural. Be trendy but not cringe.",
      ],
    ])("emits the %s tone line", (tone, expected) => {
      expect(build(withSettings({ aiTone: tone as AICustomizationSettings["aiTone"] }))).toContain(
        expected,
      );
    });

    it("emits no tone line for the 'default' tone", () => {
      const prompt = build(withSettings({ aiTone: "default" }));
      expect(prompt).not.toContain("## User Preferences");
    });
  });

  describe("responseLength variants", () => {
    it("emits the concise line", () => {
      expect(build(withSettings({ responseLength: "concise" }))).toContain(
        "Keep responses brief and to the point. Prioritize clarity over elaboration.",
      );
    });

    it("emits the detail line", () => {
      expect(build(withSettings({ responseLength: "detail" }))).toContain(
        "Provide thorough, detailed explanations. Include examples and cover edge cases when relevant.",
      );
    });

    it("emits no length line for the 'default' length", () => {
      expect(build(withSettings({ responseLength: "default" }))).not.toContain(
        "## User Preferences",
      );
    });
  });

  it("renders every preference as a bullet under ## User Preferences", () => {
    const prompt = build(
      withSettings({
        aiNickname: "Lum",
        customInstructions: "be terse",
        aiTone: "professional",
      }),
    );
    const section = prompt.slice(
      prompt.indexOf(SECTIONS.userPreferences),
    );
    // Each item becomes one bullet line (`- ...`). customInstructions is a
    // multi-line bullet, so its continuation ("be terse") is NOT itself a
    // bullet — we count top-level bullets only.
    const bulletCount = section
      .split("\n")
      .filter((line) => line.startsWith("- ")).length;

    expect(bulletCount).toBe(3); // aiNickname + customInstructions + aiTone
    expect(section).toContain("- The user calls you \"Lum\".");
    expect(section).toContain("- Custom instructions (highest priority):");
    expect(section).toContain("- Maintain a formal, precise, business-like tone.");
  });
});

describe("buildSystemPrompt — defaults", () => {
  it("produces the same output whether called with no args or with explicit defaults", () => {
    expect(build()).toBe(
      buildSystemPrompt(DEFAULT_AI_CUSTOMIZATION_SETTINGS, {}),
    );
  });
});
