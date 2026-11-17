// Image (PNG) and turntable movie export.
//
// A frame is composed on a 2D canvas: the theme's canvas background (or
// transparency), the WebGL scene rendered at export resolution, and the
// on-canvas overlays the WebGL canvas alone would miss — atom labels,
// plane/direction labels, the measurement card and the a/b/c compass —
// redrawn from the same projected positions the live view uses. App
// toolbars and forms are not part of the export.
//
// The renderer's drawing buffer is resized temporarily (CSS size stays,
// so the page layout and camera aspect do not change) and read right after
// rendering, in the same task. Everything is restored afterwards.

import { exportFrame } from "./export-framing.js";

const MAX_IMAGE_SIDE = 4096,
  MAX_VIDEO_SIDE = 1920;

export function slugName(name) {
  const base = String(name || "structure")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${base || "structure"}-${stamp}`;
}

/** Supported recording format, or { reason } explaining why not. */
export function videoSupport() {
  if (typeof MediaRecorder === "undefined") return { reason: "This browser has no MediaRecorder; PNG export still works." };
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function")
    return { reason: "This browser cannot capture a canvas as video; PNG export still works." };
  const candidates = [
    ["video/mp4;codecs=avc1.42E01E", "mp4"],
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm;codecs=vp8", "webm"],
    ["video/webm", "webm"],
    ["video/mp4", "mp4"],
  ];
  for (const [mime, extension] of candidates)
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, extension };
  return { reason: "No supported video format (MP4 or WebM) for recording; PNG export still works." };
}

// ---- PNG physical size (pHYs) ------------------------------------------------
// DPI is metadata only: the pixels are not resampled. The pHYs chunk
// (pixels per metre, unit = 1) goes right after IHDR, replacing any
// existing pHYs.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function validDpi(value) {
  const dpi = Number(value);
  return Number.isFinite(dpi) && dpi >= 30 && dpi <= 2400 ? dpi : null;
}
export async function withPngDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((b, i) => bytes[i] === b)) throw Error("Not a PNG.");
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  chunkView.setUint32(8, ppm);
  chunkView.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  chunkView.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Copy chunks, dropping any existing pHYs and inserting ours after IHDR.
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (type !== "pHYs") parts.push(bytes.subarray(offset, end));
    if (type === "IHDR") parts.push(chunk);
    offset = end;
  }
  return new Blob(parts, { type: "image/png" });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * ctx: { renderer, camera, controls(), render, stopMotion, invalidate,
 *        cssSize(), contentBounds(turntable), atomLabels(), latticeLabels(), compass(), measurement(),
 *        name(), setBusy(bool) }
 */
export function createExporter(ctx) {
  let busy = false;
  const measureContext = document.createElement("canvas").getContext("2d");

  function measurementSize(g, s = 1) {
    const m = ctx.measurement();
    if (!m) return null;
    g.font = `500 ${22 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    let width = g.measureText(m.value).width;
    g.font = `400 ${12 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    for (const line of m.lines) width = Math.max(width, g.measureText(line).width);
    return { width: width + 20 * s, height: (46 + m.lines.length * 16) * s };
  }

  function frameFor(turntable = false) {
    let bounds = ctx.contentBounds(turntable);
    const include = (rect) => {
      if (!bounds) bounds = { ...rect };
      else {
        const x = Math.min(bounds.x, rect.x), y = Math.min(bounds.y, rect.y);
        bounds = { x, y, width: Math.max(bounds.x + bounds.width, rect.x + rect.width) - x,
          height: Math.max(bounds.y + bounds.height, rect.y + rect.height) - y };
      }
    };
    measureContext.font = "400 11px Inter, ui-sans-serif, system-ui, sans-serif";
    let labelWidth = 0;
    for (const label of ctx.atomLabels()) {
      const width = measureContext.measureText(label.label).width + 6;
      include({ x: label.x - width * 0.2, y: label.y - 12, width, height: 15 });
      labelWidth = Math.max(labelWidth, width);
    }
    for (const label of ctx.latticeLabels()) {
      const width = label.rect?.w ?? measureContext.measureText(label.text).width + 11;
      include({ x: label.rect?.x ?? (label.kind === "arrow" ? label.x + 6 : label.x - width / 2),
        y: label.rect?.y ?? (label.kind === "arrow" ? label.y - 22 : label.y - 8), width, height: 16 });
      if (label.leader) {
        const l = label.leader;
        include({ x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2), width: Math.abs(l.x2 - l.x1), height: Math.abs(l.y2 - l.y1) });
      }
      labelWidth = Math.max(labelWidth, width + 24);
    }
    const card = measurementSize(measureContext);
    return exportFrame(bounds, ctx.cssSize(), {
      // Labels can change sides while rotating. Reserve their reach around
      // the analytic geometry envelope, once for the entire movie.
      labelMargin: turntable && labelWidth ? { x: labelWidth + 16, y: 40 } : 0,
      overlayWidth: card?.width,
      overlayHeight: card?.height,
      compass: Boolean(ctx.compass()),
      clip: !turntable,
    });
  }

  /** Export pixel size for a CSS-size scale, bounded and even. */
  function exportSize(scale, maxSide, crop = frameFor()) {
    const { width, height } = ctx.cssSize();
    const gl = ctx.renderer.getContext();
    const limit = Math.min(maxSide, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || maxSide, gl.getParameter(gl.MAX_VIEWPORT_DIMS)?.[0] || maxSide);
    const factor = Math.min(scale, limit / Math.max(crop.width, crop.height));
    const even = (v) => Math.max(2, 2 * Math.round((v * factor) / 2));
    return { width: even(crop.width), height: even(crop.height),
      crop, css: { width, height }, scale: factor };
  }

  function withRenderSize(size, run) {
    const { renderer } = ctx;
    const ratio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    try {
      return run();
    } finally {
      // Restore the canvas as it is NOW, not as it was when the export
      // started: the layout may have been resized meanwhile.
      const now = ctx.cssSize();
      renderer.setPixelRatio(ratio);
      renderer.setSize(now.width, now.height, false);
    }
  }
  const sameSize = (a, b) => a.width === b.width && a.height === b.height;

  function background(g, w, h, transparent) {
    g.clearRect(0, 0, w, h);
    if (transparent) return;
    // Same radial gradient as the live canvas background (ellipse at 50% 42%).
    const gradient = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.hypot(w, h) * 0.6);
    gradient.addColorStop(0, css("--canvas-1"));
    gradient.addColorStop(0.55, css("--canvas-2"));
    gradient.addColorStop(1, css("--canvas-3"));
    g.fillStyle = gradient;
    g.fillRect(0, 0, w, h);
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function labels(g, s) {
    const font = (px, weight = 400) => `${weight} ${px * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    g.textBaseline = "middle";
    // Atom labels: box offset like the live view (-20%, -80%).
    for (const l of ctx.atomLabels()) {
      g.font = font(11);
      const w = g.measureText(l.label).width + 6 * s,
        h = 15 * s;
      const x = l.x * s - 0.2 * w,
        y = l.y * s - 0.8 * h;
      g.fillStyle = css("--label-bg");
      roundRect(g, x, y, w, h, 3 * s);
      g.fill();
      g.fillStyle = css("--label-text");
      g.fillText(l.label, x + 3 * s, y + h / 2);
    }
    // Plane/direction labels: the live view's own placement (rect in CSS
    // px) and plane leaders, scaled — the same boxes and lines as on screen.
    for (const l of ctx.latticeLabels()) {
      if (!l.leader) continue;
      g.strokeStyle = l.color;
      g.globalAlpha = 0.9;
      g.lineWidth = 1.25 * s;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(l.leader.x1 * s, l.leader.y1 * s);
      g.lineTo(l.leader.x2 * s, l.leader.y2 * s);
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const l of ctx.latticeLabels()) {
      g.font = font(11);
      const h = 16 * s;
      const w = l.rect ? l.rect.w * s : g.measureText(l.text).width + 11 * s;
      const x = l.rect ? l.rect.x * s : l.kind === "arrow" ? (l.x + 6) * s : l.x * s - w / 2,
        y = l.rect ? l.rect.y * s : l.kind === "arrow" ? (l.y - 6) * s - h : l.y * s - h / 2;
      g.fillStyle = css("--label-bg");
      roundRect(g, x, y, w, h, 3 * s);
      g.fill();
      g.fillStyle = l.color;
      g.fillRect(x, y, 3 * s, h);
      g.fillStyle = css("--label-text");
      g.fillText(l.text, x + 7 * s, y + h / 2);
    }
  }

  function measurement(g, w, s) {
    const m = ctx.measurement();
    if (!m) return;
    const pad = 10 * s,
      lineH = 16 * s;
    const { width: boxW, height: boxH } = measurementSize(g, s);
    const x = w - boxW - 12 * s,
      y = 12 * s;
    g.fillStyle = css("--overlay-bg");
    roundRect(g, x, y, boxW, boxH, 10 * s);
    g.fill();
    g.strokeStyle = css("--accent");
    g.lineWidth = s;
    g.stroke();
    g.textBaseline = "top";
    g.fillStyle = css("--measure");
    g.font = `500 ${22 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    g.fillText(m.value, x + pad, y + pad);
    g.fillStyle = css("--overlay-text");
    g.font = `400 ${12 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    m.lines.forEach((line, i) => g.fillText(line, x + pad, y + pad + 28 * s + i * lineH));
  }

  // The a/b/c compass from the same projected axis directions as the view.
  function compass(g, w, h, s) {
    const axes = ctx.compass();
    if (!axes) return;
    const size = 72 * s,
      radius = 23 * s,
      cx = w - 12 * s - size / 2,
      cy = h - 12 * s - size / 2;
    g.fillStyle = css("--compass-bg");
    g.beginPath();
    g.arc(cx, cy, size / 2, 0, Math.PI * 2);
    g.fill();
    const colors = { a: css("--axis-a"), b: css("--axis-b"), c: css("--axis-c") };
    const order = [...axes].sort((p, q) => p.z - q.z);
    for (const axis of order) {
      const color = colors[axis.name];
      g.strokeStyle = g.fillStyle = color;
      g.lineWidth = 2.2 * s;
      g.globalAlpha = 1;
      const len = axis.projectedLength;
      let lx, ly;
      if (axis.lineOfSight) {
        const ux = len > 1e-6 ? axis.x / len : 0.7,
          uy = len > 1e-6 ? -axis.y / len : -0.7;
        const sx = cx + ux * 9 * s * 0.9,
          sy = cy + uy * 9 * s * 0.9;
        g.lineWidth = 1.6 * s;
        g.beginPath();
        g.arc(sx, sy, 5 * s, 0, Math.PI * 2);
        g.stroke();
        if (axis.z > 0) {
          g.beginPath();
          g.arc(sx, sy, 1.7 * s, 0, Math.PI * 2);
          g.fill();
        } else {
          g.beginPath();
          g.moveTo(sx - 3.2 * s, sy - 3.2 * s);
          g.lineTo(sx + 3.2 * s, sy + 3.2 * s);
          g.moveTo(sx + 3.2 * s, sy - 3.2 * s);
          g.lineTo(sx - 3.2 * s, sy + 3.2 * s);
          g.stroke();
        }
        lx = cx + ux * 18 * s;
        ly = cy + uy * 18 * s;
      } else {
        const ux = axis.x / len,
          uy = -axis.y / len;
        const tipX = cx + axis.x * radius,
          tipY = cy - axis.y * radius;
        const head = Math.min(7, 4 + 3 * len) * s;
        const bx = tipX - ux * head,
          by = tipY - uy * head;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(bx, by);
        g.stroke();
        g.beginPath();
        g.moveTo(tipX, tipY);
        g.lineTo(bx - uy * 3.2 * s, by + ux * 3.2 * s);
        g.lineTo(bx + uy * 3.2 * s, by - ux * 3.2 * s);
        g.closePath();
        g.fill();
        lx = cx + ux * (radius * len + 8 * s);
        ly = cy + uy * (radius * len + 8 * s);
      }
      g.globalAlpha = 1;
      g.font = `italic 700 ${13 * s}px Georgia, "Times New Roman", serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 3 * s;
      g.strokeStyle = css("--label-halo");
      g.strokeText(axis.name, lx, ly);
      g.fillStyle = color;
      g.fillText(axis.name, lx, ly);
      g.textAlign = "left";
    }
  }

  /** Render the current view into a 2D canvas at `size`. */
  function composeFrame(target, size, transparent) {
    const g = target.getContext("2d");
    const s = size.scale;
    background(g, size.width, size.height, transparent);
    withRenderSize(size, () => {
      ctx.render({ crop: size.crop, css: size.css });
      g.drawImage(ctx.renderer.domElement, 0, 0, size.width, size.height);
    });
    g.save();
    g.translate(-size.crop.x * s, -size.crop.y * s);
    labels(g, s);
    g.restore();
    measurement(g, size.width, s);
    compass(g, size.width, size.height, s);
  }

  async function exportPNG({ scale = 2, transparent = false, dpi = 300 } = {}) {
    if (!validDpi(dpi)) throw Error("Enter a DPI between 30 and 2400.");
    if (busy) throw Error("An export is already running.");
    busy = true;
    ctx.setBusy(true);
    try {
      const size = exportSize(scale, MAX_IMAGE_SIDE);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      composeFrame(canvas, size, transparent);
      const encoded = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(Error("The browser could not encode the PNG."))), "image/png"),
      );
      const blob = await withPngDpi(encoded, dpi);
      const filename = `${slugName(ctx.name())}.png`;
      download(blob, filename);
      return { filename, width: size.width, height: size.height, bytes: blob.size, dpi };
    } finally {
      busy = false;
      ctx.setBusy(false);
      ctx.invalidate();
    }
  }

  /**
   * One turntable revolution about the screen's vertical axis through the
   * view target. Paced in real time at `fps`; onProgress(0..1). Returns a
   * controller { cancel, done } where done resolves to the result or
   * { canceled: true }.
   */
  function recordTurntable({ seconds = 8, fps = 30, scale = 1, onProgress } = {}) {
    if (busy) throw Error("An export is already running.");
    const support = videoSupport();
    if (!support.mime) throw Error(support.reason);
    const { camera } = ctx;
    busy = true;
    ctx.setBusy(true);
    ctx.stopMotion();
    // stopMotion() replaces the controls object; always read it fresh.
    const saved = {
      position: camera.position.clone(),
      up: camera.up.clone(),
      target: ctx.controls().target.clone(),
    };
    // Setup can throw synchronously (e.g. Safari rejecting captureStream or
    // the MediaRecorder options). Then stop whatever tracks exist and give
    // the app back: not busy, controls enabled, camera untouched.
    let size, canvas,
      manual = null,
      stream = null,
      track = null,
      recorder = null;
    try {
      size = exportSize(scale, MAX_VIDEO_SIDE, frameFor(true));
      canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      manual = canvas.captureStream(0);
      track = manual.getVideoTracks()[0];
      if (typeof track?.requestFrame === "function") stream = manual;
      else {
        manual.getTracks().forEach((t) => t.stop());
        track = null;
        stream = canvas.captureStream(fps);
      }
      recorder = new MediaRecorder(stream, {
        mimeType: support.mime,
        videoBitsPerSecond: Math.min(16e6, Math.round(size.width * size.height * fps * 0.15)),
      });
    } catch (error) {
      for (const s of [manual, stream]) s?.getTracks().forEach((t) => t.stop());
      busy = false;
      ctx.setBusy(false);
      ctx.invalidate();
      throw error instanceof Error ? error : Error(String(error));
    }
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const frames = Math.max(2, Math.round(seconds * fps));
    const offset = saved.position.clone().sub(saved.target);
    const axis = saved.up.clone().normalize();
    let canceled = false,
      reason = "",
      timer = 0,
      frame = 0;
    const restore = () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      camera.position.copy(saved.position);
      camera.up.copy(saved.up);
      ctx.stopMotion();
      ctx.controls().target.copy(saved.target);
      ctx.controls().update();
      busy = false;
      ctx.setBusy(false);
      ctx.invalidate();
    };
    let settle = () => {};
    // Cancel (user or resize): no download. onstop restores and resolves;
    // without a running recorder, do both here.
    const abort = (why) => {
      if (canceled) return;
      canceled = true;
      reason = why;
      clearTimeout(timer);
      try {
        if (recorder.state !== "inactive") return recorder.stop();
      } catch {
        /* fall through to a direct restore */
      }
      restore();
      settle({ canceled: true, reason });
    };
    const done = new Promise((resolve, reject) => {
      settle = resolve;
      recorder.onstop = () => {
        restore();
        if (canceled) return resolve({ canceled: true, reason });
        const blob = new Blob(chunks, { type: support.mime.split(";")[0] });
        if (!blob.size) return reject(Error("The recording produced no data."));
        const filename = `${slugName(ctx.name())}-turntable.${support.extension}`;
        download(blob, filename);
        resolve({ filename, mime: support.mime, width: size.width, height: size.height, bytes: blob.size, frames });
      };
      recorder.onerror = (e) => {
        canceled = true;
        try {
          recorder.state !== "inactive" && recorder.stop();
        } catch {
          restore();
        }
        reject(e.error ?? Error("Recording failed."));
      };
    });
    const start = performance.now();
    const step = () => {
      if (canceled) return;
      // Every frame must share one geometry (pixel size, camera aspect,
      // label positions). If the view was resized, the rest of the movie
      // would be stretched: stop without saving anything.
      if (!sameSize(ctx.cssSize(), size.css)) return abort("resized");
      const angle = (2 * Math.PI * frame) / frames;
      camera.position.copy(saved.target).add(offset.clone().applyAxisAngle(axis, angle));
      camera.up.copy(saved.up);
      try {
        composeFrame(canvas, size, false);
        track?.requestFrame?.();
      } catch (error) {
        recorder.onerror({ error });
        return;
      }
      onProgress?.(frame / frames);
      frame++;
      if (frame > frames) {
        recorder.stop();
        return;
      }
      timer = setTimeout(step, Math.max(0, start + (frame * 1000) / fps - performance.now()));
    };
    try {
      recorder.start(250);
    } catch (error) {
      // start() can also throw synchronously: restore and report.
      canceled = true;
      restore();
      throw error instanceof Error ? error : Error(String(error));
    }
    step();
    return {
      done,
      cancel() {
        abort("user");
      },
    };
  }

  return {
    imageSize: (scale = 2) => exportSize(scale, MAX_IMAGE_SIDE),
    exportPNG,
    recordTurntable,
    videoSupport,
    get busy() {
      return busy;
    },
  };
}
