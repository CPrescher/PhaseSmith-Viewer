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

export function drawEwald(root, model, rock, azimuth, spots, tracked, view) {
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
  const [back, front] = gridPaths(project, depth, center, radius);
  circle(svg, center, radius, "sphere");
  element(svg, "path", { d: back, class: "sphere-grid far" });
  element(svg, "path", { d: front, class: "sphere-grid near" });
  const rotate = (v) => labVector(v, model.tilt, rock, azimuth, model.axis);
  const locate = (p) => map(rotate(p.g));
  for (const point of model.points) {
    const p = locate(point);
    if (p[0] > 4 && p[0] < width - 4 && p[1] > 5 && p[1] < height - 5)
      circle(svg, p, spotRadius(point, 1.2, 2.7), "lattice-node");
  }
  const alongBeam = Math.hypot(origin[0] - center[0], origin[1] - center[1]) < 1;
  if (!alongBeam) arrow(svg, center, origin, "incident");
  for (const spot of spots)
    if (spot.point !== tracked) circle(svg, locate(spot.point), spotRadius(spot.point, 2.2, 4.5), "crossing");
  if (tracked?.intensity > 0) {
    const onSphere = model.onSphere(tracked, rock);
    const p = locate(tracked);
    arrow(svg, origin, p, "reciprocal");
    if (onSphere) arrow(svg, center, p, "outgoing");
    circle(svg, p, spotRadius(tracked, 2.2, 4.5), onSphere ? "crossing" : "tracked-node");
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

export function drawDetector(svg, detector, spots, chosen, ring, onChoose) {
  svg.replaceChildren();
  const width = svg.clientWidth,
    height = svg.clientHeight;
  if (!width || !height) return;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const center = [width / 2, height / 2],
    [cx, cy] = center;
  let spotPosition;
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
  } else {
    const w = detector.width ?? detector.diameter,
      h = detector.height ?? detector.diameter;
    const scale = Math.min((width - 16) / w, (height - 16) / h);
    const rx = (w * scale) / 2,
      ry = (h * scale) / 2;
    spotPosition = (spot) => [cx - spot.y * scale, cy - spot.z * scale];
    const rect = { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry };
    if (detector.width) element(svg, "rect", { ...rect, class: "sensor" });
    else circle(svg, center, rx, "sensor");
    line(svg, [cx - rx, cy], [cx + rx, cy], "equator");
    line(svg, [cx, cy - ry], [cx, cy + ry], "equator");
    label(svg, cx - rx + 4, cy + 13, "+y");
    label(svg, cx + 4, cy - ry + 12, "+z");
    if (chosen && ring) {
      const overlay = circle(svg, center, chosen.point.radius * scale, "powder-ring");
      if (detector.width) {
        const clip = element(element(svg, "defs", {}), "clipPath", { id: "sensor-clip" });
        element(clip, "rect", rect);
        overlay.setAttribute("clip-path", "url(#sensor-clip)");
      }
    }
    circle(svg, center, 3, "origin");
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
}
