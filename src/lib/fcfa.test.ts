import { expect, test } from "vitest";
import { formatFCFA, groupDigits, parseBalance, parseFCFA } from "./fcfa";

test("formatFCFA uses spaces as thousands separators", () => {
  expect(formatFCFA(253650)).toBe("253 650 FCFA");
  expect(formatFCFA(1975500)).toBe("1 975 500 FCFA");
  expect(formatFCFA(0)).toBe("0 FCFA");
  expect(formatFCFA(-1000)).toBe("−1 000 FCFA");
});

test("parseFCFA accepts whole positive amounts only", () => {
  expect(parseFCFA("253 650")).toBe(253650);
  expect(parseFCFA("1000")).toBe(1000);
  for (const bad of ["", "0", "-5", "10.5", "10,5", "abc"]) expect(parseFCFA(bad)).toBeNull();
});

test("groupDigits formats as the officer types", () => {
  expect(groupDigits("253650")).toBe("253 650");
  expect(groupDigits("0012a")).toBe("12");
});

test("parseBalance allows 0, and negative only when asked", () => {
  expect(parseBalance("0", false)).toBe(0);
  expect(parseBalance("84 000", false)).toBe(84000);
  expect(parseBalance("-20 000", false)).toBeNull();
  expect(parseBalance("-20 000", true)).toBe(-20000);
  expect(parseBalance("−5", true)).toBe(-5);
  for (const bad of ["", "1.5", "abc", "--1"]) expect(parseBalance(bad, true)).toBeNull();
});
