import test from "node:test";
import assert from "node:assert/strict";
import { distanceDistribution, powderPattern, powderProfile, xrayFormFactor } from "../web/structure-analysis.js";

const cubic = (a = 4, atoms = [{ element: "Cu", frac: [0, 0, 0] }]) => ({ basis: [[a, 0, 0], [0, a, 0], [0, 0, a]], atoms });
const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("simple cubic shells count unordered pairs once per cell, including periodic self images", () => {
  const result = distanceDistribution(cubic(), { rMax: 7 });
  assert.deepEqual(result.rows.map(r => r.count), [3, 6, 4]);
  result.rows.forEach((r, i) => close(r.distance, 4 * Math.sqrt(i + 1)));
  assert.equal(result.count, 13);
  const range = distanceDistribution(cubic(), { rMin: 5, rMax: 6 });
  assert.equal(range.rows.length, 1);
  assert.equal(range.rows[0].count, 6);
});

test("unlike pairs crossing cell faces count correctly and pair filters preserve multiplicity", () => {
  const structure = cubic(4, [{ element: "Na", frac: [0, 0, 0] }, { element: "Cl", frac: [0.5, 0, 0] }]);
  const result = distanceDistribution(structure, { rMax: 4.1 });
  assert.deepEqual(result.rows.map(r => r.count), [2, 6]);
  assert.deepEqual(result.rows[0].pairs, { "Cl–Na": 2 });
  assert.deepEqual(result.rows[1].pairs, { "Cl–Cl": 3, "Na–Na": 3 });
  assert.equal(distanceDistribution(structure, { rMax: 4.1, pair: "Cl–Na" }).count, 2);
  const translated = { ...structure, atoms: structure.atoms.map(a => ({ ...a, frac: a.frac.map(v => v + 2.3) })) };
  const shifted = distanceDistribution(translated, { rMax: 4.1 });
  assert.deepEqual(shifted.rows.map(r => r.count), result.rows.map(r => r.count));
  shifted.rows.forEach((r, i) => close(r.distance, result.rows[i].distance));
});

test("neighbor bounds remain complete after extreme cell shear requiring distant translations", () => {
  // Same lattice as the cubic cell: b' = 9a + b. Nearest images need |t_a|=9.
  const sheared = { ...cubic(), basis: [[4, 36, 0], [0, 4, 0], [0, 0, 4]] };
  const expected = distanceDistribution(cubic(), { rMax: 7 });
  const actual = distanceDistribution(sheared, { rMax: 7 });
  assert.deepEqual(actual.rows.map(r => r.count), expected.rows.map(r => r.count));
  actual.rows.forEach((r, i) => close(r.distance, expected.rows[i].distance));
});

test("distance groups cannot chain past the tolerance and partial sites remain geometric", () => {
  const structure = { basis: [[1, 0, 0], [0, 1.0008, 0], [0, 0, 1.0016]], atoms: [{ element: "Cu", frac: [0, 0, 0], occupancy: 0.5 }] };
  const result = distanceDistribution(structure, { rMax: 1.1, tolerance: 0.001 });
  assert.deepEqual(result.rows.map(r => r.count), [2, 1]);
  close(result.rows[0].distance, 1.0004);
  assert.equal(result.partialOccupancy, true);
  assert.ok(result.rows.every(r => r.max - r.min <= 0.001));
});

test("FCC copper reflection positions, multiplicities and extinctions match analytic rules", () => {
  const structure = cubic(3.615, [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]].map(frac => ({ element: "Cu", frac })));
  const result = powderPattern(structure);
  assert.deepEqual(result.rows.slice(0, 4).map(r => r.multiplicity), [8, 6, 12, 24]);
  for (const row of result.rows)
    for (const hkl of row.hkls) assert.ok(hkl.every(v => Math.abs(v % 2) === Math.abs(hkl[0] % 2)), `forbidden FCC ${hkl}`);
  [3, 4, 8, 11].forEach((n, i) => {
    close(result.rows[i].d, 3.615 / Math.sqrt(n));
    close(result.rows[i].twoTheta, 360 / Math.PI * Math.asin(1.5406 * Math.sqrt(n) / (2 * 3.615)));
  });
  close(result.rows[0].twoTheta, 43.317, 0.0005);
  close(Math.max(...result.rows.map(r => r.intensity)), 100);
});

test("BCC extinctions and skew reciprocal metric survive a unimodular cell change", () => {
  const bcc = cubic(4, [{ element: "Fe", frac: [0, 0, 0] }, { element: "Fe", frac: [0.5, 0.5, 0.5] }]);
  const expected = powderPattern(bcc);
  for (const r of expected.rows) for (const [h, k, l] of r.hkls) assert.equal(Math.abs((h + k + l) % 2), 0);
  close(expected.rows[0].d, 4 / Math.sqrt(2));
  const skew = { basis: [[4, 8, 0], [0, 4, 0], [0, 0, 4]], atoms: bcc.atoms.map(a => ({ ...a, frac: [a.frac[0] - 2 * a.frac[1], a.frac[1], a.frac[2]] })) };
  const actual = powderPattern(skew);
  assert.equal(actual.rows.length, expected.rows.length);
  actual.rows.forEach((row, i) => {
    close(row.d, expected.rows[i].d);
    close(row.intensity, expected.rows[i].intensity);
    assert.equal(row.multiplicity, expected.rows[i].multiplicity);
  });
});

test("occupancy changes relative structure factors and wavelength obeys Bragg's law", () => {
  const base = cubic(4, [{ element: "Cu", frac: [0, 0, 0] }, { element: "Cu", frac: [0.5, 0.5, 0.5], occupancy: 1 }]);
  const occupied = powderPattern(base);
  const partial = powderPattern({ ...base, atoms: base.atoms.map((a, i) => ({ ...a, occupancy: i ? 0.5 : 1 })) });
  assert.ok(partial.rows[0].d > occupied.rows[0].d, "partial occupancy lifts body-centering extinction");
  const shorter = powderPattern(base, { wavelength: 0.7 });
  close(shorter.rows[0].d, occupied.rows[0].d);
  close(Math.sin(shorter.rows[0].twoTheta * Math.PI / 360) / Math.sin(occupied.rows[0].twoTheta * Math.PI / 360), 0.7 / 1.5406);
});

test("neutral form factors and Gaussian FWHM have independent reference values", () => {
  close(xrayFormFactor("Fe", 0), 25.9904);
  close(xrayFormFactor("Fe", 0.5), 11.505687515802265);
  close(xrayFormFactor("D", 0.2), xrayFormFactor("H", 0.2));
  const profile = powderProfile([{ twoTheta: 20, intensity: 42 }], 19, 21, 0.2, 2001);
  close(profile[1000][1], 100);
  close(profile[900][1], 50);
  close(profile[1100][1], 50);
});

test("invalid ranges, unsupported elements and oversized searches fail explicitly", () => {
  assert.throws(() => distanceDistribution(cubic(), { rMin: 7, rMax: 6 }), /exceed/);
  assert.throws(() => distanceDistribution(cubic(), { rMax: NaN }), /Maximum/);
  assert.throws(() => distanceDistribution(cubic(), { tolerance: 0 }), /tolerance/);
  assert.throws(() => distanceDistribution(cubic(0.01)), /too large/);
  assert.throws(() => powderPattern(cubic(1000)), /Too many reflections/);
  assert.throws(() => powderPattern(cubic(), { twoThetaMin: 100 }), /exceed/);
  assert.throws(() => powderPattern(cubic(), { wavelength: 0.1 }), /sin/);
  assert.throws(() => xrayFormFactor("Og", 0.1), /No X-ray/);
  assert.throws(() => xrayFormFactor("Fe", 2), /sin/);
});
