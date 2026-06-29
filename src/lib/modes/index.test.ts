import { describe, it, expect } from "vitest";
import { MODES, getModeById, getModePromptSection, type Mode } from "./index";

const STUDY_MODE = MODES.find((m) => m.id === "study");

describe("MODES registry shape", () => {
  it("contains exactly the expected mode ids", () => {
    expect(MODES.map((m) => m.id).sort()).toEqual(["study"]);
  });

  it("every mode has the required display + prompt fields populated", () => {
    for (const mode of MODES as Mode[]) {
      expect(mode.id).toBeTruthy();
      expect(mode.name).toBeTruthy();
      expect(mode.shortName).toBeTruthy();
      expect(mode.description).toBeTruthy();
      expect(mode.promptSection).toBeTruthy();
    }
  });

  it("exposes the Study mode with the expected identity", () => {
    expect(STUDY_MODE).toMatchObject({
      id: "study",
      name: "Study Mode",
      shortName: "Study",
    });
    expect(STUDY_MODE?.description).toMatch(/learn/i);
    expect(STUDY_MODE?.promptSection).toMatch(/STUDY MODE/i);
  });
});

describe("getModeById", () => {
  it("returns the Study mode for 'study'", () => {
    expect(getModeById("study")).toEqual(STUDY_MODE);
  });

  it("returns null for null", () => {
    expect(getModeById(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(getModeById(undefined)).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(getModeById("")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(getModeById("nonexistent")).toBeNull();
  });

  it("is case-sensitive ('Study' is not the same as 'study')", () => {
    expect(getModeById("Study")).toBeNull();
  });
});

describe("getModePromptSection", () => {
  it("returns the Study mode prompt section for 'study'", () => {
    expect(getModePromptSection("study")).toBe(STUDY_MODE?.promptSection);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["unknown id", "nope"],
  ])("returns an empty string for %s (Default mode contributes nothing)", (_label, id) => {
    expect(getModePromptSection(id as string | null | undefined)).toBe("");
  });
});
