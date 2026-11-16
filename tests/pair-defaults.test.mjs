import test from "node:test";
import assert from "node:assert/strict";
import { estimatePairCutoff } from "../web/pair-defaults.js";
import { ELEMENT_DEFAULTS, elementColor } from "../web/elements.js";
import { buildCoordinationEnvironments } from "../web/coordination.js";

const cubic = (edge) => [[edge, 0, 0], [0, edge, 0], [0, 0, edge]];

test("rock-salt estimate selects six neighbors and follows lattice compression", () => {
  for (const edge of [5.64, 3.8]) {
    const structure = { basis: cubic(edge), atoms: [
      ...[[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]].map(
        (frac) => ({ element: "Na", label: "Na1", frac })),
      ...[[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]].map(
        (frac) => ({ element: "Cl", label: "Cl1", frac })),
    ] };
    const cutoff = estimatePairCutoff(structure, "Na", "Cl");
    assert.ok(cutoff > edge / 2 && cutoff < edge * Math.sqrt(3) / 2);
    const shells = buildCoordinationEnvironments({ ...structure,
      centres: structure.atoms.filter((a) => a.element === "Na"),
      neighborElement: "Cl", cutoff,
    });
    assert.deepEqual(shells.map((s) => s.neighbors.length), [6, 6, 6, 6]);
  }
});

test("distorted tetrahedron retains all four neighbors across a cell face", () => {
  const structure = { basis: cubic(20), atoms: [
    { element: "Si", label: "Si1", frac: [0, 0, 0] },
    ...[[1.55, 0, 0], [0, 1.62, 0], [0, 0, 1.67], [-1, -1, -1]].map(
      (p, i) => ({ element: "O", label: `O${i}`, frac: p.map((v) => (v / 20 + 1) % 1) })),
    { element: "O", label: "outer", frac: [0.16, 0, 0] },
  ] };
  const cutoff = estimatePairCutoff(structure, "Si", "O");
  assert.ok(cutoff > Math.sqrt(3) && cutoff < 3.2, cutoff);
  const [shell] = buildCoordinationEnvironments({ ...structure,
    centres: [structure.atoms[0]], neighborElement: "O", cutoff,
  });
  assert.equal(shell.neighbors.length, 4);
});

test("same-element estimate excludes self and includes periodic neighbors in skew cells", () => {
  const structure = { basis: [[4, 19, 0], [0, 1, 0], [0, 0, 5]],
    atoms: [{ element: "Fe", label: "Fe1", frac: [0, 0, 0] }],
  };
  const cutoff = estimatePairCutoff(structure, "Fe", "Fe");
  // ±(b − 5a) are the nearest periodic images, at sqrt(2) Å.
  assert.ok(cutoff > Math.sqrt(2) && cutoff < Math.sqrt(8), cutoff);
  const [shell] = buildCoordinationEnvironments({ ...structure,
    centres: structure.atoms, neighborElement: "Fe", cutoff,
  });
  assert.equal(shell.neighbors.length, 2);
});

test("each independent center contributes its longer first shell", () => {
  const structure = { basis: cubic(30), atoms: [
    { element: "Mg", label: "Mg1", frac: [0, 0, 0] },
    { element: "Mg", label: "Mg2", frac: [0.5, 0.5, 0.5] },
    { element: "O", label: "O1", frac: [2 / 30, 0, 0] },
    { element: "O", label: "O2", frac: [0.5 + 2.4 / 30, 0.5, 0.5] },
  ] };
  assert.ok(estimatePairCutoff(structure, "Mg", "O") > 2.4);
});

test("sparse cells expand the search and pathological cells fall back safely", () => {
  const sparse = { basis: cubic(15), atoms: [
    { element: "Na", label: "Na1", frac: [0, 0, 0] },
    { element: "Cl", label: "Cl1", frac: [0.5, 0, 0] },
  ] };
  assert.ok(estimatePairCutoff(sparse, "Na", "Cl") > 7.5);
  const dense = { ...sparse, basis: cubic(0.001) };
  const fallback = estimatePairCutoff(dense, "Na", "Cl");
  assert.ok(Number.isFinite(fallback) && fallback > 0);
  assert.notEqual(estimatePairCutoff(null, "H", "H"), estimatePairCutoff(null, "Ca", "O"));
});

test("all 118 elements have colors and common mineral elements are distinguishable", () => {
  assert.equal(Object.keys(ELEMENT_DEFAULTS).length, 118);
  for (const [color, radius] of Object.values(ELEMENT_DEFAULTS)) {
    assert.match(color, /^#[\da-f]{6}$/);
    assert.ok(Number.isFinite(radius) && radius > 0);
  }
  const common = ["O", "Si", "Mg", "Al", "Ca", "Fe", "Na", "Ti"];
  assert.equal(new Set(common.map(elementColor)).size, common.length);
  assert.notEqual(elementColor("Nb"), elementColor("Zr"));
});
