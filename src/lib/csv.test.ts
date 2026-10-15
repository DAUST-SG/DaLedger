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
