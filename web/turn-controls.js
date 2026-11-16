// Step-turn controls: the Turn button, the panel with 90°/60°/45° presets,
// a custom angle, an 8-direction pad and clockwise/counterclockwise roll.
// UI only — the viewer supplies onTurn(action, degrees) and isBusy().
//
// Placement: a popover under the view toolbar on larger screens; on phones
// (phoneLayout matches) the panel moves into the lower pane right below the
// mode bar, so an open pad never covers the crystal. It stays open for
// repeated turns and closes with ✕, Escape, the Turn button again, or a
// press outside both the panel and the Turn button.

const LABELS = {
  left: "Turn the crystal left",
  right: "Turn the crystal right",
  up: "Tilt the crystal up (top away from you)",
  down: "Tilt the crystal down (top toward you)",
  "up-left": "Turn the crystal diagonally up and left",
  "up-right": "Turn the crystal diagonally up and right",
  "down-left": "Turn the crystal diagonally down and left",
  "down-right": "Turn the crystal diagonally down and right",
  clockwise: "Roll the crystal clockwise in the screen plane",
  counterclockwise: "Roll the crystal counterclockwise in the screen plane",
};

export function parseTurnAngle(text) {
  const value = Number(String(text).trim().replace(",", ".").replace(/°$/, ""));
  return Number.isFinite(value) && value > 0 && value <= 360 ? value : null;
}

export function createTurnControls({ onTurn, isBusy, phoneLayout, paneAnchor, onOpenChange = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const panel = $("turn-panel"),
    open = $("turn-open"),
    close = $("turn-close"),
    input = $("turn-angle"),
    error = $("turn-angle-error"),
    readout = $("turn-angle-readout");
  const home = { parent: panel.parentElement, next: panel.nextElementSibling };
  const presets = [...panel.querySelectorAll(".turn-preset")];
  const actions = [...panel.querySelectorAll("[data-turn]")];
  let angle = 90;

  const fmt = (v) => String(Number(v.toFixed(3)));
  function setAngle(value, { fromInput = false } = {}) {
    angle = value;
    if (!fromInput) input.value = fmt(value);
    input.setCustomValidity("");
    error.textContent = "";
    readout.textContent = `${fmt(value)}°`;
    for (const b of presets) b.setAttribute("aria-pressed", String(Number(b.dataset.angle) === value));
    for (const b of actions) {
      const text = `${LABELS[b.dataset.turn]} by ${fmt(value)}°`;
      b.setAttribute("aria-label", text);
      b.title = text;
    }
  }
  // Custom angle: validated on Enter/change; a valid typed value applies
  // immediately (so a turn right after typing uses it).
  function commitInput(report) {
    const value = parseTurnAngle(input.value);
    if (value === null) {
      const message = "Enter an angle greater than 0 and at most 360°.";
      input.setCustomValidity(message);
      error.textContent = message;
      if (report) input.reportValidity?.();
      return false;
    }
    setAngle(value, { fromInput: true });
    return true;
  }
  input.addEventListener("input", () => commitInput(false));
  input.addEventListener("change", () => commitInput(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitInput(true);
    }
  });
  for (const b of presets) b.onclick = () => setAngle(Number(b.dataset.angle));
  for (const b of actions)
    b.onclick = () => {
      if (isBusy()) return;
      // A pending invalid custom entry must not silently turn by the old angle.
      if (!commitInput(true)) return;
      onTurn(b.dataset.turn, angle);
    };

  function place() {
    const inPane = phoneLayout.matches;
    panel.classList.toggle("in-pane", inPane);
    if (inPane) {
      if (panel.parentElement !== paneAnchor.parentElement || panel.nextElementSibling !== paneAnchor)
        paneAnchor.before(panel);
    } else if (panel.parentElement !== home.parent) home.parent.insertBefore(panel, home.next);
  }
  function setOpen(show, { focus = false } = {}) {
    if (show === !panel.hidden) return;
    if (show) {
      // Only one popover under the toolbar at a time.
      const uvw = document.querySelector(".view-directions details");
      if (uvw?.open) uvw.open = false;
      place();
    }
    panel.hidden = !show;
    open.setAttribute("aria-expanded", String(show));
    // Plane labels avoid the open popover: re-place them now.
    onOpenChange(show);
    if (show && phoneLayout.matches) panel.scrollIntoView({ block: "nearest" });
    if (focus) (show ? panel.querySelector(".turn-preset[aria-pressed='true']") ?? close : open).focus({ preventScroll: true });
  }
  open.onclick = () => setOpen(panel.hidden);
  close.onclick = () => setOpen(false, { focus: true });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false, { focus: true });
    }
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || open.contains(e.target)) return;
      setOpen(false);
    },
    true,
  );
  document.querySelector(".view-directions details")?.addEventListener("toggle", (e) => {
    if (e.target.open) setOpen(false);
  });
  phoneLayout.addEventListener?.("change", () => {
    place();
    onOpenChange(!panel.hidden);
  });
  place();
  setAngle(angle);

  return {
    setDisabled(disabled) {
      open.disabled = disabled;
      for (const el of panel.querySelectorAll("button, input")) if (el !== close) el.disabled = disabled;
    },
    diagnostics: () => ({
      open: !panel.hidden,
      angle,
      placement: panel.classList.contains("in-pane") ? "lower-pane" : "popover",
      inputValid: input.validity ? input.validity.valid : true,
    }),
    get angle() {
      return angle;
    },
    /** Session restore: a validated angle; invalid values are ignored. */
    setAngle(value) {
      const v = parseTurnAngle(value);
      if (v !== null) setAngle(v);
      return v !== null;
    },
  };
}
