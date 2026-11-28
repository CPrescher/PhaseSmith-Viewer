import { formatMillerIndices, clipPlaneToBox, initialPlaneOffset, matVec } from "./crystal-math.js";
import { cameraAxes, initialCamera } from "./ewald-camera.js";
import { cross3, unitAxis } from "./detector-orientation.js";
import { labVector } from "./detector-model.js";

function element(svg, tag, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text !== undefined) el.textContent = text;
  svg.append(el);
  return el;
}
function line(svg, a, b, style) {
  return element(svg, "line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: style });
}
function circle(svg, p, r, style) {
  return element(svg, "circle", { cx: p[0], cy: p[1], r, class: style });
}
function spotRadius(point, min, max) {
  return Math.sqrt(min * min + point.logArea * (max * max - min * min));
}
function label(svg, x, y, text, style = "") {
  return element(svg, "text", { x, y, class: style }, text);
}
function arrow(svg, start, end, style) {
  line(svg, start, end, style);
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  for (const side of [-0.48, 0.48])
    line(svg, end, [end[0] - 6 * Math.cos(angle + side), end[1] - 6 * Math.sin(angle + side)], style);
}

// Unit-sphere grid in lab coordinates. Split the front and rear arcs at
// the silhouette so the far surface stays legible through the shell.
function gridPaths(project, depth, center, radius) {
  const paths = ["", ""];
  function trace(pointAt, end) {
    let prev, previousSide;
    for (let i = 0; i <= 60; i++) {
      const v = pointAt((i * end) / 60);
      const p = project(v)
        .map((a, j) => (center[j] + radius * a).toFixed(2))
        .join(",");
      const side = Number(depth(v) >= 0);
      if (prev) paths[side] += (previousSide === side ? "" : "M" + prev) + "L" + p;
      prev = p;
      previousSide = i === 0 ? null : side;
    }
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const a = (lat * Math.PI) / 180;
    trace((t) => [Math.cos(a) * Math.cos(t), Math.cos(a) * Math.sin(t), Math.sin(a)], 2 * Math.PI);
  }
  for (let lon = 0; lon < 360; lon += 30) {
    const a = (lon * Math.PI) / 180;
    trace((t) => [Math.cos(a) * Math.sin(t), Math.sin(a) * Math.sin(t), Math.cos(t)], Math.PI);
  }
  return paths;
}

export function drawEwald(root, model, rock, azimuth, spots, tracked, view, pointScale = 1, onSelect = null) {
  root.replaceChildren();
  const width = root.clientWidth,
    height = root.clientHeight;
  if (!width || !height) return;
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const axes = cameraAxes(view);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const project = (v) => [dot(v, axes.right), -dot(v, axes.up)];
  const depth = (v) => dot(v, axes.eye);
  // Keep O at the viewport center. In reciprocal coordinates C = -k_in,
  // so the sphere moves around O when the camera orbits.
  const origin = [width / 2, height / 2];
  const home = cameraAxes(initialCamera());
  const fittedRadius = Math.max(
    1,
    Math.min((width / 2 - 8) / (1 + Math.abs(home.right[0])), (height / 2 - 8) / (1 + Math.abs(home.up[0]))),
  );
  const radius = fittedRadius * view.zoom,
    k = 1 / model.wavelength;
  const map = (v) => project(v).map((a, i) => origin[i] + (a * radius) / k);
  const center = map([-k, 0, 0]);
  const svg = root;
  const defs = element(svg, "defs", {});
  const gradient = element(defs, "radialGradient", {
    id: "ewald-surface-color",
    cx: "33%",
    cy: "27%",
    r: "76%",
  });
  for (const [offset, opacity] of [
    ["0%", "0.04"],
    ["56%", "0.13"],
    ["86%", "0.26"],
    ["100%", "0.36"],
  ])
    element(gradient, "stop", { offset, "stop-color": "var(--analysis-pair-4)", "stop-opacity": opacity });
  for (const [name, color] of [
    ["lattice", "var(--muted)"],
    ["hit", "var(--analysis-pair-1)"],
    ["tracked", "var(--analysis-pair-0)"],
  ]) {
    const ball = element(defs, "radialGradient", {
      id: "ewald-" + name + "-ball",
      cx: "32%",
      cy: "28%",
      r: "76%",
    });
    element(ball, "stop", { offset: 0, "stop-color": "white" });
    element(ball, "stop", { offset: 0.43, "stop-color": color });
    element(ball, "stop", { offset: 1, "stop-color": "color-mix(in srgb, " + color + " 48%, black)" });
  }
  const [back, front] = gridPaths(project, depth, center, radius);
  circle(svg, center, radius, "sphere");
  element(svg, "path", { d: back, class: "sphere-grid far" });
  element(svg, "path", { d: front, class: "sphere-grid near" });
  const rotate = (v) => labVector(v, model.tilt, rock, azimuth, model.axis);
  const locate = (p) => map(rotate(p.g));
  const highlighted = new Set([...spots.map((s) => s.point), tracked]);
  const nodes = model.points
    .filter((point) => !highlighted.has(point))
    .map((point) => {
      const g = rotate(point.g);
      return { point, p: map(g), depth: depth(g) };
    });
  nodes.sort((a, b) => a.depth - b.depth);
  const minDepth = nodes.length ? nodes[0].depth : 0;
  const maxDepth = nodes.length ? nodes[nodes.length - 1].depth : 1;
  const depthSpan = maxDepth - minDepth;
  for (const { point, p, depth: nodeDepth } of nodes) {
    if (p[0] > 0 && p[0] < width && p[1] > 0 && p[1] < height) {
      const dot = circle(svg, p, spotRadius(point, 1.5, 3.5) * pointScale, "lattice-node");
      const t = depthSpan > 1e-6 ? (nodeDepth - minDepth) / depthSpan : 1;
      dot.style.opacity = (0.28 + 0.72 * t).toFixed(2);
    }
  }
  const alongBeam = Math.hypot(origin[0] - center[0], origin[1] - center[1]) < 1;
  if (!alongBeam) arrow(svg, center, origin, "incident");
  const drawCrossing = (spot, p, style) => {
    const r = spotRadius(spot.point, 2.5, 4.8) * pointScale;
    const hklText = "(" + formatMillerIndices(spot.point.hkl) + ")";
    if (typeof onSelect === "function") {
      const hit = element(svg, "g", {
        class: "detector-hit",
        role: "button",
        tabindex: "0",
        "aria-label": "Select " + hklText,
      });
      element(hit, "title", {}, hklText);
      circle(hit, p, Math.max(9, r + 4), "hit-target");
      circle(hit, p, r, style);
      hit.onpointerdown = (e) => e.stopPropagation();
      hit.onclick = (e) => {
        e.stopPropagation();
        onSelect(spot);
      };
      hit.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect(spot);
        }
      };
    } else {
      const node = circle(svg, p, r, style);
      element(node, "title", {}, hklText);
    }
  };
  for (const spot of spots)
    if (spot.point !== tracked) drawCrossing(spot, locate(spot.point), "crossing");
  if (tracked?.intensity > 0) {
    const onSphere = model.onSphere(tracked, rock);
    const p = locate(tracked);
    arrow(svg, origin, p, "reciprocal");
    if (onSphere) arrow(svg, center, p, "outgoing");
    const trackedSpot = spots.find((s) => s.point === tracked);
    if (trackedSpot && onSphere) drawCrossing(trackedSpot, p, "crossing");
    else {
      const node = circle(svg, p, spotRadius(tracked, 2.5, 4.8) * pointScale, onSphere ? "crossing" : "tracked-node");
      element(node, "title", {}, "(" + formatMillerIndices(tracked.hkl) + ")");
    }
    label(
      svg,
      Math.min(width - 60, Math.max(5, p[0] + 7)),
      Math.max(15, p[1] - 7),
      "(" + formatMillerIndices(tracked.hkl) + ")",
      "spot-label",
    );
  }
  circle(svg, origin, 2.7, "origin");
  if (!alongBeam) label(svg, origin[0] + 4, origin[1] + 13, "O");
  circle(svg, center, 2.5, "sphere-center");
  label(svg, center[0] - 12, center[1] + 13, alongBeam ? "C/O" : "C");

  // A lab-frame spindle and its right-handed sweep, seen by the same camera.
  const spindle = labVector(model.axis, 0, 0, azimuth);
  const glyph = element(root, "g", { class: "spindle-key" });
  const base = [width - 45, 37];
  const tip = (v, length) => project(v).map((d, i) => base[i] + length * d);
  const u = unitAxis(cross3(spindle, Math.abs(spindle[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross3(spindle, u);
  const arc = Array.from({ length: 23 }, (_, i) => {
    const t = -1.2 + i * 0.15;
    return tip(
      u.map((a, j) => a * Math.cos(t) + v[j] * Math.sin(t)),
      13,
    );
  });
  const axisTip = tip(spindle, 26);
  if (Math.hypot(...project([1, 0, 0])) > 0.12) {
    const beamTip = tip([1, 0, 0], 29);
    arrow(glyph, base, beamTip, "incident");
    label(glyph, beamTip[0] - 6, beamTip[1] + 12, "kᵢ", "incident-label");
  } else {
    label(glyph, base[0] - 9, base[1] + 12, depth([1, 0, 0]) > 0 ? "⊙ kᵢ" : "⊗ kᵢ", "incident-label");
  }
  if (Math.hypot(...project(spindle)) > 0.12) arrow(glyph, base, axisTip, "spindle");
  else label(glyph, base[0] - 4, base[1] + 3, depth(spindle) > 0 ? "⊙" : "⊗", "spindle-label");
  element(glyph, "polyline", { points: arc.join(" "), class: "spindle" });
  arrow(glyph, arc.at(-2), arc.at(-1), "spindle");
  label(glyph, axisTip[0] + 3, axisTip[1] - 3, "+ω", "spindle-label");

  // The direct unit cell uses the same mounting, spindle angle, and beam spin.
  const fractions = Array.from({ length: 8 }, (_, n) => [0, 1, 2].map((i) => (n >> i) & 1));
  const inset = Math.min(68, Math.min(width, height) * 0.28);
  const diagonal = Math.max(
    ...fractions.map((f) =>
      Math.hypot(
        ...matVec(
          model.basis,
          f.map((v) => 2 * v - 1),
        ),
      ),
    ),
  );
  const size = inset / diagonal;
  function cellPoint(frac) {
    const vector = matVec(
      model.basis,
      frac.map((value) => value - 0.5),
    );
    const [u, w] = project(rotate(vector));
    return [width - inset / 2 - 15 + size * u, height - inset / 2 - 23 + size * w];
  }
  const corners = fractions.map(cellPoint);
  if (tracked) {
    const ranges = [
      [0, 1],
      [0, 1],
      [0, 1],
    ];
    const offset = initialPlaneOffset(tracked.hkl, ranges);
    const polygon = clipPlaneToBox(tracked.hkl, offset, ranges);
    if (polygon)
      element(root, "polygon", { points: polygon.map(cellPoint).join(" "), class: "detector-plane" });
  }
  for (let n = 0; n < 8; n++)
    for (let j = 0; j < 3; j++)
      if (n && !(n & (1 << j))) line(root, corners[n], corners[n | (1 << j)], "cell-edge");
  const placed = [];
  for (const [i, name] of [..."abc"].entries()) {
    const tip = corners[1 << i];
    const dx = tip[0] - corners[0][0],
      dy = tip[1] - corners[0][1];
    const axis = element(root, "g", { class: "cell-axis", color: `var(--axis-${name})` });
    element(axis, "title", {}, "Positive " + name + " direction");
    if (Math.hypot(dx, dy) >= 3) {
      arrow(axis, corners[0], tip, "cell-vector");
    } else {
      // End-on notation for the positive axis: dot toward the eye, cross away.
      const [x, y] = tip;
      const toward = depth(rotate(model.basis.map((row) => row[i]))) > 0;
      circle(axis, tip, 3.8, "cell-end");
      if (toward) circle(axis, tip, 1.3, "cell-dot");
      else {
        line(axis, [x - 2, y - 2], [x + 2, y + 2], "cell-vector");
        line(axis, [x - 2, y + 2], [x + 2, y - 2], "cell-vector");
      }
    }
    // Try the tip first, then neighboring positions if two axes project together.
    const angle = Math.atan2(dy, dx);
    const candidates = [0, 1, -1, 2, -2, Math.PI].map((turn) => [
      tip[0] + 9 * Math.cos(angle + turn),
      tip[1] + 9 * Math.sin(angle + turn),
    ]);
    const p =
      candidates.find((p) => placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= 11)) ??
      candidates[0];
    placed.push(p);
    label(axis, p[0], p[1], name, "cell-axis-label");
  }
  label(root, width - 6, height - 4, "Unit cell").setAttribute("text-anchor", "end");
}

function inferGeometry(detector, spots, chosen, options) {
  const sample = chosen?.point ?? spots[0]?.point ?? null;
  let distance = options.distance ?? detector.distance ?? null;
  if (!(distance > 0) && detector.width && detector.maxAngle > 0 && detector.maxAngle < Math.PI / 2 - 1e-4) {
    distance = Math.hypot(detector.width, detector.height) / (2 * Math.tan(detector.maxAngle));
  }
  if (
    !(distance > 0) &&
    sample &&
    sample.twoTheta > 1e-4 &&
    sample.twoTheta < 89.99 &&
    Number.isFinite(sample.radius) &&
    sample.radius > 0
  ) {
    distance = sample.radius / Math.tan((sample.twoTheta * Math.PI) / 180);
  }
  let wavelength = options.wavelength ?? detector.wavelength ?? null;
  if (!(wavelength > 0) && sample && sample.twoTheta > 1e-4 && sample.length > 1e-9) {
    wavelength = (2 * Math.sin((sample.twoTheta * Math.PI) / 360)) / sample.length;
  }
  return { distance: distance > 0 ? distance : null, wavelength: wavelength > 0 ? wavelength : null };
}

function referenceAngles(maxTwoThetaDeg) {
  if (!(maxTwoThetaDeg > 4)) return [];
  const cap = Math.min(maxTwoThetaDeg * 0.96, 85);
  const steps = [5, 10, 15, 20, 30, 45];
  const step = steps.find((s) => Math.floor(cap / s) <= 4) ?? 45;
  const angles = [];
  for (let a = step; a <= cap; a += step) angles.push(a);
  return angles;
}

function styleRefRing(el) {
  el.style.fill = "none";
  el.style.stroke = "var(--line-strong)";
  el.style.strokeDasharray = "2 3";
  el.style.strokeWidth = "0.9";
  el.style.opacity = "0.5";
  el.style.pointerEvents = "none";
}

function styleRefLabel(el) {
  el.style.fill = "var(--muted)";
  el.style.fontSize = "9.5px";
  el.style.stroke = "var(--panel)";
  el.style.strokeWidth = "2.5px";
  el.style.paintOrder = "stroke";
  el.style.opacity = "0.85";
  el.style.pointerEvents = "none";
}

function drawIntensityLegend(svg, width, height) {
  if (width < 150 || height < 120) return;
  const group = element(svg, "g", { class: "detector-legend", "aria-hidden": "true" });
  group.style.pointerEvents = "none";
  const boxW = 136,
    boxH = 20,
    bx = 6,
    by = height - boxH - 5;
  const bg = element(group, "rect", { x: bx, y: by, width: boxW, height: boxH, rx: 4 });
  bg.style.fill = "var(--field)";
  bg.style.fillOpacity = "0.82";
  bg.style.stroke = "var(--line)";
  bg.style.strokeWidth = "0.8";
  const title = label(group, bx + 5, by + 13.5, "|F|²");
  title.style.fontSize = "9.5px";
  title.style.fontWeight = "600";
  title.style.fill = "var(--muted)";
  const entries = [
    { logArea: 0, text: "1%", dx: 33 },
    { logArea: 0.5, text: "10%", dx: 63 },
    { logArea: 1, text: "100%", dx: 98 },
  ];
  for (const { logArea, text, dx } of entries) {
    const r = spotRadius({ logArea }, 2.2, 6);
    const dot = circle(group, [bx + dx, by + boxH / 2], r, "crossing");
    dot.style.pointerEvents = "none";
    const t = label(group, bx + dx + r + 3, by + 13.5, text);
    t.style.fontSize = "9px";
    t.style.fill = "var(--muted)";
  }
}

export function drawDetector(svg, detector, spots, chosen, ring, onChoose, options = {}) {
  svg.replaceChildren();
  svg.onpointermove = null;
  svg.onpointerleave = null;
  const width = svg.clientWidth,
    height = svg.clientHeight;
  if (!width || !height) return;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const center = [width / 2, height / 2],
    [cx, cy] = center;
  const { distance, wavelength } = inferGeometry(detector, spots, chosen, options);
  const showRefRings = options.referenceRings !== false;
  const showLegend = options.intensityLegend !== false;
  const showHover = options.hoverReadout !== false;
  let spotPosition, hoverInfo;

  if (detector.pixel1) {
    const scale = Math.min((width - 16) / detector.width, (height - 16) / detector.height);
    const w = detector.width * scale,
      h = detector.height * scale;
    const x = cx - w / 2,
      y = cy - h / 2;
    spotPosition = (hit) => [
      x + (hit.col + 0.5) * detector.pixel2 * scale,
      y + (hit.row + 0.5) * detector.pixel1 * scale,
    ];
    const rect = { x, y, width: w, height: h };
    element(svg, "rect", { ...rect, class: "sensor" });
    const clip = element(element(svg, "defs", {}), "clipPath", { id: "sensor-clip" });
    element(clip, "rect", rect);
    if (showRefRings && detector.maxAngle > 0) {
      const angles = referenceAngles((detector.maxAngle * 180) / Math.PI);
      const showD = wavelength && width >= 260 && angles.length <= 3;
      for (const deg of angles) {
        const theta = (deg * Math.PI) / 180;
        let path = "",
          move = true,
          anchor = null;
        for (let i = 0; i <= 180; i++) {
          const t = (i * Math.PI) / 90;
          const hit = detector.project([
            Math.cos(theta),
            Math.sin(theta) * Math.cos(t),
            Math.sin(theta) * Math.sin(t),
          ]);
          if (!hit) {
            move = true;
            continue;
          }
          const pt = spotPosition(hit);
          path += (move ? "M" : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1);
          move = false;
          if (
            pt[0] > x + 14 &&
            pt[0] < x + w - 28 &&
            pt[1] > y + 14 &&
            pt[1] < y + h - 18 &&
            (!anchor || pt[0] - pt[1] > anchor[0] - anchor[1])
          )
            anchor = pt;
        }
        if (path) {
          const ringEl = element(svg, "path", {
            d: path,
            "clip-path": "url(#sensor-clip)",
            class: "detector-ref-ring",
          });
          styleRefRing(ringEl);
          if (anchor) {
            const dText = showD ? ` · ${(wavelength / (2 * Math.sin(theta / 2))).toFixed(1)}Å` : "";
            const lbl = label(svg, anchor[0] + 3, anchor[1] - 3, `${deg}°${dText}`, "detector-ref-label");
            styleRefLabel(lbl);
          }
        }
      }
    }
    if (chosen && ring) {
      const theta = (chosen.point.twoTheta * Math.PI) / 180;
      let path = "",
        move = true;
      for (let i = 0; i <= 720; i++) {
        const t = (i * Math.PI) / 360;
        const hit = detector.project([
          Math.cos(theta),
          Math.sin(theta) * Math.cos(t),
          Math.sin(theta) * Math.sin(t),
        ]);
        if (!hit) {
          move = true;
          continue;
        }
        path += (move ? "M" : "L") + spotPosition(hit).join(",");
        move = false;
      }
      element(svg, "path", { d: path, "clip-path": "url(#sensor-clip)", class: "powder-ring" });
    }
    for (const [start, end] of detector.rowGaps)
      element(svg, "rect", {
        x,
        y: y + start * detector.pixel1 * scale,
        width: w,
        height: (end - start) * detector.pixel1 * scale,
        class: "panel-gap",
      });
    for (const [start, end] of detector.colGaps)
      element(svg, "rect", {
        x: x + start * detector.pixel2 * scale,
        y,
        width: (end - start) * detector.pixel2 * scale,
        height: h,
        class: "panel-gap",
      });
    const beam = detector.project([1, 0, 0]);
    if (detector.contains(beam)) circle(svg, spotPosition(beam), 3, "origin");
    const flipRow = detector.orientation === 1 || detector.orientation === 2;
    const flipCol = detector.orientation === 1 || detector.orientation === 4;
    hoverInfo = (vx, vy) => {
      const col = (vx - x) / (detector.pixel2 * scale) - 0.5;
      const row = (vy - y) / (detector.pixel1 * scale) - 0.5;
      if (row < -0.5 || row >= detector.rows - 0.5 || col < -0.5 || col >= detector.cols - 0.5) return null;
      const ray = matVec(detector.axes, [
        (flipRow ? detector.rows - (row + 0.5) : row + 0.5) * detector.pixel1 - detector.poni1,
        (flipCol ? detector.cols - (col + 0.5) : col + 0.5) * detector.pixel2 - detector.poni2,
        detector.distance,
      ]);
      const twoThetaRad = Math.atan2(Math.hypot(ray[1], ray[2]), ray[0]);
      const twoThetaDeg = (twoThetaRad * 180) / Math.PI;
      const dPart =
        wavelength && twoThetaRad > 1e-5
          ? ` · d ${(wavelength / (2 * Math.sin(twoThetaRad / 2))).toFixed(2)} Å`
          : "";
      return `2θ ${twoThetaDeg.toFixed(1)}°${dPart} · ${Math.round(col)}, ${Math.round(row)} px`;
    };
  } else {
    const w = detector.width ?? detector.diameter,
      h = detector.height ?? detector.diameter;
    const scale = Math.min((width - 16) / w, (height - 16) / h);
    const rx = (w * scale) / 2,
      ry = (h * scale) / 2;
    spotPosition = (spot) => [cx - spot.y * scale, cy - spot.z * scale];
    const rect = { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
    const clip = element(element(svg, "defs", {}), "clipPath", { id: "sensor-clip" });
    if (detector.width) {
      element(svg, "rect", { ...rect, class: "sensor" });
      element(clip, "rect", rect);
    } else {
      circle(svg, center, rx, "sensor");
      element(clip, "circle", { cx, cy, r: rx });
    }
    if (showRefRings && distance > 0) {
      const maxR = detector.width ? Math.hypot(w, h) / 2 : detector.radius;
      const angles = referenceAngles((Math.atan2(maxR, distance) * 180) / Math.PI);
      const showD = wavelength && width >= 260 && angles.length <= 3;
      const diag = Math.SQRT1_2;
      for (const deg of angles) {
        const theta = (deg * Math.PI) / 180;
        const rPx = distance * Math.tan(theta) * scale;
        if (rPx < 10) continue;
        const ringEl = circle(svg, center, rPx, "detector-ref-ring");
        ringEl.setAttribute("clip-path", "url(#sensor-clip)");
        styleRefRing(ringEl);
        const lx = cx + rPx * diag;
        const ly = cy - rPx * diag;
        if (lx < cx + rx - 18 && ly > cy - ry + 12) {
          const dText = showD ? ` · ${(wavelength / (2 * Math.sin(theta / 2))).toFixed(1)}Å` : "";
          const lbl = label(svg, lx + 2, ly - 2, `${deg}°${dText}`, "detector-ref-label");
          styleRefLabel(lbl);
        }
      }
    }
    line(svg, [cx - rx, cy], [cx + rx, cy], "equator");
    line(svg, [cx, cy - ry], [cx, cy + ry], "equator");
    label(svg, cx - rx + 4, cy + 13, "+y");
    label(svg, cx + 4, cy - ry + 12, "+z");
    if (chosen && ring) {
      const overlay = circle(svg, center, chosen.point.radius * scale, "powder-ring");
      overlay.setAttribute("clip-path", "url(#sensor-clip)");
    }
    circle(svg, center, 3, "origin");
    hoverInfo = (vx, vy) => {
      const yMm = (cx - vx) / scale;
      const zMm = (cy - vy) / scale;
      const rMm = Math.hypot(yMm, zMm);
      if (detector.width ? Math.abs(yMm) > w / 2 || Math.abs(zMm) > h / 2 : rMm > detector.radius)
        return null;
      const coords = `y ${yMm.toFixed(1)}, z ${zMm.toFixed(1)} mm`;
      if (!(distance > 0)) return coords;
      const twoThetaRad = Math.atan2(rMm, distance);
      const twoThetaDeg = (twoThetaRad * 180) / Math.PI;
      const dPart =
        wavelength && twoThetaRad > 1e-5
          ? ` · d ${(wavelength / (2 * Math.sin(twoThetaRad / 2))).toFixed(2)} Å`
          : "";
      return `2θ ${twoThetaDeg.toFixed(1)}°${dPart} · ${coords}`;
    };
  }
  // Paint the selected spot last so its outline stays visible in dense patterns.
  for (const spot of [...spots.filter((s) => s !== chosen), ...(chosen ? [chosen] : [])]) {
    const p = spotPosition(spot);
    const hit = element(svg, "g", {
      class: "detector-hit",
      role: "button",
      tabindex: "0",
      "aria-label": "Select (" + spot.point.hkl.join(" ") + ")",
      "aria-pressed": String(spot === chosen),
    });
    circle(hit, p, 9, "hit-target");
    circle(hit, p, spotRadius(spot.point, 2.2, 6), spot === chosen ? "active-spot" : "crossing");
    if (spot === chosen) {
      const rightSide = p[0] > cx;
      const text = label(
        svg,
        p[0] + (rightSide ? -9 : 9),
        p[1] < 20 ? p[1] + 15 : p[1] - 7,
        "(" + formatMillerIndices(spot.point.hkl) + ")",
        "detector-spot-label",
      );
      text.setAttribute("text-anchor", rightSide ? "end" : "start");
    }
    hit.onclick = () => onChoose(spot);
    hit.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onChoose(spot);
        svg.querySelector('[aria-pressed="true"]')?.focus();
      }
    };
  }
  if (showLegend) drawIntensityLegend(svg, width, height);
  if (showHover && hoverInfo) {
    const readout = element(svg, "g", { class: "detector-hover-readout", "aria-hidden": "true" });
    readout.style.display = "none";
    readout.style.pointerEvents = "none";
    const bg = element(readout, "rect", { x: 6, y: 5, width: 100, height: 18, rx: 4 });
    bg.style.fill = "var(--field)";
    bg.style.fillOpacity = "0.88";
    bg.style.stroke = "var(--line-strong)";
    bg.style.strokeWidth = "0.8";
    const readoutText = label(readout, 11, 17, "");
    readoutText.style.fontSize = "10px";
    readoutText.style.fill = "var(--text)";
    svg.onpointermove = (event) => {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const vx = ((event.clientX - box.left) / box.width) * width;
      const vy = ((event.clientY - box.top) / box.height) * height;
      const text = hoverInfo(vx, vy);
      if (!text) {
        readout.style.display = "none";
        return;
      }
      readout.style.display = "";
      readoutText.textContent = text;
      const measured = readoutText.getComputedTextLength?.() || text.length * 5.6;
      bg.setAttribute("width", String(Math.min(width - 12, Math.ceil(measured + 10))));
    };
    svg.onpointerleave = () => {
      readout.style.display = "none";
    };
  }
}
