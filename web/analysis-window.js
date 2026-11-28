import { saveBlob } from "./desktop.js";
import { diffractionModule } from "./diffraction-engine.js";
import { formatMillerIndices } from "./crystal-math.js";
import { focusLauncher, floatingDialog, isFrontDialog } from "./floating-dialog.js";
import { readPowderTrace, powderFamilies } from "./powder-comparison.js";
import { powderProfile, powderProfilePeak } from "./structure-analysis.js";
import { pairName, normalizePair, pairColors, pairSegments } from "./pair-presentation.js";
import { RADIATION_LIMITS } from "./radiation.js";

const DIST_DEFAULTS = { rMin: 0, rMax: 6, tolerance: 0.001, pair: "all" };
const DIST_LIMITS = { rMin: [0, 30], rMax: [0.1, 30], tolerance: [0.00001, 0.1] };
const POWDER_DEFAULTS = { wavelength: 1.5406, twoThetaMin: 5, twoThetaMax: 90, fwhm: 0.15 };
const POWDER_LIMITS = {
  wavelength: [RADIATION_LIMITS.min, RADIATION_LIMITS.max],
  twoThetaMin: [0.1, 170],
  twoThetaMax: [0.1, 170],
  fwhm: [0, 2],
};
const ns = "http://www.w3.org/2000/svg";
const pairText = (row) => Object.entries(row.pairs).map(([pair, n]) => `${pair} ×${n}`).join(", ");
const sameHkl = (a, b) =>
  (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) ||
  (a[0] === -b[0] && a[1] === -b[1] && a[2] === -b[2]);
const hklText = (row) => {
  const sorted = [...row.hkls].sort(
    (a, b) => a.filter((v) => v < 0).length - b.filter((v) => v < 0).length || b[0] - a[0] || b[1] - a[1],
  );
  return formatMillerIndices(sorted[0]);
};

// ---- Chart math: 1-2-5 ticks and powder coordinate transforms -------------
function niceStep(span, targetCount = 6) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, targetCount);
  const base = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / base;
  return (frac <= 1.2 ? 1 : frac <= 2.5 ? 2 : frac <= 6 ? 5 : 10) * base;
}

export function niceTicks(min, max, targetCount = 6) {
  if (!(max > min)) return { major: [min], minor: [] };
  const step = niceStep(max - min, targetCount),
    eps = step * 1e-6;
  const major = [];
  for (let v = Math.ceil((min - eps) / step) * step; v <= max + eps; v += step)
    major.push(Math.abs(v) < eps ? 0 : Number(v.toPrecision(10)));
  const minorStep = step / (Math.round(step / 10 ** Math.floor(Math.log10(step))) === 2 ? 4 : 5);
  const minor = [];
  for (let v = Math.ceil((min - eps) / minorStep) * minorStep; v <= max + eps; v += minorStep)
    if (!major.some((m) => Math.abs(m - v) < minorStep * 0.2)) minor.push(Number(v.toPrecision(10)));
  return { major, minor };
}

const formatTick = (value) => (Math.abs(value) < 1e-10 ? "0" : Number(value.toPrecision(6)).toString());
const twoThetaToQ = (tt, wavelength) => (4 * Math.PI * Math.sin((tt * Math.PI) / 360)) / wavelength;
function twoThetaToD(tt, wavelength) {
  const s = Math.sin((tt * Math.PI) / 360);
  return s > 1e-9 ? wavelength / (2 * s) : Infinity;
}
const toXCoord = (tt, xMode, wavelength) =>
  xMode === "q" ? twoThetaToQ(tt, wavelength) : xMode === "d" ? twoThetaToD(tt, wavelength) : tt;
function fromXCoord(value, xMode, wavelength) {
  if (xMode === "q") return (Math.asin(Math.min(1, Math.max(0, (value * wavelength) / (4 * Math.PI)))) * 360) / Math.PI;
  if (xMode === "d") return value > 0 ? (Math.asin(Math.min(1, Math.max(0, wavelength / (2 * value)))) * 360) / Math.PI : 180;
  return value;
}
const Y_SCALES = ["linear", "sqrt", "log"];
const X_AXES = ["2theta", "d", "q"];

const EXPORT_STYLE_KEYS = [
  "fill", "stroke", "opacity", "stroke-width", "stroke-dasharray", "fill-opacity",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "paint-order",
];

function freezePlotSvg(chart) {
  const copy = chart.cloneNode(true);
  copy.setAttribute("xmlns", ns);
  const sources = [...chart.querySelectorAll("*")],
    targets = [...copy.querySelectorAll("*")];
  sources.forEach((el, i) => {
    const target = targets[i];
    if (el.closest(".analysis-crosshair, .analysis-brush")) {
      target.remove();
      return;
    }
    const style = getComputedStyle(el);
    for (const key of EXPORT_STYLE_KEYS) {
      const value = style.getPropertyValue(key);
      if (value) target.style.setProperty(key, value);
    }
  });
  copy.querySelectorAll("title").forEach((title) => title.remove());
  const box = chart.viewBox.baseVal,
    width = box.width || 640,
    height = box.height || 225;
  copy.setAttribute("width", String(Math.round(width)));
  copy.setAttribute("height", String(Math.round(height)));
  const background = document.createElementNS(ns, "rect");
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", getComputedStyle(chart).getPropertyValue("--panel").trim() || "#101e2e");
  copy.prepend(background);
  return { copy, width, height };
}

async function exportSvgPlot(chart, filename, onError) {
  const { copy } = freezePlotSvg(chart);
  try {
    await saveBlob(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }), filename);
  } catch (error) {
    onError?.(error.message);
  }
}

async function exportPngPlot(chart, filename, onError) {
  const { copy, width, height } = freezePlotSvg(chart),
    scale = 2;
  copy.setAttribute("width", String(Math.round(width * scale)));
  copy.setAttribute("height", String(Math.round(height * scale)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob) await saveBlob(blob, filename);
  } catch (error) {
    onError?.(error.message);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shared zoom/pan/brush/right-click/wheel interaction controller for SVG charts. */
function createChartInteraction(chart, { getState, getZoom, setZoomRange, redraw }) {
  let chartDrag = null,
    panFrame = 0,
    lastRightClickAt = 0;

  function cancelPan() {
    if (panFrame) {
      cancelAnimationFrame(panFrame);
      panFrame = 0;
    }
  }
  function resetZoom() {
    if (!getZoom()) return;
    setZoomRange(null);
    redraw();
  }
  function setZoom(min, max) {
    const state = getState();
    if (!state) return;
    const { fullMin, fullMax } = state;
    const span = Math.min(max - min, fullMax - fullMin);
    if (span >= (fullMax - fullMin) * 0.999) return resetZoom();
    if (min < fullMin) {
      min = fullMin;
      max = fullMin + span;
    }
    if (max > fullMax) {
      max = fullMax;
      min = fullMax - span;
    }
    setZoomRange({ min, max });
    redraw();
  }
  function zoomAbout(px, factor) {
    const state = getState();
    if (!state) return;
    const { fullMin, fullMax, viewMin, viewMax, xInv } = state;
    const span = viewMax - viewMin;
    const next = Math.max((fullMax - fullMin) * 1e-3, Math.min(fullMax - fullMin, span * factor));
    const pivot = xInv(px);
    const min = pivot - ((pivot - viewMin) / Math.max(span, 1e-12)) * next;
    setZoom(min, min + next);
  }
  const chartX = (event) => {
    const rect = chart.getBoundingClientRect();
    return ((event.clientX - rect.left) / Math.max(1, rect.width)) * (getState()?.width ?? 1);
  };

  chart?.addEventListener("contextmenu", (event) => event.preventDefault());
  chart?.addEventListener("pointerdown", (event) => {
    const state = getState();
    if (!state) return;
    const px = chartX(event);
    if (px < state.left || px > state.right) return;
    const mode = event.button === 2 ? "right" : event.button === 1 && getZoom() ? "pan" : event.button === 0 ? "brush" : null;
    if (!mode) return;
    if (mode !== "brush" || event.pointerType === "mouse" || event.pointerType === "pen") event.preventDefault();
    chart.setPointerCapture?.(event.pointerId);
    chartDrag = {
      id: event.pointerId,
      mode,
      startPx: px,
      px,
      startY: event.clientY,
      moved: false,
      start: { min: state.viewMin, max: state.viewMax },
    };
  });
  chart?.addEventListener("pointermove", (event) => {
    const state = getState();
    if (!state) return;
    const px = chartX(event);
    if (!chartDrag) {
      if (event.pointerType === "mouse") state.showCrosshair(px);
      return;
    }
    if (event.pointerId !== chartDrag.id) return;
    const { left, right, plotW, fullMin, fullMax, brush, crosshair } = state;
    chartDrag.px = Math.max(left, Math.min(right, px));
    if (Math.abs(chartDrag.px - chartDrag.startPx) >= 4 || Math.abs(event.clientY - chartDrag.startY) >= 4) chartDrag.moved = true;
    if ((chartDrag.mode === "pan" || chartDrag.mode === "right") && chartDrag.moved && getZoom()) {
      crosshair.setAttribute("display", "none");
      const span = chartDrag.start.max - chartDrag.start.min;
      let min = chartDrag.start.min - ((chartDrag.px - chartDrag.startPx) / plotW) * span;
      min = Math.max(fullMin, Math.min(fullMax - span, min));
      setZoomRange({ min, max: min + span });
      if (!panFrame)
        panFrame = requestAnimationFrame(() => {
          panFrame = 0;
          redraw();
        });
    } else if (chartDrag.mode === "brush" && Math.abs(chartDrag.px - chartDrag.startPx) >= 4) {
      crosshair.setAttribute("display", "none");
      brush.setAttribute("display", "inline");
      brush.setAttribute("x", String(Math.min(chartDrag.startPx, chartDrag.px)));
      brush.setAttribute("width", String(Math.abs(chartDrag.px - chartDrag.startPx)));
    }
  });
  function finishDrag(event, canceled) {
    if (!chartDrag || event.pointerId !== chartDrag.id) return;
    const drag = chartDrag;
    chartDrag = null;
    if (chart?.hasPointerCapture?.(drag.id)) chart.releasePointerCapture(drag.id);
    const state = getState();
    if (!state) return;
    state.brush.setAttribute("display", "none");
    if (canceled) return;
    const { fullMin, fullMax, viewMin, viewMax, xInv } = state;
    if (drag.mode === "brush") {
      if (Math.abs(drag.px - drag.startPx) < 6) return state.selectAt(drag.startPx);
      const a = xInv(Math.min(drag.startPx, drag.px)),
        b = xInv(Math.max(drag.startPx, drag.px));
      if (b - a > (fullMax - fullMin) * 1e-4) setZoom(Math.max(fullMin, a), Math.min(fullMax, b));
    } else if (drag.mode === "right" && !drag.moved) {
      const now = performance.now(),
        isDouble = now - lastRightClickAt <= 350;
      lastRightClickAt = isDouble ? 0 : now;
      if (!getZoom()) return;
      if (isDouble) return resetZoom();
      const span = viewMax - viewMin,
        pivot = xInv(drag.startPx),
        min = pivot - ((pivot - viewMin) / Math.max(span, 1e-12)) * span * 2;
      setZoom(min, min + span * 2);
    }
  }
  chart?.addEventListener("pointerup", (event) => finishDrag(event, false));
  chart?.addEventListener("pointercancel", (event) => finishDrag(event, true));
  chart?.addEventListener("pointerleave", () => {
    if (!chartDrag) getState()?.crosshair.setAttribute("display", "none");
  });
  chart?.addEventListener(
    "wheel",
    (event) => {
      const state = getState();
      if (!state) return;
      event.preventDefault();
      const rawPx = event.clientX === 0 && event.clientY === 0 ? (state.left + state.right) / 2 : chartX(event);
      const px = Math.max(state.left, Math.min(state.right, rawPx));
      zoomAbout(px, Math.exp(Math.max(-300, Math.min(300, event.deltaY)) * 0.0018));
    },
    { passive: false },
  );
  chart?.addEventListener("dblclick", resetZoom);

  return { cancelPan, resetZoom };
}

// ============================================================================
// 1. Interatomic Distances floating window (#analysis-window)
// ============================================================================
export function createAnalysisWindow({
  getStructure,
  onHighlightDistance = () => {},
  onApplyCutoff = () => {},
  getRuleCutoff = () => null,
  onDragCutoff = () => {},
  onChange = () => {},
}) {
  const $ = (id) => document.getElementById(id);
  const win = $("analysis-window"),
    opener = $("mode-analysis"),
    form = $("analysis-form");
  const chart = $("analysis-chart"),
    status = $("analysis-status"),
    table = $("analysis-table");
  const settingsDetails = $("analysis-settings");
  if (settingsDetails) settingsDetails.open = !matchMedia("(max-width: 760px), (max-height: 500px)").matches;

  const legend = document.createElement("div");
  legend.id = "analysis-legend";
  legend.className = "analysis-legend";
  legend.setAttribute("aria-label", "Atom pair colors");
  chart?.before(legend);

  const more = $("analysis-more"),
    csv = $("analysis-csv"),
    detail = $("analysis-detail");
  const zoomReset = $("analysis-zoom-reset"),
    saveSvg = $("analysis-save-svg"),
    savePng = $("analysis-save-png");
  const highlightToggle = $("dist-highlight-3d"),
    applyCutoffBtn = $("dist-apply-cutoff");

  const controls = Object.fromEntries(Object.keys(DIST_DEFAULTS).map((key) => [key, $("analysis-" + key)]));
  let worker = null,
    timer = 0,
    result = null,
    selected = -1,
    expanded = false;
  let colors = new Map();
  let zoomRange = null,
    chartState = null;

  const settings = () =>
    Object.fromEntries(
      Object.entries(controls).map(([key, field]) => [
        key,
        key === "pair" ? (field?.value ?? "all") : Number(field?.value ?? DIST_DEFAULTS[key]),
      ]),
    );

  const noteEl = $("analysis-note");
  if (noteEl) {
    noteEl.textContent =
      "Geometric pairs per unit cell, counted once. Periodic neighbors are included automatically for the distance range.";
  }

  function primaryPairFor(row) {
    const activeFilter = controls.pair?.value;
    if (activeFilter && activeFilter !== "all" && row.pairs[activeFilter]) return activeFilter;
    return Object.entries(row.pairs).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  }

  function sync3dActions() {
    const row = selected >= 0 && result ? result.rows[selected] : null;
    if (!row) {
      if (applyCutoffBtn) applyCutoffBtn.hidden = true;
      onHighlightDistance(null);
      return;
    }
    const pair = primaryPairFor(row);
    const cutoffValue = Math.ceil((row.max + 1e-4) * 100) / 100;
    if (applyCutoffBtn) {
      applyCutoffBtn.hidden = !pair;
      if (pair) applyCutoffBtn.textContent = `Apply ${cutoffValue.toFixed(2)} Å as ${pair} cutoff`;
    }
    if (highlightToggle?.checked) {
      const filterPair = controls.pair?.value;
      onHighlightDistance({
        pair: filterPair && filterPair !== "all" ? filterPair : null,
        min: row.min,
        max: row.max,
      });
    } else {
      onHighlightDistance(null);
    }
  }

  highlightToggle?.addEventListener("change", sync3dActions);
  applyCutoffBtn?.addEventListener("click", () => {
    const row = selected >= 0 && result ? result.rows[selected] : null;
    if (!row) return;
    const pair = primaryPairFor(row);
    if (!pair) return;
    const cutoff = Math.ceil((row.max + 1e-4) * 100) / 100;
    onApplyCutoff({ pair, cutoff });
  });

  function stop() {
    clearTimeout(timer);
    interaction.cancelPan();
    worker?.terminate();
    worker = null;
    win?.removeAttribute("aria-busy");
  }

  function clear() {
    result = null;
    selected = -1;
    expanded = false;
    chart?.replaceChildren();
    legend.replaceChildren();
    table?.replaceChildren();
    if (detail) detail.textContent = "";
    if (more) more.hidden = true;
    if (csv) csv.disabled = true;
    if (saveSvg) saveSvg.disabled = true;
    if (savePng) savePng.disabled = true;
    if ($("analysis-results")) $("analysis-results").hidden = true;
    sync3dActions();
  }

  function calculate() {
    stop();
    clear();
    if (!win?.open) return;
    if (form && !form.checkValidity()) {
      if (status) status.textContent = "Enter valid values in the marked fields.";
      return;
    }
    const options = settings(),
      structure = getStructure();
    if (!structure) return;
    if (status) {
      status.textContent = "Calculating…";
      status.classList.remove("error");
    }
    win.setAttribute("aria-busy", "true");
    worker = new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" });
    const active = worker;
    const fail = (message) => {
      if (worker !== active) return;
      stop();
      if (status) {
        status.textContent = message;
        status.classList.add("error");
      }
    };
    worker.onerror = () => fail("Could not start the calculation. Close and reopen this window to try again.");
    worker.onmessage = ({ data }) => {
      if (worker !== active) return;
      if (data.error) return fail(data.error);
      stop();
      result = data.result;
      if (status) {
        status.textContent = result.rows.length
          ? `${result.rows.length.toLocaleString()} distinct distances`
          : "No pairs in this range.";
        if (result.partialOccupancy)
          status.textContent += " · Partial sites count as whole geometric sites; disorder correlations are not modeled.";
      }
      if (csv) csv.disabled = !result.rows.length;
      if (saveSvg) saveSvg.disabled = !result.rows.length;
      if (savePng) savePng.disabled = !result.rows.length;
      if (detail) detail.textContent = "Select a line or table row for details.";
      if ($("analysis-results")) $("analysis-results").hidden = !result.rows.length;
      renderLegend();
      renderTable();
      draw();
    };
    worker.postMessage({ structure, mode: "distances", options });
  }

  function queue() {
    stop();
    clear();
    if (status) status.textContent = "Updating…";
    if (win?.open) timer = setTimeout(calculate, 200);
    onChange();
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  form?.addEventListener("input", queue);

  const svg = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    chart.append(el);
    return el;
  };
  const description = (row) => `${row.distance.toFixed(5)} Å · ${row.count} pairs/cell · ${pairText(row)}`;

  function select(index) {
    selected = index;
    if (detail) detail.textContent = description(result.rows[index]);
    for (const el of chart?.querySelectorAll("[data-index]") ?? [])
      el.classList.toggle("selected", Number(el.dataset.index) === index);
    for (const row of table?.querySelectorAll("tbody tr") ?? [])
      row.classList.toggle("selected", Number(row.dataset.index) === index);
    sync3dActions();
  }

  function pairTag(pair, count) {
    const tag = document.createElement("span");
    tag.className = "analysis-pair-tag";
    tag.dataset.pair = pair;
    tag.onpointerenter = () => {
      for (const line of chart?.querySelectorAll(".analysis-stick") ?? []) {
        const match = line.dataset.pair === pair;
        line.classList.toggle("dimmed", !match);
        line.classList.toggle("hovered", match);
      }
    };
    tag.onpointerleave = () => {
      for (const line of chart?.querySelectorAll(".analysis-stick") ?? []) {
        line.classList.remove("dimmed", "hovered");
      }
    };
    tag.style.setProperty("--pair-color", colors.get(pair));
    const swatch = document.createElement("span");
    swatch.className = "analysis-pair-swatch";
    swatch.setAttribute("aria-hidden", "true");
    tag.append(swatch, document.createTextNode(pair + (count == null ? "" : ` ×${count}`)));
    return tag;
  }

  function renderLegend() {
    legend.replaceChildren();
    legend.hidden = !result?.rows.length;
    if (legend.hidden) return;
    const pairs = [...new Set(result.rows.flatMap((row) => Object.keys(row.pairs)))].sort();
    legend.append(...pairs.map((pair) => pairTag(pair)));
  }

  function draw() {
    if (!chart) return;
    chart.replaceChildren();
    chartState = null;
    if (!result?.rows.length) return;
    const width = Math.max(280, Math.round(chart.clientWidth) || 320);
    const height = Math.max(160, Math.round(chart.clientHeight) || 225);
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const left = 52,
      right = width - 14,
      top = 26,
      bottom = height - 37;
    const plotW = Math.max(1, right - left),
      plotH = Math.max(1, bottom - top);
    const fullMin = result.rMin,
      fullMax = result.rMax;
    if (zoomRange && Math.min(zoomRange.max, fullMax) - Math.max(zoomRange.min, fullMin) <= (fullMax - fullMin) * 1e-3)
      zoomRange = null;
    const viewMin = zoomRange ? Math.max(fullMin, zoomRange.min) : fullMin;
    const viewMax = zoomRange ? Math.min(fullMax, Math.max(zoomRange.max, viewMin + 1e-9)) : fullMax;
    if (zoomReset) zoomReset.hidden = !zoomRange;

    const x = (v) => left + ((v - viewMin) / Math.max(viewMax - viewMin, 1e-12)) * plotW;
    const xInv = (px) => viewMin + ((px - left) / plotW) * (viewMax - viewMin);
    const maximum = result.rows.reduce((n, row) => Math.max(n, row.count), 1);
    const step = Math.max(1, niceStep(maximum, 4)),
      yMax = Math.max(step, Math.ceil(maximum / step) * step);
    const y = (v) => bottom - (v / yMax) * plotH;
    const { major: yMajor, minor: rawYMinor } = niceTicks(0, yMax, 4);
    const yMinor = rawYMinor.filter((v) => yMax / step <= 6 || v === Math.round(v));

    const defs = svg("defs", {});
    const clip = document.createElementNS(ns, "clipPath");
    clip.id = "analysis-plot-clip";
    const clipRect = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x: left, y: top - 2, width: plotW, height: plotH + 4 }))
      clipRect.setAttribute(k, v);
    clip.append(clipRect);
    defs.append(clip);

    for (const v of yMajor) {
      const py = y(v);
      if (py < top - 1 || py > bottom + 1) continue;
      svg("line", { x1: left, x2: right, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-grid" });
      svg("line", { x1: left - 4, x2: left, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-tick" });
      svg("text", { x: left - 8, y: (py + 3.5).toFixed(2), "text-anchor": "end" }, formatTick(v));
    }
    for (const v of yMinor) {
      const py = y(v);
      if (py >= top && py <= bottom)
        svg("line", { x1: left - 2.5, x2: left, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-tick minor" });
    }
    svg("line", { x1: left, x2: right, y1: bottom, y2: bottom, class: "analysis-axis" });
    svg("line", { x1: left, x2: left, y1: top, y2: bottom, class: "analysis-axis" });

    const xTicks = niceTicks(viewMin, viewMax, Math.max(4, Math.min(8, Math.floor(plotW / 72))));
    for (const v of xTicks.major) {
      const px = x(v);
      if (px < left - 1 || px > right + 1) continue;
      svg("line", { x1: px.toFixed(2), x2: px.toFixed(2), y1: bottom, y2: bottom + 5, class: "analysis-tick" });
      svg("text", { x: px.toFixed(2), y: bottom + 17, "text-anchor": "middle" }, formatTick(v));
    }
    for (const v of xTicks.minor) {
      const px = x(v);
      if (px >= left && px <= right)
        svg("line", { x1: px.toFixed(2), x2: px.toFixed(2), y1: bottom, y2: bottom + 3, class: "analysis-tick minor" });
    }
    svg("text", { x: left, y: 14, class: "analysis-axis-title" }, "Pairs / unit cell");
    svg("text", { x: (left + right) / 2, y: height - 3, "text-anchor": "middle", class: "analysis-axis-title" }, "Distance (Å)");

    const data = svg("g", { "clip-path": "url(#analysis-plot-clip)" });
    const add = (parent, tag, attrs, text) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text != null) el.textContent = text;
      parent.append(el);
      return el;
    };
    const visible = result.rows
      .map((row, index) => ({ row, index, value: row.distance }))
      .filter((item) => item.value >= viewMin && item.value <= viewMax);
    for (const { row, index, value } of visible) {
      const pos = x(value).toFixed(2);
      for (const segment of pairSegments(row)) {
        const line = add(data, "line", {
          x1: pos,
          x2: pos,
          y1: y(segment.from).toFixed(2),
          y2: y(segment.to).toFixed(2),
          class: `analysis-stick${selected === index ? " selected" : ""}`,
          "data-index": index,
        });
        line.dataset.pair = segment.pair;
        line.dataset.count = segment.count;
        line.style.setProperty("--pair-color", colors.get(segment.pair));
        add(line, "title", {}, description(row));
      }
    }

    // Draggable bond-cutoff marker when a specific pair (filtered or selected) has a bond rule
    const activePair = $("analysis-pair")?.value || (selected != null && result.rows[selected] ? primaryPair(result.rows[selected]) : null);
    const ruleCutoff = activePair ? getRuleCutoff(activePair) : null;
    if (activePair && Number.isFinite(ruleCutoff) && ruleCutoff >= viewMin && ruleCutoff <= viewMax) {
      const cx = x(ruleCutoff);
      const cutGroup = svg("g", { class: "analysis-cutoff-marker", "data-pair": activePair });
      const cutLine = add(cutGroup, "line", { x1: cx.toFixed(2), x2: cx.toFixed(2), y1: top, y2: bottom, class: "analysis-cutoff-line" });
      const handle = add(cutGroup, "rect", { x: (cx - 26).toFixed(1), y: (top - 2).toFixed(1), width: 52, height: 16, rx: 4, class: "analysis-cutoff-handle" });
      const label = add(cutGroup, "text", { x: cx.toFixed(1), y: (top + 9.5).toFixed(1), "text-anchor": "middle", class: "analysis-cutoff-text" }, `↔ ${ruleCutoff.toFixed(2)} Å`);
      let dragging = false;
      let latestVal = ruleCutoff;
      const moveCutoff = (clientX, commit) => {
        const rect = chart.getBoundingClientRect();
        const px = Math.max(left, Math.min(right, ((clientX - rect.left) / Math.max(rect.width, 1)) * width));
        latestVal = Math.max(0.1, xInv(px));
        cutLine.setAttribute("x1", px.toFixed(2));
        cutLine.setAttribute("x2", px.toFixed(2));
        handle.setAttribute("x", (px - 26).toFixed(1));
        label.setAttribute("x", px.toFixed(1));
        label.textContent = `↔ ${latestVal.toFixed(2)} Å`;
        onDragCutoff(activePair, latestVal, commit);
      };
      cutGroup.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        cutGroup.setPointerCapture?.(e.pointerId);
      });
      cutGroup.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        e.stopPropagation();
        moveCutoff(e.clientX, false);
      });
      const endCut = (e) => {
        if (!dragging) return;
        e.stopPropagation();
        dragging = false;
        moveCutoff(e.clientX, true);
      };
      cutGroup.addEventListener("pointerup", endCut);
      cutGroup.addEventListener("pointercancel", endCut);
    }

    const brush = svg("rect", { x: left, y: top, width: 0, height: plotH, class: "analysis-brush", display: "none" });
    const crosshair = svg("g", { class: "analysis-crosshair", display: "none" });
    const crossLine = add(crosshair, "line", { x1: left, x2: left, y1: top, y2: bottom, class: "analysis-crosshair-line" });
    const crossDot = add(crosshair, "circle", { cx: left, cy: bottom, r: 3.5, class: "analysis-crosshair-dot" });
    const tipBox = add(crosshair, "rect", { x: left + 6, y: top + 2, width: 140, height: 18, rx: 4, class: "analysis-crosshair-box" });
    const tipText = add(crosshair, "text", { x: left + 11, y: top + 14, class: "analysis-crosshair-text" });

    function showCrosshair(px) {
      if (px < left || px > right) {
        crosshair.setAttribute("display", "none");
        return;
      }
      let snapped = null,
        best = 22;
      for (const item of visible) {
        const d = Math.abs(x(item.value) - px);
        if (d < best) {
          best = d;
          snapped = item;
        }
      }
      let cx = px,
        cy = bottom,
        info;
      if (snapped) {
        cx = x(snapped.value);
        cy = y(snapped.row.count);
        info = `r ${snapped.row.distance.toFixed(4)} Å · ${snapped.row.count} pairs/cell · ${pairText(snapped.row)}`;
      } else {
        info = `r ${xInv(px).toFixed(3)} Å`;
      }
      crossDot.setAttribute("display", snapped ? "inline" : "none");
      crosshair.setAttribute("display", "inline");
      crossLine.setAttribute("x1", cx.toFixed(2));
      crossLine.setAttribute("x2", cx.toFixed(2));
      crossDot.setAttribute("cx", cx.toFixed(2));
      crossDot.setAttribute("cy", cy.toFixed(2));
      tipText.textContent = info;
      const textWidth = Math.min(plotW - 4, (tipText.getComputedTextLength?.() || info.length * 5.5) + 10);
      const tx = cx + textWidth + 12 <= right ? cx + 6 : Math.max(left + 2, cx - textWidth - 6);
      tipBox.setAttribute("x", tx.toFixed(1));
      tipBox.setAttribute("width", Math.ceil(textWidth).toString());
      tipText.setAttribute("x", (tx + 5).toFixed(1));
    }

    function selectAt(px) {
      if (!visible.length) return;
      const at = xInv(px);
      const nearest = visible.reduce((a, b) => (Math.abs(b.value - at) < Math.abs(a.value - at) ? b : a));
      select(nearest.index);
    }

    chartState = { width, left, right, plotW, fullMin, fullMax, viewMin, viewMax, xInv, brush, crosshair, showCrosshair, selectAt };
  }

  const interaction = createChartInteraction(chart, {
    getState: () => chartState,
    getZoom: () => zoomRange,
    setZoomRange: (r) => {
      zoomRange = r;
    },
    redraw: draw,
  });

  if (zoomReset) zoomReset.onclick = interaction.resetZoom;
  if (saveSvg) saveSvg.onclick = () => chartState && exportSvgPlot(chart, "phasesmith-distances.svg", (m) => status && (status.textContent = m));
  if (savePng) savePng.onclick = () => chartState && exportPngPlot(chart, "phasesmith-distances.png", (m) => status && (status.textContent = m));

  function renderTable() {
    if (!table) return;
    table.replaceChildren();
    if (!result?.rows.length) return;
    const head = table.createTHead().insertRow();
    for (const label of ["Distance (Å)", "Atom pairs", "Count/cell"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    }
    const body = table.createTBody();
    const rows = expanded ? result.rows : result.rows.slice(0, 10);
    rows.forEach((entry, index) => {
      const row = body.insertRow();
      row.dataset.index = index;
      row.tabIndex = 0;
      row.title = description(entry);
      row.classList.toggle("selected", index === selected);
      [entry.distance.toFixed(5), pairText(entry), entry.count].forEach((value, column) => {
        const cell = row.insertCell();
        if (column === 1) {
          for (const { pair, count } of pairSegments(entry)) {
            if (cell.childNodes.length) cell.append(" ");
            cell.append(pairTag(pair, count));
          }
        } else cell.textContent = value;
      });
      row.onclick = () => select(index);
      row.onpointerenter = () => {
        for (const el of chart?.querySelectorAll(`[data-index="${index}"]`) ?? []) el.classList.add("hovered");
      };
      row.onpointerleave = () => {
        for (const el of chart?.querySelectorAll(".hovered") ?? []) el.classList.remove("hovered");
      };
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(index);
        }
      };
    });
    if (more) {
      more.hidden = result.rows.length <= 10;
      more.textContent = expanded ? "Show first 10" : `Show all ${result.rows.length.toLocaleString()}`;
      more.setAttribute("aria-expanded", String(expanded));
    }
    const tableNote = $("analysis-table-note");
    if (tableNote) {
      tableNote.textContent =
        "Colors identify atom pairs. Coincident pairs form colored segments of one line; its total height is the count per unit cell. Distances are grouped within the tolerance and shown at their mean.";
    }
  }

  if (more)
    more.onclick = () => {
      expanded = !expanded;
      renderTable();
    };
  if (csv) {
    csv.onclick = async () => {
      if (!result?.rows.length) return;
      const rows = [
        ["distance_A", "min_A", "max_A", "pairs_per_cell", "atom_pairs"],
        ...result.rows.map((r) => [r.distance, r.min, r.max, r.count, pairText(r)]),
      ];
      const text = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      await saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), "phasesmith-distances.csv");
    };
  }

  const show = win && opener ? floatingDialog(win, opener, $("analysis-head"), close) : () => {};
  function open() {
    if (!win) return;
    if (win.open) {
      show();
      return;
    }
    show();
    opener?.setAttribute("aria-expanded", "true");
    calculate();
    onChange();
  }
  function close() {
    stop();
    onHighlightDistance(null);
    win?.close();
    opener?.setAttribute("aria-expanded", "false");
    if (opener) focusLauncher(opener);
    onChange();
  }
  if (opener) opener.onclick = () => (win?.open ? (isFrontDialog(win) ? close() : show()) : open());
  if ($("analysis-close")) $("analysis-close").onclick = close;
  if (chart) new ResizeObserver(() => { if (win?.open) draw(); }).observe(chart);

  return {
    open,
    close,
    setStructure() {
      stop();
      clear();
      const elements = [...new Set(getStructure()?.atoms.map((a) => a.element))].sort();
      const pairs = [];
      if (controls.pair) controls.pair.replaceChildren(new Option("All atom pairs", "all"));
      elements.forEach((a, i) =>
        elements.slice(i).forEach((b) => {
          pairs.push(pairName(a, b));
        }),
      );
      colors = pairColors(pairs);
      if (controls.pair) [...colors.keys()].forEach((name) => controls.pair.add(new Option(name, name)));
      if (win?.open) calculate();
    },
    exportState: () => ({ ...settings(), mode: "distances", open: Boolean(win?.open) }),
    restoreState(raw) {
      const state = raw && typeof raw === "object" ? raw : DIST_DEFAULTS;
      for (const [key, value] of Object.entries(DIST_DEFAULTS))
        if (controls[key]) controls[key].value = String(value);
      for (const [key, [min, max]] of Object.entries(DIST_LIMITS))
        if (controls[key] && Number.isFinite(state[key]) && state[key] >= min && state[key] <= max)
          controls[key].value = String(state[key]);
      const pair = normalizePair(state.pair);
      if (controls.pair && [...controls.pair.options].some((o) => o.value === pair)) controls.pair.value = pair;
      if (state.open === true && state.mode !== "powder") {
        if (win?.open) calculate();
        else open();
      } else {
        stop();
        clear();
        win?.close();
        opener?.setAttribute("aria-expanded", "false");
      }
    },
  };
}

// ============================================================================
// 2. Powder XRD tab panel inside #xrd-workspace (#xrd-panel-powder)
// ============================================================================
export function createPowderPanel({
  radiation = null,
  getStructure,
  onExplain = () => {},
  onActive = () => {},
  onChange = () => {},
}) {
  const $ = (id) => document.getElementById(id);
  const host = $("xrd-panel-powder");
  const form = $("powder-form");
  const chart = $("powder-chart");
  const status = $("powder-status");
  const table = $("powder-table");
  const more = $("powder-more");
  const csv = $("powder-csv");
  const detail = $("powder-detail");
  const yScaleSelect = $("powder-yscale");
  const xAxisSelect = $("powder-xaxis");
  const hklLabels = $("powder-hkl-labels");
  const zoomReset = $("powder-zoom-reset");
  const saveSvg = $("powder-save-svg");
  const savePng = $("powder-save-png");
  const controls = {
    twoThetaMin: $("powder-twoThetaMin"),
    twoThetaMax: $("powder-twoThetaMax"),
    fwhm: $("powder-fwhm"),
  };

  let active = false,
    dirty = true,
    worker = null,
    timer = 0,
    result = null,
    selected = -1,
    expanded = false;
  let detectorPeak = null,
    pendingHkl = null,
    observed = null,
    importVersion = 0;
  let zoomRange = null,
    chartState = null,
    profilePeakCache = null;

  const currentWavelength = () => radiation?.wavelength ?? POWDER_DEFAULTS.wavelength;
  const settings = () => ({
    wavelength: currentWavelength(),
    twoThetaMin: Number(controls.twoThetaMin?.value ?? POWDER_DEFAULTS.twoThetaMin),
    twoThetaMax: Number(controls.twoThetaMax?.value ?? POWDER_DEFAULTS.twoThetaMax),
    fwhm: Number(controls.fwhm?.value ?? POWDER_DEFAULTS.fwhm),
  });

  function setObserved(trace) {
    observed = trace;
    const removeBtn = $("powder-remove");
    if (removeBtn) removeBtn.hidden = !trace;
    const statusEl = $("powder-file-status") ?? $("powder-observed");
    if (statusEl && statusEl.tagName !== "DIV") {
      statusEl.textContent = trace
        ? trace.name + " · Orange shows measured intensity, scaled independently over the visible range."
        : "";
    }
    draw();
  }

  async function loadTraceFile(file) {
    if (!file) return;
    const version = ++importVersion;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("The measured trace exceeds 8 MiB.");
      const points = readPowderTrace(await file.text());
      if (version !== importVersion) return;
      setObserved({ name: file.name, points });
      onChange();
    } catch (error) {
      const statusEl = $("powder-file-status");
      if (version === importVersion && statusEl) statusEl.textContent = error.message;
    }
  }

  const importInput = $("powder-import");
  if (importInput) {
    importInput.onchange = async (event) => {
      await loadTraceFile(event.target.files?.[0]);
      event.target.value = "";
    };
  }
  const removeBtn = $("powder-remove");
  if (removeBtn) {
    removeBtn.onclick = () => {
      importVersion++;
      setObserved(null);
      onChange();
    };
  }
  const explainBtn = $("powder-explain");
  if (explainBtn) {
    explainBtn.onclick = () => {
      if (selected >= 0 && result) {
        const hkl = ($("powder-hkl")?.value ?? "").split(",").map(Number);
        if (hkl.length === 3 && hkl.every(Number.isFinite)) onExplain(hkl, result.wavelength);
      }
    };
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
    interaction.cancelPan();
    worker?.terminate();
    worker = null;
    host?.removeAttribute("aria-busy");
  }

  function clear() {
    result = null;
    profilePeakCache = null;
    selected = -1;
    expanded = false;
    chart?.replaceChildren();
    table?.replaceChildren();
    if (detail) detail.textContent = "";
    if ($("powder-family")) $("powder-family").hidden = true;
    if (more) more.hidden = true;
    if (csv) csv.disabled = true;
    if (saveSvg) saveSvg.disabled = true;
    if (savePng) savePng.disabled = true;
    if ($("powder-results")) $("powder-results").hidden = true;
  }

  function calculate() {
    stop();
    clear();
    if (!active) {
      dirty = true;
      return;
    }
    if (form && !form.checkValidity()) {
      if (status) status.textContent = "Enter valid values in the marked fields.";
      return;
    }
    const options = settings(),
      structure = getStructure();
    if (!structure) return;
    if (options.fwhm > 0 && options.fwhm < 0.01) {
      if (status) status.textContent = "Use a peak width of at least 0.01°, or 0 for sticks.";
      return;
    }
    dirty = false;
    if (status) {
      status.textContent = "Calculating…";
      status.classList.remove("error");
    }
    host?.setAttribute("aria-busy", "true");
    worker = new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" });
    const current = worker;
    const fail = (message) => {
      if (worker !== current) return;
      stop();
      if (status) {
        status.textContent = message;
        status.classList.add("error");
      }
    };
    worker.onerror = () => fail("Could not start the calculation. Reopen XRD to try again.");
    worker.onmessage = ({ data }) => {
      if (worker !== current) return;
      if (data.error) return fail(data.error);
      stop();
      result = data.result;
      if (status) {
        status.textContent = result.rows.length
          ? `${result.rows.length.toLocaleString()} powder lines`
          : "No reflections in this range.";
        if (result.partialOccupancy)
          status.textContent += " · Partial sites count as whole geometric sites; disorder correlations are not modeled.";
      }
      if (csv) csv.disabled = !result.rows.length;
      if (saveSvg) saveSvg.disabled = !result.rows.length && !observed;
      if (savePng) savePng.disabled = !result.rows.length && !observed;
      if (detail) detail.textContent = "Select a line or table row for details.";
      if ($("powder-results")) $("powder-results").hidden = !result.rows.length && !observed;
      renderTable();
      draw();
      if (pendingHkl) {
        const target = pendingHkl;
        pendingHkl = null;
        selectByHkl(target);
      } else {
        highlightDetectorPeak();
      }
    };
    worker.postMessage({ structure, mode: "powder", options, diffractionModule });
  }

  function queue() {
    stop();
    clear();
    dirty = true;
    if (active) {
      if (status) status.textContent = "Updating…";
      timer = setTimeout(calculate, 200);
    }
    onChange();
  }

  radiation?.subscribe(() => {
    if (active) queue();
    else dirty = true;
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    calculate();
  });
  form?.addEventListener("input", queue);

  const svg = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    chart.append(el);
    return el;
  };
  const description = (row) =>
    `${row.twoTheta.toFixed(4)}° · d = ${row.d.toFixed(5)} Å · I = ${row.intensity.toFixed(2)} · (${hklText(row)}) · multiplicity ${row.multiplicity}`;

  function select(index, { notify = true } = {}) {
    if (!result || index < 0 || index >= result.rows.length) return;
    selected = index;
    const row = result.rows[index];
    if (detail) detail.textContent = description(row);
    if ($("powder-family")) $("powder-family").hidden = false;
    const families = powderFamilies(row.hkls, getStructure()?.symmetryOperations);
    if ($("powder-hkl")) {
      $("powder-hkl").replaceChildren(...families.map((h) => new Option("(" + formatMillerIndices(h) + ")", h.join())));
    }
    for (const el of chart?.querySelectorAll("[data-index]") ?? [])
      el.classList.toggle("selected", Number(el.dataset.index) === index);
    for (const tr of table?.querySelectorAll("tbody tr") ?? [])
      tr.classList.toggle("selected", Number(tr.dataset.index) === index);
    if (notify && families[0]) onActive(families[0], "powder", { d: row.d, twoTheta: row.twoTheta });
  }

  function selectByHkl(hkl) {
    if (!result?.rows.length || !Array.isArray(hkl)) return false;
    const index = result.rows.findIndex((row) => row.hkls.some((candidate) => sameHkl(candidate, hkl)));
    if (index >= 0) {
      select(index, { notify: false });
      return true;
    }
    clearHighlight();
    if (detail) detail.textContent = `(${formatMillerIndices(hkl)}) is outside the calculated powder range.`;
    return false;
  }

  function clearHighlight() {
    if ($("powder-family")) $("powder-family").hidden = true;
    selected = -1;
    chart?.querySelectorAll(".selected").forEach((line) => line.classList.remove("selected"));
    table?.querySelectorAll(".selected").forEach((row) => row.classList.remove("selected"));
    if (detail) detail.textContent = "Select a line or table row for details.";
  }

  function highlightDetectorPeak() {
    if (!active || !detectorPeak || !result) return;
    if (Math.abs(result.wavelength - detectorPeak.wavelength) > 1e-4) {
      if (radiation && Math.abs(radiation.wavelength - detectorPeak.wavelength) <= 1e-4) return;
      clearHighlight();
      if (detail) detail.textContent = "The detector uses a different wavelength.";
      return;
    }
    const index = result.rows.findIndex((row) => Math.abs(row.twoTheta - detectorPeak.twoTheta) <= 1.01e-5);
    if (index >= 0) select(index, { notify: false });
    else {
      clearHighlight();
      if (detail) detail.textContent = "The detector reflection is outside the calculated powder lines.";
    }
  }

  function draw() {
    if (!chart) return;
    chart.replaceChildren();
    chartState = null;
    if (!result) return;
    if ($("powder-results")) $("powder-results").hidden = !result.rows.length && !observed;
    if (!result.rows.length && !observed) return;

    const width = Math.max(280, Math.round(chart.clientWidth) || 320);
    const height = Math.max(160, Math.round(chart.clientHeight) || 225);
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const left = 52,
      right = width - 14,
      top = 26,
      bottom = height - 37;
    const plotW = Math.max(1, right - left),
      plotH = Math.max(1, bottom - top);
    const lambda = result.wavelength;
    const xMode = xAxisSelect?.value || "2theta";
    const yMode = yScaleSelect?.value || "linear";
    const xOf = (row) => toXCoord(row.twoTheta, xMode, lambda);

    let fullMin = toXCoord(result.twoThetaMin, xMode, lambda);
    let fullMax = toXCoord(result.twoThetaMax, xMode, lambda);
    if (fullMin > fullMax) [fullMin, fullMax] = [fullMax, fullMin];
    if (!Number.isFinite(fullMax)) fullMax = Math.max(fullMin + 1, ...result.rows.map(xOf).filter(Number.isFinite)) * 1.05;
    if (zoomRange && Math.min(zoomRange.max, fullMax) - Math.max(zoomRange.min, fullMin) <= (fullMax - fullMin) * 1e-3)
      zoomRange = null;
    const viewMin = zoomRange ? Math.max(fullMin, zoomRange.min) : fullMin;
    const viewMax = zoomRange ? Math.min(fullMax, Math.max(zoomRange.max, viewMin + 1e-9)) : fullMax;
    if (zoomReset) zoomReset.hidden = !zoomRange;

    const x = (v) => left + ((v - viewMin) / Math.max(viewMax - viewMin, 1e-12)) * plotW;
    const xInv = (px) => viewMin + ((px - left) / plotW) * (viewMax - viewMin);

    const measured = observed
      ? observed.points
          .filter(([a]) => result.twoThetaMin <= a && a <= result.twoThetaMax)
          .map(([a, b]) => [toXCoord(a, xMode, lambda), b, a])
          .filter(([v]) => Number.isFinite(v))
          .sort((p, q) => p[0] - q[0])
      : [];
    const peak = measured.reduce((m, p) => Math.max(m, Math.abs(p[1])), 0);

    let y, yMajor, yMinor, yTitle;
    if (yMode === "log") {
      y = (v) => bottom - ((Math.log10(Math.max(0.1, v)) + 1) / 3) * plotH;
      yMajor = [0.1, 1, 10, 100];
      yMinor = [1, 10]
        .flatMap((scale) => [2, 3, 4, 5, 6, 7, 8, 9].map((n) => (n * scale) / 10))
        .concat([20, 30, 40, 50, 60, 70, 80, 90]);
      yTitle = "Relative intensity (log scale)";
    } else if (yMode === "sqrt") {
      y = (v) => bottom - (Math.sqrt(Math.max(0, v)) / 10) * plotH;
      yMajor = [0, 1, 5, 10, 25, 50, 100];
      yMinor = [];
      yTitle = "Relative intensity (√ scale)";
    } else {
      const lowest = peak ? measured.reduce((m, p) => Math.min(m, (100 * p[1]) / peak), 0) : 0;
      const yMin = lowest < 0 ? Math.floor(lowest / 10) * 10 : 0;
      y = (v) => bottom - ((v - yMin) / (100 - yMin)) * plotH;
      ({ major: yMajor, minor: yMinor } = niceTicks(yMin, 100, 4));
      yTitle = "Relative intensity";
    }

    const defs = svg("defs", {});
    const clip = document.createElementNS(ns, "clipPath");
    clip.id = "powder-plot-clip";
    const clipRect = document.createElementNS(ns, "rect");
    for (const [k, v] of Object.entries({ x: left, y: top - 2, width: plotW, height: plotH + 4 }))
      clipRect.setAttribute(k, v);
    clip.append(clipRect);
    defs.append(clip);

    for (const v of yMajor) {
      const py = y(v);
      if (py < top - 1 || py > bottom + 1) continue;
      svg("line", { x1: left, x2: right, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-grid" });
      svg("line", { x1: left - 4, x2: left, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-tick" });
      svg("text", { x: left - 8, y: (py + 3.5).toFixed(2), "text-anchor": "end" }, formatTick(v));
    }
    for (const v of yMinor) {
      const py = y(v);
      if (py >= top && py <= bottom)
        svg("line", { x1: left - 2.5, x2: left, y1: py.toFixed(2), y2: py.toFixed(2), class: "analysis-tick minor" });
    }
    svg("line", { x1: left, x2: right, y1: bottom, y2: bottom, class: "analysis-axis" });
    svg("line", { x1: left, x2: left, y1: top, y2: bottom, class: "analysis-axis" });

    const xTicks = niceTicks(viewMin, viewMax, Math.max(4, Math.min(8, Math.floor(plotW / 72))));
    for (const v of xTicks.major) {
      const px = x(v);
      if (px < left - 1 || px > right + 1) continue;
      svg("line", { x1: px.toFixed(2), x2: px.toFixed(2), y1: bottom, y2: bottom + 5, class: "analysis-tick" });
      svg("text", { x: px.toFixed(2), y: bottom + 17, "text-anchor": "middle" }, formatTick(v));
    }
    for (const v of xTicks.minor) {
      const px = x(v);
      if (px >= left && px <= right)
        svg("line", { x1: px.toFixed(2), x2: px.toFixed(2), y1: bottom, y2: bottom + 3, class: "analysis-tick minor" });
    }
    svg("text", { x: left, y: 14, class: "analysis-axis-title" }, yTitle);
    svg(
      "text",
      { x: (left + right) / 2, y: height - 3, "text-anchor": "middle", class: "analysis-axis-title" },
      xMode === "q" ? "Q (Å⁻¹)" : xMode === "d" ? "d (Å)" : "2θ (°)",
    );

    const data = svg("g", { "clip-path": "url(#powder-plot-clip)" });
    const add = (parent, tag, attrs, text) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      if (text != null) el.textContent = text;
      parent.append(el);
      return el;
    };

    const fwhm = Number(controls.fwhm?.value ?? POWDER_DEFAULTS.fwhm);
    if (fwhm > 0) {
      if (!profilePeakCache || profilePeakCache.result !== result || profilePeakCache.fwhm !== fwhm) {
        profilePeakCache = {
          result,
          fwhm,
          peak: powderProfilePeak(result.rows, result.twoThetaMin, result.twoThetaMax, fwhm),
        };
      }
      const a = fromXCoord(viewMin, xMode, lambda),
        b = fromXCoord(viewMax, xMode, lambda);
      const from = Math.max(result.twoThetaMin, Math.min(a, b) - 3 * fwhm),
        to = Math.min(result.twoThetaMax, Math.max(a, b) + 3 * fwhm);
      const profile =
        to > from
          ? powderProfile(result.rows, from, to, fwhm, undefined, profilePeakCache.peak)
              .map(([tt, v]) => [toXCoord(tt, xMode, lambda), v])
              .filter(([v]) => Number.isFinite(v))
              .sort((p, q) => p[0] - q[0])
          : [];
      if (profile.length) {
        add(data, "path", {
          d: profile.map(([u, v], i) => `${i ? "L" : "M"}${x(u).toFixed(2)},${y(v).toFixed(2)}`).join(" "),
          class: "analysis-profile",
        });
      }
    }

    const visible = result.rows
      .map((row, index) => ({ row, index, value: xOf(row) }))
      .filter((item) => item.value >= viewMin && item.value <= viewMax);
    const base = yMode === "log" ? bottom : y(0);
    for (const { row, index, value } of visible) {
      const pos = x(value).toFixed(2);
      const line = add(data, "line", {
        x1: pos,
        x2: pos,
        y1: base.toFixed(2),
        y2: y(row.intensity).toFixed(2),
        class: `analysis-stick${selected === index ? " selected" : ""}${fwhm > 0 ? " subdued" : ""}`,
        "data-index": index,
      });
      add(line, "title", {}, description(row));
    }

    const shown = measured.filter(([v]) => v >= viewMin && v <= viewMax);
    if (shown.length) {
      add(data, "path", {
        d: shown.map(([u, v], i) => (i ? "L" : "M") + x(u).toFixed(2) + "," + y(peak ? (100 * v) / peak : 0).toFixed(2)).join(" "),
        class: "analysis-observed-line",
      });
    }

    if (hklLabels ? hklLabels.checked : true) {
      const boxes = [];
      const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      for (const { row, index, value } of [...visible]
        .filter((item) => item.row.intensity >= 2)
        .sort((a, b) => b.row.intensity - a.row.intensity)
        .slice(0, 32)) {
        if (boxes.length >= 16) break;
        const label = `(${hklText(row)})`,
          stickX = x(value),
          stickTop = y(row.intensity),
          half = (label.length * 5.6 + 6) / 2;
        let placed = null;
        const offsets = [
          [0, 0], [0, -13], [-14, -13], [14, -13],
          [0, -26], [-22, -26], [22, -26], [0, -39],
        ];
        for (const [dx, dy] of offsets) {
          const lx = stickX + dx;
          const ly = Math.max(top + 10, stickTop - 6 + dy);
          const box = { x1: lx - half, x2: lx + half, y1: ly - 10, y2: ly + 2 };
          if (box.x1 < left + 2 || box.x2 > right - 2 || box.y1 < top - 2) continue;
          if (boxes.some((b) => overlaps(box, b))) continue;
          placed = { lx, ly, box };
          break;
        }
        if (!placed) continue;
        boxes.push(placed.box);
        if (Math.abs(placed.lx - stickX) > 2 || stickTop - placed.ly > 10) {
          svg("line", {
            x1: stickX.toFixed(1),
            y1: Math.max(top, stickTop - 2).toFixed(1),
            x2: placed.lx.toFixed(1),
            y2: (placed.ly + 2).toFixed(1),
            class: "analysis-hkl-leader",
            "data-index": index,
          });
        }
        svg("text", { x: placed.lx.toFixed(1), y: placed.ly.toFixed(1), "text-anchor": "middle", class: "analysis-hkl-label", "data-index": index }, label);
      }
    }

    const brush = svg("rect", { x: left, y: top, width: 0, height: plotH, class: "analysis-brush", display: "none" });
    const crosshair = svg("g", { class: "analysis-crosshair", display: "none" });
    const crossLine = add(crosshair, "line", { x1: left, x2: left, y1: top, y2: bottom, class: "analysis-crosshair-line" });
    const crossDot = add(crosshair, "circle", { cx: left, cy: bottom, r: 3.5, class: "analysis-crosshair-dot" });
    const tipBox = add(crosshair, "rect", { x: left + 6, y: top + 2, width: 140, height: 18, rx: 4, class: "analysis-crosshair-box" });
    const tipText = add(crosshair, "text", { x: left + 11, y: top + 14, class: "analysis-crosshair-text" });

    function showCrosshair(px) {
      if (px < left || px > right) {
        crosshair.setAttribute("display", "none");
        return;
      }
      let snapped = null,
        best = 22;
      for (const item of visible) {
        const d = Math.abs(x(item.value) - px);
        if (d < best) {
          best = d;
          snapped = item;
        }
      }
      let cx = px,
        cy = bottom,
        info;
      if (snapped) {
        const r = snapped.row;
        cx = x(snapped.value);
        cy = y(r.intensity);
        info = `(${hklText(r)}) · 2θ ${r.twoTheta.toFixed(3)}° · d ${r.d.toFixed(4)} Å · Q ${twoThetaToQ(r.twoTheta, lambda).toFixed(3)} Å⁻¹ · I ${r.intensity.toFixed(1)}%`;
      } else {
        const tt = fromXCoord(xInv(px), xMode, lambda),
          d = twoThetaToD(tt, lambda);
        info = `2θ ${tt.toFixed(3)}° · d ${Number.isFinite(d) ? d.toFixed(4) : "—"} Å · Q ${twoThetaToQ(tt, lambda).toFixed(3)} Å⁻¹`;
      }
      crossDot.setAttribute("display", snapped ? "inline" : "none");
      crosshair.setAttribute("display", "inline");
      crossLine.setAttribute("x1", cx.toFixed(2));
      crossLine.setAttribute("x2", cx.toFixed(2));
      crossDot.setAttribute("cx", cx.toFixed(2));
      crossDot.setAttribute("cy", cy.toFixed(2));
      tipText.textContent = info;
      const textWidth = Math.min(plotW - 4, (tipText.getComputedTextLength?.() || info.length * 5.5) + 10);
      const tx = cx + textWidth + 12 <= right ? cx + 6 : Math.max(left + 2, cx - textWidth - 6);
      tipBox.setAttribute("x", tx.toFixed(1));
      tipBox.setAttribute("width", Math.ceil(textWidth).toString());
      tipText.setAttribute("x", (tx + 5).toFixed(1));
    }

    function selectAt(px) {
      const at = xInv(px);
      if (visible.length) {
        const nearest = visible.reduce((a, b) => (Math.abs(b.value - at) < Math.abs(a.value - at) ? b : a));
        select(nearest.index);
        if (measured.length && detail) {
          const sample = measured.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a));
          detail.textContent +=
            " · Measured " +
            sample[2].toFixed(4) +
            "° · intensity " +
            sample[1] +
            " · Δ2θ " +
            (sample[2] - nearest.row.twoTheta).toFixed(4) +
            "°";
        }
      } else if (measured.length && detail) {
        const sample = measured.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a));
        detail.textContent = "Measured " + sample[2].toFixed(4) + "° · intensity " + sample[1] + " · No calculated line in range.";
      }
    }

    chartState = { width, left, right, plotW, fullMin, fullMax, viewMin, viewMax, xInv, brush, crosshair, showCrosshair, selectAt };
  }

  const interaction = createChartInteraction(chart, {
    getState: () => chartState,
    getZoom: () => zoomRange,
    setZoomRange: (r) => {
      zoomRange = r;
    },
    redraw: draw,
  });

  if (zoomReset) zoomReset.onclick = interaction.resetZoom;
  if (yScaleSelect) yScaleSelect.onchange = () => { draw(); onChange(); };
  if (xAxisSelect) xAxisSelect.onchange = () => { zoomRange = null; draw(); onChange(); };
  if (hklLabels) hklLabels.onchange = () => { draw(); onChange(); };
  if (saveSvg) saveSvg.onclick = () => chartState && exportSvgPlot(chart, "phasesmith-powder.svg", (m) => status && (status.textContent = m));
  if (savePng) savePng.onclick = () => chartState && exportPngPlot(chart, "phasesmith-powder.png", (m) => status && (status.textContent = m));

  function renderTable() {
    if (!table) return;
    table.replaceChildren();
    if (!result?.rows.length) return;
    const head = table.createTHead().insertRow();
    for (const label of ["2θ (°)", "d (Å)", "h k l", "I (%)"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    }
    const body = table.createTBody();
    const rows = expanded ? result.rows : result.rows.slice(0, 10);
    rows.forEach((entry, index) => {
      const row = body.insertRow();
      row.dataset.index = index;
      row.tabIndex = 0;
      row.title = description(entry);
      row.classList.toggle("selected", index === selected);
      [entry.twoTheta.toFixed(3), entry.d.toFixed(5), hklText(entry), entry.intensity.toFixed(2)].forEach((value) => {
        row.insertCell().textContent = value;
      });
      row.onclick = () => select(index);
      row.onpointerenter = () => {
        for (const el of chart?.querySelectorAll(`[data-index="${index}"]`) ?? []) el.classList.add("hovered");
      };
      row.onpointerleave = () => {
        for (const el of chart?.querySelectorAll(".hovered") ?? []) el.classList.remove("hovered");
      };
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(index);
        }
      };
    });
    if (more) {
      more.hidden = result.rows.length <= 10;
      more.textContent = expanded ? "Show first 10" : `Show all ${result.rows.length.toLocaleString()}`;
      more.setAttribute("aria-expanded", String(expanded));
    }
    const tableNote = $("powder-table-note");
    if (tableNote) {
      tableNote.textContent =
        "Integrated intensities, strongest line = 100. One representative hkl is shown; overlapping reflections are summed.";
    }
  }

  if (more)
    more.onclick = () => {
      expanded = !expanded;
      renderTable();
    };
  if (csv) {
    csv.onclick = async () => {
      if (!result?.rows.length) return;
      const rows = [
        ["two_theta_deg", "d_A", "relative_integrated_intensity", "multiplicity", "hkls_Friedel_mates_implied", "wavelength_A"],
        ...result.rows.map((r) => [
          r.twoTheta,
          r.d,
          r.intensity,
          r.multiplicity,
          r.hkls.map((h) => h.join(" ")).join("; "),
          result.wavelength,
        ]),
      ];
      const text = rows.map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      await saveBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), "phasesmith-powder.csv");
    };
  }

  if (chart) new ResizeObserver(() => { if (active && result) draw(); }).observe(chart);

  function activate(handoff = null) {
    active = true;
    if (handoff?.hkl) pendingHkl = [...handoff.hkl];
    if (dirty || !result) {
      calculate();
    } else if (pendingHkl) {
      const target = pendingHkl;
      pendingHkl = null;
      selectByHkl(target);
      draw();
    } else {
      draw();
    }
  }

  function deactivate() {
    active = false;
    stop();
  }

  return {
    activate,
    deactivate,
    loadTraceFile,
    selectDetectorPeak(peak) {
      const previous = detectorPeak;
      detectorPeak = peak;
      if (!active) return;
      if (!peak) {
        if (previous) clearHighlight();
        return;
      }
      const [minWave, maxWave] = POWDER_LIMITS.wavelength;
      if (peak.wavelength < minWave || peak.wavelength > maxWave) {
        highlightDetectorPeak();
        return;
      }
      const options = settings();
      if (controls.twoThetaMin && peak.twoTheta < options.twoThetaMin)
        controls.twoThetaMin.value = Math.max(POWDER_LIMITS.twoThetaMin[0], Math.floor(peak.twoTheta));
      if (controls.twoThetaMax && peak.twoTheta > options.twoThetaMax)
        controls.twoThetaMax.value = Math.ceil(peak.twoTheta);
      if (
        Math.abs(options.wavelength - peak.wavelength) > 1e-4 ||
        (controls.twoThetaMin && options.twoThetaMin !== Number(controls.twoThetaMin.value)) ||
        (controls.twoThetaMax && options.twoThetaMax !== Number(controls.twoThetaMax.value))
      ) {
        queue();
      } else {
        highlightDetectorPeak();
      }
    },
    setStructure() {
      detectorPeak = null;
      pendingHkl = null;
      importVersion++;
      setObserved(null);
      stop();
      clear();
      dirty = true;
      if (active) calculate();
    },
    exportState: () => ({
      ...settings(),
      yScale: yScaleSelect?.value || "linear",
      xAxis: xAxisSelect?.value || "2theta",
      hklLabels: hklLabels ? hklLabels.checked : true,
      observed,
    }),
    restoreState(raw) {
      const state = raw && typeof raw === "object" ? raw : POWDER_DEFAULTS;
      for (const key of ["twoThetaMin", "twoThetaMax", "fwhm"]) {
        if (controls[key]) controls[key].value = String(POWDER_DEFAULTS[key]);
      }
      for (const key of ["twoThetaMin", "twoThetaMax", "fwhm"]) {
        const [min, max] = POWDER_LIMITS[key];
        if (controls[key] && Number.isFinite(state[key]) && state[key] >= min && state[key] <= max)
          controls[key].value = String(state[key]);
      }
      if (yScaleSelect) yScaleSelect.value = Y_SCALES.includes(state.yScale) ? state.yScale : "linear";
      if (xAxisSelect) xAxisSelect.value = X_AXES.includes(state.xAxis) ? state.xAxis : "2theta";
      if (hklLabels) hklLabels.checked = state.hklLabels !== false;
      zoomRange = null;
      importVersion++;
      const trace = state.observed;
      setObserved(
        trace &&
          typeof trace.name === "string" &&
          Array.isArray(trace.points) &&
          trace.points.length >= 2 &&
          trace.points.length <= 100000 &&
          trace.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 180)
          ? trace
          : null,
      );
      dirty = true;
      if (active) calculate();
    },
  };
}
