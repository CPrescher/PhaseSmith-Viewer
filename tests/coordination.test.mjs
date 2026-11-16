import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoordinationEnvironments as build,
  convexHull,
} from "../web/coordination.js";
const basis = [
  [10, 0, 0],
  [0, 10, 0],
  [0, 0, 10],
];
const atom = (element, frac) => ({ element, frac });
function shell(points, cutoff = 2) {
  const center = atom("Si", [0.5, 0.5, 0.5]);
  return build({
    basis,
    atoms: [
      center,
      ...points.map((p) =>
        atom(
          "O",
          p.map((v) => 0.5 + v / 10),
        ),
      ),
    ],
    centres: [center],
    centerElement: "Si",
    neighborElement: "O",
    cutoff,
  })[0];
}
test("distorted tetrahedron and octahedron shells retain physical distances", () => {
  const tetra = shell([
    [1, 1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, -1, -0.9],
  ]);
  assert.equal(tetra.neighbors.length, 4);
  assert.equal(
    convexHull(tetra.neighbors.map((n) => n.cartesian)).faces.length,
    4,
  );
  const oct = shell([
    [1.1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0.05, 0, -1],
  ]);
  assert.equal(oct.neighbors.length, 6);
  assert.equal(
    convexHull(oct.neighbors.map((n) => n.cartesian)).edges.length,
    12,
  );
});
test("boundary centers have complete translation-invariant environments outside cell", () => {
  const c = atom("Si", [0, 0, 0]),
    o = atom("O", [0.95, 0, 0]);
  const environments = build({
    basis,
    atoms: [c, o],
    centres: [c, { ...c, frac: [1, 0, 0] }],
    centerElement: "Si",
    neighborElement: "O",
    cutoff: 1,
  });
  assert.deepEqual(
    environments.map((e) => e.neighbors.length),
    [1, 1],
  );
  assert.ok(environments[0].neighbors[0].frac[0] < 0);
  assert.ok(Math.abs(environments[0].neighbors[0].distance - 0.5) < 1e-12);
  assert.ok(Math.abs(environments[1].neighbors[0].distance - 0.5) < 1e-12);
});
test("same-element shell excludes self and includes nonzero periodic copies", () => {
  const c = atom("Na", [0, 0, 0]);
  const result = build({
    basis: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    atoms: [c],
    centres: [c],
    centerElement: "Na",
    neighborElement: "Na",
    cutoff: 1.01,
  });
  assert.equal(result[0].neighbors.length, 6);
});
test("strongly skew column lattice finds distant fractional images", () => {
  const c = atom("X", [0, 0, 0]);
  const result = build({
    basis: [
      [1, 5.1, 0],
      [0, 0.1, 0],
      [0, 0, 3],
    ],
    atoms: [c],
    centres: [c],
    cutoff: 0.15,
  });
  assert.equal(result[0].neighbors.length, 2);
  assert.ok(result[0].neighbors.some((n) => Math.abs(n.image[0]) === 5));
  assert.ok(
    result[0].neighbors.every(
      (n) => Math.abs(n.distance - Math.sqrt(0.02)) < 1e-10,
    ),
  );
});
test("cube hull excludes coplanar diagonals and planar shells have no volume", () => {
  const cube = Array.from({ length: 8 }, (_, i) => [
    i & 1,
    (i >> 1) & 1,
    (i >> 2) & 1,
  ]);
  assert.equal(convexHull(cube).edges.length, 12);
  assert.equal(convexHull(cube).faces.length, 12);
  assert.equal(
    convexHull([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]),
    null,
  );
});
test("huge periodic requests fail before allocation", () => {
  const c = atom("X", [0, 0, 0]);
  assert.throws(
    () =>
      build({
        basis: [
          [1e-8, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        atoms: [c],
        centres: [c],
        cutoff: 1,
      }),
    /too many periodic images/,
  );
});

test("dense shells stop at a bounded total connection count", () => {
  const center = atom("X", [0.5, 0.5, 0.5]);
  const atoms = Array.from({ length: 20 }, (_, i) =>
    atom("O", [0.5 + (i + 1) * 0.001, 0.5, 0.5]),
  );
  assert.throws(
    () =>
      build({ basis, atoms, centres: [center], cutoff: 1, maxNeighbors: 10 }),
    /neighbor connections/,
  );
});
test("QuickHull supports large shells without a combinatorial triangle search", () => {
  const points = Array.from({ length: 300 }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / 300;
    const r = Math.sqrt(1 - z * z),
      phi = i * Math.PI * (3 - Math.sqrt(5));
    return [r * Math.cos(phi), r * Math.sin(phi), z];
  });
  const hull = convexHull(points);
  assert.equal(hull.faces.length, 596);
  assert.equal(hull.edges.length, 894);
});
