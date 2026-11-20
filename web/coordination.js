import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { Vector3 } from "three";

/** Periodic coordination geometry. basis is Cartesian rows, lattice-vector columns.
 * atoms are expanded canonical sites; centres may include displayed boundary images.
 * All coordinates and cutoffs use the structure's Cartesian length unit (Å).
 */
export function buildCoordinationEnvironments({
  basis,
  atoms,
  centres,
  centerElement,
  neighborElement,
  cutoff,
  maxImages = 1000000,
  maxNeighbors = 250000,
}) {
  const finite3 = (a) =>
    Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  if (!Array.isArray(basis) || basis.length !== 3 || !basis.every(finite3))
    throw new Error("Coordination requires a finite 3 × 3 lattice basis.");
  if (!Number.isFinite(cutoff) || cutoff <= 0)
    throw new Error("Coordination cutoff must be a positive finite distance.");
  if (!Number.isInteger(maxImages) || maxImages < 1)
    throw new Error("Coordination image limit must be a positive integer.");
  const [a, b, c] = basis;
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (!Number.isFinite(det) || det === 0)
    throw new Error("Coordination requires a nonsingular lattice.");
  const inverse = [
    [
      b[1] * c[2] - b[2] * c[1],
      a[2] * c[1] - a[1] * c[2],
      a[1] * b[2] - a[2] * b[1],
    ],
    [
      b[2] * c[0] - b[0] * c[2],
      a[0] * c[2] - a[2] * c[0],
      a[2] * b[0] - a[0] * b[2],
    ],
    [
      b[0] * c[1] - b[1] * c[0],
      a[1] * c[0] - a[0] * c[1],
      a[0] * b[1] - a[1] * b[0],
    ],
  ].map((row) => row.map((v) => v / det));
  const reach = inverse.map((row) => cutoff * Math.hypot(...row));
  if (!reach.every(Number.isFinite))
    throw new Error(
      "Lattice is too ill-conditioned for coordination geometry.",
    );
  const selected = (centres || []).filter(
    (atom) => !centerElement || atom.element === centerElement,
  );
  const candidates = atoms
    .map((atom, sourceIndex) => ({ atom, sourceIndex }))
    .filter(({ atom }) => !neighborElement || atom.element === neighborElement);
  for (const atom of [...selected, ...candidates.map((v) => v.atom)])
    if (!finite3(atom.frac))
      throw new Error(
        "Coordination requires finite fractional atom coordinates.",
      );
  if (!selected.length || !candidates.length)
    return selected.map((center) => ({ center, neighbors: [] }));
  const cart = (frac) =>
    basis.map((row) => row.reduce((sum, v, i) => sum + v * frac[i], 0));
  // A reciprocal-row norm bounds each fractional component of ANY Cartesian
  // displacement inside the cutoff sphere, including strongly skew cells.
  const lower = [0, 1, 2].map(
    (i) =>
      selected.reduce((m, v) => Math.min(m, v.frac[i]), Infinity) - reach[i],
  );
  const upper = [0, 1, 2].map(
    (i) =>
      selected.reduce((m, v) => Math.max(m, v.frac[i]), -Infinity) + reach[i],
  );
  let imageCount = 0;
  const ranges = candidates.map(({ atom }) => {
    const ranges = [0, 1, 2].map((i) => [
      Math.ceil(lower[i] - atom.frac[i] - 1e-12),
      Math.floor(upper[i] - atom.frac[i] + 1e-12),
    ]);
    if (ranges.some(([lo, hi]) => lo > hi)) return null;
    if (ranges.some(pair => pair.some(value => !Number.isSafeInteger(value))))
      throw new Error("Coordination image range is too large; reduce the cutoff.");
    imageCount += ranges.reduce(
      (n, [lo, hi]) => n * Math.max(0, hi - lo + 1),
      1,
    );
    if (!Number.isSafeInteger(imageCount) || imageCount > maxImages)
      throw new Error(
        `Coordination needs too many periodic images (limit ${maxImages.toLocaleString()}); reduce the cutoff or use a less extreme lattice.`,
      );
    return ranges;
  });
  // Sparse Cartesian bins avoid scanning every atom for every centre. The
  // global reciprocal bounding box deliberately includes all boundary images.
  const bins = new Map();
  const key = (p) => p.join(",");
  candidates.forEach(({ atom, sourceIndex }, index) => {
    if (!ranges[index]) return;
    const [[x0, x1], [y0, y1], [z0, z1]] = ranges[index];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const frac = atom.frac.map((v, i) => v + [x, y, z][i]);
          const cartesian = cart(frac);
          const bucket = key(cartesian.map((v) => Math.floor(v / cutoff)));
          if (!bins.has(bucket)) bins.set(bucket, []);
          bins
            .get(bucket)
            .push({ atom, sourceIndex, frac, cartesian, image: [x, y, z] });
        }
  });
  let totalNeighbors = 0;
  let neighborChecks = 0;
  return selected.map((center) => {
    const p = cart(center.frac),
      cell = p.map((v) => Math.floor(v / cutoff)),
      neighbors = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const neighbor of bins.get(
            key([cell[0] + x, cell[1] + y, cell[2] + z]),
          ) || []) {
            if (++neighborChecks > 10000000)
              throw new Error(
                "Coordination search is too dense; reduce the cutoff or select fewer centers.",
              );
            const distance = Math.hypot(
              ...p.map((v, i) => neighbor.cartesian[i] - v),
            );
            // Exclude the centre itself, but retain periodic copies at nonzero distance.
            if (distance > 1e-9 && distance <= cutoff + 1e-10) {
              if (++totalNeighbors > maxNeighbors)
                throw new Error(
                  `Coordination exceeds ${maxNeighbors.toLocaleString()} neighbor connections; reduce the cutoff or select fewer centers.`,
                );
              neighbors.push({ ...neighbor, distance });
            }
          }
    neighbors.sort(
      (a, b) =>
        a.distance - b.distance ||
        a.sourceIndex - b.sourceIndex ||
        a.frac[0] - b.frac[0] ||
        a.frac[1] - b.frac[1] ||
        a.frac[2] - b.frac[2],
    );
    return { center, neighbors };
  });
}

// Project a flat ligand shell onto its plane and trace its convex perimeter.
// Require the central atom to lie in the polygon: three ligands on one side
// of an incomplete octahedron do not form planar coordination.
function planarHull(points, vectors, center, xAxis, normal, epsilon) {
  if (!center) return null;
  const origin = vectors[0];
  const offset = new Vector3(...center).sub(origin);
  if (Math.abs(offset.dot(normal)) > epsilon) return null;
  const yAxis = normal.clone().cross(xAxis);
  const projected = vectors.map((v, index) => {
    const d = v.clone().sub(origin);
    return { x: d.dot(xAxis), y: d.dot(yAxis), index };
  }).sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  function halfHull(sequence) {
    const chain = [];
    for (const p of sequence) {
      while (chain.length >= 2 && turn(chain.at(-2), chain.at(-1), p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  }
  const polygon = [...halfHull(projected), ...halfHull(projected.reverse())];
  const c = { x: offset.dot(xAxis), y: offset.dot(yAxis) };
  const edges = [];
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length];
    if (turn(a, b, c) < -epsilon * Math.hypot(b.x - a.x, b.y - a.y)) return null;
    edges.push([a.index, b.index]);
  }
  const faces = polygon.slice(2).map((p, i) => [polygon[0].index, polygon[i + 1].index, p.index]);
  return { vertices: points, faces, edges, planar: true };
}

/** QuickHull of a coordination shell; omit coplanar triangulation seams. */
export function convexHull(points, center = null) {
  if (points.length < 3) return null;
  const vectors = points.map((p) => new Vector3(...p));
  const origin = vectors[0];
  const scale = vectors.reduce((size, p) => Math.max(size, p.distanceTo(origin)), 1);
  const epsilon = scale * 1e-8;
  const along = vectors.find((p) => p.distanceTo(origin) > epsilon);
  if (!along) return null;
  const direction = along.clone().sub(origin).normalize();
  const normal = new Vector3();
  for (const p of vectors) {
    normal.crossVectors(direction, p.clone().sub(origin));
    if (normal.length() > epsilon) break;
  }
  if (normal.length() <= epsilon) return null;
  normal.normalize();
  if (
    !vectors.some((p) => Math.abs(normal.dot(p.clone().sub(origin))) > epsilon)
  )
    return planarHull(points, vectors, center, direction, normal, Math.max(epsilon, scale * 1e-4));
  const indices = new Map(vectors.map((p, i) => [p, i]));
  const hull = new ConvexHull().setFromPoints(vectors);
  const faces = [],
    edges = new Map();
  for (const face of hull.faces) {
    const polygon = [];
    let edge = face.edge;
    do {
      const a = indices.get(edge.tail().point),
        b = indices.get(edge.head().point);
      polygon.push(a);
      // Adjacent triangles with matching outward normals form one planar face.
      if (!edge.twin || face.normal.dot(edge.twin.face.normal) < 1 - 1e-10) {
        const pair = [a, b].sort((x, y) => x - y);
        edges.set(pair.join(","), pair);
      }
      edge = edge.next;
    } while (edge !== face.edge);
    for (let i = 1; i < polygon.length - 1; i++)
      faces.push([polygon[0], polygon[i], polygon[i + 1]]);
  }
  return { vertices: points, faces, edges: [...edges.values()] };
}
