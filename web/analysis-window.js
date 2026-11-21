import { diffractionModule } from "./diffraction-engine.js";
import { formatMillerIndices } from "./crystal-math.js";
import { focusLauncher, floatingDialog, isFrontDialog } from "./floating-dialog.js";
import { readPowderTrace, powderFamilies } from "./powder-comparison.js";
import { powderProfile } from "./structure-analysis.js";
import { pairName, normalizePair, pairColors, pairSegments } from "./pair-presentation.js";

const DEFAULTS = { mode: "distances", rMin: 0, rMax: 6, tolerance: 0.001, pair: "all", wavelength: 1.5406, twoThetaMin: 5, twoThetaMax: 90, fwhm: 0.15 };
const LIMITS = { rMin: [0, 30], rMax: [0.1, 30], tolerance: [0.00001, 0.1], wavelength: [0.1, 3], twoThetaMin: [0.1, 170], twoThetaMax: [0.1, 170], fwhm: [0, 2] };
const ns = "http://www.w3.org/2000/svg";
const pairText = row => Object.entries(row.pairs).map(([pair, n]) => `${pair} ×${n}`).join(", ");
const hklText = row => {
  // Prefer the conventional positive representative for the table. The full
  // enumerated reciprocal-vector list, with ± mates implied, stays in the CSV.
  const sorted = [...row.hkls].sort((a, b) => a.filter(v => v < 0).length - b.filter(v => v < 0).length || b[0] - a[0] || b[1] - a[1]);
  return formatMillerIndices(sorted[0]);
};

export function createAnalysisWindow({ getStructure, onExplain, onChange = () => {} }) {
  const $ = id => document.getElementById(id);
  const win = $("analysis-window"), opener = $("mode-analysis"), form = $("analysis-form");
  const powderOpener = $("mode-powder");
  let lastOpener = opener;
  const chart = $("analysis-chart"), status = $("analysis-status"), table = $("analysis-table");
  $("analysis-settings").open = !matchMedia("(max-width: 760px), (max-height: 500px)").matches;
  $("analysis-results").after($("analysis-observed"), $("analysis-note"));

  const legend = document.createElement("div");
  legend.id = "analysis-legend";
  legend.className = "analysis-legend";
  legend.setAttribute("aria-label", "Atom pair colors");
  chart.before(legend);
  const more = $("analysis-more"), csv = $("analysis-csv"), detail = $("analysis-detail");
  const controls = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, $("analysis-" + key)]));
  let worker = null, timer = 0, result = null, resultMode = null, selected = -1, expanded = false;
  let detectorPeak = null;
  let colors = new Map();
  const settings = () => Object.fromEntries(Object.entries(controls).map(([key, field]) => [key, key === "mode" || key === "pair" ? field.value : Number(field.value)]));

  let observed = null, importVersion = 0;
  function setObserved(trace) {
    observed = trace;
    $("analysis-remove").hidden = !trace;
    $("analysis-file-status").textContent = trace ? trace.name + " · Orange shows measured intensity, scaled independently over the visible range." : "";
    draw();
  }
  $("analysis-file").onchange = async event => {
    const version = ++importVersion, file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("The measured trace exceeds 8 MiB.");
      const points = readPowderTrace(await file.text());
      if (version !== importVersion) return;
      setObserved({name:file.name, points});
      onChange();
    } catch (error) {
      if (version === importVersion) $("analysis-file-status").textContent = error.message;
    } finally { if (version === importVersion) event.target.value = ""; }
  };
  $("analysis-remove").onclick = () => { importVersion++; setObserved(null); onChange(); };
  $("analysis-explain").onclick = () => {
    if (resultMode === "powder" && selected >= 0)
      onExplain($("analysis-hkl").value.split(",").map(Number), result.wavelength);
  };
  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    win.removeAttribute("aria-busy");
  }
  function clear() {
    result = null;
    selected = -1;
    expanded = false;
    chart.replaceChildren();
    legend.replaceChildren();
    table.replaceChildren();
    detail.textContent = "";
    $("analysis-family").hidden = true;
    more.hidden = true;
    csv.disabled = true;
    $("analysis-results").hidden = true;
  }
  function updateMode() {
    const distance = controls.mode.value === "distances";
    $("analysis-title").textContent = distance ? "Interatomic distances" : "Powder diffraction";
    opener.setAttribute("aria-expanded", String(win.open && distance));
    powderOpener.setAttribute("aria-expanded", String(win.open && !distance));
    lastOpener = distance ? opener : powderOpener;
    $("analysis-distance-fields").hidden = !distance;
    $("analysis-powder-fields").hidden = distance;
    $("analysis-observed").hidden = distance;
    for (const field of $("analysis-distance-fields").querySelectorAll("input, select")) field.disabled = !distance;
    for (const field of $("analysis-powder-fields").querySelectorAll("input, select")) field.disabled = distance;
    $("analysis-note").textContent = distance
      ? "Geometric pairs per unit cell, counted once. Periodic neighbors are included automatically for the distance range."
      : "PhaseSmith X-ray powder pattern: neutral-atom form factors, occupancies and powder Lorentz–polarization correction. CIF displacement parameters included where available. Anomalous scattering, texture and instrument response omitted.";
  }
  function calculate() {
    stop();
    clear();
    if (!win.open) return;
    updateMode();
    if (!form.checkValidity()) {
      status.textContent = "Enter valid values in the marked fields.";
      return;
    }
    const options = settings(), structure = getStructure();
    if (options.mode === "powder" && options.fwhm > 0 && options.fwhm < 0.01) {
      status.textContent = "Use a peak width of at least 0.01°, or 0 for sticks.";
      return;
    }
    status.textContent = "Calculating…";
    status.classList.remove("error");
    win.setAttribute("aria-busy", "true");
    const start = performance.now();
    // A fresh worker also cancels any outdated computation immediately.
    worker = new Worker(new URL("./analysis-worker.js", import.meta.url), { type: "module" });
    const active = worker;
    const fail = message => {
      if (worker !== active) return;
      stop();
      status.textContent = message;
      status.classList.add("error");
    };
    worker.onerror = () => fail("Could not start the calculation. Close and reopen this window to try again.");
    worker.onmessage = ({ data }) => {
      if (worker !== active) return;
      if (data.error) return fail(data.error);
      stop();
      result = data.result;
      resultMode = options.mode;
      status.textContent = result.rows.length
        ? `${result.rows.length.toLocaleString()} ${resultMode === "distances" ? "distinct distances" : "powder lines"}`
        : "No pairs or reflections in this range.";
      if (result.partialOccupancy) status.textContent += " · Partial sites count as whole geometric sites; disorder correlations are not modeled.";
      csv.disabled = !result.rows.length;
      detail.textContent = "Select a line or table row for details.";
      $("analysis-results").hidden = !result.rows.length;
      renderLegend();
      renderTable();
      draw();
      highlightDetectorPeak();
    };
    worker.postMessage({ structure, mode: options.mode, options, diffractionModule: options.mode === "powder" ? diffractionModule : undefined });
  }

  function queue() {
    stop();
    clear();
    updateMode();
    status.textContent = "Updating…";
    if (win.open) timer = setTimeout(calculate, 200);
    onChange();
  }
  form.addEventListener("submit", event => { event.preventDefault(); calculate(); });
  form.addEventListener("input", queue);

  function svg(tag, attrs, text) {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    chart.append(el);
    return el;
  }
  function description(row) {
    return resultMode === "distances"
      ? `${row.distance.toFixed(5)} Å · ${row.count} pairs/cell · ${pairText(row)}`
      : `${row.twoTheta.toFixed(4)}° · d = ${row.d.toFixed(5)} Å · I = ${row.intensity.toFixed(2)} · (${hklText(row)}) · multiplicity ${row.multiplicity}`;
  }
  function select(index) {
    selected = index;
    detail.textContent = description(result.rows[index]);
    $("analysis-family").hidden = resultMode !== "powder";
    if (resultMode === "powder") {
      const families = powderFamilies(result.rows[index].hkls, getStructure().symmetryOperations);
      $("analysis-hkl").replaceChildren(...families.map(h => new Option("(" + formatMillerIndices(h) + ")", h.join())));
    }
    for (const el of chart.querySelectorAll("[data-index]")) el.classList.toggle("selected", Number(el.dataset.index) === index);
    for (const row of table.querySelectorAll("tbody tr")) row.classList.toggle("selected", Number(row.dataset.index) === index);
  }
  function clearHighlight() {
    $("analysis-family").hidden = true;
    selected = -1;
    chart.querySelectorAll(".selected").forEach(line => line.classList.remove("selected"));
    table.querySelectorAll(".selected").forEach(row => row.classList.remove("selected"));
    detail.textContent = "Select a line or table row for details.";
  }
  function highlightDetectorPeak() {
    if (!win.open || !detectorPeak || !result || resultMode !== "powder") return;
    if (Math.abs(result.wavelength - detectorPeak.wavelength) > 1e-9) {
      clearHighlight();
      detail.textContent = "The detector uses a different wavelength.";
      return;
    }
    const index = result.rows.findIndex(row => Math.abs(row.twoTheta - detectorPeak.twoTheta) <= 1.01e-5);
    if (index >= 0) select(index);
    else {
      clearHighlight();
      detail.textContent = "The detector reflection is outside the calculated powder lines.";
    }
  }
  function pairTag(pair, count) {
    const tag = document.createElement("span");
    tag.className = "analysis-pair-tag";
    tag.dataset.pair = pair;
    tag.style.setProperty("--pair-color", colors.get(pair));
    const swatch = document.createElement("span");
    swatch.className = "analysis-pair-swatch";
    swatch.setAttribute("aria-hidden", "true");
    tag.append(swatch, document.createTextNode(pair + (count == null ? "" : ` ×${count}`)));
    return tag;
  }
  function renderLegend() {
    legend.replaceChildren();
    legend.hidden = resultMode !== "distances";
    if (legend.hidden || !result) return;
    const pairs = [...new Set(result.rows.flatMap(row => Object.keys(row.pairs)))].sort();
    legend.append(...pairs.map(pair => pairTag(pair)));
  }
  function draw() {
    chart.replaceChildren();
    chart.onclick = null;
    if (!result) return;
    $("analysis-results").hidden = !result.rows.length && !(observed && resultMode === "powder");
    if ($("analysis-results").hidden) return;
    const isDistance = resultMode === "distances";
    const width = Math.max(280, Math.round(chart.clientWidth)), height = 225;
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const left = 48, right = width - 14, top = 26, bottom = height - 37;
    const min = isDistance ? result.rMin : result.twoThetaMin;
    const max = isDistance ? result.rMax : result.twoThetaMax;
    const maximum = isDistance ? result.rows.reduce((n, row) => Math.max(n, row.count), 1) : 100;
    const yMax = isDistance ? Math.ceil(maximum / 4) * 4 : 100;
    const measured = !isDistance && observed ? observed.points.filter(([a]) => min <= a && a <= max) : [];
    const peak = measured.reduce((m,p) => Math.max(m, Math.abs(p[1])), 0);
    const yMin = peak ? measured.reduce((m,p) => Math.min(m,100*p[1]/peak),0) : 0;
    const x = v => left + (v - min) / (max - min) * (right - left);
    const y = v => bottom - (v - yMin) / (yMax - yMin) * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * i / 4;
      svg("line", { x1: left, x2: right, y1: y(v), y2: y(v), class: "analysis-grid" });
      svg("text", { x: left - 8, y: y(v) + 4, "text-anchor": "end" }, String(Number(v.toFixed(1))));
      const d = min + (max - min) * i / 4;
      svg("text", { x: x(d), y: bottom + 17, "text-anchor": "middle" }, Number(d.toFixed(2)).toString());
    }
    svg("text", { x: left, y: 14, class: "analysis-axis-title" }, isDistance ? "Pairs / unit cell" : "Relative intensity");
    svg("text", { x: (left + right) / 2, y: height - 3, "text-anchor": "middle", class: "analysis-axis-title" }, isDistance ? "Distance (Å)" : "2θ (°)");
    const fwhm = Number(controls.fwhm.value);
    if (!isDistance && fwhm > 0) {
      const profile = powderProfile(result.rows, min, max, fwhm);
      svg("path", { d: profile.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(2)},${y(b).toFixed(2)}`).join(" "), class: "analysis-profile" });
    }
    result.rows.forEach((row, index) => {
      const pos = x(isDistance ? row.distance : row.twoTheta);
      const segments = isDistance ? pairSegments(row) : [{ from: 0, to: row.intensity }];
      for (const segment of segments) {
        const line = svg("line", { x1: pos, x2: pos, y1: y(segment.from), y2: y(segment.to), class: `analysis-stick${selected === index ? " selected" : ""}${!isDistance && fwhm > 0 ? " subdued" : ""}`, "data-index": index });
        if (isDistance) {
          line.dataset.pair = segment.pair;
          line.dataset.count = segment.count;
          line.style.setProperty("--pair-color", colors.get(segment.pair));
        }
        const title = document.createElementNS(ns, "title");
        title.textContent = description(row);
        line.append(title);
      }
    });
    if (measured.length) {
      const path = measured.map(([a,b],i) => (i ? "L" : "M") + x(a).toFixed(2) + "," + y(peak ? 100*b/peak : 0).toFixed(2)).join(" ");
      svg("path", {d:path, class:"analysis-observed-line"});
    }
    chart.onclick = event => {
      const rect = chart.getBoundingClientRect();
      const at = min + ((event.clientX - rect.left) / rect.width * width - left) / (right - left) * (max - min);
      let nearest = 0;
      const position = row => isDistance ? row.distance : row.twoTheta;
      result.rows.forEach((row, i) => { if (Math.abs(position(row) - at) < Math.abs(position(result.rows[nearest]) - at)) nearest = i; });
      if (result.rows.length) select(nearest);
      if (measured.length) {
        const sample = measured.reduce((best,p) => Math.abs(p[0]-at) < Math.abs(best[0]-at) ? p : best);
        const info = "Measured " + sample[0].toFixed(4) + "° · intensity " + sample[1];
        if (result.rows.length) detail.textContent += " · " + info + " · Δ2θ " + (sample[0] - result.rows[nearest].twoTheta).toFixed(4) + "°";
        else detail.textContent = info + " · No calculated line in range.";
      }
    };
  }
  function renderTable() {
    table.replaceChildren();
    if (!result?.rows.length) return;
    const distances = resultMode === "distances";
    const head = table.createTHead().insertRow();
    for (const label of distances ? ["Distance (Å)", "Atom pairs", "Count/cell"] : ["2θ (°)", "d (Å)", "h k l", "I (%)"]) {
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
      const values = distances
        ? [entry.distance.toFixed(5), pairText(entry), entry.count]
        : [entry.twoTheta.toFixed(3), entry.d.toFixed(5), hklText(entry), entry.intensity.toFixed(2)];
      values.forEach((value, column) => {
        const cell = row.insertCell();
        if (distances && column === 1) {
          for (const { pair, count } of pairSegments(entry)) {
            if (cell.childNodes.length) cell.append(" ");
            cell.append(pairTag(pair, count));
          }
        } else cell.textContent = value;
      });
      row.onclick = () => select(index);
      row.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(index); } };
    });
    more.hidden = result.rows.length <= 10;
    more.textContent = expanded ? "Show first 10" : `Show all ${result.rows.length.toLocaleString()}`;
    more.setAttribute("aria-expanded", String(expanded));
    $("analysis-table-note").textContent = distances
      ? "Colors identify atom pairs. Coincident pairs form colored segments of one line; its total height is the count per unit cell. Distances are grouped within the tolerance and shown at their mean."
      : "Integrated intensities, strongest line = 100. One representative hkl is shown; overlapping reflections are summed.";
  }
  more.onclick = () => { expanded = !expanded; renderTable(); };
  csv.onclick = () => {
    if (!result?.rows.length) return;
    const distances = resultMode === "distances";
    const rows = distances
      ? [["distance_A", "min_A", "max_A", "pairs_per_cell", "atom_pairs"], ...result.rows.map(r => [r.distance, r.min, r.max, r.count, pairText(r)])]
      : [["two_theta_deg", "d_A", "relative_integrated_intensity", "multiplicity", "hkls_Friedel_mates_implied", "wavelength_A"], ...result.rows.map(r => [r.twoTheta, r.d, r.intensity, r.multiplicity, r.hkls.map(h => h.join(" ")).join("; "), result.wavelength])];
    const text = rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `phasesmith-${distances ? "distances" : "powder"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const show = floatingDialog(win, opener, $("analysis-head"), close);
  function open() {
    if (win.open) return;
    show();
    calculate();
    onChange();
  }
  function close() {
    stop();
    win.close();
    opener.setAttribute("aria-expanded", "false");
    powderOpener.setAttribute("aria-expanded", "false");
    focusLauncher(lastOpener);
    onChange();
  }
  for (const [button, mode] of [[opener, "distances"], [powderOpener, "powder"]]) {
    button.onclick = () => {
      if (win.open && controls.mode.value === mode) {
        if (isFrontDialog(win)) close();
        else { show(); updateMode(); }
        return;
      }
      controls.mode.value = mode;
      lastOpener = button;
      if (win.open) { show(); calculate(); onChange(); }
      else open();
    };
  }
  $("analysis-close").onclick = close;
  new ResizeObserver(() => { if (win.open) draw(); }).observe(chart);
  updateMode();

  return {
    selectDetectorPeak(peak) {
      const previous = detectorPeak;
      detectorPeak = peak;
      if (!win.open || controls.mode.value !== "powder") return;
      if (!peak) {
        if (previous && resultMode === "powder") clearHighlight();
        return;
      }
      const [minWave, maxWave] = LIMITS.wavelength;
      if (peak.wavelength < minWave || peak.wavelength > maxWave) {
        highlightDetectorPeak();
        return;
      }
      const options = settings();
      controls.wavelength.value = peak.wavelength;
      if (peak.twoTheta < options.twoThetaMin)
        controls.twoThetaMin.value = Math.max(LIMITS.twoThetaMin[0], Math.floor(peak.twoTheta));
      if (peak.twoTheta > options.twoThetaMax)
        controls.twoThetaMax.value = Math.ceil(peak.twoTheta);
      if (options.wavelength !== peak.wavelength || options.twoThetaMin !== Number(controls.twoThetaMin.value) ||
          options.twoThetaMax !== Number(controls.twoThetaMax.value)) queue();
      else highlightDetectorPeak();
    },
    setStructure() {
      detectorPeak = null;
      importVersion++;
      setObserved(null);
      stop();
      clear();
      const elements = [...new Set(getStructure()?.atoms.map(a => a.element))].sort();
      const pairs = [];
      controls.pair.replaceChildren(new Option("All pairs", "all"));
      elements.forEach((a, i) => elements.slice(i).forEach(b => {
        pairs.push(pairName(a, b));
      }));
      colors = pairColors(pairs);
      [...colors.keys()].forEach(name => controls.pair.add(new Option(name, name)));
      if (win.open) calculate();
    },
    exportState: () => ({ ...settings(), open: win.open, observed }),
    restoreState(raw) {
      const state = raw && typeof raw === "object" ? raw : DEFAULTS;
      for (const [key, value] of Object.entries(DEFAULTS)) controls[key].value = String(value);
      for (const [key, [min, max]] of Object.entries(LIMITS))
        if (Number.isFinite(state[key]) && state[key] >= min && state[key] <= max) controls[key].value = state[key];
      if (["distances", "powder"].includes(state.mode)) controls.mode.value = state.mode;
      importVersion++;
      const trace = state.observed;
      setObserved(trace && typeof trace.name === "string" && Array.isArray(trace.points) && trace.points.length >= 2 && trace.points.length <= 100000 &&
        trace.points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 180) ? trace : null);
      const pair = normalizePair(state.pair);
      if ([...controls.pair.options].some(o => o.value === pair)) controls.pair.value = pair;
      updateMode();
      if (state.open === true) { if (win.open) calculate(); else open(); }
      else { stop(); clear(); win.close(); updateMode(); }
    },
  };
}
