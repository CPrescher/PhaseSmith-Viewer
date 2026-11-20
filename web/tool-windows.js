// One settings palette over the canvas. The rail toggles its active tool;
// choosing another tool swaps content without changing bounds or camera.
// Desktop palettes can move/resize; touch layouts use a sheet and Tune.
export const TOOLS = [
  { id: "pairs", label: "Bonds & polyhedra", title: "Bonds & polyhedra", button: "mode-pairs", hint: "Bonds and polyhedra: cutoffs and face opacity" },
  { id: "style", label: "Style", title: "Style", button: "style-open", hint: "Appearance: colors and sizes of elements, pairs and single copies" },
  { id: "lattice", label: "Lattice", title: "Lattice", button: "mode-lattice", hint: "Lattice: planes (hkl), directions [uvw] and symmetry elements" },
  { id: "sites", label: "Sites", title: "Sites & volumes", button: "mode-sites", hint: "Sites: CIF sites, labels, CN and polyhedron volumes" },
  { id: "extent", label: "Extent", title: "Extent", button: "mode-extent", hint: "Extent: plotting range, cell edges and boundary atoms" },
  { id: "export", label: "Export", title: "Export", button: "mode-export", hint: "Export: PNG images and turntable movies" },
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
  return { main, rects: {}, tune: false };
}
const copy = (s) => ({ main: s.main, rects: Object.fromEntries(Object.entries(s.rects).map(([k,v]) => [k,{...v}])), tune: s.tune });
export const openTools = (s) => s.main ? [s.main] : [];
export const frontTool = (s) => s.main;
export const stacking = openTools;
export function chooseTool(state, tool) {
  if (!TOOL_IDS.includes(tool)) return state;
  return { ...copy(state), main: tool, tune: state.main === tool && state.tune };
}
export function closeTool(state, tool) {
  return state.main === tool ? { ...copy(state), main: null, tune: false } : state;
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
export function setTune(state, on) {
  return { ...copy(state), tune: Boolean(on) && Boolean(state.main) };
}
export function validateState(raw) {
  if (!raw || typeof raw !== "object") return null;
  // Migrate older pinned/minimized layouts to their last active tool. All
  // scientific values live in the original forms and are retained.
  const open = [raw.main, ...(Array.isArray(raw.pinned) ? raw.pinned : [])].filter(t => TOOL_IDS.includes(t));
  const order = Array.isArray(raw.order) ? raw.order.filter(t => open.includes(t)) : [];
  const main = order.at(-1) ?? open[0] ?? null;
  const source = raw.rects?.[main === raw.main ? "main" : main];
  return { main, rects: validAnchored(source) ? { main: { ...source } } : {}, tune: raw.tune === true && Boolean(main) };
}

// ---- DOM window manager -----------------------------------------------------

const ICONS = {
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

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
  const visible = new Set();
  const windows = new Map();
  const tuneKeys = new Map(); // tool → key of the active tunable item
  const compactHeights = new Map(); // explicit per-tool size, fixed until expanded

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
    const close = button("close", "Close", svg(ICONS.close));
    head.append(title);
    if (tool.id === "pairs") {
      const add = document.getElementById("add-rule");
      add.classList.add("window-button");
      head.append(add);
    }
    if (tool.id === "style") head.append(document.getElementById("style-pick"));
    if (tool.id === "extent") {
      const apply = document.querySelector("#range-form button[type=submit]");
      apply.setAttribute("form", "range-form");
      apply.textContent = "Apply axes";
      apply.title = "Apply all three fractional cell ranges";
      apply.id = "range-apply";
      head.append(apply);
    }
    const compact = button("compact", "Compact", "Compact", "compact-button");
    compact.hidden = true;
    compact.onclick = () => {
      if (compactHeights.has(tool.id)) compactHeights.delete(tool.id);
      else {
        const win = windows.get(tool.id), natural = naturalHeight(win);
        compactHeights.set(tool.id, natural < win.el.getBoundingClientRect().height - 48
          ? natural : win.head.getBoundingClientRect().height + 2);
      }
      apply();
    };
    head.append(tune, compact, close);
    el.prepend(head);
    const grip = document.createElement("div");
    grip.className = "window-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.title = "Resize";
    el.append(grip);
    el.setAttribute("aria-labelledby", title.id);
    el.setAttribute("role", "region");
    windows.set(tool.id, { tool, el, body, head, title, buttons: { tune, compact, close }, grip, scroll: 0, tuneScroll: null });

    tune.onclick = () => toggleTune(tool.id);
    close.onclick = () => closeWindow(tool.id, true);
    head.addEventListener("pointerdown", (e) => startDrag(e, tool.id, "move"));
    grip.addEventListener("pointerdown", (e) => startDrag(e, tool.id, "resize"));
    head.addEventListener("dblclick", (e) => {
      if (profile !== "float" || e.target.closest("button")) return;
      commit(moveTool(state, tool.id, null)); // back to its default place
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
      const closing = state.main === tool.id;
      commit(toggleTool(state, tool.id));
      if (closing && launcher === "menu") menuButton?.focus({ preventScroll: true });
      else if (!closing && (e.detail === 0 || launcher === "menu")) windows.get(tool.id)?.title.focus({ preventScroll: true });
    };
  }
  // Phone menu.
  function setMenu(open) {
    rail.classList.toggle("menu-open", open);
    menuButton?.setAttribute("aria-expanded", String(open));
    if (open) {
      const target = rail.querySelector('[aria-pressed="true"]') ?? rail.querySelector("button");
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
    if (event.target.closest("button, a[href]")) closeMenu();
  });
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
      b?.focus({ preventScroll: true });
    }
  }
  function currentRect(tool) {
    const el = windows.get(tool).el;
    return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
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
      profile !== "sheet" || frontTool(state) !== tool || !win.body.querySelector("[data-tune-item]");
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
    if (kind === "resize") compactHeights.delete(tool);
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
    const { tool, next, target, id } = drag;
    drag = null;
    if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id);
    windows.get(tool).el.classList.remove("moving", "resizing");
    commit(moveTool(state, tool, anchorRect(clampRect(next, ws), ws)));
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
    const saved = state.rects.main;
    return clampRect(saved ? resolveRect(saved, ws) : defaultRect("float", ws, metrics()), ws);
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
      rail.style.maxHeight = `${Math.max(80, ws.height - top - bottom)}px`;
      const height = rail.getBoundingClientRect().height;
      rail.style.top = `${Math.max(top, Math.min((ws.height - height) / 2, ws.height - bottom - height))}px`;
    } else {
      rail.style.removeProperty("top");
      rail.style.removeProperty("max-height");
    }
  }
  function naturalHeight(win) {
    const rect = win.body.getBoundingClientRect();
    const ends = [...win.body.children].filter(el => el.getClientRects().length)
      .map(el => el.getBoundingClientRect().bottom - rect.top + win.body.scrollTop);
    return Math.ceil(win.head.getBoundingClientRect().height + Math.max(0, ...ends) + 16);
  }
  function apply() {
    measureWorkspace();
    const shown = openTools(state);
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
      const tuning = markTunePath(id);
      win.el.dataset.tune = String(tuning);
      let r = rectFor(id);
      if (tuning) {
        // Compact strip: the named entry only, at its natural height.
        win.el.style.height = "auto";
        win.el.style.width = `${r.w}px`;
        const natural = Math.ceil(win.el.getBoundingClientRect().height);
        const h = Math.min(natural, r.h);
        r = { ...r, y: r.y + r.h - h, h };
      }
      // Compact is an explicit request, never an automatic camera or palette
      // reframe. Keep that height stable even if content subsequently changes.
      if (!tuning && compactHeights.has(id)) {
        const h = Math.min(r.h, Math.max(win.head.getBoundingClientRect().height + 2, compactHeights.get(id)));
        r = { ...r, y: profile === "sheet" ? r.y + r.h - h : r.y, h };
      }
      place(win.el, r);
      const compacted = compactHeights.has(id);
      const fold = naturalHeight(win) >= r.h - 48;
      const action = compacted ? "Expand" : fold ? "Fold" : "Compact";
      win.buttons.compact.hidden = tuning;
      win.buttons.compact.textContent = action;
      win.buttons.compact.title = compacted ? "Restore the full panel height" : fold
        ? "Fold controls into the header to reveal the crystal" : "Fit this panel to its content; keep the crystal stationary";
      win.buttons.compact.setAttribute("aria-label", `${action} ${win.tool.title} panel`);
      rects.set(id, r);
      if (wasHidden) win.body.scrollTop = win.scroll;
      const { tune } = win.buttons;
      refreshTuneButton(id);
      tune.setAttribute("aria-pressed", String(tuning));
      tune.textContent = tuning ? "All settings" : "Tune";
      tune.setAttribute("aria-label", tuning ? `Show all settings for ${win.tool.title}` : `Tune the chosen ${win.tool.title} entry with the crystal in view`);
      tune.title = tuning ? "Show all settings of this tool again" : "Keep only the chosen entry, with more room for the crystal";

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
