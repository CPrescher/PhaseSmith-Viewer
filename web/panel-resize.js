// Transparent edge targets keep panel controls and scroll gestures independent.
export function addResizeEdges(panel, start) {
  const layer = document.createElement("div");
  layer.className = "panel-resize-edges";
  layer.setAttribute("aria-hidden", "true");
  for (const edge of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
    const handle = document.createElement("span");
    handle.dataset.edge = edge;
    // Mark the strip as a touch target so browsers do not redirect a press
    // to a nearby field or table row.
    handle.setAttribute("role", "button");
    handle.tabIndex = -1;
    handle.addEventListener("pointerdown", event => {
      if (event.isPrimary && event.button === 0) start(event, edge);
    });
    layer.append(handle);
  }
  panel.append(layer);
  return layer;
}

export function resizedRect(rect, edge, dx, dy, bounds, minWidth, minHeight) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  let left = rect.x, top = rect.y, right = left + rect.w, bottom = top + rect.h;
  if (edge.includes("w")) left = clamp(left + dx, bounds.left, right - Math.min(rect.w, minWidth));
  if (edge.includes("e")) right = clamp(right + dx, left + Math.min(rect.w, minWidth), bounds.right);
  if (edge.includes("n")) top = clamp(top + dy, bounds.top, bottom - Math.min(rect.h, minHeight));
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + Math.min(rect.h, minHeight), bounds.bottom);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
