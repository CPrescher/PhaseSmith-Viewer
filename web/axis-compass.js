// Orientation compass: the direct lattice vectors a, b, c (basis columns)
// projected with the current camera rotation. Arrow lengths are normalized
// per axis, then foreshortened by the projection, so angles between the
// drawn arrows are the true projected angles of an oblique cell — never a
// fake orthogonal Cartesian triad. An axis nearly along the line of sight
// is drawn as ⊙ (pointing toward the viewer) or ⊗ (away).

const SVG = "http://www.w3.org/2000/svg";
// Colors come from the theme's CSS variables (red a, green b, blue c).
const AXES = [
  { name: "a", color: "var(--axis-a)" },
  { name: "b", color: "var(--axis-b)" },
  { name: "c", color: "var(--axis-c)" },
];
const SIZE = 72,
  CENTER = SIZE / 2,
  RADIUS = 23,
  LINE_OF_SIGHT = 0.18; // projected length below this → ⊙ / ⊗

const el = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export function createAxisCompass(svg, description, { onAxisClick = null } = {}) {
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  // Only the axis hit targets take pointer input; the rest of the compass
  // stays transparent so crystal drags may start over it.
  svg.append(el("circle", { cx: CENTER, cy: CENTER, r: 2.2, class: "compass-origin" }));
  const parts = AXES.map(({ name, color }) => {
    const group = el("g", { class: "compass-axis" });
    // Inline styles (not presentation attributes) so var() colors resolve.
    const line = el("line", { "stroke-width": 2.2, "stroke-linecap": "round" });
    line.style.stroke = color;
    const head = el("polygon");
    head.style.fill = color;
    const sight = el("g", { class: "compass-sight" });
    const ring = el("circle", { r: 5, fill: "none", "stroke-width": 1.6 });
    ring.style.stroke = color;
    const dot = el("circle", { r: 1.7 });
    dot.style.fill = color;
    const cross = el("path", { "stroke-width": 1.6, fill: "none" });
    cross.style.stroke = color;
    sight.append(ring, dot, cross);
    const label = el("text", { class: "compass-label", "text-anchor": "middle", "dominant-baseline": "central" });
    label.style.fill = color;
    label.textContent = name;
    const hit = onAxisClick
      ? el("circle", { r: 11, fill: "transparent", class: "compass-hit" })
      : null;
    if (hit) {
      group.setAttribute("role", "button");
      group.setAttribute("tabindex", "0");
      group.setAttribute("aria-label", `View along +${name} (Shift-click for -${name})`);
      group.style.cursor = "pointer";
      group.style.pointerEvents = "auto";
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        onAxisClick(name, { opposite: event.shiftKey });
      });
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAxisClick(name, { opposite: event.shiftKey });
        }
      });
    }
    group.append(line, head, sight, label);
    if (hit) group.append(hit);
    svg.append(group);
    return { name, group, line, head, sight, ring, dot, cross, label, hit };
  });
  let lastText = "";

  /** basis: Cartesian rows / lattice columns; inverse: camera rotation
   *  inverse (world → view) as a THREE.Quaternion; vec: a THREE.Vector3. */
  function update(basis, inverse, vec) {
    if (!basis) {
      svg.hidden = true;
      return null;
    }
    svg.hidden = false;
    const projected = AXES.map((axis, i) => {
      vec.set(basis[0][i], basis[1][i], basis[2][i]).normalize().applyQuaternion(inverse);
      // View space: x right, y up, z toward the viewer.
      return { ...axis, x: vec.x, y: vec.y, z: vec.z, length: Math.hypot(vec.x, vec.y) };
    });
    // Labels: place at the tip, then push apart any that collide.
    const labels = projected.map((p) => {
      const along = p.length > LINE_OF_SIGHT ? RADIUS + 9 : 9;
      const ux = p.length > 1e-6 ? p.x / p.length : 0.7,
        uy = p.length > 1e-6 ? -p.y / p.length : -0.7;
      const reach = p.length > LINE_OF_SIGHT ? RADIUS * p.length + 8 : along;
      return { x: CENTER + ux * reach, y: CENTER + uy * reach };
    });
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < i; j++) {
        const dx = labels[i].x - labels[j].x,
          dy = labels[i].y - labels[j].y;
        const d = Math.hypot(dx, dy);
        if (d < 11) {
          const push = (11 - d) / 2 + 0.5;
          const nx = d > 1e-6 ? dx / d : 0,
            ny = d > 1e-6 ? dy / d : 1;
          labels[i].x += nx * push;
          labels[i].y += ny * push;
          labels[j].x -= nx * push;
          labels[j].y -= ny * push;
        }
      }
    // Far axes first so nearer ones draw on top.
    const order = [0, 1, 2].sort((i, j) => projected[i].z - projected[j].z);
    order.forEach((i) => svg.append(parts[i].group));
    projected.forEach((p, i) => {
      const part = parts[i];
      const label = labels[i];
      const nearSight = p.length < LINE_OF_SIGHT;
      // Subtly dim axes pointing away from the viewer (z < -0.25) for instant depth reading.
      const depthOpacity =
        p.z < -0.25
          ? nearSight
            ? 0.78
            : Math.max(0.58, 1 - ((-0.25 - p.z) / 0.75) * 0.42)
          : 1;
      part.group.style.opacity = depthOpacity === 1 ? "1" : depthOpacity.toFixed(2);
      part.label.setAttribute("x", label.x.toFixed(1));
      part.label.setAttribute("y", label.y.toFixed(1));
      if (part.hit) {
        part.hit.setAttribute("cx", label.x.toFixed(1));
        part.hit.setAttribute("cy", label.y.toFixed(1));
      }
      part.sight.style.display = nearSight ? "" : "none";
      part.line.style.display = part.head.style.display = nearSight ? "none" : "";
      if (nearSight) {
        // Symbol at a small offset so the three never sit exactly on the origin.
        const sx = CENTER + (label.x - CENTER) * 0.45,
          sy = CENTER + (label.y - CENTER) * 0.45;
        part.ring.setAttribute("cx", sx);
        part.ring.setAttribute("cy", sy);
        part.dot.setAttribute("cx", sx);
        part.dot.setAttribute("cy", sy);
        part.dot.style.display = p.z > 0 ? "" : "none";
        part.cross.setAttribute(
          "d",
          p.z > 0 ? "" : `M${sx - 3.2},${sy - 3.2}L${sx + 3.2},${sy + 3.2}M${sx + 3.2},${sy - 3.2}L${sx - 3.2},${sy + 3.2}`,
        );
        return;
      }
      const tipX = CENTER + p.x * RADIUS,
        tipY = CENTER - p.y * RADIUS;
      const ux = p.x / p.length,
        uy = -p.y / p.length;
      const headLength = Math.min(7, 4 + 3 * p.length);
      const baseX = tipX - ux * headLength,
        baseY = tipY - uy * headLength;
      part.line.setAttribute("x1", CENTER);
      part.line.setAttribute("y1", CENTER);
      part.line.setAttribute("x2", baseX.toFixed(2));
      part.line.setAttribute("y2", baseY.toFixed(2));
      const w = 3.2;
      part.head.setAttribute(
        "points",
        `${tipX.toFixed(2)},${tipY.toFixed(2)} ${(baseX - uy * w).toFixed(2)},${(baseY + ux * w).toFixed(2)} ${(baseX + uy * w).toFixed(2)},${(baseY - ux * w).toFixed(2)}`,
      );
      // Keep axis colors constant; depth is conveyed by order and ⊙ / ⊗.
    });
    // Coarse words change rarely, so the live text stays calm.
    const words = (p) => {
      if (p.length < LINE_OF_SIGHT) return p.z > 0 ? "toward you" : "away from you";
      const h = p.x > 0.35 ? "right" : p.x < -0.35 ? "left" : "";
      const v = p.y > 0.35 ? "up" : p.y < -0.35 ? "down" : "";
      const d = p.z > 0.5 ? " and toward you" : p.z < -0.5 ? " and away" : "";
      return `${[v, h].filter(Boolean).join("-") || "in view"}${d}`;
    };
    const text = `Lattice axes: ${projected.map((p) => `${p.name} points ${words(p)}`).join("; ")}.`;
    if (text !== lastText) {
      lastText = text;
      description.textContent = text;
    }
    return projected.map(({ name, x, y, z, length }) => ({ name, x, y, z, projectedLength: length, lineOfSight: length < LINE_OF_SIGHT }));
  }
  return { update };
}
