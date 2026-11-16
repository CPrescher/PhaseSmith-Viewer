import test from "node:test";
import assert from "node:assert/strict";
import {
  describeViewDirection,
  latticeViewDirection,
} from "../web/view-direction.js";
const basis = [
  [4, 1, 0],
  [0, 3, 0.5],
  [0, 0, 6],
];
test("view readout inverts the direct basis, not Cartesian or reciprocal coordinates", () => {
  const result = describeViewDirection(basis, [2, -5.5, 6]);
  assert.deepEqual(result.components, [1, -2, 1]);
  assert.equal(result.text, "[1 −2 1]");
  assert.equal(result.approximate, false);
  assert.deepEqual(
    describeViewDirection(basis, [-2, 5.5, -6]).components,
    [-1, 2, -1],
  );
  for (const indices of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
    [2, -1, 0],
    [21, -13, 8],
  ]) {
    const { direction } = latticeViewDirection(basis, indices);
    assert.deepEqual(
      describeViewDirection(basis, direction).components,
      indices,
    );
  }
});
test("arbitrary views are explicitly approximate and normalized without losing sign", () => {
  const result = describeViewDirection(
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [1, -0.12345, 0.45678],
  );
  assert.equal(result.text, "≈ [1 −0.12 0.46]");
  assert.equal(result.approximate, true);
  assert.deepEqual(result.components, [1, -0.12345, 0.45678]);
  assert.equal(
    describeViewDirection(
      basis.map((row) => row.map((v) => v * 1e100)),
      [2e100, -5.5e100, 6e100],
    ).text,
    "[1 −2 1]",
  );
});
test("undefined directions fail instead of displaying misleading indices", () => {
  assert.throws(() => describeViewDirection(basis, [0, 0, 0]));
  assert.throws(() => describeViewDirection(basis, [NaN, 0, 1]));
  assert.throws(() =>
    describeViewDirection(
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      [1, 0, 0],
    ),
  );
});
