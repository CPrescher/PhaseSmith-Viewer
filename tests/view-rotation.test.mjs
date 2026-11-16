import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3, MathUtils } from "three";
import { rotatedView } from "../web/view-rotation.js";
const close = (a, b) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} ≠ ${b}`));
const start = { position: [0, 0, 10], up: [0, 1, 0] },
  origin = [0, 0, 0];

test("screen-relative buttons turn the crystal in the named direction", () => {
  for (const [action, position, up] of [
    ["right", [-10, 0, 0], [0, 1, 0]],
    ["left", [10, 0, 0], [0, 1, 0]],
    ["up", [0, -10, 0], [0, 0, 1]],
    ["down", [0, 10, 0], [0, 0, -1]],
    ["clockwise", [0, 0, 10], [-1, 0, 0]],
    ["counterclockwise", [0, 0, 10], [1, 0, 0]],
  ]) {
    const next = rotatedView(start.position, start.up, origin, action, 90);
    close(next.position, position);
    close(next.up, up);
  }
});

test("diagonal turns use exactly the selected angle and retain pivot/zoom", () => {
  const pivot = [-4, 3, 7],
    position = [-4, 3, 17];
  for (const angle of [45, 60, 90, 37.5]) {
    const next = rotatedView(position, start.up, pivot, "up-right", angle);
    const eye = new Vector3(...next.position).sub(new Vector3(...pivot));
    assert.ok(Math.abs(eye.length() - 10) < 1e-10);
    assert.ok(
      Math.abs(MathUtils.radToDeg(eye.angleTo(new Vector3(0, 0, 10))) - angle) <
        1e-9,
    );
    close(next.position.slice(0, 2), [
      pivot[0] - (10 * Math.sin(MathUtils.degToRad(angle))) / Math.sqrt(2),
      pivot[1] - (10 * Math.sin(MathUtils.degToRad(angle))) / Math.sqrt(2),
    ]);
    assert.ok(Math.abs(eye.dot(new Vector3(...next.up))) < 1e-10);
  }
  close(position, [-4, 3, 17]);
  close(pivot, [-4, 3, 7]);
});

test("inverse turns and complete revolutions preserve arbitrary tilted views", () => {
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(1, 2, 3).normalize(),
    0.7,
  );
  const pivot = [3, -2, 5],
    position = new Vector3(0, 0, 14)
      .applyQuaternion(q)
      .add(new Vector3(...pivot))
      .toArray();
  const up = new Vector3(0, 1, 0).applyQuaternion(q).toArray();
  for (const [forward, backward] of [
    ["right", "left"],
    ["up", "down"],
    ["up-right", "down-left"],
    ["up-left", "down-right"],
    ["clockwise", "counterclockwise"],
  ]) {
    const first = rotatedView(position, up, pivot, forward, 37.5),
      second = rotatedView(first.position, first.up, pivot, backward, 37.5);
    close(second.position, position);
    close(second.up, up);
    for (const angle of [45, 60, 90]) {
      let current = { position, up };
      for (let i = 0; i < 360 / angle; i++)
        current = rotatedView(
          current.position,
          current.up,
          pivot,
          forward,
          angle,
        );
      close(current.position, position);
      close(current.up, up);
    }
  }
});

test("invalid angles and degenerate views fail without changing inputs", () => {
  for (const angle of [0, -1, 361, NaN, Infinity])
    assert.throws(() =>
      rotatedView(start.position, start.up, origin, "right", angle),
    );
  assert.throws(() =>
    rotatedView(start.position, start.up, origin, "unknown", 90),
  );
  assert.throws(() => rotatedView(origin, start.up, origin, "right", 90));
  assert.throws(() =>
    rotatedView(start.position, [0, 0, 1], origin, "right", 90),
  );
  close(start.position, [0, 0, 10]);
  close(start.up, [0, 1, 0]);
});
