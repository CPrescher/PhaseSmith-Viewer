// Display-only appearance overrides for atoms and coordination polyhedra.
//
// Scopes, from broad to narrow (narrower wins, "reset" falls back):
//   element   – every atom of one element          (colour, radius scale)
//   atom      – one plotted atom copy, by atom key (colour, radius scale)
//   pair      – every polyhedron of one pair rule  (colour, display scale)
//   polyhedron– one polyhedron, by rule + centre   (colour, display scale)
//
// Nothing here touches coordinates, distances, cutoffs or coordination:
// radius scale changes only the drawn sphere (and its hit radius), and
// polyhedron scale shrinks faces and edges about the central atom for
// display; 100 % is the true geometry.

export const PALETTE = [
  "#ed7073",
  "#efa04c",
  "#e4cf62",
  "#8cdf9b",
  "#62d5df",
  "#668df3",
  "#c6a0ef",
  "#e7edf3",
];

export function createAppearance() {
  return { elements: new Map(), atoms: new Map(), polyhedra: new Map() };
}

export function clearAppearance(state) {
  state.elements.clear();
  state.atoms.clear();
  state.polyhedra.clear();
}

export const polyKey = (ruleId, centerKey) => `${ruleId}|${centerKey}`;

/** Resolved atom style. `base` is the element's default colour. */
export function atomStyle(state, element, key, base) {
  const own = state.atoms.get(key);
  const group = state.elements.get(element);
  return {
    color: own?.color ?? group?.color ?? base,
    scale: own?.scale ?? group?.scale ?? 1,
  };
}

/** Resolved polyhedron style. `base` is the pair's default colour. */
export function polyhedronStyle(state, rule, centerKey, base) {
  const own = state.polyhedra.get(polyKey(rule.id, centerKey));
  return {
    color: own?.color ?? rule.color ?? base,
    scale: own?.scale ?? rule.scale ?? 1,
  };
}

const make = (tag, props = {}) =>
  Object.assign(document.createElement(tag), props);

/**
 * Wires the Appearance editor. `host` supplies the viewer-specific parts:
 *   targets()            → [{ value, label, group }] for the target menu
 *   describe(value)      → { title, kind: "atom"|"poly", color, scale,
 *                            overridden } or null
 *   apply(value, patch, final)  patch: { color?, scale? }
 *   reset(value)
 *   onPickMode(active)   called when explicit picking toggles
 *   onOpen(open)
 */
export function createAppearanceEditor(host) {
  const $ = (id) => document.getElementById(id);
  const root = $("style-editor"),
    select = $("style-target"),
    title = $("style-label"),
    swatches = $("style-swatches"),
    custom = $("style-color"),
    size = $("style-size"),
    sizeName = $("style-size-name"),
    sizeValue = $("style-size-value"),
    hint = $("style-size-hint"),
    reset = $("style-reset"),
    pick = $("style-pick"),
    open = $("style-open"),
    close = $("style-close");
  let target = "",
    picking = false,
    picked = null; // { value, label, group } of the last explicitly picked item

  for (const color of PALETTE) {
    const button = make("button", {
      type: "button",
      className: "swatch",
      title: color,
    });
    button.style.setProperty("--swatch", color);
    button.dataset.color = color;
    button.setAttribute("aria-label", `Color ${color}`);
    button.onclick = () => {
      if (target) host.apply(target, { color }, true);
      refresh();
    };
    swatches.append(button);
  }
  custom.oninput = () => target && host.apply(target, { color: custom.value }, false);
  custom.onchange = () => {
    if (target) host.apply(target, { color: custom.value }, true);
    refresh();
  };
  size.oninput = () => {
    sizeValue.value = `${size.value}%`;
    hint.classList.toggle("off-true", size.value !== "100");
    size.setAttribute("aria-valuetext", `${size.value}%`);
    if (target) host.apply(target, { scale: Number(size.value) / 100 }, false);
  };
  size.onchange = () => {
    if (target) host.apply(target, { scale: Number(size.value) / 100 }, true);
    refresh();
  };
  reset.onclick = () => {
    if (target) host.reset(target);
    refresh();
  };
  select.onchange = () => {
    target = select.value;
    refresh();
  };
  pick.onclick = () => setPicking(!picking);
  open.onclick = () => setOpen(root.hidden);
  close.onclick = () => {
    setOpen(false);
    open.focus({ preventScroll: true });
  };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (picking) setPicking(false);
      else {
        setOpen(false);
        open.focus({ preventScroll: true });
      }
    }
  });

  function setPicking(active) {
    picking = active && !root.hidden;
    pick.setAttribute("aria-pressed", String(picking));
    host.onPickMode(picking);
  }
  function setOpen(show) {
    root.hidden = !show;
    // In constrained inspectors the editor temporarily replaces Pairs
    // (CSS decides where both fit); Extent always stays.
    root.closest("aside")?.classList.toggle("editing-style", show);
    open.setAttribute("aria-expanded", String(show));
    open.setAttribute("aria-pressed", String(show));
    if (!show) setPicking(false);
    host.onOpen(show);
    if (show) {
      refresh();
      root.scrollIntoView({ block: "nearest" });
    }
  }
  function options() {
    const list = host.targets();
    if (picked && !list.some((t) => t.value === picked.value)) list.unshift(picked);
    return list;
  }
  function refresh() {
    if (root.hidden) return host.onTarget?.(null);
    try {
      update();
    } finally {
      host.onTarget?.(target);
    }
  }
  function update() {
    const list = options();
    if (!list.some((t) => t.value === target)) target = list[0]?.value ?? "";
    const groups = new Map();
    for (const item of list) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }
    select.replaceChildren(
      ...[...groups].map(([label, items]) => {
        const group = make("optgroup", { label });
        group.append(
          ...items.map((t) => make("option", { value: t.value, textContent: t.label })),
        );
        return group;
      }),
    );
    select.value = target;
    const info = target ? host.describe(target) : null;
    for (const control of [custom, size, reset, ...swatches.children])
      control.disabled = !info;
    if (!info) {
      title.textContent = "Open a structure to edit colors and sizes.";
      return;
    }
    title.textContent = info.title;
    custom.value = info.color;
    for (const swatch of swatches.children)
      swatch.setAttribute(
        "aria-pressed",
        String(swatch.dataset.color.toLowerCase() === info.color.toLowerCase()),
      );
    const atom = info.kind === "atom";
    sizeName.textContent = atom ? "Radius" : "Scale";
    size.min = atom ? "30" : "20";
    size.max = atom ? "250" : "200";
    size.title = atom
      ? "Drawn radius relative to the element default; picking follows it"
      : "Display size about the central atom; 100% is the true polyhedron";
    // Always-visible reference (touch has no tooltips).
    hint.textContent = atom
      ? "100% = element default radius · display only"
      : "100% = true geometry · display only, about the central atom";
    hint.classList.toggle("off-true", info.scale !== 1);
    size.value = String(Math.round(info.scale * 100));
    sizeValue.value = `${size.value}%`;
    size.setAttribute("aria-valuetext", `${size.value}%`);
    size.setAttribute("aria-label", atom ? "Atom radius" : "Polyhedron display scale");
    reset.disabled = !info.overridden;
  }
  return {
    get open() {
      return !root.hidden;
    },
    get picking() {
      return picking;
    },
    get target() {
      return target;
    },
    /** Select an explicitly picked atom or polyhedron as the target. */
    choose(item) {
      picked = item;
      target = item.value;
      refresh();
    },
    refresh,
    /** Unrelated file or block: forget picks and targets. */
    clear() {
      picked = null;
      target = "";
      setPicking(false);
      refresh();
    },
  };
}
