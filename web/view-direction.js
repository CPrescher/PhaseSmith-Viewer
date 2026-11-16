import { inverse3, matVec } from "./crystal-math.js";

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

/** Describe the crystal-to-viewer eye vector in direct-lattice coordinates.
 *  Small integer directions are recognized at numerical precision; all
 *  other views are explicitly approximate, normalized to max |u,v,w|=1. */
export function describeViewDirection(basis, eye) {
  const triple = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  if (!Array.isArray(basis) || basis.length !== 3 || !basis.every(triple) || !triple(eye))
    throw Error("Viewing direction needs a finite basis and eye vector.");
  const bScale = Math.max(...basis.flat().map(Math.abs));
  const eScale = Math.max(...eye.map(Math.abs));
  if (!(bScale > 0 && eScale > 0)) throw Error("Viewing direction must be nonzero.");
  const frac = matVec(inverse3(basis.map(row => row.map(v => v / bScale))), eye.map(v => v / eScale));
  const scale = Math.max(...frac.map(Math.abs));
  const normalized = frac.map(v => v / scale);
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  const text = values => `[${values.map(v => String(v).replace(/-/g,"−")).join(" ")}]`;
  for (let n = 1; n <= 24; n++) {
    const candidate = normalized.map(v => Math.round(v*n));
    if (!candidate.every((v,i) => Math.abs(v/n-normalized[i]) < 1e-7)) continue;
    const divisor = candidate.reduce((g,v) => gcd(g,Math.abs(v)),0);
    const components = candidate.map(v => v/divisor || 0);
    return {text:text(components),approximate:false,components};
  }
  return {text:`≈ ${text(normalized.map(v => Number(v.toFixed(2))))}`,approximate:true,components:normalized};
}
