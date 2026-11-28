import { getCurrentWindow } from "@tauri-apps/api/window";
import { desktop, connectDesktop, saveBlob } from "./desktop.js";
import { version as viewerVersion } from "../package.json";
import * as THREE from "three";
import { ViewControls } from "./view-controls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import "./style.css";
import {
  defaultRanges,
  validateRanges,
  translatedSites,
  rangeEdges,
} from "./plot-range.js";
import { latticeViewDirection } from "./view-direction.js";
// Namespace import: describeViewDirection is root's helper (readout).
import * as viewDirection from "./view-direction.js";
import { createSessionStore } from "./session-store.js";
import { parseProject, serializeProject, projectFilename, MAX_PROJECT_BYTES } from "./project-file.js";
import { createHistory } from "./history.js";
import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
import { elementColor as defaultColor } from "./elements.js";
import { createRadiusControls } from "./radius-controls.js";
import { createStructureInfo } from "./structure-info.js";
import { formulaLabel } from "./structure-notation.js";
import { siteShell } from "./site-shell.js";
import { estimatePairCutoff } from "./pair-defaults.js";
import { angleAt, hullVolume, parseTriple } from "./crystal-math.js";
import { createLatticeTools } from "./lattice-tools.js";
import { installKeyboardViewport } from "./keyboard-viewport.js";
import { enableTripletSelection, numericKeys } from "./numeric-input.js";
import { createAxisCompass } from "./axis-compass.js";
import { createThemeSwitch } from "./theme.js";
import { createFullscreenSwitch } from "./fullscreen.js";
import { createExporter, validDpi } from "./export.js";
import { sceneExportBounds } from "./export-framing.js";
import { createFaceSorter } from "./face-sort.js";
import { createDepthPeeler } from "./peel.js";
import { createLiveAntialias } from "./live-antialias.js";
import { rotatedView } from "./view-rotation.js";
import { createTurnControls } from "./turn-controls.js";
import { createStructureLibrary, structureLibrary, libraryEntry, libraryFilename, entryForFilename } from "./structure-library.js";
import { installPanelScrollbars } from "./panel-scrollbars.js";
import { createToolWindows, revealAddedRow, TOOL_IDS } from "./tool-windows.js";
import { setDiffractionModule } from "./diffraction-engine.js";
import { createDetectorWindow } from "./detector-window.js";
import { createAnalysisWindow, createPowderPanel } from "./analysis-window.js";
import { createReflectionExplorer } from "./reflection-explorer.js";
import { createRadiation } from "./radiation.js";
import { createXrdWorkspace } from "./xrd-workspace.js";
import { createCommandPalette } from "./command-palette.js";
import { createFileIntake } from "./file-intake.js";
import { normalizePair, pairName as normalizedPairName } from "./pair-presentation.js";
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
installKeyboardViewport();
for (const field of document.querySelectorAll('input[type="number"], #turn-angle')) {
  const anchor = field.closest(".range-grid, label");
  const caption = field.getAttribute("aria-label") || field.labels?.[0]?.textContent.trim() || field.id;
  anchor.after(numericKeys(field, caption, false, {
    inputMode: field.inputMode, nativeEnter: true,
    signed: field.type === "number" && (field.min === "" || Number(field.min) < 0),
  }));
}
$("viewer-version").textContent = `PhaseSmith Viewer ${viewerVersion}`;
document.documentElement.toggleAttribute("data-desktop-app", desktop);
createFullscreenSwitch({ nativeWindow: desktop ? getCurrentWindow() : null, button: $("fullscreen-toggle"), status: $("fullscreen-status") });
// The project menu can open from the main header or a floating inspector.
const fileMenu = $("file-menu");
let fileMenuButton = $("file-menu-button");
function positionFileMenu() {
  const rect = fileMenuButton.getBoundingClientRect();
  const below = innerHeight - rect.bottom - 14;
  const above = rect.top - 14;
  const opensAbove = below < 300 && above > below;
  const right = Math.max(8, Math.min(innerWidth - rect.right, innerWidth - fileMenu.offsetWidth - 8));
  fileMenu.style.setProperty("--menu-right", `${right}px`);
  fileMenu.style.setProperty("--menu-top", opensAbove ? "auto" : `${rect.bottom + 6}px`);
  fileMenu.style.setProperty("--menu-bottom", opensAbove ? `${innerHeight - rect.top + 6}px` : "auto");
  fileMenu.style.setProperty("--menu-height", `${Math.max(0, opensAbove ? above : below)}px`);
}
document.addEventListener("click", event => {
  const button = event.target.closest('[popovertarget="file-menu"]');
  if (button) fileMenuButton = button;
}, true);
// Place the menu beside its button before the browser first displays it.
fileMenu.addEventListener("beforetoggle", event => {
  if (event.newState === "open") positionFileMenu();
});
// Once visible, its measured width also constrains it at the viewport edge.
fileMenu.addEventListener("toggle", () => {
  if (fileMenu.matches(":popover-open")) positionFileMenu();
});
window.addEventListener("resize", () => {
  if (fileMenu.matches(":popover-open")) positionFileMenu();
});
// Safari also emits native gesture events over headers and modal dialogs.
// Cancel browser magnification without intercepting the pointer events used
// for crystal pinch/rotation, or one-finger scrolling in the controls.
for (const type of ["gesturestart", "gesturechange"])
  document.addEventListener(type, (event) => event.preventDefault(), {
    passive: false,
  });
for (const input of document.querySelectorAll('#analysis-file, #powder-import, #detector-poni, #detector-orientation-file')) {
  const picker = document.createElement("div"), button = document.createElement("button"), name = document.createElement("span");
  picker.className = "file-picker";
  button.type = "button";
  button.textContent = "Choose file…";
  button.setAttribute("aria-label", `Choose ${input.id === "analysis-file" || input.id === "powder-import" ? "measured powder trace" : input.id === "detector-poni" ? "PONI calibration" : "PhaseSmith JSON"} file`);
  button.onclick = () => input.click();
  name.textContent = "No file chosen";
  input.addEventListener("change", () => name.textContent = input.files?.[0]?.name || "No file chosen");
  input.hidden = true;
  input.after(picker);
  picker.append(button, name);
}
function setError(message) {
  const box = $("error");
  if (!box) return;
  const textEl = $("error-text");
  if (textEl) textEl.textContent = message || "";
  else box.textContent = message || "";
  box.hidden = !message;
}
$("error-close")?.addEventListener("click", () => setError(""));
function initialize() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    $("loading").hidden = true;
    setError(
      "This browser could not start WebGL2, which is needed for 3D viewing. Enable hardware acceleration or open this page in a browser with WebGL2 support.",
    );
    $("name").textContent = "3D view unavailable";
    $("source").textContent = "The graphics context could not be created.";
    $("open").disabled = true;
    $("library-open").disabled = true;
    return;
  }
  function watchDisplayDensity() {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
      watchDisplayDensity();
      invalidate();
    }, { once: true });
  }
  watchDisplayDensity();
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive crystal structure. Drag to rotate, scroll or pinch to zoom, and select an atom for information. Choose Distance or Angle to measure.",
  );
  renderer.domElement.setAttribute("role", "img");
  // A lost GPU context (driver reset, sleep, too many contexts) stops
  // rendering until the browser restores it; then rebuild GPU resources.
  let contextLost = false;
  const CONTEXT_LOST_MESSAGE = "The 3D graphics context was lost. Attempting to restore the view…";
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    peeler.resetContext();
    setError(CONTEXT_LOST_MESSAGE);
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    peeler.resetContext();
    studio.dispose();
    studio = createStudioEnvironment();
    if (($("error-text") ?? $("error"))?.textContent === CONTEXT_LOST_MESSAGE) setError("");
    if (structure) build(true);
    else invalidate();
  });
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
  // A perspective control camera supplies intuitive distance-based zoom;
  // the synchronized parallel camera renders and picks the crystal.
  const viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  // Tool windows overlay the view. Opening, switching, moving or closing
  // a tool never changes the camera or the projected atom positions.
  const stage = { x: 0, y: 0, clear: null };
  function syncViewCamera() {
    const halfHeight =
      camera.position.distanceTo(controls.target) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    viewCamera.left = -halfHeight * camera.aspect;
    viewCamera.right = halfHeight * camera.aspect;
    viewCamera.top = halfHeight;
    viewCamera.bottom = -halfHeight;
    // Depth is decoupled from the logical (zoom) distance: when zoomed into
    // a long structure the logical camera can sit inside it, which would
    // clip near atoms and let rays start behind them. Move only the
    // rendered camera back along its own view axis until the scene's
    // bounding sphere (cached bounds, O(1)) is in front of the near plane,
    // and extend far past its back. Screen x/y are unchanged (orthographic),
    // so pan/zoom anchoring, labels and picking stay pixel-exact.
    viewAxis.set(0, 0, 1).applyQuaternion(camera.quaternion); // toward viewer
    const near = camera.near;
    let shift = 0,
      far = camera.far;
    sceneBox.copy(fitBounds).union(latticeTools.bounds());
    if (!sceneBox.isEmpty()) {
      sceneBox.getBoundingSphere(sceneSphere);
      const along = sceneDelta.copy(sceneSphere.center).sub(camera.position).dot(viewAxis);
      // Margin also covers selection halos and labels just outside atoms.
      const margin = Math.max(near * 4, sceneSphere.radius * 0.02, 0.5);
      shift = Math.max(0, along + sceneSphere.radius + near + margin);
      far = Math.max(far, shift - along + sceneSphere.radius + margin);
    }
    viewCamera.near = near;
    viewCamera.far = far;
    viewCamera.position.copy(camera.position).addScaledVector(viewAxis, shift);
    viewCamera.quaternion.copy(camera.quaternion);
    viewCamera.up.copy(camera.up);
    viewCamera.updateProjectionMatrix();
    viewCamera.updateMatrixWorld();
    // Optional depth cueing: linear fog along the view axis, from just in
    // front of the scene centre to past its back, toward the canvas color
    // (white for White exports; none for transparent images).
    if (depthCue && !sceneBox.isEmpty() && fogBackground !== "transparent") {
      const toCenter = sceneDelta.copy(viewCamera.position).sub(sceneSphere.center).dot(viewAxis);
      depthFog.color.set(fogBackground === "white" ? "#ffffff" : canvasFogColor);
      depthFog.near = Math.max(near, toCenter - sceneSphere.radius * 0.25);
      depthFog.far = Math.max(depthFog.near + 0.5, toCenter + sceneSphere.radius * 1.45);
      scene.fog = depthFog;
    } else scene.fog = null;
  }
  const viewAxis = new THREE.Vector3(),
    sceneBox = new THREE.Box3(),
    sceneSphere = new THREE.Sphere(),
    sceneDelta = new THREE.Vector3(),
    depthFog = new THREE.Fog(0x15263a, 1, 100);
  let depthCue = false,
    fogBackground = null;
  const readCanvasFog = () => getComputedStyle(document.documentElement).getPropertyValue("--canvas-2").trim() || "#15263a";
  let canvasFogColor = readCanvasFog();
  // A Retina canvas multiplies the cost of every transparency pass. Restore
  // full detail once the fingers and any subsequent camera inertia settle.
  let touchPreviewTimer = 0;
  function extendTouchPreview() {
    if (window.devicePixelRatio <= 1.5) return;
    clearTimeout(touchPreviewTimer);
    touchPreviewTimer = setTimeout(() => {
      touchPreviewTimer = 0;
      invalidate();
    }, 180);
  }
  function createControls(target = new THREE.Vector3()) {
    const next = new ViewControls(camera, renderer.domElement);
    next.rotateSpeed = 2.2;
    next.zoomSpeed = 1.2;
    next.panSpeed = 0.6;
    next.staticMoving = false;
    next.dynamicDampingFactor = 0.15;
    next.minDistance = 0.5;
    next.maxDistance = 1000;
    next.target.copy(target);
    // The constructor looks at its initial origin target. Restore the real
    // target immediately so stopping motion after a pan cannot tilt the view.
    next.update();
    next.addEventListener("change", () => {
      if (touchPreviewTimer) extendTouchPreview();
      invalidate();
    });
    // Camera autosave once motion (including damping) has settled.
    next.addEventListener("change", () => scheduleSave(1200));
    next.addEventListener("start", invalidate);
    next.addEventListener("change", () => cameraHistoryChanged());
    return next;
  }
  let controls = createControls();
  function stopMotion() {
    const { minDistance, maxDistance, staticMoving } = controls;
    const target = controls.target.clone();
    const orientation = camera.quaternion.clone();
    controls.dispose();
    controls = createControls(target);
    // Trackball's constructor temporarily looks at the origin. Preserve
    // the real pose so a rapid pick after panning uses the same camera,
    // even before the next animation frame updates the new controls.
    camera.quaternion.copy(orientation);
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
    controls.staticMoving = staticMoving;
  }
  // Studio lighting fixed to the view: the lights live in a rig whose
  // orientation follows the rendered camera every frame, so the crystal
  // turns under stationary screen lighting (in the turntable, too). The rig
  // only rotates, so pan and zoom never change light directions. Positions
  // are view-space directions: key upper-right-front, fill lower-left-back,
  // sky from screen-up.
  const lightRig = new THREE.Group();
  scene.add(lightRig);
  lightRig.add(new THREE.HemisphereLight(0xe4f1ff, 0x324353, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 8, 10);
  const fill = new THREE.DirectionalLight(0x99baff, 1.4);
  fill.position.set(-6, -2, -5);
  for (const directional of [light, fill]) {
    lightRig.add(directional, directional.target); // target at rig origin
  }
  const studioEuler = new THREE.Euler();
  function syncStudio() {
    lightRig.quaternion.copy(viewCamera.quaternion);
    lightRig.updateMatrixWorld(true);
    // Environment reflections in view space too. three samples the map
    // with M · worldDir, M = R(−e) in e's order; camera XYZ angles given
    // with order ZYX make M = R_camera⁻¹ exactly.
    studioEuler.setFromQuaternion(viewCamera.quaternion, "XYZ");
    for (const mesh of meshes)
      mesh.material.envMapRotation?.set(studioEuler.x, studioEuler.y, studioEuler.z, "ZYX");
  }
  let model = new THREE.Group();
  scene.add(model);
  let rules = [],
    coordinationStats = [],
    coordinationTotals = {},
    nextRule = 0;
  const pairEstimates = new Map();
  const faceMeshes = new Map();
  const phoneLayout = matchMedia("(max-width: 640px)");
  // Local session autosave state, declared early: controls "change"
  // events may call scheduleSave() before the session code below runs.
  // saveSuspended > 0 blocks saving (startup/restore, export, Start fresh).
  let saveTimer = 0,
    saveSuspended = 1, // released after the startup document is displayed
    startupHold = true;
  let historyReady = false, historyApplying = false;
  // Batch faces of all pairs; the peeler establishes their per-pixel order.
  const faceSorter = createFaceSorter(THREE);
  scene.add(faceSorter.mesh);
  // Per-pixel ordered translucency (depth peeling) for the face batch and
  // translucent planes. A frame whose depth complexity exceeded the layer
  // budget is re-rendered with a larger budget; beyond the maximum the
  // approximate remainder is reported in the atom summary.
  let peelOverflow = false;
  const peeler = createDepthPeeler({
    // Only what peel.js uses: handing over the whole namespace would stop
    // the bundler from dropping unused three.js classes.
    THREE: {
      Vector2: THREE.Vector2,
      Color: THREE.Color,
      WebGLRenderTarget: THREE.WebGLRenderTarget,
      DepthTexture: THREE.DepthTexture,
      OrthographicCamera: THREE.OrthographicCamera,
      Scene: THREE.Scene,
      ShaderMaterial: THREE.ShaderMaterial,
      MeshBasicMaterial: THREE.MeshBasicMaterial,
      Mesh: THREE.Mesh,
      PlaneGeometry: THREE.PlaneGeometry,
      UnsignedByteType: THREE.UnsignedByteType,
      FloatType: THREE.FloatType,
      NearestFilter: THREE.NearestFilter,
      CustomBlending: THREE.CustomBlending,
      NoBlending: THREE.NoBlending,
      NormalBlending: THREE.NormalBlending,
      OneFactor: THREE.OneFactor,
      OneMinusDstAlphaFactor: THREE.OneMinusDstAlphaFactor,
      OneMinusSrcAlphaFactor: THREE.OneMinusSrcAlphaFactor,
      DoubleSide: THREE.DoubleSide,
      SRGBColorSpace: THREE.SRGBColorSpace,
    },
    renderer,
    onStatus: (status) => {
      if (status.rerender) invalidate();
      if (status.overflow !== peelOverflow) {
        peelOverflow = status.overflow;
        updateAtomSummary();
      }
    },
  });
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
    fitCorners = [],
    modelCenter = new THREE.Vector3(),
    distance = null,
    angle = null,
    measureMode = "info";
  const selectionRims = [];
  scene.add(selectionGroup);
  const liveAntialias = createLiveAntialias(renderer);
  const viewportSize = {
    width: Math.max(1, viewport.clientWidth || innerWidth || 1),
    height: Math.max(1, viewport.clientHeight || innerHeight || 1),
  };
  const livePixelRatio = (width, height) => Math.min(window.devicePixelRatio || 1, 2,
    Math.sqrt(4_000_000 / Math.max(1, width * height)));
  function render(exportView) {
    frame = 0;
    if (contextLost || renderer.getContext().isContextLost?.()) return;
    const prevLightTheme = atomThemeUniform.value;
    const scaledLines = [];
    fogBackground = exportView?.background ?? null;
    if (exportView?.background === "white") atomThemeUniform.value = 1;
    try {
      if (!exportView?.crop) {
        // Keep native display detail within the live pixel budget; FXAA smooths
        // translucent edges without forcing extra supersampling on low-DPI screens.
        // Bound live pixels: each transparency layer otherwise multiplies the
        // full-screen Retina workload. Export frames use their own resolution.
        const scale = Math.min(livePixelRatio(viewportSize.width, viewportSize.height), touchPreviewTimer ? 1.5 : Infinity);
        if (renderer.getPixelRatio() !== scale) renderer.setPixelRatio(scale);
      }
      // Trackball emits change while damping moves the camera. That event
      // schedules the next frame; once settled, no animation frames remain.
      controls.update();
      const sweepSpecimen = specimenDragMoved;
      specimenDragMoved = false;
      if (detectorLink && detectorLink.rotation.angleTo(camera.quaternion) > 1e-7) {
        detectorLink.rotation.copy(camera.quaternion);
        updatingFromMain = true;
        // Trackball maps the canvas width to two radians before rotateSpeed.
        const degreesPerPixel = THREE.MathUtils.radToDeg(2 * controls.rotateSpeed / controls.screen.width);
        try { diffractionDetector.rotateSpecimen(mainCameraRotation(), sweepSpecimen ? degreesPerPixel : 0); }
        finally { updatingFromMain = false; }
      }
      syncViewCamera();
      for (const rim of selectionRims) rim.quaternion.copy(viewCamera.quaternion);
      syncStudio();
      faceSorter.sync([...faceMeshes.values()], viewCamera);
      if (exportView?.crop) {
        // Render the cropped region directly. The movie envelope can reach
        // beyond the live viewport at other orientations; it still fits in
        // the export without changing the user's camera or zoom.
        const { crop, css } = exportView;
        const px = (viewCamera.right - viewCamera.left) / css.width;
        const py = (viewCamera.top - viewCamera.bottom) / css.height;
        viewCamera.left += crop.x * px;
        viewCamera.right = viewCamera.left + crop.width * px;
        viewCamera.top -= crop.y * py;
        viewCamera.bottom = viewCamera.top - crop.height * py;
        viewCamera.updateProjectionMatrix();
        const lineScale = exportView.pixelScale || 1;
        if (lineScale !== 1) {
          scene.traverse((obj) => {
            if (obj.material?.isLineMaterial) {
              scaledLines.push([obj.material, obj.material.linewidth]);
              obj.material.linewidth *= lineScale;
            }
          });
        }
        try {
          peeler.render(scene, viewCamera);
        } finally {
          // Labels retain their live CSS coordinates; the exporter translates
          // them into the cropped frame after drawing the rendered geometry.
          syncViewCamera();
        }
      } else {
        peeler.render(scene, viewCamera);
        liveAntialias.render();
      }
    } finally {
      for (const [mat, width] of scaledLines) mat.linewidth = width;
      fogBackground = null;
      atomThemeUniform.value = prevLightTheme;
    }
    updateViewReadout();
    if (labelsOn || shownLabels) updateLabels();
    latticeTools.updateLabels(viewCamera, renderer.domElement);
    // Lattice-axis compass follows the rendered camera's rotation.
    compassState = compass.update(
      structure?.basis,
      compassInverse.copy(viewCamera.quaternion).invert(),
      compassVector,
    );
    // The pressed view button stays lit only while the camera still looks
    // along that direction; any rotation away from it clears the state.
    if (
      activeView &&
      camera.position.clone().sub(controls.target).normalize().dot(activeView.dir) <
        0.99995
    )
      setActiveView(null);
  }
  // CIF site labels projected onto visible atoms. A small reused pool of
  // spans (front-most first, overlaps skipped, capped) keeps the DOM light
  // while rotating on tablets.
  // Clicking an axis views along it; Shift-click views along its negative.
  const compass = createAxisCompass($("axis-compass"), $("axis-compass-text"), {
    onAxisClick(axis, { opposite } = {}) {
      const sign = opposite ? -1 : 1;
      const indices = { a: [sign, 0, 0], b: [0, sign, 0], c: [0, 0, sign] }[axis];
      if (indices && !exporter?.busy) orient(indices, opposite ? "uvw" : axis);
    },
  });
  const compassInverse = new THREE.Quaternion(),
    compassVector = new THREE.Vector3();
  let compassState = null;
  const LABEL_LIMIT = 150,
    LABEL_ATOM_LIMIT = 20000;
  let labelsOn = false,
    shownLabels = 0;
  const labelPool = [],
    projected = new THREE.Vector3();
  function updateLabels() {
    const layer = $("atom-labels");
    const { width, height } = viewportSize;
    let placed = [];
    if (labelsOn && atoms.length <= LABEL_ATOM_LIMIT) {
      const candidates = [];
      // Screen pixels per world unit of the orthographic view: labels sit
      // at the upper right of each sphere instead of covering it.
      const pixelsPerUnit = height / (viewCamera.top - viewCamera.bottom || 1);
      for (const a of atoms) {
        if (!atomVisible(a)) continue;
        projected.copy(a.position).project(viewCamera);
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
        const offset = a.radius * pixelsPerUnit * 0.7;
        candidates.push({
          label: a.label,
          x: ((projected.x + 1) * width) / 2 + offset,
          y: ((1 - projected.y) * height) / 2 - offset,
          z: projected.z,
        });
      }
      candidates.sort((p, q) => p.z - q.z);
      for (const c of candidates) {
        if (placed.length >= LABEL_LIMIT) break;
        if (placed.some((p) => Math.abs(p.x - c.x) < 28 && Math.abs(p.y - c.y) < 13)) continue;
        placed.push(c);
      }
    }
    while (labelPool.length < placed.length) {
      const span = document.createElement("span");
      span.className = "atom-label";
      layer.append(span);
      labelPool.push(span);
    }
    labelPool.forEach((span, i) => {
      const c = placed[i];
      span.hidden = !c;
      if (!c) return;
      if (span.textContent !== c.label) span.textContent = c.label;
      span.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-20%, -80%)`;
    });
    shownLabels = placed.length;
    lastAtomLabels = placed;
  }
  let lastAtomLabels = [];
  let activeView = null,
    lastOrientIndices = null;
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
  // Viewing direction readout ("View [uvw]") above the atom legend: the
  // eye vector (camera − pivot, crystal toward viewer, as the a/b/c
  // buttons) in direct-lattice coordinates. O(1) per frame; the DOM text
  // changes only when the description does.
  const readoutEye = new THREE.Vector3();
  let readoutText = "";
  function updateViewReadout(eye = null) {
    const el = $("view-readout");
    const describe = viewDirection.describeViewDirection;
    if (typeof describe !== "function" || !structure?.basis) {
      if (!el.hidden) el.hidden = true;
      return;
    }
    let text = "";
    try {
      text = describe(structure.basis, (eye ?? readoutEye.copy(camera.position).sub(controls.target)).toArray())?.text ?? "";
    } catch {
      text = "";
    }
    if (text !== readoutText) {
      readoutText = text;
      el.replaceChildren("View ", Object.assign(document.createElement("b"), { textContent: text }));
    }
    if (el.hidden !== !text) el.hidden = !text;
  }
  renderer.domElement.addEventListener("wheel", invalidate, { passive: true });
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    viewportSize.width = Math.max(1, width);
    viewportSize.height = Math.max(1, height);
    // Resize and set density together so entering full screen never allocates
    // a transient, oversized buffer at the previous smaller view's density.
    renderer.setDrawingBufferSize(width, height, livePixelRatio(width, height));
    scene.traverse((obj) => {
      if (obj.material?.isLineMaterial) obj.material.resolution.set(Math.max(1, width), Math.max(1, height));
    });
    controls.handleResize();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(viewport);
  // Expose horizontal overflow at either edge of the element legend.
  // Its fade follows scrolling and resizing without moving the atom-size control.
  function updateElementOverflow() {
    const legend = $("elements");
    legend.dataset.overflow = [
      legend.scrollLeft > 1 ? "start" : "",
      legend.scrollLeft + legend.clientWidth < legend.scrollWidth - 1 ? "end" : "",
    ].filter(Boolean).join(" ");
  }
  const legendResize = new ResizeObserver(updateElementOverflow);
  legendResize.observe($("elements"));
  $("elements").addEventListener("scroll", updateElementOverflow, { passive: true });
  const radiusControls = createRadiusControls(updateSphereSizes);
  // Overlay colors (selection, measurement, pick marker, cell edges) per
  // theme; element and pair colors are scientific choices and never change.
  const SCENE_PALETTES = {
    dark: { selectionRim: 0xffca68, select: 0x79ffdc, arc: 0xffe08a, pick: 0xffc46b, cell: 0x7fa6c5 },
    light: { selectionRim: 0xad6c06, select: 0x0a8f7b, arc: 0xc06d00, pick: 0xd08300, cell: 0x587690 },
  };
  const scenePalette = () =>
    SCENE_PALETTES[document.documentElement.dataset.theme === "light" ? "light" : "dark"];
  const appearance = createAppearance();
  let styleEditor = null;
  // Element-wide colour (used by the element chips and as the inherited
  // value for individual atoms).
  const colorFor = (e) => appearance.elements.get(e)?.color ?? defaultColor(e);
  const styleOf = (a) => atomStyle(appearance, a.element, atomKey(a), defaultColor(a.element));
  // Drawn radius = element default × global Size × appearance scale. The
  // same value drives the instance matrix, picking and the selection halo.
  const atomRadius = (a) =>
    radiusControls.radius(a) * Number($("size").value) * styleOf(a).scale;
  const ruleColor = (rule) => rule.color ?? defaultColor(rule.center);
  // A neutral procedural studio (no remote assets) lights the atoms only:
  // soft panel reflections give broad highlights, while polyhedra and bonds
  // keep their existing flat, colour-true shading.
  function createStudioEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return texture;
  }
  let studio = createStudioEnvironment();
  const atomThemeUniform = { value: document.documentElement.dataset.theme === "light" ? 1 : 0 };
  const atomContactAoUniform = { value: $("style-contact-ao") ? ($("style-contact-ao").checked ? 1 : 0) : 1 };
  function atomMaterial(color) {
    // Satin finish: a broad, modest key highlight and only a faint studio
    // reflection, so saturated element colours are not lifted to white and
    // the shaded side keeps depth (no clear coat, which added white rims).
    const material = new THREE.MeshStandardMaterial({
      color,
      // Grazing-angle studio reflection produced a pale rim on the upper
      // silhouette; a weaker, rougher reflection keeps the edge colored.
      roughness: 0.56,
      metalness: 0,
      envMap: studio,
      envMapIntensity: 0.08,
    });
    // Analytic contact ambient occlusion (per-instance aAtomAo) + light-theme
    // Fresnel silhouette darkening so pale elements (H, Y, Ce) stay crisp.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLightTheme = atomThemeUniform;
      shader.uniforms.uContactAo = atomContactAoUniform;
      shader.vertexShader = "attribute float aAtomAo;\nvarying float vAtomAo;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "vAtomAo = aAtomAo;\n#include <begin_vertex>",
      );
      shader.fragmentShader = "uniform float uLightTheme;\nuniform float uContactAo;\nvarying float vAtomAo;\n" + shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        `gl_FragColor.rgb *= mix(1.0, clamp(vAtomAo, 0.5, 1.0), uContactAo);
        if (uLightTheme > 0.5) {
          float rim = pow(1.0 - clamp(abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 2.5);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.72, rim * 0.45);
        }
        #include <tonemapping_fragment>`,
      );
    };
    material.customProgramCacheKey = () => "phasesmith-atom-ao-fresnel-v2";
    return material;
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
  // ---- Asymmetric unit ----------------------------------------------------
  // Independent CIF sites exactly once, before space-group expansion. No
  // geometric "asymmetric-unit boundary" is drawn or invented.
  let asymmetric = false;
  function independentSites() {
    if (Array.isArray(structure?.independentSites)) return structure.independentSites;
    // Older engine builds: first expanded copy of each label (approximate).
    const seen = new Map();
    for (const a of structure?.atoms ?? [])
      if (!seen.has(a.label)) seen.set(a.label, { ...a, siteIndex: seen.size });
    return [...seen.values()];
  }
  function plotSites(ranges = plotRanges) {
    if (asymmetric)
      return independentSites().map((s, i) => ({
        ...s,
        siteIndex: s.siteIndex ?? i,
        sourceIndex: `asym${i}`,
      }));
    return translatedSites(structure.atoms, ranges, $("boundary").checked);
  }
  function build(preserve = true, plottedSites = plotSites()) {
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
    radiusControls.updateCoordination(rules);
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
    // Precompute atom transforms so a.radius is ready for spatial-hashed contact AO.
    for (const a of atoms) {
      a.color = styleOf(a).color;
      a.radius = atomRadius(a);
    }
    const aoByAtom = computeAtomAo(atoms);
    for (const [e, list] of byElement) {
      // One instanced mesh per element; per-copy colours ride on the
      // instance colour attribute (material colour stays white).
      const geom = sphere.clone();
      const aoValues = new Float32Array(list.length);
      const mesh = new THREE.InstancedMesh(
        geom,
        atomMaterial(0xffffff),
        list.length,
      );
      mesh.visible = atomVisible(list[0]);
      mesh.userData.atoms = list;
      list.forEach((a, i) => {
        atomTransform(a, matrix, rotation, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tint.set(a.color));
        aoValues[i] = aoByAtom.get(a) ?? 1;
      });
      geom.setAttribute("aAtomAo", new THREE.InstancedBufferAttribute(aoValues, 1));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      model.add(mesh);
      meshes.push(mesh);
    }
    sphere.dispose();
    fitCorners = corners.map((p) => p.clone().sub(modelCenter));
    updateSphereBounds();
    const points = rangeEdges(plotRanges).map((p) => cart(p).sub(modelCenter));
    // Screen-space (fat) lines keep cell edges crisp at every zoom and
    // display density; the resolution follows the render viewport.
    cellLines = new LineSegments2(
      new LineSegmentsGeometry().setPositions(points.flatMap((p) => [p.x, p.y, p.z])),
      new LineMaterial({
        color: scenePalette().cell,
        linewidth: 1.5,
        transparent: true,
        opacity: 0.48,
      }),
    );
    cellLines.userData.segmentCount = points.length / 2;
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
    buildOrtepRings();
    if (activeDistanceSpec) highlightDistance(activeDistanceSpec);
    // Overlays follow the new model center, ranges and atom list.
    latticeTools.rebuild();
    highlightSite(highlightedSite);
    invalidate();
  }
  function atomTransform(a, matrix, rotation, scale) {
    a.radius = atomRadius(a);
    if ($("adp-ellipsoids").checked) {
      // sqrt(chi-square quantile for 3 degrees of freedom, probability 0.5).
      const probabilityScale = 1.538172254455;
      if (a.displacementAxes) {
        const axes = a.displacementAxes.map(row => row.map(v => v * probabilityScale));
        a.radius = Math.max(...[0,1,2].map(i => Math.hypot(...axes.map(row => row[i]))));
        matrix.set(...axes[0], a.position.x, ...axes[1], a.position.y, ...axes[2], a.position.z, 0,0,0,1);
        return;
      }
      if (a.uIso > 0) a.radius = probabilityScale * Math.sqrt(a.uIso);
    }
    matrix.compose(a.position, rotation, scale.setScalar(a.radius));
  }
  const haloQuat = new THREE.Quaternion(),
    haloScale = new THREE.Vector3(),
    haloScaleMat = new THREE.Matrix4();
  function applyHaloMatrix(atom, factor, out) {
    atomTransform(atom, out, haloQuat, haloScale);
    out.multiply(haloScaleMat.makeScale(factor, factor, factor));
    return out;
  }
  // Spatial-hashed analytic contact ambient occlusion: sums neighbor solid-angle
  // occlusion within 4.5 Å so exposed surface atoms stay 1.0 and recessed interior
  // atoms gently darken to ~0.62–0.75.
  function computeAtomAo(atomList) {
    const out = new Map();
    const visible = atomList.filter(atomVisible);
    if (!visible.length) return out;
    const cutoff = 4.5;
    const cutoff2 = cutoff * cutoff;
    const bins = new Map();
    const keyOf = (x, y, z) => `${x},${y},${z}`;
    for (const a of visible) {
      const k = keyOf(Math.floor(a.position.x / cutoff), Math.floor(a.position.y / cutoff), Math.floor(a.position.z / cutoff));
      let bucket = bins.get(k);
      if (!bucket) { bucket = []; bins.set(k, bucket); }
      bucket.push(a);
    }
    for (const a of visible) {
      const cx = Math.floor(a.position.x / cutoff);
      const cy = Math.floor(a.position.y / cutoff);
      const cz = Math.floor(a.position.z / cutoff);
      let occ = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = bins.get(keyOf(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const b of bucket) {
              if (b === a) continue;
              const d2 = a.position.distanceToSquared(b.position);
              if (d2 <= 1e-8 || d2 >= cutoff2) continue;
              const d = Math.sqrt(d2);
              const r = Math.max(0.15, b.radius || 0.4);
              const solid = Math.min(1, (r * r) / d2);
              occ += solid * (1 - d / cutoff);
            }
          }
      out.set(a, Math.max(0.58, 1 / (1 + occ * 0.42)));
    }
    return out;
  }
  function refreshAtomAo() {
    if (!meshes.length) return;
    const aoByAtom = computeAtomAo(atoms);
    for (const mesh of meshes) {
      const attr = mesh.geometry.getAttribute("aAtomAo");
      if (!attr) continue;
      const list = mesh.userData.atoms;
      for (let i = 0; i < list.length; i++) {
        attr.array[i] = aoByAtom.get(list[i]) ?? 1;
      }
      attr.needsUpdate = true;
    }
  }
  // ORTEP-style principal-axis equatorial rings (XY, YZ, XZ) on anisotropic ADP ellipsoids.
  const ortepGroup = new THREE.Group();
  scene.add(ortepGroup);
  const ORTEP_UNIT_SEGMENTS = (() => {
    const segs = [];
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * Math.PI * 2;
      const t1 = ((i + 1) / steps) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      segs.push([c0, s0, 0], [c1, s1, 0]); // XY
      segs.push([0, c0, s0], [0, c1, s1]); // YZ
      segs.push([c0, 0, s0], [c1, 0, s1]); // XZ
    }
    return segs;
  })();
  function buildOrtepRings() {
    dispose(ortepGroup);
    ortepGroup.clear();
    if (
      !$("adp-ellipsoids")?.checked ||
      ($("style-ortep-rings") && !$("style-ortep-rings").checked) ||
      !$("show-atoms")?.checked
    ) return;
    const positions = [];
    const colors = [];
    const mat = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const atomTint = new THREE.Color();
    const lightRing = new THREE.Color(0xf1f5f9);
    const darkRing = new THREE.Color(0x1e293b);
    let count = 0;
    for (const a of atoms) {
      if (!a.displacementAxes || !atomVisible(a)) continue;
      if (++count > 1200) break;
      atomTint.set(a.color ?? styleOf(a).color);
      const lum = 0.2126 * atomTint.r + 0.7152 * atomTint.g + 0.0722 * atomTint.b;
      const ringColor = lum < 0.36 ? lightRing : darkRing;
      applyHaloMatrix(a, 1.008, mat);
      for (const p of ORTEP_UNIT_SEGMENTS) {
        v.set(p[0], p[1], p[2]).applyMatrix4(mat);
        positions.push(v.x, v.y, v.z);
        colors.push(ringColor.r, ringColor.g, ringColor.b);
      }
    }
    if (!positions.length) return;
    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    geom.setColors(colors);
    const rings = new LineSegments2(
      geom,
      new LineMaterial({
        vertexColors: true,
        linewidth: 1.15,
        transparent: true,
        opacity: 0.68,
        resolution: new THREE.Vector2(viewportSize.width, viewportSize.height),
      }),
    );
    ortepGroup.add(rings);
  }
  // 3D Pair-distance highlight (from Distances window -> Highlight in 3D).
  const distanceGroup = new THREE.Group();
  scene.add(distanceGroup);
  let activeDistanceSpec = null;
  function clearDistanceHighlight() {
    dispose(distanceGroup);
    distanceGroup.clear();
    activeDistanceSpec = null;
  }
  function highlightDistance(spec) {
    clearDistanceHighlight();
    if (!spec || !atoms.length) {
      invalidate();
      return;
    }
    activeDistanceSpec = spec;
    const min = Math.max(0, spec.min - 1e-4);
    const max = spec.max + 1e-4;
    const min2 = min * min;
    const max2 = max * max;
    const cell = Math.max(0.25, max + 0.01);
    const visibleAtoms = atoms.filter(atomVisible);
    const bins = new Map();
    const bKey = (x, y, z) => `${x},${y},${z}`;
    for (let i = 0; i < visibleAtoms.length; i++) {
      const p = visibleAtoms[i].position;
      const k = bKey(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell));
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(i);
    }
    const positions = [];
    const CAP = 600;
    let total = 0;
    for (let i = 0; i < visibleAtoms.length; i++) {
      const a = visibleAtoms[i];
      const cx = Math.floor(a.position.x / cell);
      const cy = Math.floor(a.position.y / cell);
      const cz = Math.floor(a.position.z / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = bins.get(bKey(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const b = visibleAtoms[j];
              if (spec.pair && spec.pair !== "all" && normalizePair(normalizedPairName(a.element, b.element)) !== spec.pair) continue;
              const d2 = a.position.distanceToSquared(b.position);
              if (d2 >= min2 && d2 <= max2 && d2 > 1e-12) {
                total++;
                if (total <= CAP) {
                  positions.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z);
                }
              }
            }
          }
    }
    if (positions.length) {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(positions);
      const { width, height } = viewport.getBoundingClientRect();
      const segs = new LineSegments2(
        geom,
        new LineMaterial({
          color: scenePalette().select,
          linewidth: 2.2,
          dashed: true,
          dashSize: 0.14,
          gapSize: 0.08,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
          resolution: new THREE.Vector2(Math.max(1, width || innerWidth || 1), Math.max(1, height || innerHeight || 1)),
        }),
      );
      segs.computeLineDistances();
      segs.renderOrder = 5;
      distanceGroup.add(segs);
    }
    invalidate();
  }
  function applyDistanceCutoff({ pair, cutoff }) {
    if (!structure || !pair || !Number.isFinite(cutoff)) return;
    historyLabel = "Apply distance cutoff";
    const norm = normalizePair(pair);
    const existing = rules.find((r) => normalizePair(normalizedPairName(r.center, r.neighbor)) === norm);
    if (existing) {
      existing.cutoff = Math.max(CUTOFF_MIN, cutoff);
      const card = document.querySelector(`.pair-rule[data-rule-id="${existing.id}"]`);
      const field = card?.querySelector('input[data-field="cutoff"]');
      if (field) {
        field.value = formatCutoff(existing.cutoff);
        field.setCustomValidity("");
      }
      build();
      flushHistory();
      return;
    }
    const [center, neighbor] = norm.split("–");
    if (!center || !neighbor) return;
    rules.push({
      id: ++nextRule,
      center,
      neighbor,
      cutoff: Math.max(CUTOFF_MIN, cutoff),
      bonds: true,
      polyhedra: false,
      opacity: 0.34,
    });
    renderRules();
    build();
    flushHistory();
  }
  function updateSphereBounds() {
    fitBounds.setFromPoints(fitCorners);
    const corner = new THREE.Vector3();
    for (const atom of atoms) {
      fitBounds.expandByPoint(corner.copy(atom.position).addScalar(atom.radius));
      fitBounds.expandByPoint(corner.copy(atom.position).addScalar(-atom.radius));
    }
    // Include ligands beyond the plotted atom range.
    for (const faces of faceMeshes.values()) {
      if (!faces.visible) continue;
      if (!faces.geometry.boundingBox) faces.geometry.computeBoundingBox();
      fitBounds.union(faces.geometry.boundingBox);
    }
  }
  const radiation = createRadiation();
  const xrdWorkspace = createXrdWorkspace({
    viewport,
    radiation,
    onAddPlane: (hkl) => {
      if (!structure || !Array.isArray(hkl)) return;
      latticeTools.addPlane(hkl);
      toolWindows.choose("lattice");
      scheduleSave();
    },
    onChange: () => scheduleSave(),
  });
  const structureAnalysis = createAnalysisWindow({
    getStructure: () => structure,
    onHighlightDistance: highlightDistance,
    onApplyCutoff: applyDistanceCutoff,
    onChange: () => scheduleSave(),
  });
  const powderPanel = createPowderPanel({
    radiation,
    getStructure: () => structure,
    onExplain: (hkl, wavelength) => {
      if (Number.isFinite(wavelength) && !radiation.locked) {
        try { radiation.set({ wavelength }); } catch { /* ignore */ }
      }
      xrdWorkspace.open("reflection", { handoff: { hkl, align: true } });
    },
    onActive: (hkl, origin, meta) => xrdWorkspace.setActive(hkl, origin, meta),
    onChange: () => scheduleSave(),
  });
  const reflectionExplorer = createReflectionExplorer({
    host: $("xrd-panel-reflection"),
    radiation,
    atomRadius,
    getStructure: () => structure,
    onDetector: (hkl, wavelength) => {
      if (Number.isFinite(wavelength) && !radiation.locked) {
        try { radiation.set({ wavelength }); } catch { /* ignore */ }
      }
      xrdWorkspace.open("detector", { handoff: { hkl, align: true } });
    },
    onActive: (hkl, origin, meta) => xrdWorkspace.setActive(hkl, origin, meta),
    onSaveProject: () => $("project-save")?.click(),
  });
  let detectorLink = null, updatingFromMain = false, specimenDragMoved = false;
  renderer.domElement.addEventListener("pointerdown", () => {
    if (detectorLink) diffractionDetector.beginSpecimenDrag();
  });
  renderer.domElement.addEventListener("pointermove", event => {
    if (detectorLink && event.buttons) specimenDragMoved = true;
  });
  function mainCameraRotation() {
    return [[1,0,0],[0,1,0],[0,0,1]].map(axis =>
      new THREE.Vector3(...axis).applyQuaternion(camera.quaternion).toArray());
  }
  function linkDetectorView(pose, keepOrientation = false) {
    if (!pose && !detectorLink) return;
    latticeTools.setDetectorPlane(pose?.hkl ?? null);
    const distance = camera.position.distanceTo(controls.target);
    if (!pose) {
      stopMotion();
      if (!keepOrientation) {
        camera.position.copy(detectorLink.eye).multiplyScalar(distance).add(controls.target);
        camera.up.copy(detectorLink.up);
      }
      const previousView = keepOrientation ? null : detectorLink.active;
      controls.staticMoving = detectorLink.staticMoving;
      detectorLink = null;
      controls.update();
      setActiveView(previousView?.id ?? null, previousView?.dir);
      if (keepOrientation) scheduleSave();
      invalidate();
      return;
    }
    const eye = new THREE.Vector3(...pose.eye).normalize();
    const up = new THREE.Vector3(...pose.up).projectOnPlane(eye).normalize();
    if (!updatingFromMain && detectorLink?.linkedEye.equals(eye) && detectorLink.linkedUp.equals(up)) return;
    if (!detectorLink) {
      stopMotion();
      detectorLink = {
        eye: camera.position.clone().sub(controls.target).normalize(),
        up: camera.up.clone(), active: activeView, rotation: new THREE.Quaternion(),
        staticMoving: controls.staticMoving,
      };
      // A manual specimen turn stops at the orientation where the user lets go.
      controls.staticMoving = true;
    }
    detectorLink.linkedEye = eye;
    detectorLink.linkedUp = up;
    if (updatingFromMain) {
      const currentEye = camera.position.clone().sub(controls.target).normalize();
      if (currentEye.distanceToSquared(eye) < 1e-20 && camera.up.distanceToSquared(up) < 1e-20) return;
    }
    camera.position.copy(eye).multiplyScalar(distance).add(controls.target);
    camera.up.copy(up);
    controls.update();
    detectorLink.rotation.copy(camera.quaternion);
    setActiveView(null);
    invalidate();
  }
  const diffractionDetector = createDetectorWindow({
    host: $("detector-window"),
    radiation,
    getStructure: () => structure,
    onExplain: (hkl, wavelength) => {
      if (Number.isFinite(wavelength) && !radiation.locked) {
        try { radiation.set({ wavelength }); } catch { /* ignore */ }
      }
      xrdWorkspace.open("reflection", { handoff: { hkl, align: true } });
    },
    onPeak: peak => powderPanel.selectDetectorPeak(peak),
    onActive: (hkl, origin, meta) => xrdWorkspace.setActive(hkl, origin, meta),
    onMainView: linkDetectorView,
    getMainRotation: mainCameraRotation,
  });
  xrdWorkspace.registerPanel("powder", powderPanel);
  xrdWorkspace.registerPanel("reflection", reflectionExplorer);
  xrdWorkspace.registerPanel("detector", diffractionDetector);
  const latticeTools = createLatticeTools({
    THREE,
    scene,
    invalidate,
    getStructure: () => structure,
    getRanges: () => plotRanges,
    toScene: (frac) => cart(frac).sub(modelCenter),
    // Plane labels avoid covering the model's projected box.
    getSceneBounds: () => fitBounds,
  });
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
            color: scenePalette().pick,
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
        const edges = new LineSegments2(
          new LineSegmentsGeometry().setPositions(points.flatMap((p) => [p.x, p.y, p.z])),
          new LineMaterial({
            color: scenePalette().pick,
            linewidth: 2,
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
  function startingCutoff(center, neighbor) {
    const key = `${center}|${neighbor}`;
    if (!pairEstimates.has(key))
      pairEstimates.set(key, estimatePairCutoff(structure, center, neighbor));
    return pairEstimates.get(key);
  }
  function resetRules() {
    nextRule = 0;
    $("polyhedra-only").checked = false;
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    const oxideCenters = new Set(["Si", "Mg", "Al", "Fe", "Ca", "Ti", "C"]);
    rules = elements.includes("O")
      ? elements
          .filter((e) => oxideCenters.has(e))
          .map((e) => ({
            id: ++nextRule,
            center: e,
            neighbor: "O",
            cutoff: startingCutoff(e, "O"),
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
      $("boundary").checked = false;
    } else if (currentFilename === "Wollastonite example") {
      rules = rules.filter((r) => r.center === "Si");
      rules.forEach((r) => {
        r.cutoff = 1.8;
        r.polyhedra = true;
      });
      $("boundary").checked = false;
    }
    renderRules();
  }
  const pairName = (rule) => `${rule.center}–${rule.neighbor}`;
  const pairTargetLabel = (rule) => {
    const same = rules.filter(r => r.center === rule.center && r.neighbor === rule.neighbor);
    return same.length > 1 ? `${pairName(rule)} #${same.indexOf(rule) + 1} (${formatCutoff(rule.cutoff)} Å)` : pairName(rule);
  };
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
        const cutoffMessage = make("p", { className: "micro", hidden: true });
        cutoffMessage.setAttribute("role", "status");
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
              title: "Distance cutoff (Å) · new element combinations get an estimated first-shell cutoff · ↑/↓ ±0.1 Å",
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
              if (value === null) {
                // Never leave text on screen that differs from the applied
                // cutoff. Native validation bubbles can disappear on blur.
                input.value = formatCutoff(rule.cutoff);
                cutoffMessage.textContent = `Enter a number of at least ${CUTOFF_MIN} Å. Kept ${input.value} Å.`;
                cutoffMessage.hidden = false;
                return;
              }
              setCutoff(value, false);
              return;
            }
            rule[field] = input.value;
            card.style.setProperty("--pair-color", ruleColor(rule));
            label();
            setCutoff(startingCutoff(rule.center, rule.neighbor), false);
            styleEditor?.refresh();
          };
        }
        const remove = make("button", {
          type: "button",
          className: "icon-button delete-button",
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
        // Cutoff tuner: opens over the row below the field with a
        // spring-loaded speed track and exact ±0.1 Å buttons. A first touch opens it
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
          className: "tuner-hint sr-only",
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
        const trackHint = make("span", { className: "speed-caption", textContent: "hold & drag" });
        trackHint.setAttribute("aria-hidden", "true");
        track.title = hint.textContent;
        track.append(trackHint, fill, knob);
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
          cutoffMessage.hidden = true;
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
        // a mouse press also focuses exact editing, even
        // when the field already has focus (e.g. after Done).
        //
        // Touch/pen: the tuner opens only once this tap's click has been
        // delivered to the field, so the compatibility click can never land
        // on a control the opening tuner put under the finger. Long holds
        // without a click open after a clean release; pans and cancels
        // never open.
        let touchOpen = null;
        let selectOnClick = false;
        let selectionFrame = 0;
        const selectValue = () => {
          field.select();
          cancelAnimationFrame(selectionFrame);
          // Safari may finish placing its caret after click listeners.
          selectionFrame = requestAnimationFrame(() => {
            if (document.activeElement === field) field.select();
          });
        };
        const openFromTouch = () => {
          if (!touchOpen) return;
          clearTimeout(touchOpen.timer);
          touchOpen = null;
          openTuner();
        };
        field.addEventListener("pointerdown", (e) => {
          selectOnClick = document.activeElement !== field;
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
        field.addEventListener("click", () => {
          openFromTouch();
          // Pointer default actions can overwrite the focus selection.
          // Repeat it after the first focusing click, but preserve a later
          // deliberate caret placement within an already focused field.
          if (selectOnClick && document.activeElement === field) selectValue();
          selectOnClick = false;
        });
        field.addEventListener("focus", () => {
          openTuner();
          selectValue();
        });
        field.addEventListener("input", () => { cutoffMessage.hidden = true; });
        field.addEventListener("keydown", (e) => {
          cancelAnimationFrame(selectionFrame);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const typed = parseCutoff(field.value) ?? rule.cutoff;
            openTuner();
            setCutoff(stepCutoff(typed, e.key === "ArrowUp" ? 1 : -1), true);
          } else if (e.key === "Escape" && !tuner.hidden) {
            e.preventDefault(); // the tuner, not the Pairs window
            tuner.close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            // A text field has no implicit Enter commit outside a form.
            // Blur commits through the native change/validation/history
            // path once and dismisses the software keyboard.
            field.blur();
            tuner.close();
          }
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
          if (e.key === "Escape") {
            e.preventDefault();
            closeAndRefocus();
          }
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
        opacityInput.setAttribute("aria-label", "Polyhedron face opacity");
        opacityValue.htmlFor = opacityInput.id;
        const showOpacity = () => {
          opacityValue.value = `${opacityInput.value}%`;
          opacityInput.setAttribute("aria-valuetext", `${opacityInput.value}%`);
        };
        opacityInput.oninput = () => {
          setRuleOpacity(rule, Number(opacityInput.value) / 100);
          styleEditor?.refresh();
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
          remove.title = `Delete ${name} pair`;
          toggles.bonds.setAttribute("aria-label", `${name} bonds`);
          toggles.polyhedra.setAttribute("aria-label", `${name} polyhedra`);
          opacityInput.setAttribute(
            "aria-label",
            `${rule.center} to ${rule.neighbor} polyhedra face opacity`,
          );
        }
        label();
        card.classList.toggle("no-faces", !rule.polyhedra);
        // The tuner opens in place of the Bonds/Polyhedra/Opacity row, in
        // one shared grid cell: the card keeps its height, nothing below
        // moves and the counts stay visible while the cutoff changes.
        const slot = make("div", { className: "pair-slot" });
        slot.append(sub, tuner);
        card.append(main, cutoffMessage, slot, counts, numericKeys(inputs.cutoff, "Distance cutoff", false, {
          signed: false, nativeEnter: true, onDone: () => tuner.close(),
        }));
        return card;
      }),
    );
    styleEditor?.refresh();
  }
  $("add-rule").onclick = () => {
    if (!structure) return;
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    const center = elements.find((e) => e !== "O") || elements[0],
      neighbor = elements.includes("O") ? "O" : elements.at(-1);
    rules.push({
      id: ++nextRule,
      center,
      neighbor,
      cutoff: startingCutoff(center, neighbor),
      bonds: false,
      polyhedra: false,
      opacity: 0.34,
    });
    renderRules();
    build();
    revealAddedRow($("pair-rules"));
  };
  $("polyhedra-only").onchange = () => {
    if (structure) build();
  };
  // One path for a pair's face opacity, used by the pair slider and the
  // Style editor: rule state, the live face material (no geometry
  // rebuild) and the pair card's slider/readout stay in sync.
  const DEFAULT_FACE_OPACITY = 0.34;
  function setRuleOpacity(rule, opacity) {
    rule.opacity = Math.min(1, Math.max(0, opacity));
    const stat = coordinationStats.find((s) => s.id === rule.id);
    if (stat) stat.opacity = rule.opacity;
    const mesh = faceMeshes.get(rule.id);
    if (mesh) setFaceOpacity(mesh, rule.opacity);
    const percent = String(Math.round(rule.opacity * 100));
    const input = $(`pair-opacity-${rule.id}`);
    if (input && input.value !== percent) input.value = percent;
    if (input) input.setAttribute("aria-valuetext", `${percent}%`);
    const output = $(`pair-opacity-value-${rule.id}`);
    if (output) output.value = `${percent}%`;
    invalidate();
  }
  function setFaceOpacity(mesh, opacity) {
    mesh.visible = $("show-polyhedra").checked && opacity > 0;
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
      `${visible.toLocaleString()} visible atoms${hidden ? ` · ${hidden.toLocaleString()} hidden` : ""}` +
      (peelOverflow ? " · deepest translucent layers approximated" : "");
    const explanation =
      "More translucent faces overlap here than the 24 exactly ordered layers; the ones farthest back are blended in approximate order.";
    $("atom-summary").title = peelOverflow ? explanation : "";
    // Phones hide the atom summary; the same notice appears under the
    // mode bar there (CSS shows it on phones only), and only on overflow.
    const note = $("peel-note");
    note.hidden = !peelOverflow;
    note.textContent = peelOverflow ? `Approximate translucency: ${explanation}` : "";
  }
  function updateAtomVisibility() {
    meshes.forEach((mesh) => {
      mesh.visible = atomVisible(mesh.userData.atoms[0]);
    });
    selection = selection.filter(atomVisible);
    updateSelection();
    updateAtomSummary();
    refreshAtomAo();
    buildOrtepRings();
    if (activeDistanceSpec) highlightDistance(activeDistanceSpec);
    invalidate();
  }
  $("show-atoms").onchange = updateAtomVisibility;
  $("show-polyhedra").onchange = () => {
    for (const mesh of faceMeshes.values()) {
      mesh.visible = $("show-polyhedra").checked && mesh.material.opacity > 0;
      if (mesh.userData.outline) mesh.userData.outline.visible = $("show-polyhedra").checked;
    }
    updatePickMarker();
    invalidate();
  };
  // Central atom key → [{ pair, coordination, volume }] for inspection.
  const polyInfo = new Map();
  function buildCoordination() {
    polyInfo.clear();
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
      // In the asymmetric-unit view, pairs are paused (rules kept intact)
      // so completed shells cannot re-add expanded atoms.
      stat.paused = asymmetric;
      if (!asymmetric && (rule.bonds || rule.polyhedra)) {
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
              ? convexHull(vertices.map((a) => a.cartesian), env.center.cartesian)
              : null;
            // Physical volume from the true neighbor coordinates, computed
            // once; display scale and opacity never enter it.
            if (hull)
              plan.hulls.push({
                center: env.center,
                vertices,
                hull,
                volume: hull.planar ? 0 : hullVolume(hull.vertices, hull.faces),
              });
            if (rule.bonds)
              for (const atom of vertices) plan.bonds.push([env.center, atom]);
          }
          // Publish a rule only after all its geometry has succeeded.
          for (const item of plan.hulls) {
            const indices = [...new Set(item.hull.faces.flat())];
            used.add(atomKey(item.center));
            indices.forEach((i) => used.add(atomKey(item.vertices[i])));
            const centerKey = atomKey(item.center);
            stat.environments.push({
              center: centerKey,
              centerLabel: item.center.label,
              coordination: item.vertices.length,
              volume: item.volume,
              vertices: indices.map((i) => atomKey(item.vertices[i])),
              edgeCount: item.hull.edges.length,
              faceCount: item.hull.faces.length,
            });
            if (!polyInfo.has(centerKey)) polyInfo.set(centerKey, []);
            polyInfo.get(centerKey).push({
              pair: pairName(rule),
              coordination: item.vertices.length,
              volume: item.volume,
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
    const enabledPolyhedra = !asymmetric && rules.some((rule) => rule.polyhedra);
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
        // Two-tone bonds draw each half in its end atom's color; otherwise
        // one cylinder per bond takes the pair color. 16 segments keep the
        // round profile at close zoom.
        const twoTone = $("style-two-tone-bonds").checked;
        const cylinders = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(1, 1, 1, 16),
          new THREE.MeshStandardMaterial({
            color: twoTone ? 0xffffff : plan.color,
            roughness: 0.55,
          }),
          acceptedBonds.length * (twoTone ? 2 : 1),
        );
        const position = new THREE.Vector3(), tint = new THREE.Color();
        acceptedBonds.forEach(([a, b], i) => {
          const delta = b.position.clone().sub(a.position);
          const length = delta.length();
          rotation.setFromUnitVectors(up, delta.clone().normalize());
          if (!twoTone) {
            scale.set(0.045, length, 0.045);
            matrix.compose(position.copy(a.position).addScaledVector(delta, 0.5), rotation, scale);
            cylinders.setMatrixAt(i, matrix);
            return;
          }
          scale.set(0.045, length / 2, 0.045);
          [[a, 0.25], [b, 0.75]].forEach(([atom, t], half) => {
            matrix.compose(position.copy(a.position).addScaledVector(delta, t), rotation, scale);
            cylinders.setMatrixAt(2 * i + half, matrix);
            cylinders.setColorAt(2 * i + half, tint.set(styleOf(atom).color));
          });
        });
        cylinders.instanceMatrix.needsUpdate = true;
        if (cylinders.instanceColor) cylinders.instanceColor.needsUpdate = true;
        model.add(cylinders);
      }
      // All polyhedra of a pair share one face mesh and one edge mesh.
      // Per-polyhedron colour is a vertex colour. Faces and edges always
      // use the actual neighbor coordinates.
      const positions = [],
        faceColors = [],
        edges = [],
        edgeColors = [],
        owners = [],
        styles = [],
        tint = new THREE.Color();
      plan.hulls.forEach(({ center, vertices, hull }, owner) => {
        const key = atomKey(center);
        const style = polyhedronStyle(appearance, plan.rule, key, plan.color);
        styles.push({ center: key, color: style.color, scale: style.scale });
        tint.set(style.color);
        const place = (atom) => atom.position;
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
            edgeColors.push(tint.r * 0.78, tint.g * 0.78, tint.b * 0.78);
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
        // Crisp screen-space edges, one per-vertex color per polyhedron.
        const edgeGeometry = new LineSegmentsGeometry();
        if (edges.length) {
          edgeGeometry.setPositions(edges);
          edgeGeometry.setColors(edgeColors);
        }
        const outline = new LineSegments2(
          edgeGeometry,
          new LineMaterial({
            vertexColors: true,
            linewidth: 1.25,
            transparent: true,
            opacity: 0.9,
          }),
        );
        outline.visible = $("show-polyhedra").checked;
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
      const groups = polyhedronGroups([stat]);
      const siteCounts = Object.entries(stat.siteCounts)
        .map(([label, counts]) => `${label}: ${counts.join(", ")}`)
        .join(" · ");
      p.title = siteCounts ? `Neighbors per site · ${siteCounts}` : "";
      p.classList.toggle("error", Boolean(stat.error));
      p.textContent =
        stat.error ||
        (stat.paused
          ? "Paused in asymmetric-unit view"
          : !(stat.bonds || stat.polyhedra)
          ? "Off · enable bonds or polyhedra"
          : `${groups.size ? "" : `CN ${stat.counts.join(", ") || "0"} · `}${stat.centerCount || 0} centers · ${stat.polyhedronCount} poly · ${stat.bondCount} bonds`);
      const readouts = [...groups.values()].map((g) => {
        const line = make("span", {
          className: "pair-coordination",
          textContent: `${g.label}: CN ${[...g.cn].sort((a, b) => a - b).join(", ")} · V ${polyhedronVolumeRange(g, " Å³")}`,
          title: "Polyhedron volume from true neighbor positions; display scale does not change it.",
        });
        return line;
      });
      p.prepend(...readouts);
    }
    const note = $("isolation-note");
    note.textContent =
      isolated && !polyhedronCount
        ? "No complete polyhedra at these cutoffs."
        : rules.length
          ? ""
          : "Add a pair to draw bonds or polyhedra.";
    note.hidden = !note.textContent;
    renderPolyTable();
  }
  // ---- Sites inspector: CIF sites and polyhedron volumes ----------------
  const frac3 = (f) => f.map((v) => v.toFixed(4));
  function renderSiteTable() {
    const body = $("site-table").tBodies[0];
    if (!structure) return body.replaceChildren();
    const sites = independentSites();
    body.replaceChildren(
      ...sites.map((s, i) => {
        const row = document.createElement("tr");
        row.tabIndex = 0;
        row.dataset.site = s.label;
        row.title = `Highlight every visible copy of ${s.label}`;
        const vals = [s.label, s.element, ...frac3(s.frac), s.occupancy != null ? Number(s.occupancy).toFixed(3) : "—"];
        vals.forEach((text, col) => {
          const cell = document.createElement("td");
          if (col === 1) {
            const dot = document.createElement("span");
            dot.className = "site-el-dot";
            dot.style.background = colorFor(s.element);
            dot.setAttribute("aria-hidden", "true");
            cell.append(dot, document.createTextNode(text));
          } else if (col >= 2 && col <= 4) {
            const m = text.match(/^(.*?\.\d*?)(0+)$/);
            if (m && m[1].length > 2) {
              const trail = document.createElement("span");
              trail.className = "frac-trail";
              trail.textContent = m[2];
              cell.append(document.createTextNode(m[1]), trail);
            } else {
              cell.textContent = text;
            }
          } else {
            cell.textContent = text;
          }
          row.append(cell);
        });
        const choose = () => selectSite(highlightedSite === s.label ? null : s.label);
        row.onclick = choose;
        row.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose();
          }
        };
        row.setAttribute("aria-label", `${s.label}, ${s.element}, ${frac3(s.frac).join(" ")}, occupancy ${s.occupancy ?? "unknown"}`);
        void i;
        return row;
      }),
    );
    if (!Array.isArray(structure.independentSites))
      $("asym-note").textContent = "This engine build does not report independent sites; showing the first copy of each label.";
  }
  // Shared by Pairs and Sites: CN set and physical volume range per site.
  function polyhedronGroups(stats) {
    const groups = new Map();
    for (const stat of stats)
      for (const env of stat.environments) {
        const key = `${pairName(stat)}|${env.centerLabel}`;
        if (!groups.has(key))
          groups.set(key, { pair: pairName(stat), label: env.centerLabel, cn: new Set(), volumes: [] });
        const g = groups.get(key);
        g.cn.add(env.coordination);
        g.volumes.push(env.volume);
      }
    return groups;
  }
  function polyhedronVolumeRange(g, unit = "") {
    const lo = Math.min(...g.volumes), hi = Math.max(...g.volumes);
    const value = hi - lo < 5e-4 ? lo.toFixed(3) : `${lo.toFixed(3)}–${hi.toFixed(3)}`;
    return value + unit + (hi === 0 ? " (planar)" : "");
  }
  function renderPolyTable() {
    const body = $("poly-table")?.tBodies[0];
    if (!body) return;
    const groups = polyhedronGroups(coordinationStats);
    body.replaceChildren(
      ...[...groups.values()].map((g) => {
        const row = document.createElement("tr");
        const volume = polyhedronVolumeRange(g);
        for (const text of [g.label, g.pair, [...g.cn].sort((a, b) => a - b).join(", "), volume]) {
          const cell = document.createElement("td");
          cell.textContent = text;
          row.append(cell);
        }
        row.tabIndex = 0;
        row.title = `Highlight ${g.label} centers`;
        const choose = () => selectSite(highlightedSite === g.label ? null : g.label);
        row.onclick = choose;
        row.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose();
          }
        };
        return row;
      }),
    );
    $("poly-note").textContent = asymmetric
      ? "Pairs are paused in the asymmetric-unit view."
      : groups.size
        ? "Volumes from true neighbor positions; display scale does not change them."
        : "Enable Polyhedra on a pair to list coordination volumes.";
  }
  // Highlight all visible copies of one CIF site (amber shells, capped).
  let highlightedSite = null;
  let inspectedShellCenter = null;
  const siteGroup = new THREE.Group();
  scene.add(siteGroup);
  function selectSite(label) {
    // A table row inspects the equivalent site copies, not a previously
    // picked individual atom. Keep distance/angle measurements separate.
    if (measureMode === "info" && selection.length) {
      selection = [];
      updateSelection();
    }
    highlightSite(label);
  }
  function inspectShell(center) {
    inspectedShellCenter = center ?? null;
    $("shell-controls").hidden = !center;
    const summary = $("shell-summary"), body = $("shell-ligands");
    summary.hidden = !center;
    body.replaceChildren();
    if (!center) { summary.textContent = "Select a site to inspect its periodic neighbors."; return; }
    try {
      const input = $("shell-cutoff");
      if (!input.validity.valid) throw Error("Choose a cutoff from 0.01 to 30 Å.");
      const shell = siteShell(structure, center, input.value ? input.valueAsNumber : null);
      const stats = [center.label, "CN " + shell.count];
      if (shell.count) stats.push("Mean " + shell.mean.toFixed(4) + " Å", "Baur D " + shell.distortion.toFixed(4));
      if (shell.volume != null) stats.push("V " + shell.volume.toFixed(3) + " Å³");
      if (shell.partial) stats.push("Includes partially occupied positions. CN counts geometric neighbors.");
      summary.textContent = stats.join(" · ");
      for (const group of shell.groups) {
        const row = body.insertRow();
        for (const value of [group.atom.label, group.atom.element, group.distance.toFixed(4), group.count]) row.insertCell().textContent = value;
      }
      if ($("shell-outline").checked && shell.edges.length && atoms.some(a => a === center)) {
        const points = shell.edges.flatMap(edge => edge.map(i => new THREE.Vector3(...shell.points[i]).sub(modelCenter)));
        siteGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: scenePalette().pick})));
      }
    } catch (error) { summary.textContent = error.message; }
  }
  for (const id of ["shell-cutoff","shell-outline"]) $(id).onchange = () => { highlightSite(highlightedSite); scheduleSave(); };
  function highlightSite(label) {
    highlightedSite = label;
    dispose(siteGroup);
    siteGroup.clear();
    // Rendered positions are relative to the plotted extent's Cartesian
    // center. Pick a central equivalent copy, not the first boundary image;
    // panning and rotating the camera must not move the inspected shell.
    const copies = label ? atoms.filter(a => a.label === label && atomVisible(a)) : [];
    const center = copies.reduce((best, atom) =>
      !best || atom.position.lengthSq() < best.position.lengthSq() - 1e-10 ? atom : best, null);
    inspectShell(label && (center ?? independentSites().find(a => a.label === label)));
    for (const row of document.querySelectorAll("#site-table tbody tr, #poly-table tbody tr"))
      row.classList.toggle("selected", Boolean(label) && row.cells[0].textContent === label);
    if (label) {
      const copies = atoms.filter((a) => a.label === label && atomVisible(a)).slice(0, 400);
      if (copies.length) {
        const shells = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 32, 24),
          new THREE.MeshBasicMaterial({ color: scenePalette().pick, side: THREE.BackSide, transparent: true, opacity: 0.8 }),
          copies.length,
        );
        const m = new THREE.Matrix4();
        copies.forEach((a, i) =>
          shells.setMatrixAt(i, applyHaloMatrix(a, 1.12, m)),
        );
        shells.instanceMatrix.needsUpdate = true;
        siteGroup.add(shells);
      }
    }
    invalidate();
  }
  function orient(indices, viewId = "uvw") {
    if (!structure) return;
    try {
      const { direction, up } = latticeViewDirection(structure.basis, indices);
      const target = controls.target.clone();
      const zoomDistance = camera.position.distanceTo(target);
      const dir = new THREE.Vector3(...direction).normalize();
      lastOrientIndices = [...indices]; // for restoring the lit view button
      stopMotion();
      camera.up.set(...up);
      camera.position.copy(target).addScaledVector(dir, zoomDistance);
      // Touch pan and anchored pinch move the view target. An explicit direction
      // starts from the full structure again, fitted to this canvas aspect.
      // Translating the target and camera together keeps [uvw] exact.
      reset(true);
      setActiveView(viewId, dir);
      if (viewId === "uvw") $("view-direction").value = indices.join(" ");
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
    try {
      orient(parseTriple($("view-direction").value, { label: "components" }));
    } catch (error) {
      $("direction-error").textContent = error.message;
    }
  };
  enableTripletSelection($("view-direction"));
  $("direction-form").insertBefore(
    numericKeys($("view-direction"), "[uvw]", true, {
      fractionalIndices: true,
      onDone: () => $("direction-form").requestSubmit(),
    }),
    $("direction-error"),
  );
  // Fit uses the full canvas and fixed-size view controls, independently
  // of which overlay is open. Only explicit view actions refit the model.
  function overlayReserve() {
    const view = viewport.getBoundingClientRect();
    const top = document.querySelector(".view-directions").getBoundingClientRect();
    const bottom = document.querySelector(".atoms-bar").getBoundingClientRect();
    const readout = $("view-readout").getBoundingClientRect();
    const bottomTop = Math.min(bottom.top, readout.height ? readout.top : bottom.top);
    return Math.max(top.bottom - view.top, view.bottom - bottomTop) + 4;
  }
  let fitPose = null;
  function isAtFit() {
    if (!fitPose) return false;
    const tolerance = 1e-5 * fitPose.distance;
    return (
      Math.abs(camera.position.distanceTo(controls.target) - fitPose.distance) <= tolerance &&
      controls.target.distanceTo(fitPose.target) <= tolerance
    );
  }
  const boxCorners = (box) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map(
      (i) =>
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
    );
  function reset(keepOrientation = false) {
    if (!keepOrientation) selection = [];
    updateSelection();
    // Fit what is drawn — cell edges, atom spheres, physical polyhedra
    // and planes/arrows/symmetry elements — by its projected extent
    // in the orientation being shown (orthographic view), not by a
    // bounding sphere, which framed elongated cells far too small.
    const bounds = fitBounds.clone().union(latticeTools.bounds());
    const target = bounds.getCenter(new THREE.Vector3());
    const direction = keepOrientation
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(0.68, 0.48, 0.8).normalize();
    // The first fit precedes the first frame and camera placement. Show its
    // direction readout now to reserve the same space as every later fit.
    updateViewReadout(direction);
    const viewUp = keepOrientation ? camera.up.clone() : new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), viewUp);
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    let minRight = Infinity, maxRight = -Infinity,
      minUp = Infinity, maxUp = -Infinity;
    const offset = new THREE.Vector3();
    const extend = (point, radius = 0) => {
      offset.copy(point).sub(target);
      const x = offset.dot(right), y = offset.dot(up);
      minRight = Math.min(minRight, x - radius);
      maxRight = Math.max(maxRight, x + radius);
      minUp = Math.min(minUp, y - radius);
      maxUp = Math.max(maxUp, y + radius);
    };
    for (const corner of fitCorners) extend(corner);
    if (atoms.length <= 200000) for (const a of atoms) extend(a.position, a.radius ?? 0);
    else for (const corner of boxCorners(fitBounds)) extend(corner);
    const extra = new THREE.Box3();
    for (const faces of faceMeshes.values()) {
      if (!faces.visible) continue;
      faces.geometry.computeBoundingBox();
      extra.union(faces.geometry.boundingBox);
    }
    extra.union(latticeTools.bounds());
    if (!extra.isEmpty()) for (const corner of boxCorners(extra)) extend(corner);
    // A world-space bounding-box center can look off-center after rotation,
    // especially with a skew cell or unequal atom sizes. Center the actual
    // projected extent without tilting away from the requested lattice axis.
    target.addScaledVector(right, (minRight + maxRight) / 2)
      .addScaledVector(up, (minUp + maxUp) / 2);
    const halfRight = Math.max((maxRight - minRight) / 2, 0.5);
    const halfUp = Math.max((maxUp - minUp) / 2, 0.5);
    // Canvas toolbars sit along the top and bottom edges; fit the crystal
    // between them. Settings overlays never influence this fit.
    const height = viewport.clientHeight || 1;
    const clear = { x: 0, y: 0, w: viewport.clientWidth || 1, h: height };
    const usable = Math.max(clear.h - 2 * overlayReserve(), clear.h * 0.7);
    const halfHeight =
      Math.max(halfUp * (height / usable), halfRight * (height / Math.max(clear.w, 1))) * 1.06;
    fitDistance = halfHeight / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
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
    fitPose = { distance: fitDistance, target: target.clone() };
    invalidate();
  }
  function addMeasurementLine(points, style, renderOrder = 5) {
    const line = new Line2(
      new LineGeometry().setFromPoints(points),
      new LineMaterial({ linewidth: 2.5, depthTest: false, ...style }),
    );
    if (style.dashed) line.computeLineDistances();
    line.renderOrder = renderOrder;
    selectionGroup.add(line);
  }
  function updateSelection() {
    dispose(selectionGroup);
    selectionGroup.clear();
    selectionRims.length = 0;
    // Eight arcs form a camera-facing ring just outside the atom silhouette.
    // Gaps are real geometry so they also stay open in the depth prepass.
    const step = Math.PI / 4;
    const gap = 0.21;
    for (const atom of selection) {
      const arc = new THREE.RingGeometry(1.06, 1.145, 12, 1, gap / 2, step - gap);
      const material = new THREE.MeshBasicMaterial({ color: scenePalette().selectionRim, toneMapped: false });
      const rim = new THREE.InstancedMesh(arc, material, 8);
      const rotation = new THREE.Matrix4();
      for (let i = 0; i < rim.count; i++) rim.setMatrixAt(i, rotation.makeRotationZ(i * step));
      rim.scale.setScalar(atom.radius);
      rim.position.copy(atom.position);
      selectionRims.push(rim);
      selectionGroup.add(rim);
    }
    distance = null;
    angle = null;
    if (measureMode === "angle" && selection.length >= 2) {
      // A–B–C: two solid legs from the vertex B and an arc at B.
      const [a, b, c] = selection;
      addMeasurementLine(selection.map((atom) => atom.position), { color: scenePalette().select });
      if (c) {
        angle = angleAt(a.position.toArray(), b.position.toArray(), c.position.toArray());
        if (angle !== null) {
          const u = a.position.clone().sub(b.position),
            v = c.position.clone().sub(b.position);
          const radius = 0.3 * Math.min(u.length(), v.length());
          u.normalize();
          v.normalize();
          let axis = u.clone().cross(v);
          if (axis.lengthSq() < 1e-12) {
            // 180°: any axis perpendicular to the legs.
            axis = new THREE.Vector3(1, 0, 0).cross(u);
            if (axis.lengthSq() < 1e-12) axis = new THREE.Vector3(0, 1, 0).cross(u);
          }
          axis.normalize();
          const steps = 24,
            radians = THREE.MathUtils.degToRad(angle);
          const arc = [];
          for (let i = 0; i <= steps; i++)
            arc.push(
              u.clone().applyAxisAngle(axis, (radians * i) / steps).multiplyScalar(radius).add(b.position),
            );
          addMeasurementLine(arc, { color: scenePalette().arc }, 6);
        }
      }
    }
    if (measureMode === "distance" && selection.length === 2) {
      distance = selection[0].position.distanceTo(selection[1].position);
      addMeasurementLine(selection.map((atom) => atom.position), {
        color: scenePalette().select,
        dashed: true,
        dashSize: Math.max(distance / 24, 0.04),
        gapSize: Math.max(distance / 48, 0.02),
      });
    }
    const picking = Boolean(styleEditor?.picking);
    // Style picking keeps the card compact (accent frame + hint on larger
    // screens); the Style panel's pressed "Tap crystal" button says it is on.
    $("measure-overlay").classList.toggle("active", selection.length > 0 && !picking);
    $("measure-overlay").classList.toggle("picking", picking);
    $("clear").disabled = !selection.length;
    const angleMode = measureMode === "angle";
    const value = angleMode ? angle : distance;
    $("distance").replaceChildren(
      document.createTextNode(
        value === null
          ? angleMode && selection.length === 3
            ? "undefined "
            : "— "
          : `${value.toFixed(angleMode ? 2 : 4)} `,
      ),
      Object.assign(document.createElement("span"), { textContent: angleMode ? "°" : "Å" }),
    );
    const needed = angleMode ? 3 : 2;
    // Each picked copy with its CIF site label and fractional position;
    // a polyhedron center also shows its CN and physical volume.
    const lines = selection.map((a, i) => {
      const role = angleMode ? `${"ABC"[i]}${i === 1 ? " (vertex)" : ""} ` : "";
      return `${role}${a.label} (${a.frac.map((v) => v.toFixed(3)).join(", ")})`;
    });
    if (selection.length === 1)
      for (const info of polyInfo.get(atomKey(selection[0])) ?? [])
        lines.push(`${info.pair}: CN ${info.coordination} · V ${info.volume.toFixed(3)} Å³`);
    $("selection").textContent = picking
      ? "Style picking: tap one atom or polyhedron."
      : selection.length
        ? lines.join("\n") +
          (selection.length < needed
            ? `\nTap ${angleMode ? (selection.length === 1 ? "the vertex atom" : "a third atom") : "a second atom"}`
            : "")
        : $("show-atoms").checked
          ? angleMode
            ? "Tap three atoms; the second is the vertex."
            : "Tap two atoms to measure."
          : "Show atoms to measure.";
    $("selection").title = selection
      .map((a) => `${a.label} [${a.frac.map((v) => v.toFixed(4)).join(", ")}]`)
      .join("\n");
    if (measureMode === "info" && !picking) showAtomInfo();
    if (!selection.length || picking) setDetailsOpen(false);
    else boundDetails();
    const card = $("measure-overlay").querySelector(".measure-details");
    card.classList.toggle("overflowing", card.scrollHeight > card.clientHeight + 1);
    invalidate();
  }
  // Phones: the measurement column shows only the value (or the atom's
  // label) under the fixed action buttons. "Details" opens the full lines
  // as a bounded popover beside it, inside the area tool sheets leave
  // clear; it scrolls locally and never moves another control.
  let detailsOpen = false;
  function setDetailsOpen(open) {
    if (open === detailsOpen) return;
    detailsOpen = open;
    $("measure-more").setAttribute("aria-expanded", String(open));
    $("measure-more").textContent = open ? "Hide" : "Details";
    $("measure-overlay").classList.toggle("details-open", open);
    boundDetails();
    invalidate(); // plane labels avoid the popover
  }
  function boundDetails() {
    const details = $("selection");
    if (!detailsOpen || !$("measure-more").getClientRects().length) {
      details.style.maxHeight = details.style.top = "";
      return;
    }
    const view = viewport.getBoundingClientRect();
    const clear = stage.clear ?? { y: 0, h: view.height };
    const footer = document.querySelector(".view-bottom").getBoundingClientRect();
    const bottom = Math.min(view.top + clear.y + clear.h, footer.height ? footer.top : view.bottom) - 8;
    const cardTop = $("measure-overlay").querySelector(".measure-details").getBoundingClientRect().top;
    let top = cardTop;
    if (bottom - top < 72) {
      // Beside the action column, above the legend on short phones. The
      // Details/Hide button and every scientific editor remain reachable.
      const toolbarBottom = Math.max(document.querySelector(".view-directions").getBoundingClientRect().bottom, $("turn-open").getBoundingClientRect().bottom);
      top = Math.max(toolbarBottom + 8, bottom - 120);
    }
    details.style.top = `${top - cardTop}px`;
    details.style.maxHeight = `${Math.max(36, bottom - top)}px`;
  }
  $("measure-more").onclick = () => setDetailsOpen(!detailsOpen);
  document.addEventListener("pointerdown", (event) => {
    if (detailsOpen && event.target !== renderer.domElement && !$("measure-overlay").contains(event.target)) setDetailsOpen(false);
  });
  $("measure-overlay").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && detailsOpen) {
      event.preventDefault();
      setDetailsOpen(false);
      $("measure-more").focus({ preventScroll: true });
    }
  });
  // Info: one atom at a time — label, element, occupancy, fractional and
  // Cartesian position, and the CN/volume of configured polyhedra around
  // it. No distance is implied. On phones the label shows under the action
  // buttons and the lines open with Details.
  function atomInfoLines(a) {
    const lines = [
      `${a.element} · occupancy ${a.occupancy != null ? Number(a.occupancy).toFixed(3) : "—"}`,
      `frac ${a.frac.map((v) => v.toFixed(4)).join("  ")}`,
      `xyz ${a.cartesian.map((v) => v.toFixed(4)).join("  ")} Å`,
    ];
    for (const info of polyInfo.get(atomKey(a)) ?? [])
      lines.push(`${info.pair}: CN ${info.coordination} · V ${info.volume.toFixed(3)} Å³`);
    return lines;
  }
  function showAtomInfo() {
    const a = selection[0];
    $("distance").replaceChildren(document.createTextNode(a ? a.label : "—"));
    const lines = a ? atomInfoLines(a) : [];
    $("selection").textContent = a ? lines.join("\n") : $("show-atoms").checked ? "Tap an atom for its details." : "Show atoms to inspect.";
  }
  // Distance (2 atoms) · Angle (3) · Info (1). Each mode starts a fresh selection.
  function setMeasureMode(mode) {
    if (mode !== measureMode) selection = [];
    measureMode = mode;
    for (const [id, m] of [
      ["measure-distance", "distance"],
      ["measure-angle", "angle"],
      ["measure-info", "info"],
    ])
      $(id).setAttribute("aria-pressed", String(mode === m));
    $("measure-overlay").setAttribute(
      "aria-label",
      { angle: "Angle measurement", distance: "Distance measurement", info: "Atom info" }[mode],
    );
    $("measure-overlay").classList.toggle("info-mode", mode === "info");
    updateSelection();
  }
  $("measure-distance").onclick = () => setMeasureMode("distance");
  $("measure-angle").onclick = () => setMeasureMode("angle");
  $("measure-info").onclick = () => setMeasureMode("info");
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
  // Right button: drag = 1:1 pan; a click without movement zooms out one
  // step about the cursor; a second click within 350 ms and 8 px fits the
  // whole visible scene, keeping the orientation. Cancel or lost capture
  // never counts as a click.
  const CLICK_SLOP = 4,
    DOUBLE_MS = 350,
    DOUBLE_PX = 8,
    CLICK_ZOOM_OUT = 1.25;
  let lastRightClick = null;
  function rightClick(e) {
    const now = performance.now();
    const isDouble =
      lastRightClick &&
      now - lastRightClick.time <= DOUBLE_MS &&
      Math.hypot(e.clientX - lastRightClick.x, e.clientY - lastRightClick.y) <= DOUBLE_PX;
    if (isDouble) {
      lastRightClick = null;
      reset(true); // fit everything visible, orientation and selection kept
    } else {
      lastRightClick = { time: now, x: e.clientX, y: e.clientY };
      zoomAt(e.clientX, e.clientY, CLICK_ZOOM_OUT);
    }
  }
  function endPan(e) {
    if (!pan || (e && e.pointerId !== pan.id)) return;
    const { id, moved } = pan;
    pan = null;
    if (renderer.domElement.hasPointerCapture(id))
      renderer.domElement.releasePointerCapture(id);
    e?.stopImmediatePropagation();
    if (e?.type === "pointerup" && !moved) rightClick(e);
  }
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 2 || e.pointerType !== "mouse" || pan) return;
      e.stopImmediatePropagation(); // Trackball and atom picking ignore it
      e.preventDefault();
      stopMotion(); // cancel any rotation/zoom inertia first
      renderer.domElement.setPointerCapture(e.pointerId);
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    },
    true,
  );
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener(
    "pointermove",
    (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      e.stopImmediatePropagation();
      // Below the click slop nothing moves; once exceeded, the full offset
      // from the press is applied, so panning stays exactly 1:1.
      if (!pan.moved && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < CLICK_SLOP) return;
      pan.moved = true;
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
  // Wheel zoom anchored at the cursor. Captured before TrackballControls
  // (whose own wheel zoom and its inertia never run). The world point on
  // the view plane under the cursor, target + right·nx·hw + up·ny·hh, stays
  // put when the half extents scale by f: the target moves by
  // (right·nx·hw + up·ny·hh)(1 − f) and the camera keeps its direction.
  const zoomRight = new THREE.Vector3(),
    zoomUp = new THREE.Vector3(),
    zoomShift = new THREE.Vector3(),
    zoomDirection = new THREE.Vector3();
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (pan) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      const delta = e.deltaY * lines;
      if (!delta) return;
      // Smooth exponential scaling; one notch (~100 px) ≈ 16 %, clamped
      // per event so large trackpad bursts stay controllable.
      zoomAt(e.clientX, e.clientY, THREE.MathUtils.clamp(Math.exp(delta * 0.0015), 0.5, 2));
    },
    { capture: true, passive: false },
  );
  /** Scale the view by `factor` (> 1 zooms out) keeping the point under
   *  (clientX, clientY) fixed; honors the min/max distances. */
  function zoomAt(clientX, clientY, factor) {
    {
      const rect = renderer.domElement.getBoundingClientRect();
      const distanceNow = camera.position.distanceTo(controls.target);
      const distanceNext = THREE.MathUtils.clamp(
        distanceNow * factor,
        controls.minDistance,
        controls.maxDistance,
      );
      factor = distanceNext / distanceNow;
      if (Math.abs(factor - 1) < 1e-9) return;
      // Relative to the view target at the center of the canvas.
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1,
        ny = 1 - ((clientY - rect.top) / rect.height) * 2;
      const halfHeight = distanceNow * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const halfWidth = halfHeight * camera.aspect;
      camera.updateMatrixWorld();
      zoomRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      zoomUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      zoomShift
        .copy(zoomRight)
        .multiplyScalar(nx * halfWidth)
        .addScaledVector(zoomUp, ny * halfHeight)
        .multiplyScalar(1 - factor);
      zoomDirection.copy(camera.position).sub(controls.target).normalize();
      controls.target.add(zoomShift);
      camera.position.copy(controls.target).addScaledVector(zoomDirection, distanceNext);
      invalidate();
    }
  }
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    active = new Set();
  faceSorter.enablePicking(raycaster);
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
    if (active.has(e.pointerId)) {
      if (e.pointerType === "touch") extendTouchPreview();
      invalidate();
    }
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
      historyLabel = "Pick atom";
      const atom = hit.object.userData.atoms[hit.instanceId];
      // Info inspects one atom (a new tap replaces it); a completed
      // distance (2) or angle (3) starts a new measurement.
      if (measureMode === "info") selection = [];
      else if (selection.length === (measureMode === "angle" ? 3 : 2)) selection = [];
      if (!selection.includes(atom)) selection.push(atom);
      // A crystal pick always targets individual atoms, even with Sites
      // open. Only an explicit table-row choice highlights a whole site.
      if (highlightedSite) highlightSite(null);
      updateSelection();
    } else if (
      selection.length &&
      (measureMode === "info" || selection.length === (measureMode === "angle" ? 3 : 2))
    ) {
      historyLabel = "Clear selection";
      // Only an un-dragged empty click reaches here. Keep partial
      // measurements so an imprecise tap never discards the first picks.
      selection = [];
      updateSelection();
    }
  });
  // ---- Appearance editor host -------------------------------------------
  // Targets: "element:Mg", "pair:<rule id>", "atom:<atom key>",
  // "poly:<rule id>|<centre atom key>". Picked individuals keep their
  // element, label and rule in `targetMeta`, so they stay editable while a
  // range or cutoff change temporarily removes that copy.
  const targetMeta = new Map();
  const STYLE_KEYS = ["color", "scale"];
  // Remove the given style properties from narrower overrides in scope;
  // drop an override once it no longer sets any style property.
  function clearNarrower(map, inScope, keys) {
    for (const [key, override] of [...map]) {
      if (!inScope(key, override)) continue;
      for (const k of keys) delete override[k];
      if (!STYLE_KEYS.some((k) => override[k] != null)) map.delete(key);
    }
  }
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
          label: `${pairTargetLabel(r)} polyhedra`,
          group: "All polyhedra of pair",
        })),
        // Every individually styled copy stays selectable, so each one can
        // be adjusted or reset later (not only the last pick).
        ...[...appearance.atoms.keys()].map((key) => {
          const meta = targetMeta.get(`atom:${key}`);
          return {
            value: `atom:${key}`,
            label: meta ? `${meta.label} ${meta.frac}` : "Atom copy",
            group: "Individually styled",
          };
        }),
        ...[...appearance.polyhedra.keys()]
          .filter((key) => ruleById(key.split("|")[0]))
          .map((key) => {
            const meta = targetMeta.get(`poly:${key}`);
            const rule = ruleById(key.split("|")[0]);
            return {
              value: `poly:${key}`,
              label: `${pairName(rule)} around ${meta?.label ?? "centre"}`,
              group: "Individually styled",
            };
          }),
      ];
    },
    individualCount: () => appearance.atoms.size + appearance.polyhedra.size,
    // Reset every one-copy atom and polyhedron override; element and pair
    // styles stay as they are.
    // A new element palette recolors every element without a custom color.
    onPaletteChange() {
      if (!structure) return;
      for (const e of new Set(structure.atoms.map((a) => a.element))) refreshElementDot(e);
      for (const rule of rules) refreshPairColor(rule);
      restyle(true);
      scheduleSave();
    },
    resetIndividuals() {
      appearance.atoms.clear();
      appearance.polyhedra.clear();
      restyle(true);
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
          // Reset is available while the element or any copy of it is styled.
          overridden: Boolean(own) || [...appearance.atoms.values()].some((o) => o.element === id),
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
      const opacity = rule.opacity ?? DEFAULT_FACE_OPACITY;
      if (type === "pair")
        return {
          title: `All ${pairTargetLabel(rule)} polyhedra`,
          kind: "poly",
          color: ruleColor(rule),
          opacity,
          opacityLabel: "Opacity",
          overridden:
            rule.color != null ||
            Math.abs(opacity - DEFAULT_FACE_OPACITY) > 1e-9 ||
            [...appearance.polyhedra.keys()].some((key) => key.startsWith(`${rule.id}|`)),
        };
      const meta = targetMeta.get(value);
      const style = polyhedronStyle(appearance, rule, centerKey, ruleColor(rule));
      return {
        title: `${pairName(rule)} polyhedron around ${meta?.label ?? "centre"} ${meta?.frac ?? ""} · this one only`,
        kind: "poly",
        ...style,
        // Face opacity is per pair; labelled so it never implies a
        // one-copy override.
        opacity,
        opacityLabel: "Pair opacity",
        overridden: appearance.polyhedra.has(polyKey(rule.id, centerKey)),
      };
    },
    // A broad edit is honest: setting a property for all Mg atoms (or all
    // polyhedra of a pair) also applies to individually styled copies, by
    // clearing just that property from their overrides. Other properties
    // of those copies (e.g. a custom size when only color changes) stay.
    apply(value, patch, final) {
      const { type, id } = parseTarget(value);
      if (type === "pair" || type === "poly") {
        if (patch.color == null) return;
        patch = { color: patch.color };
      }
      const keys = Object.keys(patch);
      if (type === "element") {
        merge(appearance.elements, id, patch);
        clearNarrower(appearance.atoms, (_, o) => o.element === id, keys);
        refreshElementDot(id);
      } else if (type === "atom") {
        const meta = targetMeta.get(value);
        merge(appearance.atoms, id, { ...patch, element: meta?.element });
      } else if (type === "pair") {
        const rule = ruleById(id);
        if (!rule) return;
        Object.assign(rule, patch);
        clearNarrower(appearance.polyhedra, (key) => key.startsWith(`${id}|`), keys);
        refreshPairColor(rule);
      } else if (type === "poly") merge(appearance.polyhedra, id, patch);
      restyle(final);
    },
    // Broad reset clears the element/pair style and every narrower
    // override within it; one-copy reset falls back to the inherited style.
    reset(value) {
      const { type, id } = parseTarget(value);
      if (type === "element") {
        appearance.elements.delete(id);
        clearNarrower(appearance.atoms, (_, o) => o.element === id, STYLE_KEYS);
        refreshElementDot(id);
      } else if (type === "atom") appearance.atoms.delete(id);
      else if (type === "pair") {
        const rule = ruleById(id);
        if (rule) {
          delete rule.color;
          delete rule.scale;
          clearNarrower(appearance.polyhedra, (key) => key.startsWith(`${id}|`), STYLE_KEYS);
          setRuleOpacity(rule, DEFAULT_FACE_OPACITY);
          refreshPairColor(rule);
        }
      } else if (type === "poly") appearance.polyhedra.delete(id);
      restyle(true);
    },
    // Live face opacity for polyhedron targets (pair-wide), no rebuild.
    setOpacity(value, opacity) {
      const { type, id } = parseTarget(value);
      const rule = type === "pair" ? ruleById(id) : type === "poly" ? ruleById(id.split("|")[0]) : null;
      if (rule) setRuleOpacity(rule, opacity);
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
  function updateAsymmetricNote() {
    const note = $("asym-note");
    note.textContent = asymmetric
      ? `${independentSites().length} independent sites, each once, before symmetry expansion. Pairs are paused; switch off to return to the full structure.`
      : Array.isArray(structure?.independentSites) || !structure
        ? ""
        : "This engine build does not report independent sites; the asymmetric unit uses the first copy of each label.";
    note.hidden = !note.textContent;
  }
  $("asym-toggle").onchange = () => {
    if (!structure) return;
    asymmetric = $("asym-toggle").checked;
    cancelScheduledBuild();
    selection = [];
    build(false);
    updateAsymmetricNote();
  };
  $("labels-toggle").onchange = () => {
    labelsOn = $("labels-toggle").checked;
    invalidate();
  };
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
  const updateStructureInfo = createStructureInfo();
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
    linkDetectorView(null);
    structureGeneration++;
    cancelScheduledBuild();
    clearAppearance(appearance);
    targetMeta.clear();
    openCutoffRule = null;
    // Per-structure tool state: asymmetric view, site highlight, planes,
    // arrows and symmetry elements start fresh.
    asymmetric = false;
    $("asym-toggle").checked = false;
    highlightedSite = null;
    $("shell-cutoff").value = "";
    $("shell-outline").checked = true;
    structure = data;
    radiusControls.setSites(independentSites(), data);
    showSphereSize();
    pairEstimates.clear();
    clearDistanceHighlight();
    latticeTools.reset();
    hiddenElements.clear();
    $("show-atoms").checked = true;
    $("show-polyhedra").checked = true;
    const reference = entryForFilename(currentFilename);
    $("source").replaceChildren();
    if (reference) {
      const link = document.createElement("a");
      link.href = reference.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(formulaLabel(reference.formula), ` · ${reference.source.label} ↗`);
      link.title = reference.source.citation;
      $("source").append(link);
    } else $("source").textContent = currentFilename || "Example structure · built in";
    updateStructureInfo(data, reference?.name || data.name || data.block || "Crystal structure", currentFilename, reference);
    $("stats").replaceChildren(
      textStat("V", `${Number(data.volume).toFixed(2)} Å³`),
      textStat("Atoms", data.atoms.length.toLocaleString()),
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
    updateElementOverflow();
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
    const listedSetting = warning => warning.startsWith("space-group definitions disagree:") && warning.includes("explicit_operations");
    $("warnings").dataset.full = warnings.join(" ");
    $("warnings").dataset.summary = warnings.map(warning => listedSetting(warning)
      ? "Symmetry uses the operations listed in this CIF; its other space-group definitions differ."
      : warning.startsWith("invalid space-group definition")
        ? "One space-group description in this CIF could not be recognized. Check the original CIF messages and the reported symmetry before interpreting the structure."
        : warning).join(" ");
    $("warnings").dataset.informational = String(warnings.length > 0 && warnings.every(listedSetting));
    $("warnings").textContent = $("warnings").dataset.summary;
    $("warnings").title = warnings.join(" ");
    $("warnings").setAttribute("aria-expanded", "false");
    const headerWarn = $("header-warnings");
    if (headerWarn) {
      headerWarn.hidden = !warnings.length;
      const countEl = $("header-warnings-count");
      if (countEl) countEl.textContent = String(warnings.length);
      headerWarn.title = warnings.join(" ");
    }
    plotRanges = defaultRanges();
    if (currentFilename === "Wollastonite example") plotRanges[1] = [0, 3];
    writeRanges();
    resetRules();
    build(false);
    reset();
    if (currentFilename === "Wollastonite example") orient([0, 0, 1], "c");
    styleEditor.clear();
    renderSiteTable();
    updateAsymmetricNote();
    xrdWorkspace.setActive(null);
    structureAnalysis.setStructure();
    powderPanel.setStructure();
    reflectionExplorer.setStructure();
    diffractionDetector.setStructure();
  }
  const worker = new Worker(new URL("./import-worker.js", import.meta.url), {
    type: "module",
  });
  // Match responses to requests by ID so a failed or reordered reply can
  // never be applied to a different file.
  const pending = new Map();
  let userIntent = 0;
  worker.onmessage = ({ data: message }) => {
    if (message?.diffractionModule) { setDiffractionModule(message.diffractionModule); return; }
    const { id: responseId, ...data } = message ?? {};
    const task = pending.get(responseId);
    pending.delete(responseId);
    if (!task || task.id !== request || task.intent !== userIntent) return;
    $("loading").hidden = true;
    $("open").disabled = false;
    $("block").disabled = false;
    updateProjectButtons();
    if (data.error) {
      if (task.project) {
        projectStatus(`Could not open ${task.project.name}: ${data.error}`, true);
        setError(`Could not open this project: ${data.error}`);
        updateHistoryButtons();
        if (structure) $("block").value = structure.block;
        return;
      }
      if (task.restore) {
        // A saved block that no longer opens: retry the saved file without
        // it; if the file itself fails, start this page's structure.
        if (task.block !== undefined) load(task.text, task.filename, undefined, task.restore);
        else {
          sessionStatus("The saved structure could not be opened, so this page's structure was loaded instead.", true);
          loadExample();
        }
        return;
      }
      updateHistoryButtons();
      if (structure) $("block").value = structure.block;
      setError(`Could not open this CIF: ${data.error}`);
      if (!structure) $("name").textContent = "Open a crystal structure";
      return;
    }
    historyReady = false;
    clearHistoryGesture();
    currentText = task.text;
    currentFilename = task.filename;
    display(data);
    if (task.restore) {
      try {
        // Local browser autosaves are trusted; externally imported .psv files
        // remain bounded by hard resource ceilings (see restoreViewerState).
        restoreViewerState(task.restore, { trusted: Boolean(task.project), external: Boolean(task.project) });
        if (task.project) {
          themeSwitch.setTheme(task.project.theme);
          currentProjectFilename = task.project.name;
          projectStatus(`Opened ${task.project.name}.`);
        } else {
          sessionStatus(`Restored the session saved on this device${restoredAt ? ` at ${timeText(restoredAt)}` : ""}.`);
        }
      } catch (error) {
        console.error(error);
        if (task.project) projectStatus("Part of the project could not be restored; the rest is shown.", true);
        else sessionStatus("Part of the saved session could not be restored; the rest is shown.", true);
      }
    }
    if (!task.project) currentProjectFilename = desktop && typeof task.restore?.projectFilename === "string" ? task.restore.projectFilename : "";
    const displayedGeneration = structureGeneration;
    // Save only after the final layout/resize has settled (two frames),
    // so the restored camera is captured as restored, not refitted.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (startupHold) {
          startupHold = false;
          saveSuspended--;
        }
        if (displayedGeneration !== structureGeneration) return;
        history.reset(exportHistoryState());
        if (desktop && task.restore && !task.project) history.resume(task.restore.undoHistory);
        historyReady = true;
        updateHistoryButtons();
        updateProjectButtons();
        scheduleSave(task.restore ? 300 : 0);
      }),
    );
  };
  worker.onerror = (e) => {
    pending.clear();
    $("loading").hidden = true;
    $("open").disabled = false;
    $("block").disabled = false;
    updateHistoryButtons();
    updateProjectButtons();
    setError("The crystal reader could not start. Reload the viewer and try again.");
    console.error(e);
  };
  function load(text, filename, block, restore = null, project = null) {
    if (saveTimer) saveNow();
    flushHistory();
    setError("");
    $("loading").hidden = false;
    $("open").disabled = true;
    $("block").disabled = true;
    updateHistoryButtons();
    updateProjectButtons();
    const id = ++request;
    pending.set(id, { id, text, filename, block, restore, project, intent: userIntent });
    worker.postMessage({ id, text, block });
  }
  async function openLibraryEntry(entry, startup = false) {
    if (exporter.busy) return;
    const intent = startup ? userIntent : ++userIntent;
    flushHistory();
    setError("");
    $("loading").hidden = false;
    updateHistoryButtons();
    updateProjectButtons();
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${entry.file}`);
      if (!response.ok) throw new Error(`Structure unavailable (${response.status})`);
      const text = await response.text();
      if (intent !== userIntent) return;
      load(text, libraryFilename(entry));
    } catch (error) {
      if (intent !== userIntent) return;
      $("loading").hidden = true;
      $("open").disabled = false;
      $("block").disabled = false;
      updateHistoryButtons();
      updateProjectButtons();
      setError(`Could not open ${entry.name}: ${error.message}`);
    }
  }
  createStructureLibrary({ onSelect: openLibraryEntry, isBusy: () => exporter.busy });
  $("open").onclick = () => $("file").click();
  async function openDocument(file, projectOnly = false) {
    const intent = ++userIntent;
    try {
      const isProject = projectOnly || /\.psv$/i.test(file.name);
      if (isProject && file.size > MAX_PROJECT_BYTES)
        throw Error("This project file exceeds the 24 MiB import limit.");
      const text = await file.text();
      if (intent !== userIntent) return;
      if (isProject) {
        const project = parseProject(text);
        projectStatus(`Opening ${file.name}…`);
        load(project.document.text, project.document.filename, project.state.block, project.state,
          { name: file.name, theme: project.theme });
      } else load(text, file.name);
    } catch (err) {
      if (intent !== userIntent) return;
      $("loading").hidden = true;
      $("open").disabled = false;
      $("block").disabled = false;
      updateProjectButtons();
      updateHistoryButtons();
      if (projectOnly || /\.psv$/i.test(file.name)) projectStatus(`Could not open ${file.name}: ${err.message}`, true);
      setError(err.message);
    }
  }
  async function openFile(e, projectOnly = false) {
    const file = e.target.files[0];
    e.target.value = "";
    if (file && !exporter.busy) await openDocument(file, projectOnly);
  }
  $("file").onchange = openFile;
  $("project-file").onchange = (e) => openFile(e, true);
  $("project-open").onclick = () => { if (!exporter.busy) $("project-file").click(); };
  $("block").onchange = (e) => {
    userIntent++;
    load(currentText, currentFilename, e.target.value);
  };
  $("clear").onclick = () => {
    selection = [];
    updateSelection();
  };
  $("reset").onclick = () => reset();
  // Discrete step turns (Turn panel). Inertia is cancelled FIRST
  // (stopMotion replaces the controls, so the current `controls` is read
  // afterwards); then camera position/up come from the tested helper.
  // Rotate the whole camera pose about the crystal center (scene origin).
  function turnView(action, degrees) {
    if (exporter.busy) return; // never touch camera/controls while exporting
    stopMotion();
    const next = rotatedView(
      camera.position.toArray(),
      camera.up.toArray(),
      controls.target.toArray(),
      action,
      degrees,
    );
    controls.target.fromArray(next.target);
    camera.position.fromArray(next.position);
    camera.up.fromArray(next.up);
    controls.update();
    setActiveView(null);
    invalidate();
    scheduleSave();
  }
  const turnControls = createTurnControls({
    onTurn: turnView,
    isBusy: () => exporter.busy,
    phoneLayout,
    paneAnchor: $("phone-turn-dock"),
    onOpenChange: invalidate, // plane labels re-place around the popover
  });
  // The [uvw] form is a label obstacle too while open.
  document.querySelector(".view-directions details")?.addEventListener("toggle", invalidate);
  // Group supporting radius conventions after the direct target controls.
  const radiusOptions = document.createElement("details");
  radiusOptions.className = "tool-options";
  radiusOptions.id = "radius-model-options";
  radiusOptions.innerHTML = "<summary>Radius model &amp; displacement</summary>";
  const radiusStart = $("radius-model").closest("label");
  const radiusNodes = [];
  for (let node = radiusStart; node && node !== $("style-target").closest("label"); node = node.nextElementSibling) radiusNodes.push(node);
  radiusOptions.append(...radiusNodes);
  $("style-editor").append(radiusOptions);
  $("warnings").setAttribute("aria-label", "CIF import notes. Activate to expand or collapse the full explanation.");

  // CIF warnings stay to two lines until opened, keeping controls in reach.
  const toggleWarnings = () => {
    const open = $("warnings").getAttribute("aria-expanded") !== "true";
    $("warnings").setAttribute("aria-expanded", String(open));
    $("warnings").textContent = open ? $("warnings").dataset.full : $("warnings").dataset.summary;
  };
  $("warnings").onclick = toggleWarnings;
  $("warnings").onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleWarnings();
    }
  };
  $("header-warnings")?.addEventListener("click", () => {
    toolWindows.choose("sites", { focus: true });
    if ($("warnings").getAttribute("aria-expanded") !== "true") toggleWarnings();
    $("warnings").scrollIntoView?.({ block: "nearest" });
  });
  function updateRangeSteps() {
    for (const axis of ["a", "b", "c"]) {
      const lower = $(`range-${axis}-min`);
      const upper = $(`range-${axis}-max`);
      for (const field of [lower, upper]) {
        for (const button of field.parentElement.querySelectorAll("[data-range-step]")) {
          const next = field.valueAsNumber + Number(button.dataset.rangeStep);
          button.disabled = !Number.isFinite(next)
            || (field === lower ? next >= upper.valueAsNumber : next <= lower.valueAsNumber);
        }
      }
    }
  }
  function writeRanges() {
    for (const [i, axis] of ["a", "b", "c"].entries())
      for (const [j, end] of ["min", "max"].entries())
        $(`range-${axis}-${end}`).value = plotRanges[i][j];
    updateRangeSteps();
    $("range-error").textContent = "";
  }
  function applyRanges(next) {
    try {
      next = validateRanges(next);
      // Enter, change and blur may commit the same bounds more than once; an
      // unchanged extent needs no rebuild or refit.
      if (next.every((r, i) => r[0] === plotRanges[i][0] && r[1] === plotRanges[i][1])) {
        writeRanges();
        return;
      }
      const sites = plotSites(next);
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
  $("range-form").addEventListener("input", updateRangeSteps);
  $("range-form").addEventListener("click", event => {
    const step = event.target.closest("[data-range-step]");
    if (!step || !structure) return;
    const field = step.parentElement.querySelector("input");
    const next = field.valueAsNumber + Number(step.dataset.rangeStep);
    field.value = Number(next.toPrecision(15));
    updateRangeSteps();
    $("range-form").requestSubmit();
  });
  // Committing a bound (Enter, blur or stepper) applies the extent directly.
  for (const input of document.querySelectorAll("#range-form input")) {
    const commit = () => { if (structure) $("range-form").requestSubmit(); };
    input.addEventListener("change", commit);
    // Native change compares against the value when focus began. Enter can
    // commit an intermediate value, so returning to that original value still
    // needs an explicit blur commit to keep the scene in sync.
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (structure) $("range-form").requestSubmit();
      }
    });
  }
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
  function showSphereSize() {
    $("size-percent").textContent = Math.round(Number($("size").value) * 100) + "%";
    $("size").setAttribute(
      "aria-valuetext",
      `${Math.round(Number($("size").value) * 100)}%`,
    );
  }
  function updateSphereSizes() {
    showSphereSize();
    if (!structure) return;
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    for (const m of meshes) {
      m.userData.atoms.forEach((a, i) => {
        atomTransform(a, matrix, rotation, scale);
        m.setMatrixAt(i, matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      // Instance bounds depend on radius; raycasting recomputes them lazily.
      m.boundingSphere = null;
    }
    updateSphereBounds();
    refreshAtomAo();
    updateSelection();
    updatePickMarker();
    highlightSite(highlightedSite);
    buildOrtepRings();
  }
  $("adp-ellipsoids").onchange = () => {
    $("adp-note").hidden = !$("adp-ellipsoids").checked;
    updateSphereSizes();
    scheduleSave();
  };
  $("size").oninput = updateSphereSizes;
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
      polyhedraVisible: $("show-polyhedra").checked,
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
        // Translucent pairs render from the shared sorted batch instead.
        drawnBy: mesh.visible ? (mesh.material.opacity < 1 ? "sorted-batch" : "own-mesh") : mesh.userData.outline?.visible ? "outline-only" : "hidden",
      })),
      translucentFaces: faceSorter.diagnostics(),
      transparency: peeler.diagnostics(),
      rendering: { width: renderer.domElement.width, height: renderer.domElement.height, pixelRatio: renderer.getPixelRatio(), antialias: "FXAA" },
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
      measureMode,
      angle,
      atomInfo: measureMode === "info" && selection[0] ? { label: selection[0].label, lines: atomInfoLines(selection[0]) } : null,
      selectedSites: selection.map((a) => ({
        label: a.label,
        siteIndex: a.siteIndex ?? null,
        frac: [...a.frac],
        key: atomKey(a),
      })),
      asymmetric,
      independentSiteCount: structure ? independentSites().length : 0,
      labels: { enabled: labelsOn, shown: shownLabels, limit: LABEL_LIMIT },
      // Open tool windows back to front (front-most last), their layout and
      // the stage (projection offset into the clear area).
      sidebarMode: toolWindows.openTools().at(-1) ?? null,
      openPanels: toolWindows.openTools(),
      windows: toolWindows.diagnostics(),
      stage: { x: stage.x, y: stage.y, clear: stage.clear && { ...stage.clear }, atFit: isAtFit() },
      highlightedSite,
      shellCenterId: inspectedShellCenter?.id ?? null,
      polyhedra: coordinationStats.flatMap((s) =>
        s.environments.map((e) => ({
          pair: pairName(s),
          center: e.center,
          centerLabel: e.centerLabel,
          coordination: e.coordination,
          volume: e.volume,
        })),
      ),
      lattice: latticeTools.diagnostics(),
      xrd: xrdWorkspace.diagnostics(),
      // View-space unit directions of a, b, c as drawn by the compass
      // (x right, y up, z toward the viewer).
      axisCompass: compassState,
      turn: turnControls.diagnostics(),
      viewReadout: { text: readoutText, visible: !$("view-readout").hidden },
      history: { ...history.state, pending: Boolean(historyTimer || historyPointers.size || historyKeyHeld), ready: historyReady, snapshot: exportHistoryState() },
      session: {
        entrypoint: ENTRYPOINT,
        suspended: saveSuspended > 0,
        pending: Boolean(saveTimer),
        restoredAt,
        status: $("session-status").textContent.trim(),
        error: $("session-status").classList.contains("error"),
      },
      theme: { current: themeSwitch.theme, explicit: themeSwitch.explicit },
      export: {
        busy: exporter.busy,
        dpi: exportDpi(),
        video: videoFormat.mime ? { mime: videoFormat.mime, extension: videoFormat.extension } : { reason: videoFormat.reason },
        last: lastExport,
      },
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
      cellSegmentCount: cellLines?.userData.segmentCount,
      block: structure?.block,
      basis: structure?.basis,
    };
  };
  // ---- Export: PNG and turntable movie ------------------------------------
  const exporter = createExporter({
    renderer,
    camera,
    controls: () => controls,
    render,
    stopMotion,
    invalidate,
    cssSize: () => {
      const { width, height } = renderer.domElement.getBoundingClientRect();
      return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
    },
    contentBounds: (turntable) => {
      syncViewCamera();
      const { width, height } = renderer.domElement.getBoundingClientRect();
      return sceneExportBounds(scene, viewCamera, {
        width, height,
        ...(turntable ? { target: controls.target, axis: camera.up } : {}),
      });
    },
    atomLabels: () => (labelsOn ? lastAtomLabels : []),
    latticeLabels: () => latticeTools.placedLabels(),
    exportObstacles: (rects) => latticeTools.setExportObstacles(rects),
    // Visible elements and their current colors, for the figure legend.
    activeElements: () => {
      if (!structure || !$("show-atoms").checked) return [];
      return [...new Set(structure.atoms.map((a) => a.element))]
        .filter((e) => !hiddenElements.has(e))
        .map((symbol) => ({ symbol, color: colorFor(symbol) }));
    },
    // CSS pixels per ångström of the orthographic view (scale bar).
    pixelsPerUnit: () => {
      syncViewCamera();
      const height = renderer.domElement.getBoundingClientRect().height || 1;
      const world = viewCamera.top - viewCamera.bottom;
      return world > 0 ? height / world : 0;
    },
    compass: () => compassState,
    // The measurement card, only while atoms are picked for it.
    measurement: () => {
      if (!selection.length || styleEditor?.picking) return null;
      return {
        value: $("distance").textContent.replace(/\s+/g, " ").trim(),
        lines: $("selection")
          .textContent.split("\n")
          .filter((line) => line && !/^Tap /.test(line)),
      };
    },
    name: () => structure?.name || structure?.block || currentFilename || "structure",
    setBusy: (busy) => {
      // Freeze the last real pose before the exporter starts moving it.
      if (busy) flushHistory();
      // Exports peel the full layer budget in every frame.
      peeler.setExportMode(busy);
      latticeTools.setExportMode(busy);
      viewport.classList.toggle("exporting", busy);
      controls.enabled = !busy;
      // Step turns are blocked while exporting (buttons and handler).
      turnControls.setDisabled(busy);
      $("library-open").disabled = busy;
      // No autosave of turntable frames; save the real view afterwards.
      if (busy) {
        saveSuspended++;
        clearTimeout(saveTimer);
      } else {
        saveSuspended = Math.max(0, saveSuspended - 1);
        scheduleSave();
      }
      updateHistoryButtons(busy);
      updateProjectButtons(busy);
      for (const id of ["export-png", "export-video"]) $(id).disabled = busy || (id === "export-video" && !videoFormat.mime);
    },
  });
  const videoFormat = exporter.videoSupport();
  const exportScale = () => Number(document.querySelector('input[name="export-scale"]:checked')?.value || 2);
  // DPI is stored in the PNG (pHYs); it does not change the pixel size.
  const exportDpi = () => validDpi($("export-dpi").value);
  function updateExportInfo() {
    const { width, height } = exporter.imageSize(exportScale());
    const dpi = exportDpi();
    const cm = (pixels) => ((pixels / dpi) * 2.54).toFixed(1);
    $("export-dims").textContent =
      `PNG ≈ ${width} × ${height} px` +
      (dpi ? ` = ${cm(width)} × ${cm(height)} cm at ${dpi} dpi` : " · DPI must be 30–2400") +
      " · cropped to the structure; movie frame fits the full turn (up to 1920 px).";
    for (const preset of document.querySelectorAll(".dpi-preset"))
      preset.setAttribute("aria-pressed", String(Number(preset.dataset.dpi) === dpi));
    $("export-dpi").setCustomValidity(dpi ? "" : "Enter a DPI between 30 and 2400.");
  }
  for (const input of document.querySelectorAll('input[name="export-scale"]')) input.onchange = updateExportInfo;
  $("export-dpi").oninput = updateExportInfo;
  for (const preset of document.querySelectorAll(".dpi-preset"))
    preset.onclick = () => {
      $("export-dpi").value = preset.dataset.dpi;
      updateExportInfo();
    };
  $("style-depth-cue").addEventListener("change", () => {
    depthCue = $("style-depth-cue").checked;
    invalidate();
    scheduleSave();
  });
  $("style-two-tone-bonds").addEventListener("change", () => {
    restyle(true);
    scheduleSave();
  });
  $("style-contact-ao")?.addEventListener("change", () => {
    atomContactAoUniform.value = $("style-contact-ao").checked ? 1 : 0;
    invalidate();
    scheduleSave();
  });
  $("style-ortep-rings")?.addEventListener("change", () => {
    buildOrtepRings();
    invalidate();
    scheduleSave();
  });
  // The Background menu and the Transparent chip are two views of one choice.
  $("export-background").addEventListener("change", () => {
    $("export-transparent").checked = $("export-background").value === "transparent";
    scheduleSave();
  });
  $("export-transparent").addEventListener("change", () => {
    $("export-background").value = $("export-transparent").checked ? "transparent" : "theme";
    scheduleSave();
  });
  for (const id of ["export-scale-bar", "export-legend", "export-compass", "export-measure"])
    $(id).addEventListener("change", () => scheduleSave());
  $("export-video").disabled = !videoFormat.mime;
  $("export-video-note").textContent = videoFormat.mime
    ? `Turntable: one full turn, ${videoFormat.extension.toUpperCase()} video.`
    : videoFormat.reason;
  $("export-png").onclick = async () => {
    $("export-status").textContent = "Rendering PNG…";
    try {
      const dpi = exportDpi();
      if (!dpi) {
        $("export-dpi").reportValidity();
        $("export-status").textContent = "Enter a DPI between 30 and 2400.";
        return;
      }
      const result = await exporter.exportPNG({ scale: exportScale(), background: $("export-background").value, dpi });
      if (!result) { $("export-status").textContent = "Save canceled."; return; }
      $("export-status").textContent = `Saved ${result.filename} (${result.width} × ${result.height} px, ${result.dpi} dpi).`;
      lastExport = result;
    } catch (error) {
      $("export-status").textContent = `PNG export failed: ${error.message}`;
    }
  };
  let recording = null,
    lastExport = null;
  $("export-video").onclick = async () => {
    const progress = $("export-progress");
    try {
      recording = exporter.recordTurntable({
        seconds: Number($("export-seconds").value),
        fps: Number($("export-fps").value),
        scale: exportScale(),
        onProgress: (p, { slow }) => {
          progress.value = p;
          $("export-status").textContent = `Recording turntable… ${Math.round(p * 100)}%${slow ? " · Rendering is slow; the movie may last longer than requested." : ""}`;
        },
      });
      progress.hidden = false;
      progress.value = 0;
      $("export-cancel").hidden = false;
      const result = await recording.done;
      $("export-status").textContent = result.canceled
        ? result.reason === "resized"
          ? "Recording stopped because the view was resized; nothing was saved. Record again at the new size."
          : "Recording canceled; nothing was saved."
        : `Saved ${result.filename} (${result.width} × ${result.height} px${result.duration === null ? "" : `, ${result.duration.toFixed(1)} s`}).${result.slow ? ` Requested ${result.requestedSeconds} s; rendering ran slowly. Lower the export size or frame rate to improve timing.` : ""}`;
      lastExport = result;
    } catch (error) {
      $("export-status").textContent = `Recording failed: ${error.message}`;
    } finally {
      recording = null;
      progress.hidden = true;
      $("export-cancel").hidden = true;
    }
  };
  $("export-cancel").onclick = () => recording?.cancel();
  // ---- Tool windows: overlays never reposition or refit the structure. ----
  function applyStageLayout(info) {
    stage.clear = { ...info.clear };
    invalidate();
    boundDetails();
  }
  const toolWindows = createToolWindows({
    viewport,
    app: $("app"),
    rail: $("tool-rail"),
    menuButton: $("tools-menu"),
    metrics() {
      // Palette below the measurement card's reserved height; the rail and
      // compass keep the right edge; sheets stay below the rail.
      const view = viewport.getBoundingClientRect();
      const row = document.querySelector(".measure-row").getBoundingClientRect();
      const details = document.querySelector(".measure-details").getBoundingClientRect();
      const rail = $("tool-rail").getBoundingClientRect();
      const bottomControls = [".view-bottom", "#view-readout", ".axis-compass", "#tools-menu"]
        .map(selector => document.querySelector(selector)).filter(element => !element.classList.contains("in-science"))
        .map(element => element.getBoundingClientRect()).filter(rect => rect.width && rect.height);
      const bottomGap = Math.ceil(Math.max(0, ...bottomControls.map(rect => view.bottom - rect.top)) + 8);
      viewport.style.setProperty("--bottom-controls-gap", `${bottomGap}px`);
      const cardMax = parseFloat(getComputedStyle(viewport).getPropertyValue("--card-max")) || 168;
      return {
        paletteTop: row.bottom - view.top + 6 + cardMax + 10,
        railColumn: 92,
        railBottom: $("app").dataset.launcher === "rail" && rail.height ? rail.bottom - view.top : 0,
        sheetTop: Math.max(row.bottom + 6 + 88, details.bottom) - view.top + 8,
        sideTop: row.bottom - view.top + 6,
        bottomGap: 40,
        sheetBottomGap: bottomGap,
        sideBottomGap: bottomGap,
      };
    },
    onLayout: applyStageLayout,
    onVisibility(tool, visible) {
      if (tool === "style") styleEditor.setOpen(visible);
      if (tool === "export" && visible) updateExportInfo();
    },
    onChange: () => scheduleSave(),
  });
  installPanelScrollbars();

  // Light/dark theme: CSS follows data-theme; scene overlays that carry
  // their own colors are rebuilt with the new palette.
  const themeSwitch = createThemeSwitch({
    button: $("theme-toggle"),
    onChange: () => {
      if (cellLines) cellLines.material.color.set(scenePalette().cell);
      canvasFogColor = readCanvasFog();
      atomThemeUniform.value = document.documentElement.dataset.theme === "light" ? 1 : 0;
      updateSelection();
      updatePickMarker();
      highlightSite(highlightedSite);
      buildOrtepRings();
      if (activeDistanceSpec) highlightDistance(activeDistanceSpec);
      latticeTools.rebuild();
      invalidate();
    },
  });
  // ---- Local session (this device only) ----------------------------------
  // Plain settings are saved with the loaded CIF text in IndexedDB
  // (session-store.js) and restored on the next start of the same page
  // entrypoint. Derived geometry, Three.js objects and label caches are
  // rebuilt, never stored. Transient popovers are not reopened.
  const cifUrlParam = (() => {
    const raw = new URLSearchParams(location.search).get("cif");
    if (!raw) return null;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const seg = url.pathname.split("/").filter(Boolean).pop() || "structure.cif";
      return { url: url.href, filename: decodeURIComponent(seg), entrypoint: `cif:${url.href}` };
    } catch {
      return null;
    }
  })();
  const examples = {
    forsterite: { file: "examples/forsterite.cif", name: "Forsterite example" },
    wollastonite: { file: "examples/wollastonite.cif", name: "Wollastonite example" },
    "halite-222": { file: "examples/halite-222.psv", name: "Halite (222).psv" },
  };
  const ENTRYPOINT = (() => {
    if (cifUrlParam) return cifUrlParam.entrypoint;
    const params = new URLSearchParams(location.search);
    const entry = libraryEntry(params.get("structure"));
    if (entry) return `structure:${entry.id}`;
    const v = params.get("example");
    return Object.hasOwn(examples, v) ? v : "";
  })();
  const sharedScene = ENTRYPOINT === "halite-222";
  const sessionStore = createSessionStore(sharedScene ? { dbName: "phasesmith-viewer-session-halite-222" } : {});
  let restoredAt = 0;
  let currentProjectFilename = "";
  function projectStatus(text, error = false) {
    $("project-status").textContent = text;
    $("project-status").classList.toggle("error", error);
  }
  function updateProjectButtons(busy = exporter.busy) {
    $("project-save").disabled = busy || !historyReady || !structure || !$("loading").hidden;
    $("project-open").disabled = busy;
  }
  $("project-save").onclick = async () => {
    if (exporter.busy || !structure || !$("loading").hidden || saveSuspended > 0) return;
    try {
      flushHistory();
      stopMotion();
      const text = serializeProject({
        document: { text: currentText, filename: currentFilename },
        state: exportViewerState(),
        theme: themeSwitch.theme,
      });
      const filename = projectFilename(currentProjectFilename || currentFilename || structure.name);
      const saved = await saveBlob(new Blob([text], { type: "application/json" }), filename);
      if (!saved) return;
      currentProjectFilename = saved;
      projectStatus(`${desktop ? "Saved" : "Downloaded"} ${saved}. Open it to restore this project.`);
    } catch (error) {
      projectStatus(`Could not save the project: ${error.message}`, true);
    }
  };
  const timeText = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  function sessionStatus(text, error = false) {
    const el = $("session-status");
    el.textContent = text;
    el.classList.toggle("error", error);
  }
  function exportViewerState() {
    return {
      block: structure?.block ?? null,
      ranges: plotRanges.map((r) => [...r]),
      boundary: $("boundary").checked,
      cell: $("cell").checked,
      polyhedraOnly: $("polyhedra-only").checked,
      polyhedraVisible: $("show-polyhedra").checked,
      rules: rules.map((r) => ({
        id: r.id,
        center: r.center,
        neighbor: r.neighbor,
        cutoff: r.cutoff,
        bonds: Boolean(r.bonds),
        polyhedra: Boolean(r.polyhedra),
        opacity: r.opacity ?? DEFAULT_FACE_OPACITY,
        ...(r.color != null ? { color: r.color } : {}),
      })),
      appearance: {
        elements: [...appearance.elements].map(([k, v]) => [k, { ...v }]),
        atoms: [...appearance.atoms].map(([k, v]) => [k, { ...v }]),
        polyhedra: [...appearance.polyhedra].map(([k, v]) => [k, { ...v }]),
      },
      atoms: {
        ellipsoids: $("adp-ellipsoids").checked,
        show: $("show-atoms").checked,
        hidden: [...hiddenElements],
        size: Number($("size").value),
        ...radiusControls.snapshot(),
        labels: labelsOn,
      },
      asymmetric,
      highlightedSite,
      shellCutoff: $("shell-cutoff").value, shellOutline: $("shell-outline").checked,
      lattice: latticeTools.exportState(),
      xrd: xrdWorkspace.exportState(),
      powder: powderPanel.exportState(),
      analysis: structureAnalysis.exportState(),
      reflection: reflectionExplorer.exportState(),
      detector: diffractionDetector.exportState(),
      camera: {
        position: detectorLink ? detectorLink.eye.clone().multiplyScalar(camera.position.distanceTo(controls.target)).add(controls.target).toArray() : camera.position.toArray(),
        up: (detectorLink?.up ?? camera.up).toArray(),
        target: controls.target.toArray(),
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      },
      turnAngle: turnControls.angle,
      measure: { mode: measureMode, keys: selection.map(atomKey) },
      // Open tools back to front (front-most last) and the window layout.
      panels: toolWindows.openTools(),
      windows: toolWindows.exportState(),
      // Added later in version 1 (optional on restore).
      uvwText: $("view-direction").value,
      palette: styleEditor.palette,
      depthCue,
      twoToneBonds: $("style-two-tone-bonds").checked,
      contactAo: $("style-contact-ao") ? $("style-contact-ao").checked : true,
      ortepRings: $("style-ortep-rings") ? $("style-ortep-rings").checked : true,
      activeView: activeView && lastOrientIndices ? { id: activeView.id, indices: [...lastOrientIndices] } : null,
      styleTarget: styleEditor.target || null,
      export: {
        scale: exportScale(),
        dpi: $("export-dpi").value,
        transparent: $("export-background").value === "transparent",
        background: $("export-background").value,
        scaleBar: $("export-scale-bar").checked,
        legend: $("export-legend").checked,
        compass: $("export-compass").checked,
        measurement: $("export-measure").checked,
        seconds: $("export-seconds").value,
        fps: $("export-fps").value,
      },
    };
  }
  // Apply a saved state to the freshly displayed document. Every value is
  // validated; unknown fields are ignored and references that do not
  // exist in this structure (elements, rules, atoms, sites) are dropped.
  function restoreViewerState(s, { trusted = false, external = false } = {}) {
    if (!s || typeof s !== "object") return;
    // Autosaves are capped tightly; trusted project files keep every user
    // object, but an external file still gets hard ceilings so a crafted
    // .psv cannot request unbounded bond searches.
    const ruleLimit = trusted ? (external ? 512 : undefined) : 24;
    const cutoffLimit = trusted ? (external ? 100 : Infinity) : 50;
    const finite = (v) => typeof v === "number" && Number.isFinite(v);
    const triple = (v) => Array.isArray(v) && v.length === 3 && v.every(finite);
    const hex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
    const pairs = (v) => (Array.isArray(v) ? v.filter((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && e[1] && typeof e[1] === "object") : []);
    const elements = new Set(structure.atoms.map((a) => a.element));
    // Extent and display toggles.
    if (Array.isArray(s.ranges))
      try {
        plotRanges = validateRanges(s.ranges);
      } catch {
        /* keep the default extent */
      }
    writeRanges();
    for (const [id, key] of [
      ["boundary", "boundary"],
      ["cell", "cell"],
      ["polyhedra-only", "polyhedraOnly"],
      ["show-polyhedra", "polyhedraVisible"],
    ])
      if (typeof s[key] === "boolean") $(id).checked = s[key];
    // Pair rules.
    if (Array.isArray(s.rules)) {
      const seen = new Set();
      rules = [];
      for (const r of s.rules.slice(0, ruleLimit)) {
        if (!r || !elements.has(r.center) || !elements.has(r.neighbor)) continue;
        if (!finite(r.cutoff) || r.cutoff < CUTOFF_MIN || r.cutoff > cutoffLimit) continue;
        if (!Number.isInteger(r.id) || r.id <= 0 || seen.has(r.id)) continue;
        seen.add(r.id);
        rules.push({
          id: r.id,
          center: r.center,
          neighbor: r.neighbor,
          cutoff: r.cutoff,
          bonds: r.bonds === true,
          polyhedra: r.polyhedra === true,
          opacity: finite(r.opacity) && r.opacity >= 0 && r.opacity <= 1 ? r.opacity : DEFAULT_FACE_OPACITY,
          ...(hex(r.color) ? { color: r.color } : {}),
        });
      }
      nextRule = Math.max(0, ...rules.map((r) => r.id));
      renderRules();
    }
    // Appearance overrides.
    clearAppearance(appearance);
    // Scene clarity settings (added after 1.0.2; absent → defaults).
    styleEditor.setPalette(typeof s.palette === "string" ? s.palette : "mineral");
    depthCue = s.depthCue === true;
    $("style-depth-cue").checked = depthCue;
    $("style-two-tone-bonds").checked = s.twoToneBonds === true;
    const contactAoOn = s.contactAo !== false;
    atomContactAoUniform.value = contactAoOn ? 1 : 0;
    if ($("style-contact-ao")) $("style-contact-ao").checked = contactAoOn;
    if ($("style-ortep-rings")) $("style-ortep-rings").checked = s.ortepRings !== false;
    // Keep picked-copy metadata within this document, including an
    // unstyled target after undo or a copy temporarily outside the extent.
    const style = (v, min, max) => {
      const o = {};
      if (hex(v.color)) o.color = v.color;
      if (finite(v.scale) && v.scale >= min && v.scale <= max) o.scale = v.scale;
      return o;
    };
    for (const [e, v] of pairs(s.appearance?.elements)) {
      const o = style(v, 0.3, 2.5);
      if (elements.has(e) && Object.keys(o).length) appearance.elements.set(e, o);
    }
    for (const [k, v] of pairs(s.appearance?.atoms)) {
      const o = style(v, 0.3, 2.5);
      if (elements.has(v.element) && Object.keys(o).length) appearance.atoms.set(k, { ...o, element: v.element });
    }
    const ruleIds = new Set(rules.map((r) => r.id));
    for (const [k, v] of pairs(s.appearance?.polyhedra)) {
      const o = hex(v.color) ? { color: v.color } : {};
      if (ruleIds.has(Number(k.split("|")[0])) && Object.keys(o).length) appearance.polyhedra.set(k, o);
    }
    // Atom display.
    const a = s.atoms && typeof s.atoms === "object" ? s.atoms : {};
    radiusControls.restore(a);
    $("adp-ellipsoids").checked = a.ellipsoids === true;
    $("adp-note").hidden = !a.ellipsoids;
    if (typeof a.show === "boolean") $("show-atoms").checked = a.show;
    hiddenElements.clear();
    for (const e of Array.isArray(a.hidden) ? a.hidden : []) if (elements.has(e)) hiddenElements.add(e);
    for (const button of document.querySelectorAll("#elements .element"))
      button.setAttribute("aria-pressed", String(!hiddenElements.has(button.dataset.element)));
    const size = $("size");
    if (finite(a.size) && a.size >= Number(size.min) && a.size <= Number(size.max)) {
      size.value = String(a.size);
      showSphereSize();
    }
    if (typeof a.labels === "boolean") {
      labelsOn = a.labels;
      $("labels-toggle").checked = a.labels;
    }
    if (typeof s.asymmetric === "boolean") {
      asymmetric = s.asymmetric;
      $("asym-toggle").checked = asymmetric;
    }
    // Rebuild everything derived from these settings.
    build(false);
    updateAsymmetricNote();
    for (const e of elements) refreshElementDot(e);
    // Labels for individually styled copies in the Style target list.
    for (const key of appearance.atoms.keys()) {
      const atom = atoms.find((x) => atomKey(x) === key);
      if (atom) targetMeta.set(`atom:${key}`, { element: atom.element, label: atom.label, frac: fracText(atom) });
    }
    for (const key of appearance.polyhedra.keys()) {
      const centerKey = key.slice(key.indexOf("|") + 1);
      const atom = atoms.find((x) => atomKey(x) === centerKey);
      if (atom) targetMeta.set(`poly:${key}`, { label: atom.label, frac: fracText(atom) });
    }
    latticeTools.restoreState(s.lattice, { trusted, external });
    structureAnalysis.restoreState(s.analysis);
    $("shell-cutoff").value = Number(s.shellCutoff) > 0 && Number(s.shellCutoff) <= 30 ? s.shellCutoff : "";
    $("shell-outline").checked = s.shellOutline !== false;
    highlightSite(null);
    if (typeof s.highlightedSite === "string" && independentSites().some((x) => x.label === s.highlightedSite))
      highlightSite(s.highlightedSite);
    if (s.turnAngle != null) turnControls.setAngle(s.turnAngle);
    // Measurement: the mode, then the picked copies IN ORDER (the angle
    // vertex stays second). Restored only if every saved copy still exists.
    const m = s.measure && typeof s.measure === "object" ? s.measure : {};
    selection = [];
    if (["distance", "angle", "info"].includes(m.mode)) setMeasureMode(m.mode);
    if (Array.isArray(m.keys) && m.keys.length && m.keys.every((k) => typeof k === "string")) {
      const limit = { distance: 2, angle: 3, info: 1 }[measureMode];
      const found = m.keys.slice(0, limit).map((k) => atoms.find((x) => atomKey(x) === k && atomVisible(x)));
      if (found.every(Boolean)) selection = found;
    }
    updateSelection();
    // Tool windows (no transient popovers). Sessions from before the
    // windows only list panels: the last one opens as the main palette.
    if (!toolWindows.restore(s.windows) && Array.isArray(s.panels)) {
      const valid = s.panels.filter((p) => TOOL_IDS.includes(p));
      if (valid.length) toolWindows.choose(valid.at(-1));
    }
    styleEditor.refresh();
    // Typed [uvw] text (not submitted; the camera below is the real pose).
    if (typeof s.uvwText === "string" && s.uvwText.length <= 64) $("view-direction").value = s.uvwText;
    // Style target, only if it is still a valid entry (element, pair or an
    // individually styled copy; overrides and targetMeta are restored above).
    if (typeof s.styleTarget === "string") styleEditor.restoreTarget(s.styleTarget);
    // Export preferences.
    const ex = s.export && typeof s.export === "object" ? s.export : {};
    const scaleInput = document.querySelector(`input[name="export-scale"][value="${Number(ex.scale)}"]`);
    if ([1, 2, 4].includes(Number(ex.scale)) && scaleInput) scaleInput.checked = true;
    if (validDpi(ex.dpi)) $("export-dpi").value = String(validDpi(ex.dpi));
    const background = ["theme", "white", "transparent"].includes(ex.background) ? ex.background
      : typeof ex.transparent === "boolean" ? (ex.transparent ? "transparent" : "theme") : null;
    if (background) {
      $("export-background").value = background;
      $("export-transparent").checked = background === "transparent";
    }
    for (const [id, value] of [["export-scale-bar", ex.scaleBar], ["export-legend", ex.legend], ["export-compass", ex.compass], ["export-measure", ex.measurement]])
      if (typeof value === "boolean") $(id).checked = value;
    for (const [id, value] of [
      ["export-seconds", ex.seconds],
      ["export-fps", ex.fps],
    ])
      if (value != null && [...$(id).options].some((o) => o.value === String(value))) $(id).value = String(value);
    updateExportInfo();
    // Camera last: nothing after this refits the view.
    restoreCameraState(s);
    if (!historyApplying) {
      // Restore shared radiation BEFORE detector restore so a PONI calibration
      // lock set by diffractionDetector.restoreState() is preserved. Fall back
      // to legacy v1.0.2 wavelengths when s.xrd?.radiation is absent.
      const legacyWl =
        s.detector?.wavelength ??
        s.reflection?.wavelength ??
        (s.analysis?.mode === "powder" ? s.analysis.wavelength : null);
      if (s.xrd?.radiation) radiation.restoreState(s.xrd.radiation);
      else if (Number.isFinite(Number(legacyWl)) && Number(legacyWl) > 0) radiation.restoreState({ wavelength: Number(legacyWl) });
      powderPanel.restoreState(s.powder ?? (s.analysis?.mode === "powder" ? s.analysis : null));
      diffractionDetector.restoreState(s.detector);
      reflectionExplorer.restoreState(s.reflection);
      const legacyXrd = s.detector?.open
        ? { open: true, tab: "detector", radiation: null }
        : s.reflection?.open
          ? { open: true, tab: "reflection", radiation: null }
          : s.analysis?.mode === "powder" && s.analysis?.open
            ? { open: true, tab: "powder", radiation: null }
            : null;
      const xrdState = s.xrd ? { ...s.xrd, radiation: null } : legacyXrd;
      xrdWorkspace.restoreState(xrdState);
    }
    invalidate();
  }
  function restoreCameraState(s) {
    const triple = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
    setActiveView(null);
    const c = s.camera && typeof s.camera === "object" ? s.camera : null;
    if (c && triple(c.position) && triple(c.up) && triple(c.target)) {
      const eye = new THREE.Vector3().fromArray(c.position).sub(new THREE.Vector3().fromArray(c.target));
      const up = new THREE.Vector3().fromArray(c.up);
      if (eye.lengthSq() > 1e-12 && up.lengthSq() > 1e-12 && up.clone().cross(eye).lengthSq() > 1e-12 * eye.lengthSq() * up.lengthSq()) {
        stopMotion();
        controls.target.fromArray(c.target);
        camera.position.fromArray(c.position);
        camera.up.copy(up.normalize());
        if (Number.isFinite(c.minDistance) && c.minDistance > 0 && Number.isFinite(c.maxDistance) && c.maxDistance > c.minDistance) {
          controls.minDistance = c.minDistance;
          controls.maxDistance = c.maxDistance;
        }
        controls.update();
        setActiveView(null);
        // Lit view button only if the restored pose still looks along it.
        const v = s.activeView && typeof s.activeView === "object" ? s.activeView : null;
        if (v && ["a", "b", "c", "uvw"].includes(v.id) && triple(v.indices) && v.indices.some((x) => x !== 0)) {
          try {
            const dir = new THREE.Vector3(...latticeViewDirection(structure.basis, v.indices).direction).normalize();
            if (eye.clone().normalize().dot(dir) > 0.99995) {
              lastOrientIndices = [...v.indices];
              setActiveView(v.id, dir);
            }
          } catch {
            /* not a valid direction for this cell */
          }
        }
      }
    }
    invalidate();
  }
  // ---- Undo / redo ------------------------------------------------------
  // Session-only preferences (panels, export options, editor target, turn
  // angle, unsubmitted direction text) are intentionally outside history.
  function exportHistoryState() {
    const s = exportViewerState();
    const keys = ["ranges", "boundary", "cell", "polyhedraOnly", "polyhedraVisible", "rules", "appearance", "atoms", "asymmetric", "highlightedSite", "shellCutoff", "shellOutline", "lattice", "camera", "activeView", "measure"];
    return Object.fromEntries(keys.map((key) => [key, s[key]]));
  }
  const historyEqual = (a, b) => JSON.stringify(a, (key, value) =>
    // Ignore floating point drift from controls.update(), retaining the
    // original numbers in the snapshots themselves.
    typeof value === "number" ? Number(value.toPrecision(12)) : value,
  ) === JSON.stringify(b, (key, value) => typeof value === "number" ? Number(value.toPrecision(12)) : value);
  const history = createHistory({ limit: 100, equal: historyEqual });
  let historyTimer = 0, historyLabel = "Change view", pressedHistoryLabel = "Change view", cameraGesture = false, historyKeyHeld = false;
  const historyPointers = new Set();
  const historyAvailable = () => historyReady && !historyApplying && saveSuspended === 0 && !exporter.busy && $("loading").hidden;
  function updateHistoryButtons(busy = exporter.busy) {
    const s = history.state;
    const blocked = !historyReady || busy || !$("loading").hidden;
    for (const [action, count, label] of [["undo", s.undoCount, s.undoLabel], ["redo", s.redoCount, s.redoLabel]]) {
      const button = $(`history-${action}`), name = action === "undo" ? "Undo" : "Redo";
      button.disabled = blocked || !count;
      button.title = label ? `${name}: ${label}` : name;
      button.setAttribute("aria-label", button.title);
    }
  }
  function clearHistoryGesture() {
    clearTimeout(historyTimer);
    historyTimer = 0;
    cameraGesture = false;
    historyKeyHeld = false;
    historyPointers.clear();
  }
  function flushHistory() {
    clearTimeout(historyTimer);
    historyTimer = 0;
    if (!historyReady || historyApplying || saveSuspended > 0) return;
    // Stop residual trackball inertia at an action boundary. Subsequent
    // frames cannot move a camera whose snapshot has already been stored.
    const moving = cameraGesture;
    cameraGesture = false;
    if (moving) stopMotion();
    if (pendingBuild) {
      cancelScheduledBuild();
      build(); // include the last live edit and its resulting selection
    }
    cameraGesture = false;
    if (history.checkpoint(exportHistoryState(), historyLabel)) saveHistoryChange();
    updateHistoryButtons();
  }
  function scheduleHistory(delay = 0) {
    if (!historyAvailable()) return;
    clearTimeout(historyTimer);
    historyTimer = 0;
    if (historyPointers.size || historyKeyHeld) return;
    historyTimer = setTimeout(flushHistory, delay);
  }
  function cameraHistoryChanged() {
    if (cameraGesture && historyAvailable())
      scheduleHistory(historyLabel === "Zoom view" ? 300 : 220);
  }
  function historyActionLabel(target) {
    if (target === renderer.domElement) return cameraGesture ? historyLabel : "Pick atom";
    const control = target.closest("button, input, select, form, tr");
    const id = control?.id ?? "";
    if (id.startsWith("view-") || id === "direction-form") return "Orient view";
    if (id === "reset") return "Reset view";
    if (control?.dataset.turn) return "Turn crystal";
    if (target.closest("#pair-rules") || id === "add-rule") return id === "add-rule" ? "Add pair" : control?.dataset.field === "cutoff" || target.closest(".cutoff-tuner") ? "Change pair cutoff" : "Edit pair";
    if (target.closest("#style-editor")) return id.startsWith("style-reset") ? "Reset style" : "Change style";
    if (target.closest("#range-form") || id === "range-reset") return "Change extent";
    if (id.startsWith("plane-") || target.closest("#plane-list")) return "Edit plane";
    if (id.startsWith("arrow-") || target.closest("#arrow-list")) return "Edit arrow";
    if (id.startsWith("sym-") || target.closest("#sym-controls")) return "Change symmetry display";
    if (target.closest("#lattice-tools")) return "Edit lattice";
    if (id.startsWith("measure-") || id === "clear") return "Change measurement";
    if (target.closest("#site-table, #poly-table")) return "Highlight site";
    return "Change display";
  }
  const historyButton = (target) => target.closest?.("#history-undo, #history-redo");
  // Capture before handlers that rebuild or remove their own controls. Read
  // the resulting semantic state in a later task, after the entire event
  // (including browser default actions and target handlers) has completed.
  document.addEventListener("pointerdown", (event) => {
    if (!historyAvailable() || historyButton(event.target)) return;
    if (!historyPointers.size) flushHistory();
    historyPointers.add(event.pointerId);
    cameraGesture = event.target === renderer.domElement || cameraGesture;
    historyLabel = cameraGesture ? "Move camera" : historyActionLabel(event.target);
    pressedHistoryLabel = historyLabel;
  }, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    document.addEventListener(type, (event) => {
      // Releasing one finger of a pinch must not end the whole gesture.
      if (type === "lostpointercapture") return;
      historyPointers.delete(event.pointerId);
      scheduleHistory(cameraGesture ? 220 : 0);
    }, true);
  document.addEventListener("wheel", (event) => {
    if (event.target !== renderer.domElement || pan || !historyAvailable()) return;
    if (!cameraGesture) flushHistory();
    cameraGesture = true;
    historyLabel = "Zoom view";
    scheduleHistory(300);
  }, { capture: true, passive: true });
  for (const type of ["click", "input", "change", "submit"])
    document.addEventListener(type, (event) => {
      if (!historyAvailable() || historyButton(event.target)) return;
      if (!cameraGesture) historyLabel = historyActionLabel(event.target);
      scheduleHistory(cameraGesture ? 220 : type === "input" ? 400 : 0);
    }, true);
  // A blur can commit a text field between the next control's pointerdown
  // and click. Record that commit immediately after its target handler,
  // separately from the new click/drag that is already starting.
  document.addEventListener("change", (event) => {
    if (!historyAvailable() || !event.target.matches("input[type=text], input[type=number]")) return;
    const moving = cameraGesture;
    cameraGesture = false;
    historyLabel = historyActionLabel(event.target);
    flushHistory();
    cameraGesture = moving;
    if (historyPointers.size) historyLabel = pressedHistoryLabel;
  });
  document.addEventListener("focusin", () => {
    if (historyTimer && !historyPointers.size && !cameraGesture) flushHistory();
  }, true);
  function applyHistoryState(state) {
    historyApplying = true;
    saveSuspended++;
    clearHistoryGesture();
    endPan();
    cancelScheduledBuild();
    closeTuners();
    stopMotion();
    try {
      const live = exportHistoryState();
      const sceneOnly = ({ camera, activeView, ...scene }) => scene;
      if (historyEqual(sceneOnly(live), sceneOnly(state))) restoreCameraState(state);
      else restoreViewerState({ ...exportViewerState(), ...state }, { trusted: true });
      if (state.activeView?.id === "uvw") $("view-direction").value = state.activeView.indices.join(" ");
    } finally {
      saveSuspended--;
      historyApplying = false;
    }
  }
  function travelHistory(action) {
    if (!historyAvailable()) return;
    flushHistory();
    const label = history.state[`${action}Label`];
    if (history[action](applyHistoryState)) {
      $("history-status").textContent = `${action === "undo" ? "Undid" : "Redid"}: ${label}.`;
      saveHistoryChange();
    }
    updateHistoryButtons();
  }
  $("history-undo").onclick = () => travelHistory("undo");
  $("history-redo").onclick = () => travelHistory("redo");
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target.isContentEditable || target.closest("textarea, [role='textbox']") ||
      (target.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "submit", "color", "file"].includes(target.type));
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !typing && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      travelHistory(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
    } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !typing && !exporter.busy && event.key.toLowerCase() === "o") {
      event.preventDefault();
      $("file").click();
    } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !typing && !exporter.busy && event.key.toLowerCase() === "s") {
      event.preventDefault();
      $("project-save")?.click();
    } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !typing && !exporter.busy && event.key.toLowerCase() === "e") {
      event.preventDefault();
      if (event.shiftKey) $("export-png")?.click();
      else {
        toolWindows.choose("export", { focus: true });
        $("export-png")?.focus({ preventScroll: true });
      }
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat && !typing && !target?.closest?.("select") && !exporter.busy && !document.querySelector("dialog:modal") && event.key.toLowerCase() === "d") {
      event.preventDefault();
      xrdWorkspace.toggle();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key) && target.matches("input[type=range], input[data-field=cutoff], [role=slider]")) {
      if (!historyKeyHeld) flushHistory();
      historyKeyHeld = true;
      historyLabel = historyActionLabel(target);
    }
  }, true);
  document.addEventListener("keyup", () => {
    if (!historyKeyHeld) return;
    historyKeyHeld = false;
    scheduleHistory();
  });
  window.addEventListener("blur", () => {
    historyPointers.clear();
    historyKeyHeld = false;
    scheduleHistory(cameraGesture ? 220 : 0);
  });

  function saveHistoryChange() {
    // Finder can terminate the process before a debounced write fires.
    if (desktop) void saveNow();
    else scheduleSave();
  }

  // Debounced autosave; the CIF text is only rewritten when it changed
  // (session-store keeps it separately).
  function scheduleSave(delay = 800) {
    if (saveSuspended > 0 || !structure || !currentText) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delay);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (saveSuspended > 0 || !structure || !currentText || exporter.busy) return Promise.resolve(false);
    let state;
    try {
      state = exportViewerState();
      if (desktop && historyReady) {
        state.undoHistory = history.snapshot();
        state.projectFilename = currentProjectFilename;
      }
    } catch (error) {
      sessionStatus(`Could not collect the settings to save: ${error.message}`, true);
      return Promise.resolve(false);
    }
    sessionStatus("Saving on this device…");
    return sessionStore
      .save({ document: { text: currentText, filename: currentFilename }, state, entrypoint: ENTRYPOINT })
      .then(({ savedAt }) => {
        sessionStatus(`Saved on this device at ${timeText(savedAt)}.`);
        return true;
      })
      .catch((error) => {
        // The last good snapshot stays in storage; the viewer keeps working.
        sessionStatus(`Could not save on this device (${error?.message ?? error}). The viewer keeps working.`, true);
        return false;
      });
  }
  // Settings edits anywhere in the sidebar or the view overlays, picks and
  // wheel zoom schedule a save; camera drags save via controls "change".
  for (const type of ["change", "input"]) document.addEventListener(type, () => scheduleSave(), true);
  document.addEventListener("pointerup", () => scheduleSave(), true);
  renderer.domElement.addEventListener("wheel", () => scheduleSave(1200), { passive: true });
  const flushSave = () => {
    if (saveTimer) saveNow();
  };
  addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  $("session-save").onclick = () => {
    if (saveSuspended > 0) return sessionStatus("Saving resumes once the current structure is shown.");
    saveNow();
  };
  // Start fresh: autosave stays suspended so the old session is not
  // written back, then the page entrypoint loads cleanly.
  $("session-fresh").onclick = async () => {
    if (!confirm("Discard this browser’s saved session and start fresh? Save a project file first if you want to keep the current scene.")) return;
    saveSuspended++;
    clearTimeout(saveTimer);
    saveTimer = 0;
    $("session-fresh").disabled = true;
    try {
      await sessionStore.clear();
    } catch (error) {
      sessionStatus(`Could not clear the saved session (${error?.message ?? error}).`, true);
      $("session-fresh").disabled = false;
      saveSuspended--;
      return;
    }
    location.reload();
  };
  function loadExample() {
    if (cifUrlParam) {
      fetch(cifUrlParam.url)
        .then(async (r) => {
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          const text = await r.text();
          if (new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024)
            throw Error("CIF exceeds the 16 MiB import limit.");
          return text;
        })
        .then((text) => {
          if (!userIntent && (!request || !structure)) load(text, cifUrlParam.filename);
        })
        .catch((error) => {
          if (userIntent || structure) return;
          $("loading").hidden = true;
          setError(`Could not load ${cifUrlParam.filename}: ${error.message}`);
        });
      return;
    }
    if (ENTRYPOINT.startsWith("structure:")) {
      openLibraryEntry(libraryEntry(ENTRYPOINT.slice(10)), true);
      return;
    }
    const example = examples[ENTRYPOINT] ?? { file: "example.cif", name: "Example structure" };
    fetch(`${import.meta.env.BASE_URL}${example.file}`)
      .then((r) => {
        if (!r.ok) throw Error("Example unavailable");
        return r.text();
      })
      .then((text) => {
        if (userIntent || (request && structure)) return;
        if (sharedScene) {
          const project = parseProject(text);
          load(project.document.text, project.document.filename, project.state.block, project.state,
            { name: example.name, theme: project.theme });
        } else {
          load(text, example.name);
        }
      })
      .catch(() => {
        if (userIntent || structure) return;
        $("loading").hidden = true;
        $("name").textContent = "Your next crystal";
        $("source").textContent = "Open a CIF file to begin.";
      });
  }
  // Startup: a saved session for THIS entrypoint resumes (including a file
  // imported later); a different example URL starts that example. A file
  // the user opens meanwhile wins (userIntent).
  (async () => {
    await connectDesktop({
      open: (name, text) => openDocument({ name, text: async () => text }),
      flush: async () => {
        document.activeElement?.blur();
        flushHistory();
        if (!structure || saveSuspended > 0) return true;
        return await saveNow() || confirm("The current session could not be saved. Quit with the last saved session?");
      },
      report: message => setError(message),
    });
    // Following a shared link starts the published view. A browser refresh
    // can resume edits from this example's own autosave.
    if (sharedScene && performance.getEntriesByType("navigation")[0]?.type !== "reload") {
      if (!userIntent && !request) loadExample();
      return;
    }
    let session = null;
    try {
      session = await sessionStore.load();
    } catch (error) {
      sessionStatus(`Saved sessions are unavailable on this device (${error?.message ?? error}). The viewer keeps working.`, true);
    }
    if (userIntent || request) return;
    if (session && ((desktop && !ENTRYPOINT) || (session.entrypoint ?? "") === ENTRYPOINT)) {
      restoredAt = session.savedAt ?? 0;
      const block = typeof session.state.block === "string" ? session.state.block : undefined;
      load(session.document.text, session.document.filename, block, session.state);
    } else loadExample();
  })();

  // ---- Drag-and-drop & clipboard paste intake (CIF / .psv / trace / PONI) -
  createFileIntake({
    overlay: $("drop-overlay"),
    isBusy: () => exporter.busy,
    isPowderActive: () => xrdWorkspace.isOpen && xrdWorkspace.tab === "powder",
    onBeforeOpen: () => {
      const lib = $("structure-library");
      if (lib?.open) lib.close();
      if (fileMenu?.matches?.(":popover-open")) fileMenu.hidePopover?.();
    },
    onStructureFile: (file) => {
      if (xrdWorkspace.isOpen && xrdWorkspace.tab === "powder" && /\.(xy|xye|dat|csv|txt)$/i.test(file.name)) {
        powderPanel.loadTraceFile(file);
        return;
      }
      openDocument(file);
    },
    onTraceFile: (file) => powderPanel.loadTraceFile(file),
    onPoniFile: (file) => diffractionDetector.loadPoniFile(file),
    onPasteCif: (text) => {
      userIntent++;
      load(text, "Pasted structure.cif");
    },
    onPasteProject: (text) => {
      try {
        const project = parseProject(text);
        userIntent++;
        projectStatus("Opening pasted project…");
        load(project.document.text, project.document.filename, project.state.block, project.state,
          { name: "Pasted project.psv", theme: project.theme });
      } catch (err) {
        setError(err.message);
      }
    },
    onToast: (msg) => sessionStatus(msg),
  });

  // ---- Command Palette (⌘K), Shortcut Sheet (?) & single-key shortcuts ----
  createCommandPalette({
    getLibrary: () => structureLibrary,
    onOpenLibraryEntry: (entry) => openLibraryEntry(entry),
    onAxis(axis, { opposite } = {}) {
      const s = opposite ? -1 : 1;
      const map = { a: [s, 0, 0], b: [0, s, 0], c: [0, 0, s] };
      if (map[axis]) orient(map[axis], opposite ? "uvw" : axis);
    },
    onFit: () => reset(true),
    onReset: () => reset(false),
    onMeasureMode: (mode) => setMeasureMode(mode),
    onEscape: () => {
      if (fileMenu?.matches?.(":popover-open")) {
        fileMenu.hidePopover?.();
        return;
      }
      if (xrdWorkspace.isOpen) {
        xrdWorkspace.close();
        return;
      }
      if (detailsOpen) {
        setDetailsOpen(false);
        return;
      }
      if (selection.length) {
        historyLabel = "Clear selection";
        selection = [];
        updateSelection();
      }
    },
    isBusy: () => exporter.busy,
    commands: [
      { id: "open", label: "Open CIF or .psv file…", group: "File", shortcut: "⌘O", run: () => $("file").click() },
      { id: "library", label: "Open Structure Library…", group: "File", run: () => $("library-open").click() },
      { id: "save", label: "Save project (.psv)", group: "File", shortcut: "⌘S", run: () => $("project-save")?.click() },
      { id: "export-png", label: "Export PNG image", group: "File", shortcut: "⌘⇧E", run: () => $("export-png")?.click() },
      { id: "view-a", label: "View along +a", group: "View", shortcut: "A", run: () => orient([1, 0, 0], "a") },
      { id: "view-b", label: "View along +b", group: "View", shortcut: "B", run: () => orient([0, 1, 0], "b") },
      { id: "view-c", label: "View along +c", group: "View", shortcut: "C", run: () => orient([0, 0, 1], "c") },
      { id: "fit", label: "Fit crystal to view", group: "View", shortcut: "F", run: () => reset(true) },
      { id: "reset", label: "Reset view & selection", group: "View", shortcut: "R", run: () => reset(false) },
      { id: "theme", label: "Toggle light / dark theme", group: "View", run: () => $("theme-toggle").click() },
      { id: "measure-info", label: "Atom info mode", group: "Measure", shortcut: "1", run: () => setMeasureMode("info") },
      { id: "measure-distance", label: "Distance measurement mode", group: "Measure", shortcut: "2", run: () => setMeasureMode("distance") },
      { id: "measure-angle", label: "Angle measurement mode", group: "Measure", shortcut: "3", run: () => setMeasureMode("angle") },
      { id: "tool-pairs", label: "Bonds & polyhedra", group: "Tools", run: () => toolWindows.choose("pairs", { focus: true }) },
      { id: "tool-planes", label: "Crystal planes (hkl)", group: "Tools", run: () => toolWindows.choose("lattice", { focus: true }) },
      { id: "tool-directions", label: "Crystal directions [uvw]", group: "Tools", run: () => toolWindows.choose("directions", { focus: true }) },
      { id: "tool-symmetry", label: "Symmetry elements", group: "Tools", run: () => toolWindows.choose("symmetry", { focus: true }) },
      { id: "tool-sites", label: "Sites & coordination shells", group: "Tools", run: () => toolWindows.choose("sites", { focus: true }) },
      { id: "tool-extent", label: "Extent & unit cell", group: "Tools", run: () => toolWindows.choose("extent", { focus: true }) },
      { id: "tool-style", label: "Style & element palettes", group: "Tools", run: () => toolWindows.choose("style", { focus: true }) },
      { id: "tool-export", label: "Export PNG / turntable movie", group: "Tools", shortcut: "⌘E", run: () => toolWindows.choose("export", { focus: true }) },
      { id: "win-distances", label: "Interatomic distances plot", group: "Analysis", run: () => $("mode-analysis")?.click() },
      { id: "win-powder", label: "Open XRD / Powder", group: "Diffraction", shortcut: "D", run: () => xrdWorkspace.open("powder") },
      { id: "win-reflection", label: "Open Reflection Explorer", group: "Diffraction", run: () => xrdWorkspace.open("reflection") },
      { id: "win-detector", label: "Open Diffraction Detector", group: "Diffraction", run: () => xrdWorkspace.open("detector") },
      { id: "undo", label: "Undo", group: "Edit", shortcut: "⌘Z", run: () => travelHistory("undo") },
      { id: "redo", label: "Redo", group: "Edit", shortcut: "⌘⇧Z", run: () => travelHistory("redo") },
    ],
  });
  // Keep filled-track CSS variable (--fill) synced on all range sliders
  const syncRangeFill = (el) => {
    if (!el || el.tagName !== "INPUT" || el.type !== "range") return;
    const min = Number(el.min === "" ? 0 : el.min);
    const max = Number(el.max === "" ? 100 : el.max);
    const val = Number(el.value);
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    el.style.setProperty("--fill", `${pct.toFixed(1)}%`);
  };
  const syncAllRanges = () => {
    for (const el of document.querySelectorAll('input[type="range"]')) syncRangeFill(el);
  };
  let rangeSyncFrame = 0;
  const scheduleRangeSync = () => {
    if (rangeSyncFrame) return;
    rangeSyncFrame = requestAnimationFrame(() => {
      rangeSyncFrame = 0;
      syncAllRanges();
    });
  };
  document.addEventListener("input", (e) => syncRangeFill(e.target), true);
  document.addEventListener("change", (e) => syncRangeFill(e.target), true);
  document.addEventListener("click", scheduleRangeSync, true);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.('input[type="range"]') || node.querySelector?.('input[type="range"]'))) {
          scheduleRangeSync();
          return;
        }
      }
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
  });
  syncAllRanges();
}
initialize();
