// PhaseSmith reciprocal bases store a*, b*, c* as rows (Å⁻¹, without 2π).
// U acts on Cartesian columns. Recover the crystal frame using a and a × b,
// the same a-along-x, b-in-xy convention as PhaseSmith orientation_matrix().
import { det3, inverse3, matMul, matVec } from "./crystal-math.js";

export const identity = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const transpose = (m) => m[0].map((_, i) => m.map((row) => row[i]));
export const dot3 = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const triple = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export function unitAxis(v) {
  if (!triple(v) || Math.hypot(...v) < 1e-12)
    throw Error("Enter three finite axis components with nonzero length.");
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
}
export function numbers(text) {
  return text
    .trim()
    .replaceAll("−", "-")
    .split(/[\s,;\[\]()]+/)
    .filter(Boolean)
    .map(Number);
}
export function readMatrix(text) {
  const vals = numbers(text);
  if (vals.length !== 9 || !vals.every(Number.isFinite))
    throw Error("Enter nine matrix elements in row order.");
  return [vals.slice(0, 3), vals.slice(3, 6), vals.slice(6)];
}
function cartesianFrame(basis) {
  const [a, b] = transpose(basis);
  const x = unitAxis(a),
    z = unitAxis(cross3(a, b));
  return transpose([x, cross3(z, x), z]);
}
export const poniFrame = [
  [0, 0, 1],
  [0, -1, 0],
  [1, 0, 0],
]; // beam along PONI 3, PONI 1 displayed up
export function mountingMatrix(matrix, type, frame, basis) {
  if (!Array.isArray(matrix) || matrix.length !== 3 || !matrix.every(triple) || !(det3(matrix) > 0))
    throw Error("Use a finite, right-handed 3 × 3 matrix.");
  let direct = matrix;
  if (type === "U") {
    const gram = matMul(transpose(matrix), matrix);
    if (gram.some((row, i) => row.some((x, j) => Math.abs(x - Number(i === j)) > 0.002)))
      throw Error("U must be a rotation. For a reciprocal basis, select UB or PhaseSmith rows.");
  } else direct = inverse3(type === "UB" ? transpose(matrix) : matrix);
  return matMul(frame, matMul(cartesianFrame(direct), transpose(cartesianFrame(basis))));
}
export function orientationExport(data) {
  const entries = data.orientations ?? [data];
  if (!Array.isArray(entries) || !entries.length) throw Error("No orientation candidates in this JSON.");
  const candidates = entries.map((entry, i) => {
    const name = String(entry.candidate ?? entry.name ?? i + 1);
    for (const [field, type] of [
      ["orientation_matrix", "U"],
      ["orientation_rows", "U"],
      ["reciprocal_basis_rows_inverse_angstrom", "rows"],
      ["reciprocal_basis", "rows"],
      ["UB_column_convention_q_equals_UB_times_hkl", "UB"],
    ]) {
      if (entry[field]) {
        const matrix = entry[field];
        if (!Array.isArray(matrix) || matrix.length !== 3 || !matrix.every(triple))
          throw Error("Invalid matrix in candidate " + name + ".");
        return { name, type, matrix: field === "orientation_rows" ? transpose(matrix) : matrix };
      }
    }
    throw Error("No PhaseSmith orientation or reciprocal basis in candidate " + name + ".");
  });
  const vectors = data.phase_smith_plane_vectors_m_and_directions ?? data.geometry?.vectors;
  if (!vectors) return { candidates };
  const beam = unitAxis(vectors[3]),
    spindle = unitAxis(vectors[4]);
  // Define up using the transverse part of the spindle. Preserve its actual
  // component along the beam, including inclined and beam-parallel axes.
  let side = cross3(spindle, beam);
  if (Math.hypot(...side) < 1e-8) side = cross3(Math.abs(beam[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], beam);
  const y = unitAxis(side),
    frame = [beam, y, cross3(beam, y)];
  return { candidates, frame, axis: matVec(frame, spindle) };
}
