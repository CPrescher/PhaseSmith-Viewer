import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { sceneExportBounds, exportFrame } from "../web/export-framing.js";

const viewport = { width: 1200, height: 800 };
const camera = () => {
  const c = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.01, 1000);
  c.position.set(0, 0, 30);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("crop follows drawn instances and excludes hidden geometry", () => {
  const scene = new THREE.Scene();
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial(), 3);
  atoms.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0, 0));
  atoms.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
  atoms.setMatrixAt(2, new THREE.Matrix4().makeTranslation(200, 0, 0));
  atoms.count = 2;
  scene.add(atoms);
  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), new THREE.MeshBasicMaterial()));
  scene.add(hidden);
  const bounds = sceneExportBounds(scene, camera(), viewport);
  close(bounds.x, 450);
  close(bounds.y, 350);
  close(bounds.width, 300);
  close(bounds.height, 100);
  const frame = exportFrame(bounds, viewport);
  assert.ok(frame.width < 450 && frame.height < 150, JSON.stringify(frame));
  // Room to the right of the geometry is reserved for the 72px compass.
  assert.ok(frame.x + frame.width - bounds.x - bounds.width >= 108);
  atoms.visible = false;
  assert.equal(sceneExportBounds(scene, camera(), viewport), null);
  const empty = exportFrame(null, viewport);
  assert.ok(Number.isFinite(empty.width) && empty.width >= 96);
});

test("turntable envelope contains every angle of a tilted, off-center scene", () => {
  const scene = new THREE.Scene();
  const points = [new THREE.Vector3(-3, -2, 1), new THREE.Vector3(5, 3, -7), new THREE.Vector3(1, -1, 2)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial());
  line.position.set(1, 2, -1);
  scene.add(line);
  const c = camera();
  const target = new THREE.Vector3(2, -1, 3);
  const axis = new THREE.Vector3(0.4, 0.8, -0.2).normalize();
  c.up.copy(axis);
  c.position.set(13, 8, 20);
  c.lookAt(target);
  const offset = c.position.clone().sub(target);
  const before = c.position.clone();
  const envelope = sceneExportBounds(scene, c, { ...viewport, target, axis });
  assert.deepEqual(c.position, before);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let step = 0; step < 1440; step++) {
    c.position.copy(target).add(offset.clone().applyAxisAngle(axis, step * Math.PI / 720));
    c.lookAt(target);
    const bounds = sceneExportBounds(scene, c, viewport);
    assert.ok(bounds.x >= envelope.x - 1e-7);
    assert.ok(bounds.y >= envelope.y - 1e-7);
    assert.ok(bounds.x + bounds.width <= envelope.x + envelope.width + 1e-7);
    assert.ok(bounds.y + bounds.height <= envelope.y + envelope.height + 1e-7);
    minX = Math.min(minX, bounds.x); maxX = Math.max(maxX, bounds.x + bounds.width);
    minY = Math.min(minY, bounds.y); maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  assert.ok(minX - envelope.x < 0.01 && envelope.x + envelope.width - maxX < 0.01);
  assert.ok(minY - envelope.y < 0.01 && envelope.y + envelope.height - maxY < 0.01);
});

test("movie framing retains geometry beyond the live viewport and separates overlays", () => {
  const bounds = { x: -100, y: -50, width: 1400, height: 900 };
  const frame = exportFrame(bounds, viewport, { clip: false, overlayWidth: 250, overlayHeight: 150 });
  assert.ok(frame.x < bounds.x && frame.y < bounds.y);
  assert.ok(frame.x + frame.width >= bounds.x + bounds.width + 274);
  assert.ok(frame.y + frame.height > bounds.y + bounds.height);
  const thin = exportFrame({ x: 590, y: 390, width: 20, height: 20 }, viewport,
    { overlayWidth: 250, overlayHeight: 150 });
  assert.ok(thin.height >= 258); // card and compass cannot overlap
});
