import test from "node:test";
import assert from "node:assert/strict";
import { createSiteCoordination } from "../web/site-coordination.js";

// One Mg and two F atoms in the basis. With a 4 Å repeat along x each
// cation has two periodic F and each F touches one Mg inside the cutoff.
const Mg = { element: "Mg", label: "M", frac: [0, 0, 0] };
const F = { element: "F", label: "X", frac: [0.25, 0, 0] };
const atoms = [Mg, F, {...F, frac: [0.75, 0, 0]}];
const structure = { atoms, basis: [[4, 0, 0], [0, 14, 0], [0, 0, 14]] };
test("periodic shell counts, reciprocal site multiplicity, duplicate rules, and live cutoff changes", () => {
  const assess = createSiteCoordination(structure, [Mg, F]);
  const pairs = [{ center: "F", neighbor: "Mg", cutoff: 3.05 }];
  assert.deepEqual(Object.fromEntries(assess([])), {M: 2, X: 1});
  assert.deepEqual(Object.fromEntries(assess(pairs)), {M: 4, X: 2});
  assert.deepEqual(Object.fromEntries(assess([...pairs, {center: "Mg", neighbor: "F", cutoff: 1.1}])), {M: 4, X: 2});
  assert.deepEqual(Object.fromEntries(assess([])), {M: 2, X: 1});
  assert.deepEqual(Object.fromEntries(assess([{...pairs[0], cutoff: 0.5}])), {M: 0, X: 0});
});

test("disorder or unclassified sites leave the assessment unavailable", () => {
  assert.equal(createSiteCoordination(structure, [Mg, {...F, occupancy: 0.5}])([]).size, 0);
  assert.equal(createSiteCoordination(structure, [Mg, F, {element: "Xe", label: "X2"}])([]).size, 0);
});
