// Lattice tools: (hkl) planes, [uvw] direction arrows and symmetry
// elements. Owns its sidebar UI, its Three.js groups and its state; the
// viewer supplies coordinate conversion and structure access.
import {
  parseTriple,
  dSpacing,
  clipPlaneToBox,
  planeOffsets,
  directVector,
  symmetryElements,
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
  { id: "rotoinversion", label: "Rotoinv." },
  { id: "inversion", label: "Inversion" },
  { id: "mirror", label: "Mirror" },
  { id: "glide", label: "Glide" },
];
const AXIS_COLORS = { 2: "#6ea8ff", 3: "#8cdf9b", 4: "#efa04c", 6: "#ef6fa7" };
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

export function createLatticeTools({ THREE, scene, invalidate, getStructure, getRanges, toScene }) {
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

  function renderPlanes(structure, ranges) {
    for (const plane of planes) {
      plane.render = { offsets: [], polygons: [], truncated: false };
      if (plane.error) continue;
      try {
        plane.d = dSpacing(structure.basis, plane.hkl);
      } catch (error) {
        plane.error = error.message;
        continue;
      }
      const { offsets, truncated } = planeOffsets(plane.hkl, plane.m, ranges, plane.family);
      const polygons = [];
      for (const m of offsets) {
        const polygon = clipPlaneToBox(plane.hkl, m, ranges);
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
          opacity: 0.28,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 3;
      // Peeled per pixel together with translucent polyhedron faces.
      mesh.layers.set(PEEL_LAYER);
      mesh.userData.tool = "plane";
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
    const visible = elements.filter((e) => symmetry.filters.has(elementCategory(e)));
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
        const text = plane.family || Math.abs(m) > 1e-9 ? `${name} · m=${fmt(m)}` : name;
        anchors.push({ text, color: plane.color, world: vec(centroid), kind: "plane" });
      }
    }
    for (const arrow of arrows) {
      if (!arrow.visible || arrow.error || !arrow.render) continue;
      const text = `${indexText(arrow.uvw, "[", "]")}${arrow.length !== 1 ? ` ×${fmt(arrow.length)}` : ""}`;
      anchors.push({ text, color: arrow.color, world: vec(arrow.render.end), kind: "arrow" });
    }
  }
  function updateLabels(camera, canvas) {
    if (!anchors.length && !shownLabels.length) return;
    const layer = $("lattice-labels");
    const { width, height } = canvas.getBoundingClientRect();
    const placed = [];
    const candidates = [];
    for (const a of anchors) {
      projected.copy(a.world).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
      candidates.push({ ...a, x: ((projected.x + 1) * width) / 2, y: ((1 - projected.y) * height) / 2, z: projected.z });
    }
    candidates.sort((p, q) => p.z - q.z);
    for (const c of candidates) {
      if (placed.length >= LABEL_LIMIT) break;
      if (placed.some((p) => p.text === c.text && Math.hypot(p.x - c.x, p.y - c.y) < 4)) continue;
      if (placed.some((p) => Math.abs(p.x - c.x) < 48 && Math.abs(p.y - c.y) < 15)) continue;
      placed.push(c);
    }
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
      // Plane labels centered on the clipped polygon; arrow labels beside the tip.
      span.style.transform =
        c.kind === "arrow"
          ? `translate(${(c.x + 6).toFixed(1)}px, ${(c.y - 6).toFixed(1)}px) translate(0, -100%)`
          : `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
    shownLabels = placed.map((c) => c.text);
    lastPlaced = placed.map(({ text, x, y, color, kind }) => ({ text, x, y, color, kind }));
  }
  let lastPlaced = [];
  $("lattice-labels-toggle").onchange = () => {
    labelsOn = $("lattice-labels-toggle").checked;
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
        row.style.setProperty("--tool-color", plane.color);
        const name = () => `(${plane.hkl.join(" ")})`;
        const hkl = textField(plane.hkl.join(" "), "Miller indices (h k l), integers", "hkl", (input) =>
          commit(input, plane, (text) => {
            const v = parseTriple(text, { integer: true, label: "indices" });
            if (v.every((x) => x === 0)) throw Error("Miller indices must not all be zero.");
            plane.hkl = v;
          }),
        );
        hkl.dataset.field = "hkl";
        const m = textField(fmt(plane.m), "Offset m, fractional: plane h·x + k·y + l·z = m; with Family, planes at m + n", "offset", (input) =>
          commit(input, plane, (text) => {
            const v = Number(text.replace(",", "."));
            if (!Number.isFinite(v)) throw Error("Enter a finite offset m.");
            plane.m = v;
          }),
        );
        m.dataset.field = "m";
        m.title = "h·x + k·y + l·z = m (fractional coordinates, not Å). Shifts the plane, or the whole family (m + n).";
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
          "Family",
          plane.family,
          (v) => ((plane.family = v), rebuild()),
          "Planes at m + n (integer n) through the plotting range, spaced d",
        );
        family.input.dataset.field = "family";
        const readout = make("span", { className: "tool-readout" });
        readout.dataset.readout = "plane";
        const bottom = make("div", { className: "tool-line" });
        bottom.append(family.label, readout);
        row.append(top, bottom);
        return row;
      }),
    );
  }
  function renderArrowList() {
    $("arrow-list").replaceChildren(
      ...arrows.map((arrow) => {
        const row = make("div", { className: "tool-row" });
        row.dataset.arrowId = arrow.id;
        row.style.setProperty("--tool-color", arrow.color);
        const uvw = textField(arrow.uvw.join(" "), "Direct lattice direction [u v w]", "uvw", (input) =>
          commit(input, arrow, (text) => {
            const v = parseTriple(text, { label: "components" });
            if (v.every((x) => x === 0)) throw Error("Direction [uvw] must not be zero.");
            arrow.uvw = v;
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
      el.textContent = plane.error
        ? plane.error
        : `${plane.family ? "m + n · " : ""}d = ${plane.d.toFixed(4)} Å · ${plane.render.polygons.length} in range${plane.render.truncated ? ` (first ${plane.render.offsets.length})` : ""}`;
    }
    for (const arrow of arrows) {
      const el = document.querySelector(`[data-arrow-id="${arrow.id}"] [data-readout]`);
      if (!el) continue;
      el.classList.toggle("error", Boolean(arrow.error));
      el.textContent = arrow.error ? arrow.error : `${arrow.render.length.toFixed(4)} Å`;
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
    note.textContent = result.note || (symmetry.shown ? "" : "Elements from the CIF's operations, clipped to the plotting range.");
    note.hidden = !note.textContent;
    const list = structure.symmetryOperations ?? [];
    toggle.textContent = `Ops (${list.length})`;
    toggle.setAttribute("aria-label", `Symmetry operations list, ${list.length} operations`);
    toggle.disabled = !list.length;
    if (!ops.hidden) renderOperations(list, result.analyses);
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
      m: 0,
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
    /** Scene bounds of drawn planes, arrows and symmetry elements (cached
     *  at each rebuild; cheap enough to read every frame). */
    bounds: () => cachedBounds.clone(),
    /** Labels currently on screen, in CSS px of the canvas (for export). */
    placedLabels: () => (anchors.length ? lastPlaced : []),
    /** New file or block: drop all per-structure tool state. */
    reset() {
      planes = [];
      arrows = [];
      symmetry.cacheKey = "";
      symmetry.result = null;
      symmetry.shown = false;
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
        labels: { enabled: labelsOn, anchors: anchors.map((a) => a.text), shown: [...shownLabels] },
        planes: planes.map((p) => ({
          id: p.id,
          hkl: [...p.hkl],
          m: p.m,
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
