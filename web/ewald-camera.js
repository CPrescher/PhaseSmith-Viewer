// Viewed from the source looking along +x, lab +z is up and lab +y is left.
const beamYaw = -Math.PI / 2;
// Start side-on with lab +x (the incident beam) horizontally to the right.
export const initialCamera = () => ({ yaw: 0, elevation: Math.PI / 6, zoom: 1 });

export function cameraAxes({ yaw, elevation }) {
  const x = Math.cos(yaw),
    y = Math.sin(yaw);
  const c = Math.cos(elevation),
    s = Math.sin(elevation);
  return { right: [x, y, 0], up: [-y * s, x * s, c], eye: [y * c, -x * c, s] };
}

export function ewaldCamera(svg, onChange) {
  let view = initialCamera();
  const pointers = new Map();
  const limit = (value, min, max) => Math.max(min, Math.min(max, value));
  function zoom(factor) {
    view.zoom = limit(view.zoom * factor, 0.45, 4);
    onChange();
  }
  function orbit(dx, dy) {
    view.yaw -= dx;
    view.elevation = limit(view.elevation + dy, -Math.PI / 2, Math.PI / 2);
    onChange();
  }
  function reset() {
    view = initialCamera();
    onChange();
  }
  function span() {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  svg.onpointerdown = (e) => {
    if (e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  svg.onpointermove = (e) => {
    const old = pointers.get(e.pointerId);
    if (!old) return;
    const before = pointers.size === 2 ? span() : 0;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const scale = Math.PI / Math.max(100, svg.clientHeight);
      orbit((e.clientX - old.x) * scale, (e.clientY - old.y) * scale);
    } else if (before > 0) zoom(span() / before);
  };
  svg.onlostpointercapture = svg.onpointercancel = svg.onpointerup = (e) => pointers.delete(e.pointerId);
  svg.oncontextmenu = (e) => {
    e.preventDefault();
    view.zoom = 1;
    onChange();
  };
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 0 ? 1 : e.deltaMode === 1 ? 16 : svg.clientHeight;
      zoom(Math.exp(-limit(e.deltaY * unit, -500, 500) * 0.002));
    },
    { passive: false },
  );
  svg.onkeydown = (e) => {
    switch (e.key) {
      case "ArrowLeft":
        orbit(-0.12, 0);
        break;
      case "ArrowRight":
        orbit(0.12, 0);
        break;
      case "ArrowUp":
        orbit(0, -0.12);
        break;
      case "ArrowDown":
        orbit(0, 0.12);
        break;
      case "+":
      case "=":
        zoom(1.25);
        break;
      case "-":
        zoom(0.8);
        break;
      case "Home":
        reset();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  return {
    get view() {
      return view;
    },
    restore(saved) {
      view = initialCamera();
      if (saved && [saved.yaw,saved.elevation,saved.zoom].every(Number.isFinite))
        view = {yaw:saved.yaw, elevation:limit(saved.elevation,-Math.PI/2,Math.PI/2), zoom:limit(saved.zoom,0.45,4)};
      onChange();
    },
    zoom,
    alongBeam() {
      view.yaw = beamYaw;
      view.elevation = 0;
      onChange();
    },
    reset,
  };
}
