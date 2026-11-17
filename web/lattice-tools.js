// Lattice tools: (hkl) planes, [uvw] direction arrows and symmetry
// elements. Owns its sidebar UI, its Three.js groups and its state; the
// viewer supplies coordinate conversion and structure access.
import {
  parseMillerIndices,
  parseTriple,
  dSpacing,
  clipPlaneToBox,
  planeOffsets,
  initialPlaneOffset,
  planeDisplayRanges,
  directVector,
  symmetryElements,
  filterSymmetryElements,
  elementCategory,
  elementEquation,
  operationString,
} from "./crystal-math.js";
import { PEEL_LAYER } from "./peel.js";

const PLANE_COLORS = ["#f2c14e", "#7fb7ff", "#ef7fb0", "#8cdf9b"];
const ARROW_COLORS = ["#ff8a5c", "#5cc8ff", "#c6a0ef", "#e7edf3"];
export const SYMMETRY_CATEGORIES = [
  { id: "rotation", label: "Rotation" },
  { id: "screw", label: "Screw" },
  { id: "rotoinversion", label: "Rotoinversion" },
  { id: "inversion", label: "Inversion" },
  { id: "mirror", label: "Mirror" },
  { id: "glide", label: "Glide" },
];
const AXIS_COLORS = { 2: "#6ea8ff", 3: "#8cdf9b", 4: "#efa04c", 6: "#ef6fa7" };
const AXIS_TYPE_KEYS = [
  ...[2, 3, 4, 6].map((n) => `rotation:${n}`),
  ...[2, 3, 4, 6].flatMap((n) => Array.from({ length: n - 1 }, (_, p) => `screw:${n}${"₀₁₂₃₄₅₆₇₈₉"[p + 1]}`)),
  ...[3, 4, 6].map((n) => `rotoinversion:-${n}`),
];
const DARK_CATEGORY_COLORS = {
  rotoinversion: "#c6a0ef",
  inversion: "#ffe08a",
  mirror: "#62d5df",
  glide: "#f2c14e",
};
// Darker variants keep thin lines and small points readable on the light
// canvas; categories keep the same hues.
const LIGHT_CATEGORY_COLORS = {
  rotoinversion: "#7a4fc0",
  inversion: "#b07a00",
  mirror: "#0f8fa0",
  glide: "#b8860b",
};
const LIGHT_AXIS_COLORS = { 2: "#2f6fd0", 3: "#1f9a45", 4: "#c46a00", 6: "#c4307a" };
const isLight = () => document.documentElement.dataset.theme === "light";
const CATEGORY_COLORS = new Proxy(
  {},
  { get: (_, key) => (isLight() ? LIGHT_CATEGORY_COLORS : DARK_CATEGORY_COLORS)[key] },
);

const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const fmt = (v) => String(Number(v.toFixed(4)));

export function createLatticeTools({ THREE, scene, invalidate, getStructure, getRanges, toScene, getSceneBounds }) {
  const $ = (id) => document.getElementById(id);
  const group = new THREE.Group();
  group.name = "lattice-tools";
  scene.add(group);
  let planes = [],
    arrows = [],
    nextId = 0;
  const symmetry = {
    shown: false,
    filters: new Set(SYMMETRY_CATEGORIES.map((c) => c.id)),
    hiddenTypes: new Set(),
    opacity: 0.3,
    cacheKey: "",
    result: null,
  };

  // ---- Rendering ----------------------------------------------------------
  function disposeGroup() {
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    group.clear();
  }
  const vec = (frac) => toScene(frac);
  function fan(polygons, positions, colors, color) {
    const tint = new THREE.Color(color);
    for (const polygon of polygons) {
      const pts = polygon.map(vec);
      for (let i = 1; i + 1 < pts.length; i++)
        for (const p of [pts[0], pts[i], pts[i + 1]]) {
          positions.push(p.x, p.y, p.z);
          colors?.push(tint.r, tint.g, tint.b);
        }
    }
  }
  function outline(polygons, positions, colors, color) {
    const tint = new THREE.Color(color);
    for (const polygon of polygons) {
      const pts = polygon.map(vec);
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
        colors?.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
      });
    }
  }
  const geometryOf = (positions, colors) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return g;
  };

  // Plane face opacity, live on the existing material (no geometry rebuild):
  //   0       faces hidden (out of depth peeling too); outline and label stay;
  //   (0, 1)  translucent, peeled per pixel with polyhedron faces;
  //   1       opaque, ordinary depth-writing path on layer 0.
  function setFaceOpacity(mesh, opacity) {
    const material = mesh.material;
    const opaque = opacity >= 1;
    mesh.visible = opacity > 0;
    material.opacity = opacity;
    if (material.transparent === opaque) {
      material.transparent = !opaque;
      material.needsUpdate = true;
    }
    material.depthWrite = opaque;
    mesh.layers.set(opaque ? 0 : PEEL_LAYER);
  }
  function renderPlanes(structure, ranges) {
    for (const plane of planes) {
      plane.faceMesh = null;
      plane.render = { offsets: [], polygons: [], truncated: false };
      if (plane.error) continue;
      try {
        plane.d = dSpacing(structure.basis, plane.hkl);
      } catch (error) {
        plane.error = error.message;
        continue;
      }
      // Family offsets come from the real plotting range; only each
      // polygon's clipping box grows with plane.size.
      const { offsets, truncated } = planeOffsets(plane.hkl, plane.m, ranges, plane.family);
      const clipBox = planeDisplayRanges(ranges, plane.size / 100);
      const polygons = [];
      for (const m of offsets) {
        const polygon = clipPlaneToBox(plane.hkl, m, clipBox);
        if (polygon) polygons.push({ m, polygon });
      }
      plane.render = { offsets, polygons, truncated };
      if (!plane.visible || !polygons.length) continue;
      const faces = [],
        edges = [];
      fan(polygons.map((p) => p.polygon), faces, null, plane.color);
      outline(polygons.map((p) => p.polygon), edges, null, plane.color);
      const mesh = new THREE.Mesh(
        geometryOf(faces),
        new THREE.MeshBasicMaterial({
          color: plane.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: plane.opacity,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 3;
      mesh.userData.tool = "plane";
      plane.faceMesh = mesh;
      setFaceOpacity(mesh, plane.opacity);
      group.add(
        mesh,
        new THREE.LineSegments(
          geometryOf(edges),
          new THREE.LineBasicMaterial({ color: plane.color, transparent: true, opacity: 0.9 }),
        ),
      );
    }
  }

  function renderArrows(structure) {
    const up = new THREE.Vector3(0, 1, 0);
    for (const arrow of arrows) {
      arrow.render = null;
      if (arrow.error) continue;
      const end = arrow.origin.map((v, i) => v + arrow.length * arrow.uvw[i]);
      const length = Math.hypot(...directVector(structure.basis, arrow.uvw, arrow.length));
      const start = vec(arrow.origin),
        stop = vec(end);
      arrow.render = { end, length, start: start.toArray(), stop: stop.toArray() };
      if (!arrow.visible || length < 1e-9) continue;
      const dir = stop.clone().sub(start).normalize();
      const head = Math.min(0.45, length * 0.3),
        shaft = length - head;
      const material = new THREE.MeshStandardMaterial({ color: arrow.color, roughness: 0.45 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, shaft, 12), material);
      body.position.copy(start).addScaledVector(dir, shaft / 2);
      body.quaternion.setFromUnitVectors(up, dir);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, head, 16), material.clone());
      cone.position.copy(start).addScaledVector(dir, shaft + head / 2);
      cone.quaternion.setFromUnitVectors(up, dir);
      group.add(body, cone);
    }
  }

  function computeSymmetry(structure, ranges) {
    const ops = structure.symmetryOperations;
    if (!Array.isArray(ops)) return { elements: [], analyses: [], note: "Symmetry operations are not available from this engine build.", unavailable: true };
    const key = JSON.stringify(ranges) + "|" + ops.length;
    if (symmetry.cacheKey !== key) {
      symmetry.cacheKey = key;
      symmetry.result = symmetryElements(ops, structure.basis, ranges);
      if (!symmetry.result.analyses.some((a) => !["translation", "unsupported"].includes(a.kind)))
        symmetry.result.note = ["Only translations (P1): no point or plane symmetry elements.", symmetry.result.note]
          .filter(Boolean)
          .join(" ");
    }
    return symmetry.result;
  }

  function renderSymmetry(structure, ranges) {
    if (!symmetry.shown) return;
    const { elements } = computeSymmetry(structure, ranges);
    const visible = filterSymmetryElements(elements, symmetry.filters, symmetry.hiddenTypes);
    const solid = { positions: [], colors: [] },
      dashed = { positions: [], colors: [] },
      planeFaces = { positions: [], colors: [] },
      planeEdges = { positions: [], colors: [] },
      glideEdges = { positions: [], colors: [] },
      dots = [];
    for (const e of visible) {
      const category = elementCategory(e);
      if (e.kind === "axis" || e.kind === "rotoinversion") {
        const color =
          e.kind === "axis"
            ? (isLight() ? LIGHT_AXIS_COLORS : AXIS_COLORS)[e.order]
            : CATEGORY_COLORS.rotoinversion;
        const target = category === "rotation" ? solid : dashed;
        const tint = new THREE.Color(color);
        const a = vec(e.start),
          b = vec(e.end);
        target.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        target.colors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
        for (const c of e.centers ?? []) dots.push({ p: vec(c), color });
      } else if (e.kind === "plane") {
        const color = CATEGORY_COLORS[category];
        fan([e.polygon], planeFaces.positions, planeFaces.colors, color);
        outline([e.polygon], (category === "glide" ? glideEdges : planeEdges).positions, (category === "glide" ? glideEdges : planeEdges).colors, color);
      } else if (e.kind === "inversion") dots.push({ p: vec(e.point), color: CATEGORY_COLORS.inversion });
    }
    const lines = (data, dashedLine) => {
      if (!data.positions.length) return;
      const line = new THREE.LineSegments(
        geometryOf(data.positions, data.colors),
        dashedLine
          ? new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 0.25, gapSize: 0.15 })
          : new THREE.LineBasicMaterial({ vertexColors: true }),
      );
      if (dashedLine) line.computeLineDistances();
      line.renderOrder = 4;
      line.userData.tool = "symmetry";
      group.add(line);
    };
    lines(solid, false);
    lines(dashed, true);
    lines(planeEdges, false);
    lines(glideEdges, true);
    if (planeFaces.positions.length) {
      const mesh = new THREE.Mesh(
        geometryOf(planeFaces.positions, planeFaces.colors),
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: symmetry.opacity,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 3;
      mesh.layers.set(PEEL_LAYER);
      mesh.userData.tool = "symmetry-planes";
      group.add(mesh);
    }
    if (dots.length) {
      const spheres = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.11, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        dots.length,
      );
      const m = new THREE.Matrix4(),
        tint = new THREE.Color();
      dots.forEach((d, i) => {
        spheres.setMatrixAt(i, m.makeTranslation(d.p.x, d.p.y, d.p.z));
        spheres.setColorAt(i, tint.set(d.color));
      });
      spheres.userData.tool = "symmetry-points";
      group.add(spheres);
    }
  }

  function rebuild() {
    disposeGroup();
    anchors = [];
    cachedBounds.makeEmpty();
    const structure = getStructure();
    if (!structure) return;
    const ranges = getRanges();
    renderPlanes(structure, ranges);
    renderArrows(structure);
    renderSymmetry(structure, ranges);
    refreshReadouts(structure, ranges);
    collectLabelAnchors();
    cachedBounds.setFromObject(group);
    invalidate();
  }
  const cachedBounds = new THREE.Box3();

  // ---- Plane and direction labels ---------------------------------------
  // Anchors (scene positions + text) are rebuilt with the overlays; each
  // frame they are projected into a small reused pool of spans, front-most
  // first, overlaps skipped and capped. Hidden or removed entries have no
  // anchor, so their labels disappear with them.
  const LABEL_LIMIT = 80;
  let labelsOn = true,
    labelOffsets = true, // include "· m=…" in plane labels (kept while labels are off)
    anchors = [],
    shownLabels = [];
  const labelPool = [];
  const projected = new THREE.Vector3();
  const indexText = (v, open, close) =>
    v.every((x) => Number.isInteger(x) && Math.abs(x) < 10)
      ? `${open}${v.map((x) => (x < 0 ? `${-x}̄` : String(x))).join("")}${close}`
      : `${open}${v.map(fmt).join(" ")}${close}`;
  function collectLabelAnchors() {
    anchors = [];
    if (!labelsOn) return;
    for (const plane of planes) {
      if (!plane.visible || plane.error || !plane.render) continue;
      const name = indexText(plane.hkl, "(", ")");
      for (const { m, polygon } of plane.render.polygons) {
        const centroid = [0, 1, 2].map((i) => polygon.reduce((s, p) => s + p[i], 0) / polygon.length);
        // "Show m in labels" changes label text only, never the plane or
        // where its label is anchored.
        const text = labelOffsets ? `${name} · m=${fmt(m)}` : name;
        // The ACTUAL drawn polygon (after Size clipping) anchors the label.
        anchors.push({
          // Stable identity across frames and rebuilds: entry + family offset.
          key: `p${plane.id}:${fmt(m)}`,
          text,
          color: plane.color,
          world: vec(centroid),
          verts: polygon.map(vec),
          kind: "plane",
          planeId: plane.id,
        });
      }
    }
    for (const arrow of arrows) {
      if (!arrow.visible || arrow.error || !arrow.render) continue;
      const text = `${indexText(arrow.uvw, "[", "]")}${arrow.length !== 1 ? ` ×${fmt(arrow.length)}` : ""}`;
      anchors.push({ key: `a${arrow.id}`, text, color: arrow.color, world: vec(arrow.render.end), kind: "arrow" });
    }
  }
  // ---- Placement ----------------------------------------------------------
  // Plane label position: "outside" (default) puts the label box just
  // beyond a projected polygon edge with a short leader to that edge;
  // "edge" puts it against an edge without a leader; "center" keeps the
  // old centroid placement. Candidates per label: ≤ 6 edges × 3 points ×
  // a few variants, scored against the canvas, earlier labels, the view
  // overlays and the model's projected box — no per-atom or per-triangle
  // work. Arrow labels keep their place beside the tip.
  let labelPosition = "outside";
  const LEADER = 14,
    LABEL_H = 16,
    REJECT = 600;
  const widthCache = new Map();
  let measureCtx = null;
  function labelWidth(text, layer) {
    let w = widthCache.get(text);
    if (w === undefined) {
      if (!measureCtx) {
        measureCtx = document.createElement("canvas").getContext("2d");
        measureCtx.font = `11px ${getComputedStyle(layer).fontFamily}`;
      }
      // padding 4 + 4 and the 3px color bar (see .lattice-label); the
      // exporter draws the same box width.
      w = measureCtx.measureText(text).width + 11;
      if (widthCache.size > 500) widthCache.clear();
      widthCache.set(text, w);
    }
    return w;
  }
  // View overlays (toolbar, measurement card, legend, compass, atom
  // count) in canvas CSS px, read on EVERY rendered frame that places
  // plane labels. No time cache: rendering is on demand, so the frame
  // after a selection (which grows the measurement/Info card) may be the
  // last one; it must see the card's new size. A handful of DOM reads.
  // Includes the Turn button (floats under the toolbar on phones), the
  // open Turn popover (or the phone Turn dock), the [uvw] form, the tool
  // rail or phone Tools menu and the open tool windows; hidden ones have
  // no box over the canvas and drop out by themselves.
  const OBSTACLES = [
    ".view-directions",
    "#turn-open",
    "#turn-panel",
    "#tool-rail",
    ".tool-window:not([hidden])",
    "#history-controls",
    ".view-directions details[open] #direction-form",
    ".measure-row",
    ".measure-details",
    ".view-bottom > *",
    ".axis-compass",
    "#atom-summary",
  ];
  let obstacles = [], exportMode = false, exportObstacles = [], savedPlacement = null;
  function refreshObstacles(canvasRect) {
    obstacles = [];
    if (exportMode) {
      obstacles = exportObstacles;
      return;
    } // Application windows/toolbars are absent from image output.
    for (const selector of OBSTACLES)
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          obstacles.push({ x: r.left - canvasRect.left, y: r.top - canvasRect.top, w: r.width, h: r.height });
      }
  }
  const hits = (a, b, pad = 0) =>
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const overlapFraction = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
      h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / (a.w * a.h) : 0;
  };
  // Nearest point of a rectangle to p (leader end).
  const nearest = (r, p) => ({
    x: Math.min(Math.max(p.x, r.x), r.x + r.w),
    y: Math.min(Math.max(p.y, r.y), r.y + r.h),
  });
  const boxCorners = new Array(8).fill(0).map(() => new THREE.Vector3());
  function modelRect(camera, W, H) {
    const box = getSceneBounds?.();
    if (!box || box.isEmpty()) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    boxCorners.forEach((v, i) => {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      const x = ((v.x + 1) * W) / 2,
        y = ((1 - v.y) * H) / 2;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Soft score (lower is better) plus a hard flag: off the canvas, under a
  // view overlay, or overlapping an already placed label.
  // Blocked = off the canvas, under a view overlay or over a placed label.
  // `pad` > 0 demands clearance; a negative pad tolerates touching.
  function blocked(rect, ctx, pad) {
    const { W, H, placed } = ctx;
    const edge = Math.max(pad, 0);
    return (
      rect.x < edge ||
      rect.y < edge ||
      rect.x + rect.w > W - edge ||
      rect.y + rect.h > H - edge ||
      obstacles.some((o) => hits(rect, o, pad)) ||
      placed.some((p) => hits(rect, p.rect, pad))
    );
  }
  // Two hard tests (spatial hysteresis): a NEW spot needs NEW_PAD px of
  // clearance (`hard`), but the spot a label already holds stays usable
  // until it truly overlaps (`hardKeep`, KEEP_PAD). A few pixels of drift
  // therefore never force a label off a spot it would want right back.
  function score(rect, leader, base, ctx) {
    const { placed, model } = ctx;
    let s = base;
    const hard = blocked(rect, ctx, NEW_PAD);
    const hardKeep = hard ? blocked(rect, ctx, KEEP_PAD) : false;
    if (leader && placed.some((p) => segmentHitsRect(leader, p.rect))) s += 40;
    if (model) s += 220 * overlapFraction(rect, model);
    return { s, hard, hardKeep };
  }
  function segmentHitsRect(l, r) {
    // Coarse: sample the short leader.
    for (let t = 0; t <= 1; t += 0.25) {
      const x = l.x1 + (l.x2 - l.x1) * t,
        y = l.y1 + (l.y2 - l.y1) * t;
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    }
    return false;
  }
  // ---- Stability ----------------------------------------------------------
  // Each label has a stable key (plane id + family offset m; arrow id) and
  // remembers its chosen candidate, a candidate id that names a polygon
  // edge, a point along it, a side and a variant. Every frame the remembered
  // candidate is re-evaluated at its edge's CURRENT projection, so the label
  // follows the plane smoothly. It switches only when that candidate
  // becomes unusable (off canvas, under a view overlay, colliding) or when
  // another candidate is better by more than SWITCH_MARGIN. Labels shown in
  // the previous frame are placed first, in the order they first appeared,
  // so tiny depth changes never reshuffle collision priority. A visible
  // label hides only at a looser threshold than a new label needs to
  // appear. The cache holds one small entry per current anchor and is
  // pruned every frame; a new structure, Labels off or a position change
  // clears it.
  //
  // Dense-scene additions (repeated A→B→A hops):
  //  - spatial hysteresis: a held spot is abandoned only when it truly
  //    overlaps (KEEP_PAD), while a new spot needs NEW_PAD px clearance;
  //  - dwell: for DWELL_FRAMES rendered frames after any switch, a usable
  //    held spot is never swapped for a merely better one;
  //  - reverse penalty: for REVERSE_FRAMES frames the spot just left costs
  //    REVERSE_PENALTY extra, so a label does not hop straight back;
  //  - permanent priority: a label's rank is fixed when first seen and
  //    kept while it is hidden, so hide/show never reorders collisions.
  // Frames count rendered frames only (on-demand rendering: no timers or
  // extra frames); a hard block still relocates immediately.
  const SWITCH_MARGIN = 30,
    FAMILY_NEW = 150, // a further family member needs a clear spot to appear…
    FAMILY_KEEP = 260, // …and keeps showing until it gets clearly worse.
    NEW_PAD = 4,
    KEEP_PAD = -1,
    DWELL_FRAMES = 20,
    REVERSE_FRAMES = 60,
    REVERSE_PENALTY = 80,
    // Moving labels (cascade control):
    HELD_PENALTY = 260, // landing on another label's previous-frame spot
    DISPLACE_FREE = 24, // px of free movement for a relocating label…
    DISPLACE_COST = 0.45, // …then this cost per px (a 180 px jump ≈ +70)
    LONG_JUMP = 110; // a second long forced jump within REVERSE_FRAMES culls
  // key → { rank, cand, nv, visible, lastCand, switchFrame, switches }
  const placementCache = new Map();
  let nextRank = 0,
    frameNo = 0,
    cachedPosition = labelPosition;
  // All candidates for one plane label, each with a stable id.
  function planeCandidates(sv, w, ctx) {
    const h = LABEL_H;
    const n = sv.length;
    let cx = 0,
      cy = 0,
      area = 0;
    for (let i = 0; i < n; i++) {
      cx += sv[i].x / n;
      cy += sv[i].y / n;
      const q = sv[(i + 1) % n];
      area += sv[i].x * q.y - q.x * sv[i].y;
    }
    const out = [];
    if (labelPosition === "center") {
      const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
      const off = cx < 0 || cy < 0 || cx > ctx.W || cy > ctx.H;
      const hard = off || ctx.placed.some((p) => hits(rect, p.rect, NEW_PAD));
      const hardKeep = off || ctx.placed.some((p) => hits(rect, p.rect, KEEP_PAD));
      out.push({ id: "center", s: 0, hard, hardKeep, rect, leader: null, x: cx, y: cy });
      return out;
    }
    // Edge-on (degenerate projection): outward is ambiguous, both sides
    // are equal. Otherwise the inward side is merely penalised, so a kept
    // candidate stays identifiable while a plane turns through edge-on.
    const degenerate = Math.abs(area) / 2 < 40;
    const mc = ctx.model ? { x: ctx.model.x + ctx.model.w / 2, y: ctx.model.y + ctx.model.h / 2 } : { x: ctx.W / 2, y: ctx.H / 2 };
    // Several points per edge so a crowded label can shift locally along
    // its own edge before relocating across the polygon.
    const ts = [0.5, 0.3, 0.7, 0.15, 0.85];
    for (let i = 0; i < n; i++) {
      const P = sv[i],
        Q = sv[(i + 1) % n];
      const dx = Q.x - P.x,
        dy = Q.y - P.y,
        len = Math.hypot(dx, dy);
      if (len < 6) continue;
      // Sides are relative to the raw edge perpendicular, which turns
      // continuously with the view (unlike "outward", which can flip).
      const rx = -dy / len,
        ry = dx / len;
      const mid = { x: (P.x + Q.x) / 2, y: (P.y + Q.y) / 2 };
      const outwardSign = (mid.x - cx) * rx + (mid.y - cy) * ry >= 0 ? 1 : -1;
      for (let ti = 0; ti < ts.length; ti++) {
        const t = ts[ti];
        const M = { x: P.x + dx * t, y: P.y + dy * t };
        for (const sign of [1, -1]) {
          const ux = rx * sign,
            uy = ry * sign;
          const inward = !degenerate && sign !== outwardSign ? 60 : 0;
          // Prefer edges facing away from the model's middle.
          const away = Math.hypot(M.x - mc.x, M.y - mc.y) || 1;
          const facing = 12 * (1 - ((M.x - mc.x) * ux + (M.y - mc.y) * uy) / away) + (t === 0.5 ? 0 : 3) + inward;
          const ext = (Math.abs(ux) * w) / 2 + (Math.abs(uy) * h) / 2;
          const at = (dist) => ({ x: M.x + ux * dist - w / 2, y: M.y + uy * dist - h / 2, w, h });
          const add = (variant, rect, leader, base) => {
            const { s, hard, hardKeep } = score(rect, leader, base, ctx);
            out.push({ id: `${i}:${ti}:${sign > 0 ? "+" : "-"}:${variant}`, s, hard, hardKeep, rect, leader, x: M.x, y: M.y });
          };
          if (labelPosition === "outside") {
            const rect = at(LEADER + ext);
            const end = nearest(rect, M);
            add("leader", rect, { x1: M.x, y1: M.y, x2: end.x, y2: end.y }, facing);
          }
          // Against the edge, outside (Edge mode; Outside fallback).
          add("touch", at(ext + 1), null, facing + (labelPosition === "outside" ? 90 : 0));
          // Tight views: straddling or just inside the edge.
          add("straddle", at(0), null, facing + 140);
          add("inside", at(-(ext + 1)), null, facing + 170);
        }
      }
    }
    return out;
  }
  // Placement for one plane label with hysteresis, or null (hidden).
  function placePlane(a, sv, w, ctx, prev) {
    const cands = planeCandidates(sv, w, ctx);
    const sinceSwitch = prev?.switchFrame == null ? Infinity : frameNo - prev.switchFrame;
    const edgeOf = (id) => {
      const [i, , sign] = String(id).split(":");
      return `${i}:${sign}`;
    };
    const heldEdge = prev?.cand ? edgeOf(prev.cand) : null,
      leftEdge = prev?.lastCand ? edgeOf(prev.lastCand) : null;
    const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const from = (prev?.visible || prev?.culled) && prev.rect ? center(prev.rect) : null;
    // Spots other visible labels held last frame and not yet placed now
    // (lower priority): a moving label must not knock them off.
    const held = [];
    for (const [key, r] of ctx.heldRects) if (key !== a.key && !ctx.placedKeys.has(key)) held.push(r);
    const displacement = (c) => (from ? Math.hypot(center(c.rect).x - from.x, center(c.rect).y - from.y) : 0);
    // Cost of a candidate for a label that relocates.
    const adjusted = (c) => {
      let v = c.s;
      // Back to the edge/side just left (any point on it): no quick return.
      if (leftEdge && sinceSwitch < REVERSE_FRAMES && edgeOf(c.id) === leftEdge && edgeOf(c.id) !== heldEdge) v += REVERSE_PENALTY;
      if (held.some((r) => hits(c.rect, r, 2))) v += HELD_PENALTY;
      v += Math.max(0, displacement(c) - DISPLACE_FREE) * DISPLACE_COST;
      return v;
    };
    let best = null,
      bestScore = Infinity;
    for (const c of cands)
      if (!c.hard) {
        const v = adjusted(c);
        if (v < bestScore) {
          best = c;
          bestScore = v;
        }
      }
    // The held spot stays usable until it truly overlaps (KEEP_PAD).
    const kept = prev?.cand && prev.nv === sv.length ? cands.find((c) => c.id === prev.cand && !c.hardKeep) : null;
    let chosen,
      reason;
    if (kept) {
      // Within the dwell window a usable held spot is never traded for a
      // merely better one; afterwards only for a clearly better one.
      const switchOK = sinceSwitch >= DWELL_FRAMES && best && bestScore < kept.s - SWITCH_MARGIN;
      chosen = switchOK ? best : kept;
      reason = switchOK ? "better" : "kept";
    } else {
      chosen = best;
      reason = prev?.cand ? "forced" : "new";
      // Anti-oscillation: a label already relocated recently that would
      // now have to jump far again waits hidden (its held spot is
      // remembered) instead of teleporting back and forth.
      if (chosen && (prev?.visible || prev?.culled) && prev.cand && sinceSwitch < REVERSE_FRAMES && displacement(chosen) > LONG_JUMP) {
        ctx.culled.push(a.key);
        return null;
      }
    }
    if (!chosen || chosen.s >= REJECT) return null;
    // Do not cover the middle of the model just to label every member of
    // a family; a visible member hides only when clearly worse.
    const limit = prev?.visible ? FAMILY_KEEP : FAMILY_NEW;
    if (chosen.s >= limit && ctx.placed.some((p) => p.planeId === a.planeId)) return null;
    return { ...chosen, kept: chosen === kept, reason, displacement: Math.round(displacement(chosen)) };
  }
  function updateLabels(camera, canvas) {
    if (!anchors.length && !shownLabels.length) return;
    const layer = $("lattice-labels");
    const canvasRect = canvas.getBoundingClientRect();
    const { width: W, height: H } = canvasRect;
    const toScreen = (v) => {
      projected.copy(v).project(camera);
      return { x: ((projected.x + 1) * W) / 2, y: ((1 - projected.y) * H) / 2, z: projected.z };
    };
    const candidates = [];
    for (const a of anchors) {
      const c = toScreen(a.world);
      if (Math.abs(c.z) > 1) continue;
      if (a.kind === "plane") {
        const sv = a.verts.map(toScreen);
        // Skip polygons entirely off the canvas.
        if (sv.every((p) => p.x < 0) || sv.every((p) => p.x > W) || sv.every((p) => p.y < 0) || sv.every((p) => p.y > H)) continue;
        candidates.push({ ...a, sv, x: c.x, y: c.y, z: c.z });
      } else {
        if (c.x < 0 || c.y < 0 || c.x > W || c.y > H) continue;
        candidates.push({ ...a, x: c.x, y: c.y, z: c.z });
      }
    }
    // Stable priority: labels shown last frame first, in the order they
    // first appeared; new ones after them, front-most first.
    if (cachedPosition !== labelPosition) {
      placementCache.clear();
      cachedPosition = labelPosition;
    }
    const live = new Set(anchors.map((a) => a.key));
    for (const key of placementCache.keys()) if (!live.has(key)) placementCache.delete(key);
    const rankOf = (c) => placementCache.get(c.key)?.rank ?? Infinity;
    candidates.sort((p, q) => rankOf(p) - rankOf(q) || p.z - q.z || (p.key < q.key ? -1 : 1));
    if (candidates.length) refreshObstacles(canvasRect);
    // Previous-frame spots of visible labels (cascade control), keyed.
    const heldRects = new Map();
    for (const [key, entry] of placementCache) if (entry.visible && entry.rect) heldRects.set(key, entry.rect);
    const ctx = {
      W,
      H,
      placed: [],
      placedKeys: new Set(),
      heldRects,
      culled: [],
      model: labelPosition === "center" ? null : modelRect(camera, W, H),
    };
    const placed = ctx.placed;
    const shownKeys = new Set();
    frameNo++;
    for (const c of candidates) {
      if (placed.length >= LABEL_LIMIT) break;
      // Permanent rank, fixed the first time a label is seen.
      let entry = placementCache.get(c.key);
      const prev = entry?.cand ? entry : null;
      if (!entry) {
        entry = { rank: nextRank++, cand: null, nv: 0, visible: false, lastCand: null, switchFrame: null, switches: 0 };
        placementCache.set(c.key, entry);
      }
      const w = labelWidth(c.text, layer);
      let spot = null;
      if (c.kind === "arrow") {
        const rect = { x: c.x + 6, y: c.y - 6 - LABEL_H, w, h: LABEL_H };
        const pad = entry.visible ? KEEP_PAD : NEW_PAD;
        if (!placed.some((p) => hits(rect, p.rect, pad))) spot = { id: "tip", rect, leader: null, x: c.x, y: c.y, kept: entry.visible };
      } else spot = placePlane(c, c.sv, w, ctx, prev);
      if (!spot) {
        // Culled by the anti-oscillation rule: hidden, spot remembered.
        entry.culled = ctx.culled.includes(c.key);
        continue;
      }
      entry.culled = false;
      entry.rect = { ...spot.rect };
      ctx.placedKeys.add(c.key);
      if (entry.cand && spot.id !== entry.cand) {
        entry.lastCand = entry.cand;
        entry.switchFrame = frameNo;
        entry.switches++;
      }
      entry.cand = spot.id;
      entry.nv = c.sv?.length ?? 0;
      entry.visible = true;
      shownKeys.add(c.key);
      placed.push({
        key: c.key,
        candidate: spot.id,
        kept: spot.kept,
        rank: entry.rank,
        lastCandidate: entry.lastCand,
        switchFrame: entry.switchFrame,
        switches: entry.switches,
        reason: spot.reason ?? (spot.kept ? "kept" : "new"),
        displacement: spot.displacement ?? 0,
        text: c.text,
        color: c.color,
        kind: c.kind,
        planeId: c.planeId,
        x: spot.x,
        y: spot.y,
        rect: spot.rect,
        leader: spot.leader,
        anchorX: c.x,
        anchorY: c.y,
      });
    }
    // Hidden this frame: keep the candidate (continuity) AND the rank.
    for (const [key, entry] of placementCache)
      if (!shownKeys.has(key)) {
        entry.visible = false;
        if (!ctx.culled.includes(key)) entry.culled = false;
      }
    lastCulled = [...ctx.culled];
    while (labelPool.length < placed.length) {
      const span = make("span", { className: "lattice-label" });
      layer.append(span);
      labelPool.push(span);
    }
    labelPool.forEach((span, i) => {
      const c = placed[i];
      span.hidden = !c;
      if (!c) return;
      if (span.textContent !== c.text) span.textContent = c.text;
      span.style.setProperty("--tool-color", c.color);
      span.style.transform = `translate(${c.rect.x.toFixed(1)}px, ${c.rect.y.toFixed(1)}px)`;
    });
    // Pooled leader lines (SVG, no pointer events).
    let svg = layer.querySelector("svg.lattice-leaders");
    const leaders = placed.filter((c) => c.leader);
    if (!svg && leaders.length) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "lattice-leaders");
      layer.prepend(svg);
    }
    if (svg) {
      while (svg.childElementCount < leaders.length)
        svg.append(document.createElementNS("http://www.w3.org/2000/svg", "line"));
      [...svg.children].forEach((line, i) => {
        const c = leaders[i];
        line.setAttribute("visibility", c ? "visible" : "hidden");
        if (!c) return;
        line.setAttribute("x1", c.leader.x1.toFixed(1));
        line.setAttribute("y1", c.leader.y1.toFixed(1));
        line.setAttribute("x2", c.leader.x2.toFixed(1));
        line.setAttribute("y2", c.leader.y2.toFixed(1));
        line.setAttribute("stroke", c.color);
      });
    }
    shownLabels = placed.map((c) => c.text);
    const round = (v) => Math.round(v * 10) / 10;
    lastPlaced = placed.map(({ key, candidate, kept, rank, lastCandidate, switchFrame, switches, reason, displacement, text, x, y, color, kind, rect, leader, planeId }) => ({
      key,
      candidate,
      kept,
      rank,
      lastCandidate: lastCandidate ?? null,
      switchFrame: switchFrame ?? null,
      switches: switches ?? 0,
      reason: reason ?? null, // kept | better | forced | new
      displacement: displacement ?? 0, // px moved this frame when relocating
      text,
      x,
      y,
      color,
      kind,
      planeId: planeId ?? null,
      rect: { x: round(rect.x), y: round(rect.y), w: rect.w, h: rect.h },
      leader: leader ? { x1: round(leader.x1), y1: round(leader.y1), x2: round(leader.x2), y2: round(leader.y2) } : null,
    }));
  }
  let lastPlaced = [],
    lastCulled = [];
  // The m option is subordinate to Labels: disabled (preference kept)
  // while labels are off.
  function syncLabelOptions() {
    const offsets = $("lattice-label-offsets");
    offsets.checked = labelOffsets;
    offsets.disabled = !labelsOn;
    const position = $("plane-label-position");
    position.value = labelPosition;
    position.disabled = !labelsOn;
    $("plane-label-options").hidden = !planes.length;
  }
  $("plane-label-position").onchange = () => {
    const value = $("plane-label-position").value;
    labelPosition = ["outside", "edge", "center"].includes(value) ? value : "outside";
    invalidate();
  };
  $("lattice-labels-toggle").onchange = () => {
    labelsOn = $("lattice-labels-toggle").checked;
    syncLabelOptions();
    collectLabelAnchors();
    invalidate();
  };
  $("lattice-label-offsets").onchange = () => {
    labelOffsets = $("lattice-label-offsets").checked;
    collectLabelAnchors();
    invalidate();
  };

  // ---- Sidebar UI -------------------------------------------------------
  const chip = (text, checked, onChange, title) => {
    const label = make("label", { className: "chip small", title: title ?? "" });
    const input = make("input", { type: "checkbox", checked });
    input.onchange = () => onChange(input.checked);
    label.append(input, make("span", { textContent: text }));
    return { label, input };
  };
  const textField = (value, ariaLabel, className, onCommit) => {
    const input = make("input", {
      type: "text",
      value,
      className: `tool-field ${className}`,
      autocomplete: "off",
      spellcheck: false,
    });
    input.setAttribute("aria-label", ariaLabel);
    input.onchange = () => onCommit(input);
    return input;
  };
  // A field with an always-visible caption inside its box.
  const captioned = (input, caption) => {
    const wrap = make("label", { className: "tool-capfield" });
    const text = make("span", { className: "micro", textContent: caption });
    text.setAttribute("aria-hidden", "true");
    wrap.append(text, input);
    return wrap;
  };
  const removeButton = (label, onClick) => {
    const b = make("button", { type: "button", className: "icon-button", textContent: "✕", title: label });
    b.setAttribute("aria-label", label);
    b.onclick = onClick;
    return b;
  };
  const colorInput = (value, label, onChange) => {
    const input = make("input", { type: "color", value, className: "tool-color", title: label });
    input.setAttribute("aria-label", label);
    input.oninput = () => onChange(input.value);
    return input;
  };
  function commit(input, item, parse) {
    try {
      parse(input.value);
      item.error = "";
      input.setCustomValidity("");
    } catch (error) {
      item.error = error.message;
      input.setCustomValidity(error.message);
      input.reportValidity();
    }
    rebuild();
  }

  function renderPlaneList() {
    $("plane-list").replaceChildren(
      ...planes.map((plane) => {
        const row = make("div", { className: "tool-row" });
        row.dataset.planeId = plane.id;
        row.dataset.tuneItem = `plane:${plane.id}`;
        row.dataset.tuneName = `plane (${plane.hkl.join(" ")})`;
        row.style.setProperty("--tool-color", plane.color);
        const name = () => `(${plane.hkl.join(" ")})`;
        let acceptedHKL = plane.hkl.join(" ");
        const hkl = textField(plane.hkl.join(" "), "Miller indices (h k l), integers", "hkl", (input) =>
          commit(input, plane, (text) => {
            const v = parseMillerIndices(text);
            plane.hkl = v;
            input.value = acceptedHKL = v.join(" ");
            row.dataset.tuneName = `plane (${v.join(" ")})`;
            // Until m is edited by hand, it follows the indices so the
            // plane cuts through the middle of the displayed range.
            if (plane.autoOffset) {
              plane.m = initialPlaneOffset(v, getRanges());
              m.value = fmt(plane.m);
              m.setCustomValidity("");
            }
          }),
        );
        hkl.dataset.field = "hkl";
        hkl.title = "Three integer indices: 123 means 1 2 3. Separate multi-digit indices with spaces; use - for negative indices.";
        // A number input cannot hold spaces. Reject whole edits containing
        // other characters, including pasted text, rather than stripping them
        // and potentially changing the intended indices (e.g. 1e2 → 12).
        let selection = [0, 0];
        hkl.onbeforeinput = (event) => {
          selection = [hkl.selectionStart, hkl.selectionEnd];
          if (event.data && /[^0-9 −-]/.test(event.data)) event.preventDefault();
        };
        hkl.oninput = () => {
          const value = hkl.value.replace(/−/g, "-");
          if (/[^0-9 -]/.test(value)) {
            hkl.value = acceptedHKL;
            hkl.setSelectionRange(...selection);
          } else {
            const caret = hkl.selectionStart;
            hkl.value = acceptedHKL = value;
            hkl.setSelectionRange(caret, caret);
          }
        };
        const m = textField(fmt(plane.m), "Offset m, fractional: plane h·x + k·y + l·z = m; with Parallel planes, planes at m + n", "offset", (input) =>
          commit(input, plane, (text) => {
            const v = Number(text.replace(",", "."));
            if (!Number.isFinite(v)) throw Error("Enter a finite offset m.");
            plane.m = v;
            plane.autoOffset = false; // a hand-set m stays anchored
          }),
        );
        m.dataset.field = "m";
        m.title = "h·x + k·y + l·z = m (fractional coordinates, not Å). Shifts the plane, or all parallel planes (m + n).";
        // Show is the first control: it decides whether the entry (and its
        // label) is drawn. Captions sit inside the fields to save width.
        const show = chip("Show", plane.visible, (v) => ((plane.visible = v), rebuild()));
        show.input.dataset.field = "visible";
        const top = make("div", { className: "tool-line" });
        top.append(
          show.label,
          colorInput(plane.color, "Plane color", (c) => {
            plane.color = c;
            row.style.setProperty("--tool-color", c);
            rebuild();
          }),
          captioned(hkl, "(hkl)"),
          captioned(m, "offset m"),
          removeButton(`Remove plane ${name()}`, () => {
            planes = planes.filter((p) => p !== plane);
            renderPlaneList();
            rebuild();
          }),
        );
        const family = chip(
          "Parallel planes",
          plane.family,
          (v) => ((plane.family = v), rebuild()),
          "Planes at m + n (integer n) through the plotting range, spaced d",
        );
        family.input.dataset.field = "family";
        // Display size of this entry's faces (all family members): the
        // clipping box grows about the range centre; the plane equation,
        // m, d and the family offsets stay the same.
        const slider = ({ caption, field, aria, title, min, max, step, value, onInput }) => {
          const wrap = make("label", { className: "plane-slider", title });
          const output = make("output", { value: `${value}%` });
          const input = make("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
          input.dataset.field = field;
          input.setAttribute("aria-label", aria);
          input.setAttribute("aria-valuetext", `${value}%`);
          input.oninput = () => {
            const v = Number(input.value);
            output.value = `${v}%`;
            input.setAttribute("aria-valuetext", `${v}%`);
            onInput(v);
          };
          wrap.append(make("span", { className: "caption", textContent: caption }), input, output);
          return wrap;
        };
        const size = slider({
          caption: "Size",
          field: "size",
          aria: "Plane size",
          title: "Draw the plane faces larger than the plotting range (display only)",
          min: 100,
          max: 200,
          step: 5,
          value: plane.size,
          onInput: (v) => {
            plane.size = v;
            rebuild();
          },
        });
        // Face opacity of this entry (all family members), live on the
        // material: no geometry rebuild, m/size/family untouched.
        const opacity = slider({
          caption: "Opacity",
          field: "opacity",
          aria: "Plane opacity",
          title: "Face opacity; at 0% only the outline (and label) remain",
          min: 0,
          max: 100,
          step: 1,
          value: Math.round(plane.opacity * 100),
          onInput: (v) => {
            plane.opacity = v / 100;
            if (plane.faceMesh) setFaceOpacity(plane.faceMesh, plane.opacity);
            invalidate();
          },
        });
        const readout = make("span", { className: "tool-readout" });
        readout.dataset.readout = "plane";
        // Sliders share a line when the sidebar is wide enough and wrap to
        // one full-width slider per line otherwise (never tiny).
        const sliders = make("div", { className: "tool-line" });
        sliders.append(size, opacity);
        const bottom = make("div", { className: "tool-line" });
        bottom.append(family.label, readout);
        row.append(top, sliders, bottom);
        return row;
      }),
    );
    syncLabelOptions();
  }
  function renderArrowList() {
    $("arrow-list").replaceChildren(
      ...arrows.map((arrow) => {
        const row = make("div", { className: "tool-row" });
        row.dataset.arrowId = arrow.id;
        row.dataset.tuneItem = `arrow:${arrow.id}`;
        row.dataset.tuneName = `arrow [${arrow.uvw.join(" ")}]`;
        row.style.setProperty("--tool-color", arrow.color);
        const uvw = textField(arrow.uvw.join(" "), "Direct lattice direction [u v w]", "uvw", (input) =>
          commit(input, arrow, (text) => {
            const v = parseTriple(text, { label: "components" });
            if (v.every((x) => x === 0)) throw Error("Direction [uvw] must not be zero.");
            arrow.uvw = v;
            row.dataset.tuneName = `arrow [${v.join(" ")}]`;
          }),
        );
        uvw.dataset.field = "uvw";
        const origin = textField(arrow.origin.map(fmt).join(" "), "Arrow origin, fractional x y z", "origin", (input) =>
          commit(input, arrow, (text) => (arrow.origin = parseTriple(text, { label: "coordinates" }))),
        );
        origin.dataset.field = "origin";
        const length = textField(fmt(arrow.length), "Length as a multiple of the direct-lattice vector [uvw]", "length", (input) =>
          commit(input, arrow, (text) => {
            const v = Number(text.replace(",", "."));
            if (!Number.isFinite(v) || v === 0) throw Error("Enter a nonzero multiplier.");
            arrow.length = v;
          }),
        );
        length.dataset.field = "length";
        const show = chip("Show", arrow.visible, (v) => ((arrow.visible = v), rebuild()));
        show.input.dataset.field = "visible";
        const top = make("div", { className: "tool-line" });
        top.append(
          show.label,
          colorInput(arrow.color, "Arrow color", (c) => {
            arrow.color = c;
            row.style.setProperty("--tool-color", c);
            rebuild();
          }),
          captioned(uvw, "[uvw]"),
          captioned(length, "length ×"),
          removeButton(`Remove arrow [${arrow.uvw.join(" ")}]`, () => {
            arrows = arrows.filter((a) => a !== arrow);
            renderArrowList();
            rebuild();
          }),
        );
        const readout = make("span", { className: "tool-readout" });
        readout.dataset.readout = "arrow";
        const bottom = make("div", { className: "tool-line" });
        bottom.append(captioned(origin, "origin x y z"), readout);
        row.append(top, bottom);
        return row;
      }),
    );
  }
  function refreshReadouts(structure, ranges) {
    for (const plane of planes) {
      const el = document.querySelector(`[data-plane-id="${plane.id}"] [data-readout]`);
      if (!el) continue;
      el.classList.toggle("error", Boolean(plane.error));
      // Automatic integer m can miss a narrow fractional extent entirely;
      // say so instead of silently using a fractional m.
      const missed = !plane.error && plane.autoOffset && !plane.render.polygons.length;
      el.classList.toggle("warn", missed);
      el.textContent = plane.error
        ? plane.error
        : missed
          ? `No plane with integer m crosses this extent. Enter m, widen the extent or raise Size. d = ${plane.d.toFixed(4)} Å`
          : `${plane.family ? "m + n · " : ""}d = ${plane.d.toFixed(4)} Å · ${plane.render.polygons.length} in range${plane.render.truncated ? ` (first ${plane.render.offsets.length})` : ""}`;
      // The readout keeps a fixed two-line box; the full text is its title.
      el.title = el.textContent;
    }
    for (const arrow of arrows) {
      const el = document.querySelector(`[data-arrow-id="${arrow.id}"] [data-readout]`);
      if (!el) continue;
      el.classList.toggle("error", Boolean(arrow.error));
      el.textContent = arrow.error ? arrow.error : `${arrow.render.length.toFixed(4)} Å`;
      el.title = el.textContent;
    }
    // Symmetry readouts.
    const note = $("sym-note");
    const ops = $("sym-ops");
    const toggle = $("sym-ops-toggle");
    // Analysis runs only when elements or the operation list are shown.
    const result =
      symmetry.shown || !ops.hidden
        ? computeSymmetry(structure, ranges)
        : { elements: [], analyses: [], note: Array.isArray(structure.symmetryOperations) ? "" : "Symmetry operations are not available from this engine build." };
    const counts = {};
    for (const e of result.elements) counts[elementCategory(e)] = (counts[elementCategory(e)] || 0) + 1;
    for (const box of document.querySelectorAll("#sym-filters input")) {
      box.checked = symmetry.filters.has(box.value);
      // Filter swatch follows the current theme's category color.
      const axisColors = isLight() ? LIGHT_AXIS_COLORS : AXIS_COLORS;
      box
        .closest("label")
        .style.setProperty(
          "--sym-color",
          box.value === "rotation" || box.value === "screw" ? axisColors[2] : CATEGORY_COLORS[box.value],
        );
      const count = counts[box.value] || 0;
      box.closest("label").querySelector("small").textContent = count;
    }
    renderAxisTypes(result.elements);
    note.textContent = result.note || (symmetry.shown ? "" : "Elements from the CIF's operations, clipped to the plotting range.");
    note.hidden = !note.textContent;
    const list = structure.symmetryOperations ?? [];
    toggle.textContent = `Ops (${list.length})`;
    toggle.setAttribute("aria-label", `Symmetry operations list, ${list.length} operations`);
    toggle.disabled = !list.length;
    if (!ops.hidden) renderOperations(list, result.analyses);
  }
  function renderAxisTypes(elements) {
    const fragment = document.createDocumentFragment();
    for (const category of SYMMETRY_CATEGORIES.slice(0, 3)) {
      const types = new Map();
      for (const e of elements) {
        if (elementCategory(e) !== category.id) continue;
        for (const symbol of e.symbols) types.set(symbol, (types.get(symbol) ?? 0) + 1);
      }
      if (!types.size) continue;
      const row = make("div", { className: "sym-type-row" });
      row.append(make("span", { className: "sym-type-caption", textContent: category.label }));
      const chips = make("div", { className: "chip-row" });
      for (const [symbol, count] of [...types].sort(([a], [b]) => a.localeCompare(b))) {
        const key = `${category.id}:${symbol}`;
        const color = category.id === "rotoinversion" ? CATEGORY_COLORS.rotoinversion : (isLight() ? LIGHT_AXIS_COLORS : AXIS_COLORS)[Number(symbol[0])];
        const label = make("label", { className: "chip small sym-filter" });
        label.style.setProperty("--sym-color", color);
        const input = make("input", { type: "checkbox", value: key, checked: !symmetry.hiddenTypes.has(key), disabled: !symmetry.filters.has(category.id) });
        input.setAttribute("aria-label", `Show ${category.label.toLowerCase()} ${symbol} axes`);
        input.onchange = () => {
          if (input.checked) symmetry.hiddenTypes.delete(key);
          else symmetry.hiddenTypes.add(key);
          rebuild();
        };
        const display = symbol.startsWith("-") ? `${symbol.slice(1)}\u0305` : symbol;
        label.append(input, make("span", { textContent: display }), make("small", { textContent: String(count) }));
        chips.append(label);
      }
      row.append(chips);
      fragment.append(row);
    }
    $("sym-axis-types").replaceChildren(fragment);
  }
  function renderOperations(list, analyses) {
    $("sym-ops").replaceChildren(
      ...list.map((op, i) => {
        const a = analyses[i] ?? {};
        const li = make("li");
        const kind = a.kind === "translation" ? (op.translation.some((v) => Math.abs(v) > 1e-9) ? "translation" : "identity") : a.symbol ?? "?";
        li.append(
          make("code", { textContent: operationString(op.rotation, op.translation) }),
          make("span", {
            className: "sym-op-type",
            textContent: a.kind === "unsupported" ? `unsupported (${a.reason})` : `${kind}${elementEquation(a) ? ` · ${elementEquation(a)}` : ""}`,
          }),
        );
        return li;
      }),
    );
  }

  $("plane-add").onclick = () => {
    if (!getStructure()) return;
    planes.push({
      id: ++nextId,
      hkl: [1, 0, 0],
      // Through the middle of the current plotting range; follows later
      // index edits until m is set by hand (autoOffset).
      m: initialPlaneOffset([1, 0, 0], getRanges()),
      autoOffset: true,
      size: 100, // percent of the plotting range used to clip the faces
      opacity: 0.28, // face opacity, fraction 0..1 (slider shows percent)
      family: false,
      visible: true,
      color: PLANE_COLORS[planes.length % PLANE_COLORS.length],
      error: "",
    });
    renderPlaneList();
    rebuild();
  };
  $("arrow-add").onclick = () => {
    if (!getStructure()) return;
    arrows.push({
      id: ++nextId,
      uvw: [0, 0, 1],
      origin: [0, 0, 0],
      length: 1,
      visible: true,
      color: ARROW_COLORS[arrows.length % ARROW_COLORS.length],
      error: "",
    });
    renderArrowList();
    rebuild();
  };
  $("sym-filters").replaceChildren(
    ...SYMMETRY_CATEGORIES.map((c) => {
      const label = make("label", { className: "chip small sym-filter" });
      label.style.setProperty("--sym-color", c.id === "rotation" || c.id === "screw" ? AXIS_COLORS[2] : CATEGORY_COLORS[c.id]);
      const input = make("input", { type: "checkbox", checked: true, value: c.id });
      input.setAttribute("aria-label", `Show ${c.label.toLowerCase()} elements`);
      input.onchange = () => {
        if (input.checked) symmetry.filters.add(c.id);
        else symmetry.filters.delete(c.id);
        rebuild();
      };
      label.append(input, make("span", { textContent: c.label }), make("small", { textContent: "0" }));
      return label;
    }),
  );
  $("sym-toggle").onchange = () => {
    symmetry.shown = $("sym-toggle").checked;
    $("sym-controls").hidden = !symmetry.shown;
    rebuild();
  };
  $("sym-axes-only").onclick = () => {
    symmetry.filters = new Set(["rotation", "screw", "rotoinversion"]);
    rebuild();
  };
  $("sym-types-all").onclick = () => {
    symmetry.hiddenTypes.clear();
    rebuild();
  };
  $("sym-types-none").onclick = () => {
    symmetry.hiddenTypes = new Set(AXIS_TYPE_KEYS);
    rebuild();
  };
  $("sym-opacity").oninput = () => {
    symmetry.opacity = Number($("sym-opacity").value) / 100;
    $("sym-opacity-value").value = `${$("sym-opacity").value}%`;
    group.traverse((o) => {
      if (o.userData.tool === "symmetry-planes") o.material.opacity = symmetry.opacity;
    });
    invalidate();
  };
  $("sym-opacity-value").value = `${$("sym-opacity").value}%`;
  $("sym-ops-toggle").onclick = () => {
    const ops = $("sym-ops");
    ops.hidden = !ops.hidden;
    $("sym-ops-toggle").setAttribute("aria-expanded", String(!ops.hidden));
    rebuild();
  };

  return {
    rebuild,
    updateLabels,
    // Export frames use their own placement history and full canvas. Restore
    // the live history afterward so a movie never changes on-screen labels.
    setExportObstacles(rects) { exportObstacles = rects; },
    setExportMode(on) {
      if (exportMode === on) return;
      exportMode = on;
      if (on) {
        savedPlacement = { cache: new Map(placementCache), nextRank, frameNo, cachedPosition, shownLabels, lastPlaced, lastCulled, obstacles };
        placementCache.clear();
        nextRank = frameNo = 0;
        exportObstacles = obstacles = [];
      } else if (savedPlacement) {
        placementCache.clear();
        for (const [key, entry] of savedPlacement.cache) placementCache.set(key, entry);
        ({ nextRank, frameNo, cachedPosition, shownLabels, lastPlaced, lastCulled, obstacles } = savedPlacement);
        savedPlacement = null;
      }
    },
    /** Scene bounds of drawn planes, arrows and symmetry elements (cached
     *  at each rebuild; cheap enough to read every frame). */
    bounds: () => cachedBounds.clone(),
    /** Labels currently on screen, in CSS px of the canvas (for export). */
    placedLabels: () => (anchors.length ? lastPlaced : []),
    /** New file or block: drop all per-structure tool state. */
    /** Plain settings for the local session (no geometry or caches). */
    exportState() {
      return {
        planes: planes.map((p) => ({
          id: p.id,
          hkl: [...p.hkl],
          m: p.m,
          autoOffset: Boolean(p.autoOffset),
          size: p.size,
          opacity: p.opacity,
          family: p.family,
          visible: p.visible,
          color: p.color,
        })),
        arrows: arrows.map((a) => ({
          id: a.id,
          uvw: [...a.uvw],
          origin: [...a.origin],
          length: a.length,
          visible: a.visible,
          color: a.color,
        })),
        symmetry: { shown: symmetry.shown, filters: [...symmetry.filters], opacity: symmetry.opacity, hiddenTypes: [...symmetry.hiddenTypes] },
        labels: { enabled: labelsOn, includeOffsets: labelOffsets, position: labelPosition },
      };
    },
    /** Apply validated session settings; invalid entries are skipped. */
    restoreState(state, { trusted = false } = {}) {
      if (!state || typeof state !== "object") return;
      const finite = (v) => typeof v === "number" && Number.isFinite(v);
      const triple = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
      const color = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
      const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
      const ids = new Set();
      const freshId = (id) => {
        const ok = Number.isInteger(id) && id > 0 && !ids.has(id);
        const value = ok ? id : ++nextId;
        ids.add(value);
        nextId = Math.max(nextId, value);
        return value;
      };
      planes = (Array.isArray(state.planes) ? state.planes : [])
        .filter((p) => p && triple(p.hkl) && p.hkl.every(Number.isInteger) && p.hkl.some((x) => x !== 0) && finite(p.m))
        .slice(0, trusted ? undefined : 50)
        .map((p, i) => ({
          id: freshId(p.id),
          hkl: [...p.hkl],
          m: p.m,
          autoOffset: bool(p.autoOffset, false),
          size: finite(p.size) && p.size >= 100 && p.size <= 200 ? p.size : 100,
          opacity: finite(p.opacity) && p.opacity >= 0 && p.opacity <= 1 ? p.opacity : 0.28,
          family: bool(p.family, false),
          visible: bool(p.visible, true),
          color: color(p.color, PLANE_COLORS[i % PLANE_COLORS.length]),
          error: "",
        }));
      arrows = (Array.isArray(state.arrows) ? state.arrows : [])
        .filter((a) => a && triple(a.uvw) && a.uvw.some((x) => x !== 0) && triple(a.origin) && finite(a.length) && a.length !== 0)
        .slice(0, trusted ? undefined : 50)
        .map((a, i) => ({
          id: freshId(a.id),
          uvw: [...a.uvw],
          origin: [...a.origin],
          length: a.length,
          visible: bool(a.visible, true),
          color: color(a.color, ARROW_COLORS[i % ARROW_COLORS.length]),
          error: "",
        }));
      const sym = state.symmetry ?? {};
      symmetry.shown = bool(sym.shown, false);
      symmetry.hiddenTypes = new Set(Array.isArray(sym.hiddenTypes) ? sym.hiddenTypes.filter((s) => AXIS_TYPE_KEYS.includes(s)) : []);
      if (Array.isArray(sym.filters)) {
        const known = new Set(SYMMETRY_CATEGORIES.map((c) => c.id));
        symmetry.filters = new Set(sym.filters.filter((f) => known.has(f)));
      }
      if (finite(sym.opacity) && sym.opacity >= 0 && sym.opacity <= 1) symmetry.opacity = sym.opacity;
      $("sym-toggle").checked = symmetry.shown;
      $("sym-controls").hidden = !symmetry.shown;
      for (const box of document.querySelectorAll("#sym-filters input")) box.checked = symmetry.filters.has(box.value);
      $("sym-opacity").value = String(Math.round(symmetry.opacity * 100));
      $("sym-opacity-value").value = `${$("sym-opacity").value}%`;
      const labels = state.labels ?? {};
      labelsOn = bool(labels.enabled, true);
      labelOffsets = bool(labels.includeOffsets, true);
      if (["outside", "edge", "center"].includes(labels.position)) labelPosition = labels.position;
      $("lattice-labels-toggle").checked = labelsOn;
      placementCache.clear();
      renderPlaneList();
      renderArrowList();
      rebuild();
      collectLabelAnchors();
    },
    reset() {
      planes = [];
      arrows = [];
      placementCache.clear(); // new structure: no remembered label spots
      symmetry.cacheKey = "";
      symmetry.result = null;
      symmetry.shown = false;
      symmetry.hiddenTypes.clear();
      $("sym-toggle").checked = false;
      $("sym-controls").hidden = true;
      $("sym-ops").hidden = true;
      $("sym-ops-toggle").setAttribute("aria-expanded", "false");
      renderPlaneList();
      renderArrowList();
    },
    diagnostics() {
      const structure = getStructure();
      const result = structure ? computeSymmetry(structure, getRanges()) : null;
      const counts = {};
      for (const e of result?.elements ?? []) counts[elementCategory(e)] = (counts[elementCategory(e)] || 0) + 1;
      return {
        labels: {
          exporting: exportMode,
          obstacleCount: obstacles.length,
          enabled: labelsOn,
          includeOffsets: labelOffsets,
          position: labelPosition,
          stability: {
            switchMargin: SWITCH_MARGIN,
            familyNew: FAMILY_NEW,
            familyKeep: FAMILY_KEEP,
            newPad: NEW_PAD,
            keepPad: KEEP_PAD,
            dwellFrames: DWELL_FRAMES,
            reverseFrames: REVERSE_FRAMES,
            reversePenalty: REVERSE_PENALTY,
            heldPenalty: HELD_PENALTY,
            displaceFree: DISPLACE_FREE,
            displaceCost: DISPLACE_COST,
            longJump: LONG_JUMP,
            culled: [...lastCulled],
            frame: frameNo,
            cacheSize: placementCache.size,
          },
          anchors: anchors.map((a) => a.text),
          shown: [...shownLabels],
          // Canvas CSS px, exactly what the live view and exports draw.
          placed: anchors.length ? lastPlaced.map((l) => ({ ...l, rect: { ...l.rect }, leader: l.leader && { ...l.leader } })) : [],
        },
        planes: planes.map((p) => ({
          id: p.id,
          hkl: [...p.hkl],
          m: p.m,
          autoOffset: p.autoOffset,
          size: p.size,
          opacity: p.opacity, // fraction 0..1
          faces: p.faceMesh ? { visible: p.faceMesh.visible, opaque: !p.faceMesh.material.transparent, peeled: p.faceMesh.layers.isEnabled(PEEL_LAYER) } : null,
          family: p.family,
          visible: p.visible,
          color: p.color,
          error: p.error || null,
          d: p.d ?? null,
          offsets: p.render?.offsets ?? [],
          polygons: (p.render?.polygons ?? []).map((q) => ({ m: q.m, vertices: q.polygon.length, frac: q.polygon })),
        })),
        arrows: arrows.map((a) => ({
          id: a.id,
          uvw: [...a.uvw],
          origin: [...a.origin],
          length: a.length,
          visible: a.visible,
          error: a.error || null,
          endFrac: a.render?.end ?? null,
          lengthAngstrom: a.render?.length ?? null,
        })),
        symmetry: {
          shown: symmetry.shown,
          hiddenTypes: [...symmetry.hiddenTypes],
          visibleElements: filterSymmetryElements(result?.elements ?? [], symmetry.filters, symmetry.hiddenTypes).map((e) => ({ category: elementCategory(e), symbols: e.symbols, order: e.order, start: e.start, end: e.end })),
          filters: [...symmetry.filters],
          opacity: symmetry.opacity,
          note: result?.note ?? null,
          complete: result?.complete ?? null,
          truncated: result?.truncated ?? false,
          candidates: result?.candidates ?? 0,
          counts,
          elements: (result?.elements ?? []).map((e) => ({
            kind: e.kind,
            category: elementCategory(e),
            symbols: e.symbols,
            coincident: e.coincident ?? [],
            intrinsic: e.intrinsic ?? 0,
            order: e.order,
            screw: e.screw ?? 0,
            start: e.start,
            end: e.end,
            point: e.kind === "inversion" || e.kind === "rotoinversion" ? e.point : undefined,
            locus: e.locus,
            centers: e.centers,
            coef: e.coef,
            c: e.c,
            glide: e.glide ?? null,
          })),
          operations: (result?.analyses ?? []).map((a) => ({ kind: a.kind, symbol: a.symbol ?? null })),
        },
      };
    },
  };
}
