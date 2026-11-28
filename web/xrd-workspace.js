// Combined floating, 8-edge-resizable XRD workspace (Powder / Reflection / Detector)
// with shared radiation bar and active (hkl) handoff.
import { formatMillerIndices } from "./crystal-math.js";
import { keV } from "./radiation.js";
import { attachEdgeResizers, focusLauncher, setSettingsInFront } from "./floating-dialog.js";

export const XRD_TABS = Object.freeze(["powder", "reflection", "detector"]);

const PHONE_QUERY = "(max-width: 640px)";
const MIN_W = 420;
const MIN_H = 360;
const MARGIN = 10;

export function createXrdWorkspace({
  viewport = document.getElementById("viewport"),
  radiation,
  panels = {},
  onAddPlane = () => {},
  onChange = () => {},
} = {}) {
  const $ = (id) => document.getElementById(id);
  const root = $("xrd-workspace");
  const head = $("xrd-head");
  const closeBtn = $("xrd-close");
  const opener = $("mode-diffraction");
  const tabEls = Object.fromEntries(XRD_TABS.map((name) => [name, $(`xrd-tab-${name}`)]));
  const panelEls = Object.fromEntries(XRD_TABS.map((name) => [name, $(`xrd-panel-${name}`)]));
  const presetEl = $("radiation-preset");
  const wavelengthEl = $("radiation-wavelength");
  const energyEl = $("radiation-energy");
  const lockEl = $("radiation-lock");
  const activeHklWrap = $("active-hkl");
  const activeHklLabel = $("active-hkl-label");
  const activeHklMeta = $("active-hkl-meta");
  const activeHklPlane = $("active-hkl-plane");

  const registry = new Map(Object.entries(panels));
  const phoneMedia = matchMedia(PHONE_QUERY);

  let openState = false;
  let currentTab = "powder";
  let activeHkl = null;
  let activeMeta = null;
  let userRect = null; // { left, top, width, height } in viewport CSS px

  function bounds() {
    const rect = viewport?.getBoundingClientRect();
    return {
      width: Math.max(320, rect?.width || window.innerWidth || 1024),
      height: Math.max(320, rect?.height || window.innerHeight || 720),
    };
  }

  function defaultRect() {
    const { width: vw, height: vh } = bounds();
    const rail = document.getElementById("tool-rail")?.getBoundingClientRect();
    const rightReserve = rail && rail.width > 0 ? rail.width + 24 : 84;
    const top = Math.min(64, Math.max(MARGIN, Math.round(vh * 0.08)));
    const bottomReserve = 64;
    const width = Math.max(MIN_W, Math.min(780, Math.round(vw * 0.56), vw - rightReserve - MARGIN));
    const height = Math.max(MIN_H, Math.min(680, vh - top - bottomReserve));
    const left = Math.max(MARGIN, vw - width - rightReserve);
    return { left, top, width, height };
  }

  function clampRect(r) {
    const { width: vw, height: vh } = bounds();
    const width = Math.max(Math.min(MIN_W, vw - MARGIN * 2), Math.min(vw - MARGIN * 2, r.width));
    const height = Math.max(Math.min(MIN_H, vh - MARGIN * 2), Math.min(vh - MARGIN * 2, r.height));
    const left = Math.max(MARGIN, Math.min(vw - width - MARGIN, r.left));
    const top = Math.max(MARGIN, Math.min(vh - height - MARGIN, r.top));
    return { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) };
  }

  function applyRect(r) {
    if (!root) return;
    if (phoneMedia.matches) {
      root.style.left = root.style.top = root.style.width = root.style.height = "";
      return;
    }
    const clamped = clampRect(r);
    root.style.left = `${clamped.left}px`;
    root.style.top = `${clamped.top}px`;
    root.style.width = `${clamped.width}px`;
    root.style.height = `${clamped.height}px`;
  }

  function resetRect() {
    userRect = null;
    applyRect(defaultRect());
    onChange();
  }

  // ---- Drag header & 8-edge resize ----------------------------------------
  let drag = null;
  head?.addEventListener("pointerdown", (event) => {
    if (phoneMedia.matches || event.button !== 0) return;
    if (event.target.closest("button, input, select, a, [role='tab']")) return;
    event.preventDefault();
    head.setPointerCapture?.(event.pointerId);
    const cur = userRect ?? defaultRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...cur },
    };
    root?.classList.add("moving");
  });
  head?.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    userRect = clampRect({
      ...drag.origin,
      left: drag.origin.left + (event.clientX - drag.startX),
      top: drag.origin.top + (event.clientY - drag.startY),
    });
    applyRect(userRect);
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (head?.hasPointerCapture?.(drag.id)) head.releasePointerCapture(drag.id);
    drag = null;
    root?.classList.remove("moving");
    onChange();
  };
  head?.addEventListener("pointerup", endDrag);
  head?.addEventListener("pointercancel", endDrag);
  head?.addEventListener("dblclick", (event) => {
    if (phoneMedia.matches) return;
    if (event.target.closest("button, input, select, a, [role='tab']")) return;
    resetRect();
  });

  if (root && typeof attachEdgeResizers === "function") {
    attachEdgeResizers(root, {
      minW: MIN_W,
      minH: MIN_H,
      margin: MARGIN,
      canResize: () => openState && !phoneMedia.matches,
      getBounds: () => {
        const b = bounds();
        return {
          left: MARGIN,
          top: MARGIN,
          right: Math.max(MARGIN + MIN_W, b.width - MARGIN),
          bottom: Math.max(MARGIN + MIN_H, b.height - MARGIN),
        };
      },
      getRect: () => {
        const r = userRect ?? defaultRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      onResize: (next) => {
        userRect = clampRect({ left: next.x, top: next.y, width: next.w, height: next.h });
        applyRect(userRect);
      },
      onEnd: () => onChange(),
    });
  }

  if (viewport) {
    new ResizeObserver(() => {
      if (!openState) return;
      if (userRect) userRect = clampRect(userRect);
      applyRect(userRect ?? defaultRect());
    }).observe(viewport);
  }
  phoneMedia.addEventListener?.("change", () => {
    if (openState) applyRect(userRect ?? defaultRect());
  });

  // ---- Shared Radiation bar -----------------------------------------------
  function syncRadiationUI({ force = false } = {}) {
    if (!radiation) return;
    const { preset, wavelength, lockedBy } = radiation.state;
    if (presetEl && presetEl.value !== preset) presetEl.value = preset;
    if (wavelengthEl && (force || document.activeElement !== wavelengthEl)) {
      wavelengthEl.value = String(Number(wavelength.toFixed(6)));
    }
    if (energyEl) energyEl.textContent = `${keV(wavelength).toFixed(2)} keV`;
    const locked = Boolean(lockedBy);
    if (presetEl) presetEl.disabled = locked;
    if (wavelengthEl) wavelengthEl.disabled = locked;
    if (lockEl) {
      lockEl.hidden = !locked;
      const label = locked ? `PONI${lockedBy.name ? ` · ${lockedBy.name}` : ""}` : "";
      const span = lockEl.querySelector("span");
      if (span) span.textContent = label;
      else lockEl.textContent = label;
      lockEl.title = locked ? "Wavelength locked by loaded PONI detector calibration" : "";
    }
  }
  radiation?.subscribe(() => {
    syncRadiationUI();
    onChange();
  });
  presetEl?.addEventListener("change", () => {
    if (!radiation || radiation.locked) return;
    const value = presetEl.value;
    if (value === "custom") {
      wavelengthEl?.focus();
      return;
    }
    try {
      radiation.set({ preset: value });
    } catch {
      syncRadiationUI();
    }
  });
  wavelengthEl?.addEventListener("wheel", (e) => {
    e.preventDefault();
  }, { passive: false });
  wavelengthEl?.addEventListener("change", () => {
    if (!radiation || radiation.locked) return;
    try {
      radiation.set({ wavelength: Number(wavelengthEl.value) });
    } catch {
      syncRadiationUI({ force: true });
    }
  });
  lockEl?.addEventListener("click", () => {
    document.getElementById("detector-open-options")?.click();
  });
  syncRadiationUI();

  // ---- Shared active (hkl) chip -------------------------------------------
  function renderActiveHkl() {
    if (!activeHklWrap) return;
    if (!activeHkl) {
      activeHklWrap.hidden = true;
      return;
    }
    activeHklWrap.hidden = false;
    if (activeHklLabel) activeHklLabel.textContent = `(${formatMillerIndices(activeHkl)})`;
    if (activeHklMeta) {
      const parts = [];
      if (Number.isFinite(activeMeta?.d)) parts.push(`d ${activeMeta.d.toFixed(4)} Å`);
      if (Number.isFinite(activeMeta?.twoTheta)) parts.push(`2θ ${activeMeta.twoTheta.toFixed(2)}°`);
      activeHklMeta.textContent = parts.join(" · ");
    }
  }
  activeHklPlane?.addEventListener("click", () => {
    if (activeHkl) onAddPlane([...activeHkl]);
  });

  function setActive(hkl, origin, meta = null) {
    activeHkl = Array.isArray(hkl) && hkl.length === 3 ? hkl.map(Number) : null;
    activeMeta = activeHkl ? { ...meta, origin } : null;
    renderActiveHkl();
  }

  // ---- Tab switching & lifecycle ------------------------------------------
  function syncTabs() {
    if (root) root.dataset.tab = currentTab;
    for (const name of XRD_TABS) {
      const active = name === currentTab;
      const tab = tabEls[name];
      const panel = panelEls[name];
      if (tab) {
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      }
      if (panel) panel.hidden = !active;
    }
  }

  function select(tab, { handoff = null } = {}) {
    if (!XRD_TABS.includes(tab)) return;
    const prev = currentTab;
    const switched = prev !== tab;
    if (openState && switched) registry.get(prev)?.deactivate?.();
    currentTab = tab;
    syncTabs();
    if (openState) {
      // Plain tab switches pass align:false so user rotations & exercises stay intact.
      const effectiveHandoff = handoff ?? (activeHkl ? { hkl: [...activeHkl], align: false } : null);
      registry.get(currentTab)?.activate?.(effectiveHandoff);
    }
    if (switched) onChange();
  }

  function open(tab = currentTab, { handoff = null } = {}) {
    const targetTab = XRD_TABS.includes(tab) ? tab : currentTab;
    const wasOpen = openState;
    if (wasOpen && targetTab !== currentTab) registry.get(currentTab)?.deactivate?.();
    currentTab = targetTab;
    openState = true;
    if (root) root.hidden = false;
    setSettingsInFront(false);
    opener?.setAttribute("aria-pressed", "true");
    syncTabs();
    applyRect(userRect ?? defaultRect());
    syncRadiationUI();
    renderActiveHkl();
    const effectiveHandoff = handoff ?? (activeHkl ? { hkl: [...activeHkl], align: false } : null);
    registry.get(currentTab)?.activate?.(effectiveHandoff);
    onChange();
  }

  function close({ refocus = true } = {}) {
    if (!openState) return;
    openState = false;
    registry.get(currentTab)?.deactivate?.();
    if (root) root.hidden = true;
    opener?.setAttribute("aria-pressed", "false");
    if (refocus && opener) focusLauncher(opener);
    onChange();
  }

  function toggle(tab) {
    if (openState && (!tab || tab === currentTab)) close();
    else open(tab ?? currentTab);
  }

  // Tablist clicks and WAI-ARIA arrow navigation.
  for (const name of XRD_TABS) {
    const tab = tabEls[name];
    if (!tab) continue;
    tab.addEventListener("click", () => select(name));
    tab.addEventListener("keydown", (event) => {
      const idx = XRD_TABS.indexOf(name);
      let next = -1;
      if (event.key === "ArrowRight") next = (idx + 1) % XRD_TABS.length;
      else if (event.key === "ArrowLeft") next = (idx - 1 + XRD_TABS.length) % XRD_TABS.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = XRD_TABS.length - 1;
      if (next >= 0) {
        event.preventDefault();
        const nextName = XRD_TABS[next];
        select(nextName);
        tabEls[nextName]?.focus();
      }
    });
  }

  opener?.addEventListener("click", () => toggle());
  closeBtn?.addEventListener("click", () => close());
  root?.addEventListener("pointerdown", () => {
    if (openState) setSettingsInFront(false);
  });
  root?.addEventListener("focusin", () => {
    if (openState) setSettingsInFront(false);
  });
  root?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !openState) return;
    if (document.querySelector("dialog:modal, #detector-options[open]")) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  syncTabs();

  return {
    registerPanel(name, ctrl) {
      if (XRD_TABS.includes(name) && ctrl) registry.set(name, ctrl);
    },
    open,
    close,
    toggle,
    select,
    setActive,
    get isOpen() {
      return openState;
    },
    get tab() {
      return currentTab;
    },
    get activeHkl() {
      return activeHkl ? [...activeHkl] : null;
    },
    exportState() {
      return {
        open: openState,
        tab: currentTab,
        radiation: radiation?.exportState() ?? null,
        rect: userRect ? { ...userRect } : null,
      };
    },
    restoreState(raw) {
      const state = raw && typeof raw === "object" ? raw : null;
      if (radiation && !radiation.locked) {
        if (state?.radiation) radiation.restoreState(state.radiation);
        else if (!state || !("radiation" in state)) radiation.restoreState(null);
      }
      userRect =
        state?.rect &&
        [state.rect.left, state.rect.top, state.rect.width, state.rect.height].every(Number.isFinite)
          ? { ...state.rect }
          : null;
      const targetTab = XRD_TABS.includes(state?.tab) ? state.tab : "powder";
      if (state?.open) open(targetTab);
      else {
        close({ refocus: false });
        currentTab = targetTab;
        syncTabs();
      }
    },
    diagnostics() {
      return {
        open: openState,
        tab: currentTab,
        activeHkl: activeHkl ? [...activeHkl] : null,
        radiation: radiation?.state ?? null,
        rect: userRect ? { ...userRect } : null,
      };
    },
  };
}
