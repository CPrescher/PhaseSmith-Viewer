// The browser still handles scrolling by wheel, touch and keyboard. Draw
// the track separately so it stays visible on systems with fading bars.
export function installPanelScrollbars() {
  const selector = [
    ".tool-window-body", ".analysis-body", ".detector-body", ".table-scroll", ".sym-ops",
    "#reflection-explorer", "#reflection-content", ".reflection-phasor-scroll", "#reflection-sum-panel", "#reflection-rays-panel",
    ".reflection-atom-table", ".reflection-toolbar", ".detector-controls", ".detector-visuals", "#detector-matrix",
  ].join(",");
  for (const panel of document.querySelectorAll(".tool-window, .xrd-workspace, dialog, .file-menu")) {
    const layer = document.createElement("div");
    layer.className = "panel-scrollbars";
    layer.setAttribute("aria-hidden", "true");
    panel.append(layer);
    const ports = [panel, ...panel.querySelectorAll(selector)];
    const tracks = new Map();
    const corner = panel.querySelector(".panel-resize-edges") ? 20 : 0;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    function update() {
      frame = 0;
      if (!panel.getClientRects().length) return;
      layer.style.transform = `translate(${panel.scrollLeft}px, ${panel.scrollTop}px)`;
      const origin = layer.getBoundingClientRect();
      for (const port of ports) {
        const style = getComputedStyle(port);
        const rect = port.getBoundingClientRect();
        const vertical = /^(scroll|auto)$/.test(style.overflowY) && port.scrollHeight > port.clientHeight + 1;
        const horizontal = /^(scroll|auto)$/.test(style.overflowX) && port.scrollWidth > port.clientWidth + 1;
        let left = Math.max(origin.left, rect.left + port.clientLeft);
        let top = Math.max(origin.top, rect.top + port.clientTop);
        let right = Math.min(origin.right, rect.left + port.clientLeft + port.clientWidth);
        let bottom = Math.min(origin.bottom, rect.top + port.clientTop + port.clientHeight);
        for (let parent = port.parentElement; (vertical || horizontal) && panel.contains(parent); parent = parent.parentElement) {
          const css = getComputedStyle(parent);
          const clip = parent.getBoundingClientRect();
          if (css.overflowX !== "visible") {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (css.overflowY !== "visible") {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        let bars = tracks.get(port);
        if (!bars) {
          if (!vertical && !horizontal) continue;
          bars = {};
          tracks.set(port, bars);
        }
        for (const axis of ["y", "x"]) {
          const y = axis === "y";
          // Leave the outer border free for resizing, including at corners.
          const x1 = left - origin.left + 2, y1 = top - origin.top + 2;
          const x2 = Math.min(right - origin.left, origin.width - 2) - 2;
          const y2 = Math.min(bottom - origin.top, origin.height - 2) - 2;
          const start = Math.max(y ? y1 : x1, corner);
          const end = Math.min(y ? y2 : x2, (y ? origin.height : origin.width) - corner);
          const length = end - start - (vertical && horizontal ? 9 : 0);
          if (!(y ? vertical : horizontal) || length < 18 || x2 - x1 < 10 || y2 - y1 < 10) {
            if (bars[axis]) bars[axis].track.hidden = true;
            continue;
          }
          const bar = bars[axis] ??= makeTrack(port, layer, y);
          bar.track.hidden = false;
          const extent = y ? port.scrollHeight : port.scrollWidth;
          const view = y ? port.clientHeight : port.clientWidth;
          const size = Math.min(length, Math.max(18, length * view / extent));
          const position = (y ? port.scrollTop : port.scrollLeft) / (extent - view) * (length - size);
          Object.assign(bar.track.style, {
            left: (y ? x2 - 7 : start) + "px", top: (y ? start : y2 - 7) + "px",
            width: (y ? 7 : length) + "px", height: (y ? length : 7) + "px",
          });
          bar.thumb.style[y ? "height" : "width"] = size + "px";
          bar.thumb.style.transform = y ? `translateY(${position}px)` : `translateX(${position}px)`;
        }
      }
    }
    const sizes = new ResizeObserver(schedule);
    const contents = new MutationObserver(entries => {
      for (const change of entries) {
        for (const child of change.removedNodes) if (child.nodeType === 1) sizes.unobserve(child);
        for (const child of change.addedNodes) if (child.nodeType === 1) sizes.observe(child);
      }
      schedule();
    });
    for (const port of ports) {
      port.classList.add("panel-scrollport");
      sizes.observe(port);
      for (const child of port.children) if (child !== layer) sizes.observe(child);
      contents.observe(port, { childList: true });
    }
    panel.addEventListener("scroll", schedule, { capture: true, passive: true });
    panel.addEventListener("input", schedule);
  }
}

function makeTrack(port, layer, vertical) {
  const track = document.createElement("div"), thumb = document.createElement("span");
  track.className = "panel-scroll-track";
  track.tabIndex = -1;
  track.append(thumb);
  layer.append(track);
  const offset = vertical ? "scrollTop" : "scrollLeft";
  const length = vertical ? "height" : "width";
  const start = vertical ? "top" : "left";
  const coordinate = event => vertical ? event.clientY : event.clientX;
  let grab = 0;
  function move(event) {
    const rect = track.getBoundingClientRect();
    const travel = rect[length] - thumb.getBoundingClientRect()[length];
    const range = vertical ? port.scrollHeight - port.clientHeight : port.scrollWidth - port.clientWidth;
    if (travel > 0) port[offset] = (coordinate(event) - rect[start] - grab) / travel * range;
  }
  track.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const rect = thumb.getBoundingClientRect();
    grab = event.target === thumb ? coordinate(event) - rect[start] : rect[length] / 2;
    track.setPointerCapture(event.pointerId);
    move(event);
  });
  track.addEventListener("pointermove", event => {
    if (track.hasPointerCapture(event.pointerId)) move(event);
  });
  track.addEventListener("wheel", event => {
    if (event.ctrlKey) return;
    const delta = vertical ? event.deltaY : event.deltaX || event.deltaY;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2
      ? (vertical ? port.clientHeight : port.clientWidth) : 1;
    const previous = port[offset];
    port[offset] += delta * unit;
    if (port[offset] !== previous) event.preventDefault();
  }, { passive: false });
  return { track, thumb };
}
