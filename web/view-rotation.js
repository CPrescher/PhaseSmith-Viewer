// Discrete crystal turns in the current screen frame. Camera orbit and up
// rotate together; the pivot, zoom distance and scientific coordinates stay put.
import { Vector3, Quaternion, MathUtils } from "three";

const DIRECTIONS = {
  left: [-1, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
  "up-left": [-1, 1, 0],
  "up-right": [1, 1, 0],
  "down-left": [-1, -1, 0],
  "down-right": [1, -1, 0],
  clockwise: [0, 0, 1],
  counterclockwise: [0, 0, -1],
};

/** Array inputs/outputs. Actions describe the crystal's apparent motion,
 * not the camera's. A diagonal turn uses one normalized screen-diagonal
 * axis, so its true rotation angle is exactly the selected angle. */
export function rotatedView(position, up, target, action, degrees) {
  if (!DIRECTIONS[action]) throw Error("Choose a rotation direction.");
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 360)
    throw Error("Enter a rotation angle greater than 0 and at most 360°.");
  for (const v of [position, up, target])
    if (v.length !== 3 || v.some((x) => !Number.isFinite(x)))
      throw Error("Invalid view coordinates.");
  const viewTarget = new Vector3(...target),
    eye = new Vector3(...position).sub(viewTarget);
  if (eye.lengthSq() < 1e-24)
    throw Error("The view needs a nonzero zoom distance.");
  const backward = eye.clone().normalize();
  const right = new Vector3(...up).cross(backward);
  if (right.lengthSq() < 1e-24)
    throw Error(
      "The view needs an up direction perpendicular to its line of sight.",
    );
  right.normalize();
  const screenUp = backward.clone().cross(right).normalize();
  const [dx, dy, roll] = DIRECTIONS[action];
  const axis = right
    .multiplyScalar(dy)
    .addScaledVector(screenUp, -dx)
    .addScaledVector(backward, roll)
    .normalize();
  const turn = new Quaternion().setFromAxisAngle(
    axis,
    MathUtils.degToRad(degrees),
  );
  return {
    position: new Vector3(...position).applyQuaternion(turn).toArray(),
    target: viewTarget.applyQuaternion(turn).toArray(),
    up: screenUp.applyQuaternion(turn).normalize().toArray(),
  };
}
