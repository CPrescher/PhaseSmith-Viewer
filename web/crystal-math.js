// Pure crystallographic geometry for planes, directions, angles, polyhedron
// volumes and symmetry elements. No Three.js, no DOM: testable in Node.
//
// Conventions: `basis` has Cartesian rows and direct lattice-vector
// columns, so cart = basis · frac. Fractional coordinates are triples.
// Symmetry operations act on fractional coordinates: x' = W x + w.

export const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

export function inverse3(m) {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) throw Error("Singular lattice basis");
  const c = (r1, c1, r2, c2) => m[r1][c1] * m[r2][c2] - m[r1][c2] * m[r2][c1];
  return [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
  ];
}
export const matVec = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
export const matMul = (a, b) =>
  a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const scale = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export const toCartesian = (basis, frac) => matVec(basis, frac);

// ---- Index parsing ----------------------------------------------------------
/** Miller indices accept signed decimal integers, with spaces required for
 *  multi-digit indices. Three compact single-digit indices are unambiguous. */
export function parseMillerIndices(text) {
  const t = String(text).replace(/−/g, "-").trim();
  if (!/^[0-9 -]+$/.test(t))
    throw Error("Use digits, spaces and minus signs for h k l.");
  if (!t.includes(" ") && (t.match(/\d/g)?.length ?? 0) > 3)
    throw Error("Separate multi-digit indices with spaces, e.g. 12 3 4.");
  if (!/^-?\d-?\d-?\d$/.test(t) && !/^-?\d+ +-?\d+ +-?\d+$/.test(t))
    throw Error("Enter three indices, e.g. 1 1 0 or 1 -1 0.");
  const values = parseTriple(t, { integer: true });
  if (!values.every(Number.isSafeInteger))
    throw Error("Miller indices are too large.");
  if (values.every((v) => v === 0))
    throw Error("Miller indices must not all be zero.");
  return values;
}

/** "1 -1 0", "1,-1,0", "[1-10]", "(110)" → three numbers; compact form only
 *  for three single digits. */
export function parseTriple(text, { integer = false, label = "indices" } = {}) {
  const t = String(text).replace(/−/g, "-").replace(/[\[\](),]/g, " ").trim();
  const fields = /^[+-]?\d[+-]?\d[+-]?\d$/.test(t) ? t.match(/[+-]?\d/g) : t.split(/\s+/);
  const values = fields.map(Number);
  if (values.length !== 3 || values.some((v) => !Number.isFinite(v)))
    throw Error(`Enter three ${label}, such as 1 1 0 or 1 -1 0.`);
  if (integer && values.some((v) => !Number.isInteger(v)))
    throw Error(`Miller ${label} must be integers.`);
  return values;
}

// ---- Lattice planes (hkl) ---------------------------------------------------
/** Integer offset nearest the displayed center, preferring an interior
 *  intersection. Without an interior integer, use a boundary/nearest
 *  integer; narrow fractional extents may contain no integer-offset plane. */
export function initialPlaneOffset(hkl, ranges) {
  const center = dot(hkl, ranges.map(([lo, hi]) => lo + (hi - lo) / 2));
  const limits = ranges.map(([lo, hi], i) => [hkl[i] * lo, hkl[i] * hi]);
  const min = limits.reduce((sum, v) => sum + Math.min(...v), 0);
  const max = limits.reduce((sum, v) => sum + Math.max(...v), 0);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lo = Math.floor(min) + 1, hi = Math.ceil(max) - 1;
  if (lo <= hi) {
    // Half-integer ties toward zero give conventional m=±1 for (±111).
    const nearest = Math.sign(center) * Math.ceil(Math.abs(center) - 0.5);
    return clamp(nearest, lo, hi) || 0;
  }
  // Boundary ties away from zero give m=±1 for (±100) in one cell.
  const nearest = Math.sign(center) * Math.round(Math.abs(center));
  const lower = Math.ceil(min), upper = Math.floor(max);
  return (lower <= upper ? clamp(nearest, lower, upper) : nearest) || 0;
}

/** Enlarge only a plane's clipping box about the displayed box center.
 *  The original cell/atom bounds and the plane equation stay unchanged. */
export function planeDisplayRanges(ranges, scale = 1) {
  if (!Number.isFinite(scale) || scale <= 0)
    throw Error("Plane size must be positive.");
  return ranges.map(([lo, hi]) => {
    const extra = ((hi - lo) * (scale - 1)) / 2;
    return [lo - extra, hi + extra];
  });
}

/** Interplanar spacing d_hkl = 1 / |B^-T h| (Å). */
export function dSpacing(basis, hkl) {
  const inv = inverse3(basis);
  const g = [0, 1, 2].map((i) => inv[0][i] * hkl[0] + inv[1][i] * hkl[1] + inv[2][i] * hkl[2]);
  const length = norm(g);
  if (!(length > 0)) throw Error("Miller indices must not all be zero.");
  return 1 / length;
}

function boxCorners(ranges) {
  const corners = [];
  for (let i = 0; i < 8; i++) corners.push([0, 1, 2].map((a) => ranges[a][(i >> a) & 1]));
  return corners;
}
const BOX_EDGES = (() => {
  const edges = [];
  for (let i = 0; i < 8; i++)
    for (let a = 0; a < 3; a++) if (!((i >> a) & 1)) edges.push([i, i | (1 << a)]);
  return edges;
})();

/** Convex polygon (fractional vertices, cyclic order) where the plane
 *  coef·f = c cuts the fractional box `ranges`, or null. */
export function clipPlaneToBox(coef, c, ranges) {
  const corners = boxCorners(ranges);
  const s = corners.map((p) => dot(coef, p) - c);
  const scaleRef = Math.max(1e-12, norm(coef));
  const eps = 1e-10 * scaleRef;
  const points = [];
  const push = (p) => {
    if (!points.some((q) => norm(sub(p, q)) < 1e-9)) points.push(p);
  };
  corners.forEach((p, i) => Math.abs(s[i]) <= eps && push(p));
  for (const [i, j] of BOX_EDGES) {
    if ((s[i] < -eps && s[j] > eps) || (s[i] > eps && s[j] < -eps)) {
      const t = s[i] / (s[i] - s[j]);
      push(add(corners[i], scale(sub(corners[j], corners[i]), t)));
    }
  }
  if (points.length < 3) return null;
  // Cyclic order by angle about the centroid in an in-plane frame; affine
  // maps preserve the cyclic order of a convex polygon.
  const centroid = scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
  const n = scale(coef, 1 / scaleRef);
  const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = cross(n, helper);
  const e2 = cross(n, e1);
  const ordered = points
    .map((p) => {
      const d = sub(p, centroid);
      return { p, angle: Math.atan2(dot(d, e2), dot(d, e1)) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((o) => o.p);
  // Reject sliver polygons that only touch an edge or corner.
  let area = 0;
  for (let i = 1; i + 1 < ordered.length; i++)
    area += norm(cross(sub(ordered[i], ordered[0]), sub(ordered[i + 1], ordered[0])));
  return area > 1e-12 ? ordered : null;
}

export const PLANE_FAMILY_LIMIT = 64;
/** Draw h·x = m for one plane, or h·x = m + n for integer n
 *  intersecting the box. The offset moves the entire family. */
export function planeOffsets(hkl, m, ranges, family) {
  if (!family) return { offsets: [m], truncated: false };
  const values = boxCorners(ranges).map((p) => dot(hkl, p));
  const lo = Math.ceil(Math.min(...values) - m - 1e-9),
    hi = Math.floor(Math.max(...values) - m + 1e-9);
  const offsets = [];
  for (let k = lo; k <= hi && offsets.length < PLANE_FAMILY_LIMIT; k++) offsets.push(m + k);
  return { offsets, truncated: hi - lo + 1 > PLANE_FAMILY_LIMIT };
}

// ---- Directions, angles, volumes -----------------------------------------
/** Cartesian vector of the direct-lattice direction multiplier·[uvw]. */
export function directVector(basis, uvw, multiplier = 1) {
  return toCartesian(basis, scale(uvw, multiplier));
}

/** Angle A–B–C at vertex B in degrees, or null if degenerate. */
export function angleAt(a, b, c) {
  const u = sub(a, b),
    v = sub(c, b);
  const lu = norm(u),
    lv = norm(v);
  if (lu < 1e-9 || lv < 1e-9) return null;
  const cosine = Math.max(-1, Math.min(1, dot(u, v) / (lu * lv)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Volume of a convex hull from Cartesian points and its triangle faces:
 *  sum of |tetrahedron(centroid, face)| volumes (orientation-independent). */
export function hullVolume(points, faces) {
  const centroid = scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
  let volume = 0;
  for (const [i, j, k] of faces) {
    const a = sub(points[i], centroid),
      b = sub(points[j], centroid),
      c = sub(points[k], centroid);
    volume += Math.abs(dot(a, cross(b, c))) / 6;
  }
  return volume;
}

// ---- Fractions and operation strings ---------------------------------------
export function fraction(v) {
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  for (const d of [2, 3, 4, 6, 8, 12, 24]) {
    const n = Math.round(v * d);
    if (Math.abs(v * d - n) < 1e-6) {
      const g = gcd(Math.abs(n), d);
      return `${n / g}/${d / g}`;
    }
  }
  return v.toFixed(4);
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
/** "-y+1/2, x, z+1/4" from W, w. */
export function operationString(W, w) {
  const names = ["x", "y", "z"];
  return W.map((row, i) => {
    let s = "";
    row.forEach((c, j) => {
      if (Math.abs(c) < 1e-9) return;
      const sign = c < 0 ? "-" : s ? "+" : "";
      const mag = Math.abs(c);
      s += sign + (Math.abs(mag - 1) < 1e-9 ? "" : fraction(mag)) + names[j];
    });
    const t = w[i];
    if (Math.abs(t) > 1e-9) s += (t < 0 ? "-" : s ? "+" : "") + fraction(Math.abs(t));
    return s || "0";
  }).join(", ");
}
const tripleText = (v) => v.map(fraction).join(", ");

// ---- Symmetry operation analysis -------------------------------------------
const TYPES = {
  "1,3": { symbol: "1", order: 1 },
  "1,-1": { symbol: "2", order: 2 },
  "1,0": { symbol: "3", order: 3 },
  "1,1": { symbol: "4", order: 4 },
  "1,2": { symbol: "6", order: 6 },
  "-1,-3": { symbol: "-1", order: 2 },
  "-1,1": { symbol: "m", order: 2 },
  "-1,0": { symbol: "-3", order: 6 },
  "-1,-1": { symbol: "-4", order: 4 },
  "-1,-2": { symbol: "-6", order: 6 },
};

/** Solve A x = b (3×3). Returns { point, nullspace, rank } or null when
 *  inconsistent. Free coordinates of the particular solution are 0. */
export function solveAffine(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  const pivots = [];
  let row = 0;
  for (let col = 0; col < 3 && row < 3; col++) {
    let best = row;
    for (let r = row + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[best][col])) best = r;
    if (Math.abs(M[best][col]) < 1e-9) continue;
    [M[row], M[best]] = [M[best], M[row]];
    const p = M[row][col];
    for (let k = col; k < 4; k++) M[row][k] /= p;
    for (let r = 0; r < 3; r++)
      if (r !== row && M[r][col]) {
        const f = M[r][col];
        for (let k = col; k < 4; k++) M[r][k] -= f * M[row][k];
      }
    pivots.push(col);
    row++;
  }
  for (let r = row; r < 3; r++) if (Math.abs(M[r][3]) > 1e-6) return null;
  const point = [0, 0, 0];
  pivots.forEach((c, i) => (point[c] = M[i][3]));
  const nullspace = [0, 1, 2]
    .filter((c) => !pivots.includes(c))
    .map((f) => {
      const v = [0, 0, 0];
      v[f] = 1;
      pivots.forEach((c, i) => (v[c] = -M[i][f]));
      return v;
    });
  return { point, nullspace, rank: pivots.length };
}

/** Smallest integer vector parallel to v (|components| ≤ 12), or null. */
function integerDirection(v) {
  const m = Math.max(...v.map(Math.abs));
  const unit = v.map((x) => x / m);
  for (let k = 1; k <= 12; k++) {
    const s = unit.map((x) => x * k);
    if (s.every((x) => Math.abs(x - Math.round(x)) < 1e-6)) {
      const r = s.map(Math.round);
      const g = r.reduce((a, b) => gcd(Math.abs(a), Math.abs(b)), 0) || 1;
      return r.map((x) => x / g);
    }
  }
  return null;
}
const mod1 = (x) => {
  const r = x - Math.floor(x);
  return r > 1 - 1e-9 ? 0 : r;
};
const centred = (x) => {
  const r = mod1(x);
  return r > 0.5 + 1e-9 ? r - 1 : r;
};

/**
 * Geometric element of one operation (W, w), with W integer fractional.
 * Returns { kind, symbol, order, ... } or { kind: "translation" } for
 * identity/pure translations, or { kind: "unsupported", reason }.
 *   kind "axis":     rotation or screw axis  { point, direction, screw }
 *   kind "rotoinversion": { point (inversion point), direction }
 *   kind "inversion":     { point }
 *   kind "plane":    mirror or glide         { coef, c, glide, glideType }
 */
// ---- Translation lattice of the group --------------------------------------
// L = Z³ + centering vectors, read from operations with W = I. Screw and
// glide parts are classified and reduced against L, not just Z³: e.g. in a
// C-centered group an intrinsic (½,½,0) along [110] is a full lattice
// translation, so that axis is a rotation 2, not 2₁.
export const PRIMITIVE = Object.freeze({ centering: [[0, 0, 0]] });
const isIdentity = (W) => W.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9));
export function latticeContext(operations) {
  const centering = [[0, 0, 0]];
  for (const { rotation, translation } of operations ?? []) {
    if (!isIdentity(rotation)) continue;
    const t = translation.map(mod1);
    const same = (c) => c.every((v, i) => Math.abs(centred(v - t[i])) < 1e-6);
    if (!centering.some(same)) centering.push(t);
  }
  centering.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return { centering };
}
/** Is v a translation of the full lattice L? */
export function inLattice(v, context = PRIMITIVE) {
  return context.centering.some((c) => v.every((x, i) => Math.abs(centred(x - c[i])) < 1e-6));
}
/** Largest m (≤ 12) with u/m ∈ L: u/m is the shortest lattice period along u. */
function axisPeriod(u, context) {
  if (!u.every((x) => Number.isInteger(x))) return 1;
  for (let m = 12; m > 1; m--) if (inLattice(u.map((x) => x / m), context)) return m;
  return 1;
}

export function analyzeOperation(W, w, basis, context = PRIMITIVE) {
  const prep = prepareOperation(W, w, basis, context);
  if (prep.kind === "translation" || prep.kind === "unsupported") return prep;
  return elementAt(prep, [0, 0, 0]) ?? { kind: "unsupported", reason: `${prep.type.symbol} without fixed set` };
}

/**
 * Everything about (W, w) that does not depend on an added lattice
 * translation n: type, S = Σ W^j (order·P, P projects onto the fixed
 * space), I − W, the oriented axis direction or plane row. elementAt()
 * then places the element of (W, w + n) cheaply.
 */
export function prepareOperation(W, w, basis, context = PRIMITIVE) {
  const det = Math.round(det3(W));
  const trace = Math.round(W[0][0] + W[1][1] + W[2][2]);
  const type = TYPES[`${det},${trace}`];
  if (!type) return { kind: "unsupported", reason: `det ${det}, trace ${trace}` };
  if (type.symbol === "1") return { kind: "translation", symbol: "1", order: 1 };
  let power = IDENTITY,
    S = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
  for (let j = 0; j < type.order; j++) {
    S = S.map((row, i) => row.map((v, k) => v + power[i][k]));
    power = matMul(power, W);
  }
  const IminusW = IDENTITY.map((row, i) => row.map((v, j) => v - W[i][j]));
  const prep = { W, w, type, S, IminusW, order: type.order, context };
  if (type.symbol === "-1") return { ...prep, kind: "inversion" };
  if (det === -1 && type.symbol !== "m") {
    const WplusI = W.map((row, i) => row.map((v, j) => v + (i === j ? 1 : 0)));
    const axis = solveAffine(WplusI, [0, 0, 0]);
    if (Math.abs(det3(IminusW)) < 1e-9 || !axis || axis.nullspace.length !== 1)
      return { kind: "unsupported", reason: `rotoinversion ${type.symbol}` };
    return {
      ...prep,
      kind: "rotoinversion",
      inverse: inverse3(IminusW),
      direction: integerDirection(axis.nullspace[0]) ?? axis.nullspace[0],
    };
  }
  const fixedSpace = solveAffine(IminusW, [0, 0, 0]);
  if (type.symbol === "m") {
    if (!fixedSpace || fixedSpace.rank !== 1) return { kind: "unsupported", reason: "mirror without plane" };
    // One independent row of (I − W) gives the plane coef·x = c.
    let row = 0;
    for (let i = 1; i < 3; i++) if (norm(IminusW[i]) > norm(IminusW[row])) row = i;
    const coef = IminusW[row];
    // In-plane representatives of the centering cosets that meet the plane
    // direction (c + z with coef·(c + z) = 0), for glide reduction over L.
    const planeCosets = [];
    for (const c of context.centering) {
      if (c.every((v) => Math.abs(v) < 1e-9)) continue;
      search: for (let x = -3; x <= 3; x++)
        for (let y = -3; y <= 3; y++)
          for (let z = -3; z <= 3; z++) {
            const v = [c[0] + x, c[1] + y, c[2] + z];
            if (Math.abs(dot(coef, v)) < 1e-9) {
              planeCosets.push(v);
              break search;
            }
          }
    }
    return { ...prep, kind: "plane", row, coef, planeBasis: planeLatticeBasis(coef), planeCosets };
  }
  if (!fixedSpace || fixedSpace.rank !== 2) return { kind: "unsupported", reason: `rotation ${type.symbol}` };
  let direction = integerDirection(fixedSpace.nullspace[0]) ?? fixedSpace.nullspace[0];
  // Orient the axis so the rotation is counterclockwise about it; the
  // screw component along that orientation then gives n_p correctly.
  if (type.order > 2) {
    const R = matMul(matMul(basis, W), inverse3(basis));
    const u = matVec(basis, direction);
    const helper = Math.abs(u[0]) < 0.9 * norm(u) ? [1, 0, 0] : [0, 1, 0];
    const v = cross(u, helper);
    if (dot(u, cross(v, matVec(R, v))) < 0) direction = scale(direction, -1);
  }
  return { ...prep, kind: "axis", direction, period: axisPeriod(direction, context) };
}
/** Shortest representative of an in-plane glide vector modulo the full
 *  in-plane lattice (Z³ part and centering cosets); deterministic ties. */
function reduceGlide(g, prep) {
  let best = reduceInPlane(g, prep.planeBasis);
  for (const v of prep.planeCosets) {
    const candidate = reduceInPlane(sub(g, v), prep.planeBasis);
    const d = norm(candidate) - norm(best);
    if (d < -1e-9 || (Math.abs(d) <= 1e-9 && candidate.join() < best.join())) best = candidate;
  }
  return best;
}

/** Element of (W, w + n) for a prepared operation, or null if inconsistent. */
export function elementAt(prep, n) {
  const { type, order } = prep;
  const wn = [prep.w[0] + n[0], prep.w[1] + n[1], prep.w[2] + n[2]];
  if (prep.kind === "inversion") return { kind: "inversion", symbol: "-1", order: 2, point: scale(wn, 0.5) };
  if (prep.kind === "rotoinversion")
    return {
      kind: "rotoinversion",
      symbol: type.symbol,
      order,
      point: matVec(prep.inverse, wn),
      direction: prep.direction,
    };
  // Intrinsic (screw/glide) part P(w+n) and location part (I − P)(w+n).
  const intrinsic = scale(matVec(prep.S, wn), 1 / order);
  const location = sub(wn, intrinsic);
  if (prep.kind === "plane") {
    // The intrinsic part lies in the plane. It is a pure lattice
    // translation (mirror) exactly when it is an integer vector; otherwise
    // it is reduced only by integer lattice vectors parallel to the plane,
    // so it stays tangent to the plane in any (e.g. sheared) setting.
    // Mirror exactly when the in-plane intrinsic part is a translation of
    // the full lattice L (centering included).
    const isGlide = !inLattice(intrinsic, prep.context);
    const glide = isGlide ? reduceGlide(intrinsic, prep) : null;
    return {
      kind: "plane",
      symbol: isGlide ? glideSymbol(glide) : "m",
      order: 2,
      coef: prep.coef,
      c: location[prep.row],
      glide,
    };
  }
  const fixed = solveAffine(prep.IminusW, location);
  if (!fixed) return null;
  // Screw part in units of the shortest lattice period along the axis,
  // u/period (period > 1 only in centered lattices): n_p with p/n of it.
  const d = prep.direction;
  const lambda = mod1((prep.period * dot(intrinsic, d)) / dot(d, d));
  const screw = Math.round(lambda * order) % order;
  return {
    kind: "axis",
    symbol: screw ? `${type.symbol}${subscript(screw)}` : type.symbol,
    order,
    screw,
    point: fixed.point,
    direction: d,
  };
}

/**
 * Integer translations n for which the element of (W, w + n) can meet the
 * fractional box. With P = S/order, the element meets the box iff
 * (I − P)n ∈ (I − W)·Box − (I − P)w. Subtracting the lattice vectors
 * S·e_i (they lie in the fixed space, so the element is unchanged and its
 * screw/glide part only changes by a lattice vector) reduces Pn into
 * S·[0,1)³. So every element is reached from some
 *   n ∈ bbox((I − W)·Box − (I − P)w) + S·[0,1)³,
 * a complete, finite candidate set for any setting.
 */
export function translationBounds(prep, ranges) {
  const corners = boxCorners(ranges);
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const p of corners) {
    const q = matVec(prep.IminusW, p);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], q[i]);
      hi[i] = Math.max(hi[i], q[i]);
    }
  }
  const projected = scale(matVec(prep.S, prep.w), 1 / prep.order);
  return [0, 1, 2].map((i) => {
    const shift = prep.w[i] - projected[i];
    let a = lo[i] - shift,
      b = hi[i] - shift;
    for (let j = 0; j < 3; j++) {
      a += Math.min(0, prep.S[i][j]);
      b += Math.max(0, prep.S[i][j]);
    }
    return [Math.floor(a - 1e-9), Math.ceil(b + 1e-9)];
  });
}
const subscript = (n) => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[d]);

// Basis of the 2D lattice {v ∈ Z³ : coef·v = 0} parallel to a plane with
// integer normal row `coef`: b1 is a shortest kernel vector and b2 is
// chosen with b1 × b2 = ±coef/gcd, the covolume of that lattice, so the
// pair generates it exactly. null if no such pair is found in the search
// box (then the glide is shown unreduced).
const planeBases = new Map();
export function planeLatticeBasis(coef) {
  const ints = coef.map(Math.round);
  const g = ints.reduce((a, v) => gcd(Math.abs(v), a), 0) || 1;
  const c = ints.map((v) => v / g);
  const key = c.join(",");
  if (planeBases.has(key)) return planeBases.get(key);
  const K = Math.max(...c.map(Math.abs)) + 1;
  const kernel = [];
  for (let x = -K; x <= K; x++)
    for (let y = -K; y <= K; y++)
      for (let z = -K; z <= K; z++)
        if ((x || y || z) && c[0] * x + c[1] * y + c[2] * z === 0) kernel.push([x, y, z]);
  kernel.sort((p, q) => dot(p, p) - dot(q, q));
  const b1 = kernel[0];
  const b2 = b1
    ? kernel.find((v) => {
        const k = cross(b1, v);
        return k.every((x, i) => x === c[i]) || k.every((x, i) => x === -c[i]);
      })
    : null;
  const basis = b1 && b2 ? [b1, b2] : null;
  planeBases.set(key, basis);
  return basis;
}
/** Reduce an in-plane vector by in-plane lattice vectors: coefficients in
 *  the plane basis go to (−½, ½]. */
function reduceInPlane(v, basis) {
  if (!basis) return v.map((x) => (Math.abs(x) < 1e-12 ? 0 : x));
  const [b1, b2] = basis;
  const g11 = dot(b1, b1),
    g12 = dot(b1, b2),
    g22 = dot(b2, b2);
  const r1 = dot(v, b1),
    r2 = dot(v, b2);
  const det = g11 * g22 - g12 * g12;
  const alpha = centred((r1 * g22 - r2 * g12) / det),
    beta = centred((r2 * g11 - r1 * g12) / det);
  return add(scale(b1, alpha), scale(b2, beta)).map((x) => (Math.abs(x) < 1e-12 ? 0 : x));
}
function glideSymbol(g) {
  const nz = g.map((v) => Math.abs(v) > 1e-6);
  const count = nz.filter(Boolean).length;
  if (count === 1) {
    const i = nz.indexOf(true);
    if (Math.abs(Math.abs(g[i]) - 0.5) < 1e-6) return "abc"[i];
  }
  const mags = g.filter((v, i) => nz[i]).map(Math.abs);
  if (mags.every((m) => Math.abs(m - 0.5) < 1e-6)) return "n";
  if (mags.every((m) => Math.abs(m - 0.25) < 1e-6)) return "d";
  return "g";
}

/** Clip the line p + t·u to the fractional box; returns [start, end] or null. */
export function clipLineToBox(p, u, ranges) {
  let t0 = -Infinity,
    t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const [lo, hi] = ranges[i];
    if (Math.abs(u[i]) < 1e-12) {
      if (p[i] < lo - 1e-9 || p[i] > hi + 1e-9) return null;
      continue;
    }
    let a = (lo - p[i]) / u[i],
      b = (hi - p[i]) / u[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (!(t1 - t0 > 1e-9)) return null;
  return [add(p, scale(u, t0)), add(p, scale(u, t1))];
}

export const SYMMETRY_LIMITS = { candidates: 250000, elements: 3000 };
const keyOf = (values) => values.map((v) => (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6)).join(",");

/**
 * All symmetry elements of `operations` intersecting the fractional box,
 * with lattice-periodic copies and coincident elements merged. Returns
 * { elements, analyses, note }. Each element has kind, symbols (all
 * coincident symbols), order, and fractional geometry clipped to the box.
 */
export function symmetryElements(operations, basis, ranges) {
  // Group context: the full translation lattice from W = I operations.
  const context = latticeContext(operations);
  const analyses = operations.map(({ rotation, translation }) => {
    try {
      return analyzeOperation(rotation, translation, basis, context);
    } catch (error) {
      return { kind: "unsupported", reason: error.message };
    }
  });
  const notes = [];
  const unsupported = analyses.filter((a) => a.kind === "unsupported").length;
  if (unsupported) notes.push(`${unsupported} operation(s) could not be classified and are not drawn.`);
  // Elements are kept per (category, geometry): a rotation axis and a
  // screw or rotoinversion axis on the same line are separate elements, so
  // every filter and count is honest. Within one key the representative is
  // chosen deterministically (independent of operation order): highest
  // order, then smallest intrinsic translation, then symbol.
  const merged = new Map();
  const rank = (e) => [-e.order, e.intrinsic, e.symbol];
  const better = (a, b) => {
    const ra = rank(a),
      rb = rank(b);
    for (let i = 0; i < 3; i++) {
      if (typeof ra[i] === "number" ? Math.abs(ra[i] - rb[i]) > 1e-9 : ra[i] !== rb[i])
        return typeof ra[i] === "number" ? ra[i] < rb[i] : ra[i] < rb[i];
    }
    return false;
  };
  const merge = (geometry, element) => {
    const key = `${element.category}|${geometry}`;
    const old = merged.get(key);
    if (!old) {
      merged.set(key, { ...element, geometry, symbols: [element.symbol] });
      return;
    }
    const symbols = [...new Set([...old.symbols, element.symbol])].sort();
    const centers = old.centers;
    if (better(element, old)) merged.set(key, { ...element, geometry, symbols, centers });
    else old.symbols = symbols;
  };
  const inBox = (p) => p.every((v, i) => v >= ranges[i][0] - 1e-9 && v <= ranges[i][1] + 1e-9);
  let candidates = 0,
    capped = false;
  operations.forEach(({ rotation, translation }, operation) => {
    if (capped) return;
    const kind = analyses[operation].kind;
    if (kind === "translation" || kind === "unsupported") return;
    const prep = prepareOperation(rotation, translation, basis, context);
    const span = translationBounds(prep, ranges);
    const count = span.reduce((n, [lo, hi]) => n * (hi - lo + 1), 1);
    if (candidates + count > SYMMETRY_LIMITS.candidates) {
      capped = true;
      return;
    }
    candidates += count;
    const n = [0, 0, 0];
    for (n[0] = span[0][0]; n[0] <= span[0][1]; n[0]++)
      for (n[1] = span[1][0]; n[1] <= span[1][1]; n[1]++)
        for (n[2] = span[2][0]; n[2] <= span[2][1]; n[2]++) {
          const a = elementAt(prep, n);
          if (!a) continue;
          if (a.kind === "axis") {
            const segment = clipLineToBox(a.point, a.direction, ranges);
            if (!segment) continue;
            const geometry = segment.map(keyOf).sort().join("|");
            merge(geometry, {
              ...a,
              category: a.screw ? "screw" : "rotation",
              intrinsic: a.screw / a.order,
              start: segment[0],
              end: segment[1],
              operation,
            });
          } else if (a.kind === "rotoinversion") {
            // A rotoinversion element is its inversion point on the axis;
            // only points inside the box are elements of this range (the
            // axis line itself coincides with the rotation axis of W²).
            if (!inBox(a.point)) continue;
            const segment = clipLineToBox(a.point, a.direction, ranges);
            if (!segment) continue;
            // Identity = type + center (+ axis): e.g. -3 at z = 0 and -6 at
            // z = 1/4 on one c axis are distinct elements. Rendering may
            // share the line; counts, filters and readouts stay exact.
            const locus = segment.map(keyOf).sort().join("|");
            merge(`${locus}#${a.symbol}@${keyOf(a.point)}`, {
              ...a,
              category: "rotoinversion",
              intrinsic: 0,
              locus,
              centers: [a.point],
              start: segment[0],
              end: segment[1],
              operation,
            });
          } else if (a.kind === "plane") {
            const polygon = clipPlaneToBox(a.coef, a.c, ranges);
            if (!polygon) continue;
            const length = norm(a.coef);
            const unit = a.coef.map((v) => v / length);
            const sign = unit.find((v) => Math.abs(v) > 1e-9) < 0 ? -1 : 1;
            const geometry = keyOf([...unit.map((v) => v * sign), (a.c / length) * sign]);
            merge(geometry, {
              ...a,
              category: a.glide ? "glide" : "mirror",
              intrinsic: a.glide ? norm(a.glide) : 0,
              polygon,
              operation,
            });
          } else if (a.kind === "inversion" && inBox(a.point)) {
            merge(keyOf(a.point), { ...a, category: "inversion", intrinsic: 0, operation });
          }
        }
  });
  // Deterministic order, and the symbols of other categories that share
  // the same geometric locus (e.g. 4 and -4 on one line).
  let elements = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, e]) => e);
  // Coincidence is judged on the geometric locus (a rotoinversion's axis).
  const byGeometry = new Map();
  for (const e of elements) {
    e.locus ??= e.geometry;
    if (!byGeometry.has(e.locus)) byGeometry.set(e.locus, []);
    byGeometry.get(e.locus).push(e);
  }
  // Every inversion point on a merged rotoinversion line is kept, in a
  // deterministic (lexicographic) order.
  for (const e of elements)
    e.centers?.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  for (const e of elements)
    e.coincident = byGeometry
      .get(e.locus)
      .filter((o) => o !== e)
      .flatMap((o) => o.symbols);
  if (capped)
    notes.push(
      "Too many candidate positions for this range; some symmetry elements are omitted. Reduce the plotting range.",
    );
  const truncated = elements.length > SYMMETRY_LIMITS.elements;
  if (truncated) {
    notes.push(
      `Showing the first ${SYMMETRY_LIMITS.elements} of ${elements.length} elements; the rest are omitted. Reduce the plotting range.`,
    );
    elements = elements.slice(0, SYMMETRY_LIMITS.elements);
  }
  return {
    elements,
    analyses,
    note: notes.join(" "),
    candidates,
    // Complete only if neither the candidate nor the element cap was hit.
    complete: !capped && !truncated,
    truncated,
    centering: context.centering,
  };
}

/** Apply exact axis-type filters after merging coincident operations.
 * A 4 axis also carries 2: selecting only 2 must keep that line and give
 * it the twofold color rather than its unfiltered fourfold color. */
export function filterSymmetryElements(elements, categories, hiddenTypes = new Set()) {
  return elements.flatMap((e) => {
    const category = elementCategory(e);
    if (!categories.has(category)) return [];
    if (e.kind !== "axis" && e.kind !== "rotoinversion") return [e];
    const symbols = e.symbols.filter((s) => !hiddenTypes.has(`${category}:${s}`));
    if (!symbols.length) return [];
    const symbol = symbols.includes(e.symbol) ? e.symbol : symbols.at(-1);
    const order = e.kind === "axis" ? Number(symbol[0]) : e.order;
    const screw = e.kind === "axis" ? (symbol.length > 1 ? "₀₁₂₃₄₅₆₇₈₉".indexOf(symbol[1]) : 0) : e.screw;
    return [{ ...e, symbol, symbols, order, screw }];
  });
}

/** Category used for filters and colors. */
export function elementCategory(e) {
  if (e.category) return e.category;
  if (e.kind === "axis") return e.screw ? "screw" : "rotation";
  if (e.kind === "rotoinversion") return "rotoinversion";
  if (e.kind === "inversion") return "inversion";
  if (e.kind === "plane") return e.glide ? "glide" : "mirror";
  return "other";
}

/** Human-readable element equation in fractional coordinates. */
export function elementEquation(a) {
  // The exact fixed point of this very operation: wrapping coordinates
  // componentwise would move a line onto a different (if equivalent) one.
  if (a.kind === "rotoinversion")
    return `center (${tripleText(a.point)}) · axis [${a.direction.join(" ")}]`;
  if (a.kind === "axis") return `(${tripleText(a.point)}) + t[${a.direction.join(" ")}]`;
  if (a.kind === "inversion") return `(${tripleText(a.point)})`;
  if (a.kind === "plane") {
    const names = ["x", "y", "z"];
    const lhs = a.coef
      .map((v, i) => (Math.abs(v) < 1e-9 ? "" : `${v < 0 ? "-" : "+"}${Math.abs(v) === 1 ? "" : fraction(Math.abs(v))}${names[i]}`))
      .join("")
      .replace(/^\+/, "");
    return `${lhs} = ${fraction(a.c)}${a.glide ? ` · glide (${tripleText(a.glide)})` : ""}`;
  }
  return "";
}
