import { expect, test } from "vitest";
import { dayLabel, direction } from "./money";

test("direction reads money in, out, moves and not-yet-real entries", () => {
  expect(direction({ type: "income", status: "confirmed" })).toBe("in");
  expect(direction({ type: "expense", status: "confirmed" })).toBe("out");
  expect(direction({ type: "transfer", status: "confirmed" })).toBe("move");
  expect(direction({ type: "adjustment_down", status: "confirmed" })).toBe("out");
  expect(direction({ type: "expense", status: "draft" })).toBe("pending");
  expect(direction({ type: "school_withdrawal", status: "committed" })).toBe("pending");
  // A reversal reads the opposite way; a reversal of a reversal reads like the original.
  expect(direction({ type: "income", status: "confirmed", flip: -1 })).toBe("out");
  expect(direction({ type: "income", status: "confirmed", flip: 1, reversalOf: "x" })).toBe("in");
});

test("dayLabel: Today, Yesterday, then a short date", () => {
  const now = new Date(2026, 9, 15, 18).getTime();
  expect(dayLabel(new Date(2026, 9, 15, 8).getTime(), now)).toBe("Today");
  expect(dayLabel(new Date(2026, 9, 14, 23).getTime(), now)).toBe("Yesterday");
  expect(dayLabel(new Date(2026, 9, 12).getTime(), now)).toMatch(/12 Oct/);
  expect(dayLabel(new Date(2025, 9, 12).getTime(), now)).toMatch(/2025/);
});
