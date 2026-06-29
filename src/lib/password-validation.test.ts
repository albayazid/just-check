import { describe, it, expect } from "vitest";
import {
  validatePasswordStrength,
  getPasswordValidationError,
  passwordsMatch,
  MIN_PASSWORD_LENGTH,
} from "./password-validation";

// A password that satisfies every requirement. Centralised so the "happy path"
// stays correct even if the rules change.
const STRONG_PASSWORD = "Abcdef1!";

describe("MIN_PASSWORD_LENGTH", () => {
  it("is 8 (contract lock)", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });
});

describe("validatePasswordStrength", () => {
  describe("requirements list shape", () => {
    it("always returns exactly five requirements in a stable order", () => {
      const { requirements } = validatePasswordStrength("");

      expect(requirements).toHaveLength(5);
      expect(requirements.map((r) => r.label)).toEqual([
        "At least 8 characters",
        "At least one uppercase letter",
        "At least one lowercase letter",
        "At least one number",
        "At least one special character",
      ]);
    });

    it("includes a boolean `met` flag on every requirement", () => {
      const { requirements } = validatePasswordStrength("a");

      for (const requirement of requirements) {
        expect(typeof requirement.met).toBe("boolean");
      }
    });
  });

  describe("valid passwords", () => {
    it("marks every requirement met and reports isValid=true for a strong password", () => {
      const result = validatePasswordStrength(STRONG_PASSWORD);

      expect(result.isValid).toBe(true);
      expect(result.requirements.every((r) => r.met)).toBe(true);
    });

    it("accepts any character in the special-character set", () => {
      for (const ch of "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?") {
        const password = `Abcdef1${ch}`;
        expect(validatePasswordStrength(password).isValid, `for "${ch}"`).toBe(true);
      }
    });
  });

  describe("individual requirement failures", () => {
    it("flags `met=false` only for length when one char short", () => {
      const shortOfLength = "Abcde1!"; // 7 chars, satisfies the other four
      const result = validatePasswordStrength(shortOfLength);

      expect(result.isValid).toBe(false);
      const labels = (met: boolean) =>
        result.requirements
          .filter((r) => r.met === met)
          .map((r) => r.label);

      expect(labels(false)).toEqual(["At least 8 characters"]);
      expect(labels(true)).toHaveLength(4);
    });

    it("flags the uppercase requirement when absent", () => {
      const result = validatePasswordStrength("abcdef1!");
      const unmet = result.requirements.find(
        (r) => r.label === "At least one uppercase letter",
      );
      expect(unmet?.met).toBe(false);
      expect(result.isValid).toBe(false);
    });

    it("flags the lowercase requirement when absent", () => {
      const result = validatePasswordStrength("ABCDEF1!");
      const unmet = result.requirements.find(
        (r) => r.label === "At least one lowercase letter",
      );
      expect(unmet?.met).toBe(false);
      expect(result.isValid).toBe(false);
    });

    it("flags the digit requirement when absent", () => {
      const result = validatePasswordStrength("Abcdefg!");
      const unmet = result.requirements.find(
        (r) => r.label === "At least one number",
      );
      expect(unmet?.met).toBe(false);
      expect(result.isValid).toBe(false);
    });

    it("flags the special-character requirement when absent", () => {
      const result = validatePasswordStrength("Abcdef1");
      const unmet = result.requirements.find(
        (r) => r.label === "At least one special character",
      );
      expect(unmet?.met).toBe(false);
      expect(result.isValid).toBe(false);
    });

    it("marks everything unmet for the empty string", () => {
      const result = validatePasswordStrength("");
      expect(result.isValid).toBe(false);
      expect(result.requirements.every((r) => !r.met)).toBe(true);
    });
  });
});

describe("getPasswordValidationError", () => {
  it("returns null for a valid password", () => {
    expect(getPasswordValidationError(STRONG_PASSWORD)).toBeNull();
  });

  describe("missing input", () => {
    it("returns the 'required' message for an empty string", () => {
      expect(getPasswordValidationError("")).toBe("Password is required");
    });

    it("returns the 'required' message for null", () => {
      expect(getPasswordValidationError(null as unknown as string)).toBe(
        "Password is required",
      );
    });

    it("returns the 'required' message for undefined", () => {
      expect(getPasswordValidationError(undefined as unknown as string)).toBe(
        "Password is required",
      );
    });

    it("returns the 'required' message for a non-string value", () => {
      expect(getPasswordValidationError(12345 as unknown as string)).toBe(
        "Password is required",
      );
    });
  });

  describe("rule order — only the first failure is reported", () => {
    it("reports length first when the password is too short", () => {
      expect(getPasswordValidationError("a1!")).toBe(
        "Password must be at least 8 characters long",
      );
    });

    it("reports the uppercase rule once length is satisfied", () => {
      expect(getPasswordValidationError("abcdef1!")).toBe(
        "Password must contain at least one uppercase letter",
      );
    });

    it("reports the lowercase rule once length + uppercase are satisfied", () => {
      expect(getPasswordValidationError("ABCDEF1!")).toBe(
        "Password must contain at least one lowercase letter",
      );
    });

    it("reports the digit rule once length + case are satisfied", () => {
      expect(getPasswordValidationError("Abcdefgh!")).toBe(
        "Password must contain at least one number",
      );
    });

    it("reports the special-character rule last", () => {
      expect(getPasswordValidationError("Abcdef12")).toBe(
        "Password must contain at least one special character",
      );
    });
  });
});

describe("passwordsMatch", () => {
  it("returns true when both arguments are equal", () => {
    expect(passwordsMatch("secret", "secret")).toBe(true);
  });

  it("returns false when the arguments differ", () => {
    expect(passwordsMatch("secret", "secre7")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(passwordsMatch("Secret", "secret")).toBe(false);
  });

  it("returns true when both arguments are empty", () => {
    expect(passwordsMatch("", "")).toBe(true);
  });

  it("returns false when only one argument is empty", () => {
    expect(passwordsMatch("secret", "")).toBe(false);
  });
});
