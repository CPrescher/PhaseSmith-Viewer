import { addResizeEdges, resizedRect } from "./panel-resize.js";

// One settings palette over the canvas. The rail toggles its active tool;
// switching tools keeps the camera fixed and the palette anchored.
// Desktop palettes can move/resize; touch layouts use a docked panel.
export const TOOLS = [
  { id: "pairs", label: "Bonds & polyhedra", title: "Bonds & polyhedra", button: "mode-pairs", hint: "Bonds and polyhedra: cutoffs and face opacity" },
  { id: "style", label: "Style", title: "Style", button: "style-open", hint: "Appearance: colors and sizes of elements, pairs and single copies" },
  { id: "lattice", label: "Planes", title: "Planes", button: "mode-lattice", hint: "Lattice planes (hkl)" },
  { id: "directions", label: "Directions", title: "Directions", button: "mode-directions", hint: "Direction arrows [uvw]" },
  { id: "symmetry", label: "Symmetry", title: "Symmetry", button: "mode-symmetry", hint: "Axes, planes and inversion centers" },
  { id: "sites", label: "Sites", title: "Sites & volumes", button: "mode-sites", hint: "Sites: CIF sites, labels, CN and polyhedron volumes" },
  { id: "extent", label: "Extent", title: "Extent", button: "mode-extent", hint: "Extent: plotting range, cell edges and boundary atoms" },
  { id: "export", label: "Export", title: "Export", button: "mode-export", hint: "Export: PNG images and turntable movies" },
];
export const TOOL_IDS = TOOLS.map((t) => t.id);
export const MARGIN = 8;
const MIN_W = 260,
  MIN_H = 88,
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
/** Rail at the right edge where it fits, else a Tools menu at the lower right. */
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
    const bottom = m.sheetBottomGap ?? 100;
    const besideRail = launcherFor(ws) === "rail";
    const reserved = Math.max(besideRail ? 0 : (m.railBottom ?? 0) + MARGIN, m.sheetTop ?? 0, H * 0.28);
    const available = Math.max(100, H - bottom - reserved);
    const h = Math.round(Math.min(H * (W >= 600 ? 0.42 : 0.46), 460, available));
    return { x: 0, y: H - bottom - h, w: besideRail ? W - (m.railColumn ?? 92) : W, h };
  }
  if (profile === "side") {
    const bottom = m.sideBottomGap ?? 72;
    const w = Math.round(clamp(W * 0.4, 280, 360));
    const y = Math.round(clamp(m.sideTop ?? 64, 0, Math.max(0,H - bottom - 100)));
    return { x: 0, y, w, h: Math.max(1,H - bottom - y) };
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

/**
 * Free overlay space for the phone Details card. Windows along an edge
 * leave a column or row; choose the larger limiting dimension. This
 * rectangle never changes the camera, projection or structure fit.
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
  const best = Math.min(column.w, column.h) >= Math.min(row.w, row.h) ? column : row;
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

// ---- One active tool -------------------------------------------------------
export function initialState(main = null) {
  return { main, rects: {} };
}
const copy = (s) => ({ main: s.main, rects: Object.fromEntries(Object.entries(s.rects).map(([k,v]) => [k,{...v}])) });
export const openTools = (s) => s.main ? [s.main] : [];
export const frontTool = (s) => s.main;
export const stacking = openTools;
export function chooseTool(state, tool) {
  if (!TOOL_IDS.includes(tool)) return state;
  return { ...copy(state), main: tool };
}
export function closeTool(state, tool) {
  return state.main === tool ? { ...copy(state), main: null } : state;
}
export function toggleTool(state, tool) {
  return state.main === tool ? closeTool(state, tool) : chooseTool(state, tool);
}
export function moveTool(state, tool, anchored) {
  if (state.main !== tool) return state;
  const next = copy(state);
  if (anchored) next.rects.main = { ...anchored };
  else delete next.rects.main;
  return next;
}
export function validateState(raw) {
  if (!raw || typeof raw !== "object") return null;
  // Migrate older pinned/minimized layouts to their last active tool. All
  // scientific values live in the original forms and are retained.
  const open = [raw.main, ...(Array.isArray(raw.pinned) ? raw.pinned : [])].filter(t => TOOL_IDS.includes(t));
  const order = Array.isArray(raw.order) ? raw.order.filter(t => open.includes(t)) : [];
  const main = order.at(-1) ?? open[0] ?? null;
  const source = raw.rects?.[main === raw.main ? "main" : main];
  return { main, rects: validAnchored(source) ? { main: { ...source } } : {} };
}

// ---- DOM window manager -----------------------------------------------------

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export function revealAddedRow(list) {
  const row = list.lastElementChild;
  row.tabIndex = -1;
  row.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (row.isConnected && document.activeElement === row) {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

/**
 * options: {
 *   viewport  — the crystal workspace element (windows are positioned in it)
 *   app       — element that receives data-profile/data-launcher
 *   rail      — the launcher (rail or menu list) containing the tool buttons
 *   menuButton — lower-right Tools button (menu launcher)
 *   metrics() — { paletteTop, railColumn, railBottom, sideTop, bottomGap }
 *   onLayout({ profile, launcher, ws, clear, offset, sheetLift, rightShift, windows })
 *   onVisibility(tool, visible)
 *   onChange()  — state changed (autosave)
 * }
 */
export function createToolWindows(options) {
  const { viewport, app, rail, menuButton, metrics, onLayout, onVisibility = () => {}, onChange = () => {} } = options;
  let state = initialState();
  let profile = "float",
    launcher = "rail",
    ws = { width: 1, height: 1 },
    drag = null;
  const dockedRects = new Map(); // independent manual bounds in each touch layout
  const visible = new Set();
  const windows = new Map();

  for (const tool of TOOLS) {
    const el = document.getElementById(`tool-window-${tool.id}`);
    const body = el.querySelector(".tool-window-body");
    const head = document.createElement("div");
    head.className = "tool-window-head";
    const title = document.createElement("h2");
    title.className = "tool-window-title";
    title.id = `tool-title-${tool.id}`;
    title.tabIndex = -1;
    title.innerHTML = `<span class="tool-icon" aria-hidden="true">${document.getElementById(tool.button)?.querySelector("svg")?.outerHTML ?? ""}</span><span class="tool-name"></span>`;
    title.querySelector(".tool-name").textContent = tool.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "window-button";
    close.dataset.action = "close";
    close.title = "Close";
    close.setAttribute("aria-label", `Close ${tool.title}`);
    close.innerHTML = svg('<path d="M6 6l12 12M18 6 6 18"/>');
    head.append(title);
    if (tool.id === "style") head.append(document.getElementById("style-pick"));
    head.append(close);
    el.prepend(head);
    addResizeEdges(el, (event, edge) => startDrag(event, tool.id, edge));
    el.setAttribute("aria-labelledby", title.id);
    el.setAttribute("role", "region");
    windows.set(tool.id, { tool, el, body, head, title, scroll: 0 });

    close.onclick = () => closeWindow(tool.id, true);
    head.addEventListener("pointerdown", (e) => startDrag(e, tool.id, "move"));
    body.addEventListener("click", e => {
      if (!e.target.closest("input, select, textarea, button, a, summary, [tabindex]")) title.focus({ preventScroll: true });
    });
    head.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      dockedRects.delete(`${profile}:${tool.id}`);
      if (profile === "float") commit(moveTool(state, tool.id, null));
      else apply();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (e.target.matches?.("input, select, textarea")) title.focus({ preventScroll: true });
      else closeWindow(tool.id, true);
    });
  }

  const groups = [...rail.querySelectorAll("[data-launcher-group]")].map(button => ({
    button, choices: document.getElementById(button.getAttribute("aria-controls")),
  }));
  let activeGroup = null;
  function closeGroup(refocus = false) {
    if (!activeGroup) return;
    const { button, choices } = activeGroup;
    activeGroup = null;
    choices.hidePopover();
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus({ preventScroll: true });
  }
  function openGroup(group) {
    closeGroup();
    activeGroup = group;
    const { button, choices } = group;
    button.setAttribute("aria-expanded", "true");
    choices.showPopover();
    const trigger = button.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    const x = rail.getBoundingClientRect().left - choices.offsetWidth - 6;
    const y = Math.min(trigger.top, bounds.bottom - choices.offsetHeight - 8);
    choices.style.left = Math.max(4, x) + "px";
    choices.style.top = Math.max(bounds.top + 4, y) + "px";
    choices.style.setProperty("--trigger-y", (trigger.top + trigger.height / 2 - choices.offsetTop) + "px");
    choices.querySelector("button").focus({ preventScroll: true });
  }
  let lastFit = "";
  function fitLauncherGroups() {
    if (!rail.clientHeight) return;
    const key = [launcher, ws.width, ws.height, rail.style.maxHeight, rail.classList.contains("rail-dense")].join("/");
    if (key === lastFit) return;
    lastFit = key;
    closeGroup();
    rail.classList.remove("grouped");
    for (const { button, choices } of groups) {
      button.hidden = true;
      choices.removeAttribute("popover");
    }
    const compact = rail.scrollHeight > rail.clientHeight + 1;
    rail.classList.toggle("grouped", compact);
    if (compact) for (const { button, choices } of groups) {
      choices.setAttribute("popover", "manual");
      button.hidden = false;
    }
  }
  for (const group of groups) {
    group.button.onclick = () => activeGroup === group ? closeGroup(true) : openGroup(group);
  }
  rail.addEventListener("scroll", () => closeGroup(), { passive: true });
  // Launcher buttons.
  for (const tool of TOOLS) {
    const b = document.getElementById(tool.button);
    b.setAttribute("aria-controls", `tool-window-${tool.id}`);
    b.onclick = (e) => {
      const fromSubmenu = activeGroup;
      closeGroup();
      closeMenu();
      const closing = state.main === tool.id;
      commit(toggleTool(state, tool.id));
      if (closing && launcher === "menu") menuButton?.focus({ preventScroll: true });
      else if (closing && fromSubmenu) fromSubmenu.button.focus({ preventScroll: true });
      else if (!closing && (e.detail === 0 || launcher === "menu" || fromSubmenu)) windows.get(tool.id)?.title.focus({ preventScroll: true });
    };
  }
  // Phone menu.
  function setMenu(open) {
    rail.classList.toggle("menu-open", open);
    menuButton?.setAttribute("aria-expanded", String(open));
    closeGroup();
    if (open) {
      fitLauncherGroups();
      const choices = [...rail.querySelectorAll("button")].filter(b => b.getClientRects().length);
      const target = choices.find(b => b.getAttribute("aria-pressed") === "true") ?? choices[0];
      rail.scrollTop = 0;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  function closeMenu() {
    if (rail.classList.contains("menu-open")) setMenu(false);
  }
  // Independent science-window launchers also dismiss the phone list.
  rail.addEventListener("click", (event) => {
    if (event.target.closest("[data-launcher-group]")) return;
    closeGroup();
    if (event.target.closest("button, a[href]")) closeMenu();
  });
  menuButton?.addEventListener("click", () => setMenu(!rail.classList.contains("menu-open")));
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (rail.contains(e.target) || menuButton?.contains(e.target)) return;
      closeGroup();
      if (!rail.classList.contains("menu-open")) return;
      setMenu(false);
    },
    true,
  );
  rail.addEventListener("keydown", (e) => {
    if (activeGroup && ["Escape", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "Escape" || e.key === "ArrowRight") return closeGroup(true);
      const items = [...activeGroup.choices.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 :
        (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (launcher === "menu" && rail.classList.contains("menu-open") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      const choices = [...rail.querySelectorAll("button:not(:disabled), a[href]")].filter((b) => b.getClientRects().length);
      const index = choices.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
      e.preventDefault();
      choices[next]?.focus({ preventScroll: true });
      choices[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    if (e.key === "Escape" && rail.classList.contains("menu-open")) {
      e.preventDefault();
      setMenu(false);
      menuButton?.focus({ preventScroll: true });
    } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open], :popover-open")) {
      const current = stacking(state).at(-1);
      if (current) { e.preventDefault(); closeWindow(current, true); }
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
      (b?.getClientRects().length ? b : groups.find(group => group.choices.contains(b))?.button)?.focus({ preventScroll: true });
    }
  }
  function currentRect(tool) {
    const el = windows.get(tool).el;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }
  // ---- Panel placement and resizing ----
  function floatingWorkspace() {
    // The fixed rail sits above palettes. Keep their headers and resize
    // corners out of that column, including after a saved view is restored.
    return { ...ws, width: launcher === "rail" ? Math.max(1, rail.offsetLeft) : ws.width };
  }
  function startDrag(e, tool, kind) {
    if (drag || e.button !== 0 || (kind === "move" && profile !== "float")) return;
    if (kind === "move" && e.target.closest("button")) return;
    const win = windows.get(tool);
    e.preventDefault();
    const r = currentRect(tool);
    drag = { tool, kind, profile, bounds: resizeBounds(), id: e.pointerId, x: e.clientX, y: e.clientY, r, next: r, target: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    win.el.classList.add(kind === "move" ? "moving" : "resizing");
  }
  function dragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    const r = drag.r;
    const next = drag.kind === "move"
      ? clampRect({ ...r, x: r.x + dx, y: r.y + dy }, floatingWorkspace())
      : resizedRect(r, drag.kind, dx, dy, drag.bounds, MIN_W, MIN_H);
    drag.next = next;
    place(windows.get(drag.tool).el, next);
  }
  function dragEnd(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { tool, kind, r, next, target, id, profile: startProfile } = drag;
    drag = null;
    if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
    windows.get(tool).el.classList.remove("moving", "resizing");
    if (next === r) return;
    if (startProfile !== "float") {
      dockedRects.set(`${startProfile}:${tool}`, anchorRect(next, ws));
      apply();
      return;
    }
    const saved = state.rects.main;
    const anchored = anchorRect(clampRect(next, floatingWorkspace()), ws);
    // Older sessions stored one explicit size for the shared palette.
    const heights = saved?.heights ?? (saved ? Object.fromEntries(TOOL_IDS.map(id => [id, saved.h])) : {});
    anchored.heights = { ...heights };
    if (kind !== "move") anchored.heights[tool] = anchored.h;
    commit(moveTool(state, tool, anchored));
  }
  for (const { el } of windows.values()) {
    el.addEventListener("pointermove", dragMove);
    el.addEventListener("pointerup", dragEnd);
    el.addEventListener("pointercancel", dragEnd);
    el.addEventListener("lostpointercapture", dragEnd);
  }

  function resizeBounds() {
    const inset = profile === "float" ? MARGIN : 0;
    const bottomGap = profile === "float" ? inset : metrics().sheetBottomGap;
    return { left: inset, top: inset, right: floatingWorkspace().width - inset, bottom: ws.height - bottomGap };
  }

  // ---- Layout ----
  function rectFor(tool) {
    if (profile !== "float") {
      const saved = dockedRects.get(`${profile}:${tool}`);
      if (!saved) return defaultRect(profile, ws, metrics());
      const bounds = resizeBounds();
      return clampRect(resolveRect(saved, ws), { width: bounds.right, height: bounds.bottom }, 0);
    }
    const saved = state.rects.main;
    const bounds = floatingWorkspace();
    const r = clampRect(saved ? resolveRect(saved, ws) : defaultRect("float", ws, metrics()), bounds);
    const manual = saved?.heights === undefined ? saved?.h : saved.heights?.[tool];
    const win = windows.get(tool);
    win.el.style.width = `${r.w}px`;
    const h = finite(manual) && manual > 0 ? manual : Math.min(naturalHeight(win), saved ? ws.height - 2 * MARGIN : r.h);
    return clampRect(saved ? resolveRect({ ...saved, h }, ws) : { ...r, h }, bounds);
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
    if (launcher !== "menu") {
      closeMenu();
      const view = viewport.getBoundingClientRect();
      const top = document.querySelector(".measure-row").getBoundingClientRect().bottom - view.top + 8;
      const bottom = view.bottom - document.querySelector(".axis-compass").getBoundingClientRect().top + 8;
      const available = Math.max(80, ws.height - top - bottom);
      rail.classList.toggle("rail-dense", available < 680);
      rail.style.maxHeight = `${available}px`;
      fitLauncherGroups();
      const height = rail.getBoundingClientRect().height;
      rail.style.top = `${Math.max(top, Math.min((ws.height - height) / 2, ws.height - bottom - height))}px`;
    } else {
      rail.style.removeProperty("top");
      rail.style.removeProperty("max-height");
      fitLauncherGroups();
    }
  }
  function naturalHeight(win) {
    const rect = win.body.getBoundingClientRect();
    const ends = [...win.body.children].filter(el => el.getClientRects().length)
      .map(el => el.getBoundingClientRect().bottom - rect.top + win.body.scrollTop);
    const padding = parseFloat(getComputedStyle(win.body).paddingBottom);
    return Math.ceil(win.head.getBoundingClientRect().height + Math.max(0, ...ends) + padding + win.el.offsetHeight - win.el.clientHeight);
  }
  function apply() {
    measureWorkspace();
    const shown = openTools(state);
    const focused = document.activeElement;
    const visual = window.visualViewport;
    const keyboard = visual && visual.scale === 1 &&
      window.innerHeight - visual.height > 100 &&
      focused?.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea");
    app.classList.toggle("keyboard-editing", Boolean(keyboard && shown.some(id => windows.get(id).body.contains(focused))));
    // Refresh fixed-control reserves after rotation even with no editor
    // open, so the Turn dock never inherits the previous orientation.
    if (!shown.length) metrics();
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
      const wasHidden = win.el.hidden;
      win.el.hidden = false;
      win.el.dataset.place = profile;
      let r = rectFor(id);
      if (profile !== "float" && !dockedRects.has(`${profile}:${id}`) && (launcher === "menu" || id === "extent")) {
        // Measure at the final width so wrapped controls and validation
        // messages count toward the height of the docked panel.
        win.el.style.width = `${r.w}px`;
        const h = Math.min(naturalHeight(win), r.h);
        r = { ...r, y: profile === "sheet" ? r.y + r.h - h : r.y, h };
      }
      // iOS keyboards shrink the visual viewport, not the canvas/layout
      // viewport. Move only the edited toolbox into that visible area;
      // keep the camera, launcher profile and saved palette bounds intact.
      const editing = keyboard && win.body.contains(focused);
      if (editing) {
        const view = viewport.getBoundingClientRect();
        const top = Math.max(MARGIN, visual.offsetTop - view.top + MARGIN);
        const bottom = Math.min(ws.height - MARGIN, visual.offsetTop + visual.height - view.top - MARGIN);
        const h = Math.min(r.h, Math.max(HEAD_H, bottom - top));
        r = { ...r, y: Math.max(top, Math.min(r.y, bottom - h)), h };
      }
      place(win.el, r);
      if (editing) {
        const field = focused.getBoundingClientRect(), body = win.body.getBoundingClientRect();
        if (field.bottom > body.bottom - MARGIN) win.body.scrollTop += field.bottom - body.bottom + MARGIN;
        else if (field.top < body.top + MARGIN) win.body.scrollTop -= body.top + MARGIN - field.top;
      }
      rects.set(id, r);
      if (wasHidden) win.body.scrollTop = win.scroll;
    }
    applyStacking();
    for (const tool of TOOLS) {
      const on = shown.includes(tool.id);
      const b = document.getElementById(tool.button);
      b.setAttribute("aria-pressed", String(on));
      b.dataset.state = on ? "open" : "closed";
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
    // Free overlay space is used only to bound phone Details; it never
    // changes the camera, fit distance or projection.
    const obstacles = [...rects.values()];
    const clear = stageRect(ws, obstacles);
    const offset = { x: 0, y: 0 };
    const info = {
      profile,
      launcher,
      ws,
      clear,
      offset,
      clearFraction: clearFraction(ws, obstacles),
      windows: [...rects].map(([tool, r]) => ({ tool, ...r })),
    };
    onLayout(info);
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
  let layoutFrame = 0;
  function scheduleLayout() {
    if (drag || layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (!drag) apply();
    });
  }
  const resize = new ResizeObserver(scheduleLayout);
  // A wrapped measurement label changes the space available to a phone sheet.
  resize.observe(document.querySelector(".measure-details"));
  resize.observe(viewport);
  // The body is a capped scroll container. Its contents can grow or shrink
  // while its own height stays fixed (adding a rule or opening a disclosure).
  for (const { body } of windows.values()) {
    for (const content of body.children) resize.observe(content);
  }
  window.visualViewport?.addEventListener("resize", scheduleLayout);
  window.visualViewport?.addEventListener("scroll", scheduleLayout);
  // Restore ordinary placement when editing ends, including native Done.
  for (const type of ["focusin", "focusout"])
    viewport.addEventListener(type, scheduleLayout);
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
