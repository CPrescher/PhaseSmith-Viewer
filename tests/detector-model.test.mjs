import "./load-diffraction-engine.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { inverse3, matMul } from "../web/crystal-math.js";
import { identity, mountingMatrix, orientationExport } from "../web/detector-orientation.js";
import { detectorModel, labVector } from "../web/detector-model.js";

const cube = {
  basis: [
    [4, 0, 0],
    [0, 4, 0],
    [0, 0, 4],
  ],
  atoms: [{ element: "Cu", frac: [0, 0, 0] }],
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, a + " differs from " + b);

test("Lecture 3 exact crossing reproduces three forward detector positions", () => {
  const model = detectorModel(cube, 1, 100);
  const angle = (Math.asin(0.25) * 180) / Math.PI;
  const spots = model.spots(angle, 0);
  assert.deepEqual(
    spots.map((s) => s.point.hkl),
    [
      [0, 1, -1],
      [0, 1, 1],
      [0, 2, 0],
    ],
  );
  near(spots[0].y, (100 * Math.sqrt(15)) / 15);
  near(spots[0].z, (-100 * 4) / 15);
  near(spots[1].z, -spots[0].z);
  near(spots[2].y, (100 * 2 * Math.sqrt(15)) / 14);
  assert.equal(model.spots(angle + 0.01, 0).length, 0);
  const rotated = model.spots(angle, 90);
  spots.forEach((s, i) => {
    near(rotated[i].y, -s.z);
    near(rotated[i].z, s.y);
    near(Math.hypot(s.y, s.z), 100 * Math.tan((s.point.twoTheta * Math.PI) / 180));
  });
});

test("target outside the index box and skew-cell mounting share one lab orientation", () => {
  const cell = {
    ...cube,
    basis: [
      [4, 1, 0.5],
      [0, 5, 0.8],
      [0, 0, 6],
    ],
  };
  const model = detectorModel(cell, 0.65, 70, [0, 0, -4]);
  const point = model.requested;
  const at = point.angles[0];
  assert.equal(model.tilt, -90);
  assert.ok(model.spots(at, 35).some((s) => s.point === point));
  const [x, y, z] = labVector(point.g, model.tilt, at, 35);
  near(Math.hypot(1 / 0.65 + x, y, z), 1 / 0.65);
  near(point.twoTheta, (2 * Math.asin(0.65 / 3) * 180) / Math.PI);
});

test("extinctions, inaccessible indices and finite detector bounds are respected", () => {
  const centered = { ...cube, atoms: [...cube.atoms, { element: "Cu", frac: [0.5, 0.5, 0.5] }] };
  const model = detectorModel(centered, 1, 100, [1, 0, 0]);
  assert.equal(model.intensity(model.requested), 0);
  assert.ok(!model.spots(model.requested.angles[0], 0).some((s) => s.point === model.requested));
  const next = model.next(0);
  assert.ok(model.spots(next.angle, 0).some((s) => s.point === next.point));
  const far = detectorModel(cube, 1, 1000, [2, 0, 0]);
  assert.ok(!far.spots(far.requested.angles[0], 0).length);
  assert.equal(far.next(0), null);
  assert.equal(detectorModel(cube, 3, 100, [4, 0, 0]).requested.twoTheta, null);
});

test("coverage follows detector acceptance, wavelength and direct lattice lengths", () => {
  const cell = {
    ...cube,
    basis: [
      [8, 3, 0],
      [0, 4, 0],
      [0, 0, 6],
    ],
  };
  const wide = detectorModel(cell, 1, 100);
  assert.deepEqual(wide.limits, [6, 3, 4]);
  assert.deepEqual(detectorModel(cell, 2, 100).limits, [3, 1, 2]);
  assert.deepEqual(detectorModel(cell, 1, 200).limits, [3, 2, 2]);
  const event = wide.stops.find((e) => Math.abs(e.point.hkl[0]) > 3);
  assert.ok(event);
  const snap = wide.scrub(event.angle - 0.002, event.angle + 0.002, 0.01);
  near(snap.angle, event.angle);
  assert.ok(wide.spots(snap.angle, 0).some((s) => s.point === event.point));
});

test("a targeted search can still run when the full scan exceeds the interactive budget", () => {
  const cell = {
    ...cube,
    basis: [
      [200, 0, 0],
      [0, 200, 0],
      [0, 0, 200],
    ],
  };
  assert.throws(() => detectorModel(cell, 1, 100), /scan is too large/);
  const selected = detectorModel(cell, 1, 100, [7, 2, 1]);
  assert.ok(selected.searchOnly);
  assert.equal(selected.spots(selected.requested.angles[0], 0)[0].point, selected.requested);
});

test("rotation axis sign reverses crossings, and an inclined spindle satisfies elastic scattering", () => {
  const axis = [1, 2, 3],
    negative = axis.map((x) => -x);
  const cell = detectorModel(cube, 1, 50, null, 0, identity, axis);
  const reverse = detectorModel(cube, 1, 50, null, 0, identity, negative);
  const event = cell.next(0),
    backward = reverse.spots(360 - event.angle, 0);
  const forward = cell.spots(event.angle, 0);
  assert.deepEqual(
    forward.map((s) => s.point.hkl),
    backward.map((s) => s.point.hkl),
  );
  forward.forEach((spot, i) => {
    const [x, y, z] = labVector(spot.point.g, 0, event.angle, 0, cell.axis);
    near(Math.hypot(x + 1, y, z), 1);
    near(spot.y, backward[i].y);
    near(spot.z, backward[i].z);
  });
});

test("a beam-parallel spindle preserves a Bragg spot at every angle", () => {
  const a = Math.acos(-0.125),
    u = [
      [Math.cos(a), -Math.sin(a), 0],
      [Math.sin(a), Math.cos(a), 0],
      [0, 0, 1],
    ];
  const scan = detectorModel(cube, 1, 50, [1, 0, 0], 0, u, [1, 0, 0]);
  assert.ok(scan.requested.continuous);
  for (const omega of [-179, -15, 0, 87, 212])
    assert.ok(scan.spots(omega, 0).some((s) => s.point === scan.requested));
});

test("U, UB columns and PhaseSmith reciprocal rows give the same mounting for an oblique cell", () => {
  const cell = [
    [4, 1, 0.4],
    [0, 5, 0.3],
    [0, 0, 6],
  ];
  const U = [
    [0, -1, 0],
    [0, 0, -1],
    [1, 0, 0],
  ];
  const rows = inverse3(matMul(U, cell)),
    ub = rows[0].map((_, i) => rows.map((row) => row[i]));
  for (const [matrix, type] of [
    [U, "U"],
    [rows, "rows"],
    [ub, "UB"],
  ]) {
    const rotation = mountingMatrix(matrix, type, identity, cell);
    rotation.forEach((row, i) => row.forEach((v, j) => near(v, U[i][j])));
  }
  assert.throws(() =>
    mountingMatrix(
      [
        [2, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      "U",
      identity,
      cell,
    ),
  );
  assert.throws(() =>
    mountingMatrix(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, -1],
      ],
      "U",
      identity,
      cell,
    ),
  );
  const parsed = orientationExport({
    geometry: {
      vectors: [
        [0, 0, 1],
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ],
    },
    orientations: [{ orientation_rows: U[0].map((_, i) => U.map((row) => row[i])) }],
  });
  assert.deepEqual(parsed.candidates[0].matrix, U);
  near(parsed.axis[0], Math.SQRT1_2);
  near(parsed.axis[2], Math.SQRT1_2);
});

test("a tilted PONI panel projects a pyFAI reference ray to the corresponding raw pixel", async () => {
  const { readPoni, calibratedDetector } = await import("../web/detector-geometry.js");
  const poni = readPoni(`Detector: Detector
Detector_config: {"pixel1":0.0001,"pixel2":0.0001,"max_shape":[40,60]}
Distance: 0.1
Poni1: 0.001
Poni2: 0.003
Rot1: 0.05
Rot2: 0.1
Rot3: 0.02
Wavelength: 3e-11`);
  // pyFAI calc_pos_zyx at row 9, column 50, mapped into viewer lab coordinates.
  const ray = [0.0992691298084351, -0.0068437515510998345, -0.010149282328464522];
  for (const [orientation, row, col] of [
    [3, 9, 50],
    [2, 30, 50],
    [4, 9, 9],
    [1, 30, 9],
  ]) {
    const panel = calibratedDetector({ ...poni, orientation });
    const hit = panel.project(ray);
    near(hit.row, row);
    near(hit.col, col);
    assert.ok(panel.contains(hit));
    assert.equal(panel.project(ray.map((x) => -x)), null);
  }
});

test("offset panel coverage changes with beam rotation; a circle and a modular panel honor their edges", async () => {
  const { readPoni, calibratedDetector, circularDetector } = await import("../web/detector-geometry.js");
  const text = `Detector: Detector
Detector_config: {"pixel1":0.001,"pixel2":0.001,"max_shape":[20,20]}
Distance: 0.1
Poni1: 0.01
Poni2: 0.065
Rot1: 0
Rot2: 0
Rot3: 0`;
  const panel = calibratedDetector(readPoni(text));
  const scan = detectorModel(cube, 1, 100, [2, 0, 0], 0, identity, [0, 0, 1], panel);
  const onPanel = scan.stops.find((e) => e.point === scan.requested);
  assert.ok(onPanel);
  assert.ok(scan.spots(onPanel.angle, 0).some((s) => s.point === scan.requested && panel.contains(s)));
  assert.ok(!scan.spots(onPanel.angle, 180).some((s) => s.point === scan.requested));
  assert.ok(!scan.stops.some((e) => e.point === scan.requested && e.angle === onPanel.angle));
  const small = detectorModel(cube, 1, 100, [2, 0, 0], 0, identity, [0, 0, 1], circularDetector(40));
  assert.ok(!small.stops.some((e) => e.point === small.requested));
  const named = calibratedDetector(
    readPoni(text.replace(/Detector: Detector\nDetector_config:[^\n]+/, "Detector: Eiger2CdTe_9M")),
  );
  assert.deepEqual([named.rows, named.cols], [3262, 3108]);
  const [start, end] = named.rowGaps[0];
  assert.ok(!named.contains({ row: (start + end) / 2, col: 10 }));
  assert.ok(named.contains({ row: 20, col: 10 }));
});

test("extinct points are hidden and rotating the mounting reuses the same intensities", () => {
  const centered = { ...cube, atoms: [...cube.atoms, { element: "Cu", frac: [0.5, 0.5, 0.5] }] };
  const scan = detectorModel(centered, 1, 100, [1, 0, 0]);
  assert.equal(scan.requested.intensity, 0);
  assert.ok(scan.points.every((p) => p.hkl.reduce((s, v) => s + v, 0) % 2 === 0));
  const strongest = scan.points.find((p) => p.relativeIntensity === 1);
  const weaker = scan.points.find((p) => p.relativeIntensity < 0.99);
  assert.ok(weaker.intensity < strongest.intensity);
  assert.ok(weaker.logArea > weaker.relativeIntensity && weaker.logArea < strongest.logArea);
  const u = [
    [0.8, -0.6, 0],
    [0.6, 0.8, 0],
    [0, 0, 1],
  ];
  const independent = detectorModel(centered, 1, 100, [1, 0, 0], 0, u);
  scan.remount(u, 0, 0);
  assert.deepEqual(scan.stops, independent.stops);
  assert.deepEqual(scan.points, independent.points);
});

test("a free turn finds the actual Bragg crossing between input frames", () => {
  const scan = detectorModel(cube, 1, 100);
  const rz = (angle) => {
    const a = (angle * Math.PI) / 180;
    return [
      [Math.cos(a), -Math.sin(a), 0],
      [Math.sin(a), Math.cos(a), 0],
      [0, 0, 1],
    ];
  };
  const crossing = scan.crossedDuringTurn(rz(14), rz(15));
  assert.ok(crossing);
  scan.remount(crossing.orientation, 0, 0);
  near(Math.hypot(1 + crossing.point.g[0], ...crossing.point.g.slice(1)), 1);
  assert.deepEqual(
    scan.spots(0, 0).map((s) => s.point.hkl),
    [
      [0, 1, -1],
      [0, 1, 1],
      [0, 2, 0],
    ],
  );
  assert.equal(scan.crossedDuringTurn(crossing.orientation, rz(15)), null);
  scan.remount(rz(15), 0, 0);
  assert.deepEqual(scan.spots(0, 0), []);
  assert.ok(scan.crossedDuringTurn(rz(15), rz(14)));
});

test("observable hkl maxima follow rectangular edges, panel corners and azimuth", async () => {
  const { rectangularDetector } = await import("../web/detector-geometry.js");
  const setup = (w, h) =>
    detectorModel(cube, 1, 100, null, 0, identity, [0, 0, 1], rectangularDetector(w, h, 100));
  const wide = setup(180, 100),
    tall = setup(100, 180);
  assert.deepEqual(wide.limits, tall.limits);
  assert.deepEqual(wide.observedLimits, [2, 2, 1]);
  assert.deepEqual(tall.observedLimits, [1, 1, 2]);
  tall.setAzimuth(90);
  assert.deepEqual(tall.observedLimits, wide.observedLimits);
  const square = setup(200, 200);
  assert.ok(square.stops.some((e) => square.spots(e.angle, 0).some((s) => s.point.radius > 100)));
});

test("linked turns recover the two slider angles and preserve an imported mounting", () => {
  for (const axis of [
    [0, 0, 1],
    [0.6, 0, 0.8],
  ]) {
    const mounting = [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ];
    const scan = detectorModel(cube, 1, 100, null, 13, mounting, axis);
    let rock = 179,
      azimuth = -177;
    for (const [omega, phi] of [
      [-174, -177],
      [-174, 172],
      [65.68, -10.25],
    ]) {
      const start = scan.orientation(rock, azimuth),
        end = scan.orientation(omega, phi);
      ({ rock, azimuth } = scan.followTurn(start, end, rock, azimuth));
      near(rock, omega);
      near(azimuth, phi);
      assert.equal(scan.mounting, mounting);
      near(scan.tilt, 13);
    }
  }
});

test("arbitrary free turns retain the exact pose for perpendicular and parallel axes", () => {
  for (const axis of [
    [0, 0, 1],
    [1, 0, 0],
    [-1, 0, 0],
  ]) {
    const scan = detectorModel(cube, 1, 100, null, 0, identity, axis);
    const start = scan.orientation(9, 23);
    const quarterTurnY = [
      [0, 0, 1],
      [0, 1, 0],
      [-1, 0, 0],
    ];
    const end = matMul(quarterTurnY, scan.orientation(25, 23));
    const { rock, azimuth } = scan.followTurn(start, end, 9, 23);
    if (axis[0]) near(azimuth, 23);
    const actual = scan.orientation(rock, azimuth);
    actual.forEach((row, i) => row.forEach((v, j) => near(v, end[i][j])));
  }
});

test("a linked drag attracts, holds and releases exact observable reflections in either direction", () => {
  const scan = detectorModel(cube, 1, 100);
  const omega = (Math.asin(0.25) * 180) / Math.PI;
  for (const sign of [1, -1]) {
    const start = scan.orientation(omega - sign, 0);
    const approach = scan.orientation(omega - sign * 0.2, 0);
    const hit = scan.crossedDuringTurn(start, approach, 0.35);
    assert.ok(hit);
    const angles = scan.followTurn(start, hit.orientation, omega - sign, 0);
    near(angles.rock, omega);
    near(angles.azimuth, 0);
    const spots = scan.spots(angles.rock, angles.azimuth);
    assert.equal(spots.length, 3);
    assert.ok(spots.some((s) => s.point === hit.point));
    const held = scan.crossedDuringTurn(
      hit.orientation,
      scan.orientation(omega + sign * 0.6, 0),
      0.35,
      hit.point,
    );
    assert.ok(held);
    assert.equal(held.point, hit.point);
    assert.deepEqual(held.orientation, hit.orientation);
    const beyond = scan.orientation(omega + sign * 0.8, 0);
    assert.equal(scan.crossedDuringTurn(held.orientation, beyond, 0.35, hit.point), null);
    const released = scan.followTurn(held.orientation, beyond, angles.rock, 0);
    assert.deepEqual(scan.spots(released.rock, released.azimuth), []);
    // A beam roll keeps the same three indices and moves their detector positions.
    assert.equal(
      scan.crossedDuringTurn(hit.orientation, scan.orientation(omega, 0.4), 0.35, hit.point),
      null,
    );
    const spin = scan.followTurn(hit.orientation, scan.orientation(omega, 32), angles.rock, 0);
    near(spin.rock, omega);
    near(spin.azimuth, 32);
    const rotated = scan.spots(spin.rock, spin.azimuth);
    assert.deepEqual(
      rotated.map((s) => s.point),
      spots.map((s) => s.point),
    );
    assert.notEqual(rotated[0].y, spots[0].y);
  }
});

test("full-scan index maxima include a continuous Bragg cone that enters a rectangular panel later", async () => {
  const { rectangularDetector } = await import("../web/detector-geometry.js");
  const a = Math.acos(-0.125);
  const u = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ];
  const scan = detectorModel(cube, 1, 100, [1, 0, 0], 0, u, [1, 0, 0], rectangularDetector(10, 70, 100));
  assert.deepEqual(scan.spots(0, 0), []);
  assert.ok(scan.spots(90, 0).some((s) => s.point === scan.requested));
  assert.deepEqual(scan.observedLimits, [1, 0, 0]);
});
