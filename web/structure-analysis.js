// Pure periodic geometry and kinematic powder diffraction. The full,
// symmetry-expanded unit cell is used, independently of display bounds.
import { inverse3, det3, matVec } from "./crystal-math.js";
import { maxScatteringVector, structureFactors } from "./diffraction-engine.js";
export { xrayFormFactor } from "./diffraction-engine.js";
import { pairName, normalizePair } from "./pair-presentation.js";

const positive = (h, k, l) => h > 0 || (h === 0 && (k > 0 || (k === 0 && l > 0)));
const MAX_CHECKS = 8_000_000;
const MAX_PAIRS = 500_000;

export function analysisCell(structure) {
  if (!structure?.atoms?.length) throw Error("Load a crystal structure first.");
  const inverse = inverse3(structure.basis);
  if (!Number.isFinite(det3(structure.basis))) throw Error("Invalid unit cell.");
  const atoms = structure.atoms.filter(a => (a.occupancy ?? 1) > 0).map(a => {
    if (!a.frac?.every(Number.isFinite) || a.frac.length !== 3)
      throw Error("Invalid atomic coordinates.");
    return { ...a, frac: a.frac.map(v => v - Math.floor(v)) };
  });
  if (!atoms.length) throw Error("No occupied sites in this structure.");
  return { atoms, inverse, basis: structure.basis };
}

function inRange(value, lo, hi, name) {
  if (!Number.isFinite(value) || value < lo || value > hi)
    throw Error(`${name} must be between ${lo} and ${hi}.`);
  return value;
}

/** Unordered geometric pairs per cell: i<j with every lattice translation,
 * i=j with one of ±t only. No minimum-image approximation or edge bias.
 * Occupied sites count once; partial occupancies are not statistical weights.
 * A group's full distance spread cannot exceed tolerance (no chaining).
 */
export function distanceDistribution(structure, { rMin = 0, rMax = 6, tolerance = 0.001, pair = "all" } = {}) {
  inRange(rMin, 0, 30, "Minimum distance (Å)");
  inRange(rMax, 0.1, 30, "Maximum distance (Å)");
  if (rMin >= rMax) throw Error("Maximum distance must exceed minimum distance.");
  inRange(tolerance, 0.00001, 0.1, "Distance tolerance (Å)");
  pair = normalizePair(pair);
  const { atoms, inverse, basis } = analysisCell(structure);
  if (atoms.length * (atoms.length + 1) / 2 > MAX_CHECKS)
    throw Error("Too many sites for distance analysis in the browser.");
  const bounds = inverse.map(row => Math.hypot(...row) * rMax);
  const pairs = [];
  let checks = 0;
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i; j < atoms.length; j++) {
      const name = pairName(atoms[i].element, atoms[j].element);
      if (pair !== "all" && pair !== name) continue;
      const delta = atoms[j].frac.map((v, n) => v - atoms[i].frac[n]);
      const limits = bounds.map((v, n) => [Math.ceil(-delta[n] - v - 1e-10), Math.floor(-delta[n] + v + 1e-10)]);
      const candidates = limits.reduce((n, [lo, hi]) => n * Math.max(0, hi - lo + 1), 1);
      checks += candidates;
      if (checks > MAX_CHECKS) throw Error("Distance search is too large; reduce the maximum distance or choose an atom pair.");
      for (let x = limits[0][0]; x <= limits[0][1]; x++)
        for (let y = limits[1][0]; y <= limits[1][1]; y++)
          for (let z = limits[2][0]; z <= limits[2][1]; z++) {
            if (i === j && !positive(x, y, z)) continue;
            const d = Math.hypot(...matVec(basis, delta.map((v, n) => v + [x, y, z][n])));
            if (d <= 1e-8 || d < rMin - 1e-9 || d > rMax + 1e-9) continue;
            if (pairs.length >= MAX_PAIRS) throw Error("Too many distances; reduce the maximum distance or choose an atom pair.");
            pairs.push({ d, name });
          }
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const rows = [];
  for (const { d, name } of pairs) {
    let row = rows.at(-1);
    if (!row || d - row.min > tolerance + 1e-10) {
      row = { distance: 0, min: d, max: d, count: 0, pairs: {} };
      rows.push(row);
    }
    row.distance += d;
    row.max = d;
    row.count++;
    row.pairs[name] = (row.pairs[name] || 0) + 1;
  }
  rows.forEach(row => row.distance /= row.count);
  if (rows.length > 8000) throw Error("Too many distinct distances to plot; narrow the range, select an atom pair or increase the grouping tolerance.");
  return { rows, rMin, rMax, tolerance, count: pairs.length, partialOccupancy: atoms.some(a => (a.occupancy ?? 1) !== 1) };
}

/** Powder lines: sum |F(hkl)|² over all reciprocal vectors at each d.
 * Friedel mates contribute a factor of two; multiplicity is enumerated,
 * including accidental overlap, never inferred from a crystal system.
 * Conventional unpolarized powder LP = (1+cos²2θ)/(sin²θ cosθ).
 */
export function powderPattern(structure, { wavelength = 1.5406, twoThetaMin = 5, twoThetaMax = 90 } = {}) {
  inRange(wavelength, 0.01, 5, "Wavelength (Å)");
  inRange(twoThetaMin, 0.1, 170, "Minimum 2θ (°)");
  inRange(twoThetaMax, 0.1, 170, "Maximum 2θ (°)");
  if (twoThetaMin >= twoThetaMax) throw Error("Maximum 2θ must exceed minimum 2θ.");
  const { atoms, basis, inverse } = analysisCell(structure);

  const qMax = 2 * Math.sin(twoThetaMax * Math.PI / 360) / wavelength;
  if (qMax / 2 > maxScatteringVector) throw Error("PhaseSmith X-ray form factors require sin(θ)/λ ≤ 6 Å⁻¹.");
  const qMin = 2 * Math.sin(twoThetaMin * Math.PI / 360) / wavelength;
  const limits = [0, 1, 2].map(i => Math.floor(Math.hypot(...basis.map(row => row[i])) * qMax + 1e-9));
  if (limits.reduce((n, v) => n * (2 * v + 1), 1) > MAX_CHECKS)
    throw Error("Too many reflections; reduce maximum 2θ or increase the wavelength.");
  const lines = [];
  let checks = 0;
  const batch = [];
  function flush() {
    if (!batch.length) return;
    const intensities = structureFactors({ atoms, basis }, batch.map(line => line.hkl), { powder_wavelength: wavelength });
    batch.forEach((line, i) => {
      if (!intensities[i]) return;
      if (lines.length >= 100_000) throw Error("Too many powder lines; reduce maximum 2θ or increase the wavelength.");
      lines.push({ ...line, intensity: 2 * intensities[i] });
    });
    batch.length = 0;
  }
  for (let h = 0; h <= limits[0]; h++)
    for (let k = -limits[1]; k <= limits[1]; k++)
      for (let l = -limits[2]; l <= limits[2]; l++) {
        if (!positive(h, k, l)) continue;
        const q = Math.hypot(...[0, 1, 2].map(i => inverse[0][i] * h + inverse[1][i] * k + inverse[2][i] * l));
        if (q < qMin - 1e-10 || q > qMax + 1e-10) continue;
        checks += atoms.length;
        if (checks > MAX_CHECKS) throw Error("Structure-factor calculation is too large; reduce maximum 2θ or increase the wavelength.");
        const theta = Math.asin(Math.min(1, wavelength * q / 2));
        batch.push({ twoTheta: theta * 360 / Math.PI, d: 1 / q, hkl: [h, k, l] });
        if (batch.length >= 4096) flush();
      }
  flush();
  lines.sort((a, b) => a.twoTheta - b.twoTheta);
  const rows = [];
  for (const line of lines) {
    let row = rows.at(-1);
    if (!row || line.twoTheta - row.twoTheta > 1e-5) {
      row = { twoTheta: line.twoTheta, d: line.d, intensity: 0, multiplicity: 0, hkls: [] };
      rows.push(row);
    }
    row.intensity += line.intensity;
    row.multiplicity += 2;
    row.hkls.push(line.hkl);
  }
  const max = rows.reduce((m, row) => Math.max(m, row.intensity), 0);
  if (rows.length > 8000) throw Error("Too many powder lines to plot; narrow the 2θ range.");
  rows.forEach(row => row.intensity = 100 * row.intensity / max);
  return { rows, wavelength, twoThetaMin, twoThetaMax };
}

function samplePowderProfile(rows, min, max, fwhm, points) {
  inRange(fwhm, 0.01, 2, "Peak width (° 2θ)");
  const sigma = fwhm / Math.sqrt(8 * Math.log(2));
  const y = new Float64Array(points);
  const step = (max - min) / (points - 1);
  for (const row of rows) {
    const lo = Math.max(0, Math.ceil((row.twoTheta - 5 * sigma - min) / step));
    const hi = Math.min(points - 1, Math.floor((row.twoTheta + 5 * sigma - min) / step));
    for (let i = lo; i <= hi; i++) y[i] += row.intensity * Math.exp(-0.5 * ((min + i * step - row.twoTheta) / sigma) ** 2);
  }
  return { y, step };
}

/** Unnormalized Gaussian profile peak over [min, max] for consistent zoom scaling. */
export function powderProfilePeak(rows, min, max, fwhm, points = Math.max(1600, Math.ceil((max - min) / fwhm * 8) + 1)) {
  if (!rows?.length || !(max > min)) return 1;
  const { y } = samplePowderProfile(rows, min, max, fwhm, points);
  return y.reduce((a, b) => Math.max(a, b), 0) || 1;
}

/** Gaussian visualization only; integrated line intensity is conserved
 * before scaling the displayed profile maximum to 100. Width is in 2θ. */
export function powderProfile(
  rows,
  min,
  max,
  fwhm,
  points = Math.max(1600, Math.ceil((max - min) / fwhm * 8) + 1),
  normalizeTo = null,
) {
  const { y, step } = samplePowderProfile(rows, min, max, fwhm, points);
  const peak = (normalizeTo > 0 ? normalizeTo : y.reduce((a, b) => Math.max(a, b), 0)) || 1;
  return Array.from(y, (v, i) => [min + i * step, 100 * v / peak]);
}
