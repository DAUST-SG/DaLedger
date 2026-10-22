import { expect, test } from "vitest";
import { toCSV } from "./csv";

test("escapes commas, quotes and line breaks; keeps whole numbers", () => {
  const csv = toCSV(["id", "amount", "reason"], [
    ["a1", 253650, 'Hoodies, "XL"'],
    ["a2", 1000, "line one\nline two"],
    ["a3", 5, undefined],
  ]);
  expect(csv).toBe(
    '﻿id,amount,reason\r\na1,253650,"Hoodies, ""XL"""\r\na2,1000,"line one\nline two"\r\na3,5,\r\n',
  );
});

test("text that a spreadsheet would run as a formula is neutralised", () => {
  const csv = toCSV(["reason", "amount"], [["=HYPERLINK(\"http://x\")", 500], ["+1", -1], ["@SUM(A1)", 0], ["Plain", 1]]);
  const lines = csv.slice(1).split("\r\n");
  expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")",500`);
  expect(lines[2]).toBe("'+1,-1");
  expect(lines[3]).toBe("'@SUM(A1),0");
  expect(lines[4]).toBe("Plain,1");
});
