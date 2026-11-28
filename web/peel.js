// Per-pixel order-independent transparency by front-to-back depth peeling.
//
// Objects on PEEL_LAYER (translucent polyhedron faces of all pairs and the
// translucent lattice/symmetry planes) are not drawn by the normal pass.
// Instead, for every pixel, the nearest translucent fragment is peeled off
// layer by layer:
//
//   1. normal pass: everything else (atoms, bonds, opaque faces, lines…)
//      into the current target, exactly as before;
//   2. depth prepass of the depth-writing scene → `opaque` depth texture;
//   3. layer k: draw the peel objects with depth test/write, discarding
//      fragments at or in front of layer k−1's depth and behind the opaque
//      depth → the k-th nearest translucent fragment of each pixel;
//      accumulate it UNDER the layers so far (premultiplied, front to back);
//   4. remainder: fragments behind the last peeled layer (only when the
//      layer budget was too small) are blended back to front from the
//      triangle-sorted batch and added under — an identified approximation,
//      detected with occlusion queries and reported;
//   5. composite the accumulated layers OVER the normal pass.
//
// Front-to-back "under" accumulation of premultiplied colours equals
// back-to-front "over" blending exactly, so with a sufficient budget the
// result is the same as drawing every fragment in true per-pixel depth
// order — including intersecting faces, enlarged interpenetrating
// polyhedra and cyclic overlaps, which no object or triangle order can
// resolve. Colours are encoded to the output colour space before blending,
// like three.js does on the canvas, so unaffected pixels look the same.
//
// The budget adapts: occlusion queries report how many layers held
// fragments and whether any remained; the next frame uses that many (+2),
// and a frame that overflowed is re-rendered with a larger budget, up to
// MAX_LAYERS. Exports always use MAX_LAYERS. Remaining limits: fragments at
// exactly equal depth (two coincident faces) are peeled as one; depth
// complexity above MAX_LAYERS falls back to the sorted remainder (reported
// in diagnostics and the view status); peeled layers are not multisampled.

export const PEEL_LAYER = 2;
const OVERLAY_LAYER = 3;
// Screen-space lines (LineSegments2) expand their quads in their own shader;
// the depth override material cannot, so they get a separate depth pass.
const FAT_LINE_LAYER = 4;
const MIN_LAYERS = 4,
  MAX_LAYERS = 24,
  START_LAYERS = 8;

// Depth comparison. The layer pass writes gl_FragDepth = gl_FragCoord.z
// explicitly (32-bit float depth texture, highp samplers), so the stored
// value is the shader's own value rather than a separately interpolated
// fixed-function depth. A few float ulps of tolerance still absorb
// rasterisation/interpolation noise between passes on sloped faces;
// without it a surface can re-select itself in a later layer (speckle,
// and every layer "used"). PEEL_ULPS × 2^-23 relative to the depth value
// ≈ 1e-6·z: for the viewer's depth range that is far below 0.01 Å, so
// genuinely separate nearby faces still peel as separate layers.
const PEEL_PARS = /* glsl */ `
uniform highp sampler2D uPeelPrev;
uniform highp sampler2D uPeelOpaque;
uniform vec2 uPeelSize;
uniform float uPeelFirst;
uniform float uPeelEncode;
const float PEEL_REL = 8.0 / 8388608.0;
const float PEEL_ABS = 1.0 / 16777216.0;
void peelTest() {
  vec2 uv = gl_FragCoord.xy / uPeelSize;
  highp float z = gl_FragCoord.z;
  highp float opaque = texture(uPeelOpaque, uv).r;
  if (z >= opaque - max(opaque * PEEL_REL, PEEL_ABS)) discard;
  if (uPeelFirst < 0.5) {
    highp float prev = texture(uPeelPrev, uv).r;
    if (z <= prev + max(prev * PEEL_REL, PEEL_ABS)) discard;
  }
  gl_FragDepth = z;
}
`;

export function createDepthPeeler({ THREE, renderer, onStatus = () => {} }) {
  const gl = renderer.getContext();
  const shared = {
    uPeelPrev: { value: null },
    uPeelOpaque: { value: null },
    uPeelSize: { value: new THREE.Vector2(1, 1) },
    uPeelFirst: { value: 1 },
    uPeelEncode: { value: 1 },
  };

  const target = (withDepth) => {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: withDepth,
    });
    if (withDepth) {
      rt.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
      rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    }
    return rt;
  };
  const opaqueRT = target(true),
    layerRT = [target(true), target(true)],
    accumRT = target(false),
    restRT = target(false);
  const size = new THREE.Vector2();

  // Fullscreen passes.
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quadMaterial = new THREE.ShaderMaterial({
    uniforms: { tSource: { value: null }, uPremultiplied: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform sampler2D tSource; uniform float uPremultiplied; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tSource, vUv);
        gl_FragColor = uPremultiplied > 0.5 ? c : vec4(c.rgb * c.a, c.a); }`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.CustomBlending,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial);
  quad.frustumCulled = false;
  quadScene.add(quad);
  function drawQuad(source, rt, mode, premultiplied) {
    quadMaterial.uniforms.tSource.value = source;
    quadMaterial.uniforms.uPremultiplied.value = premultiplied ? 1 : 0;
    if (mode === "under") {
      // dst is the premultiplied front; new layer goes behind it.
      quadMaterial.blendSrc = quadMaterial.blendSrcAlpha = THREE.OneMinusDstAlphaFactor;
      quadMaterial.blendDst = quadMaterial.blendDstAlpha = THREE.OneFactor;
    } else {
      quadMaterial.blendSrc = quadMaterial.blendSrcAlpha = THREE.OneFactor;
      quadMaterial.blendDst = quadMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    }
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCamera);
  }

  // Depth-only override for the opaque prepass.
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });

  // Peel variants of each source material ("layer" and "rest" modes).
  // Variants live exactly as long as their source material: disposing the
  // source (geometry/cutoff rebuilds, plane edits) disposes them too, so
  // their WebGL programs are released instead of accumulating.
  const variants = new Map();
  const releaseVariants = (event) => {
    const source = event.target;
    source.removeEventListener("dispose", releaseVariants);
    for (const m of Object.values(variants.get(source) ?? {})) m.dispose();
    variants.delete(source);
  };
  function variant(source, mode) {
    let pair = variants.get(source);
    if (!pair) {
      variants.set(source, (pair = {}));
      source.addEventListener("dispose", releaseVariants);
    }
    let m = pair[mode];
    if (!m) {
      m = source.clone();
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, shared);
        shader.fragmentShader = shader.fragmentShader
          .replace("void main() {", `${PEEL_PARS}\nvoid main() {\n  peelTest();`)
          .replace(
            "#include <colorspace_fragment>",
            "#include <colorspace_fragment>\n  if (uPeelEncode > 0.5) gl_FragColor = sRGBTransferOETF(gl_FragColor);",
          );
      };
      m.customProgramCacheKey = () => `peel-${mode}`;
      pair[mode] = m;
    }
    // Follow live edits (opacity slider, colour) of the source material.
    const keep = { onBeforeCompile: m.onBeforeCompile, customProgramCacheKey: m.customProgramCacheKey };
    m.copy(source);
    Object.assign(m, keep);
    m.forceSinglePass = true;
    if (mode === "layer") {
      m.transparent = false;
      m.blending = THREE.NoBlending;
      m.depthTest = true;
      m.depthWrite = true;
    } else {
      m.transparent = true;
      m.blending = THREE.NormalBlending;
      m.depthTest = false;
      m.depthWrite = false;
    }
    return m;
  }

  // Occlusion queries (WebGL2): samples per layer and in the remainder.
  const queries = [];
  let pending = null,
    unmeasured = false, // a frame was drawn after the pending measured one
    budget = START_LAYERS,
    exportMode = false,
    status = { layers: 0, used: 0, overflow: false, remainder: false, budget, max: MAX_LAYERS, frames: 0 };
  const newQuery = () => gl.createQuery();
  // Exact query: ANY_SAMPLES_PASSED_CONSERVATIVE may report false
  // positives, which would claim layers/overflow that hold no pixels.
  const QUERY = gl.ANY_SAMPLES_PASSED;
  // One poll loop at most; it ends when the newest frame's results are in.
  let pollFrame = 0;
  const schedulePoll = () => {
    if (!pollFrame) pollFrame = requestAnimationFrame(poll);
  };
  function poll() {
    pollFrame = 0;
    if (!pending) return;
    if (gl.isContextLost?.()) {
      pending = null;
      queries.length = 0;
      unmeasured = false;
      return;
    }
    const { layerQueries, restQuery, budget: used } = pending;
    const all = [...layerQueries, restQuery];
    if (!all.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) {
      schedulePoll();
      return;
    }
    let last = -1;
    layerQueries.forEach((q, i) => {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT)) last = i;
    });
    const remainder = Boolean(gl.getQueryParameter(restQuery, gl.QUERY_RESULT));
    queries.push(...all);
    pending = null;
    status = { ...status, used: last + 1, remainder, overflow: remainder && used >= MAX_LAYERS };
    const needed = remainder ? used * 2 : last + 1 + 2;
    const next = Math.min(MAX_LAYERS, Math.max(MIN_LAYERS, needed));
    const grow = remainder && next > used;
    budget = next;
    status.budget = budget;
    // Redraw (and so measure again) when
    //  - the frame ran out of layers: the larger budget may fit, or
    //  - a newer frame was drawn unmeasured while this query was pending:
    //    this result describes an older scene, so the status could be
    //    stale (e.g. a 2-layer frame followed by a 30-layer one).
    // The redrawn frame is measured (nothing is pending now), so this
    // settles instead of looping. Export frames are driven by the exporter
    // and already use the maximum; `unmeasured` stays set so the first
    // live frame after the export is measured and reported.
    const stale = unmeasured;
    const rerender = (grow || stale) && !exportMode;
    onStatus({ ...status, stale, rerender });
  }

  function resize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x),
      h = Math.max(1, size.y);
    for (const rt of [opaqueRT, ...layerRT, accumRT, restRT]) if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    shared.uPeelSize.value.set(w, h);
  }

  /** Render `scene` with per-pixel ordered translucency. */
  function render(scene, camera) {
    if (gl.isContextLost?.()) return status;
    const peeled = [],
      overlays = [];
    scene.traverseVisible((o) => {
      if (o.isLight) o.layers.enable(PEEL_LAYER);
      else if (o.isMesh && o.layers.isEnabled(PEEL_LAYER) && !o.layers.isEnabled(0)) peeled.push(o);
      else if (o.material && !Array.isArray(o.material) && o.material.depthTest === false && o.layers.isEnabled(0))
        overlays.push({ o, mask: o.layers.mask });
    });
    if (!peeled.length) {
      renderer.render(scene, camera);
      // Nothing translucent: any pending measurement describes an older
      // scene; drop it so it cannot report a stale overflow later.
      if (pending) queries.push(...pending.layerQueries, pending.restQuery);
      pending = null;
      unmeasured = false;
      const was = status.overflow || status.used > 0;
      status = { ...status, layers: 0, used: 0, remainder: false, overflow: false };
      if (was) onStatus({ ...status, stale: false, rerender: false });
      return status;
    }
    const output = renderer.getRenderTarget();
    // 1. Normal pass (peeled objects are only on PEEL_LAYER). Always-on-top
    // overlays (measurement lines, pick marker) wait until after the
    // translucent composite so faces never cover them.
    overlays.forEach(({ o }) => o.layers.set(OVERLAY_LAYER));
    try {
      renderer.render(scene, camera);
    } catch (error) {
      overlays.forEach(({ o, mask }) => (o.layers.mask = mask));
      throw error;
    }
    resize();
    const savedClear = new THREE.Color(),
      savedAlpha = renderer.getClearAlpha(),
      savedAutoClear = renderer.autoClear,
      savedLayers = camera.layers.mask,
      savedBackground = scene.background,
      savedOverride = scene.overrideMaterial;
    renderer.getClearColor(savedClear);
    renderer.setClearColor(0x000000, 0);
    scene.background = null;
    const hidden = [];
    try {
      // 2. Opaque depth: everything that writes depth in the normal pass.
      const fatLines = [];
      scene.traverseVisible((o) => {
        const m = o.material;
        if (!m || Array.isArray(m)) return;
        if (!m.depthWrite || !m.depthTest || m.visible === false) hidden.push(o);
        else if (m.isLineMaterial && o.layers.isEnabled(0)) {
          hidden.push(o);
          fatLines.push(o);
        }
      });
      hidden.forEach((o) => (o.visible = false));
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(opaqueRT);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      scene.overrideMaterial = savedOverride;
      hidden.forEach((o) => (o.visible = true));
      hidden.length = 0;
      if (fatLines.length) {
        const autoClear = renderer.autoClear;
        fatLines.forEach((o) => o.layers.enable(FAT_LINE_LAYER));
        camera.layers.set(FAT_LINE_LAYER);
        renderer.autoClear = false;
        try {
          renderer.render(scene, camera);
        } finally {
          renderer.autoClear = autoClear;
          camera.layers.mask = savedLayers;
          fatLines.forEach((o) => o.layers.disable(FAT_LINE_LAYER));
        }
      }
      shared.uPeelOpaque.value = opaqueRT.depthTexture;
      shared.uPeelEncode.value = output === null && renderer.outputColorSpace === THREE.SRGBColorSpace ? 1 : 0;

      renderer.autoClear = false;
      renderer.setRenderTarget(accumRT);
      renderer.clear(true, false, false);
      const layers = exportMode ? MAX_LAYERS : budget;
      const originals = peeled.map((o) => o.material);
      // Measure only when the previous measurement has been read, so a
      // continuously redrawn view (rotation) still gets results.
      const measure = !pending;
      const peelPass = (mode, rt, clearDepth) => {
        peeled.forEach((o, i) => (o.material = variant(originals[i], mode)));
        renderer.setRenderTarget(rt);
        renderer.clear(true, clearDepth, false);
        const q = measure ? (queries.pop() ?? newQuery()) : null;
        camera.layers.set(PEEL_LAYER);
        if (q) gl.beginQuery(QUERY, q);
        try {
          renderer.render(scene, camera);
        } finally {
          if (q) gl.endQuery(QUERY);
          camera.layers.mask = savedLayers;
          peeled.forEach((o, i) => (o.material = originals[i]));
        }
        return q;
      };
      const layerQueries = [];
      let prev = null;
      // 3. Peel front to back; each layer goes UNDER the ones before it.
      for (let k = 0; k < layers; k++) {
        const rt = layerRT[k % 2];
        shared.uPeelFirst.value = k === 0 ? 1 : 0;
        // Never the target being drawn (no feedback loop).
        shared.uPeelPrev.value = prev ? prev.depthTexture : opaqueRT.depthTexture;
        layerQueries.push(peelPass("layer", rt, true));
        drawQuad(rt.texture, accumRT, "under", false);
        prev = rt;
      }
      // 4. Remainder behind the last layer (only non-empty when the budget
      // was too small): approximate back-to-front blend, detected below.
      shared.uPeelFirst.value = 0;
      shared.uPeelPrev.value = prev.depthTexture;
      const restQuery = peelPass("rest", restRT, false);
      drawQuad(restRT.texture, accumRT, "under", true);
      // 5. Composite over the normal pass.
      drawQuad(accumRT.texture, output, "over", true);
      // 6. Always-on-top overlays, in their render order.
      if (overlays.length) {
        renderer.setRenderTarget(output);
        camera.layers.set(OVERLAY_LAYER);
        renderer.render(scene, camera);
        camera.layers.mask = savedLayers;
      }
      if (measure) {
        pending = { layerQueries, restQuery, budget: layers };
        unmeasured = false;
        schedulePoll();
      } else unmeasured = true;
      status = { ...status, layers, frames: status.frames + 1 };
    } finally {
      overlays.forEach(({ o, mask }) => (o.layers.mask = mask));
      hidden.forEach((o) => (o.visible = true));
      scene.overrideMaterial = savedOverride;
      camera.layers.mask = savedLayers;
      scene.background = savedBackground;
      renderer.autoClear = savedAutoClear;
      renderer.setClearColor(savedClear, savedAlpha);
      renderer.setRenderTarget(output);
    }
    return status;
  }

  return {
    render,
    /** Exports always peel MAX_LAYERS (queries are not readable in the same task). */
    setExportMode(on) {
      exportMode = on;
    },
    resetContext() {
      cancelAnimationFrame(pollFrame);
      pollFrame = 0;
      queries.length = 0;
      pending = null;
      unmeasured = false;
    },
    diagnostics: () => ({ ...status, method: "depth-peeling", exportMode, pending: Boolean(pending), unmeasured }),
    dispose() {
      cancelAnimationFrame(pollFrame);
      pollFrame = 0;
      for (const q of [...queries, ...(pending ? [...pending.layerQueries, pending.restQuery] : [])]) gl.deleteQuery(q);
      queries.length = 0;
      pending = null;
      for (const [source, pair] of variants) {
        source.removeEventListener("dispose", releaseVariants);
        for (const m of Object.values(pair)) m.dispose();
      }
      variants.clear();
      for (const rt of [opaqueRT, ...layerRT, accumRT, restRT]) rt.dispose();
      quad.geometry.dispose();
      quadMaterial.dispose();
      depthMaterial.dispose();
    },
  };
}
