import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLatticeTools } from "../web/lattice-tools.js";

// Layout is exercised with real Three.js projections and plane geometry.
// The DOM supplies only label text metrics and an unobstructed canvas.
function setup(t) {
  class Element {
    children = [];
    dataset = {};
    style = { setProperty() {} };
    hidden = true;
    value = "";
    selectionStart = 0;
    selectionEnd = 0;
    append(...children) { this.children.push(...children); }
    prepend(child) { this.children.unshift(child); }
    replaceChildren(...children) { this.children = children; }
    get childElementCount() { return this.children.length; }
    setAttribute() {}
    addEventListener() {}
    querySelector(selector) {
      return this.children.find((c) => c.className === selector.split(".").at(-1)) ?? null;
    }
    getContext() { return { measureText: (text) => ({ width: text.length * 5 }) }; }
  }
  const nodes = new Map();
  const document = {
    documentElement: { dataset: { theme: "light" } },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new Element());
      return nodes.get(id);
    },
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    createDocumentFragment: () => new Element(),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const oldDocument = globalThis.document;
  const oldComputedStyle = globalThis.getComputedStyle;
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ fontFamily: "sans-serif" });
  t.after(() => {
    tools.reset();
    globalThis.document = oldDocument;
    globalThis.getComputedStyle = oldComputedStyle;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const bounds = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
  let redraws = 0;
  const tools = createLatticeTools({
    THREE,
    scene: new THREE.Scene(),
    invalidate: () => { redraws++; },
    getStructure: () => ({ basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }),
    getRanges: () => [[0, 1], [0, 1], [0, 1]],
    toScene: (f) => new THREE.Vector3(...f).subScalar(.5),
    getSceneBounds: () => bounds,
  });
  const settings = { planes: [{ id: 1, hkl: [1, 0, 0], m: 0, family: true }] };
  tools.restoreState(settings);
  const camera = new THREE.OrthographicCamera(-1.2, 1.2, .8, -.8, .01, 100);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }) };
  function draw(theta, phi) {
    if (theta !== undefined) {
      camera.position.set(4 * Math.sin(theta) * Math.cos(phi), 4 * Math.sin(phi), 4 * Math.cos(theta) * Math.cos(phi));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }
    tools.updateLabels(camera, canvas);
    return tools.diagnostics().labels;
  }
  return { tools, settings, draw, redraws: () => redraws };
}

// Four view changes that previously left both labels suppressed indefinitely.
const rotations = [
  [0.38073829420391553, -0.20339884099986572],
  [5.100286936108675, 1.1220549881695088],
  [4.146534758673641, -0.3753229449574541],
  [0.829091127430494, 1.0933575675998963],
];

test("parallel-plane labels recover after rotations stop without a view-direction click", (t) => {
  const { draw, redraws } = setup(t);
  for (const angles of rotations) draw(...angles);
  const suppressed = draw();
  assert.ok(suppressed.stability.culled.length > 0, "exercise the temporary anti-oscillation suppression");
  const before = redraws();
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before + 1, "idle recovery must request its own redraw");
  const recovered = draw();
  assert.equal(recovered.shown.length, 2);
  assert.deepEqual(recovered.stability.culled, []);
  const ranks = recovered.placed.map((p) => p.rank);
  const settled = draw();
  assert.deepEqual(settled.placed.map((p) => p.rank), ranks);
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before + 1, "a settled layout must not keep redrawing");
});

test("continued movement postpones recovery until the last rendered change", (t) => {
  const { draw, redraws } = setup(t);
  for (const angles of rotations) draw(...angles);
  const before = redraws();
  t.mock.timers.tick(120);
  draw();
  t.mock.timers.tick(120);
  assert.equal(redraws(), before);
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before + 1);
});

test("a remembered position cannot hide a family label with a usable alternative", (t) => {
  const { draw } = setup(t);
  for (const angles of [
    [4.361633625239106, 0.8363069446702457],
    [0.38073829420391553, -0.20339884099986572],
    [4.786980877928055, 0.49835625341373824],
    [4.398423484084398, -1.2190206342727372],
  ]) draw(...angles);
  const labels = draw();
  assert.deepEqual(labels.stability.culled, []);
  assert.equal(labels.shown.length, 2);
});

test("reset cancels recovery for the previous structure", (t) => {
  const { tools, draw, redraws } = setup(t);
  for (const angles of rotations) draw(...angles);
  tools.reset();
  const before = redraws();
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before);
});

test("exports have no delayed recovery and preserve live placement history", (t) => {
  const { tools, draw, redraws } = setup(t);
  for (const angles of rotations) draw(...angles);
  const live = tools.diagnostics().labels;
  tools.setExportMode(true);
  const first = draw();
  for (const angles of rotations) draw(...angles);
  const before = redraws();
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before);
  tools.setExportMode(false);
  assert.deepEqual(tools.diagnostics().labels.placed, live.placed);
  assert.deepEqual(tools.diagnostics().labels.stability.culled, live.stability.culled);
  assert.equal(first.shown.length, 2);
  draw();
  t.mock.timers.tick(1000);
  assert.equal(redraws(), before + 1);
  assert.equal(draw().shown.length, 2);
});
