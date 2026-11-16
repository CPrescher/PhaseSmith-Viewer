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
// Namespace import: describeViewDirection is root's helper (readout).
import * as viewDirection from "./view-direction.js";
import { createSessionStore } from "./session-store.js";
import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
import { elementColor as defaultColor } from "./elements.js";
import { estimatePairCutoff } from "./pair-defaults.js";
import { angleAt, hullVolume } from "./crystal-math.js";
import { createLatticeTools } from "./lattice-tools.js";
import { createAxisCompass } from "./axis-compass.js";
import { createThemeSwitch } from "./theme.js";
import { createExporter, validDpi } from "./export.js";
import { createFaceSorter } from "./face-sort.js";
import { createDepthPeeler } from "./peel.js";
import { rotatedView } from "./view-rotation.js";
import { createTurnControls } from "./turn-controls.js";
import { createStructureLibrary, libraryEntry, libraryFilename, entryForFilename } from "./structure-library.js";
import { createToolWindows, TOOL_IDS } from "./tool-windows.js";
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
    $("library-open").disabled = true;
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute(
    "aria-label",
    "Interactive crystal structure. Drag to rotate, scroll or pinch to zoom, and select an atom for information. Choose Distance or Angle to measure.",
  );
  renderer.domElement.setAttribute("role", "img");
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
  // A perspective control camera supplies intuitive distance-based zoom;
  // the synchronized parallel camera renders and picks the crystal.
  const viewCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
  // Stage: the crystal is centred in the part of the view that open tool
  // windows leave clear. Only the rendered camera's projection window is
  // shifted by `stage` CSS px (an off-axis orthographic frustum); the pose
  // (camera, target, up) is untouched. Rendering, picking, labels,
  // measurement overlays and diagnostics all project through viewCamera,
  // the compass and [uvw] readout depend on rotation only, and right-drag
  // pan moves world units per CSS px, so all stay consistent. Wheel and
  // click zoom subtract the offset to keep the cursor point fixed. Exports
  // suspend the offset, so images are framed on the full canvas.
  const stage = { x: 0, y: 0, clear: null };
  let stageSuspended = false;
  const viewSize = { width: 1, height: 1 };
  function syncViewCamera() {
    const halfHeight =
      camera.position.distanceTo(controls.target) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const perPixel = (2 * halfHeight) / viewSize.height;
    const sx = stageSuspended ? 0 : stage.x * perPixel,
      sy = stageSuspended ? 0 : stage.y * perPixel;
    viewCamera.left = -halfHeight * camera.aspect - sx;
    viewCamera.right = halfHeight * camera.aspect - sx;
    viewCamera.top = halfHeight + sy;
    viewCamera.bottom = -halfHeight + sy;
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
  }
  const viewAxis = new THREE.Vector3(),
    sceneBox = new THREE.Box3(),
    sceneSphere = new THREE.Sphere(),
    sceneDelta = new THREE.Vector3();
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
    // Camera autosave once motion (including damping) has settled.
    next.addEventListener("change", () => scheduleSave(1200));
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
  scene.add(selectionGroup);
  function render() {
    frame = 0;
    // Trackball emits change while damping moves the camera. That event
    // schedules the next frame; once settled, no animation frames remain.
    controls.update();
    syncViewCamera();
    syncStudio();
    faceSorter.sync([...faceMeshes.values()], viewCamera);
    peeler.render(scene, viewCamera);
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
  const compass = createAxisCompass($("axis-compass"), $("axis-compass-text"));
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
    const { width, height } = renderer.domElement.getBoundingClientRect();
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
    viewSize.width = Math.max(width, 1);
    viewSize.height = Math.max(height, 1);
    renderer.setSize(width, height);
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
  // Overlay colors (selection, measurement, pick marker, cell edges) per
  // theme; element and pair colors are scientific choices and never change.
  const SCENE_PALETTES = {
    dark: { select: 0x79ffdc, arc: 0xffe08a, pick: 0xffc46b, cell: 0x7fa6c5 },
    light: { select: 0x0a8f7b, arc: 0xc06d00, pick: 0xd08300, cell: 0x587690 },
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
    (radii[a.element] || 0.42) * Number($("size").value) * styleOf(a).scale;
  const ruleColor = (rule) => rule.color ?? defaultColor(rule.center);
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
    fitCorners = corners.map((p) => p.clone().sub(modelCenter));
    fitBounds = new THREE.Box3().setFromPoints(fitCorners);
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
        color: scenePalette().cell,
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
    // Overlays follow the new model center, ranges and atom list.
    latticeTools.rebuild();
    highlightSite(highlightedSite);
    invalidate();
  }
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
        const edges = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: scenePalette().pick,
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
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    const oxideCenters = new Set(["Si", "Mg", "Al", "Fe", "Ca", "Ti"]);
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
            card.style.setProperty("--pair-color", ruleColor(rule));
            label();
            setCutoff(startingCutoff(rule.center, rule.neighbor), false);
            styleEditor?.refresh();
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
        // delivered to the field, so the compatibility click can never land
        // on a control the opening tuner put under the finger. Long holds
        // without a click open after a clean release; pans and cancels
        // never open.
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
          } else if (e.key === "Escape" && !tuner.hidden) {
            e.preventDefault(); // the tuner, not the Pairs window
            tuner.close();
          } else if (e.key === "Enter" && !tuner.hidden) {
            // Typed value committed (change follows): the row under the
            // field returns, so Bonds/Polyhedra/Opacity are one tap away.
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
          card.dataset.tuneName = `${name} pair`;
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
        // The tuner opens in place of the Bonds/Polyhedra/Opacity row, in
        // one shared grid cell: the card keeps its height, nothing below
        // moves and the counts stay visible while the cutoff changes.
        const slot = make("div", { className: "pair-slot" });
        slot.append(sub, tuner);
        card.dataset.tuneItem = `rule:${rule.id}`;
        card.append(main, slot, counts);
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
    invalidate();
  }
  $("show-atoms").onchange = updateAtomVisibility;
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
              ? convexHull(vertices.map((a) => a.cartesian))
              : null;
            // Physical volume from the true neighbor coordinates, computed
            // once; display scale and opacity never enter it.
            if (hull)
              plan.hulls.push({
                center: env.center,
                vertices,
                hull,
                volume: hullVolume(hull.vertices, hull.faces),
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
        (stat.paused
          ? "Paused in asymmetric-unit view"
          : !(stat.bonds || stat.polyhedra)
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
        for (const text of [s.label, s.element, ...frac3(s.frac), s.occupancy != null ? Number(s.occupancy).toFixed(3) : "—"]) {
          const cell = document.createElement("td");
          cell.textContent = text;
          row.append(cell);
        }
        const choose = () => highlightSite(highlightedSite === s.label ? null : s.label);
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
  function renderPolyTable() {
    const body = $("poly-table")?.tBodies[0];
    if (!body) return;
    // Group by pair and central CIF site label: CN set and volume range.
    const groups = new Map();
    for (const stat of coordinationStats)
      for (const env of stat.environments) {
        const key = `${pairName(stat)}|${env.centerLabel}`;
        if (!groups.has(key))
          groups.set(key, { pair: pairName(stat), label: env.centerLabel, cn: new Set(), volumes: [] });
        const g = groups.get(key);
        g.cn.add(env.coordination);
        g.volumes.push(env.volume);
      }
    body.replaceChildren(
      ...[...groups.values()].map((g) => {
        const row = document.createElement("tr");
        const lo = Math.min(...g.volumes),
          hi = Math.max(...g.volumes);
        const volume = hi - lo < 5e-4 ? lo.toFixed(3) : `${lo.toFixed(3)}–${hi.toFixed(3)}`;
        for (const text of [g.label, g.pair, [...g.cn].sort((a, b) => a - b).join(", "), volume]) {
          const cell = document.createElement("td");
          cell.textContent = text;
          row.append(cell);
        }
        row.tabIndex = 0;
        row.title = `Highlight ${g.label} centers`;
        const choose = () => highlightSite(highlightedSite === g.label ? null : g.label);
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
  const siteGroup = new THREE.Group();
  scene.add(siteGroup);
  function highlightSite(label) {
    highlightedSite = label;
    dispose(siteGroup);
    siteGroup.clear();
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
          shells.setMatrixAt(i, m.compose(a.position, new THREE.Quaternion(), new THREE.Vector3().setScalar(a.radius * 1.12))),
        );
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
  // Fit room: only the view toolbar (top) and the atom bar (bottom) span the
  // crystal's column; the measurement card and compass sit beside it. The
  // margins are measured within the clear stage area (the atom bar rides
  // on top of a bottom tool sheet).
  function overlayReserve(clear) {
    const view = viewport.getBoundingClientRect();
    const top = document.querySelector(".view-directions").getBoundingClientRect();
    const bottom = document.querySelector(".atoms-bar").getBoundingClientRect();
    // The [uvw] readout sits above the legend; keep the fit clear of it.
    const readout = $("view-readout").getBoundingClientRect();
    const bottomTop = readout.height ? Math.min(bottom.top, readout.top) : bottom.top;
    const clearTop = view.top + clear.y,
      clearBottom = clearTop + clear.h;
    return Math.max(top.bottom - clearTop, clearBottom - bottomTop, 0) + 4;
  }
  // The last fit; a layout change (tool window opened, moved, closed)
  // refits only while the user has not zoomed or panned since.
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
    let halfRight = 0,
      halfUp = 0;
    const offset = new THREE.Vector3();
    const extend = (point, radius = 0) => {
      offset.copy(point).sub(target);
      halfRight = Math.max(halfRight, Math.abs(offset.dot(right)) + radius);
      halfUp = Math.max(halfUp, Math.abs(offset.dot(up)) + radius);
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
    halfRight = Math.max(halfRight, 0.5);
    halfUp = Math.max(halfUp, 0.5);
    // Canvas toolbars sit along the top and bottom edges; fit the crystal
    // between them, inside the area open tool windows leave clear, so no
    // control or palette covers it after a reset.
    const height = viewport.clientHeight || 1;
    const clear = stage.clear ?? { x: 0, y: 0, w: viewport.clientWidth || 1, h: height };
    const usable = Math.max(clear.h - 2 * overlayReserve(clear), clear.h * 0.7);
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
  function updateSelection() {
    dispose(selectionGroup);
    selectionGroup.clear();
    // Selection is a crisp back-face shell: from any direction it reads as
    // an even halo around the atom's silhouette and never covers its face.
    for (const a of selection) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(a.radius * 1.13, 64, 48),
        new THREE.MeshBasicMaterial({
          color: scenePalette().select,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.92,
        }),
      );
      halo.position.copy(a.position);
      selectionGroup.add(halo);
    }
    distance = null;
    angle = null;
    if (measureMode === "angle" && selection.length >= 2) {
      // A–B–C: two solid legs from the vertex B and an arc at B.
      const [a, b, c] = selection;
      const legs = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(
          [a, b, ...(c ? [b, c] : [])].map((atom) => atom.position),
        ),
        new THREE.LineBasicMaterial({ color: scenePalette().select, depthTest: false }),
      );
      legs.renderOrder = 5;
      selectionGroup.add(legs);
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
          const curve = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(arc),
            new THREE.LineBasicMaterial({ color: scenePalette().arc, depthTest: false }),
          );
          curve.renderOrder = 6;
          selectionGroup.add(curve);
        }
      }
    }
    if (measureMode === "distance" && selection.length === 2) {
      distance = selection[0].position.distanceTo(selection[1].position);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          selection.map((a) => a.position),
        ),
        new THREE.LineDashedMaterial({
          color: scenePalette().select,
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
      // Relative to the projected pivot, which sits at the stage centre.
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1 - (2 * stage.x) / rect.width,
        ny = 1 - ((clientY - rect.top) / rect.height) * 2 + (2 * stage.y) / rect.height;
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
      // Info inspects one atom (a new tap replaces it); a completed
      // distance (2) or angle (3) starts a new measurement.
      if (measureMode === "info") selection = [];
      else if (selection.length === (measureMode === "angle" ? 3 : 2)) selection = [];
      if (!selection.includes(atom)) selection.push(atom);
      updateSelection();
    } else if (
      selection.length &&
      (measureMode === "info" || selection.length === (measureMode === "angle" ? 3 : 2))
    ) {
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
          label: `${pairName(r)} polyhedra`,
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
          title: `All ${pairName(rule)} polyhedra`,
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
    targetMeta.clear();
    openCutoffRule = null;
    // Per-structure tool state: asymmetric view, site highlight, planes,
    // arrows and symmetry elements start fresh.
    asymmetric = false;
    $("asym-toggle").checked = false;
    highlightedSite = null;
    structure = data;
    pairEstimates.clear();
    latticeTools.reset();
    hiddenElements.clear();
    $("show-atoms").checked = true;
    $("name").textContent = data.name || data.block || "Crystal structure";
    const reference = entryForFilename(currentFilename);
    $("source").replaceChildren();
    if (reference) {
      $("name").textContent = reference.name;
      const link = document.createElement("a");
      link.href = reference.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${reference.formula} · ${reference.source.label} ↗`;
      link.title = reference.source.citation;
      $("source").append(link);
    } else $("source").textContent = currentFilename || "Example structure · built in";
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
    renderSiteTable();
    updateAsymmetricNote();
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
      if (structure) $("block").value = structure.block;
      $("error").textContent = `Could not open this CIF: ${data.error}`;
      $("error").hidden = false;
      if (!structure) $("name").textContent = "Open a crystal structure";
      return;
    }
    currentText = task.text;
    currentFilename = task.filename;
    display(data);
    if (task.restore) {
      try {
        restoreViewerState(task.restore);
        sessionStatus(`Restored the session saved on this device${restoredAt ? ` at ${timeText(restoredAt)}` : ""}.`);
      } catch (error) {
        console.error(error);
        sessionStatus("Part of the saved session could not be restored; the rest is shown.", true);
      }
    }
    // Save only after the final layout/resize has settled (two frames),
    // so the restored camera is captured as restored, not refitted.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (startupHold) {
          startupHold = false;
          saveSuspended--;
        }
        scheduleSave(task.restore ? 300 : 0);
      }),
    );
  };
  worker.onerror = (e) => {
    $("loading").hidden = true;
    $("open").disabled = false;
    $("error").textContent =
      "The crystal reader could not start. Reload the viewer and try again.";
    $("error").hidden = false;
    console.error(e);
  };
  function load(text, filename, block, restore = null) {
    $("error").hidden = true;
    $("loading").hidden = false;
    $("open").disabled = true;
    $("block").disabled = true;
    pending.push({ id: ++request, text, filename, block, restore, intent: userIntent });
    worker.postMessage({ text, block });
  }
  async function openLibraryEntry(entry, startup = false) {
    if (exporter.busy) return;
    const intent = startup ? userIntent : ++userIntent;
    $("error").hidden = true;
    $("loading").hidden = false;
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
      $("error").hidden = false;
      $("error").textContent = `Could not open ${entry.name}: ${error.message}`;
    }
  }
  createStructureLibrary({ onSelect: openLibraryEntry, isBusy: () => exporter.busy });
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
  // Discrete step turns (Turn panel). Inertia is cancelled FIRST
  // (stopMotion replaces the controls, so the current `controls` is read
  // afterwards); then camera position/up come from the tested helper.
  // The pivot (controls.target), zoom distance, atoms, selection and
  // measurements stay untouched, and nothing keeps moving afterwards.
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
        // Translucent pairs render from the shared sorted batch instead.
        drawnBy: mesh.visible ? (mesh.material.opacity < 1 ? "sorted-batch" : "own-mesh") : "outline-only",
      })),
      translucentFaces: faceSorter.diagnostics(),
      transparency: peeler.diagnostics(),
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
      // View-space unit directions of a, b, c as drawn by the compass
      // (x right, y up, z toward the viewer).
      axisCompass: compassState,
      turn: turnControls.diagnostics(),
      viewReadout: { text: readoutText, visible: !$("view-readout").hidden },
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
      cellSegmentCount: cellLines?.geometry.attributes.position.count / 2,
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
    atomLabels: () => (labelsOn ? lastAtomLabels : []),
    latticeLabels: () => latticeTools.placedLabels(),
    exportObstacles: (rects) => latticeTools.setExportObstacles(rects),
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
      // Exports frame the full canvas: the stage offset pauses meanwhile.
      exportBusy = busy;
      stageSuspended = busy;
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
      for (const id of ["export-png", "export-video"]) $(id).disabled = busy || (id === "export-video" && !videoFormat.mime);
    },
  });
  const videoFormat = exporter.videoSupport();
  const exportScale = () => Number(document.querySelector('input[name="export-scale"]:checked')?.value || 2);
  // DPI is stored in the PNG (pHYs); it does not change the pixel size.
  const exportDpi = () => validDpi($("export-dpi").value);
  function updateExportInfo() {
    const { width, height } = renderer.domElement.getBoundingClientRect();
    const scale = exportScale();
    const limit = (max) => Math.min(scale, max / Math.max(width, height, 1));
    const even = (v, f) => 2 * Math.round((v * f) / 2);
    const png = limit(4096),
      movie = limit(1920);
    const dpi = exportDpi();
    const cm = (pixels) => ((pixels / dpi) * 2.54).toFixed(1);
    $("export-dims").textContent =
      `PNG ${even(width, png)} × ${even(height, png)} px` +
      (dpi ? ` = ${cm(even(width, png))} × ${cm(even(height, png))} cm at ${dpi} dpi` : " · DPI must be 30–2400") +
      ` · movie ${even(width, movie)} × ${even(height, movie)} px`;
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
      const result = await exporter.exportPNG({ scale: exportScale(), transparent: $("export-transparent").checked, dpi });
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
        onProgress: (p) => {
          progress.value = p;
          $("export-status").textContent = `Recording turntable… ${Math.round(p * 100)}%`;
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
        : `Saved ${result.filename} (${result.width} × ${result.height}, ${result.frames} frames).`;
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
  // ---- Tool windows ---------------------------------------------------------
  // One bounded palette per tool (tool-windows.js). Window layout changes
  // only by explicit window actions and window resizes; each one moves the
  // crystal into the clear area (projection offset) and refits it only if
  // the view is still at its last fit (no manual zoom or pan since).
  let exportBusy = false;
  function applyStageLayout(info) {
    viewport.style.setProperty("--sheet-lift", `${info.sheetLift}px`);
    viewport.style.setProperty("--right-shift", `${info.rightShift}px`);
    const refit = Boolean(structure) && isAtFit() && !exportBusy;
    stage.x = info.offset.x;
    stage.y = info.offset.y;
    stage.clear = { ...info.clear };
    if (refit) reset(true);
    else invalidate();
    boundDetails();
  }
  const toolWindows = createToolWindows({
    viewport,
    app: $("app"),
    rail: $("tool-rail"),
    menuButton: $("tools-menu"),
    tidyButton: $("tools-tidy"),
    metrics() {
      // Palette below the measurement card's reserved height; the rail and
      // compass keep the right edge; sheets stay below the rail.
      const view = viewport.getBoundingClientRect();
      const row = document.querySelector(".measure-row").getBoundingClientRect();
      const rail = $("tool-rail").getBoundingClientRect();
      const cardMax = parseFloat(getComputedStyle(viewport).getPropertyValue("--card-max")) || 168;
      return {
        paletteTop: row.bottom - view.top + 6 + cardMax + 10,
        railColumn: 92,
        railBottom: $("app").dataset.launcher === "rail" && rail.height ? rail.bottom - view.top : 0,
        sideTop: row.bottom - view.top + 6,
        bottomGap: 40,
      };
    },
    onLayout: applyStageLayout,
    onVisibility(tool, visible) {
      if (tool === "style") styleEditor.setOpen(visible);
      if (tool === "export" && visible) updateExportInfo();
    },
    onChange: () => scheduleSave(),
  });

  // Light/dark theme: CSS follows data-theme; scene overlays that carry
  // their own colors are rebuilt with the new palette.
  const themeSwitch = createThemeSwitch({
    button: $("theme-toggle"),
    onChange: () => {
      if (cellLines) cellLines.material.color.set(scenePalette().cell);
      updateSelection();
      updatePickMarker();
      highlightSite(highlightedSite);
      latticeTools.rebuild();
      invalidate();
    },
  });
  // ---- Local session (this device only) ----------------------------------
  // Plain settings are saved with the loaded CIF text in IndexedDB
  // (session-store.js) and restored on the next start of the same page
  // entrypoint. Derived geometry, Three.js objects and label caches are
  // rebuilt, never stored. Transient popovers are not reopened.
  const ENTRYPOINT = (() => {
    const params = new URLSearchParams(location.search);
    const entry = libraryEntry(params.get("structure"));
    if (entry) return `structure:${entry.id}`;
    const v = params.get("example");
    return v === "forsterite" || v === "wollastonite" ? v : "";
  })();
  const sessionStore = createSessionStore();
  let restoredAt = 0;
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
        show: $("show-atoms").checked,
        hidden: [...hiddenElements],
        size: Number($("size").value),
        labels: labelsOn,
      },
      asymmetric,
      highlightedSite,
      lattice: latticeTools.exportState(),
      camera: {
        position: camera.position.toArray(),
        up: camera.up.toArray(),
        target: controls.target.toArray(),
      },
      turnAngle: turnControls.angle,
      measure: { mode: measureMode, keys: selection.map(atomKey) },
      // Open tools back to front (front-most last) and the window layout.
      panels: toolWindows.openTools(),
      windows: toolWindows.exportState(),
      // Added later in version 1 (optional on restore).
      uvwText: $("view-direction").value,
      activeView: activeView && lastOrientIndices ? { id: activeView.id, indices: [...lastOrientIndices] } : null,
      styleTarget: styleEditor.target || null,
      export: {
        scale: exportScale(),
        dpi: $("export-dpi").value,
        transparent: $("export-transparent").checked,
        seconds: $("export-seconds").value,
        fps: $("export-fps").value,
      },
    };
  }
  // Apply a saved state to the freshly displayed document. Every value is
  // validated; unknown fields are ignored and references that do not
  // exist in this structure (elements, rules, atoms, sites) are dropped.
  function restoreViewerState(s) {
    if (!s || typeof s !== "object") return;
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
    ])
      if (typeof s[key] === "boolean") $(id).checked = s[key];
    // Pair rules.
    if (Array.isArray(s.rules)) {
      const seen = new Set();
      rules = [];
      for (const r of s.rules.slice(0, 24)) {
        if (!r || !elements.has(r.center) || !elements.has(r.neighbor)) continue;
        if (!finite(r.cutoff) || r.cutoff < CUTOFF_MIN || r.cutoff > 50) continue;
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
    if (typeof a.show === "boolean") $("show-atoms").checked = a.show;
    hiddenElements.clear();
    for (const e of Array.isArray(a.hidden) ? a.hidden : []) if (elements.has(e)) hiddenElements.add(e);
    for (const button of document.querySelectorAll("#elements .element"))
      button.setAttribute("aria-pressed", String(!hiddenElements.has(button.dataset.element)));
    const size = $("size");
    if (finite(a.size) && a.size >= Number(size.min) && a.size <= Number(size.max)) {
      size.value = String(a.size);
      size.setAttribute("aria-valuetext", `${Math.round(a.size * 100)}%`);
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
    latticeTools.restoreState(s.lattice);
    if (typeof s.highlightedSite === "string" && independentSites().some((x) => x.label === s.highlightedSite))
      highlightSite(s.highlightedSite);
    if (s.turnAngle != null) turnControls.setAngle(s.turnAngle);
    // Measurement: the mode, then the picked copies IN ORDER (the angle
    // vertex stays second). Restored only if every saved copy still exists.
    const m = s.measure && typeof s.measure === "object" ? s.measure : {};
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
    if (typeof ex.transparent === "boolean") $("export-transparent").checked = ex.transparent;
    for (const [id, value] of [
      ["export-seconds", ex.seconds],
      ["export-fps", ex.fps],
    ])
      if (value != null && [...$(id).options].some((o) => o.value === String(value))) $(id).value = String(value);
    updateExportInfo();
    // Camera last: nothing after this refits the view.
    const c = s.camera && typeof s.camera === "object" ? s.camera : null;
    if (c && triple(c.position) && triple(c.up) && triple(c.target)) {
      const eye = new THREE.Vector3().fromArray(c.position).sub(new THREE.Vector3().fromArray(c.target));
      const up = new THREE.Vector3().fromArray(c.up);
      if (eye.lengthSq() > 1e-12 && up.lengthSq() > 1e-12 && up.clone().cross(eye).lengthSq() > 1e-12 * eye.lengthSq() * up.lengthSq()) {
        stopMotion();
        controls.target.fromArray(c.target);
        camera.position.fromArray(c.position);
        camera.up.copy(up.normalize());
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
    } catch (error) {
      sessionStatus(`Could not collect the settings to save: ${error.message}`, true);
      return Promise.resolve(false);
    }
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
    if (ENTRYPOINT.startsWith("structure:")) {
      openLibraryEntry(libraryEntry(ENTRYPOINT.slice(10)), true);
      return;
    }
    const wollastoniteExample = ENTRYPOINT === "wollastonite";
    const forsteriteExample = ENTRYPOINT === "forsterite";
    fetch(
      `${import.meta.env.BASE_URL}${wollastoniteExample ? "examples/wollastonite.cif" : forsteriteExample ? "examples/forsterite.cif" : "example.cif"}`,
    )
      .then((r) => {
        if (!r.ok) throw Error("Example unavailable");
        return r.text();
      })
      .then((text) => {
        if (!userIntent && (!request || !structure))
          load(text, wollastoniteExample ? "Wollastonite example" : forsteriteExample ? "Forsterite example" : "Example structure");
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
    let session = null;
    try {
      session = await sessionStore.load();
    } catch (error) {
      sessionStatus(`Saved sessions are unavailable on this device (${error?.message ?? error}). The viewer keeps working.`, true);
    }
    if (userIntent || request) return;
    if (session && (session.entrypoint ?? "") === ENTRYPOINT) {
      restoredAt = session.savedAt ?? 0;
      const block = typeof session.state.block === "string" ? session.state.block : undefined;
      load(session.document.text, session.document.filename, block, session.state);
    } else loadExample();
  })();
}
initialize();
