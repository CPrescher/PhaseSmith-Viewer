import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFaceSorter } from "../web/face-sort.js";

// A rule mesh like main.js builds: non-indexed triangles, flat normals,
// RGB vertex colours, opacity on the material.
function ruleMesh(zs, color, opacity) {
  const positions = [],
    colors = [];
  for (const z of zs) {
    positions.push(-1, -1, z, 1, -1, z, 0, 1, z);
    for (let i = 0; i < 3; i++) colors.push(...color);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true }));
  mesh.visible = opacity > 0;
  mesh.material.opacity = opacity;
  mesh.material.transparent = opacity < 1;
  return mesh;
}

function camera(z) {
  const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

// Alpha (and z) of the drawn triangles, in draw order.
function drawOrder(sorter) {
  const g = sorter.mesh.geometry,
    index = g.index.array,
    pos = g.attributes.position.array,
    col = g.attributes.color.array;
  const out = [];
  for (let i = 0; i < index.length; i += 3) {
    const v = index[i];
    out.push({ z: pos[v * 3 + 2], red: col[v * 4], alpha: col[v * 4 + 3] });
  }
  return out;
}

test("translucent faces of different pairs interleave back to front", () => {
  // Rule A at z = 0, 2, 4 and rule B at z = 1, 3 (built in A, B order).
  const a = ruleMesh([0, 2, 4], [1, 0, 0], 0.34);
  const b = ruleMesh([1, 3], [0, 0, 1], 0.5);
  const sorter = createFaceSorter(THREE);
  sorter.sync([a, b], camera(10));
  assert.equal(sorter.mesh.visible, true);
  assert.equal(sorter.material.forceSinglePass, true);
  assert.equal(sorter.material.depthWrite, false);
  let order = drawOrder(sorter);
  assert.deepEqual(order.map((t) => t.z), [0, 1, 2, 3, 4]);
  // Colours and per-pair alpha follow each triangle.
  assert.deepEqual(order.map((t) => t.red), [1, 0, 1, 0, 1]);
  assert.deepEqual(order.map((t) => Math.round(t.alpha * 100)), [34, 50, 34, 50, 34]);
  assert.equal(sorter.diagnostics().backToFront, true);

  // Opposite view: reversed order. Reversed rule order: same result.
  sorter.sync([a, b], camera(-10));
  order = drawOrder(sorter);
  assert.deepEqual(order.map((t) => t.z), [4, 3, 2, 1, 0]);
  const swapped = createFaceSorter(THREE);
  swapped.sync([b, a], camera(10));
  assert.deepEqual(drawOrder(swapped).map((t) => t.z), [0, 1, 2, 3, 4]);
});

test("rule meshes stay pickable on a hidden layer; opaque and 0% are excluded", () => {
  const a = ruleMesh([0], [1, 0, 0], 0.34);
  const opaque = ruleMesh([1], [0, 1, 0], 1);
  const off = ruleMesh([2], [0, 0, 1], 0);
  const sorter = createFaceSorter(THREE);
  sorter.sync([a, opaque, off], camera(10));
  assert.equal(drawOrder(sorter).length, 1);
  const cam = camera(10);
  assert.equal(a.layers.test(cam.layers), false, "translucent rule mesh is not drawn itself");
  assert.equal(opaque.layers.test(cam.layers), true, "opaque rule mesh draws itself with depth writes");
  const raycaster = new THREE.Raycaster();
  sorter.enablePicking(raycaster);
  raycaster.set(new THREE.Vector3(0, -0.2, 10), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObjects([a, opaque], false);
  assert.equal(hits.length, 2, "both faces still pick, with their faceIndex");
  assert.equal(hits[1].object, a);
  assert.equal(hits[1].faceIndex, 0);
});

test("opacity changes update alpha in place; crossing 100% moves a pair out", () => {
  const a = ruleMesh([0, 2], [1, 0, 0], 0.34);
  const b = ruleMesh([1], [0, 0, 1], 0.5);
  const sorter = createFaceSorter(THREE);
  sorter.sync([a, b], camera(10));
  const geometry = sorter.mesh.geometry;
  a.material.opacity = 0.8;
  sorter.sync([a, b], camera(10));
  assert.equal(sorter.mesh.geometry, geometry, "no rebuild for an alpha change");
  assert.deepEqual(drawOrder(sorter).map((t) => Math.round(t.alpha * 100)), [80, 50, 80]);
  a.material.opacity = 1;
  sorter.sync([a, b], camera(10));
  assert.deepEqual(drawOrder(sorter).map((t) => t.z), [1]);
  b.visible = false;
  sorter.sync([a, b], camera(10));
  assert.equal(sorter.mesh.visible, false);
});
