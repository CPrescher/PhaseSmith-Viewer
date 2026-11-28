import * as THREE from "three";

/** Screen bounds of drawn geometry in CSS pixels. For a turntable, find
 * the analytic extrema over the entire revolution so the frame never pumps
 * or misses an orientation between sampled frames. The live camera is unchanged.
 */
export function sceneExportBounds(scene, camera, { width, height, target, axis } = {}) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const sx = width / (camera.right - camera.left) * camera.zoom;
  const sy = height / (camera.top - camera.bottom) * camera.zoom;
  const pivot = target?.clone().project(camera);
  const turnAxis = axis?.clone().normalize();
  const point = new THREE.Vector3(), offset = new THREE.Vector3(), cross = new THREE.Vector3();
  const instance = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const extend = (x, y, rx = 0, ry = rx) => {
    x1 = Math.min(x1, x - rx);
    y1 = Math.min(y1, y - ry);
    x2 = Math.max(x2, x + rx);
    y2 = Math.max(y2, y + ry);
  };
  const add = (world, radius = 0) => {
    if (!turnAxis) {
      point.copy(world).project(camera);
      extend((point.x + 1) * width / 2, (1 - point.y) * height / 2, radius * sx, radius * sy);
      return;
    }
    offset.copy(world).sub(target);
    const range = (basis) => {
      const center = offset.dot(turnAxis) * basis.dot(turnAxis);
      const amplitude = Math.hypot(offset.dot(basis) - center, offset.dot(cross.crossVectors(turnAxis, basis)));
      return { center, amplitude: amplitude + radius };
    };
    const horizontal = range(right), vertical = range(up);
    extend(
      (pivot.x + 1) * width / 2 + horizontal.center * sx,
      (1 - pivot.y) * height / 2 - vertical.center * sy,
      horizontal.amplitude * sx,
      vertical.amplitude * sy,
    );
  };
  const world = new THREE.Vector3();
  scene.traverseVisible((object) => {
    const geometry = object.geometry;
    if (!geometry?.attributes.position || object.material?.visible === false || object.material?.opacity === 0) return;
    const draw = (transform, boxed) => {
      // Exact sphere extents avoid the extra room of a rotated 3D box.
      if (geometry.type === "SphereGeometry") {
        world.set(0, 0, 0).applyMatrix4(transform);
        add(world, geometry.parameters.radius * transform.getMaxScaleOnAxis());
      } else if (geometry.isLineSegmentsGeometry) {
        // Screen-space lines store segment ends as instance attributes; the
        // position attribute is only the shared unit quad.
        for (const name of ["instanceStart", "instanceEnd"]) {
          const ends = geometry.attributes[name];
          for (let i = 0; ends && i < ends.count; i++) add(world.fromBufferAttribute(ends, i).applyMatrix4(transform));
        }
      } else if (boxed) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        for (let i = 0; i < 8; i++) {
          world.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          add(world.applyMatrix4(transform));
        }
      } else {
        const positions = geometry.attributes.position;
        const end = Math.min(geometry.index?.count ?? positions.count, geometry.drawRange.start + geometry.drawRange.count);
        for (let i = geometry.drawRange.start; i < end; i++) {
          const index = geometry.index ? geometry.index.getX(i) : i;
          world.fromBufferAttribute(positions, index).applyMatrix4(transform);
          add(world);
        }
      }
    };
    if (object.isInstancedMesh) {
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance);
        draw(matrix.multiplyMatrices(object.matrixWorld, instance), true);
      }
    } else draw(object.matrixWorld, false);
  });
  return Number.isFinite(x1) ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
}

/** Crop the visible part of the scene, with a small margin and a separate
 * right-hand strip for the compass and (when present) measurement card. */
export function exportFrame(bounds, viewport, { labelMargin = 0, overlayWidth = 0, overlayHeight = 0, compass = true, clip = true } = {}) {
  const mx = typeof labelMargin === "number" ? labelMargin : labelMargin.x;
  const my = typeof labelMargin === "number" ? labelMargin : labelMargin.y;
  const clamp = (v, max) => clip ? Math.max(0, Math.min(max, v)) : v;
  const x1 = clamp((bounds?.x ?? viewport.width / 2) - mx, viewport.width);
  const y1 = clamp((bounds?.y ?? viewport.height / 2) - my, viewport.height);
  const x2 = Math.max(x1, clamp((bounds ? bounds.x + bounds.width : x1) + mx, viewport.width));
  const y2 = Math.max(y1, clamp((bounds ? bounds.y + bounds.height : y1) + my, viewport.height));
  const pad = Math.max(16, Math.min(32, Math.min(x2 - x1, y2 - y1) * 0.04));
  const gutter = Math.max(compass ? 96 : 0, overlayWidth ? overlayWidth + 24 : 0);
  const height = Math.ceil(Math.max(y2 - y1 + pad * 2, overlayHeight + (compass ? 108 : 24), 96));
  return {
    x: Math.floor(x1 - pad),
    y: Math.floor((y1 + y2 - height) / 2),
    width: Math.ceil(Math.max(x2 - x1 + pad * 2, 96) + gutter),
    height,
  };
}
