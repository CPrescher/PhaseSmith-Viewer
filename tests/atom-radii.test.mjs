import test from "node:test";
import assert from "node:assert/strict";
import { hasMineralIonPair, radiusReference } from "../web/atom-radii.js";

const radii = (site, choice) => radiusReference(site, "ionic", true, choice);

test("representative mineral ions, explicit charges, and site choices", () => {
  assert.equal(radii({element: "Si"}).radius, 0.26);
  assert.equal(radii({element: "O"}).radius, 1.40);
  assert.equal(radii({element: "Mg"}).radius, 0.72);
  assert.equal(radii({element: "Fe", charge: 3}).radius, 0.645);
  assert.equal(radii({element: "Fe", charge: 3}, "3/VI_LS").radius, 0.55);
  assert.equal(radii({element: "Si"}, "4/VI").radius, 0.4);
});

test("elemental, ambiguous, and unsupported ions use explicit fallbacks", () => {
  const metal = [{element: "Mg"}];
  assert.equal(hasMineralIonPair(metal), false);
  assert.equal(radiusReference(metal[0], "ionic", false).radius, 1.39);
  assert.equal(hasMineralIonPair([...metal, {element: "O"}]), true);
  assert.equal(radii({element: "Fe"}).radius, 1.16);
  assert.match(radii({element: "S", charge: -1}).label, /Covalent fallback/);
});

test("neutral atom size follows the corrected free-atom table regardless of site chemistry", () => {
  for (const charge of [0, 2, 3]) {
    const site = {element: "Fe", charge};
    assert.equal(radiusReference(site, "atomic", true, "3/IV_HS").radius, 2.37);
  }
  assert.equal(radiusReference({element: "O", charge: -2}, "atomic", true, "covalent").radius, 1.71);
  assert.match(radiusReference({element: "Og"}, "atomic", false).label, /Schematic/);
});
