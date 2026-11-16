// Display-only appearance overrides for atoms and coordination polyhedra.
//
// Scopes, from broad to narrow (narrower wins, "reset" falls back):
//   element   – every atom of one element          (colour, radius scale)
//   atom      – one plotted atom copy, by atom key (colour, radius scale)
//   pair      – every polyhedron of one pair rule  (colour)
//   polyhedron– one polyhedron, by rule + centre   (colour)
//
// Nothing here touches coordinates, distances, cutoffs or coordination:
// radius scale changes only the drawn sphere (and its hit radius).
// Polyhedron faces and edges always pass through the true neighbor positions.

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
    scale: 1, // Ignore display scales from sessions saved by earlier versions.
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
    sizeRow = $("style-size-row"),
    sizeName = $("style-size-name"),
    sizeValue = $("style-size-value"),
    hint = $("style-size-hint"),
    opacityRow = $("style-opacity-row"),
    opacityName = $("style-opacity-name"),
    opacity = $("style-opacity"),
    opacityValue = $("style-opacity-value"),
    reset = $("style-reset"),
    resetIndividual = $("style-reset-individual"),
    pick = $("style-pick"),
    open = $("style-open");
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
  // Polyhedron face opacity: live on the existing face material; the
  // editor list is refreshed only on release (reset enablement).
  const showOpacity = () => {
    opacityValue.value = `${opacity.value}%`;
    opacity.setAttribute("aria-valuetext", `${opacity.value}%`);
  };
  opacity.oninput = () => {
    showOpacity();
    if (target) host.setOpacity?.(target, Number(opacity.value) / 100);
  };
  opacity.onchange = () => refresh();
  resetIndividual.onclick = () => {
    host.resetIndividuals?.();
    // A one-copy target now inherits again; fall back to its broad scope.
    if (target.startsWith("atom:") || target.startsWith("poly:")) picked = null;
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
  // The Style tab toggles the editor; the sidebar tabs navigate away.
  open.onclick = () => setOpen(root.hidden);
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
    // The pressed button carries the instruction, so no card covers the
    // crystal while picking.
    pick.textContent = picking ? "⌖ Tap the crystal" : "⌖ Pick one";
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
    for (const control of [custom, size, opacity, reset, ...swatches.children])
      control.disabled = !info;
    if (!info) opacityRow.hidden = sizeRow.hidden = hint.hidden = true;
    if (!info) {
      title.textContent = "Open a structure to edit colors and sizes.";
      resetIndividual.hidden = true;
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
    sizeRow.hidden = hint.hidden = !atom;
    size.disabled = !atom;
    sizeName.textContent = "Radius";
    size.min = "30";
    size.max = "250";
    size.title = "Drawn radius relative to the element default; picking follows it";
    // Always-visible reference (touch has no tooltips).
    hint.textContent = "100% = element default radius · display only";
    hint.classList.toggle("off-true", info.scale !== 1);
    size.value = String(Math.round((info.scale ?? 1) * 100));
    sizeValue.value = `${size.value}%`;
    size.setAttribute("aria-valuetext", `${size.value}%`);
    size.setAttribute("aria-label", "Atom radius");
    // Opacity only for polyhedron targets (never atoms).
    const hasOpacity = !atom && info.opacity != null;
    opacityRow.hidden = !hasOpacity;
    if (hasOpacity) {
      opacityName.textContent = info.opacityLabel ?? "Opacity";
      opacity.setAttribute("aria-label", info.opacityLabel === "Pair opacity" ? "Pair face opacity (applies to the whole pair)" : "Polyhedron face opacity");
      opacity.value = String(Math.round(info.opacity * 100));
      showOpacity();
    }
    reset.disabled = !info.overridden;
    // The reset names exactly what it resets. A one-copy reset removes only
    // that copy's override, so it inherits the CURRENT element/pair style.
    const kind = target.split(":")[0];
    const resets = {
      atom: ["Reset atom", "Remove this atom copy's own color and size; it then follows its element's current style"],
      poly: ["Reset polyhedron", "Remove this polyhedron's own color; it then follows its pair's current style"],
      element: ["Reset element", "Restore the element's default color and radius, including its individually styled copies"],
      pair: ["Reset pair", "Restore the pair's default color and opacity, including its individually styled polyhedra"],
    }[kind] ?? ["Reset", "Restore the default style"];
    reset.textContent = resets[0];
    reset.title = resets[1];
    reset.setAttribute("aria-label", `${resets[0]}: ${resets[1]}`);
    // Every individually styled copy can be reset in one action.
    const individual = host.individualCount?.() ?? 0;
    resetIndividual.hidden = !individual;
    resetIndividual.textContent = `Reset all ${individual} individual style${individual === 1 ? "" : "s"}`;
    resetIndividual.title =
      "Remove every individual atom and polyhedron override; each copy then follows its element or pair style";
    resetIndividual.setAttribute(
      "aria-label",
      `Reset all ${individual} individually styled atom and polyhedron copies to their element or pair style`,
    );
  }
  /** Session restore: select a target if it still exists in the list. */
  function restoreTarget(value) {
    if (typeof value !== "string" || !value) return false;
    const item = host.targets().find((t) => t.value === value);
    if (!item) return false;
    target = value;
    refresh();
    return true;
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
    /** Sidebar modes open/close the editor explicitly. */
    setOpen(show) {
      if (show !== !root.hidden) setOpen(show);
    },
    /** Select an explicitly picked atom or polyhedron as the target. */
    choose(item) {
      picked = item;
      target = item.value;
      refresh();
    },
    refresh,
    restoreTarget,
    /** Unrelated file or block: forget picks and targets. */
    clear() {
      picked = null;
      target = "";
      setPicking(false);
      refresh();
    },
  };
}
