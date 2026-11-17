import { powderProfile } from "./structure-analysis.js";

const DEFAULTS = { mode: "distances", rMin: 0, rMax: 6, tolerance: 0.001, pair: "all", wavelength: 1.5406, twoThetaMin: 5, twoThetaMax: 90, fwhm: 0.15 };
const LIMITS = { rMin: [0, 30], rMax: [0.1, 30], tolerance: [0.00001, 0.1], wavelength: [0.1, 3], twoThetaMin: [0.1, 170], twoThetaMax: [0.1, 170], fwhm: [0, 2] };
const ns = "http://www.w3.org/2000/svg";
const pairText = row => Object.entries(row.pairs).map(([pair, n]) => `${pair} ×${n}`).join(", ");
const hklText = row => {
  // Prefer the conventional positive representative for the table. The full
  // enumerated reciprocal-vector list, with ± mates implied, stays in the CSV.
  const sorted = [...row.hkls].sort((a, b) => a.filter(v => v < 0).length - b.filter(v => v < 0).length || b[0] - a[0] || b[1] - a[1]);
  return sorted[0].join(" ");
};

export function createAnalysisWindow({ getStructure, onChange = () => {} }) {
  const $ = id => document.getElementById(id);
  const win = $("analysis-window"), opener = $("mode-analysis"), form = $("analysis-form");
  const chart = $("analysis-chart"), status = $("analysis-status"), table = $("analysis-table");
  const more = $("analysis-more"), csv = $("analysis-csv"), detail = $("analysis-detail");
  const controls = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, $("analysis-" + key)]));
  let worker = null, timer = 0, result = null, resultMode = null, selected = -1, expanded = false;
  let drag = null;
  const settings = () => Object.fromEntries(Object.entries(controls).map(([key, field]) => [key, key === "mode" || key === "pair" ? field.value : Number(field.value)]));

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
    table.replaceChildren();
    detail.textContent = "";
    more.hidden = true;
    csv.disabled = true;
    $("analysis-results").hidden = true;
  }
  function updateMode() {
    const distance = controls.mode.value === "distances";
    $("analysis-distance-fields").hidden = !distance;
    $("analysis-powder-fields").hidden = distance;
    for (const field of $("analysis-distance-fields").querySelectorAll("input, select")) field.disabled = !distance;
    for (const field of $("analysis-powder-fields").querySelectorAll("input, select")) field.disabled = distance;
    $("analysis-note").textContent = distance
      ? "Geometric pairs per unit cell, counted once. Periodic neighbors are included automatically for the distance range."
      : "Ideal X-ray powder pattern: neutral-atom form factors, occupancies and powder Lorentz–polarization correction. No thermal motion, anomalous scattering, texture or instrumental model.";
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
      const ms = Math.round(performance.now() - start);
      status.textContent = result.rows.length
        ? `${result.rows.length.toLocaleString()} ${resultMode === "distances" ? "distinct distances" : "powder lines"} · ${ms} ms`
        : "No pairs or reflections in this range.";
      if (result.partialOccupancy) status.textContent += " · Partial sites count as whole geometric sites; disorder correlations are not modeled.";
      csv.disabled = !result.rows.length;
      detail.textContent = "Select a line or table row for details.";
      $("analysis-results").hidden = !result.rows.length;
      renderTable();
      draw();
    };
    worker.postMessage({ structure, mode: options.mode, options });
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
    for (const el of chart.querySelectorAll("[data-index]")) el.classList.toggle("selected", Number(el.dataset.index) === index);
    for (const row of table.querySelectorAll("tbody tr")) row.classList.toggle("selected", Number(row.dataset.index) === index);
  }
  function draw() {
    chart.replaceChildren();
    if (!result?.rows.length) return;
    const isDistance = resultMode === "distances";
    const width = Math.max(280, Math.round(chart.clientWidth)), height = 225;
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const left = 48, right = width - 14, top = 26, bottom = height - 37;
    const min = isDistance ? result.rMin : result.twoThetaMin;
    const max = isDistance ? result.rMax : result.twoThetaMax;
    const maximum = isDistance ? result.rows.reduce((n, row) => Math.max(n, row.count), 1) : 100;
    const yMax = isDistance ? Math.ceil(maximum / 4) * 4 : 100;
    const x = v => left + (v - min) / (max - min) * (right - left);
    const y = v => bottom - v / yMax * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4;
      svg("line", { x1: left, x2: right, y1: y(v), y2: y(v), class: "analysis-grid" });
      svg("text", { x: left - 8, y: y(v) + 4, "text-anchor": "end" }, String(v));
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
      const line = svg("line", { x1: pos, x2: pos, y1: bottom, y2: y(isDistance ? row.count : row.intensity), class: `analysis-stick${selected === index ? " selected" : ""}${!isDistance && fwhm > 0 ? " subdued" : ""}`, "data-index": index });
      const title = document.createElementNS(ns, "title");
      title.textContent = description(row);
      line.append(title);
    });
    chart.onclick = event => {
      const rect = chart.getBoundingClientRect();
      const at = min + ((event.clientX - rect.left) / rect.width * width - left) / (right - left) * (max - min);
      let nearest = 0;
      const position = row => isDistance ? row.distance : row.twoTheta;
      result.rows.forEach((row, i) => { if (Math.abs(position(row) - at) < Math.abs(position(result.rows[nearest]) - at)) nearest = i; });
      select(nearest);
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
      values.forEach(value => { row.insertCell().textContent = value; });
      row.onclick = () => select(index);
      row.onkeydown = event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(index); } };
    });
    more.hidden = result.rows.length <= 10;
    more.textContent = expanded ? "Show first 10" : `Show all ${result.rows.length.toLocaleString()}`;
    more.setAttribute("aria-expanded", String(expanded));
    $("analysis-table-note").textContent = distances
      ? "Distances are grouped within the tolerance; each line is at the mean distance. Counts refer to one unit cell."
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

  function clampWindow() {
    const r = win.getBoundingClientRect();
    win.style.left = `${Math.max(8, Math.min(r.left, innerWidth - r.width - 8))}px`;
    win.style.top = `${Math.max(8, Math.min(r.top, innerHeight - r.height - 8))}px`;
  }
  function open() {
    if (win.open) return;
    win.show();
    opener.setAttribute("aria-expanded", "true");
    if (!win.style.left) {
      win.style.left = `${Math.max(8, (innerWidth - win.offsetWidth) / 2)}px`;
      win.style.top = `${Math.max(8, (innerHeight - win.offsetHeight) / 2)}px`;
    }
    clampWindow();
    calculate();
    onChange();
  }
  function close() {
    stop();
    win.close();
    opener.setAttribute("aria-expanded", "false");
    opener.focus({ preventScroll: true });
    onChange();
  }
  opener.onclick = () => win.open ? close() : open();
  $("analysis-close").onclick = close;
  document.addEventListener("keydown", event => {
    if (win.open && event.key === "Escape" && !event.defaultPrevented) {
      // A modal library opened above this nonmodal window owns Escape.
      if (document.querySelector("dialog:modal")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  }, true);
  const handle = $("analysis-head");
  handle.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const r = win.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: r.left, top: r.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  handle.onpointermove = event => {
    if (!drag) return;
    win.style.left = `${drag.left + event.clientX - drag.x}px`;
    win.style.top = `${drag.top + event.clientY - drag.y}px`;
    clampWindow();
  };
  handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = () => { drag = null; };
  window.addEventListener("resize", () => { if (win.open) clampWindow(); });
  new ResizeObserver(() => { if (win.open) draw(); }).observe(chart);
  updateMode();

  return {
    setStructure() {
      stop();
      clear();
      const elements = [...new Set(getStructure()?.atoms.map(a => a.element))].sort();
      controls.pair.replaceChildren(new Option("All atom pairs", "all"));
      elements.forEach((a, i) => elements.slice(i).forEach(b => {
        const name = `${a}–${b}`;
        controls.pair.add(new Option(name, name));
      }));
      if (win.open) calculate();
    },
    exportState: () => ({ ...settings(), open: win.open }),
    restoreState(raw) {
      const state = raw && typeof raw === "object" ? raw : DEFAULTS;
      for (const [key, value] of Object.entries(DEFAULTS)) controls[key].value = String(value);
      for (const [key, [min, max]] of Object.entries(LIMITS))
        if (Number.isFinite(state[key]) && state[key] >= min && state[key] <= max) controls[key].value = state[key];
      if (["distances", "powder"].includes(state.mode)) controls.mode.value = state.mode;
      if ([...controls.pair.options].some(o => o.value === state.pair)) controls.pair.value = state.pair;
      updateMode();
      if (state.open === true) { if (win.open) calculate(); else open(); }
      else { stop(); clear(); win.close(); opener.setAttribute("aria-expanded", "false"); }
    },
  };
}
