// Translucent polyhedron faces of all pairs as one batched mesh.
//
// CORRECTNESS NOTE: the per-pixel order is produced by depth peeling
// (peel.js); this batch is its geometry. The triangle sort below is only
// the identified FALLBACK that peel.js uses for fragments beyond its layer
// budget. A centroid sort is not exact in general: it fails for
// intersecting faces and can fail where triangles' projections overlap
// even without intersecting.
//
// Each pair rule keeps its own face mesh: it holds the physical hull
// geometry, per-polyhedron vertex colours, picking (faceIndex → owner) and
// bounds. Translucent faces, however, must be blended in depth order across
// ALL pairs. One rule mesh per pair can only be sorted as a whole object,
// so Si–O faces would always blend entirely before or after Mg–O faces.
//
// This module therefore draws every translucent face of every pair from a
// single batched mesh (one draw call) with RGBA vertex colours — the pair's
// opacity rides in the alpha channel — and re-sorts its triangle index
// buffer back to front whenever the view direction changes. The rule meshes
// of translucent pairs move to a layer the camera does not render (the
// raycaster still tests it), so picking and geometry stay with them.
// Opaque pairs (100%) keep rendering from their own mesh with depth writes;
// pairs at 0% draw only their outlines.
//
// The fallback uses centroid depth, which cannot guarantee correct order
// even for disjoint faces whose screen projections overlap. The peeler
// handles those pixels before this fallback is used for deeper layers.

import { PEEL_LAYER } from "./peel.js";

const HIDDEN_LAYER = 1;
const BUCKETS = 1 << 16;

export function createFaceSorter(THREE) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.8,
    transparent: true,
    depthWrite: false,
    // Back and front faces in ONE pass, so the global order is the only
    // order (the default double-sided transparent path draws all back
    // faces first, then all front faces).
    forceSinglePass: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "translucent-polyhedron-faces";
  mesh.visible = false;
  mesh.frustumCulled = false;
  // After other translucent geometry at renderOrder 0 (cell lines and
  // polyhedron outlines, which write depth): faces in front then tint the
  // lines behind them and lines in front stay crisp.
  mesh.renderOrder = 1;
  // Drawn only by the depth peeler (never by the normal pass).
  mesh.layers.set(PEEL_LAYER);

  let key = "",
    segments = [], // { source, start (triangle), count, alpha }
    centroids = new Float32Array(0),
    order = new Uint32Array(0),
    scratch = new Uint32Array(0),
    depths = new Float32Array(0),
    keys = new Uint16Array(0),
    sorted = false,
    triangleCount = 0,
    sortCount = 0,
    lastSpan = 0;
  const counts = new Uint32Array(BUCKETS);
  const lastDir = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3();

  const isTranslucent = (m) => m.visible && m.material.opacity > 0 && m.material.opacity < 1;

  function rebuild(list) {
    mesh.geometry.dispose();
    const total = list.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
    const positions = new Float32Array(total * 3),
      normals = new Float32Array(total * 3),
      colors = new Float32Array(total * 4);
    segments = [];
    let vertex = 0;
    for (const source of list) {
      const attrs = source.geometry.attributes;
      const n = attrs.position.count;
      positions.set(attrs.position.array, vertex * 3);
      normals.set(attrs.normal.array, vertex * 3);
      const rgb = attrs.color.array,
        alpha = source.material.opacity;
      for (let i = 0; i < n; i++) {
        const o = (vertex + i) * 4;
        colors[o] = rgb[i * 3];
        colors[o + 1] = rgb[i * 3 + 1];
        colors[o + 2] = rgb[i * 3 + 2];
        colors[o + 3] = alpha;
      }
      segments.push({ source, start: vertex / 3, count: n / 3, alpha });
      vertex += n;
    }
    triangleCount = total / 3;
    centroids = new Float32Array(triangleCount * 3);
    for (let t = 0; t < triangleCount; t++)
      for (let axis = 0; axis < 3; axis++)
        centroids[t * 3 + axis] =
          (positions[t * 9 + axis] + positions[t * 9 + 3 + axis] + positions[t * 9 + 6 + axis]) / 3;
    order = new Uint32Array(triangleCount);
    scratch = new Uint32Array(triangleCount);
    depths = new Float32Array(triangleCount);
    keys = new Uint16Array(triangleCount);
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    // itemSize 4 → three.js compiles the vertex-alpha variant.
    next.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    const index = new THREE.BufferAttribute(new Uint32Array(triangleCount * 3), 1);
    index.setUsage(THREE.DynamicDrawUsage);
    next.setIndex(index);
    next.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    mesh.geometry = next;
    sorted = false;
  }

  function updateAlphas() {
    const color = mesh.geometry.attributes.color;
    if (!color) return;
    let changed = false;
    for (const seg of segments) {
      const alpha = seg.source.material.opacity;
      if (alpha === seg.alpha) continue;
      seg.alpha = alpha;
      changed = true;
      const array = color.array;
      for (let v = seg.start * 3, end = (seg.start + seg.count) * 3; v < end; v++) array[v * 4 + 3] = alpha;
    }
    if (changed) color.needsUpdate = true;
  }

  // Stable counting sort on 16-bit quantised depth: O(n), far first.
  function sort(dir) {
    const n = triangleCount;
    let min = Infinity,
      max = -Infinity;
    for (let t = 0; t < n; t++) {
      const d = centroids[t * 3] * dir.x + centroids[t * 3 + 1] * dir.y + centroids[t * 3 + 2] * dir.z;
      depths[t] = d;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    const span = max - min;
    lastSpan = span;
    const scale = span > 0 ? (BUCKETS - 1) / span : 0;
    counts.fill(0);
    for (let t = 0; t < n; t++) {
      // Larger depth along the viewing direction = farther = drawn first.
      const k = (BUCKETS - 1 - Math.round((depths[t] - min) * scale)) & 0xffff;
      keys[t] = k;
      counts[k]++;
    }
    for (let k = 0, sum = 0; k < BUCKETS; k++) {
      const c = counts[k];
      counts[k] = sum;
      sum += c;
    }
    for (let t = 0; t < n; t++) scratch[counts[keys[t]]++] = t;
    const index = mesh.geometry.index.array;
    for (let i = 0; i < n; i++) {
      const t = scratch[i];
      order[i] = t;
      index[i * 3] = t * 3;
      index[i * 3 + 1] = t * 3 + 1;
      index[i * 3 + 2] = t * 3 + 2;
    }
    mesh.geometry.index.needsUpdate = true;
    sortCount++;
  }

  return {
    mesh,
    material,
    /**
     * Call before every render. `sources`: all rule face meshes;
     * `camera`: the rendered camera (orthographic, so only its direction
     * matters). Faces live in an untransformed group (world = local).
     */
    sync(sources, camera) {
      const list = [...sources].filter(isTranslucent);
      for (const source of sources) {
        if (list.includes(source)) source.layers.set(HIDDEN_LAYER);
        else source.layers.set(0);
      }
      const nextKey = list.map((m) => m.geometry.uuid).join(",");
      if (nextKey !== key) {
        key = nextKey;
        if (list.length) rebuild(list);
        else {
          segments = [];
          triangleCount = 0;
        }
      } else updateAlphas();
      mesh.visible = triangleCount > 0;
      if (!mesh.visible) return;
      camera.getWorldDirection(forward);
      if (!sorted || forward.dot(lastDir) < 1 - 1e-9) {
        sort(forward);
        lastDir.copy(forward);
        sorted = true;
      }
    },
    /** Raycasters must test the layer that translucent rule meshes use. */
    enablePicking(raycaster) {
      raycaster.layers.enable(HIDDEN_LAYER);
    },
    diagnostics() {
      return {
        triangles: triangleCount,
        pairs: segments.length,
        sorts: sortCount,
        visible: mesh.visible,
        singlePass: material.forceSinglePass,
        alphas: segments.map((s) => s.alpha),
        // Back-to-front order check along the last sort direction, within
        // one quantisation step of the depth span.
        backToFront: (() => {
          const step = lastSpan / (BUCKETS - 1) + 1e-9;
          for (let i = 1; i < triangleCount; i++) if (depths[order[i]] > depths[order[i - 1]] + step) return false;
          return true;
        })(),
      };
    },
  };
}
