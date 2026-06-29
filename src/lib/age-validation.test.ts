import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateAge, validateAge, getAgeRangeDescription } from "./age-validation";

// `calculateAge` and `validateAge` read "today" via `new Date()`, so every test
// pins the system clock to a deterministic value.
const TODAY = new Date("2026-06-28T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calculateAge", () => {
  it("returns the exact year difference when the birthday already passed this year", () => {
    // 2024-01-15 → 2026-06-28: 2 full years, birthday passed.
    expect(calculateAge("2024-01-15")).toBe(2);
  });

  it("subtracts one when the birthday is later in the current year", () => {
    // 2000-12-31 → 2026-06-28: would be 26 by year diff, but birthday not yet.
    expect(calculateAge("2000-12-31")).toBe(25);
  });

  it("subtracts one when the birthday is later this month (same month, later day)", () => {
    // Today is 2026-06-28; born 2000-06-29 → birthday is tomorrow.
    expect(calculateAge("2000-06-29")).toBe(25);
  });

  it("does not subtract when the birthday is earlier this month (same month, earlier day)", () => {
    // Born 2000-06-01 → birthday already passed this month.
    expect(calculateAge("2000-06-01")).toBe(26);
  });

  it("treats a birthday on today's date as having occurred (age increments)", () => {
    expect(calculateAge("2000-06-28")).toBe(26);
  });

  it("accepts a Date object as input", () => {
    expect(calculateAge(new Date("2000-06-28T00:00:00Z"))).toBe(26);
  });

  it("returns 0 for a baby born today", () => {
    expect(calculateAge(TODAY.toISOString())).toBe(0);
  });

  describe("invalid inputs", () => {
    it("returns -1 for an unparseable date string", () => {
      expect(calculateAge("not-a-date")).toBe(-1);
    });

    it("returns -1 for a future date of birth", () => {
      expect(calculateAge("2030-01-01")).toBe(-1);
    });

    it("returns -1 for an Invalid Date object", () => {
      expect(calculateAge(new Date(NaN))).toBe(-1);
    });
  });
});

describe("validateAge", () => {
  describe("valid ages", () => {
    it("returns isValid=true with the calculated age for an in-range DOB", () => {
      const result = validateAge("2000-06-28");
      expect(result.isValid).toBe(true);
      expect(result.calculatedAge).toBe(26);
      expect(result.error).toBeUndefined();
    });

    it("accepts the boundary minimum age (default 1)", () => {
      // Born ~1 year ago → age 0 or 1 depending on exact date. Pin to age 1.
      expect(validateAge("2025-06-28").isValid).toBe(true);
    });

    it("accepts the boundary maximum age (default 150)", () => {
      expect(validateAge("1876-06-28").isValid).toBe(true);
    });

    it("honours a custom minAge", () => {
      // Age 26 must satisfy minAge 18.
      const result = validateAge("2000-06-28", 18);
      expect(result.isValid).toBe(true);
    });

    it("honours a custom maxAge", () => {
      // Age 26 must violate maxAge 16.
      expect(validateAge("2000-06-28", 1, 16).isValid).toBe(false);
    });
  });

  describe("invalid DOB", () => {
    it("returns the generic 'valid date of birth' error for an unparseable date", () => {
      const result = validateAge("nope");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Please enter a valid date of birth");
      expect(result.calculatedAge).toBeUndefined();
    });

    it("returns the 'valid date of birth' error for a future date", () => {
      const result = validateAge("2030-01-01");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Please enter a valid date of birth");
    });
  });

  describe("range violations", () => {
    it("uses the singular 'year' when minAge is 1", () => {
      // A newborn (age 0) violates the default minAge of 1.
      const result = validateAge(TODAY.toISOString());
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Age must be at least 1 year");
    });

    it("uses the plural 'years' when minAge is not 1", () => {
      const result = validateAge(TODAY.toISOString(), 3);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Age must be at least 3 years");
    });

    it("reports the maxAge ceiling when age is too high", () => {
      // 200 years old.
      const result = validateAge("1826-06-28");
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Age cannot exceed 150 years");
    });
  });
});

describe("getAgeRangeDescription", () => {
  it("returns the default description when called with no arguments", () => {
    expect(getAgeRangeDescription()).toBe("ages 1 to 150");
  });

  it("returns the default description for the (1, 150) defaults explicitly", () => {
    expect(getAgeRangeDescription(1, 150)).toBe("ages 1 to 150");
  });

  it("formats a custom range", () => {
    expect(getAgeRangeDescription(18, 65)).toBe("ages 18 to 65");
  });
});
