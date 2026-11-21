import * as THREE from "three";
import { ViewControls } from "./view-controls.js";
import { floatingDialog, isFrontDialog } from "./floating-dialog.js";
import { formatMillerIndices, clipPlaneToBox, planeOffsets, parseMillerIndices, matVec } from "./crystal-math.js";
import { translatedSites, defaultRanges, rangeEdges } from "./plot-range.js";
import { elementColor } from "./elements.js";
import { reflection, harmonicIndices, crystalRayLayers } from "./reflection-model.js";

const ns = "http://www.w3.org/2000/svg";
const format = value => Math.abs(value) < 1e-9 ? "0" : Number(value.toFixed(4)).toString();
const phaseColor = cycles => new THREE.Color().setHSL((0.58 + cycles) % 1, 0.67, 0.55);
const atomName = atom => `${atom.label || atom.element} · #${atom.index + 1}`;

const groupName = group => `${group.label || group.element} × ${group.members.length}`;
const degrees = cycles => `${format(360 * cycles)}°`;

export function createReflectionExplorer({ getStructure, atomRadius, onDetector }) {
  const opener = document.getElementById("mode-reflection");
  const dialog = document.createElement("dialog");
  dialog.id = "reflection-explorer";
  dialog.setAttribute("aria-labelledby", "reflection-title");
  dialog.innerHTML = `
    <header class="reflection-head">
      <div><h2 id="reflection-title">Explain reflection</h2><p id="reflection-structure" class="hint"></p></div>
      <button type="button" id="reflection-close" class="window-button" aria-label="Close reflection explorer">✕</button>
    </header>
    <form id="reflection-form" class="reflection-toolbar">
      <label>h k l<input id="reflection-hkl" value="1 1 1" required aria-label="Reflection Miller indices" spellcheck="false" /></label>
      <button type="submit">Show</button>
      <div class="reflection-harmonics" role="group" aria-label="Harmonics">
        <button id="reflection-previous" type="button" aria-label="Previous harmonic">←</button>
        <span id="reflection-harmonic-label">Harmonic</span>
        <button id="reflection-next" type="button" aria-label="Next harmonic">→</button>
      </div>
      <details class="reflection-options tool-options"><summary>Wavelength / detector</summary><div class="reflection-option-fields">
      <label>λ (Å)<input id="reflection-wavelength" type="number" value="1.5406" min="0.001" step="any" required aria-label="X-ray wavelength" /></label>
      <button id="reflection-detector" type="button">Show on detector</button>
      <button id="reflection-project" type="button">Save exercise</button>
      </div></details>
    </form>
    <p id="reflection-error" role="alert" hidden></p>
    <div class="reflection-mobile-tabs" role="group" aria-label="Reflection explanation">
      <button type="button" data-reflection-view="crystal" aria-pressed="true">Crystal</button>
      <button type="button" data-reflection-view="sum" aria-pressed="false">Phase sum</button>
      <button type="button" data-reflection-view="rays" aria-pressed="false">Ray paths</button>
    </div>
    <div id="reflection-content">
      <p class="reflection-equation"><span id="reflection-equation"></span> <span>→ e<sup>2πim</sup></span></p>
      <div class="reflection-layout">
        <section class="reflection-crystal" aria-label="Crystal and selected atom">
          <div class="reflection-view-controls">
            <button type="button" data-view="oblique" class="secondary">3D view</button>
            <button type="button" data-view="edge" class="secondary">Edge-on</button>
            <label>Color<select id="reflection-colors"><option value="element">Element</option><option value="phase">Phase</option></select></label>
          </div>
          <div id="reflection-stage"><svg id="reflection-layer-labels" aria-label="Layers linked to the ray diagram"></svg></div>
          <div id="reflection-phase-legend" hidden><span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span></div>
          <p class="hint" id="reflection-plane-note"></p>
          <label class="reflection-atom-label">Selected phase group<select id="reflection-group"></select></label>
          <label class="reflection-atom-label" hidden>Selected atom<select id="reflection-atom"></select></label>
          <div id="reflection-atom-detail" aria-live="polite"></div>
          <p class="hint">Click an atom or an amplitude arrow to connect the two views. Drag the crystal to rotate.</p>
        </section>
        <section class="reflection-calculation" aria-label="Structure factor explanation">
          <div class="reflection-tabs" role="group" aria-label="Explanation view">
            <button type="button" data-panel="sum" aria-pressed="true">Phase sum</button>
            <button type="button" data-panel="rays" aria-pressed="false">Ray paths</button>
          </div>
          <div id="reflection-sum-panel">
            <div class="reflection-phasor-scroll"><svg id="reflection-phasors" role="img" aria-label="Atomic scattering amplitudes"></svg></div>
            <label class="reflection-steps">Phase groups <output id="reflection-count"></output><input id="reflection-step" type="range" min="0" max="1" value="1" aria-label="Number of contributions in the sum" /></label>
            <div class="reflection-step-buttons"><button type="button" id="reflection-step-back">Previous group</button><button type="button" id="reflection-step-next">Next group</button><button type="button" id="reflection-all">Show all</button></div>
            <p id="reflection-total" aria-live="polite"></p>
            <p class="hint" id="reflection-tag-note" hidden>Some ×N labels are hidden to avoid overlap. The table lists every phase group and its position count.</p>
            <p class="hint" id="reflection-sum-note"></p>
          </div>
          <div id="reflection-rays-panel" hidden>
            <div class="reflection-ray-controls"><label class="reflection-atom-label">Reference atom<select id="reflection-reference"></select></label>
            <button type="button" id="reflection-animate" aria-pressed="false">Animate waves</button></div>
            <p id="reflection-ray-status" class="hint"></p>
            <svg id="reflection-rays" role="img"></svg>
            <p id="reflection-ray-equation"></p>
            <svg id="reflection-waves" role="img"></svg>
            <p id="reflection-translation" class="hint"></p>
          </div>
          <div class="reflection-atom-table" tabindex="0" aria-label="Unit-cell contributions"><table class="data-table">
            <thead><tr id="reflection-columns"></tr></thead><tbody id="reflection-rows"></tbody>
          </table></div>
        </section>
      </div>
      <p id="reflection-summary" class="hint"></p>
      <p class="hint reflection-model-note">One symmetry-expanded cell · neutral-atom X-ray factors · occupancy included · CIF displacement parameters included where available · anomalous scattering omitted. Boundary copies share a single contribution.</p>
    </div>
    <div class="reflection-intensity"><div><strong>Reflection intensity · I ∝ |F(hkl)|²</strong><p>Structure-factor contribution; experimental corrections are separate.</p></div><output id="reflection-intensity"></output></div>`;
  document.body.append(dialog);
  const closeReflection = () => { dialog.close(); opener?.focus({ preventScroll: true }); };
  const showReflection = floatingDialog(dialog, opener, dialog.querySelector(".reflection-head"), closeReflection);
  const $ = id => dialog.querySelector(`#${id}`), stage = $("reflection-stage");
  dialog.dataset.view = "crystal";
  const compactLayout = matchMedia("(max-width: 900px), (max-height: 500px)");
  const reflectionOptions = dialog.querySelector(".reflection-options");
  let compactOptionsOpen = false;
  reflectionOptions.open = !compactLayout.matches;
  reflectionOptions.addEventListener("toggle", () => {
    reflectionOptions.querySelector("summary").setAttribute("aria-expanded", String(reflectionOptions.open));
    if (compactLayout.matches) compactOptionsOpen = reflectionOptions.open;
  });
  compactLayout.addEventListener("change", event => {
    if (event.matches) reflectionOptions.open = compactOptionsOpen;
    else { compactOptionsOpen = reflectionOptions.open; reflectionOptions.open = true; }
  });
  for (const button of dialog.querySelectorAll("[data-reflection-view]")) {
    button.onclick = () => {
      const view = button.dataset.reflectionView;
      dialog.dataset.view = view;
      for (const other of dialog.querySelectorAll("[data-reflection-view]"))
        other.setAttribute("aria-pressed", String(other === button));
      if (view !== "crystal") dialog.querySelector(`[data-panel="${view}"]`).click();
      $("reflection-content").scrollTop = 0;
      resize();
    };
  }

  let structure = null, renderedStructure = null, result = null, selected = 0, reference = 0, count = 0;
  let clickedPosition = null, savedExercise = null;
  const rayMode = () => !$("reflection-rays-panel").hidden;
  const selectedGroup = () => result.atoms[selected].groupIndex;
  const selectedPosition = () => clickedPosition ?? result.atoms[selected].frac;
  const selectedDepth = () => selectedPosition().reduce((sum, v, i) => sum + v * result.hkl[i], 0);
  let renderer, scene, camera, viewCamera, controls, model, planeGroup, spheres, copies = [];
  let resettingView = false;
  let center = new THREE.Vector3(), radius = 1, fitDistance = 10, frame = 0, active = false;
  let selectionGroup, layerGroup, sphereRadius, planeTruncated = false;
  let layerAnchors = [];
  const layerColors = ["#55d6ba", "#ff8c77", "#83b9ff"];
  const layerColor = layer => layerColors[layer.id.charCodeAt(0) - 65];
  const layerName = layer => `${layer.id} · ${layer.elements.join("/")}`;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerStart = null;
  let animateWaves = false, waveTime = 0, lastWaveFrame = 0;

  function svg(parent, type, attrs, value) {
    const element = document.createElementNS(ns, type);
    for (const [key, val] of Object.entries(attrs)) element.setAttribute(key, val);
    if (value != null) element.textContent = value;
    parent.append(element);
    return element;
  }
  function line(parent, x1, y1, x2, y2, color = "var(--muted)", width = 1, dash = "") {
    return svg(parent, "line", { x1, y1, x2, y2, stroke: color, "stroke-width": width, "stroke-dasharray": dash });
  }
  function text(parent, x, y, value, anchor = "middle") {
    return svg(parent, "text", { x, y, "text-anchor": anchor }, value);
  }
  function dispose(group) {
    const geometries = new Set(), materials = new Set();
    group.traverse(object => {
      if (object.isInstancedMesh) object.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    group.clear();
  }
  const position = frac => new THREE.Vector3(...matVec(result.basis, frac)).sub(center);

  function initializeScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0, 0);
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Crystal unit cell with selected reflection planes. Click atoms to inspect their scattering contribution.");
    stage.append(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x33465d, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(5, 8, 10);
    scene.add(light);
    model = new THREE.Group();
    planeGroup = new THREE.Group();
    selectionGroup = new THREE.Group();
    layerGroup = new THREE.Group();
    scene.add(model, planeGroup, selectionGroup, layerGroup);
    controls = new ViewControls(camera, renderer.domElement);
    controls.staticMoving = true;
    controls.noPan = true;
    controls.addEventListener("change", render);
    renderer.domElement.addEventListener("pointerdown", event => { pointerStart = [event.clientX, event.clientY]; });
    renderer.domElement.addEventListener("pointerup", event => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      pointerStart = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      raycaster.setFromCamera(pointer, viewCamera);
      const hit = raycaster.intersectObject(spheres)[0];
      if (hit) {
        const copy = copies[hit.instanceId];
        selectAtom(copy.sourceIndex, copy.frac);
      }
    });
  }

  function buildCrystal() {
    dispose(model);
    const edgePoints = rangeEdges(defaultRanges()).map(frac => new THREE.Vector3(...matVec(result.basis, frac)));
    const box = new THREE.Box3().setFromPoints(edgePoints);
    box.getCenter(center);
    radius = box.getSize(new THREE.Vector3()).length() / 2;
    fitDistance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.18;
    controls.minDistance = fitDistance * 0.25;
    controls.maxDistance = fitDistance * 5;

    copies = translatedSites(result.atoms, defaultRanges(), true);
    // Appearance overrides use the original expanded index, including any
    // unoccupied entries that the diffraction calculation skipped.
    const occupiedIndices = structure.atoms.flatMap((atom, i) => (atom.occupancy ?? 1) > 0 ? [i] : []);
    for (const copy of copies) copy.appearanceAtom = { ...copy, sourceIndex: occupiedIndices[copy.sourceIndex] };
    spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.42 }), copies.length);
    updateCrystalSizes();
    model.add(spheres);
    model.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edgePoints.map(p => p.sub(center))), new THREE.LineBasicMaterial({ color: "#7f9eb8", transparent: true, opacity: 0.55 })));
    setView("oblique");
    renderedStructure = structure;
  }

  function updateCrystalSizes() {
    const transform = new THREE.Matrix4();
    sphereRadius = 0;
    copies.forEach((copy, i) => {
      copy.radius = atomRadius(copy.appearanceAtom);
      sphereRadius = Math.max(sphereRadius, copy.radius);
      transform.makeScale(copy.radius, copy.radius, copy.radius).setPosition(position(copy.frac));
      spheres.setMatrixAt(i, transform);
    });
    spheres.instanceMatrix.needsUpdate = true;
    spheres.computeBoundingSphere();
  }

  function buildPlanes() {
    dispose(planeGroup);
    const { offsets, truncated } = planeOffsets(result.hkl, 0, defaultRanges(), true);
    planeTruncated = truncated;
    const faces = [], edges = [];
    for (const m of offsets) {
      const fractional = clipPlaneToBox(result.hkl, m, defaultRanges());
      if (!fractional) continue;
      const polygon = fractional.map(position);
      for (let i = 1; i + 1 < polygon.length; i++) {
        for (const point of [polygon[0], polygon[i], polygon[i + 1]]) faces.push(...point.toArray());
      }
      polygon.forEach((point, i) => edges.push(...point.toArray(), ...polygon[(i + 1) % polygon.length].toArray()));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(faces, 3));
    planeGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#719fd0", transparent: true, opacity: 0.23, depthWrite: false, side: THREE.DoubleSide })));
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
    planeGroup.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: "#719fd0", transparent: true, opacity: 0.8 })));
  }

  function setView(view) {
    if (!result) return;
    for (const button of dialog.querySelectorAll("[data-view]")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
    // Trackball reset briefly restores its construction-time camera at the
    // origin. Do not project layer labels through that singular interim view.
    resettingView = true;
    try { controls.reset(); } finally { resettingView = false; }
    const normal = new THREE.Vector3(...result.normal);
    const helper = Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const edge = helper.cross(normal).normalize();
    const direction = edge.clone();
    if (view === "oblique") direction.addScaledVector(normal, 0.42).addScaledVector(new THREE.Vector3().crossVectors(normal, edge), 0.18).normalize();
    camera.up.copy(normal);
    camera.position.copy(direction.multiplyScalar(fitDistance));
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
    // Fit the projected cell, rather than a sphere around its bounding box.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    // A compact explanation tab can hide the crystal while hkl is edited.
    // Retain its last real viewport for framing until the Crystal tab returns.
    const lastSize = renderer.getSize(new THREE.Vector2());
    const aspect = (stage.clientWidth || lastSize.x || 300) / (stage.clientHeight || lastSize.y || 230);
    const points = rangeEdges(defaultRanges()).map(position);
    const half = Math.max(...points.map(p => Math.max(Math.abs(p.dot(up)) + sphereRadius * 2, (Math.abs(p.dot(right)) + sphereRadius * 2) / aspect))) * 1.15;
    fitDistance = half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(direction.normalize().multiplyScalar(fitDistance));
    controls.minDistance = fitDistance * 0.25;
    controls.maxDistance = fitDistance * 5;
    controls.update();
    render();
  }

  function paintCrystal() {
    const phases = $("reflection-colors").value === "phase";
    const showLayers = !$("reflection-rays-panel").hidden;
    const layers = showLayers ? crystalRayLayers(result, reference, selected, selectedDepth()).layers : [];
    copies.forEach((copy, i) => {
      const m = copy.frac.reduce((sum, v, axis) => sum + v * result.hkl[axis], 0);
      const layer = layers.find(layer => Math.abs(layer.m - m) < 1e-7);
      let color = phases ? phaseColor(result.atoms[copy.sourceIndex].cycles) : new THREE.Color(elementColor(copy.element));
      if (showLayers) color = layer ? new THREE.Color(layerColor(layer)) : color.multiplyScalar(0.24);
      spheres.setColorAt(i, color);
    });
    spheres.instanceColor.needsUpdate = true;
    $("reflection-phase-legend").hidden = !phases || showLayers;
    dispose(selectionGroup);
    if (!showLayers) {
      const geometry = new THREE.SphereGeometry(1.15, 16, 12);
      const material = new THREE.MeshBasicMaterial({ color: "#f1b84b", wireframe: true });
      for (const copy of copies) {
        if (result.atoms[copy.sourceIndex].groupIndex !== selectedGroup()) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.scale.setScalar(copy.radius);
        mesh.position.copy(position(copy.frac));
        selectionGroup.add(mesh);
      }
    }
    buildLayerHighlights(showLayers, layers);
    $("reflection-plane-note").textContent = showLayers
      ? "Lettered layers match the ray diagram. Colored sheets mark atomic layers; dim atoms provide context."
      : `Blue planes mark integer m. ${planeTruncated ? "First 64 planes shown. " : ""}Highlighted positions belong to the same site and have the same phase.`;
    render();
  }

  function buildLayerHighlights(show, layers) {
    dispose(layerGroup);
    layerAnchors = [];
    planeGroup.visible = !show;
    $("reflection-layer-labels").hidden = !show;
    if (!show) return;
    for (const layer of layers) {
      const fractional = clipPlaneToBox(result.hkl, layer.m, defaultRanges());
      if (!fractional) continue;
      const polygon = fractional.map(position), faces = [];
      for (let i = 1; i + 1 < polygon.length; i++)
        for (const point of [polygon[0], polygon[i], polygon[i + 1]]) faces.push(...point.toArray());
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(faces, 3));
      const color = layerColor(layer);
      layerGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })));
      layerGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(polygon), new THREE.LineBasicMaterial({color})));
      layerAnchors.push({ layer, polygon });
    }
  }

  function drawLayerLabels() {
    const overlay = $("reflection-layer-labels");
    overlay.replaceChildren();
    if (overlay.hidden) return;
    const width = stage.clientWidth, height = stage.clientHeight;
    const anchors = layerAnchors.map(({layer, polygon}) => {
      const points = polygon.map(p => p.clone().project(viewCamera));
      const point = points.reduce((a, b) => a.x < b.x ? a : b);
      return {layer, x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2};
    }).sort((a, b) => a.y - b.y);
    let previousY = 0;
    for (const anchor of anchors) {
      const y = Math.min(height - 42, Math.max(8, anchor.y - 16, previousY + 5));
      previousY = y + 32;
      const color = layerColor(anchor.layer);
      line(overlay, 102, y + 16, anchor.x, anchor.y, color, 1.3);
      svg(overlay, "rect", {x: 8, y, width: 94, height: 32, rx: 5, fill: "var(--panel)", stroke: color});
      text(overlay, 16, y + 13, layerName(anchor.layer), "start").style.fill = color;
      text(overlay, 16, y + 26, `m = ${format(anchor.layer.m)}`, "start");
    }
  }

  function render() {
    if (resettingView || !active || !result || !renderer || !controls) return;
    const half = camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    viewCamera.left = -half * camera.aspect;
    viewCamera.right = half * camera.aspect;
    viewCamera.top = half;
    viewCamera.bottom = -half;
    const direction = camera.position.clone().sub(controls.target).normalize();
    viewCamera.position.copy(camera.position).addScaledVector(direction, radius * 2);
    viewCamera.quaternion.copy(camera.quaternion);
    viewCamera.far = fitDistance * 10 + radius * 4;
    viewCamera.updateProjectionMatrix();
    viewCamera.updateMatrixWorld();
    renderer.render(scene, viewCamera);
    drawLayerLabels();
  }

  function arrow(parent, start, end, color, width = 2) {
    const shaft = line(parent, ...start, ...end, color, width);
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    if (length > 4) {
      const c = dx / length, s = dy / length, head = Math.min(7, length * 0.4);
      svg(parent, "polygon", { points: `${end} ${end[0] - head * c - head * s / 2},${end[1] - head * s + head * c / 2} ${end[0] - head * c + head * s / 2},${end[1] - head * s - head * c / 2}`, fill: color });
    }
    return shaft;
  }

  function drawSum() {
    const chart = $("reflection-phasors"), width = chart.clientWidth, height = 245;
    if (!width) return;
    chart.replaceChildren();
    $("reflection-tag-note").hidden = true;
    const realOnly = result.groups.every(contribution => Math.abs(contribution.imaginary) < Math.max(1, result.scale) * 1e-10);
    $("reflection-sum-note").textContent = realOnly
      ? "All imaginary components are zero. Rows separate the arrows for visibility; vertical spacing has no phase meaning. Every arrow uses the same length scale."
      : "Arrow angle is phase. Arrow length includes all positions in the phase group. Sum amplitudes, then calculate |F|².";
    chart.style.height = "245px";
    if (realOnly) {
      drawRealSum(chart, width);
      updateSumReadout(chart);
      return;
    }
    // Keep one scale throughout the step-through calculation.
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const contribution of result.groups) {
      minX = Math.min(minX, contribution.end[0]); maxX = Math.max(maxX, contribution.end[0]);
      minY = Math.min(minY, contribution.end[1]); maxY = Math.max(maxY, contribution.end[1]);
    }
    const span = Math.max(maxX - minX, maxY - minY, result.scale * 0.04, 1);
    const minimum = Math.max(result.scale * 0.04, 1);
    const scale = Math.min((width - 110) / Math.max(maxX - minX, minimum), (height - 90) / Math.max(maxY - minY, minimum));
    const x = value => width / 2 + (value - (minX + maxX) / 2) * scale;
    const y = value => height / 2 - (value - (minY + maxY) / 2) * scale;
    line(chart, 22, y(0), width - 18, y(0), "var(--line-strong)");
    line(chart, x(0), 20, x(0), height - 22, "var(--line-strong)");
    const axisLabels = svg(chart, "g", { class: "phasor-axis-labels", "pointer-events": "none" });
    text(axisLabels, width - 4, y(0) - 8, "Re (e)", "end");
    text(axisLabels, Math.max(34, Math.min(width - 34, x(0))), 12, "Im (e)");
    text(axisLabels, x(0) - 8, y(0) + 17, "0");
    const tick = Number((span / 2).toPrecision(2));
    for (const value of [tick, -tick]) {
      if (x(value) > 28 && x(value) < width - 35) text(axisLabels, x(value), y(0) + 17, format(value));
      if (y(value) > 32 && y(value) < height - 30) text(axisLabels, x(0) + 7, y(value) + 4, format(value), "start");
    }
    // Draw the selected contribution last so exact overlapping arrows remain inspectable.
    const visible = result.groups.slice(0, count);
    const ordered = visible.filter(contribution => contribution.index !== selectedGroup()).concat(visible.filter(contribution => contribution.index === selectedGroup()));
    const labels = [];
    let hiddenLabels = 0;
    const total = count ? result.groups[count - 1].end : [0, 0];
    // Reserve the resultant label too: it can share an endpoint with a group.
    text(axisLabels, Math.min(width - 10, Math.max(10, x(total[0]) + 9)), Math.max(28, y(total[1]) - 12), count === result.groups.length ? "F" : "Partial F", x(total[0]) > width - 80 ? "end" : "start");
    const axisBounds = [...axisLabels.querySelectorAll("text")].map(label => label.getBBox());
    for (const contribution of ordered) {
      const color = $("reflection-colors").value === "phase" ? `#${phaseColor(contribution.cycles).getHexString()}` : elementColor(contribution.element);
      const start = [x(contribution.start[0]), y(contribution.start[1])], end = [x(contribution.end[0]), y(contribution.end[1])];
      const shaft = arrow(chart, start, end, color, contribution.index === selectedGroup() ? 4 : 2);
      shaft.dataset.group = contribution.index;
      const hit = line(chart, ...start, ...end, "transparent", 13);
      hit.dataset.group = contribution.index;
      if (contribution.members.length > 1) {
        const lx = (start[0] + end[0]) / 2, ly = (start[1] + end[1]) / 2 - 6;
        const touchesAxis = axisBounds.some(r => lx + 16 > r.x - 4 && lx - 16 < r.x + r.width + 4 && ly + 4 > r.y - 4 && ly - 12 < r.y + r.height + 4);
        if (!touchesAxis && !labels.some(p => Math.abs(p[0] - lx) < 28 && Math.abs(p[1] - ly) < 16)) {
          const label = text(chart, lx, ly, `×${contribution.members.length}`);
          label.dataset.group = contribution.index;
          labels.push([lx, ly]);
        } else hiddenLabels++;
      }
      svg(hit, "title", {}, `${groupName(contribution)} · ${format(contribution.cycles * 360)}° · ${format(Math.hypot(contribution.real, contribution.imaginary))} e`);
    }
    $("reflection-tag-note").hidden = hiddenLabels === 0;
    // The resultant sits below the atomic arrows with a small endpoint marker.
    const resultant = line(chart, x(0), y(0), x(total[0]), y(total[1]), "var(--text)", 1.5, "4 3");
    resultant.style.pointerEvents = "none";
    svg(chart, "circle", { cx: x(total[0]), cy: y(total[1]), r: 4, fill: "var(--text)", "pointer-events": "none" });
    chart.append(axisLabels);
    updateSumReadout(chart);
  }

  function drawRealSum(chart, width) {
    const height = Math.max(100, 58 + result.groups.length * 23);
    chart.style.height = `${height}px`;
    const totals = result.groups.map(contribution => contribution.end[0]);
    const low = Math.min(0, ...result.groups.map(contribution => contribution.real), ...totals);
    const high = Math.max(1, ...result.groups.map(contribution => contribution.real), ...totals);
    const scale = Math.max(1, width - 170) / (high - low);
    const x = value => 110 + (value - low) * scale;
    text(chart, 8, 15, "Site × count", "start");
    text(chart, x(0), 15, "0");
    text(chart, width - 5, 15, "Re (e) · Im = 0", "end");
    line(chart, x(0), 22, x(0), height - 10, "var(--muted)", 1, "3 3");
    for (const contribution of result.groups) {
      const y = 36 + contribution.index * 23;
      const visible = contribution.index < count;
      const color = $("reflection-colors").value === "phase" ? `#${phaseColor(contribution.cycles).getHexString()}` : elementColor(contribution.element);
      const group = svg(chart, "g", {"data-group": contribution.index, opacity: visible ? 1 : 0.25});
      text(group, 8, y + 4, groupName(contribution), "start");
      if (visible) {
        arrow(group, [x(0), y], [x(contribution.real), y], color, contribution.index === selectedGroup() ? 4 : 2);
        text(group, x(contribution.real) + (contribution.real >= 0 ? 7 : -7), y + 4, Number(contribution.real.toFixed(2)), contribution.real >= 0 ? "start" : "end");
      }
      svg(group, "rect", {x: 0, y: y - 10, width, height: 22, fill: "transparent", "data-group": contribution.index});
    }
    const total = count ? result.groups[count - 1].end[0] : 0, y = height - 13;
    text(chart, 8, y + 4, count === result.groups.length ? "Total F" : "Partial F", "start");
    arrow(chart, [x(0), y], [x(total), y], "var(--text)", 3);
    text(chart, x(total) + (total >= 0 ? 7 : -7), y + 4, Number(total.toFixed(2)), total >= 0 ? "start" : "end");
  }

  function updateSumReadout(chart) {
    const total = count ? result.groups[count - 1].end : [0, 0];
    $("reflection-count").value = `${count} / ${result.groups.length}`;
    $("reflection-step-back").disabled = count === 0;
    $("reflection-step-next").disabled = count === result.groups.length;
    $("reflection-total").textContent = `${count === result.groups.length ? "F" : "Partial F"} = ${format(total[0])} ${total[1] < -1e-9 ? "−" : "+"} ${format(Math.abs(total[1]))}i e · |F|² = ${format(total[0] ** 2 + total[1] ** 2)} e²`;
    chart.setAttribute("aria-label", `${count} of ${result.groups.length} phase groups. ${$("reflection-total").textContent}`);
  }

  function drawRays() {
    const rays = $("reflection-rays"), waves = $("reflection-waves");
    rays.replaceChildren();
    waves.replaceChildren();
    const delta = selectedDepth() - result.atoms[reference].m;
    $("reflection-ray-equation").textContent = `Selected atom minus reference: Δm = ${format(delta)} · Δz⊥ = d × Δm = ${format(result.d * delta)} Å. At Bragg: ΔL = 2Δz⊥ sin θ = λΔm → Δφ = 2πΔm.`;
    const accessible = result.theta !== null;
    rays.hidden = waves.hidden = !accessible;
    $("reflection-translation").hidden = !accessible;
    $("reflection-ray-status").textContent = accessible
      ? `θ = ${format(result.theta * 180 / Math.PI)}° · projected layer section along the plane normal`
      : `This reflection is beyond the Bragg limit at λ = ${format(result.wavelength)} Å. Reduce the wavelength to show ray paths. The structure factor is still defined.`;
    if (!accessible) return;
    const width = rays.clientWidth;
    if (!width) return;
    const { layers, translation, shift } = crystalRayLayers(result, reference, selected, selectedDepth());
    const span = layers.at(-1).cycles;
    const centerX = width / 2 + 38, top = 52, depthScale = Math.max(40, rays.clientHeight - top - 12) / span;
    const theta = result.theta, sin = Math.sin(theta), cos = Math.cos(theta);
    const reach = Math.min((width - 170) / 2, 44 / Math.max(Math.tan(theta), 1e-8));
    for (const layer of layers) {
      const depth = layer.cycles * depthScale, y = top + depth;
      const color = layerColor(layer);
      text(rays, 0, y - 6, layerName(layer), "start");
      line(rays, 0, y, width - 6, y, color, 1);
      for (const sign of [-1, 1]) {
        line(rays, centerX + sign * reach, y - reach * Math.tan(theta), centerX, y, "var(--muted)", 1.5);
        if (depth > 0) {
          const dx = depth * sin * cos, dy = depth * sin * sin;
          line(rays, centerX, top, centerX + sign * dx, y - dy, "var(--muted)", 1, "3 4");
          line(rays, centerX + sign * dx, y - dy, centerX, y, color, 4);
        }
      }
      svg(rays, "circle", { cx: centerX, cy: y, r: 4, fill: color });
    }
    text(rays, centerX - 12, 14, "Incoming ↘", "end");
    text(rays, width - 5, 14, "↗ Outgoing", "end");
    const left = 113, right = width - 66, period = (right - left) / 1.5, instant = left + period / 2;
    line(waves, instant, 18, instant, 110, "var(--muted)", 1, "3 3");
    text(waves, Math.min(width - 50, Math.max(55, instant)), 12, "Same instant");
    for (const [index, layer] of layers.entries()) {
      const baseline = 32 + index * 32;
      text(waves, 0, baseline + 4, layerName(layer), "start");
      line(waves, left, baseline, right, baseline, "var(--line)");
      const height = x => baseline - 10 * Math.cos(2 * Math.PI * ((x - instant) / period - layer.cycles - waveTime));
      const points = [];
      for (let x = left; x <= right; x++) points.push(`${x},${height(x)}`);
      svg(waves, "polyline", { points: points.join(" "), fill: "none", stroke: layerColor(layer), "stroke-width": 2.3 });
      svg(waves, "circle", { cx: instant, cy: height(instant), r: 3.5, fill: layerColor(layer) });
      text(waves, right + 5, baseline + 4, `${Number(layer.cycles.toPrecision(3))}λ`, "start");
    }
    $("reflection-translation").textContent = `${layers.map(layer => layer.id).join("–")} match the crystal layers, translated together by [${shift.join(" ")}] unit cells for visibility. t = [${translation.join(" ")}] connects the reference copies. Extra paths 2z⊥ sin θ are measured from the uppermost layer. Wave heights are normalized; in-plane offsets are suppressed.`;
    rays.setAttribute("aria-label", layers.map(layer => `${layerName(layer)} (${layer.names.join(" and ")}): ${format(layer.cycles)} wavelengths extra path`).join(". "));
    waves.setAttribute("aria-label", "Normalized waves at the detector. " + rays.getAttribute("aria-label"));
  }

  function selectGroup(index) {
    const member = index === selectedGroup() ? selected : result.groups[index].members[0];
    selectAtom(member, member === selected ? clickedPosition : null);
  }

  function selectAtom(index, position = null) {
    selected = index;
    clickedPosition = position;
    const atom = result.atoms[index], group = result.groups[selectedGroup()];
    $("reflection-atom").value = String(index);
    $("reflection-group").value = String(group.index);
    const frac = selectedPosition();
    const details = rayMode() ? [
      `(${frac.map(format).join(", ")}) · fractional coordinates`,
      result.hkl.map((h, i) => `${h} × ${format(frac[i])}`).join(" + ") + ` = ${format(selectedDepth())}`,
      `Phase = ${degrees(atom.cycles)} · occupancy × f = ${format(atom.amplitude)} e`,
    ] : [
      `${groupName(group)} at ${degrees(group.cycles)} · combined amplitude ${format(Math.hypot(group.real, group.imaginary))} e`,
    ];
    $("reflection-atom-detail").replaceChildren(...details.map(value => {
      const paragraph = document.createElement("p");
      paragraph.textContent = value;
      return paragraph;
    }));
    const activeRow = rayMode() ? selected : group.index;
    for (const row of $("reflection-rows").rows) row.classList.toggle("selected", row.sectionRowIndex === activeRow);
    if (!rayMode() && group.index >= count) {
      count = group.index + 1;
      $("reflection-step").value = count;
    }
    paintCrystal();
    drawSum();
    drawRays();
  }

  function fillAtoms() {
    for (const id of ["reflection-atom", "reflection-reference"]) {
      $(id).replaceChildren(...result.atoms.map(atom => new Option(`${atomName(atom)} · (${atom.frac.map(format).join(", ")})`, String(atom.index))));
    }
    $("reflection-reference").value = String(reference);
    $("reflection-group").replaceChildren(...result.groups.map(group =>
      new Option(`${groupName(group)} · ${degrees(group.cycles)}`, String(group.index))));
  }

  function fillTable() {
    const rays = rayMode();
    $("reflection-group").parentElement.hidden = rays;
    $("reflection-atom").parentElement.hidden = !rays;
    const headers = rays ? ["Atom", "m", "Phase", "occ × f (e)"] : ["Site", "Positions", "Phase", "Amplitude (e)"];
    $("reflection-columns").replaceChildren(...headers.map(title => {
      const th = document.createElement("th");
      th.textContent = title;
      return th;
    }));
    const rows = document.createDocumentFragment();
    for (const entry of rays ? result.atoms : result.groups) {
      const row = document.createElement("tr");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-button";
      button.textContent = rays ? atomName(entry) : entry.label || entry.element;
      button.addEventListener("click", () => rays ? selectAtom(entry.index) : selectGroup(entry.index));
      row.insertCell().append(button);
      for (const value of [rays ? format(entry.m) : entry.members.length, degrees(entry.cycles),
        format(rays ? entry.amplitude : Math.hypot(entry.real, entry.imaginary))]) {
        row.insertCell().textContent = value;
      }
      rows.append(row);
    }
    $("reflection-rows").replaceChildren(rows);
  }

  function calculate() {
    try {
      const hkl = parseMillerIndices($("reflection-hkl").value);
      const next = reflection(structure, hkl, Number($("reflection-wavelength").value));
      const changedNormal = result && result.normal.reduce((sum, v, i) => sum + v * next.normal[i], 0) < 1 - 1e-8;
      result = next;
      $("reflection-error").hidden = true;
      $("reflection-content").hidden = false;
      $("reflection-hkl").value = hkl.join(" ");
      if (renderedStructure !== structure) {
        reference = 0;
        clickedPosition = null;
        selected = result.atoms.findIndex(atom => Math.abs(Math.sin((atom.phase - result.atoms[0].phase) / 2)) > 0.1);
        if (selected < 0) selected = Math.min(1, result.atoms.length - 1);
        buildCrystal();
      } else {
        updateCrystalSizes();
        if (changedNormal) setView("oblique");
      }
      count = result.groups.length;
      $("reflection-step").max = count;
      $("reflection-step").value = count;
      const primitive = hkl.map(value => value / result.order);
      $("reflection-harmonic-label").textContent = `Along (${formatMillerIndices(primitive)})`;
      $("reflection-previous").disabled = primitive.every((v, i) => v === hkl[i]);
      $("reflection-equation").textContent = `${hkl[0]}x + ${hkl[1]}y + ${hkl[2]}z = m`;
      $("reflection-structure").textContent = `${structure.name || structure.block || "Crystal"} · ${result.atoms.length} atoms per cell · d = ${format(result.d)} Å`;
      buildPlanes();
      $("reflection-plane-note").textContent = `Blue planes mark integer m. ${planeTruncated ? "First 64 planes shown. " : ""}Highlighted positions belong to the same site and have the same phase.`;
      const symmetryAbsent = structure.symmetryOperations?.some(({rotation,translation}) => {
        const invariant = hkl.every((v,i) => v === hkl.reduce((sum,h,j) => sum + h * rotation[j][i], 0));
        const shift = hkl.reduce((sum,h,i) => sum + h * translation[i], 0);
        return invariant && Math.abs(shift - Math.round(shift)) > 1e-7;
      });
      $("reflection-summary").textContent = symmetryAbsent
        ? "Systematic absence: a space-group operation preserves this reciprocal vector and shifts its phase. The contributions cancel."
        : result.f2 <= result.scale ** 2 * 1e-12
        ? "The atomic contributions cancel for this structure within numerical precision. The supplied space-group operations allow this reflection."
        : `Full-cell |F|² = ${format(result.f2)} e². Powder multiplicity and experimental intensity corrections are applied separately in Powder.`;
      $("reflection-intensity").textContent = `(${formatMillerIndices(hkl)}) · ${format(result.f2)} e²`;
      fillAtoms();
      fillTable();
      selectAtom(selected, clickedPosition);
      resize();
    } catch (error) {
      $("reflection-error").textContent = error.message;
      $("reflection-error").hidden = false;
      $("reflection-content").hidden = true;
      $("reflection-intensity").textContent = "—";
    }
  }

  function resize() {
    if (!active || !renderer || !result || $("reflection-content").hidden) return;
    if (!stage.clientWidth || !stage.clientHeight) { drawSum(); drawRays(); return; }
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    camera.aspect = stage.clientWidth / stage.clientHeight;
    camera.updateProjectionMatrix();
    controls.handleResize();
    drawSum();
    drawRays();
    render();
  }
  function tick(now = 0) {
    if (!active) return;
    controls.update();
    if (animateWaves && !$("reflection-rays-panel").hidden && now - lastWaveFrame > 32) {
      waveTime = now / 2200;
      lastWaveFrame = now;
      drawRays();
    }
    frame = requestAnimationFrame(tick);
  }
  function open(hkl, wavelength) {
    const saved = hkl ? null : savedExercise ?? snapshot();
    savedExercise = null;
    hkl ??= saved?.hkl ?? result?.hkl ?? [1,1,1];
    wavelength ??= saved?.wavelength;
    const nextStructure = getStructure();
    structure = nextStructure;
    if (wavelength !== undefined) $("reflection-wavelength").value = wavelength;
    $("reflection-hkl").value = hkl.join(" ");
    if (!dialog.open) showReflection();
    opener?.setAttribute("aria-expanded", "true");
    active = true;
    try {
      if (!renderer) initializeScene();
      controls.enabled = true;
      calculate();
      if (saved && result && !$("reflection-content").hidden) {
        const validIndex = i => Number.isInteger(i) && i >= 0 && i < result.atoms.length;
        const triple = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
        if (validIndex(saved.reference)) reference = saved.reference;
        $("reflection-reference").value = reference;
        $("reflection-colors").value = saved.colors === "phase" ? "phase" : "element";
        dialog.querySelector('[data-panel="' + (saved.rays ? "rays" : "sum") + '"]').click();
        if (validIndex(saved.selected)) selectAtom(saved.selected, triple(saved.position) ? saved.position : null);
        count = Number.isInteger(saved.count) ? Math.max(0, Math.min(result.groups.length, saved.count)) : result.groups.length;
        $("reflection-step").value = count;
        drawSum();
        if (triple(saved.eye) && triple(saved.up) && triple(saved.target)) {
          camera.position.fromArray(saved.eye); camera.up.fromArray(saved.up);
          controls.target.fromArray(saved.target); controls.update();
        }
      }
      cancelAnimationFrame(frame);
      tick();
    } catch (error) {
      $("reflection-error").textContent = `Could not open the crystal view. ${error.message}`;
      $("reflection-error").hidden = false;
    }
  }
  opener?.addEventListener("click", () => dialog.open ? (isFrontDialog(dialog) ? closeReflection() : showReflection()) : open());
  $("reflection-project").onclick = () => document.getElementById("project-save").click();
  $("reflection-detector").addEventListener("click", () => {
    try {
      const hkl = parseMillerIndices($("reflection-hkl").value);
      if (!$("reflection-wavelength").reportValidity()) return;
      const wavelength = Number($("reflection-wavelength").value);
      dialog.close();
      onDetector(hkl, wavelength);
    } catch (error) {
      $("reflection-error").textContent = error.message;
      $("reflection-error").hidden = false;
    }
  });
  $("reflection-close").addEventListener("click", closeReflection);
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    active = false;
    opener?.setAttribute("aria-expanded", "false");
    cancelAnimationFrame(frame);
    if (controls) controls.enabled = false;
  });
  $("reflection-form").addEventListener("submit", event => { event.preventDefault(); calculate(); });
  $("reflection-wavelength").addEventListener("change", () => calculate());
  for (const [id, step] of [["reflection-previous", -1], ["reflection-next", 1]]) $(id).addEventListener("click", () => {
    $("reflection-hkl").value = harmonicIndices(result.hkl, step).join(" ");
    calculate();
  });
  for (const button of dialog.querySelectorAll("[data-view]")) button.addEventListener("click", () => setView(button.dataset.view));
  for (const button of dialog.querySelectorAll("[data-panel]")) button.addEventListener("click", () => {
    for (const tab of dialog.querySelectorAll("[data-panel]")) tab.setAttribute("aria-pressed", tab === button ? "true" : "false");
    $("reflection-sum-panel").hidden = button.dataset.panel !== "sum";
    $("reflection-rays-panel").hidden = button.dataset.panel !== "rays";
    fillTable();
    selectAtom(selected, clickedPosition);
  });
  $("reflection-colors").addEventListener("change", () => { paintCrystal(); drawSum(); });
  $("reflection-group").addEventListener("change", event => selectGroup(Number(event.target.value)));
  $("reflection-atom").addEventListener("change", event => selectAtom(Number(event.target.value)));
  $("reflection-reference").addEventListener("change", event => { reference = Number(event.target.value); paintCrystal(); drawRays(); });
  $("reflection-animate").addEventListener("click", event => {
    animateWaves = !animateWaves;
    event.currentTarget.setAttribute("aria-pressed", String(animateWaves));
    event.currentTarget.textContent = animateWaves ? "Pause waves" : "Animate waves";
  });
  $("reflection-phasors").addEventListener("click", event => {
    const index = event.target.closest("[data-group]")?.dataset.group;
    if (index != null) selectGroup(Number(index));
  });
  function stepTo(next) {
    count = Math.max(0, Math.min(result.groups.length, next));
    $("reflection-step").value = count;
    if (count) selectGroup(count - 1);
    else drawSum();
  }
  $("reflection-step").addEventListener("input", event => stepTo(Number(event.target.value)));
  $("reflection-step-back").addEventListener("click", () => stepTo(count - 1));
  $("reflection-step-next").addEventListener("click", () => stepTo(count + 1));
  $("reflection-all").addEventListener("click", () => stepTo(result.groups.length));
  new ResizeObserver(resize).observe(stage);
  function snapshot() {
    if (!result) return null;
    return {
      open: dialog.open, hkl: result.hkl, wavelength: result.wavelength,
      selected, reference, position: clickedPosition, count, rays: rayMode(),
      colors: $("reflection-colors").value, eye: camera.position.toArray(),
      up: camera.up.toArray(), target: controls.target.toArray(),
    };
  }
  return {
    open,
    exportState: () => savedExercise ?? snapshot(),
    restoreState(state) {
      if (dialog.open) dialog.close();
      savedExercise = Array.isArray(state?.hkl) && state.hkl.length === 3 && state.hkl.every(Number.isSafeInteger) ? state : null;
      if (savedExercise?.open) open();
    },
    setStructure() { savedExercise = null; if (dialog.open) dialog.close(); structure = null; result = null; },
  };
}
