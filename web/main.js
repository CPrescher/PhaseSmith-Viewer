import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./style.css";
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
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 0.5;
  controls.maxDistance = 1000;
  controls.screenSpacePanning = true;
  scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x324353, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 8, 10);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0x99baff, 1.4);
  fill.position.set(-6, -2, -5);
  scene.add(fill);
  let model = new THREE.Group();
  scene.add(model);
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
    modelCenter = new THREE.Vector3(),
    distance = null;
  scene.add(selectionGroup);
  function render() {
    frame = 0;
    const moving = controls.update();
    renderer.render(scene, camera);
    if (moving) invalidate();
  }
  function invalidate() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  controls.addEventListener("change", invalidate);
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setSize(width, height);
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
  function build() {
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
    invalidate();
  }
  function reset() {
    selection = [];
    updateSelection();
    camera.position.set(
      fitDistance * 0.68,
      fitDistance * 0.48,
      fitDistance * 0.8,
    );
    controls.target.set(0, 0, 0);
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
    raycaster.setFromCamera(pointer, camera);
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
    build();
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
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      atoms: atoms.map((a) => {
        const p = a.position.clone().project(camera);
        return {
          id: a.id,
          element: a.element,
          label: a.label,
          frac: [...a.frac],
          cartesian: [...a.cartesian],
          x: rect.left + ((p.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - p.y) * rect.height) / 2,
          z: p.z,
        };
      }),
      selectedIds: selection.map((a) => a.id),
      distance,
      camera: {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
      },
      block: structure?.block,
      basis: structure?.basis,
    };
  };
  fetch(`${import.meta.env.BASE_URL}example.cif`)
    .then((r) => {
      if (!r.ok) throw Error("Example unavailable");
      return r.text();
    })
    .then((text) => {
      if (!userIntent && !request) load(text, "Example structure");
    })
    .catch(() => {
      if (userIntent || request || structure) return;
      $("loading").hidden = true;
      $("name").textContent = "Your next crystal";
      $("source").textContent = "Open a CIF file to begin.";
    });
}
initialize();
