import test from "node:test";
import assert from "node:assert/strict";
import {
  angleAt,
  dSpacing,
  planeOffsets,
  directVector,
  clipPlaneToBox,
  hullVolume,
  analyzeOperation,
  symmetryElements,
  elementEquation,
} from "../web/crystal-math.js";
import { convexHull } from "../web/coordination.js";

const cubic = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const box = [
  [0, 1],
  [0, 1],
  [0, 1],
];
const inversion = {
  rotation: [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ],
  translation: [0, 0, 0],
};
test("Miller normal uses reciprocal metric while directions use direct vectors", () => {
  const basis = [
    [4, 1, 0],
    [0, 3, 0],
    [0, 0, 6],
  ];
  assert.ok(Math.abs(dSpacing(basis, [1, 0, 0]) - 12 / Math.sqrt(10)) < 1e-10);
  assert.deepEqual(directVector(basis, [1, 1, 0]), [5, 3, 0]);
  const polygon = clipPlaneToBox([1, 1, 0], 1, box);
  assert.equal(polygon.length, 4);
  assert.ok(polygon.every((p) => Math.abs(p[0] + p[1] - 1) < 1e-10));
});
test("angles use the middle atom and handle zero-length segments", () => {
  assert.equal(angleAt([1, 0, 0], [0, 0, 0], [0, 1, 0]), 90);
  assert.equal(angleAt([-1, 0, 0], [0, 0, 0], [1, 0, 0]), 180);
  assert.equal(angleAt([0, 0, 0], [0, 0, 0], [1, 0, 0]), null);
});
test("physical volumes for a tetrahedron and octahedron survive translation", () => {
  for (const [points, expected] of [
    [
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      1 / 6,
    ],
    [
      [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ],
      4 / 3,
    ],
  ]) {
    for (const offset of [0, 100000]) {
      const shifted = points.map((p) => p.map((v) => v + offset)),
        hull = convexHull(shifted);
      assert.ok(Math.abs(hullVolume(shifted, hull.faces) - expected) < 1e-9);
    }
  }
});
test("intrinsic translation distinguishes mirrors, glides and screws", () => {
  const reflection = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, -1],
  ];
  const mirror = analyzeOperation(reflection, [0, 0, 0.5], cubic);
  assert.equal(mirror.kind, "plane");
  assert.equal(mirror.glide, null);
  assert.ok(Math.abs(mirror.c / mirror.coef[2] - 0.25) < 1e-10);
  assert.ok(analyzeOperation(reflection, [0.5, 0, 0.5], cubic).glide);
  const screw = analyzeOperation(
    [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
    [0, 0, 0.5],
    cubic,
  );
  assert.equal(screw.screw, 1);
});
test("P -1 includes inversion centers at half translations", () => {
  const { elements } = symmetryElements([inversion], cubic, box);
  const centers = elements.filter((e) => e.kind === "inversion");
  assert.equal(centers.length, 27);
  assert.ok(
    centers.some((e) => e.point.every((v) => Math.abs(v - 0.5) < 1e-9)),
  );
});
test("P 2 includes all half-cell axes, not just integer-translated axes", () => {
  const op = {
    rotation: [
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
    translation: [0, 0, 0],
  };
  const axes = symmetryElements([op], cubic, box).elements.filter(
    (e) => e.kind === "axis",
  );
  assert.ok(
    axes.some(
      (e) =>
        Math.abs(e.start[0] - 0.5) < 1e-9 && Math.abs(e.start[1] - 0.5) < 1e-9,
    ),
  );
});
test("monoclinic 21/c axes and glide planes retain quarter-cell offsets", () => {
  const screw = {
    rotation: [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    translation: [0, 0.5, 0.5],
  };
  const glide = {
    rotation: [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
    ],
    translation: [0, 0.5, 0.5],
  };
  const { elements } = symmetryElements(
    [screw, glide],
    [
      [4, 0, 1],
      [0, 5, 0],
      [0, 0, 6],
    ],
    box,
  );
  const axes = elements.filter((e) => e.kind === "axis");
  assert.equal(axes.length, 6);
  assert.ok(
    axes.every(
      (e) =>
        e.screw === 1 &&
        [0.25, 0.75].some((z) => Math.abs(e.start[2] - z) < 1e-10),
    ),
  );
  const planes = elements.filter((e) => e.kind === "plane");
  assert.equal(planes.length, 2);
  assert.ok(
    planes.every(
      (e) =>
        e.symbol === "c" &&
        [0.25, 0.75].some((y) => Math.abs(e.c / e.coef[1] - y) < 1e-10),
    ),
  );
});
test("symmetry copies remain complete after a unimodular cell change", () => {
  // Cartesian twofold axis along y, expressed in a sheared lattice basis.
  // A valid axis crosses fractional (0.5,0.5,0.5).
  const basis = [
    [1, 10, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const op = {
    rotation: [
      [-1, -20, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    translation: [0, 0, 0],
  };
  const { elements, note } = symmetryElements([op], basis, box);
  assert.ok(!note);
  assert.ok(
    elements.some(
      (e) =>
        e.kind === "axis" &&
        Math.abs(e.start[0] + 10 * e.start[1] - 5.5) < 1e-8 &&
        Math.abs(e.start[2] - 0.5) < 1e-8,
    ),
  );
});
test("symmetry translation bounds include every axis in the sheared box", () => {
  const basis = [
    [1, 10, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const op = {
    rotation: [
      [-1, -20, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    translation: [0, 0, 0],
  };
  const result = symmetryElements([op], basis, box);
  assert.ok(
    result.elements.some(
      (e) =>
        e.kind === "axis" &&
        Math.abs(e.start[0] + 10 * e.start[1] - 3) < 1e-8 &&
        Math.abs(e.start[2] - 0.5) < 1e-8,
    ),
  );
});
test("glide translation remains within its plane after a cell shear", () => {
  const e = analyzeOperation(
    [
      [-1, -20, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [0, 0.5, 0],
    [
      [1, 10, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  );
  assert.ok(e.glide);
  assert.ok(Math.abs(e.coef.reduce((v, x, i) => v + x * e.glide[i], 0)) < 1e-9);
});
test("proper and improper axes are independent of operation ordering", () => {
  const ops = [
    {
      rotation: [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 0],
    },
    {
      rotation: [
        [0, 1, 0],
        [-1, 0, 0],
        [0, 0, -1],
      ],
      translation: [0, 0, 0],
    },
  ];
  const tally = (r) =>
    r.elements.reduce((counts, e) => {
      counts[e.kind] = (counts[e.kind] || 0) + 1;
      return counts;
    }, {});
  const forward = tally(symmetryElements(ops, cubic, box));
  const reverse = tally(symmetryElements([...ops].reverse(), cubic, box));
  assert.deepEqual(forward, reverse);
  assert.ok(forward.axis > 0 && forward.rotoinversion > 0);
});

test("operation readout keeps the center of its own rotoinversion axis", () => {
  const e = analyzeOperation(
    [
      [-1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ],
    [0.5, 0, 0.5],
    cubic,
  );
  assert.deepEqual(e.point, [0.25, -0.25, 0.25]);
  assert.ok(elementEquation(e).includes("-1/4"));
});
test("centered translations define the shortest axial lattice repeat", () => {
  const R = [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ];
  const operations = [
    { rotation: cubic, translation: [0, 0, 0] },
    { rotation: cubic, translation: [0.5, 0.5, 0] },
    { rotation: R, translation: [0, 0, 0] },
    { rotation: R, translation: [0.5, 0.5, 0] },
  ];
  const { elements } = symmetryElements(operations, cubic, box);
  const originAxis = elements.filter(
    (e) => e.kind === "axis" && e.start.every((v) => Math.abs(v) < 1e-9),
  );
  assert.ok(originAxis.some((e) => e.screw === 0));
  assert.ok(
    originAxis.every((e) => e.screw === 0),
    "A full centering translation was labeled a half-period screw",
  );
});
test("a full in-plane centering translation defines a mirror", () => {
  const mirror = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, -1],
  ];
  const operations = [
    { rotation: cubic, translation: [0, 0, 0] },
    { rotation: cubic, translation: [0.5, 0.5, 0] },
    { rotation: mirror, translation: [0, 0, 0] },
    { rotation: mirror, translation: [0.5, 0.5, 0] },
  ];
  const planes = symmetryElements(operations, cubic, box).elements.filter(
    (e) => e.kind === "plane" && Math.abs(e.c) < 1e-9,
  );
  assert.ok(planes.length > 0);
  assert.ok(
    planes.every((e) => !e.glide),
    "A full in-plane centering translation was labeled a glide",
  );
});
test("element caps truthfully report incomplete output", () => {
  const result = symmetryElements([inversion], cubic, [
    [0, 7],
    [0, 7],
    [0, 7],
  ]);
  assert.equal(result.elements.length, 3000);
  assert.equal(result.complete, false);
  assert.ok(result.note);
});
test("a genuine screw remains a screw in a centered translation lattice", () => {
  const R = [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ];
  const operations = [
    { rotation: cubic, translation: [0, 0, 0] },
    { rotation: cubic, translation: [0.5, 0.5, 0] },
    { rotation: R, translation: [0.25, 0.25, 0] },
    { rotation: R, translation: [0.75, 0.75, 0] },
  ];
  const axis = symmetryElements(operations, cubic, box).elements.filter(
    (e) => e.kind === "axis" && e.start.every((v) => Math.abs(v) < 1e-9),
  );
  assert.ok(axis.length > 0);
  assert.ok(axis.every((e) => e.screw === 1));
});

test("rotoinversion types retain their distinct centers on a shared axis", () => {
  const basis = [
    [1, -0.5, 0],
    [0, Math.sqrt(3) / 2, 0],
    [0, 0, 1],
  ];
  const operations = [
    {
      rotation: [
        [0, 1, 0],
        [-1, 1, 0],
        [0, 0, -1],
      ],
      translation: [0, 0, 0],
    },
    {
      rotation: [
        [-1, 1, 0],
        [-1, 0, 0],
        [0, 0, -1],
      ],
      translation: [0, 0, 0.5],
    },
  ];
  const axes = symmetryElements(operations, basis, box).elements.filter(
    (e) =>
      e.kind === "rotoinversion" &&
      Math.abs(e.start[0]) < 1e-9 &&
      Math.abs(e.start[1]) < 1e-9,
  );
  assert.ok(
    axes.some(
      (e) =>
        e.symbol === "-3" &&
        (e.centers || [e.point]).some((p) => Math.abs(p[2]) < 1e-9),
    ),
  );
  assert.ok(
    axes.some(
      (e) =>
        e.symbol === "-6" &&
        (e.centers || [e.point]).some((p) => Math.abs(p[2] - 0.25) < 1e-9),
    ),
  );
  assert.ok(
    axes.every((e) => !(e.symbols.includes("-3") && e.symbols.includes("-6"))),
  );
});

test("moving the offset translates a whole plane family", () => {
  const ranges = [
    [-1, 2],
    [0, 1],
    [0, 1],
  ];
  assert.deepEqual(
    planeOffsets([1, 0, 0], 0.25, ranges, true).offsets,
    [-0.75, 0.25, 1.25],
  );
  assert.deepEqual(
    planeOffsets([1, 0, 0], 1.25, ranges, true).offsets,
    [-0.75, 0.25, 1.25],
  );
  assert.deepEqual(
    planeOffsets([-1, 0, 0], 0.25, ranges, true).offsets,
    [-1.75, -0.75, 0.25],
  );
  assert.deepEqual(
    planeOffsets([1, 0, 0], 0.25, ranges, false).offsets,
    [0.25],
  );
  assert.equal(planeOffsets([100, 0, 0], 0.25, ranges, true).truncated, true);
});
