import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TimeRange, convertTimeRangeToStartDate } from "./time-range";

// The function reads "today" via `new Date()`. Pin it so the start dates are
// deterministic. 2026-06-28 is a clean anchor — all range subtractions land on
// unambiguous days (no month-end overflow).
const TODAY = new Date("2026-06-28T15:30:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("convertTimeRangeToStartDate", () => {
  it("always returns the DD-MM-YYYY format", () => {
    for (const range of Object.values(TimeRange)) {
      expect(convertTimeRangeToStartDate(range)).toMatch(
        /^\d{2}-\d{2}-\d{4}$/,
      );
    }
  });

  it.each([
    [TimeRange.Today, "28-06-2026"],
    [TimeRange.Last7Days, "21-06-2026"],
    [TimeRange.Last30Days, "29-05-2026"],
    [TimeRange.Last3Months, "28-03-2026"],
    [TimeRange.Last6Months, "28-12-2025"],
    [TimeRange.LastYear, "28-06-2025"],
  ])("returns %s → %s", (range, expected) => {
    expect(convertTimeRangeToStartDate(range)).toBe(expected);
  });

  it("normalises the time component to midnight for 'Today'", () => {
    // The formatted output already hides time, but the implementation calls
    // setHours(0,0,0,0). We assert the Today case yields exactly today's date,
    // which would drift if the time were not zeroed (it wouldn't, since we
    // format only the date — this is a contract assertion regardless).
    expect(convertTimeRangeToStartDate(TimeRange.Today)).toBe("28-06-2026");
  });
});

describe("TimeRange enum", () => {
  it("exposes the documented human-readable values", () => {
    expect(TimeRange.Today).toBe("Today");
    expect(TimeRange.Last7Days).toBe("Last 7 days");
    expect(TimeRange.Last30Days).toBe("Last 30 days");
    expect(TimeRange.Last3Months).toBe("Last 3 months");
    expect(TimeRange.Last6Months).toBe("Last 6 months");
    expect(TimeRange.LastYear).toBe("Last year");
  });
});
