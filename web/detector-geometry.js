// Flat detector geometry. Distances are in mm, PONI angles in radians.
// Pixel pitches, default image shapes and module-gap bands are from pyFAI 2026.2.1.
import defaults from "./poni-detectors.json" with { type: "json" };
import { matMul, matVec } from "./crystal-math.js";
import { dot3, poniFrame } from "./detector-orientation.js";

export function circularDetector(diameter = 200) {
  if (!Number.isFinite(diameter) || diameter <= 0) throw Error("Enter a positive detector diameter.");
  return { diameter, radius: diameter / 2, caption: diameter + " mm diameter" };
}

const positive = (x) => Number.isFinite(x) && x > 0;
export function rectangularDetector(width, height, distance) {
  if (![width, height].every(positive)) throw Error("Enter a positive detector width and height.");
  return {
    width,
    height,
    caption: width + " × " + height + " mm",
    maxAngle: Math.atan2(Math.hypot(width, height) / 2, distance),
    acceptsCone(theta) {
      return theta <= this.maxAngle + 1e-12;
    },
    project([forward, left, up]) {
      return forward > 0 ? { y: (distance * left) / forward, z: (distance * up) / forward } : null;
    },
    contains(hit) {
      return hit && Math.abs(hit.y) <= width / 2 && Math.abs(hit.z) <= height / 2;
    },
  };
}

const normalizeName = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function readPoni(text) {
  const imageTransform = /^#\s*Dioptas image orientation:\s*(.+)$/im.exec(text)?.[1].trim();
  if (imageTransform && imageTransform !== "none")
    throw Error(
      "This PONI uses a Dioptas image transform (" +
        imageTransform +
        "). Use a calibration in raw image coordinates.",
    );
  const fields = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(),
      i = line.indexOf(":");
    if (!line || line.startsWith("#") || i < 0) continue;
    fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const number = (key) => {
    const value = Number(fields[key]);
    if (!fields[key] || !Number.isFinite(value)) throw Error("Missing or invalid PONI field " + key + ".");
    return value;
  };
  const config = JSON.parse(fields.detector_config || "{}");
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw Error("Invalid PONI detector configuration.");
  if (
    Object.keys(config).some(
      (k) => !["pixel1", "pixel2", "max_shape", "orientation", "splineFile", "splinefile"].includes(k),
    ) ||
    [fields.splinefile, config.splineFile, config.splinefile].some(
      (v) => v && String(v).toLowerCase() !== "none",
    ) ||
    (fields.parallax && !["false", "none", "0"].includes(fields.parallax.toLowerCase()))
  )
    throw Error("This calibration requires a detector correction beyond a uniform flat panel.");
  const name = fields.detector || "Detector";
  const known = defaults.find((d) =>
    [d.name, ...(d.aliases ?? [])].some((alias) => normalizeName(alias) === normalizeName(name)),
  );
  if (!known && normalizeName(name) !== "detector")
    throw Error(
      "Unsupported detector model " +
        name +
        ". Use a uniform flat-panel calibration with explicit pixel sizes.",
    );
  const distance = number("distance") * 1000;
  const pixel1 = Number(config.pixel1 ?? fields.pixelsize1 ?? known?.pitch[0]) * 1000;
  const pixel2 = Number(config.pixel2 ?? fields.pixelsize2 ?? known?.pitch[1]) * 1000;
  const wavelength = fields.wavelength ? number("wavelength") * 1e10 : null;
  if (![distance, pixel1, pixel2].every(positive) || (wavelength !== null && !positive(wavelength)))
    throw Error("The calibration needs positive pixel pitches, distance and wavelength.");
  const rawOrientation = Number(config.orientation ?? 3);
  const orientation = rawOrientation === 0 ? 3 : rawOrientation;
  const nativePitch =
    known && [pixel1, pixel2].every((p, i) => Math.abs(p / (1000 * known.pitch[i]) - 1) < 1e-6);
  if (![1, 2, 3, 4].includes(orientation)) throw Error("Unsupported PONI pixel orientation.");
  const [r1, r2, r3] = ["rot1", "rot2", "rot3"].map(number);
  const [a, b, c] = [r1, r2, r3].map(Math.cos),
    [s, t, u] = [r1, r2, r3].map(Math.sin);
  const rotation = matMul(
    [
      [c, -u, 0],
      [u, c, 0],
      [0, 0, 1],
    ],
    matMul(
      [
        [b, 0, -t],
        [0, 1, 0],
        [t, 0, b],
      ],
      [
        [1, 0, 0],
        [0, a, s],
        [0, -s, a],
      ],
    ),
  );
  return {
    name,
    distance,
    pixel1,
    pixel2,
    wavelength,
    orientation,
    shape: config.max_shape ?? (nativePitch ? known.shape : null),
    nativeModel: nativePitch ? known : null,
    poni1: number("poni1") * 1000,
    poni2: number("poni2") * 1000,
    axes: matMul(poniFrame, rotation),
  };
}

export function calibratedDetector(calibration, shape = calibration.shape) {
  if (!Array.isArray(shape) || shape.length !== 2 || !shape.every((v) => Number.isSafeInteger(v) && v > 0))
    throw Error("Enter the number of rows and columns in the calibrated image.");
  const { axes, distance, pixel1, pixel2, poni1, poni2, orientation } = calibration;
  const [rows, cols] = shape,
    width = cols * pixel2,
    height = rows * pixel1;
  const flipRow = orientation === 1 || orientation === 2;
  const flipCol = orientation === 1 || orientation === 4;
  const [vertical, horizontal, normal] = [0, 1, 2].map((i) => axes.map((row) => row[i]));
  function project(ray) {
    const incidence = dot3(normal, ray);
    if (incidence <= 1e-12 * Math.hypot(...ray)) return null;
    const scale = distance / incidence;
    const y = poni1 + scale * dot3(vertical, ray),
      x = poni2 + scale * dot3(horizontal, ray);
    return { row: (flipRow ? height - y : y) / pixel1 - 0.5, col: (flipCol ? width - x : x) / pixel2 - 0.5 };
  }
  const native = calibration.nativeModel;
  const fullFrame = native && rows === native.shape[0] && cols === native.shape[1];
  const rowGaps = (fullFrame && native.rowGaps) || [],
    colGaps = (fullFrame && native.colGaps) || [];
  const inGap = (pixel, bands) => bands.some(([start, end]) => pixel >= start - 0.5 && pixel < end - 0.5);
  const contains = (hit) =>
    hit &&
    hit.row >= -0.5 &&
    hit.row < rows - 0.5 &&
    hit.col >= -0.5 &&
    hit.col < cols - 0.5 &&
    !inGap(hit.row, rowGaps) &&
    !inGap(hit.col, colGaps);
  // On a planar tile the extrema of 2θ lie on a corner, on an edge,
  // or where the beam axis pierces the tile. Include internal module edges.
  const activeIntervals = (length, gaps) => {
    const intervals = [];
    let start = 0;
    for (const [lo, hi] of gaps) {
      if (lo > start) intervals.push([start, lo]);
      start = hi;
    }
    if (start < length) intervals.push([start, length]);
    return intervals;
  };
  const angleOf = ([x, y, z]) => Math.atan2(Math.hypot(y, z), x);
  const ranges = [];
  for (const [r0, r1] of activeIntervals(rows, rowGaps)) {
    for (const [c0, c1] of activeIntervals(cols, colGaps)) {
      const corners = [
        [r0, c0],
        [r0, c1],
        [r1, c1],
        [r1, c0],
      ].map(([r, c]) =>
        matVec(axes, [
          (flipRow ? rows - r : r) * pixel1 - poni1,
          (flipCol ? cols - c : c) * pixel2 - poni2,
          distance,
        ]),
      );
      const angles = corners.map(angleOf);
      corners.forEach((a, i) => {
        const d = corners[(i + 1) % 4].map((v, j) => v - a[j]);
        const ad = dot3(a, d);
        // Stationary x/|p| along p = a + t*d.
        const t = (a[0] * ad - d[0] * dot3(a, a)) / (d[0] * ad - a[0] * dot3(d, d));
        if (t > 0 && t < 1) angles.push(angleOf(a.map((v, j) => v + t * d[j])));
      });
      for (const sign of [1, -1]) {
        const beam = project([sign, 0, 0]);
        if (
          beam &&
          beam.row + 0.5 >= r0 &&
          beam.row + 0.5 <= r1 &&
          beam.col + 0.5 >= c0 &&
          beam.col + 0.5 <= c1
        )
          angles.push(sign === 1 ? 0 : Math.PI);
      }
      ranges.push([Math.min(...angles), Math.max(...angles)]);
    }
  }
  return {
    ...calibration,
    rows,
    cols,
    width,
    height,
    project,
    contains,
    rowGaps,
    colGaps,
    maxAngle: ranges.reduce((max, range) => Math.max(max, range[1]), 0),
    acceptsCone(theta) {
      return ranges.some(([lo, hi]) => theta >= lo - 1e-12 && theta <= hi + 1e-12);
    },
    caption: cols + " × " + rows + " px",
  };
}
