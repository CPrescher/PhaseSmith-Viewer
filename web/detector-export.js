import { saveBlob } from "./desktop.js";
import { slugName } from "./export.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const STYLE_KEYS = [
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
];

// The SVG snapshots have no access to the viewer's stylesheet.
// Freeze the paint and text styles, including the current theme and axis colors.
function freezeSvg(svg, idPrefix = "") {
  const copy = svg.cloneNode(true);
  const sourceEls = [...svg.querySelectorAll("*")];
  const copyEls = [...copy.querySelectorAll("*")];
  const rewriteUrl = (value) =>
    value.replace(/url\([^)]*#([^)"']+)["']?\)/g, (_, id) => `url(#${idPrefix}${id})`);
  const latticeNode = svg.querySelector(".lattice-node");
  if (latticeNode) {
    // A dense lattice can contain thousands of identically styled circles.
    // Inline opacity on individual nodes (depth attenuation) overrides this rule.
    const paint = getComputedStyle(latticeNode);
    const fill = rewriteUrl(paint.fill);
    const rule = document.createElementNS(SVG_NS, "style");
    rule.textContent = `.lattice-node { fill: ${fill}; }`;
    copy.prepend(rule);
  }
  sourceEls.forEach((el, i) => {
    const target = copyEls[i];
    if (el.classList.contains("detector-hover-readout")) {
      target.remove();
      return;
    }
    if (idPrefix) {
      if (target.hasAttribute("id")) target.setAttribute("id", idPrefix + target.getAttribute("id"));
      if (target.hasAttribute("clip-path"))
        target.setAttribute("clip-path", rewriteUrl(target.getAttribute("clip-path")));
    }
    if (el.classList.contains("lattice-node")) return;
    const style = getComputedStyle(el);
    for (const key of STYLE_KEYS) {
      const value = rewriteUrl(style.getPropertyValue(key));
      if (value) target.style.setProperty(key, value);
    }
  });
  return copy;
}

function snapshot(svg, scale) {
  const copy = freezeSvg(svg);
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

export function buildDetectorSVG({ sphere, detector, sample, settings, detectorSize }) {
  const plots = [sphere, detector];
  const sizes = plots.map((svg) => ({
    width: svg.viewBox.baseVal.width,
    height: svg.viewBox.baseVal.height,
  }));
  const pad = 14,
    top = 77;
  const width = sizes[0].width + sizes[1].width + 3 * pad;
  const height = top + Math.max(...sizes.map((s) => s.height)) + pad;
  const theme = getComputedStyle(sphere);
  const bgColor = theme.getPropertyValue("--field").trim() || "#0c1826";
  const textColor = theme.getPropertyValue("--text").trim() || "#dfe8f1";
  const mutedColor = theme.getPropertyValue("--muted").trim() || "#8aa0b5";

  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("xmlns", SVG_NS);
  root.setAttribute("width", String(Math.round(width)));
  root.setAttribute("height", String(Math.round(height)));
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", bgColor);
  root.append(bg);

  const addText = (x, y, text, font, fill = textColor) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.setAttribute("fill", fill);
    t.style.font = font;
    t.textContent = text;
    root.append(t);
    return t;
  };
  addText(pad, 23, sample, "600 17px system-ui, sans-serif", textColor);
  addText(pad, 43, settings, "12px system-ui, sans-serif", mutedColor);

  let x = pad;
  plots.forEach((svg, i) => {
    addText(x, top - 7, i === 0 ? "Ewald sphere" : "Detector · " + detectorSize, "600 13px system-ui, sans-serif", textColor);
    const frozen = freezeSvg(svg, i === 0 ? "ewald-" : "det-");
    frozen.setAttribute("x", String(x));
    frozen.setAttribute("y", String(top));
    frozen.setAttribute("width", String(sizes[i].width));
    frozen.setAttribute("height", String(sizes[i].height));
    frozen.removeAttribute("id");
    root.append(frozen);
    x += sizes[i].width + pad;
  });

  return new XMLSerializer().serializeToString(root);
}

export async function saveDetectorSVG(params) {
  const markup = buildDetectorSVG(params);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  await saveBlob(blob, slugName(params.sample) + "-diffraction.svg");
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
  await saveBlob(blob, slugName(sample) + "-diffraction.png");
}
