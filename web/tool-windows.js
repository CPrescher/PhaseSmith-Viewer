// Tool windows: one bounded palette per scientific tool (Pairs, Appearance,
// Lattice, Sites, Extent, Export & session) over a full-size crystal view.
//
// Mental model
// - The launcher (a rail at the right edge on desktops and tablets, a
//   round Tools menu in the header on phones) CHOOSES a tool. Choosing
//   shows that tool in the main palette at the palette's current bounds;
//   the previous tool's content is hidden with its values, selection and
//   scroll position intact. Choosing never closes anything else.
// - "Keep open" (desktop/tablet landscape) turns the main palette into a
//   kept window at its place; the next tool then opens in a new main
//   palette beside it, only where there is room. A tool is never shown
//   twice.
// - Window chrome closes (✕ or Escape) or minimizes (to its title bar).
// - Layout changes only through explicit window actions (choose, close,
//   minimize, move, resize, Tune) and window/orientation resizes, never
//   through atom picks or edits inside a tool.
//
// Placement profiles (from the workspace size, same semantics everywhere):
// - "float": movable, resizable palettes (desktop, tablet landscape);
// - "sheet": one bottom sheet (phone and tablet portrait) with an explicit
//   compact Tune mode;
// - "side": one sheet along the right edge (phone landscape).
//
// The pure helpers below (geometry and window state) have no DOM access
// and are covered by tests/tool-windows.test.mjs.

export const TOOLS = [
  { id: "pairs", label: "Pairs", title: "Pairs", button: "mode-pairs", hint: "Pairs: bonds, polyhedra, cutoffs and face opacity" },
  { id: "style", label: "Style", title: "Appearance", button: "style-open", hint: "Appearance: colors and sizes of elements, pairs and single copies" },
  { id: "lattice", label: "Lattice", title: "Lattice", button: "mode-lattice", hint: "Lattice: planes (hkl), directions [uvw] and symmetry elements" },
  { id: "sites", label: "Sites", title: "Sites & volumes", button: "mode-sites", hint: "Sites: CIF sites, labels, CN and polyhedron volumes" },
  { id: "extent", label: "Extent", title: "Extent", button: "mode-extent", hint: "Extent: plotting range, cell edges and boundary atoms" },
  { id: "export", label: "Export", title: "Export & session", button: "mode-export", hint: "Export: PNG, turntable movie and the saved session" },
];
export const TOOL_IDS = TOOLS.map((t) => t.id);
export const MARGIN = 8;
const MIN_W = 260,
  MIN_H = 180,
  HEAD_H = 48;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

// ---- Geometry -------------------------------------------------------------

/** Placement profile for a workspace (the crystal view) of this size. */
export function layoutProfile({ width, height }) {
  if (height < 480 && width > height) return "side";
  if (width < 700 || (width < 900 && height > width)) return "sheet";
  return "float";
}
/** Rail at the right edge where it fits, else a Tools menu in the header. */
export function launcherFor({ width, height }) {
  return width >= 700 && height >= 480 ? "rail" : "menu";
}

/**
 * Default rectangle (workspace px) of the main palette.
 * metrics: paletteTop (below the measurement card's reserved height),
 * railColumn (px kept free at the right edge for the rail and compass),
 * bottomGap, railBottom (sheets stay below the rail), sideTop.
 */
export function defaultRect(profile, ws, m = {}) {
  const W = ws.width,
    H = ws.height;
  if (profile === "sheet") {
    const share = W >= 600 ? 0.42 : 0.46;
    const reserved = Math.max((m.railBottom ?? 0) + MARGIN, H * 0.35);
    const h = Math.round(clamp(H * share, Math.min(280, H - reserved), Math.max(Math.min(460, H - reserved), 120)));
    return { x: 0, y: H - h, w: W, h };
  }
  if (profile === "side") {
    const w = Math.round(clamp(W * 0.4, 280, 360));
    const y = Math.round(clamp(m.sideTop ?? 64, 0, H - 120));
    return { x: W - w, y, w, h: H - y };
  }
  const w = Math.round(clamp(W * 0.25, 300, 360));
  const right = W - (m.railColumn ?? 92);
  const top = Math.round(m.paletteTop ?? 230);
  const bottom = H - (m.bottomGap ?? 40);
  let y = top,
    h = Math.min(bottom - top, 720);
  if (h < 300) {
    h = Math.min(300, H - 2 * MARGIN);
    y = Math.max(MARGIN, Math.min(top, bottom - h));
  }
  return { x: right - w, y, w, h };
}

/** Keep a floating window entirely inside the workspace. */
export function clampRect(r, ws, margin = MARGIN) {
  const maxW = Math.max(ws.width - 2 * margin, 1),
    maxH = Math.max(ws.height - 2 * margin, 1);
  const w = Math.min(Math.max(r.w, Math.min(MIN_W, maxW)), maxW);
  const h = Math.min(Math.max(r.h, Math.min(HEAD_H, maxH)), maxH);
  return {
    x: clamp(r.x, margin, Math.max(margin, ws.width - w - margin)),
    y: clamp(r.y, margin, Math.max(margin, ws.height - h - margin)),
    w,
    h,
  };
}

/** Anchor a rectangle to its nearest horizontal and vertical edges, so a
 *  window kept near the right edge stays there when the window resizes. */
export function anchorRect(r, ws) {
  const right = r.x + r.w / 2 > ws.width / 2,
    bottom = r.y + r.h / 2 > ws.height / 2;
  return {
    ax: right ? "right" : "left",
    dx: Math.round(right ? ws.width - r.x - r.w : r.x),
    ay: bottom ? "bottom" : "top",
    dy: Math.round(bottom ? ws.height - r.y - r.h : r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  };
}
export function resolveRect(a, ws) {
  return {
    x: a.ax === "right" ? ws.width - a.dx - a.w : a.dx,
    y: a.ay === "bottom" ? ws.height - a.dy - a.h : a.dy,
    w: a.w,
    h: a.h,
  };
}
export function validAnchored(a) {
  return (
    a &&
    typeof a === "object" &&
    (a.ax === "left" || a.ax === "right") &&
    (a.ay === "top" || a.ay === "bottom") &&
    [a.dx, a.dy, a.w, a.h].every(finite) &&
    a.w > 0 &&
    a.h > 0 &&
    a.w < 20000 &&
    a.h < 20000 &&
    Math.abs(a.dx) < 20000 &&
    Math.abs(a.dy) < 20000
  );
}

export function overlaps(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}
const insideWs = (r, ws, margin = MARGIN) =>
  r.x >= margin - 0.5 && r.y >= margin - 0.5 && r.x + r.w <= ws.width - margin + 0.5 && r.y + r.h <= ws.height - margin + 0.5;

/** Where a new palette of this size may go without covering occupied
 *  windows: the desired place, else beside one of them; null if no room. */
export function placeWindow(rect, occupied, ws, gap = MARGIN) {
  const free = (r) => insideWs(r, ws) && !occupied.some((o) => overlaps(r, o, gap - 1));
  if (free(rect)) return rect;
  for (const o of occupied)
    for (const c of [
      { ...rect, x: o.x - gap - rect.w },
      { ...rect, x: o.x - gap - rect.w, y: o.y },
      { ...rect, x: o.x + o.w + gap },
      { ...rect, x: o.x + o.w + gap, y: o.y },
    ])
      if (free(c)) return c;
  return null;
}

/**
 * The stage: where the crystal is centred. Windows along an edge leave a
 * full-height column (side palettes) or a full-width row (bottom sheet);
 * the larger free one is the stage. If windows are scattered so that no
 * column or row keeps at least `minShare` of the view, the whole view stays
 * the stage: a palette deliberately moved over the crystal never pushes it
 * into a sliver.
 */
export function stageRect(ws, obstacles, minShare = 0.3) {
  const full = { x: 0, y: 0, w: ws.width, h: ws.height };
  const obs = obstacles.filter((o) => o.w > 0 && o.h > 0 && o.x < ws.width && o.y < ws.height && o.x + o.w > 0 && o.y + o.h > 0);
  if (!obs.length) return full;
  const gaps = (size, spans) => {
    const sorted = spans.map(([a, b]) => [Math.max(0, a), Math.min(size, b)]).sort((p, q) => p[0] - q[0]);
    let at = 0,
      best = [0, 0];
    for (const [a, b] of sorted) {
      if (a - at > best[1] - best[0]) best = [at, a];
      at = Math.max(at, b);
    }
    if (size - at > best[1] - best[0]) best = [at, size];
    return best;
  };
  const [x0, x1] = gaps(ws.width, obs.map((o) => [o.x, o.x + o.w]));
  const [y0, y1] = gaps(ws.height, obs.map((o) => [o.y, o.y + o.h]));
  const column = { x: x0, y: 0, w: x1 - x0, h: ws.height },
    row = { x: 0, y: y0, w: ws.width, h: y1 - y0 };
  const best = column.w * column.h >= row.w * row.h ? column : row;
  return best.w * best.h >= minShare * ws.width * ws.height ? best : full;
}

/** Fraction of the workspace not covered by the given windows. */
export function clearFraction(ws, rects) {
  // Union area by inclusion on a coarse grid of the rectangle edges.
  const xs = [...new Set([0, ws.width, ...rects.flatMap((r) => [r.x, r.x + r.w])])].filter((v) => v >= 0 && v <= ws.width).sort((a, b) => a - b);
  const ys = [...new Set([0, ws.height, ...rects.flatMap((r) => [r.y, r.y + r.h])])].filter((v) => v >= 0 && v <= ws.height).sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i + 1 < xs.length; i++)
    for (let k = 0; k + 1 < ys.length; k++) {
      const cx = (xs[i] + xs[i + 1]) / 2,
        cy = (ys[k] + ys[k + 1]) / 2;
      if (rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h))
        covered += (xs[i + 1] - xs[i]) * (ys[k + 1] - ys[k]);
    }
  return 1 - covered / Math.max(ws.width * ws.height, 1);
}

/** Projection-centre offset (px from the canvas centre) that centres the
 *  crystal in the clear area. */
export function stageOffset(ws, clear) {
  return {
    x: Math.round(clear.x + clear.w / 2 - ws.width / 2),
    y: Math.round(clear.y + clear.h / 2 - ws.height / 2),
  };
}

// ---- Window state -----------------------------------------------------------
// { main: tool|null, pinned: [tool], minimized: [tool], order: [tool]
//   (front last), rects: { main?: anchored, <pinned tool>?: anchored },
//   tune: bool }. Pure: every transition returns a new object.

export function initialState(tool = "pairs") {
  return { main: tool, pinned: [], minimized: [], order: tool ? [tool] : [], rects: {}, tune: false };
}
const copy = (s) => ({
  main: s.main,
  pinned: [...s.pinned],
  minimized: [...s.minimized],
  order: [...s.order],
  rects: Object.fromEntries(Object.entries(s.rects).map(([k, v]) => [k, { ...v }])),
  tune: s.tune,
});
export const openTools = (s) => [s.main, ...s.pinned].filter(Boolean);
// Order and minimized flags only ever name open tools.
function normalize(s) {
  const open = openTools(s);
  s.order = [...s.order.filter((t) => open.includes(t))];
  for (const t of open) if (!s.order.includes(t)) s.order.unshift(t);
  s.minimized = s.minimized.filter((t) => open.includes(t));
  return s;
}
/** Open tools ordered back to front (front-most last). */
export const stacking = (s) => {
  const open = openTools(s);
  return [...s.order.filter((t) => open.includes(t)), ...open.filter((t) => !s.order.includes(t))];
};
export const frontTool = (s) => stacking(s).at(-1) ?? null;

export function chooseTool(state, tool) {
  if (!TOOL_IDS.includes(tool)) return state;
  const s = copy(state);
  if (frontTool(state) !== tool) s.tune = false;
  if (!s.pinned.includes(tool) && s.main !== tool) {
    s.main = tool;
    s.tune = false; // a different tool always opens in full
  }
  s.minimized = s.minimized.filter((t) => t !== tool);
  s.order = [...s.order.filter((t) => t !== tool), tool];
  return normalize(s);
}
export function closeTool(state, tool) {
  const s = copy(state);
  if (frontTool(state) === tool) s.tune = false;
  if (s.main === tool) {
    s.main = null;
    s.tune = false;
  } else if (s.pinned.includes(tool)) {
    s.pinned = s.pinned.filter((t) => t !== tool);
    delete s.rects[tool];
  } else return state;
  s.minimized = s.minimized.filter((t) => t !== tool);
  s.order = s.order.filter((t) => t !== tool);
  return normalize(s);
}
export function minimizeTool(state, tool, minimized = true) {
  if (!openTools(state).includes(tool)) return state;
  const s = copy(state);
  s.minimized = s.minimized.filter((t) => t !== tool);
  if (minimized) s.minimized.push(tool);
  else s.order = [...s.order.filter((t) => t !== tool), tool];
  return s;
}
/** Keep the main palette open at `rect` (anchored); the next tool opens in
 *  a new main palette. */
export function pinTool(state, tool, rect) {
  if (state.main !== tool || state.pinned.length >= 1) return state;
  const s = copy(state);
  s.pinned.push(tool);
  s.main = null;
  s.tune = false;
  if (rect) s.rects[tool] = { ...rect };
  delete s.rects.main;
  return s;
}
/** A kept window becomes the main palette again (one unpinned palette
 *  exists at a time: a different main palette closes, keeping its values). */
export function unpinTool(state, tool) {
  if (!state.pinned.includes(tool)) return state;
  const s = copy(state);
  s.pinned = s.pinned.filter((t) => t !== tool);
  if (s.main) {
    s.order = s.order.filter((t) => t !== s.main);
    s.minimized = s.minimized.filter((t) => t !== s.main);
  }
  s.main = tool;
  if (s.rects[tool]) s.rects.main = s.rects[tool];
  else delete s.rects.main;
  delete s.rects[tool];
  return normalize(s);
}
export function moveTool(state, tool, anchored) {
  const key = state.main === tool ? "main" : state.pinned.includes(tool) ? tool : null;
  if (!key) return state;
  const s = copy(state);
  if (anchored) s.rects[key] = { ...anchored };
  else delete s.rects[key];
  return s;
}
export function tidyState(state) {
  const s = copy(state);
  s.rects = {};
  return s;
}
export function setTune(state, on) {
  const s = copy(state);
  s.tune = Boolean(on) && Boolean(frontTool(s));
  return s;
}

/** Validated copy of a saved state, or null. */
export function validateState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tool = (t) => TOOL_IDS.includes(t);
  const main = tool(raw.main) ? raw.main : null;
  const pinned = Array.isArray(raw.pinned) ? [...new Set(raw.pinned.filter((t) => tool(t) && t !== main))].slice(0, 1) : [];
  const open = [main, ...pinned].filter(Boolean);
  const minimized = Array.isArray(raw.minimized) ? [...new Set(raw.minimized.filter((t) => open.includes(t)))] : [];
  const order = Array.isArray(raw.order) ? [...new Set(raw.order.filter((t) => open.includes(t)))] : [];
  for (const t of open) if (!order.includes(t)) order.push(t);
  const rects = {};
  const src = raw.rects && typeof raw.rects === "object" ? raw.rects : {};
  for (const key of ["main", ...pinned]) if (validAnchored(src[key])) rects[key] = { ...src[key] };
  return { main, pinned, minimized, order, rects, tune: raw.tune === true && open.length > 0 };
}

// ---- DOM window manager -----------------------------------------------------

const ICONS = {
  pin: '<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 14v7"/>',
  min: '<path d="M6 17h12"/>',
  max: '<rect x="5" y="6" width="14" height="12" rx="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/**
 * options: {
 *   viewport  — the crystal workspace element (windows are positioned in it)
 *   app       — element that receives data-profile/data-launcher
 *   rail      — the launcher (rail or menu list) containing the tool buttons
 *   menuButton — header Tools button (menu launcher)
 *   tidyButton — optional "default places" button in the rail
 *   metrics() — { paletteTop, railColumn, railBottom, sideTop, bottomGap }
 *   onLayout({ profile, launcher, ws, clear, offset, sheetLift, rightShift, windows })
 *   onVisibility(tool, visible)
 *   onChange()  — state changed (autosave)
 * }
 */
export function createToolWindows(options) {
  const { viewport, app, rail, menuButton, tidyButton, metrics, onLayout, onVisibility = () => {}, onChange = () => {} } = options;
  let state = initialState("pairs");
  let profile = "float",
    launcher = "rail",
    ws = { width: 1, height: 1 },
    lastSignature = "",
    drag = null;
  const visible = new Set();
  const windows = new Map();
  const tuneKeys = new Map(); // tool → key of the active tunable item

  for (const tool of TOOLS) {
    const el = document.getElementById(`tool-window-${tool.id}`);
    const body = el.querySelector(".tool-window-body");
    const head = document.createElement("div");
    head.className = "tool-window-head";
    const title = document.createElement("h2");
    title.className = "tool-window-title";
    title.id = `tool-title-${tool.id}`;
    title.tabIndex = -1;
    title.innerHTML = `<span class="tool-icon" aria-hidden="true">${document.getElementById(tool.button)?.querySelector("svg")?.outerHTML ?? ""}</span><span class="tool-name"></span><span class="tool-sub"></span>`;
    title.querySelector(".tool-name").textContent = tool.title;
    const button = (action, label, html, extra = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `window-button ${extra}`;
      b.dataset.action = action;
      b.setAttribute("aria-label", `${label} ${tool.title}`);
      b.title = label;
      b.innerHTML = html;
      return b;
    };
    const tune = button("tune", "Tune", "Tune", "tune-button");
    tune.setAttribute("aria-label", `Tune the chosen ${tool.title} entry with the crystal in view`);
    tune.setAttribute("aria-pressed", "false");
    const pin = button("pin", "Keep open", svg(ICONS.pin));
    pin.setAttribute("aria-pressed", "false");
    const min = button("minimize", "Minimize", svg(ICONS.min));
    const close = button("close", "Close", svg(ICONS.close));
    head.append(title, tune, pin, min, close);
    el.prepend(head);
    const grip = document.createElement("div");
    grip.className = "window-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.title = "Resize";
    el.append(grip);
    el.setAttribute("aria-labelledby", title.id);
    el.setAttribute("role", "region");
    windows.set(tool.id, { tool, el, body, head, title, buttons: { tune, pin, min, close }, grip, scroll: 0, tuneScroll: null });

    tune.onclick = () => toggleTune(tool.id);
    pin.onclick = () => togglePin(tool.id);
    min.onclick = () => {
      commit(minimizeTool(state, tool.id, !state.minimized.includes(tool.id)));
    };
    close.onclick = () => closeWindow(tool.id, true);
    head.addEventListener("pointerdown", (e) => startDrag(e, tool.id, "move"));
    grip.addEventListener("pointerdown", (e) => startDrag(e, tool.id, "resize"));
    head.addEventListener("dblclick", (e) => {
      if (profile !== "float" || e.target.closest("button")) return;
      commit(moveTool(state, tool.id, null)); // back to its default place
    });
    // Clicking a kept window brings it to the front (no layout change).
    el.addEventListener("pointerdown", () => {
      if (frontTool(state) !== tool.id && visible.has(tool.id)) {
        state = { ...state, order: [...state.order.filter((t) => t !== tool.id), tool.id] };
        applyStacking();
      }
    });
    // Escape: a field is left first (focus to the title), then Tune ends,
    // then the window closes. Sub-editors handle their own Escape first.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (e.target.matches?.("input, select, textarea")) title.focus({ preventScroll: true });
      else if (state.tune && frontTool(state) === tool.id && profile === "sheet") toggleTune(tool.id);
      else closeWindow(tool.id, true);
    });
    // The tunable entry last touched in this tool (pair, plane, arrow).
    const track = (e) => {
      const item = e.target.closest?.("[data-tune-item]");
      if (item && body.contains(item)) tuneKeys.set(tool.id, item.dataset.tuneItem);
    };
    body.addEventListener("pointerdown", track, true);
    body.addEventListener("focusin", track);
  }

  // Launcher buttons.
  for (const tool of TOOLS) {
    const b = document.getElementById(tool.button);
    b.setAttribute("aria-controls", `tool-window-${tool.id}`);
    b.onclick = (e) => {
      closeMenu();
      choose(tool.id, { focus: e.detail === 0 || launcher === "menu" });
    };
  }
  tidyButton?.addEventListener("click", () => commit(tidyState(state)));
  // Phone menu.
  function setMenu(open) {
    rail.classList.toggle("menu-open", open);
    menuButton?.setAttribute("aria-expanded", String(open));
    if (open) (rail.querySelector('[aria-pressed="true"]') ?? rail.querySelector("button"))?.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (rail.classList.contains("menu-open")) setMenu(false);
  }
  menuButton?.addEventListener("click", () => setMenu(!rail.classList.contains("menu-open")));
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!rail.classList.contains("menu-open")) return;
      if (rail.contains(e.target) || menuButton?.contains(e.target)) return;
      setMenu(false);
    },
    true,
  );
  rail.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && rail.classList.contains("menu-open")) {
      e.preventDefault();
      setMenu(false);
      menuButton?.focus({ preventScroll: true });
    }
  });

  function choose(tool, { focus = false } = {}) {
    commit(chooseTool(state, tool));
    if (focus) windows.get(tool)?.title.focus({ preventScroll: true });
  }
  function closeWindow(tool, refocus = false) {
    commit(closeTool(state, tool));
    if (refocus) {
      const b = launcher === "rail" ? document.getElementById(TOOLS.find((t) => t.id === tool).button) : menuButton;
      b?.focus({ preventScroll: true });
    }
  }
  function currentRect(tool) {
    const el = windows.get(tool).el;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  function togglePin(tool) {
    if (profile !== "float") return;
    if (state.pinned.includes(tool)) commit(unpinTool(state, tool));
    else if (state.main === tool && canPin()) {
      const r = currentRect(tool);
      if (state.minimized.includes(tool)) r.h = expandedHeight(tool, r);
      commit(pinTool(state, tool, anchorRect(r, ws)));
    }
  }
  function expandedHeight(tool, r) {
    const key = state.main === tool ? "main" : tool;
    return state.rects[key] ? resolveRect(state.rects[key], ws).h : defaultRect("float", ws, metrics()).h || r.h;
  }
  // Keep open is offered only while another palette would still fit.
  function canPin() {
    if (profile !== "float" || !state.main || state.pinned.length >= 1) return false;
    const occupied = [...state.pinned, state.main].map((t) => rectFor(t));
    return Boolean(placeWindow(defaultRect("float", ws, metrics()), occupied, ws));
  }

  // ---- Tune (bottom sheets) ----
  function tuneItem(tool) {
    const { body } = windows.get(tool);
    const key = tuneKeys.get(tool);
    return (key && body.querySelector(`[data-tune-item="${CSS.escape(key)}"]`)) || body.querySelector("[data-tune-item]");
  }
  function markTunePath(tool) {
    const { body, title } = windows.get(tool);
    for (const el of body.querySelectorAll(".tune-path, .tune-item")) el.classList.remove("tune-path", "tune-item");
    const item = state.tune && frontTool(state) === tool && profile === "sheet" ? tuneItem(tool) : null;
    title.querySelector(".tool-sub").textContent = item ? ` · ${item.dataset.tuneName || item.getAttribute("aria-label") || ""}` : "";
    if (!item) return false;
    item.classList.add("tune-item");
    for (let el = item.parentElement; el && el !== body.parentElement; el = el.parentElement) el.classList.add("tune-path");
    return true;
  }
  function toggleTune(tool) {
    if (profile !== "sheet" || frontTool(state) !== tool) return;
    const win = windows.get(tool);
    if (!state.tune) {
      if (!tuneItem(tool)) return;
      win.tuneScroll = win.body.scrollTop;
      commit(setTune(state, true));
    } else {
      commit(setTune(state, false));
      if (win.tuneScroll != null) win.body.scrollTop = win.tuneScroll; // All settings: same place
      win.tuneScroll = null;
    }
  }
  // Tune is offered once the tool has an entry to tune.
  function refreshTuneButton(tool) {
    const win = windows.get(tool);
    win.buttons.tune.hidden =
      profile !== "sheet" || frontTool(state) !== tool || state.minimized.includes(tool) || !win.body.querySelector("[data-tune-item]");
    if (state.tune && frontTool(state) === tool && profile === "sheet") {
      const item = tuneItem(tool);
      const subtitle = item ? ` · ${item.dataset.tuneName || item.getAttribute("aria-label") || ""}` : "";
      if (win.title.querySelector(".tool-sub").textContent !== subtitle)
        win.title.querySelector(".tool-sub").textContent = subtitle;
    }
  }
  // Re-rendered lists (a pair added or removed) keep the tuned entry.
  const tuneObserver = new MutationObserver(() => {
    const tool = frontTool(state);
    if (tool) refreshTuneButton(tool);
    if (!state.tune || !tool) return;
    if (windows.get(tool).body.querySelector(".tune-item")) return;
    if (!markTunePath(tool)) commit(setTune(state, false));
    else apply();
  });
  for (const { body } of windows.values()) tuneObserver.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tune-name"] });

  // ---- Move / resize (floating palettes) ----
  function startDrag(e, tool, kind) {
    if (profile !== "float" || drag || (e.button !== undefined && e.button !== 0)) return;
    if (kind === "move" && e.target.closest("button")) return;
    const win = windows.get(tool);
    e.preventDefault();
    const r = currentRect(tool);
    drag = { tool, kind, id: e.pointerId, x: e.clientX, y: e.clientY, r, next: r, target: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    win.el.classList.add(kind === "move" ? "moving" : "resizing");
  }
  function dragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    const r = drag.r;
    let next =
      drag.kind === "move"
        ? { ...r, x: r.x + dx, y: r.y + dy }
        : { ...r, w: Math.max(MIN_W, r.w + dx), h: Math.max(MIN_H, r.h + dy) };
    next = clampRect(next, ws);
    if (drag.kind === "resize") {
      next.x = r.x;
      next.y = r.y;
      next.w = Math.min(next.w, ws.width - MARGIN - r.x);
      next.h = Math.min(next.h, ws.height - MARGIN - r.y);
    }
    drag.next = next;
    place(windows.get(drag.tool).el, next);
  }
  function dragEnd(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { tool, next, kind, target, id } = drag;
    drag = null;
    if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
    windows.get(tool).el.classList.remove("moving", "resizing");
    let r = next;
    if (kind === "move" && state.minimized.includes(tool)) r = { ...r, h: expandedHeight(tool, r) };
    commit(moveTool(state, tool, anchorRect(clampRect(r, ws), ws)));
  }
  for (const { head, grip } of windows.values())
    for (const el of [head, grip]) {
      el.addEventListener("pointermove", dragMove);
      el.addEventListener("pointerup", dragEnd);
      el.addEventListener("pointercancel", dragEnd);
      el.addEventListener("lostpointercapture", dragEnd);
    }

  // ---- Layout ----
  function rectFor(tool) {
    if (profile !== "float") return defaultRect(profile, ws, metrics());
    const key = state.main === tool ? "main" : tool;
    const saved = state.rects[key];
    if (saved) return clampRect(resolveRect(saved, ws), ws);
    const base = defaultRect("float", ws, metrics());
    if (key !== "main") return clampRect(base, ws);
    // A new main palette avoids the kept windows.
    const occupied = state.pinned.map((t) => rectFor(t));
    return clampRect(placeWindow(base, occupied, ws) ?? base, ws);
  }
  function place(el, r) {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  }
  function applyStacking() {
    stacking(state).forEach((t, i) => (windows.get(t).el.style.zIndex = String(10 + i)));
  }
  function measureWorkspace() {
    ws = { width: Math.max(1, viewport.clientWidth), height: Math.max(1, viewport.clientHeight) };
    profile = layoutProfile(ws);
    launcher = launcherFor(ws);
    if (app.dataset.profile !== profile) app.dataset.profile = profile;
    if (app.dataset.launcher !== launcher) app.dataset.launcher = launcher;
    if (launcher !== "menu") closeMenu();
  }
  function apply() {
    measureWorkspace();
    const shown = profile === "float" ? openTools(state) : [frontTool(state)].filter(Boolean);
    const rects = new Map();
    // Hide first (remember scroll), then show (restore it).
    for (const [id, win] of windows) {
      const show = shown.includes(id);
      if (!show && !win.el.hidden) {
        win.scroll = win.body.scrollTop;
        win.el.hidden = true;
      }
    }
    for (const id of shown) {
      const win = windows.get(id);
      const minimized = state.minimized.includes(id);
      const wasHidden = win.el.hidden;
      win.el.hidden = false;
      win.el.dataset.place = profile;
      win.el.dataset.minimized = String(minimized);
      win.el.dataset.kept = String(state.pinned.includes(id));
      const tuning = markTunePath(id);
      win.el.dataset.tune = String(tuning);
      let r = rectFor(id);
      if (tuning && !minimized) {
        // Compact strip: the named entry only, at its natural height.
        win.el.style.height = "auto";
        win.el.style.width = `${r.w}px`;
        const natural = Math.ceil(win.el.getBoundingClientRect().height);
        const h = Math.min(natural, r.h);
        r = { ...r, y: ws.height - h, h };
      }
      if (minimized) {
        const h = win.head.offsetHeight || HEAD_H;
        r = profile === "sheet" ? { ...r, y: ws.height - h, h } : { ...r, h };
      }
      place(win.el, r);
      rects.set(id, r);
      if (wasHidden) win.body.scrollTop = win.scroll;
      const { tune, pin, min } = win.buttons;
      refreshTuneButton(id);
      tune.setAttribute("aria-pressed", String(tuning));
      tune.textContent = tuning ? "All settings" : "Tune";
      tune.setAttribute("aria-label", tuning ? `Show all settings for ${win.tool.title}` : `Tune the chosen ${win.tool.title} entry with the crystal in view`);
      tune.title = tuning ? "Show all settings of this tool again" : "Keep only the chosen entry, with more room for the crystal";
      pin.hidden = profile !== "float";
      const kept = state.pinned.includes(id);
      pin.setAttribute("aria-pressed", String(kept));
      pin.disabled = !kept && !canPin();
      pin.title = kept ? "Kept open · press to make this the main palette again" : state.pinned.length ? "Keep open: one other tool is already kept open" : pin.disabled ? "Keep open: no room for another palette" : "Keep open: the next tool opens in its own palette";
      min.innerHTML = svg(minimized ? ICONS.max : ICONS.min);
      min.title = minimized ? "Restore" : "Minimize";
      min.setAttribute("aria-label", `${min.title} ${win.tool.title}`);
      min.setAttribute("aria-expanded", String(!minimized));
    }
    applyStacking();
    for (const tool of TOOLS) {
      const on = shown.includes(tool.id);
      const b = document.getElementById(tool.button);
      b.setAttribute("aria-pressed", String(on));
      b.dataset.state = on ? (state.minimized.includes(tool.id) ? "minimized" : "open") : state.pinned.includes(tool.id) || state.main === tool.id ? "behind" : "closed";
      if (on !== visible.has(tool.id)) {
        if (on) visible.add(tool.id);
        else visible.delete(tool.id);
        onVisibility(tool.id, on);
      }
    }
    if (menuButton) {
      const front = shown[0] ? TOOLS.find((t) => t.id === frontTool(state)) : null;
      menuButton.dataset.active = front ? front.id : "";
      menuButton.setAttribute("aria-label", front ? `Tools (${front.title} open)` : "Tools");
    }
    if (tidyButton) tidyButton.disabled = !Object.keys(state.rects).length;
    // Obstacles for the crystal: open, expanded windows.
    const obstacles = [];
    let sheetLift = 0,
      rightShift = 0;
    for (const [id, r] of rects) {
      if (profile === "sheet") sheetLift = Math.max(sheetLift, ws.height - r.y);
      if (profile === "side") rightShift = Math.max(rightShift, ws.width - r.x);
      if (!state.minimized.includes(id) || profile !== "float") obstacles.push(r);
    }
    const clear = stageRect(ws, obstacles);
    const offset = stageOffset(ws, clear);
    const info = {
      profile,
      launcher,
      ws,
      clear,
      offset,
      sheetLift,
      rightShift,
      clearFraction: clearFraction(ws, obstacles),
      windows: [...rects].map(([tool, r]) => ({ tool, ...r })),
    };
    const signature = JSON.stringify([profile, ws, clear, sheetLift, rightShift]);
    if (signature !== lastSignature) {
      lastSignature = signature;
      onLayout(info);
    }
    lastInfo = info;
    return info;
  }
  let lastInfo = null;
  function commit(next) {
    if (next === state) return;
    state = next;
    apply();
    onChange();
  }
  const resize = new ResizeObserver(() => {
    if (!drag) apply();
  });
  resize.observe(viewport);
  apply();

  return {
    choose,
    close: (tool) => closeWindow(tool),
    layout: apply,
    isVisible: (tool) => visible.has(tool),
    isOpen: (tool) => openTools(state).includes(tool),
    /** Open tools back to front (front-most last). */
    openTools: () => stacking(state),
    exportState: () => copy(state),
    restore(raw) {
      const next = validateState(raw);
      if (!next) return false;
      state = next;
      apply();
      return true;
    },
    diagnostics() {
      const info = lastInfo ?? apply();
      return {
        profile,
        launcher,
        state: copy(state),
        visible: [...visible],
        clear: info.clear,
        offset: info.offset,
        clearFraction: info.clearFraction,
        rects: Object.fromEntries(info.windows.map(({ tool, ...r }) => [tool, r])),
        menuOpen: rail.classList.contains("menu-open"),
      };
    },
  };
}
