import { MathUtils, Vector3 } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";

const right = new Vector3(), up = new Vector3(), shift = new Vector3(), rollAxis = new Vector3();
// Three's internal gesture states, also used by its zoom implementation.
const NONE = -1, TOUCH_ROTATE = 3, TOUCH_ZOOM_PAN = 4;

// Trackball rotation with grab/pinch motion matched to the viewer's parallel
// projection. Keep the adapter to Three's pan/zoom sample hooks here: its
// default perspective pan uses a speed multiplier and accumulates damping,
// rather than converting the gesture's CSS pixels to the rendered view size.
export class ViewControls extends TrackballControls {
  constructor(camera, element) {
    super(camera, element);
    const touchStart = this._onTouchStart;
    this._onTouchStart = (event) => {
      touchStart(event);
      this._rebaseTouch(this._pointers);
    };
    const touchMove = this._onTouchMove;
    this._onTouchMove = (event) => {
      touchMove(event);
      if (this._pointers.length < 2) return;
      const angle = this._fingerAngle(this._pointers);
      // Accumulate each sample across atan2's branch cut, even when several
      // pointer moves arrive before the next rendered frame.
      const delta = angle - this._touchAngle;
      this._touchRoll += Math.atan2(Math.sin(delta), Math.cos(delta));
      this._touchAngle = angle;
    };
    this._onTouchEnd = (event) => {
      // Consume the last rotation/pinch before rebasing. Three calls this
      // hook BEFORE removing the released finger from its pointer list.
      this.update();
      this._rebaseTouch(this._pointers.filter((p) => p.pointerId !== event.pointerId));
      this.dispatchEvent({ type: "end" });
    };
  }

  _rebaseTouch(pointers) {
    // A rotation must never inherit pan or zoom samples from a prior gesture.
    this._panStart.copy(this._panEnd);
    this._zoomStart.copy(this._zoomEnd);
    this._touchRoll = 0;
    this.state = pointers.length > 1 ? TOUCH_ZOOM_PAN : pointers.length ? TOUCH_ROTATE : NONE;
    if (!pointers.length) return;
    const a = this._pointerPositions[pointers[0].pointerId];
    if (pointers.length === 1) {
      // Use the surviving finger's CURRENT position, not its pointer-down
      // position or the lifted finger, so rotation starts without a jump.
      this._moveCurr.copy(this._getMouseOnCircle(a.x, a.y));
      this._movePrev.copy(this._moveCurr);
    } else {
      // Adding a second finger grabs the view; old rotation must stop.
      this._lastAngle = 0;
      this._movePrev.copy(this._moveCurr);
      const b = this._pointerPositions[pointers[1].pointerId];
      this._touchAngle = this._fingerAngle(pointers);
      this._touchZoomDistanceStart = this._touchZoomDistanceEnd = a.distanceTo(b);
      this._panStart.copy(this._getMouseOnScreen((a.x + b.x) / 2, (a.y + b.y) / 2));
      this._panEnd.copy(this._panStart);
    }
  }

  _fingerAngle(pointers) {
    const a = this._pointerPositions[pointers[0].pointerId];
    const b = this._pointerPositions[pointers[1].pointerId];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  _viewAxes() {
    // Use eye/up directly: rotation may have changed them during this update,
    // before TrackballControls updates the camera's matrix with lookAt().
    right.crossVectors(this.object.up, this._eye).normalize();
    up.crossVectors(this._eye, right).normalize();
  }

  _rotateCamera() {
    const dragging = !this._moveCurr.equals(this._movePrev);
    super._rotateCamera();
    // The crystal is centered at the scene origin. Rotate the panned camera
    // target around it by the same step Three just applied to the eye and up.
    // This preserves the crystal center in screen coordinates during damping too.
    if (this._lastAngle && (dragging || !this.staticMoving))
      this.target.applyAxisAngle(this._lastAxis, this._lastAngle);
  }

  _panCamera() {
    const dx = this._panEnd.x - this._panStart.x;
    const dy = this._panEnd.y - this._panStart.y;
    if (!dx && !dy) return;
    const halfHeight = this._eye.length() * Math.tan(MathUtils.degToRad(this.object.fov / 2));
    this._viewAxes();
    shift.copy(right).multiplyScalar(-dx * 2 * halfHeight * this.object.aspect)
      .addScaledVector(up, dy * 2 * halfHeight);
    this.object.position.add(shift);
    this.target.add(shift);
    // Pan has no inertia; a held or released gesture stays at its last pixel.
    this._panStart.copy(this._panEnd);
  }

  _zoomCamera() {
    // Touch release consumes a pending pinch before switching gesture state.
    if (this.state !== TOUCH_ZOOM_PAN) return super._zoomCamera();
    const start = this._touchZoomDistanceStart, end = this._touchZoomDistanceEnd;
    this._touchZoomDistanceStart = end;
    if (!(start > 0 && end > 0)) return;
    const distance = this._eye.length();
    const next = MathUtils.clamp(distance * start / end, this.minDistance, this.maxDistance);
    const factor = next / distance;
    const halfHeight = distance * Math.tan(MathUtils.degToRad(this.object.fov / 2));
    this._viewAxes();
    // Keep the world point under the previous midpoint anchored through both
    // zoom and roll. Pan then carries it to the new midpoint. Together these
    // map BOTH old finger positions to their new positions, so a stationary
    // finger is the exact pivot when the other finger circles around it.
    shift.copy(right).multiplyScalar((2 * this._panStart.x - 1) * halfHeight * this.object.aspect)
      .addScaledVector(up, (1 - 2 * this._panStart.y) * halfHeight);
    this.object.up.applyAxisAngle(rollAxis.copy(this._eye).normalize(), this._touchRoll);
    this._touchRoll = 0;
    this._viewAxes();
    shift.addScaledVector(right, -(2 * this._panStart.x - 1) * halfHeight * this.object.aspect * factor)
      .addScaledVector(up, -(1 - 2 * this._panStart.y) * halfHeight * factor);
    this.target.add(shift);
    this._eye.multiplyScalar(factor);
  }
}
