import test from "node:test";
import assert from "node:assert/strict";
import { latticeViewDirection } from "../web/view-direction.js";
const close = (a, b) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} != ${b}`));
const normalized = (a) => a.map((v) => v / Math.hypot(...a));
const basis = [
  [4, 2, 1],
  [0, 3, 0.5],
  [0, 0, 5],
];
test("a, b and c views follow direct lattice columns in a skew cell", () => {
  for (let i = 0; i < 3; i++) {
    const indices = [0, 0, 0];
    indices[i] = 1;
    close(
      latticeViewDirection(basis, indices).direction,
      normalized(basis.map((row) => row[i])),
    );
  }
});
test("arbitrary direct [uvw] uses Cartesian B times indices, including negative side", () => {
  close(
    latticeViewDirection(basis, [1, -2, 3]).direction,
    normalized([3, -4.5, 15]),
  );
  const positive = latticeViewDirection(basis, [1, 2, 3]);
  close(
    latticeViewDirection(basis, [-1, -2, -3]).direction,
    positive.direction.map((v) => -v),
  );
});
test("up prefers projected positive c and switches to positive b near c", () => {
  const orthogonal = [
    [4, 0, 0],
    [0, 5, 0],
    [0, 0, 6],
  ];
  close(latticeViewDirection(orthogonal, [1, 0, 0]).up, [0, 0, 1]);
  close(latticeViewDirection(orthogonal, [0, 0, 1]).up, [0, 1, 0]);
  close(latticeViewDirection(orthogonal, [0, 0, -1]).up, [0, 1, 0]);
  const near = latticeViewDirection(orthogonal, [1e-8, 0, 1]);
  close(near.up, [0, 1, 0]);
});
test("returned direction and up are orthogonal unit vectors", () => {
  const { direction, up } = latticeViewDirection(basis, [2, -3, 1]);
  assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-12);
  assert.ok(Math.abs(direction.reduce((s, v, i) => s + v * up[i], 0)) < 1e-12);
});
test("normalization handles very large finite indices and basis values", () => {
  close(
    latticeViewDirection(basis, [1e308, 1e308, 0]).direction,
    normalized([6, 3, 0]),
  );
  close(
    latticeViewDirection(
      [
        [1e308, 0, 0],
        [0, 1e308, 0],
        [0, 0, 1e308],
      ],
      [1, 1, 0],
    ).direction,
    normalized([1, 1, 0]),
  );
});
test("invalid and zero directions produce useful errors", () => {
  assert.throws(() => latticeViewDirection(basis, [0, 0, 0]), /nonzero/);
  assert.throws(() => latticeViewDirection(basis, [NaN, 1, 0]), /finite/);
  assert.throws(
    () =>
      latticeViewDirection(
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
        [1, 0, 0],
      ),
    /basis/,
  );
});
