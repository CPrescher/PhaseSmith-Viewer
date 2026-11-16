import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import "./style.css";
import { latticeViewDirection } from "./view-direction.js";
import { buildCoordinationEnvironments, convexHull } from "./coordination.js";
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
  const colorFor = (e) => colors[e] || "#acb5cf";
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
  function build(preserve = true) {
    const selectedKeys = preserve ? selection.map(atomKey) : [];
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
      corners.push(cart([i & 1, (i >> 1) & 1, (i >> 2) & 1]));
    const box = new THREE.Box3().setFromPoints(corners);
    modelCenter = box.getCenter(new THREE.Vector3());
    const boundary = $("boundary").checked;
    structure.atoms.forEach((a, index) => {
      // PhaseSmith already returns canonical fractions in [0, 1). Keep their
      // float64 precision: a small positive coordinate is not a cell face.
      const f = a.frac;

      const options = f.map((v) => (boundary && v === 0 ? [0, 1] : [v]));
      for (const x of options[0])
        for (const y of options[1])
          for (const z of options[2]) {
            const frac = [x, y, z],
              p = cart(frac);
            atoms.push({
              ...a,
              id: atoms.length,
              sourceIndex: index,
              frac,
              position: p.clone().sub(modelCenter),
              cartesian: p.toArray(),
            });
          }
    });
    buildCoordination();
    selection = atoms.filter((a) => selectedKeys.includes(atomKey(a)));
    const byElement = new Map();
    atoms.forEach((a) => {
      if (!byElement.has(a.element)) byElement.set(a.element, []);
      byElement.get(a.element).push(a);
    });
    const detail =
      atoms.length > 10000
        ? [10, 8]
        : atoms.length > 2000
          ? [16, 12]
          : [28, 20];
    const sphere = new THREE.SphereGeometry(1, ...detail),
      matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3(),
      size = Number($("size").value);
    for (const [e, list] of byElement) {
      const mesh = new THREE.InstancedMesh(
        sphere.clone(),
        new THREE.MeshStandardMaterial({
          color: colorFor(e),
          roughness: 0.34,
          metalness: 0.06,
        }),
        list.length,
      );
      mesh.userData.atoms = list;
      list.forEach((a, i) => {
        a.radius = (radii[e] || 0.42) * size;
        matrix.compose(a.position, rotation, scale.setScalar(a.radius));
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
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
    const points = [];
    for (let i = 0; i < 8; i++)
      for (let axis = 0; axis < 3; axis++)
        if (!(i & (1 << axis)))
          points.push(
            corners[i].clone().sub(modelCenter),
            corners[i | (1 << axis)].clone().sub(modelCenter),
          );
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
    $("atom-summary").textContent =
      `${atoms.length.toLocaleString()} visible atoms`;
    updateSelection();
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
    } else $("polyhedra-only").checked = false;
    renderRules();
  }
  function renderRules() {
    const elements = [...new Set(structure.atoms.map((a) => a.element))];
    $("pair-rules").replaceChildren(
      ...rules.map((rule, index) => {
        const card = document.createElement("div");
        card.className = "pair-rule";
        card.style.setProperty(
          "--pair-color",
          pairColors[index % pairColors.length],
        );
        const heading = document.createElement("div");
        heading.className = "pair-heading";
        const title = document.createElement("span");
        title.textContent = `${rule.center} → ${rule.neighbor}`;
        const remove = document.createElement("button");
        remove.className = "text-button";
        remove.textContent = "Delete";
        remove.onclick = () => {
          rules = rules.filter((r) => r !== rule);
          renderRules();
          build();
        };
        heading.append(title, remove);
        const fields = document.createElement("div");
        fields.className = "pair-fields";
        for (const field of ["center", "neighbor", "cutoff"]) {
          const label = document.createElement("label");
          label.textContent =
            field === "cutoff"
              ? "Distance cutoff (Å)"
              : field === "center"
                ? "Center"
                : "Neighbor";
          let input;
          if (field === "cutoff") {
            label.className = "pair-cutoff";
            input = document.createElement("input");
            input.type = "number";
            input.min = "0.1";
            input.step = "any";
            input.value = rule.cutoff;
          } else {
            input = document.createElement("select");
            for (const e of elements) {
              const o = document.createElement("option");
              o.value = o.textContent = e;
              input.append(o);
            }
            input.value = rule[field];
          }
          input.dataset.field = field;
          input.setAttribute("aria-label", label.textContent);
          input.onchange = () => {
            if (
              field === "cutoff" &&
              (!input.checkValidity() || !Number.isFinite(Number(input.value)))
            ) {
              input.reportValidity();
              return;
            }
            rule[field] =
              field === "cutoff" ? Number(input.value) : input.value;
            title.textContent = `${rule.center} → ${rule.neighbor}`;
            build();
          };
          label.append(input);
          fields.append(label);
        }
        const switches = document.createElement("div");
        switches.className = "pair-switches";
        for (const field of ["bonds", "polyhedra"]) {
          const label = document.createElement("label");
          label.className = "toggle";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = rule[field];
          input.dataset.field = field;
          input.onchange = () => {
            if (
              field === "polyhedra" &&
              input.checked &&
              !rules.some((r) => r.polyhedra)
            )
              $("polyhedra-only").checked = true;
            rule[field] = input.checked;
            build();
          };
          label.append(
            input,
            document.createTextNode(field === "bonds" ? "Bonds" : "Polyhedra"),
          );
          switches.append(label);
        }
        const counts = document.createElement("p");
        counts.className = "pair-counts";
        counts.id = `pair-count-${rule.id}`;
        card.append(heading, fields, switches, counts);
        return card;
      }),
    );
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
    });
    renderRules();
    build();
  };
  $("polyhedra-only").onchange = () => {
    if (structure) build();
  };
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
        color: pairColors[index % pairColors.length],
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
        all.get(key)?.frac.some((v) => v < -1e-8 || v > 1 + 1e-8),
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
      const positions = [],
        edges = [];
      for (const { vertices, hull } of plan.hulls) {
        for (const face of hull.faces)
          for (const i of face)
            positions.push(...vertices[i].position.toArray());
        for (const edge of hull.edges)
          for (const i of edge) edges.push(vertices[i].position);
      }
      if (positions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.computeVertexNormals();
        model.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: plan.color,
              transparent: true,
              opacity: 0.34,
              side: THREE.DoubleSide,
              depthWrite: false,
              roughness: 0.8,
            }),
          ),
        );
        model.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(edges),
            new THREE.LineBasicMaterial({
              color: plan.color,
              transparent: true,
              opacity: 0.9,
            }),
          ),
        );
      }
    }
    atoms = [...visible.values()];
    atoms.forEach((a, i) => {
      a.id = i;
    });
    const outside = atoms.filter((a) =>
      a.frac.some((v) => v < -1e-8 || v > 1 + 1e-8),
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
      p.textContent =
        stat.error ||
        (!(stat.bonds || stat.polyhedra)
          ? "Enable Bonds or Polyhedra to inspect coordination."
          : `${stat.counts.join(", ") || "0"} neighbors per center (${stat.centerCount || 0} centers) · ${stat.polyhedronCount} polyhedra · ${stat.bondCount} bonds. ${siteCounts}`);
    }
    $("isolation-note").textContent = isolated
      ? polyhedronCount
        ? "Showing completed polyhedra, their centers, and all ligand atoms. Unconnected atoms are hidden."
        : "No complete polyhedra at these cutoffs. Adjust the cutoff, enable another pair, or turn off Polyhedra only to inspect the full structure."
      : "Full structure visible. Polyhedra only keeps completed polyhedra and their atoms.";
  }
  function orient(indices) {
    if (!structure) return;
    try {
      const { direction, up } = latticeViewDirection(structure.basis, indices);
      const target = controls.target.clone();
      const zoomDistance = camera.position.distanceTo(target);
      stopMotion();
      camera.up.set(...up);
      camera.position
        .copy(target)
        .addScaledVector(new THREE.Vector3(...direction), zoomDistance);
      controls.update();
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
    $(`view-${axis}`).onclick = () => orient(indices);
  }
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
  function reset() {
    selection = [];
    updateSelection();
    const sphere = fitBounds.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    fitDistance =
      (Math.max(sphere.radius, 1) / Math.sin(Math.min(vertical, horizontal))) *
      1.12;
    const target = sphere.center;
    const direction = new THREE.Vector3(0.68, 0.48, 0.8).normalize();
    stopMotion();
    camera.up.set(0, 1, 0);
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
    for (const a of selection) {
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(a.radius * 1.16, 24, 16),
        new THREE.MeshBasicMaterial({
          color: 0x65f3cf,
          wireframe: true,
          transparent: true,
          opacity: 0.65,
        }),
      );
      ring.position.copy(a.position);
      selectionGroup.add(ring);
    }
    distance = null;
    if (selection.length === 2) {
      distance = selection[0].position.distanceTo(selection[1].position);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          selection.map((a) => a.position),
        ),
        new THREE.LineBasicMaterial({ color: 0x79ffdc, depthTest: false }),
      );
      line.renderOrder = 5;
      selectionGroup.add(line);
    }
    const overlay = $("measure-overlay");
    overlay.hidden = selection.length === 0;
    overlay.textContent =
      distance === null
        ? `${selection[0]?.label || ""} · Select a second atom`
        : `${selection.map((a) => a.label).join(" ↔ ")}  ·  ${distance.toFixed(4)} Å`;
    $("distance").replaceChildren(
      document.createTextNode(
        distance === null ? "— " : `${distance.toFixed(4)} `,
      ),
      Object.assign(document.createElement("span"), { textContent: "Å" }),
    );
    $("selection").textContent = selection.length
      ? selection
          .map(
            (a) => `${a.label} [${a.frac.map((v) => v.toFixed(3)).join(", ")}]`,
          )
          .join(" ↔ ") +
        (selection.length === 1 ? " · Select a second atom." : "")
      : "Tap two atoms to measure their separation.";
    invalidate();
  }
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
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      const atom = hit.object.userData.atoms[hit.instanceId];
      if (selection.length === 2) selection = [];
      if (!selection.includes(atom)) selection.push(atom);
      updateSelection();
    }
  });
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
    structure = data;
    $("name").textContent = data.name || data.block || "Crystal structure";
    $("source").textContent = currentFilename || "Example structure · built in";
    $("stats").replaceChildren(
      textStat("UNIT-CELL VOLUME", `${Number(data.volume).toFixed(2)} Å³`),
      textStat("ATOMIC SITES", data.atoms.length.toLocaleString()),
    );
    const counts = new Map();
    data.atoms.forEach((a) =>
      counts.set(a.element, (counts.get(a.element) || 0) + 1),
    );
    $("element-count").textContent = counts.size;
    $("elements").replaceChildren(
      ...[...counts].map(([e, n]) => {
        const d = document.createElement("div");
        d.className = "element";
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
    resetRules();
    build(false);
    reset();
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
  $("reset").onclick = reset;
  $("cell").onchange = () => {
    if (cellLines) cellLines.visible = $("cell").checked;
    invalidate();
  };
  $("boundary").onchange = () => {
    if (structure) build();
  };
  $("size").oninput = () => {
    if (!structure) return;
    const size = Number($("size").value);
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3();
    for (const m of meshes) {
      m.userData.atoms.forEach((a, i) => {
        a.radius = (radii[a.element] || 0.42) * size;
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
          element: a.element,
          label: a.label,
          frac: [...a.frac],
          cartesian: [...a.cartesian],
          sourceIndex: a.sourceIndex,
          outsideCell: a.frac.some((v) => v < -1e-8 || v > 1 + 1e-8),
          x: rect.left + ((p.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - p.y) * rect.height) / 2,
          z: p.z,
        };
      }),
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
      block: structure?.block,
      basis: structure?.basis,
    };
  };
  const forsteriteExample =
    new URLSearchParams(location.search).get("example") === "forsterite";
  fetch(
    `${import.meta.env.BASE_URL}${forsteriteExample ? "examples/forsterite.cif" : "example.cif"}`,
  )
    .then((r) => {
      if (!r.ok) throw Error("Example unavailable");
      return r.text();
    })
    .then((text) => {
      if (!userIntent && !request)
        load(
          text,
          forsteriteExample ? "Forsterite example" : "Example structure",
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
