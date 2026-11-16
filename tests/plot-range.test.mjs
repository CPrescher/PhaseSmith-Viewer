import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultRanges,
  translatedSites,
  validateRanges,
  rangeEdges,
} from "../web/plot-range.js";
const site = { label: "A", element: "Si", frac: [0, 0, 0] };
test("default boundaries and repeated identities", () => {
  assert.equal(translatedSites([site], defaultRanges(), false).length, 1);
  assert.equal(translatedSites([site], defaultRanges(), true).length, 8);
  const result = translatedSites(
    [site],
    [
      [-1, 1],
      [0, 3],
      [0, 1],
    ],
    false,
  );
  assert.equal(result.length, 6);
  assert.equal(
    new Set(result.map((a) => `${a.sourceIndex}:${a.frac}`)).size,
    6,
  );
  assert.deepEqual(result.at(-1).frac, [0, 2, 0]);
});
test("fractional bounds select real translated coordinates and include lower face", () => {
  const a = { ...site, frac: [0.25, 0.5, 0.75] };
  assert.deepEqual(
    translatedSites(
      [a],
      [
        [0.25, 1.25],
        [0.5, 1.5],
        [0.75, 1.75],
      ],
      false,
    ).map((a) => a.frac),
    [[0.25, 0.5, 0.75]],
  );
  assert.equal(
    translatedSites(
      [a],
      [
        [0.25, 1.25],
        [0.5, 1.5],
        [0.75, 1.75],
      ],
      true,
    ).length,
    8,
  );
  assert.deepEqual(
    translatedSites(
      [a],
      [
        [-0.75, 0],
        [0, 1],
        [0, 1],
      ],
      false,
    )[0].frac,
    [-0.75, 0.5, 0.75],
  );
  assert.equal(
    translatedSites([{ ...site, frac: [1e-12, 0, 0] }], defaultRanges(), true)
      .length,
    4,
  );
});
test("validation rejects excessive work and invalid ranges before enumeration", () => {
  for (const r of [
    [
      [0, 0],
      [0, 1],
      [0, 1],
    ],
    [
      [NaN, 1],
      [0, 1],
      [0, 1],
    ],
    [
      [0, 100],
      [0, 100],
      [0, 100],
    ],
  ])
    assert.throws(() => validateRanges(r));
  assert.throws(() =>
    translatedSites(
      Array(10).fill(site),
      [
        [0, 10],
        [0, 10],
        [0, 10],
      ],
      true,
      100,
    ),
  );
});
test("wireframes repeat and clip fractional cells", () => {
  assert.equal(rangeEdges(defaultRanges()).length / 2, 12);
  assert.equal(
    rangeEdges([
      [0, 1],
      [0, 3],
      [0, 1],
    ]).length / 2,
    20,
  );
  const ranges = [
    [-0.25, 0.5],
    [0.1, 1.5],
    [-1, 0.25],
  ];
  const edges = rangeEdges(ranges);
  assert(
    edges.every((p) =>
      p.every((v, i) => v >= ranges[i][0] && v <= ranges[i][1]),
    ),
  );
  assert(edges.some((p) => p[0] === 0));
});

test("upper decimal face compares the actual translated coordinate", () => {
  const atom = { ...site, frac: [0.01, 0.5, 0.5] };
  const bounds = [[1.01, 2.01], [0, 1], [0, 1]];
  assert.deepEqual(translatedSites([atom], bounds, true).map(a => a.frac[0]), [1.01, 2.01]);
  assert.deepEqual(translatedSites([atom], bounds, false).map(a => a.frac[0]), [1.01]);
});
