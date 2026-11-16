/** Camera direction for direct lattice indices [uvw].
 * basis contains Cartesian rows and direct lattice-vector columns.
 * Place the camera at target + distance * direction and point it at target.
 */
export function latticeViewDirection(basis, indices) {
  const finiteTriple = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (
    !Array.isArray(basis) ||
    basis.length !== 3 ||
    !basis.every(finiteTriple)
  ) {
    throw new Error("View direction requires a finite 3 × 3 lattice basis.");
  }
  if (!finiteTriple(indices)) {
    throw new Error(
      "View direction requires three finite direct lattice indices [uvw].",
    );
  }
  const normalize = (values) => {
    const scale = Math.max(...values.map(Math.abs));
    if (!Number.isFinite(scale) || scale === 0) {
      throw new Error("View direction must be nonzero in Cartesian space.");
    }
    const scaled = values.map((value) => value / scale);
    const length = Math.hypot(...scaled);
    return scaled.map((value) => value / length);
  };
  // Scale inputs independently before multiplication to avoid overflow while
  // preserving the Cartesian orientation even for very large index values.
  const indexScale = Math.max(...indices.map(Math.abs));
  const basisScale = Math.max(...basis.flat().map(Math.abs));
  if (indexScale === 0 || basisScale === 0) {
    throw new Error("View direction must be nonzero in Cartesian space.");
  }
  const direction = normalize(
    basis.map((row) =>
      row.reduce(
        (sum, value, index) =>
          sum + (value / basisScale) * (indices[index] / indexScale),
        0,
      ),
    ),
  );
  const projectUp = (column) => {
    const axis = normalize(basis.map((row) => row[column]));
    const parallel = axis.reduce(
      (sum, value, index) => sum + value * direction[index],
      0,
    );
    return axis.map((value, index) => value - parallel * direction[index]);
  };
  // Near an axis, projected up is unstable; use another direct lattice vector.
  let projected = projectUp(2);
  if (Math.hypot(...projected) < 1e-4) projected = projectUp(1);
  if (Math.hypot(...projected) < 1e-10) {
    throw new Error(
      "Lattice vectors cannot define a stable camera up direction.",
    );
  }
  return { direction, up: normalize(projected) };
}
