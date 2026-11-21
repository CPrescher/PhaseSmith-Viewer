import test from "node:test";
import assert from "node:assert/strict";
import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { ViewControls } from "../web/view-controls.js";

function setup() {
  const camera = new PerspectiveCamera(40, 4 / 3, 0.1, 1000);
  camera.position.set(3, -2, 20);
  const controls = new ViewControls(camera, null);
  controls.screen = { left: 10, top: 20, width: 800, height: 600 };
  controls.target.set(3, -2, 0);
  controls.rotateSpeed = 2.2;
  controls.update();
  return { camera, controls };
}

const finger = (pointerId, pageX, pageY) => ({ pointerId, pageX, pageY });
function start(controls, event) {
  controls._addPointer(event);
  controls._onTouchStart(event);
}
function end(controls, event) {
  // Three invokes the touch-end hook before removing the released pointer.
  controls._onTouchEnd(event);
  controls._removePointer(event);
}
function close(actual, expected) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-10, `${actual} != ${expected}`));
}

// Match the viewer's parallel projection using its logical camera's zoom.
function project(controls, point) {
  const camera = controls.object;
  const halfHeight = camera.position.distanceTo(controls.target) * Math.tan(MathUtils.degToRad(camera.fov / 2));
  const view = new OrthographicCamera(-halfHeight * camera.aspect, halfHeight * camera.aspect, halfHeight, -halfHeight, 0.1, 1000);
  view.position.copy(camera.position);
  view.quaternion.copy(camera.quaternion);
  view.updateMatrixWorld();
  const p = new Vector3(...point).project(view);
  return [controls.screen.left + (p.x + 1) * controls.screen.width / 2,
    controls.screen.top + (1 - p.y) * controls.screen.height / 2];
}

const samplePoints = [[3, -2, 0], [-2, 1, -3], [6, 4, 2], [0, -4, 5]];

test("two-finger twist rotates every projected point around the stationary finger", () => {
  for (const fixedId of [1, 2]) {
    const { camera, controls } = setup();
    const movingId = fixedId === 1 ? 2 : 1;
    const pivot = [320, 290], radius = 120;
    start(controls, finger(fixedId, ...pivot));
    start(controls, finger(movingId, pivot[0] + radius, pivot[1]));
    const before = samplePoints.map((p) => project(controls, p));
    const distance = camera.position.distanceTo(controls.target);
    const eye = camera.position.clone().sub(controls.target).normalize().toArray();
    // Includes both directions and crossing atan2's -pi/pi boundary.
    for (const angle of [0.3, 1, 2, 3, 3.5, 4.2, 3.8, 3, 2, 1, 0, -1]) {
      controls._onTouchMove(finger(movingId, pivot[0] + radius * Math.cos(angle), pivot[1] + radius * Math.sin(angle)));
      controls.update();
      for (let i = 0; i < samplePoints.length; i++) {
        const [x, y] = before[i].map((v, j) => v - pivot[j]);
        close(project(controls, samplePoints[i]), [pivot[0] + x * Math.cos(angle) - y * Math.sin(angle),
          pivot[1] + x * Math.sin(angle) + y * Math.cos(angle)]);
      }
      assert.ok(Math.abs(camera.position.distanceTo(controls.target) - distance) < 1e-10);
      close(camera.position.clone().sub(controls.target).normalize().toArray(), eye);
    }
    const position = camera.position.toArray(), up = camera.up.toArray();
    for (let i = 0; i < 10; i++) controls.update();
    close(camera.position.toArray(), position);
    close(camera.up.toArray(), up);
  }
});

test("twist combines with pan and pinch and consumes its last sample on release", () => {
  const { controls } = setup();
  const center = [360, 300], gap = 70;
  start(controls, finger(1, center[0] - gap, center[1]));
  start(controls, finger(2, center[0] + gap, center[1]));
  const before = samplePoints.map((p) => project(controls, p));
  const angle = -0.7, scale = 1.4, offset = [25, -30];
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const [id, direction] of [[1, -1], [2, 1]])
    controls._onTouchMove(finger(id, center[0] + offset[0] + direction * gap * scale * c,
      center[1] + offset[1] + direction * gap * scale * s));
  // No intervening frame; release must apply the entire pending transform.
  end(controls, finger(2, center[0] + offset[0] + gap * scale * c, center[1] + offset[1] + gap * scale * s));
  for (let i = 0; i < samplePoints.length; i++) {
    const [x, y] = before[i].map((v, j) => v - center[j]);
    close(project(controls, samplePoints[i]), [center[0] + offset[0] + scale * (c * x - s * y),
      center[1] + offset[1] + scale * (s * x + c * y)]);
  }
  const held = samplePoints.map((p) => project(controls, p));
  controls.update();
  samplePoints.forEach((p, i) => close(project(controls, p), held[i]));
});

test("one finger matches left-mouse rotation without changing pivot or zoom", () => {
  const touch = setup(), mouse = setup();
  const first = finger(1, 350, 280);
  start(touch.controls, first);
  mouse.controls._onMouseDown({ ...first, button: 0 });
  const center = project(touch.controls, [0, 0, 0]);
  const distance = touch.camera.position.distanceTo(touch.controls.target);
  for (const [x, y] of [[365, 285], [390, 300], [380, 320], [340, 305]]) {
    const event = finger(1, x, y);
    touch.controls._onTouchMove(event);
    mouse.controls._onMouseMove(event);
    touch.controls.update();
    mouse.controls.update();
    close(touch.camera.position.toArray(), mouse.camera.position.toArray());
    close(touch.camera.up.toArray(), mouse.camera.up.toArray());
    close(project(touch.controls, [0, 0, 0]), center);
    assert.ok(Math.abs(touch.camera.position.distanceTo(touch.controls.target) - distance) < 1e-10);
  }
});

test("lifting one finger exits pinch and consumes its last movement before rotating", () => {
  for (const released of [1, 2]) {
    const { camera, controls } = setup();
    start(controls, finger(1, 300, 280));
    start(controls, finger(2, 400, 280));
    controls._onTouchMove(finger(1, 315, 300));
    controls._onTouchMove(finger(2, 435, 300));
    // Release before the next animation frame, so the last pinch is pending.
    end(controls, finger(released, released === 1 ? 315 : 435, 300));
    const before = camera.position.toArray();
    const center = project(controls, [0, 0, 0]);
    const distance = camera.position.distanceTo(controls.target);
    controls.update();
    close(camera.position.toArray(), before);
    const remaining = released === 1 ? 2 : 1;
    const x = remaining === 1 ? 315 : 435;
    // A stationary surviving finger must not cause a jump.
    controls._onTouchMove(finger(remaining, x, 300));
    controls.update();
    close(camera.position.toArray(), before);
    controls._onTouchMove(finger(remaining, x + 20, 310));
    controls.update();
    assert.notDeepEqual(camera.position.toArray(), before);
    close(project(controls, [0, 0, 0]), center);
    assert.ok(Math.abs(camera.position.distanceTo(controls.target) - distance) < 1e-10);
    assert.equal(controls.state, 3, "remaining finger must be in rotation mode");
    end(controls, finger(remaining, x + 20, 310));
    assert.equal(controls.state, -1, "no fingers must leave no active gesture");
  }
});

test("releasing a quick single-finger drag preserves its final rotation sample", () => {
  const touch = setup(), mouse = setup();
  const first = finger(1, 350, 280), last = finger(1, 390, 300);
  start(touch.controls, first);
  mouse.controls._onMouseDown({ ...first, button: 0 });
  touch.controls._onTouchMove(last);
  mouse.controls._onMouseMove(last);
  end(touch.controls, last);
  mouse.controls._onMouseUp();
  mouse.controls.update();
  close(touch.camera.position.toArray(), mouse.camera.position.toArray());
  close(touch.camera.up.toArray(), mouse.camera.up.toArray());
});
