import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import "./style.css";
import {
  defaultRanges,
  validateRanges,
  translatedSites,
  rangeEdges,
} from "./plot-range.js";
import { latticeViewDirection } from "./view-direction.js";
import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
import {
  createAppearance,
  clearAppearance,
  atomStyle,
  polyhedronStyle,
  polyKey,
  createAppearanceEditor,
} from "./appearance.js";
const $ = (id) => document.getElementById(id),
  viewport = $("viewport");
function initialize() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    $("loading").hidden = true;
    $("error").hidden = false;
    $("error").textContent =
      "This browser could not start WebGL2, which is needed for 3D viewing. Enable hardware acceleration or open this page in a browser with WebGL2 support.";
    $("name").textContent = "3D view unavailable";
    $("source").textContent = "The graphics context could not be created.";
    $("open").disabled = true;
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive crystal structure. Drag to rotate, scroll or pinch to zoom, and select two atoms to measure.",
  );
  renderer.domElement.setAttribute("role", "img");
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
  // A perspective control camera supplies intuitive distance-based zoom;
  // the synchronized parallel camera renders and picks the crystal.
  const viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  function syncViewCamera() {
    const halfHeight =
      camera.position.distanceTo(controls.target) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    viewCamera.left = -halfHeight * camera.aspect;
    viewCamera.right = halfHeight * camera.aspect;
    viewCamera.top = halfHeight;
    viewCamera.bottom = -halfHeight;
    viewCamera.near = camera.near;
    viewCamera.far = camera.far;
    viewCamera.position.copy(camera.position);
    viewCamera.quaternion.copy(camera.quaternion);
    viewCamera.up.copy(camera.up);
    viewCamera.updateProjectionMatrix();
    viewCamera.updateMatrixWorld();
  }
  function createControls(target = new THREE.Vector3()) {
    const next = new TrackballControls(camera, renderer.domElement);
    next.rotateSpeed = 2.2;
    next.zoomSpeed = 1.2;
    next.panSpeed = 0.6;
    next.staticMoving = false;
    next.dynamicDampingFactor = 0.15;
    next.minDistance = 0.5;
    next.maxDistance = 1000;
    next.target.copy(target);
    next.addEventListener("change", invalidate);
    next.addEventListener("start", invalidate);
    return next;
  }
  let controls = createControls();
  function stopMotion() {
    const { minDistance, maxDistance } = controls;
    const target = controls.target.clone();
    controls.dispose();
    controls = createControls(target);
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
  }
  scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x324353, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 8, 10);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0x99baff, 1.4);
  fill.position.set(-6, -2, -5);
  scene.add(fill);
  let model = new THREE.Group();
  scene.add(model);
  let rules = [],
    coordinationStats = [],
    coordinationTotals = {},
    nextRule = 0;
  const pairColors = ["#62d5df", "#efa04c", "#c6a0ef", "#8cdf9b", "#ef95b3"];
  const faceMeshes = new Map();
  const hiddenElements = new Set();
  const atomVisible = (a) =>
    $("show-atoms").checked && !hiddenElements.has(a.element);
  let plotRanges = defaultRanges();
  let structure,
    atoms = [],
    meshes = [],
    cellLines,
    selection = [],
    selectionGroup = new THREE.Group(),
    currentText = "",
    currentFilename = "",
    request = 0,
    frame = 0,
    fitDistance = 20,
    fitBounds = new THREE.Box3(),
    modelCenter = new THREE.Vector3(),
    distance = null;
  scene.add(selectionGroup);
  function render() {
    frame = 0;
    // Trackball emits change while damping moves the camera. That event
    // schedules the next frame; once settled, no animation frames remain.
    controls.update();
    syncViewCamera();
    renderer.render(scene, viewCamera);
    // The pressed view button stays lit only while the camera still looks
    // along that direction; any rotation away from it clears the state.
    if (
      activeView &&
      camera.position.clone().sub(controls.target).normalize().dot(activeView.dir) <
        0.99995
    )
      setActiveView(null);
  }
  let activeView = null;
  function setActiveView(id, dir) {
    activeView = id ? { id, dir: dir.clone() } : null;
    for (const axis of ["a", "b", "c"])
      $(`view-${axis}`).setAttribute("aria-pressed", String(axis === id));
    document
      .querySelector(".view-directions details")
      .classList.toggle("active", id === "uvw");
  }
  function invalidate() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  renderer.domElement.addEventListener("wheel", invalidate, { passive: true });
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setSize(width, height);
    controls.handleResize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(viewport);
  const colors = {
    H: "#e7edf3",
    C: "#65798c",
    N: "#668df3",
    O: "#ed7073",
    F: "#91d5a0",
    Na: "#bc96e6",
    Mg: "#8dd2af",
    Al: "#b8b7cf",
    Si: "#d5b38a",
    P: "#efb76a",
    S: "#e4cf62",
    Cl: "#78c98b",
    K: "#ad87d8",
    Ca: "#8fbd83",
    Ti: "#aab7ca",
    Cr: "#83b4c5",
    Mn: "#c991bd",
    Fe: "#db9564",
    Co: "#8da2d5",
    Ni: "#85b5a0",
    Cu: "#ce9873",
    Zn: "#99b1bb",
  };
  const radii = {
    H: 0.22,
    C: 0.37,
    N: 0.36,
    O: 0.34,
    Na: 0.52,
    Mg: 0.48,
    Al: 0.45,
    Si: 0.43,
    K: 0.6,
    Ca: 0.56,
    Fe: 0.45,
  };
  const defaultColor = (e) => colors[e] || "#acb5cf";
  const appearance = createAppearance();
  let styleEditor = null;
  // Element-wide colour (used by the element chips and as the inherited
  // value for individual atoms).
  const colorFor = (e) => appearance.elements.get(e)?.color ?? defaultColor(e);
  const styleOf = (a) => atomStyle(appearance, a.element, atomKey(a), defaultColor(a.element));
  // Drawn radius = element default × global Size × appearance scale. The
  // same value drives the instance matrix, picking and the selection halo.
  const atomRadius = (a) =>
    (radii[a.element] || 0.42) * Number($("size").value) * styleOf(a).scale;
  const ruleColor = (rule) =>
    rule.color ??
    pairColors[Math.max(rules.indexOf(rule), 0) % pairColors.length];
  // A neutral procedural studio (no remote assets) lights the atoms only:
  // soft panel reflections give broad highlights, while polyhedra and bonds
  // keep their existing flat, colour-true shading.
  const studio = (() => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return texture;
  })();
  function atomMaterial(color) {
    // Satin finish: a broad, modest key highlight and only a faint studio
    // reflection, so saturated element colours are not lifted to white and
    // the shaded side keeps depth (no clear coat, which added white rims).
    return new THREE.MeshStandardMaterial({
      color,
      // Grazing-angle studio reflection produced a pale rim on the upper
      // silhouette; a weaker, rougher reflection keeps the edge colored.
      roughness: 0.56,
      metalness: 0,
      envMap: studio,
      envMapIntensity: 0.08,
    });
  }
  // Segment count follows a fixed triangle budget, so small scenes get
  // smooth silhouettes at close zoom and large supercells stay light,
  // without abrupt steps between structure sizes.
  function sphereDetail(count) {
    const width = Math.round(
      THREE.MathUtils.clamp(Math.sqrt(1.2e6 / Math.max(count, 1)), 10, 64),
    );
    return [width, Math.max(8, Math.round(width * 0.75))];
  }
  function cart(frac) {
    return new THREE.Vector3(
      ...structure.basis.map((row) =>
        row.reduce((s, v, i) => s + v * frac[i], 0),
      ),
    );
  }
  function dispose(group) {
    group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
  }
  function atomKey(a) {
    return `${a.sourceIndex}:${a.frac.map((v) => Math.round(v * 1e9)).join(",")}`;
  }
  function build(
    preserve = true,
    plottedSites = translatedSites(
      structure.atoms,
      plotRanges,
      $("boundary").checked,
    ),
  ) {
    const selectedKeys = preserve ? selection.map(atomKey) : [];
    faceMeshes.clear();
    dispose(model);
    scene.remove(model);
    model = new THREE.Group();
    scene.add(model);
    atoms = [];
    meshes = [];
    selection = [];
    distance = null;
    updateSelection();
    const corners = [];
    for (let i = 0; i < 8; i++)
      corners.push(cart(plotRanges.map((r, axis) => r[(i >> axis) & 1])));
    const box = new THREE.Box3().setFromPoints(corners);
    modelCenter = box.getCenter(new THREE.Vector3());
    atoms = plottedSites.map((a, id) => {
      const p = cart(a.frac);
      return {
        ...a,
        id,
        position: p.clone().sub(modelCenter),
        cartesian: p.toArray(),
      };
    });
    buildCoordination();
    selection = atoms.filter(
      (a) => selectedKeys.includes(atomKey(a)) && atomVisible(a),
    );
    const byElement = new Map();
    atoms.forEach((a) => {
      if (!byElement.has(a.element)) byElement.set(a.element, []);
      byElement.get(a.element).push(a);
    });
    const sphere = new THREE.SphereGeometry(1, ...sphereDetail(atoms.length)),
      matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3(),
      tint = new THREE.Color();
    for (const [e, list] of byElement) {
      // One instanced mesh per element; per-copy colours ride on the
      // instance colour attribute (material colour stays white).
      const mesh = new THREE.InstancedMesh(
        sphere.clone(),
        atomMaterial(0xffffff),
        list.length,
      );
      mesh.visible = atomVisible(list[0]);
      mesh.userData.atoms = list;
      list.forEach((a, i) => {
        a.radius = atomRadius(a);
        a.color = styleOf(a).color;
        matrix.compose(a.position, rotation, scale.setScalar(a.radius));
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tint.set(a.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      model.add(mesh);
      meshes.push(mesh);
    }
    sphere.dispose();
    fitBounds = new THREE.Box3().setFromPoints(
      corners.map((p) => p.clone().sub(modelCenter)),
    );
    for (const atom of atoms) {
      fitBounds.expandByPoint(atom.position.clone().addScalar(atom.radius));
      fitBounds.expandByPoint(atom.position.clone().addScalar(-atom.radius));
    }
    // Enlarged polyhedra (display scale > 100%) reach past their ligand
    // atoms; their drawn vertices count when fitting the view.
    for (const faces of faceMeshes.values()) {
      if (!faces.visible) continue;
      faces.geometry.computeBoundingBox();
      fitBounds.union(faces.geometry.boundingBox);
    }
    const points = rangeEdges(plotRanges).map((p) => cart(p).sub(modelCenter));
    cellLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: 0x7fa6c5,
        transparent: true,
        opacity: 0.48,
      }),
    );
    cellLines.visible = $("cell").checked;
    model.add(cellLines);
    fitDistance = Math.max(box.getSize(new THREE.Vector3()).length(), 2) * 1.65;
    controls.maxDistance = fitDistance * 12;
    controls.minDistance = fitDistance * 0.08;
    camera.near = Math.max(fitDistance / 1000, 0.001);
    camera.far = fitDistance * 100;
    camera.updateProjectionMatrix();
    updateAtomSummary();
    updateSelection();
    updatePickMarker();
    invalidate();
  }
  // Unobtrusive marker for an individually picked appearance target: a
  // thin amber shell around the atom, or amber edges on the polyhedron.
  // Shown only while the Appearance editor is open.
  const pickGroup = new THREE.Group();
  scene.add(pickGroup);
  function updatePickMarker(target = styleEditor?.open ? styleEditor.target : null) {
    dispose(pickGroup);
    pickGroup.clear();
    const value = target || "";
    if (value.startsWith("atom:")) {
      const key = value.slice(5);
      const atom = atoms.find((a) => atomKey(a) === key && atomVisible(a));
      if (atom) {
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(atom.radius * 1.09, 48, 32),
          new THREE.MeshBasicMaterial({
            color: 0xffc46b,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.85,
          }),
        );
        shell.position.copy(atom.position);
        pickGroup.add(shell);
      }
    } else if (value.startsWith("poly:")) {
      const [ruleId, key] = value.slice(5).split("|");
      const faces = faceMeshes.get(Number(ruleId));
      const owner = faces?.userData.hulls.findIndex((h) => atomKey(h.center) === key);
      if (faces?.visible && owner >= 0) {
        const { center, vertices, hull } = faces.userData.hulls[owner];
        const s = faces.userData.styles[owner].scale;
        const points = hull.edges.flatMap((edge) =>
          edge.map((i) =>
            vertices[i].position
              .clone()
              .sub(center.position)
              .multiplyScalar(s)
              .add(center.position),
          ),
        );
        const edges = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: 0xffc46b,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          }),
        );
        edges.renderOrder = 6;
        pickGroup.add(edges);
      }
    }
    invalidate();
  }
  function resetRules() {
    nextRule = 0;
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    const cutoffs = { Si: 2.1, Mg: 2.6, Al: 2.3, Fe: 2.7, Ca: 3.0, Ti: 2.5 };
    rules = elements.includes("O")
      ? elements
          .filter((e) => cutoffs[e])
          .map((e) => ({
            id: ++nextRule,
            center: e,
            neighbor: "O",
            cutoff: cutoffs[e],
            bonds: false,
            polyhedra: false,
            opacity: 0.34,
          }))
      : [];
    rules.sort((a, b) => (a.center === "Si" ? -1 : b.center === "Si" ? 1 : 0));
    const preset = !currentFilename || currentFilename === "Forsterite example";
    if (
      preset &&
      new URLSearchParams(location.search).get("example") === "forsterite"
    ) {
      rules = rules.filter((r) => r.center === "Si" || r.center === "Mg");
      rules.forEach((r) => {
        r.cutoff = r.center === "Si" ? 1.8 : 2.3;
        r.polyhedra = true;
      });
      $("polyhedra-only").checked = true;
      $("boundary").checked = false;
    } else if (currentFilename === "Wollastonite example") {
      rules = rules.filter((r) => r.center === "Si");
      rules.forEach((r) => {
        r.cutoff = 1.8;
        r.polyhedra = true;
      });
      $("polyhedra-only").checked = true;
      $("boundary").checked = false;
    } else $("polyhedra-only").checked = false;
    renderRules();
  }
  const pairName = (rule) => `${rule.center}–${rule.neighbor}`;
  const CUTOFF_MIN = 0.1;
  // At least hundredths are always shown (1.80); typed precision is shown
  // exactly as entered (2.123456 stays 2.123456, never rounded).
  const decimals = (value) => String(value).split(".")[1]?.length ?? 0;
  const formatCutoff = (value) =>
    decimals(value) < 2 ? value.toFixed(2) : String(value);
  // Speed track: deflection from centre sets a rate, not a value. A small
  // dead zone, then an exponential curve from 0.03 Å/s (≈ one 0.01 Å step
  // every third of a second) to 2 Å/s at full deflection.
  const SPEED_DEAD_ZONE = 0.07,
    SPEED_SLOW = 0.03,
    SPEED_FAST = 2,
    SPEED_QUANTUM = 0.01;
  function speedRate(normalized) {
    const magnitude = Math.abs(normalized);
    if (magnitude <= SPEED_DEAD_ZONE) return 0;
    const u = Math.min((magnitude - SPEED_DEAD_ZONE) / (1 - SPEED_DEAD_ZONE), 1);
    return Math.sign(normalized) * SPEED_SLOW * (SPEED_FAST / SPEED_SLOW) ** u;
  }
  function parseCutoff(text) {
    const t = text.trim().replace(",", ".").replace(/\s*Å$/, "");
    if (!/^\+?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
    const value = Number(t);
    return Number.isFinite(value) && value >= CUTOFF_MIN ? value : null;
  }
  // Discrete steps are exact increments (2.15 → 2.25), floored at the minimum.
  function stepCutoff(value, sign, size = 0.1) {
    // Keep the value's own precision: 2.123456 + 0.1 → 2.223456.
    const places = Math.min(12, Math.max(decimals(value), decimals(size)));
    return Math.max(CUTOFF_MIN, Number((value + sign * size).toFixed(places)));
  }
  let openCutoffRule = null,
    pendingBuild = null,
    lastLiveBuild = 0,
    structureGeneration = 0;
  // Live cutoff/appearance changes are coalesced: at most one rebuild per
  // ~60 ms, on an animation frame, with the latest state. A rebuild queued
  // for a previous document is cancelled on load and never runs.
  function scheduleBuild() {
    if (pendingBuild) return;
    const generation = structureGeneration;
    const wait = Math.max(0, 60 - (performance.now() - lastLiveBuild));
    pendingBuild = { timer: 0, frame: 0 };
    pendingBuild.timer = setTimeout(() => {
      pendingBuild.frame = requestAnimationFrame(() => {
        pendingBuild = null;
        if (generation !== structureGeneration || !structure) return;
        lastLiveBuild = performance.now();
        build();
      });
    }, wait);
  }
  function cancelScheduledBuild() {
    if (!pendingBuild) return;
    clearTimeout(pendingBuild.timer);
    cancelAnimationFrame(pendingBuild.frame);
    pendingBuild = null;
  }
  function closeTuners(except) {
    for (const tuner of document.querySelectorAll(".cutoff-tuner:not([hidden])"))
      if (tuner !== except) tuner.close?.();
  }
  // Touch-friendly dismissal: a press anywhere outside the open pair closes
  // its tuner, but only after that press has finished (its click included).
  // Closing at press time would reflow the panel and move the control under
  // the pointer before release, so the click would land elsewhere.
  let pointerPressed = false,
    suppressTunerOpen = false,
    pendingDismiss = null;
  function finishDismiss() {
    if (!pendingDismiss) return;
    const { tuner, timer, then } = pendingDismiss;
    clearTimeout(timer);
    pendingDismiss = null;
    window.removeEventListener("click", finishDismiss);
    if (!tuner.hidden) tuner.close();
    then?.(); // e.g. open the tuner of a different cutoff field just tapped
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      pointerPressed = true;
      const open = document.querySelector(".cutoff-tuner:not([hidden])");
      if (open && !open.closest(".pair-rule").contains(e.target)) {
        finishDismiss();
        pendingDismiss = { tuner: open, timer: 0 };
      }
    },
    true,
  );
  const release = () => {
    pointerPressed = false;
    if (!pendingDismiss || pendingDismiss.timer) return;
    // Bubble-phase click on window runs after the target's own handlers.
    // Drags and presses without a click fall back to a timer long enough
    // for a delayed touch click (touchend → focus → click).
    window.addEventListener("click", finishDismiss);
    pendingDismiss.timer = setTimeout(finishDismiss, 600);
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  const make = (tag, props = {}) =>
    Object.assign(document.createElement(tag), props);
  // Each pair is one compact row: element selectors, cutoff and delete on
  // top; bond/polyhedron toggles, live face opacity and counts below.
  function renderRules() {
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    $("pair-rules").replaceChildren(
      ...rules.map((rule, index) => {
        const card = make("div", { className: "pair-rule" });
        card.dataset.ruleId = rule.id;
        card.style.setProperty("--pair-color", ruleColor(rule));
        card.setAttribute("role", "group");
        const inputs = {};
        for (const field of ["center", "neighbor", "cutoff"]) {
          let input;
          if (field === "cutoff") {
            // Plain decimal text: no tiny spinners, exact values like 2.15.
            input = make("input", {
              type: "text",
              value: formatCutoff(rule.cutoff),
              inputMode: "decimal",
              autocomplete: "off",
              spellcheck: false,
              enterKeyHint: "done",
              title: "Distance cutoff (Å) · ↑/↓ ±0.1 Å",
            });
          } else {
            input = make("select", {
              title: field === "center" ? "Center element" : "Neighbor element",
            });
            for (const e of elements)
              input.append(make("option", { value: e, textContent: e }));
            input.value = rule[field];
          }
          input.dataset.field = field;
          inputs[field] = input;
          input.onchange = () => {
            if (field === "cutoff") {
              const value = parseCutoff(input.value);
              input.setCustomValidity(
                value === null ? `Enter a cutoff of at least ${CUTOFF_MIN} Å.` : "",
              );
              if (value === null) {
                input.reportValidity();
                return;
              }
              setCutoff(value, false);
              return;
            }
            rule[field] = input.value;
            label();
            build();
          };
        }
        const remove = make("button", {
          type: "button",
          className: "icon-button",
          textContent: "✕",
        });
        remove.onclick = () => {
          rules = rules.filter((r) => r !== rule);
          renderRules();
          build();
        };
        const dash = make("span", { className: "dash", textContent: "–" });
        dash.setAttribute("aria-hidden", "true");
        const cutoff = make("label", { className: "pair-cutoff" });
        const cutoffCaption = make("span", {
          className: "micro",
          textContent: "cutoff Å",
        });
        cutoffCaption.setAttribute("aria-hidden", "true");
        cutoff.append(cutoffCaption, inputs.cutoff);
        const main = make("div", { className: "pair-main" });
        main.append(inputs.center, dash, inputs.neighbor, cutoff, remove);
        // Cutoff tuner: opens directly below the field with a spring-loaded
        // speed track and exact ±0.1 Å buttons. A first touch opens it
        // without raising the software keyboard; a second tap focuses the
        // field for exact typing.
        const field = inputs.cutoff;
        const tuner = make("div", {
          className: "cutoff-tuner",
          id: `pair-cutoff-tuner-${rule.id}`,
          hidden: true,
        });
        const row = make("div", { className: "tuner-row" });
        const track = make("div", { className: "speed-track", tabIndex: 0 });
        track.dataset.field = "cutoff-speed";
        track.setAttribute("role", "slider");
        const hint = make("p", {
          className: "tuner-hint",
          id: `pair-cutoff-hint-${rule.id}`,
          textContent: "Hold & drag · farther = faster · ←/→ ±0.01 Å",
        });
        track.setAttribute("aria-describedby", hint.id);
        const knob = make("span", { className: "speed-knob" });
        const fill = make("span", { className: "speed-fill" });
        for (const [cls, text] of [
          ["slow-left", "−"],
          ["slow-right", "+"],
        ]) {
          const mark = make("span", { className: `speed-mark ${cls}`, textContent: text });
          mark.setAttribute("aria-hidden", "true");
          track.append(mark);
        }
        knob.setAttribute("aria-hidden", "true");
        fill.setAttribute("aria-hidden", "true");
        track.append(fill, knob);
        const stepButton = (sign) => {
          const button = make("button", {
            type: "button",
            className: "step-button",
            textContent: sign < 0 ? "−" : "+",
          });
          button.onclick = () => setCutoff(stepCutoff(rule.cutoff, sign), true);
          return button;
        };
        const down = stepButton(-1),
          up = stepButton(1);
        const done = make("button", {
          type: "button",
          className: "icon-button done-button",
          textContent: "✓",
          title: "Close",
        });
        row.append(down, track, up, done);
        tuner.append(row, hint);
        field.setAttribute("aria-controls", tuner.id);
        field.setAttribute("aria-expanded", "false");
        const syncSlider = () => {
          track.setAttribute("aria-valuenow", String(rule.cutoff));
          track.setAttribute("aria-valuemin", String(CUTOFF_MIN));
          track.setAttribute("aria-valuetext", `${formatCutoff(rule.cutoff)} Å`);
        };
        // Drag state. The rate loop runs on animation frames with a capped
        // time step, so it is independent of pointer-event cadence and never
        // catches up after a stalled or background tab.
        let drag = null;
        function showDeflection(px) {
          track.style.setProperty("--deflect", `${px}px`);
          fill.style.left = px < 0 ? `calc(50% - ${-px}px)` : "50%";
          fill.style.width = `${Math.abs(px)}px`;
          track.classList.toggle("dragging", Boolean(drag));
        }
        function stopDrag() {
          if (!drag) return;
          cancelAnimationFrame(drag.frame);
          if (track.hasPointerCapture?.(drag.pointer))
            track.releasePointerCapture(drag.pointer);
          drag = null;
          window.removeEventListener("blur", stopDrag);
          document.removeEventListener("visibilitychange", stopOnHidden);
          showDeflection(0); // springs back via CSS transition
        }
        const stopOnHidden = () => {
          if (document.hidden) stopDrag();
        };
        function tick(now) {
          if (!drag) return;
          if (!track.isConnected || tuner.hidden) return stopDrag();
          const dt = Math.min((now - drag.last) / 1000, 0.05);
          drag.last = now;
          const half = track.clientWidth / 2 || 1;
          const rate = drag.moved ? speedRate(drag.offset / half) : 0;
          if (rate) {
            drag.carry += rate * dt;
            let value = rule.cutoff;
            while (Math.abs(drag.carry) >= SPEED_QUANTUM) {
              const sign = Math.sign(drag.carry);
              drag.carry -= sign * SPEED_QUANTUM;
              value = stepCutoff(value, sign, SPEED_QUANTUM);
              if (value <= CUTOFF_MIN) {
                drag.carry = 0;
                break;
              }
            }
            if (value !== rule.cutoff) setCutoff(value, true);
          } else drag.carry = 0;
          drag.frame = requestAnimationFrame(tick);
        }
        track.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || drag) return;
          e.preventDefault(); // no text selection, scrolling or focus jump
          track.focus({ preventScroll: true });
          track.setPointerCapture(e.pointerId);
          const rect = track.getBoundingClientRect();
          drag = {
            pointer: e.pointerId,
            centre: rect.left + rect.width / 2,
            startX: e.clientX,
            offset: 0,
            moved: false,
            carry: 0,
            last: performance.now(),
            frame: 0,
          };
          window.addEventListener("blur", stopDrag);
          document.addEventListener("visibilitychange", stopOnHidden);
          drag.frame = requestAnimationFrame(tick);
        });
        track.addEventListener("pointermove", (e) => {
          if (!drag || e.pointerId !== drag.pointer) return;
          // Nothing changes until the pointer actually moves, so pressing
          // never jumps the value.
          if (!drag.moved && Math.abs(e.clientX - drag.startX) < 3) return;
          drag.moved = true;
          const half = track.clientWidth / 2;
          drag.offset = Math.max(-half, Math.min(half, e.clientX - drag.centre));
          showDeflection(drag.offset);
        });
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
          track.addEventListener(type, (e) => {
            if (drag && e.pointerId === drag.pointer) stopDrag();
          });
        track.addEventListener("keydown", (e) => {
          const fine = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
          const coarse = { PageDown: -1, PageUp: 1 }[e.key];
          if (fine || coarse) {
            e.preventDefault();
            setCutoff(stepCutoff(rule.cutoff, fine || coarse, fine ? 0.01 : 0.1), true);
          }
        });
        function setCutoff(value, live) {
          rule.cutoff = value;
          field.value = formatCutoff(value);
          field.setCustomValidity("");
          syncSlider();
          if (live) scheduleBuild();
          else build();
        }
        const openTuner = () => {
          if (!tuner.hidden || suppressTunerOpen) return;
          // Another pair's tuner is being dismissed by this very press:
          // switch only after the click is delivered, in one reflow.
          if (pendingDismiss && pendingDismiss.tuner !== tuner) {
            pendingDismiss.then = openTuner;
            return;
          }
          closeTuners(tuner);
          syncSlider();
          tuner.hidden = false;
          field.setAttribute("aria-expanded", "true");
          card.classList.add("tuning");
          openCutoffRule = rule.id;
        };
        tuner.close = () => {
          stopDrag();
          tuner.hidden = true;
          field.setAttribute("aria-expanded", "false");
          card.classList.remove("tuning");
          if (openCutoffRule === rule.id) openCutoffRule = null;
        };
        // Any press on a closed field opens its tuner. Touch/pen open it
        // without focusing (no software keyboard; a second tap types);
        // a mouse press also places the caret for exact editing, even
        // when the field already has focus (e.g. after Done).
        //
        // Touch/pen: the tuner opens only once this tap's click has been
        // delivered to the field. Opening at pointerdown grew the portrait
        // dock under the finger, so the compatibility click landed on the
        // newly exposed "+" and changed the cutoff. Long holds without a
        // click open after a clean release; pans and cancels never open.
        let touchOpen = null;
        const openFromTouch = () => {
          if (!touchOpen) return;
          clearTimeout(touchOpen.timer);
          touchOpen = null;
          openTuner();
        };
        field.addEventListener("pointerdown", (e) => {
          if (!tuner.hidden) return;
          if (e.pointerType === "mouse") {
            openTuner();
            return;
          }
          e.preventDefault(); // no focus, so no software keyboard yet
          clearTimeout(touchOpen?.timer);
          touchOpen = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0 };
        });
        field.addEventListener("pointerup", (e) => {
          if (!touchOpen || e.pointerId !== touchOpen.id) return;
          if (Math.hypot(e.clientX - touchOpen.x, e.clientY - touchOpen.y) > 10) {
            touchOpen = null;
            return;
          }
          touchOpen.timer = setTimeout(openFromTouch, 400);
        });
        field.addEventListener("pointercancel", () => {
          clearTimeout(touchOpen?.timer);
          touchOpen = null;
        });
        field.addEventListener("click", openFromTouch);
        field.addEventListener("focus", openTuner);
        field.addEventListener("keydown", (e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const typed = parseCutoff(field.value) ?? rule.cutoff;
            openTuner();
            setCutoff(stepCutoff(typed, e.key === "ArrowUp" ? 1 : -1), true);
          } else if (e.key === "Escape") tuner.close();
        });
        // Returning focus to the field after Done/Escape must not reopen it.
        const closeAndRefocus = () => {
          tuner.close();
          suppressTunerOpen = true;
          field.focus({ preventScroll: true });
          suppressTunerOpen = false;
        };
        done.onclick = closeAndRefocus;
        tuner.addEventListener("keydown", (e) => {
          if (e.key === "Escape") closeAndRefocus();
        });
        // Keyboard focus leaving the pair closes the tuner. Pointer presses
        // are handled by the deferred outside-press logic instead, so the
        // panel does not reflow under a control between press and release.
        card.addEventListener("focusout", (e) => {
          // Touch moves focus after pointerup/touchend, so also wait while
          // a deferred outside-press dismissal for this tuner is pending.
          if (pointerPressed || pendingDismiss?.tuner === tuner) return;
          if (e.relatedTarget && !card.contains(e.relatedTarget)) tuner.close();
        });
        if (openCutoffRule === rule.id) {
          openCutoffRule = null;
          openTuner();
        }
        const sub = make("div", { className: "pair-sub" });
        const toggles = {};
        for (const field of ["bonds", "polyhedra"]) {
          const chip = make("label", { className: "chip small" });
          const input = make("input", {
            type: "checkbox",
            checked: rule[field],
          });
          input.dataset.field = field;
          toggles[field] = input;
          input.onchange = () => {
            if (
              field === "polyhedra" &&
              input.checked &&
              !rules.some((r) => r.polyhedra)
            )
              $("polyhedra-only").checked = true;
            rule[field] = input.checked;
            card.classList.toggle("no-faces", !rule.polyhedra);
            build();
          };
          chip.append(
            input,
            make("span", {
              textContent: field === "bonds" ? "Bonds" : "Polyhedra",
            }),
          );
          sub.append(chip);
        }
        const opacityLabel = make("label", { className: "polyhedra-opacity" });
        const opacityValue = make("output", {
          id: `pair-opacity-value-${rule.id}`,
        });
        const opacityInput = make("input", {
          type: "range",
          min: "0",
          max: "100",
          step: "1",
          value: Math.round((rule.opacity ?? 0.34) * 100),
          id: `pair-opacity-${rule.id}`,
          title: "Polyhedron face opacity",
        });
        opacityInput.dataset.field = "opacity";
        opacityInput.setAttribute("aria-describedby", opacityValue.id);
        opacityValue.htmlFor = opacityInput.id;
        const showOpacity = () => {
          opacityValue.value = `${opacityInput.value}%`;
          opacityInput.setAttribute("aria-valuetext", `${opacityInput.value}%`);
        };
        opacityInput.oninput = () => {
          rule.opacity = Number(opacityInput.value) / 100;
          showOpacity();
          const stat = coordinationStats.find((s) => s.id === rule.id);
          if (stat) stat.opacity = rule.opacity;
          const mesh = faceMeshes.get(rule.id);
          if (mesh) setFaceOpacity(mesh, rule.opacity);
          invalidate();
        };
        showOpacity();
        const opacityCaption = make("span", {
          className: "caption",
          textContent: "Opacity",
        });
        opacityCaption.setAttribute("aria-hidden", "true");
        opacityLabel.append(opacityCaption, opacityInput, opacityValue);
        sub.append(opacityLabel);
        const counts = make("p", {
          className: "pair-counts",
          id: `pair-count-${rule.id}`,
        });
        function label() {
          const name = pairName(rule);
          card.setAttribute("aria-label", `${name} pair`);
          inputs.center.setAttribute("aria-label", `${name} center element`);
          inputs.neighbor.setAttribute("aria-label", `${name} neighbor element`);
          inputs.cutoff.setAttribute(
            "aria-label",
            `${name} distance cutoff (Å)`,
          );
          track.setAttribute(
            "aria-label",
            `${name} cutoff speed control (Å)`,
          );
          down.setAttribute("aria-label", `Decrease ${name} cutoff by 0.1 Å`);
          up.setAttribute("aria-label", `Increase ${name} cutoff by 0.1 Å`);
          done.setAttribute("aria-label", `Close ${name} cutoff slider`);
          remove.setAttribute("aria-label", `Delete ${name} pair`);
          remove.title = `Delete ${name}`;
          toggles.bonds.setAttribute("aria-label", `${name} bonds`);
          toggles.polyhedra.setAttribute("aria-label", `${name} polyhedra`);
          opacityInput.setAttribute(
            "aria-label",
            `${rule.center} to ${rule.neighbor} polyhedra face opacity`,
          );
        }
        label();
        card.classList.toggle("no-faces", !rule.polyhedra);
        card.append(main, tuner, sub, counts);
        return card;
      }),
    );
    styleEditor?.refresh();
  }
  $("add-rule").onclick = () => {
    if (!structure) return;
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    rules.push({
      id: ++nextRule,
      center: elements.find((e) => e !== "O") || elements[0],
      neighbor: elements.includes("O") ? "O" : elements.at(-1),
      cutoff: 2.5,
      bonds: false,
      polyhedra: false,
      opacity: 0.34,
    });
    renderRules();
    build();
  };
  $("polyhedra-only").onchange = () => {
    if (structure) build();
  };
  function setFaceOpacity(mesh, opacity) {
    mesh.visible = opacity > 0;
    mesh.material.opacity = opacity;
    const transparencyChanged = mesh.material.transparent !== opacity < 1;
    mesh.material.transparent = opacity < 1;
    mesh.material.depthWrite = opacity === 1;
    if (transparencyChanged) mesh.material.needsUpdate = true;
  }
  function updateAtomSummary() {
    const visible = atoms.filter(atomVisible).length;
    const hidden = atoms.length - visible;
    $("atom-summary").textContent =
      `${visible.toLocaleString()} visible atoms${hidden ? ` · ${hidden.toLocaleString()} hidden` : ""}`;
  }
  function updateAtomVisibility() {
    meshes.forEach((mesh) => {
      mesh.visible = atomVisible(mesh.userData.atoms[0]);
    });
    selection = selection.filter(atomVisible);
    updateSelection();
    updateAtomSummary();
    invalidate();
  }
  $("show-atoms").onchange = updateAtomVisibility;
  function buildCoordination() {
    const base = [...atoms];
    const all = new Map(base.map((a) => [atomKey(a), a]));
    const used = new Set();
    const plans = [];
    const bondKeys = new Set();
    coordinationStats = [];
    let polyhedronCount = 0;
    const ensure = (neighbor) => {
      const atom = {
        ...neighbor.atom,
        sourceIndex: neighbor.sourceIndex,
        frac: neighbor.frac,
        cartesian: neighbor.cartesian,
        position: new THREE.Vector3(...neighbor.cartesian).sub(modelCenter),
      };
      const key = atomKey(atom);
      if (!all.has(key)) all.set(key, atom);
      return all.get(key);
    };
    for (const [index, rule] of rules.entries()) {
      const stat = {
        ...rule,
        counts: [],
        environments: [],
        siteCounts: {},
        bondCount: 0,
        polyhedronCount: 0,
        outsideAtomCount: 0,
      };
      const plan = {
        color: ruleColor(rule),
        rule,
        hulls: [],
        bonds: [],
        stat,
      };
      if (rule.bonds || rule.polyhedra) {
        try {
          const environments = buildCoordinationEnvironments({
            basis: structure.basis,
            atoms: structure.atoms,
            centres: base,
            centerElement: rule.center,
            neighborElement: rule.neighbor,
            cutoff: rule.cutoff,
          });
          stat.counts = [
            ...new Set(environments.map((e) => e.neighbors.length)),
          ].sort((a, b) => a - b);
          stat.centerCount = environments.length;
          for (const env of environments) {
            const label = env.center.label || env.center.element;
            stat.siteCounts[label] ||= [];
            if (!stat.siteCounts[label].includes(env.neighbors.length))
              stat.siteCounts[label].push(env.neighbors.length);
            const vertices = env.neighbors.map(ensure);
            const hull = rule.polyhedra
              ? convexHull(vertices.map((a) => a.cartesian))
              : null;
            if (hull) plan.hulls.push({ center: env.center, vertices, hull });
            if (rule.bonds)
              for (const atom of vertices) plan.bonds.push([env.center, atom]);
          }
          // Publish a rule only after all its geometry has succeeded.
          for (const item of plan.hulls) {
            const indices = [...new Set(item.hull.faces.flat())];
            used.add(atomKey(item.center));
            indices.forEach((i) => used.add(atomKey(item.vertices[i])));
            stat.environments.push({
              center: atomKey(item.center),
              vertices: indices.map((i) => atomKey(item.vertices[i])),
              edgeCount: item.hull.edges.length,
              faceCount: item.hull.faces.length,
            });
          }
          stat.polyhedronCount = plan.hulls.length;
          polyhedronCount += plan.hulls.length;
          plans.push(plan);
        } catch (error) {
          stat.error = error.message;
        }
      }
      coordinationStats.push(stat);
    }
    const enabledPolyhedra = rules.some((rule) => rule.polyhedra);
    const isolated = $("polyhedra-only").checked && enabledPolyhedra;
    const visible = new Map((isolated ? [] : base).map((a) => [atomKey(a), a]));
    for (const key of used) visible.set(key, all.get(key));
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const plan of plans) {
      const acceptedBonds = [];
      for (const bond of plan.bonds) {
        if (isolated && bond.some((a) => !used.has(atomKey(a)))) continue;
        const key = bond.map(atomKey).sort().join("|");
        if (bondKeys.has(key)) continue;
        bondKeys.add(key);
        acceptedBonds.push(bond);
        bond.forEach((a) => visible.set(atomKey(a), a));
      }
      plan.stat.bondCount = acceptedBonds.length;
      const participating = new Set(
        plan.stat.environments.flatMap((env) => [env.center, ...env.vertices]),
      );
      acceptedBonds.flat().forEach((atom) => participating.add(atomKey(atom)));
      plan.stat.outsideAtomCount = [...participating].filter((key) =>
        all
          .get(key)
          ?.frac.some(
            (v, i) =>
              v < plotRanges[i][0] - 1e-8 || v > plotRanges[i][1] + 1e-8,
          ),
      ).length;
      if (acceptedBonds.length) {
        const cylinders = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(1, 1, 1, 8),
          new THREE.MeshStandardMaterial({
            color: plan.color,
            roughness: 0.55,
          }),
          acceptedBonds.length,
        );
        acceptedBonds.forEach(([a, b], i) => {
          const delta = b.position.clone().sub(a.position);
          const midpoint = a.position
            .clone()
            .add(b.position)
            .multiplyScalar(0.5);
          scale.set(0.045, delta.length(), 0.045);
          rotation.setFromUnitVectors(up, delta.normalize());
          matrix.compose(midpoint, rotation, scale);
          cylinders.setMatrixAt(i, matrix);
        });
        cylinders.instanceMatrix.needsUpdate = true;
        model.add(cylinders);
      }
      // All polyhedra of a pair share one face mesh and one edge mesh.
      // Per-polyhedron colour is a vertex colour; per-polyhedron display
      // scale moves face and edge vertices together toward the central
      // atom. Atom positions themselves are never moved.
      const positions = [],
        faceColors = [],
        edges = [],
        edgeColors = [],
        owners = [],
        styles = [],
        tint = new THREE.Color(),
        point = new THREE.Vector3();
      plan.hulls.forEach(({ center, vertices, hull }, owner) => {
        const key = atomKey(center);
        const style = polyhedronStyle(appearance, plan.rule, key, plan.color);
        styles.push({ center: key, color: style.color, scale: style.scale });
        tint.set(style.color);
        const place = (atom) =>
          point
            .copy(atom.position)
            .sub(center.position)
            .multiplyScalar(style.scale)
            .add(center.position);
        for (const face of hull.faces) {
          owners.push(owner);
          for (const i of face) {
            positions.push(...place(vertices[i]).toArray());
            faceColors.push(tint.r, tint.g, tint.b);
          }
        }
        for (const edge of hull.edges)
          for (const i of edge) {
            edges.push(...place(vertices[i]).toArray());
            edgeColors.push(tint.r, tint.g, tint.b);
          }
      });
      if (positions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(faceColors, 3),
        );
        geometry.computeVertexNormals();
        const faces = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: true,
            side: THREE.DoubleSide,
            roughness: 0.8,
          }),
        );
        setFaceOpacity(faces, plan.stat.opacity ?? 0.34);
        faces.userData.rule = plan.rule;
        faces.userData.color = plan.color;
        faces.userData.owners = owners;
        faces.userData.hulls = plan.hulls;
        faces.userData.styles = styles;
        faceMeshes.set(plan.stat.id, faces);
        model.add(faces);
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(edges, 3),
        );
        edgeGeometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(edgeColors, 3),
        );
        const outline = new THREE.LineSegments(
          edgeGeometry,
          new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
          }),
        );
        faces.userData.outline = outline;
        model.add(outline);
      }
    }
    atoms = [...visible.values()];
    atoms.forEach((a, i) => {
      a.id = i;
    });
    const outside = atoms.filter((a) =>
      a.frac.some(
        (v, i) => v < plotRanges[i][0] - 1e-8 || v > plotRanges[i][1] + 1e-8,
      ),
    ).length;
    coordinationTotals = {
      bondCount: bondKeys.size,
      polyhedronCount,
      outsideAtomCount: outside,
    };
    for (const stat of coordinationStats) {
      const p = $(`pair-count-${stat.id}`);
      if (!p) continue;
      const siteCounts = Object.entries(stat.siteCounts)
        .map(([label, counts]) => `${label}: ${counts.join(", ")}`)
        .join(" · ");
      p.title = siteCounts ? `Neighbors per site · ${siteCounts}` : "";
      p.classList.toggle("error", Boolean(stat.error));
      p.textContent =
        stat.error ||
        (!(stat.bonds || stat.polyhedra)
          ? "Off · enable bonds or polyhedra"
          : `CN ${stat.counts.join(", ") || "0"} · ${stat.centerCount || 0} centers · ${stat.polyhedronCount} poly · ${stat.bondCount} bonds`);
    }
    const note = $("isolation-note");
    note.textContent =
      isolated && !polyhedronCount
        ? "No complete polyhedra at these cutoffs."
        : rules.length
          ? ""
          : "Add a pair to draw bonds or polyhedra.";
    note.hidden = !note.textContent;
  }
  function orient(indices, viewId = "uvw") {
    if (!structure) return;
    try {
      const { direction, up } = latticeViewDirection(structure.basis, indices);
      const target = controls.target.clone();
      const zoomDistance = camera.position.distanceTo(target);
      const dir = new THREE.Vector3(...direction).normalize();
      stopMotion();
      camera.up.set(...up);
      camera.position.copy(target).addScaledVector(dir, zoomDistance);
      controls.update();
      setActiveView(viewId, dir);
      $("direction-error").textContent = "";
      invalidate();
    } catch (error) {
      $("direction-error").textContent = error.message;
    }
  }
  for (const [axis, indices] of [
    ["a", [1, 0, 0]],
    ["b", [0, 1, 0]],
    ["c", [0, 0, 1]],
  ]) {
    $(`view-${axis}`).onclick = () => orient(indices, axis);
  }
  setActiveView(null);
  $("direction-form").onsubmit = (event) => {
    event.preventDefault();
    const text = $("view-direction")
      .value.replace(/−/g, "-")
      .replace(/[\[\](),]/g, " ")
      .trim();
    // Compact notation is restricted to three single-digit indices so a
    // multi-digit component remains unambiguous when separated by spaces.
    const fields = /^[+-]?\d[+-]?\d[+-]?\d$/.test(text)
      ? text.match(/[+-]?\d/g)
      : text.split(/\s+/);
    if (
      fields.length !== 3 ||
      fields.some((value) => !Number.isFinite(Number(value)))
    ) {
      $("direction-error").textContent =
        "Enter three finite components, such as 1 0 −1, or compact single-digit indices like [110] or [1-10].";
      return;
    }
    orient(fields.map(Number));
  };
  function overlayReserve() {
    const view = viewport.getBoundingClientRect();
    const top = document.querySelector(".view-top").getBoundingClientRect();
    const bottom = document
      .querySelector(".view-bottom")
      .getBoundingClientRect();
    return Math.max(top.bottom - view.top, view.bottom - bottom.top, 0);
  }
  function reset(keepOrientation = false) {
    if (!keepOrientation) selection = [];
    updateSelection();
    const sphere = fitBounds.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    // Canvas toolbars sit along the top and bottom edges; fit the crystal
    // between them so no control covers it after a reset.
    const height = viewport.clientHeight || 1;
    const usable = Math.max(height - 2 * overlayReserve(), height * 0.7);
    const clearVertical = Math.atan((Math.tan(vertical) * usable) / height);
    fitDistance =
      (Math.max(sphere.radius, 1) /
        Math.sin(Math.min(clearVertical, horizontal))) *
      1.05;
    const target = sphere.center;
    const direction = keepOrientation
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(0.68, 0.48, 0.8).normalize();
    stopMotion();
    if (!keepOrientation) camera.up.set(0, 1, 0);
    camera.position.copy(target).addScaledVector(direction, fitDistance);
    controls.target.copy(target);
    controls.maxDistance = fitDistance * 12;
    controls.minDistance = fitDistance * 0.03;
    camera.near = Math.max(fitDistance / 1000, 0.001);
    camera.far = fitDistance * 100;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  function updateSelection() {
    dispose(selectionGroup);
    selectionGroup.clear();
    // Selection is a crisp back-face shell: from any direction it reads as
    // an even halo around the atom's silhouette and never covers its face.
    for (const a of selection) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(a.radius * 1.13, 64, 48),
        new THREE.MeshBasicMaterial({
          color: 0x79ffdc,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.92,
        }),
      );
      halo.position.copy(a.position);
      selectionGroup.add(halo);
    }
    distance = null;
    if (selection.length === 2) {
      distance = selection[0].position.distanceTo(selection[1].position);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          selection.map((a) => a.position),
        ),
        new THREE.LineDashedMaterial({
          color: 0x79ffdc,
          depthTest: false,
          dashSize: Math.max(distance / 24, 0.04),
          gapSize: Math.max(distance / 48, 0.02),
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 5;
      selectionGroup.add(line);
    }
    const picking = Boolean(styleEditor?.picking);
    $("measure-overlay").classList.toggle("active", selection.length > 0 || picking);
    $("measure-overlay").classList.toggle("picking", picking);
    $("clear").disabled = !selection.length;
    $("distance").replaceChildren(
      document.createTextNode(
        distance === null ? "— " : `${distance.toFixed(4)} `,
      ),
      Object.assign(document.createElement("span"), { textContent: "Å" }),
    );
    $("selection").textContent = picking
      ? "Style picking: tap one atom or polyhedron."
      : selection.length
      ? selection.map((a) => a.label).join(" ↔ ") +
        (selection.length === 1 ? " · tap a second atom" : "")
      : $("show-atoms").checked
        ? "Tap two atoms to measure."
        : "Show atoms to measure.";
    $("selection").title = selection
      .map((a) => `${a.label} [${a.frac.map((v) => v.toFixed(4)).join(", ")}]`)
      .join("\n");
    invalidate();
  }
  // Right-button grab panning, 1:1 with the pointer. Runs in the capture
  // phase on the canvas, ahead of TrackballControls, which never sees the
  // right button. The rendered camera is orthographic with a visible
  // height of 2·d·tan(fov/2) world units over the canvas's CSS height, so
  // one CSS pixel of pointer motion moves the camera (and target) by that
  // many world units along the view's right/up axes: the grabbed point
  // stays under the cursor at any zoom, orientation, aspect or DPI.
  // Movement stops on release; there is no inertia.
  let pan = null;
  const panRight = new THREE.Vector3(),
    panUp = new THREE.Vector3();
  function endPan(e) {
    if (!pan || (e && e.pointerId !== pan.id)) return;
    const { id } = pan;
    pan = null;
    if (renderer.domElement.hasPointerCapture(id))
      renderer.domElement.releasePointerCapture(id);
    e?.stopImmediatePropagation();
  }
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 2 || e.pointerType !== "mouse" || pan) return;
      e.stopImmediatePropagation(); // Trackball and atom picking ignore it
      e.preventDefault();
      stopMotion(); // cancel any rotation/zoom inertia first
      renderer.domElement.setPointerCapture(e.pointerId);
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    true,
  );
  renderer.domElement.addEventListener(
    "pointermove",
    (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      e.stopImmediatePropagation();
      const dx = e.clientX - pan.x,
        dy = e.clientY - pan.y;
      pan.x = e.clientX;
      pan.y = e.clientY;
      if (!dx && !dy) return;
      const height = renderer.domElement.getBoundingClientRect().height || 1;
      const worldPerPixel =
        (2 *
          camera.position.distanceTo(controls.target) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
        height;
      camera.updateMatrixWorld();
      panRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      panUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      // Content follows the cursor, so the camera moves the opposite way.
      const shift = panRight
        .multiplyScalar(-dx * worldPerPixel)
        .addScaledVector(panUp, dy * worldPerPixel);
      camera.position.add(shift);
      controls.target.add(shift);
      invalidate();
    },
    true,
  );
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    renderer.domElement.addEventListener(type, endPan, true);
  window.addEventListener("blur", () => endPan());
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    active = new Set();
  let down = null,
    multi = false;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    active.add(e.pointerId);
    if (active.size > 1) {
      multi = true;
      down = null;
    } else {
      multi = false;
      down = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
      };
    }
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (active.size) invalidate();
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6)
      down = null;
  });
  renderer.domElement.addEventListener("pointercancel", (e) => {
    active.delete(e.pointerId);
    down = null;
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    active.delete(e.pointerId);
    if (!down || multi || down.id !== e.pointerId || e.button !== 0) {
      down = null;
      return;
    }
    down = null;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    syncViewCamera();
    raycaster.setFromCamera(pointer, viewCamera);
    // Explicit appearance picking replaces distance picking while active.
    if (styleEditor.picking) {
      pickStyleTarget();
      return;
    }
    if (!$("show-atoms").checked) return;
    const hit = raycaster.intersectObjects(
      meshes.filter((mesh) => mesh.visible),
      false,
    )[0];
    if (hit) {
      const atom = hit.object.userData.atoms[hit.instanceId];
      if (selection.length === 2) selection = [];
      if (!selection.includes(atom)) selection.push(atom);
      updateSelection();
    }
  });
  // ---- Appearance editor host -------------------------------------------
  // Targets: "element:Mg", "pair:<rule id>", "atom:<atom key>",
  // "poly:<rule id>|<centre atom key>". Picked individuals keep their
  // element, label and rule in `targetMeta`, so they stay editable while a
  // range or cutoff change temporarily removes that copy.
  const targetMeta = new Map();
  const fracText = (a) => `[${a.frac.map((v) => v.toFixed(3)).join(", ")}]`;
  const ruleById = (id) => rules.find((r) => String(r.id) === String(id));
  function parseTarget(value) {
    const cut = value.indexOf(":");
    return { type: value.slice(0, cut), id: value.slice(cut + 1) };
  }
  function restyle(final) {
    if (final) {
      cancelScheduledBuild();
      build();
    } else scheduleBuild();
  }
  function merge(map, key, patch) {
    map.set(key, { ...map.get(key), ...patch });
  }
  function refreshElementDot(element) {
    const dot = document.querySelector(`[data-element="${element}"] .dot`);
    if (dot) dot.style.background = colorFor(element);
  }
  function refreshPairColor(rule) {
    document
      .querySelector(`.pair-rule[data-rule-id="${rule.id}"]`)
      ?.style.setProperty("--pair-color", ruleColor(rule));
  }
  styleEditor = createAppearanceEditor({
    targets() {
      if (!structure) return [];
      const elements = [...new Set(structure.atoms.map((a) => a.element))];
      return [
        ...elements.map((e) => ({
          value: `element:${e}`,
          label: `${e} atoms`,
          group: "All atoms of element",
        })),
        ...rules.map((r) => ({
          value: `pair:${r.id}`,
          label: `${pairName(r)} polyhedra`,
          group: "All polyhedra of pair",
        })),
      ];
    },
    describe(value) {
      const { type, id } = parseTarget(value);
      if (type === "element") {
        const own = appearance.elements.get(id);
        return {
          title: `All ${id} atoms`,
          kind: "atom",
          color: colorFor(id),
          scale: own?.scale ?? 1,
          overridden: Boolean(own),
        };
      }
      if (type === "atom") {
        const meta = targetMeta.get(value);
        if (!meta) return null;
        const style = atomStyle(appearance, meta.element, id, defaultColor(meta.element));
        return {
          title: `${meta.label} ${meta.frac} · this copy only`,
          kind: "atom",
          ...style,
          overridden: appearance.atoms.has(id),
        };
      }
      const [ruleId, centerKey] = type === "poly" ? id.split("|") : [id];
      const rule = ruleById(ruleId);
      if (!rule) return null;
      if (type === "pair")
        return {
          title: `All ${pairName(rule)} polyhedra`,
          kind: "poly",
          color: ruleColor(rule),
          scale: rule.scale ?? 1,
          overridden: rule.color != null || rule.scale != null,
        };
      const meta = targetMeta.get(value);
      const style = polyhedronStyle(appearance, rule, centerKey, ruleColor(rule));
      return {
        title: `${pairName(rule)} polyhedron around ${meta?.label ?? "centre"} ${meta?.frac ?? ""} · this one only`,
        kind: "poly",
        ...style,
        overridden: appearance.polyhedra.has(polyKey(rule.id, centerKey)),
      };
    },
    apply(value, patch, final) {
      const { type, id } = parseTarget(value);
      if (type === "element") {
        merge(appearance.elements, id, patch);
        refreshElementDot(id);
      } else if (type === "atom") merge(appearance.atoms, id, patch);
      else if (type === "pair") {
        const rule = ruleById(id);
        if (!rule) return;
        Object.assign(rule, patch);
        refreshPairColor(rule);
      } else if (type === "poly") merge(appearance.polyhedra, id, patch);
      restyle(final);
    },
    reset(value) {
      const { type, id } = parseTarget(value);
      if (type === "element") {
        appearance.elements.delete(id);
        refreshElementDot(id);
      } else if (type === "atom") appearance.atoms.delete(id);
      else if (type === "pair") {
        const rule = ruleById(id);
        if (rule) {
          delete rule.color;
          delete rule.scale;
          refreshPairColor(rule);
        }
      } else if (type === "poly") appearance.polyhedra.delete(id);
      restyle(true);
    },
    onPickMode(active) {
      viewport.classList.toggle("style-picking", active);
      updateSelection();
    },
    // Marker follows editor visibility: cleared on close, restored on open.
    onOpen(open) {
      updatePickMarker(open ? styleEditor?.target : null);
    },
    onTarget(value) {
      updatePickMarker(value);
    },
  });
  // In explicit picking mode a tap chooses one atom copy or one
  // polyhedron. An atom wins when it is in front of the nearest face, or
  // when it is the centre of the polyhedron that face belongs to.
  function pickStyleTarget() {
    const atomHit = $("show-atoms").checked
      ? raycaster.intersectObjects(
          meshes.filter((mesh) => mesh.visible),
          false,
        )[0]
      : undefined;
    const faceHit = raycaster.intersectObjects(
      [...faceMeshes.values()].filter((mesh) => mesh.visible),
      false,
    )[0];
    const atom = atomHit?.object.userData.atoms[atomHit.instanceId];
    let poly = null;
    if (faceHit) {
      const data = faceHit.object.userData;
      const hull = data.hulls[data.owners[faceHit.faceIndex]];
      if (hull) poly = { rule: data.rule, center: hull.center };
    }
    if (
      atom &&
      (!poly ||
        atomHit.distance <= faceHit.distance ||
        atomKey(poly.center) === atomKey(atom))
    ) {
      const key = atomKey(atom);
      const value = `atom:${key}`;
      targetMeta.set(value, {
        element: atom.element,
        label: atom.label,
        frac: fracText(atom),
      });
      styleEditor.choose({ value, label: `${atom.label} ${fracText(atom)}`, group: "Picked" });
    } else if (poly) {
      const key = atomKey(poly.center);
      const value = `poly:${polyKey(poly.rule.id, key)}`;
      targetMeta.set(value, { label: poly.center.label, frac: fracText(poly.center) });
      styleEditor.choose({
        value,
        label: `${pairName(poly.rule)} around ${poly.center.label}`,
        group: "Picked",
      });
    }
  }
  function textStat(label, value) {
    const d = document.createElement("div");
    d.className = "stat";
    const s = document.createElement("span");
    s.textContent = label;
    const b = document.createElement("strong");
    b.textContent = value;
    d.append(s, b);
    return d;
  }
  function display(data) {
    // A new file or data block starts clean: queued rebuilds from the
    // previous document are cancelled and appearance overrides forgotten.
    structureGeneration++;
    cancelScheduledBuild();
    clearAppearance(appearance);
    openCutoffRule = null;
    structure = data;
    hiddenElements.clear();
    $("show-atoms").checked = true;
    $("name").textContent = data.name || data.block || "Crystal structure";
    $("source").textContent = currentFilename || "Example structure · built in";
    $("stats").replaceChildren(
      textStat("V", `${Number(data.volume).toFixed(2)} Å³`),
      textStat("Sites", data.atoms.length.toLocaleString()),
    );
    const counts = new Map();
    data.atoms.forEach((a) =>
      counts.set(a.element, (counts.get(a.element) || 0) + 1),
    );
    $("elements").replaceChildren(
      ...[...counts].map(([e, n]) => {
        const d = document.createElement("button");
        d.type = "button";
        d.className = "element";
        d.dataset.element = e;
        d.setAttribute("aria-label", `Show ${e} atoms (${n} sites)`);
        d.setAttribute("aria-pressed", "true");
        d.title = `Show or hide ${e} spheres; bonds and polyhedra stay`;
        d.onclick = () => {
          if (hiddenElements.has(e)) hiddenElements.delete(e);
          else hiddenElements.add(e);
          d.setAttribute("aria-pressed", String(!hiddenElements.has(e)));
          updateAtomVisibility();
        };
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = colorFor(e);
        const small = document.createElement("small");
        small.textContent = n;
        d.append(dot, document.createTextNode(e), small);
        return d;
      }),
    );
    $("block-wrap").hidden = data.blocks.length < 2;
    $("block").replaceChildren(
      ...data.blocks.map((b) => {
        const key = typeof b === "string" ? b : b.name || b.block;
        const o = document.createElement("option");
        o.value = key;
        o.textContent = key;
        o.selected = key === data.block;
        return o;
      }),
    );
    const warnings = data.warnings || [];
    $("warnings").hidden = !warnings.length;
    $("warnings").textContent = warnings.join(" ");
    $("warnings").title = warnings.join(" ");
    $("warnings").setAttribute("aria-expanded", "false");
    plotRanges = defaultRanges();
    if (currentFilename === "Wollastonite example") plotRanges[1] = [0, 3];
    writeRanges();
    resetRules();
    build(false);
    reset();
    if (currentFilename === "Wollastonite example") orient([0, 0, 1], "c");
    styleEditor.clear();
  }
  const worker = new Worker(new URL("./import-worker.js", import.meta.url), {
    type: "module",
  });
  let pending = [];
  let userIntent = 0;
  worker.onmessage = ({ data }) => {
    const task = pending.shift();
    if (!task || task.id !== request || task.intent !== userIntent) return;
    $("loading").hidden = true;
    $("open").disabled = false;
    $("block").disabled = false;
    if (data.error) {
      if (structure) $("block").value = structure.block;
      $("error").textContent = `Could not open this CIF: ${data.error}`;
      $("error").hidden = false;
      if (!structure) $("name").textContent = "Open a crystal structure";
      return;
    }
    currentText = task.text;
    currentFilename = task.filename;
    display(data);
  };
  worker.onerror = (e) => {
    $("loading").hidden = true;
    $("open").disabled = false;
    $("error").textContent =
      "The crystal reader could not start. Reload the viewer and try again.";
    $("error").hidden = false;
    console.error(e);
  };
  function load(text, filename, block) {
    $("error").hidden = true;
    $("loading").hidden = false;
    $("open").disabled = true;
    $("block").disabled = true;
    pending.push({ id: ++request, text, filename, intent: userIntent });
    worker.postMessage({ text, block });
  }
  $("open").onclick = () => $("file").click();
  $("file").onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const intent = ++userIntent;
      try {
        const text = await file.text();
        if (intent !== userIntent) return;
        load(text, file.name);
      } catch (err) {
        if (intent !== userIntent) return;
        $("loading").hidden = true;
        $("open").disabled = false;
        $("block").disabled = false;
        $("error").hidden = false;
        $("error").textContent = err.message;
      }
      e.target.value = "";
    }
  };
  $("block").onchange = (e) => {
    userIntent++;
    load(currentText, currentFilename, e.target.value);
  };
  $("clear").onclick = () => {
    selection = [];
    updateSelection();
  };
  $("reset").onclick = () => reset();
  // CIF warnings stay to two lines until opened, keeping controls in reach.
  const toggleWarnings = () => {
    const open = $("warnings").getAttribute("aria-expanded") !== "true";
    $("warnings").setAttribute("aria-expanded", String(open));
  };
  $("warnings").onclick = toggleWarnings;
  $("warnings").onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleWarnings();
    }
  };
  function writeRanges() {
    for (const [i, axis] of ["a", "b", "c"].entries())
      for (const [j, end] of ["min", "max"].entries())
        $(`range-${axis}-${end}`).value = plotRanges[i][j];
    $("range-error").textContent = "";
  }
  function applyRanges(next) {
    try {
      next = validateRanges(next);
      // Blur-commit followed by Apply submits the same bounds twice; an
      // unchanged extent needs no rebuild or refit.
      if (next.every((r, i) => r[0] === plotRanges[i][0] && r[1] === plotRanges[i][1])) {
        writeRanges();
        return;
      }
      const sites = translatedSites(
        structure.atoms,
        next,
        $("boundary").checked,
      );
      plotRanges = next;
      build(true, sites);
      reset(true);
      writeRanges();
    } catch (error) {
      $("range-error").textContent = error.message;
    }
  }
  $("range-form").onsubmit = (e) => {
    e.preventDefault();
    if (!structure) return;
    applyRanges(
      ["a", "b", "c"].map((axis) =>
        ["min", "max"].map((end) => {
          const value = $(`range-${axis}-${end}`).value.trim();
          return value === "" ? NaN : Number(value);
        }),
      ),
    );
  };
  // Committing a bound (Enter, blur or stepper) applies the extent directly;
  // the Apply button remains for explicit submission.
  for (const input of document.querySelectorAll("#range-form input"))
    input.addEventListener("change", () => {
      if (structure) $("range-form").requestSubmit();
    });
  $("range-reset").onclick = () => {
    if (structure) applyRanges(defaultRanges());
  };
  $("cell").onchange = () => {
    if (cellLines) cellLines.visible = $("cell").checked;
    invalidate();
  };
  $("boundary").onchange = () => {
    if (structure) {
      try {
        build();
        $("range-error").textContent = "";
      } catch (error) {
        $("boundary").checked = !$("boundary").checked;
        $("range-error").textContent = error.message;
      }
    }
  };
  $("size").oninput = () => {
    $("size").setAttribute(
      "aria-valuetext",
      `${Math.round(Number($("size").value) * 100)}%`,
    );
    if (!structure) return;
    const size = Number($("size").value);
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    for (const m of meshes) {
      m.userData.atoms.forEach((a, i) => {
        a.radius = atomRadius(a);
        matrix.compose(a.position, rotation, scale.setScalar(a.radius));
        m.setMatrixAt(i, matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      // Instance bounds depend on radius; raycasting recomputes them lazily.
      m.boundingSphere = null;
    }
    updateSelection();
  };
  window.viewerDiagnostics = () => {
    camera.updateMatrixWorld();
    syncViewCamera();
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      atoms: atoms.map((a) => {
        const p = a.position.clone().project(viewCamera);
        return {
          id: a.id,
          visible: atomVisible(a),
          element: a.element,
          label: a.label,
          frac: [...a.frac],
          cartesian: [...a.cartesian],
          sourceIndex: a.sourceIndex,
          key: atomKey(a),
          // Rendered (= picking and halo) radius and instance colour.
          radius: a.radius,
          color: a.color,
          outsideCell: a.frac.some(
            (v, i) =>
              v < plotRanges[i][0] - 1e-8 || v > plotRanges[i][1] + 1e-8,
          ),
          x: rect.left + ((p.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - p.y) * rect.height) / 2,
          z: p.z,
        };
      }),
      atomsVisible: $("show-atoms").checked,
      visibleAtomCount: atoms.filter(atomVisible).length,
      renderedAtomCount: meshes
        .filter((mesh) => mesh.visible)
        .reduce((sum, mesh) => sum + mesh.count, 0),
      hiddenElements: [...hiddenElements],
      selectionObjectCount: selectionGroup.children.length,
      sphereGeometry: meshes.map((mesh) => mesh.geometry.uuid),
      faceMaterials: [...faceMeshes].map(([id, mesh]) => ({
        id,
        opacity: mesh.material.opacity,
        visible: mesh.visible,
        transparent: mesh.material.transparent,
        depthWrite: mesh.material.depthWrite,
        geometry: mesh.geometry.uuid,
        material: mesh.material.uuid,
        outlineVisible: mesh.userData.outline?.visible,
        vertexCount: mesh.geometry.attributes.position.count,
        color: mesh.userData.color,
        // Per-polyhedron display styles: centre atom key, colour, scale.
        styles: mesh.userData.styles.map((s) => ({ ...s })),
      })),
      appearance: {
        elements: Object.fromEntries(appearance.elements),
        atomOverrides: appearance.atoms.size,
        polyhedronOverrides: appearance.polyhedra.size,
        editorOpen: styleEditor.open,
        picking: styleEditor.picking,
        target: styleEditor.target,
        pickMarkerCount: pickGroup.children.length,
      },
      selectedIds: selection.map((a) => a.id),
      distance,
      camera: {
        projection: "orthographic",
        position: camera.position.toArray(),
        up: camera.up.toArray(),
        target: controls.target.toArray(),
      },
      coordination: {
        rules: coordinationStats,
        ...coordinationTotals,
        isolated: $("polyhedra-only").checked,
      },
      ranges: plotRanges.map((r) => [...r]),
      cellSegmentCount: cellLines?.geometry.attributes.position.count / 2,
      block: structure?.block,
      basis: structure?.basis,
    };
  };
  const wollastoniteExample =
    new URLSearchParams(location.search).get("example") === "wollastonite";
  const forsteriteExample =
    new URLSearchParams(location.search).get("example") === "forsterite";
  fetch(
    `${import.meta.env.BASE_URL}${wollastoniteExample ? "examples/wollastonite.cif" : forsteriteExample ? "examples/forsterite.cif" : "example.cif"}`,
  )
    .then((r) => {
      if (!r.ok) throw Error("Example unavailable");
      return r.text();
    })
    .then((text) => {
      if (!userIntent && !request)
        load(
          text,
          wollastoniteExample
            ? "Wollastonite example"
            : forsteriteExample
              ? "Forsterite example"
              : "Example structure",
        );
    })
    .catch(() => {
      if (userIntent || request || structure) return;
      $("loading").hidden = true;
      $("name").textContent = "Your next crystal";
      $("source").textContent = "Open a CIF file to begin.";
    });
}
initialize();
