// Laboratory +x is the incident beam. Use crystallographic reciprocal units
// throughout (cycles/Å), so |k_in| = |k_out| = 1/λ.
import { cross3, dot3, identity, transpose, unitAxis } from "./detector-orientation.js";
import { matMul, matVec } from "./crystal-math.js";
import { analysisCell, reflectionStrength } from "./structure-analysis.js";

import { Matrix4, Quaternion } from "three";
import { circularDetector } from "./detector-geometry.js";

const rad = Math.PI / 180;

const wrap = (angle) => ((angle % 360) + 360) % 360;
const norm = (v) => Math.hypot(...v);

function rotateY([x, y, z], angle) {
  const c = Math.cos(angle * rad),
    s = Math.sin(angle * rad);
  return [c * x + s * z, y, -s * x + c * z];
}

export function labVector(vector, tilt, rock, azimuth, axis = [0, 0, 1]) {
  const g = rotateY(vector, tilt);
  const c = Math.cos(rock * rad),
    s = Math.sin(rock * rad);
  const normal = cross3(axis, g),
    axial = dot3(axis, g) * (1 - c);
  const [x, y, z] = g.map((value, i) => value * c + normal[i] * s + axis[i] * axial);
  const a = azimuth * rad;
  return [x, Math.cos(a) * y - Math.sin(a) * z, Math.sin(a) * y + Math.cos(a) * z];
}

function scanRotation(tilt, rock, azimuth, axis) {
  return transpose(identity.map((v) => labVector(v, tilt, rock, azimuth, axis)));
}

function rotationQuaternion(r) {
  return new Quaternion()
    .setFromRotationMatrix(new Matrix4().set(...r[0], 0, ...r[1], 0, ...r[2], 0, 0, 0, 0, 1))
    .normalize();
}

// Find the spindle and beam turns closest to a free rotation. In the frame
// before the current beam spin their quaternion product is Rx(Δφ) Raxis(Δω).
function scanIncrements(turn, azimuth, axis) {
  const beamSpin = scanRotation(0, 0, azimuth, axis);
  const q = rotationQuaternion(matMul(transpose(beamSpin), matMul(turn, beamSpin)));
  const v = [q.x, q.y, q.z];
  const alongAxis = dot3(v, axis);
  // Parallel axes describe the same knob. Assign the common turn to ω.
  if (Math.hypot(axis[1], axis[2]) < 1e-4) return [(2 * Math.atan2(alongAxis, q.w)) / rad, 0];

  // The overlap with the target quaternion is bilinear in the sine and
  // cosine of each half-angle. Its maximum is the largest singular value
  // of the 2×2 matrix below. Solve for the spindle half-angle first.
  const a = q.w,
    b = alongAxis,
    c = q.x,
    d = axis[1] * q.z - axis[2] * q.y - axis[0] * q.w;
  const off = 2 * (a * b + c * d),
    diff = a * a + c * c - b * b - d * d;
  const half = Math.hypot(off, diff) < 1e-12 ? 0 : Math.atan2(off, diff) / 2;
  const cosine = Math.cos(half),
    sine = Math.sin(half);
  return [(2 * half) / rad, (2 * Math.atan2(c * cosine + d * sine, a * cosine + b * sine)) / rad];
}

// Rodrigues' formula projected onto the beam gives
// (gx - axial) cos ω + (axis × g)x sin ω = −λ |g|² / 2 − axial.
function crossings(g, wavelength, axis) {
  const axial = axis[0] * dot3(axis, g);
  const cosine = g[0] - axial,
    sine = cross3(axis, g)[0];
  const amplitude = Math.hypot(cosine, sine),
    target = (-wavelength * norm(g) ** 2) / 2 - axial;
  const eps = 1e-12 * norm(g);
  if (amplitude <= eps) return { angles: [], continuous: Math.abs(target) <= eps };
  if (Math.abs(target) > amplitude + eps) return { angles: [], continuous: false };
  const offset = Math.acos(Math.max(-1, Math.min(1, target / amplitude))) / rad;
  const phase = Math.atan2(sine, cosine) / rad;
  return { angles: [wrap(phase + offset), wrap(phase - offset)], continuous: false };
}

export function detectorModel(
  structure,
  wavelength,
  distance,
  target = null,
  mount,
  mounting = identity,
  spindle = [0, 0, 1],
  detector = circularDetector(),
) {
  if (!(Number.isFinite(wavelength) && wavelength > 0)) throw Error("Enter a positive wavelength.");
  if (!(Number.isFinite(distance) && distance > 0)) throw Error("Enter a positive detector distance.");
  const cell = analysisCell(structure);
  const { atoms, inverse } = cell;
  const axis = unitAxis(spindle);
  let basis = matMul(mounting, cell.basis);
  const elements = [...new Set(atoms.map((atom) => atom.element))];
  const reciprocal = (hkl) => [0, 1, 2].map((i) => inverse.reduce((sum, row, j) => sum + row[i] * hkl[j], 0));
  // Bring a requested vector into the rocking plane if the spindle alone
  // cannot reach it. This mounting tilt applies to the entire crystal.
  let tilt = mount ?? 0;
  if (mount === undefined && target) {
    const g = matVec(mounting, reciprocal(target));
    if (!crossings(g, wavelength, axis).angles.length) tilt = Math.atan2(g[2], g[0]) / rad;
  }
  const points = [],
    strengths = new Map();
  function addPoint(hkl, crystalG = reciprocal(hkl)) {
    const length = norm(crystalG),
      sinTheta = (wavelength * length) / 2;
    const twoTheta = sinTheta <= 1 ? (2 * Math.asin(sinTheta)) / rad : null;
    const radius = twoTheta !== null && twoTheta < 90 ? distance * Math.tan(twoTheta * rad) : Infinity;
    const key = (hkl.find((v) => v !== 0) < 0 ? hkl.map((v) => -v) : hkl).join(" ");
    if (!strengths.has(key))
      strengths.set(key, length < 4 ? reflectionStrength(atoms, elements, hkl, length) : 0);
    const point = { hkl, crystalG, length, twoTheta, radius, intensity: strengths.get(key) };
    points.push(point);
    return point;
  }
  // A flat circular sensor subtends 2θmax at its edge. For any cell,
  // |h_i| = |a_i · g| ≤ |a_i| |g|, including oblique direct bases.
  const maxAngle = detector.maxAngle ?? Math.atan2(detector.radius, distance);
  const gMax = (2 * Math.sin(maxAngle / 2)) / wavelength;
  const factorLimit = Math.min(gMax, 4);
  const limits = [0, 1, 2].map((i) =>
    Math.floor(Math.hypot(...cell.basis.map((row) => row[i])) * factorLimit + 1e-9),
  );
  const candidateCount = limits.reduce((n, limit) => n * (2 * limit + 1), 1);
  const searchOnly = candidateCount > 160000 || candidateCount * atoms.length > 20000000;
  if (searchOnly && !target)
    throw Error(
      "This scan is too large. Increase the detector distance or wavelength, or search for a single reflection.",
    );
  if (!searchOnly) {
    for (let h = -limits[0]; h <= limits[0]; h++)
      for (let k = -limits[1]; k <= limits[1]; k++)
        for (let l = -limits[2]; l <= limits[2]; l++) {
          if (!(h || k || l)) continue;
          const hkl = [h, k, l];
          const g = reciprocal(hkl);
          if (norm(g) <= factorLimit + 1e-10) addPoint(hkl, g);
        }
  }
  const requested =
    target && (points.find((p) => p.hkl.every((v, i) => v === target[i])) ?? addPoint(target));

  function hit(point, rock, azimuth) {
    return detectorHit(point, labVector(point.g, tilt, rock, azimuth, axis));
  }
  function detectorHit(point, [x, y, z]) {
    const forward = 1 / wavelength + x;
    if (detector.project) {
      const pixel = detector.project([forward, y, z]);
      return detector.contains(pixel) ? { point, ...pixel } : null;
    }
    return point.radius <= detector.radius + 1e-8
      ? { point, y: (distance * y) / forward, z: (distance * z) / forward }
      : null;
  }
  const allowed = points.filter((p) => p.intensity > 0);
  const maxIntensity = allowed.reduce((max, p) => Math.max(max, p.intensity), 0);
  for (const p of allowed) {
    p.relativeIntensity = p.intensity / maxIntensity;
    p.logArea = Math.log1p(999 * p.relativeIntensity) / Math.log(1000);
  }
  let candidates, persistent, observable, stops, scanAzimuth, observedLimits;
  // Prefer the exact visible crossing nearest the pointer, including one
  // just ahead. A hit at the starting pose releases outside the snap range.
  function crossedDuringTurn(start, end, tolerance = 0, heldPoint = null) {
    const r = matMul(end, transpose(start));
    const q = rotationQuaternion(r);
    const sine = Math.hypot(q.x, q.y, q.z);
    if (sine < 1e-10) return null;
    const sweep = (2 * Math.atan2(sine, Math.abs(q.w))) / rad;
    const scale = (q.w < 0 ? -1 : 1) / sine;
    const turnAxis = [q.x * scale, q.y * scale, q.z * scale];
    const crystalAxis = unitAxis(matVec(transpose(start), turnAxis));
    // A selected hit at the starting pose gets a wider release range. Hold
    // it even among closely spaced crossings. A turn that keeps this point
    // on the sphere (e.g. a beam roll) can still move the detector spot.
    if (heldPoint && sweep <= 2 * tolerance + 1e-8) {
      const g = matVec(start, heldPoint.crystalG);
      if (!crossings(g, wavelength, turnAxis).continuous)
        return { point: heldPoint, orientation: start, remainder: scanRotation(0, sweep, 0, crystalAxis) };
    }
    let nearest = null;
    for (const point of allowed) {
      if (point.twoTheta === null || (!detector.project && point.radius > detector.radius + 1e-8)) continue;
      const g = matVec(start, point.crystalG);
      for (const wrapped of crossings(g, wavelength, turnAxis).angles) {
        const angle = wrapped > 360 - 1e-7 ? 0 : wrapped;
        const gap = Math.abs(angle - sweep);
        if (angle > sweep + tolerance + 1e-8 || (angle <= 1e-7 && (!tolerance || gap > tolerance))) continue;
        if (nearest && gap > nearest.gap + 1e-8) continue;
        if (!detectorHit(point, labVector(g, 0, angle, 0, turnAxis))) continue;
        if (!nearest || gap < nearest.gap - 1e-8 || point.intensity > nearest.point.intensity)
          nearest = { angle, gap, point };
      }
    }
    if (!nearest) return null;
    // Carry only the angular difference between the pointer and the snap.
    // Express it in crystal coordinates so the next camera orientation can
    // apply it directly, even if the user changes drag direction.
    const remainder = scanRotation(0, sweep - nearest.angle, 0, crystalAxis);
    return { point: nearest.point, orientation: matMul(end, transpose(remainder)), remainder };
  }
  // Only the directions and crossing angles change when the user turns the
  // specimen. Reuse the crystal-frame reciprocal vectors and structure factors.
  function remount(matrix, newTilt, azimuth) {
    mounting = matrix;
    tilt = newTilt;
    basis = matMul(mounting, cell.basis);
    candidates = [];
    persistent = [];
    for (const p of points) {
      p.g = matVec(mounting, p.crystalG);
      Object.assign(p, crossings(rotateY(p.g, tilt), wavelength, axis));
      if (!p.intensity || p.twoTheta === null || (!detector.project && p.radius > detector.radius + 1e-8))
        continue;
      if (p.continuous) persistent.push(p);
      for (const angle of p.angles) candidates.push({ point: p, angle });
    }
    candidates.sort((a, b) => a.angle - b.angle);
    observable = null;
    setAzimuth(azimuth);
  }
  function setAzimuth(azimuth) {
    if (observable && (!detector.project || azimuth === scanAzimuth)) return;
    scanAzimuth = azimuth;
    observable = detector.project ? candidates.filter((e) => hit(e.point, e.angle, azimuth)) : candidates;
    // Several indices can cross at the same angle. Count all of them before
    // reducing the slider marks to one stop per angle.
    observedLimits = null;
    function include(point) {
      observedLimits ??= [0, 0, 0];
      point.hkl.forEach((v, i) => {
        observedLimits[i] = Math.max(observedLimits[i], Math.abs(v));
      });
    }
    for (const event of observable) include(event.point);
    for (const point of persistent) {
      const sweepsCone = Math.hypot(axis[1], axis[2]) < 1e-12;
      if (
        sweepsCone && detector.project ? detector.acceptsCone(point.twoTheta * rad) : hit(point, 0, azimuth)
      )
        include(point);
    }
    stops = observable.filter((e, i) => !i || e.angle - observable[i - 1].angle > 1e-7);
  }
  remount(mounting, tilt, 0);
  function orientation(rock, azimuth) {
    return matMul(scanRotation(tilt, rock, azimuth, axis), mounting);
  }
  function followTurn(start, end, rock, azimuth) {
    const [spindleTurn, beamTurn] = scanIncrements(matMul(end, transpose(start)), azimuth, axis);
    rock = wrap(rock + spindleTurn + 180) - 180;
    azimuth = wrap(azimuth + beamTurn + 180) - 180;
    const predicted = orientation(rock, azimuth);
    if (predicted.some((row, i) => row.some((v, j) => Math.abs(v - end[i][j]) > 1e-12))) {
      // Only the part of a free turn outside the two scan axes needs a new
      // zero-angle mounting. Include any initial mounting tilt in that U.
      remount(matMul(transpose(scanRotation(0, rock, azimuth, axis)), end), 0, azimuth);
    } else setAzimuth(azimuth);
    return { rock, azimuth };
  }
  function next(rock, direction = 1) {
    rock = wrap(rock);
    if (direction < 0) return stops.findLast((e) => e.angle < rock - 1e-7) ?? stops.at(-1) ?? null;
    return stops.find((e) => e.angle > rock + 1e-7) ?? stops[0] ?? null;
  }
  // Read a continuous angular slider, but land on a true Bragg angle when
  // the handle passes a crossing or approaches within its on-screen width.
  function scrub(previous, angle, tolerance) {
    // Compare equivalent turns near the current handle, including across 0°.
    previous = angle + wrap(previous - angle + 180) - 180;
    const low = Math.min(previous, angle),
      high = Math.max(previous, angle);
    let nearest = null,
      gap = Infinity;
    for (const event of stops) {
      const offset = wrap(event.angle - angle + 180) - 180;
      const delta = Math.abs(offset);
      const passed = angle + offset > low + 1e-7 && angle + offset < high - 1e-7;
      if (((passed && delta <= 2 * tolerance) || delta <= tolerance) && delta < gap) {
        gap = delta;
        nearest = event;
      }
    }
    return nearest;
  }
  // Rotation about the incident beam preserves the Bragg condition.
  function beamInMountedFrame(rock) {
    return identity.map((v) => labVector(v, tilt, rock, 0, axis)[0]);
  }
  function onSphere(point, beam) {
    return Math.abs(2 * dot3(point.g, beam) + wavelength * point.length ** 2) <= 1e-11 * point.length;
  }
  function spots(rock, azimuth) {
    setAzimuth(azimuth);
    const beam = beamInMountedFrame(rock);
    return allowed
      .filter((point) => point.twoTheta !== null && onSphere(point, beam))
      .sort((a, b) => a.hkl[0] - b.hkl[0] || a.hkl[1] - b.hkl[1] || a.hkl[2] - b.hkl[2])
      .map((point) => hit(point, rock, azimuth))
      .filter(Boolean);
  }
  // Thin only the gray context dots for display. Scan events use every candidate.
  const stride = Math.max(1, Math.ceil(allowed.length / 900));
  const displayPoints = allowed.filter((_, i) => i % stride === 0);
  return {
    get basis() {
      return basis;
    },
    axis,
    get mounting() {
      return mounting;
    },
    wavelength,
    distance,
    get tilt() {
      return tilt;
    },
    remount,
    points: displayPoints,
    requested,
    orientation,
    followTurn,
    crossedDuringTurn,
    onSphere: (point, rock) => onSphere(point, beamInMountedFrame(rock)),
    get observedLimits() {
      return observedLimits;
    },
    intensity: (point) => point.intensity,
    next,
    spots,
    scrub,
    get stops() {
      return stops;
    },
    detector,
    hit,
    setAzimuth,
    limits,
    maxAngle: maxAngle / rad,
    gMax,
    searchOnly,
  };
}
