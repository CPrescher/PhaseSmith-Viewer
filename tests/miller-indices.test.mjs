import test from "node:test";
import assert from "node:assert/strict";
import { parseMillerIndices, parseTriple } from "../web/crystal-math.js";

test("Miller indices accept compact single digits and spaced signed integers", () => {
  for (const [text, expected] of [
    ["123", [1, 2, 3]],
    ["010", [0, 1, 0]],
    ["1-10", [1, -1, 0]],
    ["-1-1-1", [-1, -1, -1]],
    ["  12   -3 4  ", [12, -3, 4]],
    ["−12 3 −4", [-12, 3, -4]],
    ["1 23 4", [1, 23, 4]],
  ]) assert.deepEqual(parseMillerIndices(text), expected, text);
});

test("ambiguous compact indices explain how to separate the components", () => {
  for (const text of ["1234", "-1234", "1-234", "12345"])
    assert.throws(() => parseMillerIndices(text), /Separate multi-digit indices with spaces/);
});

test("Miller indices reject non-decimal notation, incomplete triples and zero", () => {
  for (const text of ["", "abc", "1e2 0 0", "0x10 0 0", "1.5 0 0", "1,2,3", "(123)", "1 2", "12", "1 2 3 4", "1 --2 3", "000", "0 0 0", "9007199254740992 0 0"])
    assert.throws(() => parseMillerIndices(text), undefined, text);
});

test("fractional direction and origin parsing remains available", () => {
  assert.deepEqual(parseTriple("0.5 -1 0"), [0.5, -1, 0]);
  assert.deepEqual(parseTriple("[1,-1,0]"), [1, -1, 0]);
});
