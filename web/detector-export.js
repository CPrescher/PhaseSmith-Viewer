import { download, slugName } from "./export.js";

// The SVG snapshots have no access to the viewer's stylesheet.
// Freeze the paint and text styles, including the current theme and axis colors.
function snapshot(svg, scale) {
  const copy = svg.cloneNode(true);
  const nodes = copy.querySelectorAll("*");
  const latticeNode = svg.querySelector(".lattice-node");
  if (latticeNode) {
    // A dense lattice can contain thousands of identically styled circles.
    const paint = getComputedStyle(latticeNode);
    const fill = paint.fill.replace(/url\([^)]*#([^)"']+)["']?\)/g, "url(#$1)");
    const rule = document.createElementNS(svg.namespaceURI, "style");
    rule.textContent = `.lattice-node { fill: ${fill}; opacity: ${paint.opacity}; }`;
    copy.prepend(rule);
  }
  svg.querySelectorAll("*").forEach((el, i) => {
    if (el.classList.contains("lattice-node")) return;
    const style = getComputedStyle(el);
    for (const key of [
      "fill",
      "stroke",
      "opacity",
      "stroke-width",
      "stroke-dasharray",
      "fill-opacity",
      "stop-color",
      "stop-opacity",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "dominant-baseline",
      "paint-order",
    ]) {
      const value = style.getPropertyValue(key).replace(/url\([^)]*#([^)"']+)["']?\)/g, "url(#$1)");
      if (value) nodes[i].style.setProperty(key, value);
    }
  });
  const { width, height } = svg.viewBox.baseVal;
  copy.setAttribute("width", Math.round(width * scale));
  copy.setAttribute("height", Math.round(height * scale));
  const source = new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(source);
  const image = new Image();
  image.src = url;
  return image
    .decode()
    .then(() => image)
    .finally(() => URL.revokeObjectURL(url));
}

export async function saveDetectorPNG({ sphere, detector, sample, settings, detectorSize }) {
  const plots = [sphere, detector];
  const sizes = plots.map((svg) => ({
    width: svg.viewBox.baseVal.width,
    height: svg.viewBox.baseVal.height,
  }));
  const pad = 14,
    top = 77;
  const width = sizes[0].width + sizes[1].width + 3 * pad;
  const height = top + Math.max(...sizes.map((s) => s.height)) + pad;
  const scale = Math.min(4096 / Math.max(width, height), Math.max(2, 1400 / width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const theme = getComputedStyle(sphere);
  ctx.fillStyle = theme.getPropertyValue("--field").trim();
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme.getPropertyValue("--text").trim();
  ctx.font = "600 17px system-ui, sans-serif";
  ctx.fillText(sample, pad, 23, width - 2 * pad);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(settings, pad, 43, width - 2 * pad);
  ctx.font = "600 13px system-ui, sans-serif";
  const images = await Promise.all(plots.map((svg) => snapshot(svg, scale)));
  let x = pad;
  for (const [i, image] of images.entries()) {
    ctx.fillText(i === 0 ? "Ewald sphere" : "Detector · " + detectorSize, x, top - 7);
    ctx.drawImage(image, x, top, sizes[i].width, sizes[i].height);
    x += sizes[i].width + pad;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw Error("The browser could not encode the PNG.");
  download(blob, slugName(sample) + "-diffraction.png");
}
