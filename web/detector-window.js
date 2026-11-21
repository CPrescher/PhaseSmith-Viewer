import { saveBlob } from "./desktop.js";
import { enableTripletSelection, numericKeys } from "./numeric-input.js";
import { maxScatteringVector } from "./diffraction-engine.js";
import { circularDetector, rectangularDetector, readPoni, calibratedDetector } from "./detector-geometry.js";
import { formatMillerIndices, parseMillerIndices, matMul } from "./crystal-math.js";
import { detectorModel } from "./detector-model.js";
import { drawEwald, drawDetector } from "./detector-views.js";
import { saveDetectorPNG } from "./detector-export.js";
import {
  dot3,
  identity,
  mountingMatrix,
  numbers,
  orientationExport,
  poniFrame,
  readMatrix,
  unitAxis,
  transpose,
} from "./detector-orientation.js";
import { cameraAxes, ewaldCamera } from "./ewald-camera.js";
import { focusLauncher, floatingDialog, isFrontDialog } from "./floating-dialog.js";

const millimeters = (value) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);

const signedAngle = (degrees) => (degrees > 180 ? degrees - 360 : degrees);
const wrappedAngle = (degrees) => ((degrees % 360) + 360) % 360;
const dragSnapPixels = 5;

export function createDetectorWindow({ getStructure, onExplain, onPeak, onMainView, getMainRotation }) {
  const $ = (id) => document.getElementById("detector-" + id);
  enableTripletSelection($("hkl"));
  const indexKeys = numericKeys($("hkl"), "(hkl)", true, { onDone: () => $("form").requestSubmit() });
  $("form").append(indexKeys);
  const win = $("window"),
    opener = document.getElementById("mode-detector");
  const show = floatingDialog(win, opener, $("head"), close);
  let panel = null,
    pendingCalibration = null,
    calibrationVersion = 0,
    previousGeometry, activeCalibration = null;
  let animationFrame = 0,
    animationGoal = null;
  $("animate").checked = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  function stopStep() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    animationGoal = null;
    win.removeAttribute("aria-busy");
  }
  let model,
    rock = 0,
    azimuth = 0,
    spots = [],
    chosen = null,
    tracked = null,
    message = "";
  let snapRemainder = null,
    closedRotation = null;
  let mounting = identity,
    spindle = [0, 0, 1],
    customMount = false,
    imported = null,
    fileVersion = 0;
  const sphereCamera = ewaldCamera($("ewald"), () => {
    redrawSphere();
    syncMain();
  });
  function redrawSphere() {
    if (model)
      drawEwald(
        $("ewald"),
        model,
        rock,
        azimuth,
        spots,
        tracked,
        sphereCamera.view,
        Number($("point-size").value) / 100,
      );
  }
  function redrawDetector() {
    if (model) drawDetector($("image"), model.detector, spots, chosen, $("ring").checked, select);
  }
  for (const button of win.querySelectorAll("[data-detector-view]")) {
    button.onclick = () => {
      win.querySelector(".detector-views").dataset.view = button.dataset.detectorView;
      for (const other of win.querySelectorAll("[data-detector-view]"))
        other.setAttribute("aria-pressed", String(other === button));
      redrawSphere();
      redrawDetector();
    };
  }
  function revealCrystal(on) {
    const controlsTop = document.querySelector("#view-readout")?.getBoundingClientRect().top || document.querySelector(".view-bottom")?.getBoundingClientRect().top || innerHeight - 80;
    win.style.setProperty("--linked-bottom", `${innerHeight - controlsTop + 12}px`);
    delete win.dataset.linkedResized;
    win.classList.toggle("showing-crystal", on);
    $("reveal").textContent = on ? "Show detector" : "Show crystal";
    $("reveal").setAttribute("aria-pressed", String(on));
    win.querySelector(".detector-body").scrollTop = 0;
  }
  $("reveal").onclick = () => revealCrystal(!win.classList.contains("showing-crystal"));
  $("link").addEventListener("change", () => {
    $("reveal").hidden = !$("link").checked;
    if (!$("link").checked) revealCrystal(false);
  });
  const plotSize = new ResizeObserver(() => {
    if (win.open) {
      redrawSphere();
      redrawDetector();
    }
  });
  plotSize.observe($("ewald"));
  plotSize.observe($("image"));
  function syncMain() {
    $("reveal").hidden = !$("link").checked;
    if (!$("link").checked && win.classList.contains("showing-crystal")) revealCrystal(false);
    if (!win.open || !model || !$("link").checked) return onMainView(null);
    const axes = cameraAxes(sphereCamera.view);
    // Express the Ewald camera in crystal coordinates using the same rotated
    // Cartesian basis that projects the unit cell in the sphere.
    const basis = transpose(model.orientation(rock, azimuth));
    onMainView({
      eye: basis.map((v) => dot3(v, axes.eye)),
      up: basis.map((v) => dot3(v, axes.up)),
      hkl: tracked?.hkl ?? null,
    });
  }
  function close() {
    stopStep();
    if ($("options").open) $("options").close();
    closedRotation = model && $("link").checked ? getMainRotation() : null;
    win.close();
    onMainView(null, true);
    opener.setAttribute("aria-expanded", "false");
    focusLauncher(opener);
  }
  function select(spot) {
    chosen = spot;
    if (spot) {
      tracked = spot.point;
      const p = spot.point;
      $("spots").value = p.hkl.join(" ");
      $("detail").textContent =
        "2θ = " +
        p.twoTheta.toFixed(3) +
        "° · d = " +
        (1 / p.length).toFixed(4) +
        " Å · " +
        (panel
          ? "column " + spot.col.toFixed(2) + " · row " + spot.row.toFixed(2)
          : "y = " + millimeters(spot.y) + " mm · z = " + millimeters(spot.z) + " mm") +
        " · |F|² = " +
        Number(p.intensity.toPrecision(4)) +
        " (" +
        Number((p.relativeIntensity * 100).toPrecision(3)) +
        "%)";
      onPeak({ twoTheta: p.twoTheta, wavelength: model.wavelength });
    } else {
      $("detail").textContent = "";
      onPeak(null);
    }
    $("explain").disabled = !spot;
    redrawSphere();
    syncMain();
    redrawDetector();
  }
  function render(prefer = null, snapped = false) {
    spots = model.spots(rock, azimuth);
    const signed = signedAngle(rock);
    $("omega").value = signed;
    $("set-angle").value = Number(signed.toFixed(6));
    $("azimuth").value = azimuth;
    $("omega-value").textContent = signed.toFixed(2) + "°";
    $("omega").setAttribute("aria-valuetext", signed.toFixed(2) + " degrees");
    $("azimuth-value").textContent = azimuth.toFixed(2) + "°";
    $("azimuth").setAttribute("aria-valuetext", azimuth.toFixed(2) + " degrees");
    $("spots").replaceChildren(
      ...spots.map(({ point: p }) => new Option("(" + formatMillerIndices(p.hkl) + ")", p.hkl.join(" "))),
    );
    $("spots").disabled = !spots.length;
    const selected = spots.find((s) => s.point === prefer) ?? spots[0] ?? null;
    $("status").textContent =
      message ||
      (spots.length
        ? (snapped ? "Snapped · " : "") +
          spots.length +
          (spots.length === 1 ? " spot" : " spots") +
          " on the detector."
        : "No spots at this angle. Marks on the rotation slider show observable reflections.");
    select(message && prefer && selected?.point !== prefer ? null : selected);
    if (!chosen) $("spots").selectedIndex = -1;
  }
  function geometry() {
    if (panel) return panel;
    if ($("outline").value === "rectangle")
      return rectangularDetector(
        Number($("width").value),
        Number($("height").value),
        Number($("distance").value),
      );
    return circularDetector(Number($("diameter").value));
  }
  function showDimensions() {
    const rectangle = $("outline").value === "rectangle";
    $("circle-field").hidden = Boolean(panel) || rectangle;
    $("width-field").hidden = $("height-field").hidden = Boolean(panel) || !rectangle;
    $("panel-field").hidden = !panel;
  }
  function configure(hkl, mount = customMount || panel ? 0 : undefined) {
    adoptModel(
      detectorModel(
        getStructure(),
        Number($("wavelength").value),
        Number($("distance").value),
        hkl,
        mount,
        mounting,
        spindle,
        geometry(),
      ),
    );
  }
  function adoptModel(prepared) {
    stopStep();
    model = prepared;
    $("size").textContent = model.detector.caption;
    showDimensions();
    $("geometry-error").textContent = "";
    if (panel)
      $("panel-size").value = Number(panel.width.toFixed(3)) + " × " + Number(panel.height.toFixed(3));
    $("image").setAttribute(
      "aria-label",
      panel
        ? "Predicted diffraction spots in calibrated image pixel coordinates"
        : "Diffraction spots viewed from the sample toward the detector",
    );
    $("view-caption").textContent = panel
      ? "File pixels · column right, row down · first center (0, 0)"
      : "Viewed from sample toward detector";
    $("axis-caption").textContent =
      "+ω axis · " +
      ((Math.acos(Math.max(-1, Math.min(1, model.axis[0]))) * 180) / Math.PI).toFixed(1) +
      "° to beam";
    $("save").disabled = false;
    $("save-error").textContent = "";
    tracked = model.requested;
    const sample = getStructure();
    $("sample").textContent = sample.name || sample.block || "Crystal";
    $("omega").disabled = $("azimuth").disabled = false;
    updateCrossings();
  }
  function updateCrossings() {
    model.setAzimuth(azimuth);
    const limits = model.observedLimits;
    const coverage = limits
      ? "Full rotation · " + limits.map((n, i) => "max |" + "hkl"[i] + "| = " + n).join(", ")
      : "No allowed reflections reach this detector in the scan";
    $("scope").textContent = model.searchOnly
      ? "Single-reflection search. Increase the wavelength or detector distance to scan the full detector."
      : coverage +
        " · 2θ coverage to " +
        model.maxAngle.toFixed(1) +
        "°" +
        (model.gMax > 2 * maxScatteringVector ? " (X-ray form-factor limit)" : "") +
        " · mounting tilt " +
        model.tilt.toFixed(1) +
        "°. Point area follows log-scaled PhaseSmith |F|² (100% = strongest in this search).";
    const marks = document.createElementNS("http://www.w3.org/2000/svg", "path");
    marks.setAttribute(
      "d",
      model.stops.map((e) => "M" + (signedAngle(e.angle) + 180).toFixed(3) + " 0v5").join(""),
    );
    $("crossings").replaceChildren(marks);
    updateWedge();
    $("prev").disabled = $("next").disabled = !model.stops.length;
  }
  function scanWedge() {
    return model.wedge($("from").valueAsNumber, $("to").valueAsNumber,
      $("cone").value === "" ? null : $("cone").valueAsNumber, azimuth);
  }
  function updateWedge() {
    if (!$("wedge").open) return;
    $("coverage-csv").disabled = true;
    try {
      if (!model || model.searchOnly) throw Error("A full detector search is required for wedge coverage.");
      const {events, continuous} = scanWedge();
      const unique = new Set(events.map(e => e.point.hkl.join()));
      $("coverage").textContent = unique.size + " distinct reflections · " + events.length + " crossings of the Ewald sphere in this rotation range" +
        (continuous ? ". " + continuous + " continuously excited indices excluded from the discrete count." : ".");
      $("coverage-csv").disabled = !events.length;
    } catch (error) { $("coverage").textContent = error.message; }
  }
  for (const id of ["from","to","cone"]) $(id).oninput = updateWedge;
  $("wedge").ontoggle = updateWedge;
  $("coverage-csv").onclick = async () => {
    const rows = ["h,k,l,omega_deg,two_theta_deg,d_A,F_squared"];
    for (const {point,omega} of scanWedge())
      rows.push([...point.hkl,omega,point.twoTheta,1/point.length,point.intensity].join(","));
    try {
      await saveBlob(new Blob([rows.join("\n")], { type: "text/csv" }), "phasesmith-rotation-wedge.csv");
    } catch (error) { $("coverage").textContent = error.message; }
  };
  $("project").onclick = () => document.getElementById("project-save").click();
  function align(fitFromExplorer = false) {
    const hkl = parseMillerIndices($("hkl").value);
    configure(hkl);
    let p = model.requested;
    message = "";
    // A handoff promises to show the requested spot. Fit a forward ray on
    // the circular sensor, while keeping manual detector settings explicit.
    const rectangle = !panel && model.detector.width !== undefined;
    const fitRadius = rectangle
      ? Math.min(model.detector.width, model.detector.height) / 2
      : model.detector.radius;
    if (
      !panel &&
      fitFromExplorer &&
      Number.isFinite(p.radius) &&
      p.radius > fitRadius &&
      !(p.continuous ? model.hit(p, rock, azimuth) : p.angles.some((angle) => model.hit(p, angle, azimuth)))
    ) {
      const distance = Math.floor((1000 * model.distance * 0.9 * fitRadius) / p.radius) / 1000;
      if (distance >= 0.001) {
        $("distance").value = distance;
        configure(hkl);
        p = model.requested;
        message = "Detector distance adjusted to " + distance + " mm to show this reflection.";
      }
    }
    if (p.twoTheta === null) message = "Beyond the Bragg limit at this wavelength.";
    else {
      rock = p.angles.find((angle) => model.hit(p, angle, azimuth)) ?? p.angles[0] ?? rock;
      if ((panel || rectangle) && (p.continuous || p.angles.length) && !model.hit(p, rock, azimuth))
        message = "This reflection misses the detector panel at this beam rotation.";
      else if (!panel && p.twoTheta >= 90) message = "The diffracted ray does not reach a forward detector.";
      else if (!panel && p.radius > model.detector.radius)
        message =
          "This reflection lands " +
          p.radius.toFixed(1) +
          " mm from the center, outside the detector. Reduce the distance.";
      else if (p.length > 2 * maxScatteringVector)
        message = "This reflection is outside the X-ray form-factor range.";
      else if (!p.angles.length && !p.continuous)
        message = "This reflection has no crossing about the selected scan axis.";
      else if (!model.intensity(p))
        message =
          "The reciprocal point is on the sphere, but the structure factor cancels. No spot for this reflection.";
    }
    render(p);
    $("hkl").value = hkl.join(" ");
  }
  function next(direction = 1, animate = false) {
    const event = model.next(animationGoal?.angle ?? rock, direction);
    stopStep();
    tracked = null;
    message = event ? "" : "No observable crossings in this scan.";
    if (!event || !animate || !$("animate").checked) {
      if (event) rock = event.angle;
      return render(event?.point);
    }
    const start = rock,
      delta = direction * wrappedAngle(direction * (event.angle - start));
    const duration = Math.min(550, 230 + Math.abs(delta) * 3);
    const began = performance.now();
    animationGoal = event;
    win.setAttribute("aria-busy", "true");
    function frame(now) {
      const t = Math.max(0, Math.min(1, (now - began) / duration));
      if (t >= 1) {
        stopStep();
        rock = event.angle;
        render(event.point);
      } else {
        rock = wrappedAngle(start + delta * t * t * (3 - 2 * t));
        tracked = event.point;
        render();
        animationFrame = requestAnimationFrame(frame);
      }
    }
    animationFrame = requestAnimationFrame(frame);
  }
  $("animate").onchange = () => {
    if (animationGoal && !$("animate").checked) {
      const goal = animationGoal;
      stopStep();
      rock = goal.angle;
      render(goal.point);
    }
  };
  function safely(action, cancelStep = true) {
    if (cancelStep) stopStep();
    try {
      action();
    } catch (error) {
      model = null;
      syncMain();
      $("crossings").replaceChildren();
      spots = [];
      chosen = null;
      $("status").textContent = error.message;
      if ($("options").open) $("geometry-error").textContent = error.message;
      for (const id of ["prev", "next", "explain", "omega", "azimuth", "spots", "save"])
        $(id).disabled = true;
      for (const id of [
        "size",
        "axis-caption",
        "sample",
        "scope",
        "ewald",
        "image",
        "spots",
        "detail",
        "omega-value",
        "azimuth-value",
      ])
        $(id).replaceChildren();
      onPeak(null);
    }
  }
  function open(hkl, wavelength) {
    const startingView = !win.open || !model;
    show();
    safely(() => {
      const resume = startingView && model && closedRotation && $("link").checked;
      const previous = closedRotation;
      closedRotation = null;
      if (startingView && !resume) sphereCamera.reset();
      if (resume) {
        const current = getMainRotation();
        if (current.some((row, i) => row.some((v, j) => Math.abs(v - previous[i][j]) > 1e-10)))
          api.rotateSpecimen(current, 0);
      }
      if (hkl) {
        $("hkl").value = hkl.join(" ");
        if (!panel) $("wavelength").value = wavelength;
        align(true);
      } else if (!model) {
        configure(null);
        next();
      } else syncMain();
    });
  }
  opener.onclick = () => win.open ? (isFrontDialog(win) ? close() : show()) : open();
  $("close").onclick = close;
  let optionsParentLayout = null;
  const showOptions = floatingDialog($("options"), $("open-options"), $("options").querySelector("header"), () => $("options").close());
  $("open-options").onclick = () => {
    if ($("options").open) return $("options").close();
    const placeAutomatically = $("options").dataset.userMoved !== "true";
    showOptions();
    if (placeAutomatically && innerWidth >= 1000) {
      // Keep most of the live detector visible while its geometry is edited.
      const rect = win.getBoundingClientRect(), right = rect.right + 12;
      const limit = document.getElementById("tool-rail").getBoundingClientRect().left - 8;
      const rightSpace = limit - right, leftSpace = rect.left - 20;
      const space = Math.max(rightSpace, leftSpace);
      if (space >= 300) {
        const width = Math.min(420, space);
        $("options").style.width = width + "px";
        $("options").style.left = (rightSpace >= leftSpace ? right : rect.left - width - 12) + "px";
      } else $("options").style.left = "8px";
      $("options").style.top = Math.max(8, rect.top) + "px";
    } else if (placeAutomatically && innerWidth >= 740 && innerHeight > 500) {
      // Temporarily narrow the tablet inspector so both windows, including
      // the diagram tabs and both headers, remain usable side by side.
      const limit = document.getElementById("tool-rail").getBoundingClientRect().left - 12;
      const width = Math.min(360, limit - 324);
      optionsParentLayout = { left: win.style.left, width: win.style.width, temporaryWidth: width, viewport: innerWidth };
      win.style.left = "12px";
      win.style.width = width + "px";
      $("options").style.width = "300px";
      $("options").style.left = (width + 24) + "px";
      $("options").style.top = win.getBoundingClientRect().top + "px";
    } else if (placeAutomatically) {
      $("options").style.left = "8px";
      $("options").style.top = "8px";
    }
  };
  $("options-done").onclick = () => $("options").close();
  $("options").onclose = () => {
    if (optionsParentLayout) {
      const prior = optionsParentLayout;
      // Respect a subsequent manual drag/resize, or a screen-size change.
      if (innerWidth === prior.viewport && win.style.left === "12px" && win.style.width === prior.temporaryWidth + "px") {
        win.style.left = prior.left;
        win.style.width = prior.width;
      }
      optionsParentLayout = null;
    }
    if (win.open) $("open-options").focus({ preventScroll: true });
  };
  $("form").onsubmit = (event) => {
    event.preventDefault();
    safely(align);
  };
  for (const id of ["wavelength", "distance", "diameter", "outline", "width", "height"])
    $(id).onchange = () =>
      safely(() => {
        showDimensions();
        const mount = model?.tilt ?? 0;
        configure(model?.requested?.hkl ?? null, mount);
        tracked = null;
        message = "";
        render();
      });
  $("prev").onclick = () => safely(() => next(-1, true), false);
  $("next").onclick = () => safely(() => next(1, true), false);
  const slider = $("omega");
  let lastSliderAngle = null;
  function scrubTo(raw) {
    safely(() => {
      const tolerance = Math.min(8, (360 * 4) / Math.max(1, slider.clientWidth - 16));
      const event = model.scrub(lastSliderAngle ?? rock, raw, tolerance);
      lastSliderAngle = raw;
      tracked = null;
      message = "";
      rock = event ? (event.angle === 180 && raw < 0 ? -180 : event.angle) : raw;
      render(event?.point);
    });
  }
  // Use the same eight-pixel insets as the crossing marks, including on
  // touch browsers whose native range track has different end padding.
  function pointerAngle(e) {
    const rect = slider.getBoundingClientRect();
    return -180 + 360 * Math.max(0, Math.min(1, (e.clientX - rect.left - 8) / Math.max(1, rect.width - 16)));
  }
  slider.onpointerdown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(e.pointerId);
    lastSliderAngle = rock;
    scrubTo(pointerAngle(e));
  };
  slider.onpointermove = (e) => {
    if (slider.hasPointerCapture(e.pointerId)) scrubTo(pointerAngle(e));
  };
  slider.onlostpointercapture = () => {
    lastSliderAngle = null;
  };
  slider.oninput = () => scrubTo(Number(slider.value));
  $("omega").onkeydown = (e) => {
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      safely(() => {
        lastSliderAngle = null;
        tracked = null;
        message = "";
        rock = e.key === "Home" ? -180 : 180;
        render();
      });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    lastSliderAngle = null;
    safely(() => next(e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1, true), false);
  };
  $("azimuth").oninput = () =>
    safely(() => {
      azimuth = Number($("azimuth").value);
      if (model.detector.project) updateCrossings();
      message = "";
      render(chosen?.point);
    });
  function resetMountForm() {
    mounting = identity;
    spindle = [0, 0, 1];
    customMount = false;
    imported = null;
    fileVersion++;
    $("mount-form").reset();
    $("frame").querySelector('option[value="file"]')?.remove();
    $("candidate").replaceChildren();
    $("candidate-field").hidden = true;
    $("mount-status").textContent = "";
  }
  function populateCandidate() {
    const candidate = imported.candidates[$("candidate").selectedIndex];
    $("matrix").value = candidate.matrix.map((row) => row.join(" ")).join("\n");
    $("convention").value = candidate.type;
  }
  $("orientation-file").onchange = async (event) => {
    const version = ++fileVersion;
    const file = event.target.files[0];
    if (!file) return;
    try {
      const data = orientationExport(JSON.parse(await file.text()));
      if (version !== fileVersion) return;
      imported = data;
      $("candidate").replaceChildren(...data.candidates.map((entry, i) => new Option(entry.name, String(i))));
      $("candidate-field").hidden = data.candidates.length < 2;
      $("frame").querySelector('option[value="file"]')?.remove();
      if (data.frame) {
        $("frame").add(new Option("From file · beam and spindle", "file"));
        $("frame").value = "file";
        $("axis").value = data.axis.map((v) => Number(v.toPrecision(12))).join(" ");
      }
      $("set-angle").value = 0;
      populateCandidate();
      $("mount-status").textContent =
        "Loaded " +
        file.name +
        (data.frame
          ? ". Apply orientation to use this mounting."
          : ". Choose the matrix frame and scan axis, then apply.");
    } catch (error) {
      if (version === fileVersion) $("mount-status").textContent = error.message;
    }
  };
  $("candidate").onchange = populateCandidate;
  $("mount-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      const frame =
        $("frame").value === "file" ? imported.frame : $("frame").value === "poni" ? poniFrame : identity;
      const nextMount = mountingMatrix(
        readMatrix($("matrix").value),
        $("convention").value,
        frame,
        getStructure().basis,
      );
      const nextAxis = unitAxis(numbers($("axis").value));
      const angle = Number($("set-angle").value);
      if (!Number.isFinite(angle)) throw Error("Enter a finite rotation angle.");
      // Prepare the scan before committing edited geometry.
      const prepared = detectorModel(
        getStructure(),
        Number($("wavelength").value),
        Number($("distance").value),
        model?.requested?.hkl,
        0,
        nextMount,
        nextAxis,
        geometry(),
      );
      mounting = nextMount;
      spindle = nextAxis;
      customMount = true;
      rock = angle >= -180 && angle <= 180 ? angle : wrappedAngle(angle);
      azimuth = 0;
      adoptModel(prepared);
      tracked = null;
      message = "";
      render();
      $("mount-status").textContent = "Orientation applied. The scan starts from this matrix at ω = 0°.";
    } catch (error) {
      $("mount-status").textContent = error.message;
    }
  };
  $("clear-mount").onclick = () =>
    safely(() => {
      resetMountForm();
      rock = azimuth = 0;
      configure(null);
      message = "";
      render();
    });
  function applyCalibration(hkl = model?.requested?.hkl ?? chosen?.point.hkl ?? null, tilt = 0) {
    const { data, name } = pendingCalibration;
    const shape = [$("rows"), $("cols")].map((el) => Number(el.value));
    const detector = calibratedDetector(data, shape);
    const wavelength = data.wavelength ?? Number($("wavelength").value);
    const prepared = detectorModel(
      getStructure(),
      wavelength,
      data.distance,
      hkl,
      tilt,
      mounting,
      spindle,
      detector,
    );
    if (!panel)
      previousGeometry = {
        outline: $("outline").value,
        distance: $("distance").value,
        wavelength: $("wavelength").value,
      };
    panel = detector;
    activeCalibration = {text: pendingCalibration.text, name, shape};
    $("outline").value = "calibrated";
    $("outline").disabled = true;
    $("distance").value = data.distance;
    $("wavelength").value = wavelength;
    $("distance").disabled = $("diameter").disabled = true;
    $("clear-poni").hidden = false;
    adoptModel(prepared);
    message = "";
    render();
    $("poni-status").textContent =
      name +
      " · " +
      detector.caption +
      ". Set the crystal mounting and scan axis under Orientation. Coordinates refer to the calibrated image. Custom pixel masks are omitted.";
  }
  $("poni").onchange = async (e) => {
    const version = ++calibrationVersion,
      file = e.target.files[0];
    pendingCalibration = null;
    $("shape").hidden = true;
    if (!file) return;
    try {
      const text = await file.text();
      const data = readPoni(text);
      if (version !== calibrationVersion) return;
      pendingCalibration = { data, text, name: file.name };
      $("rows").value = data.shape?.[0] ?? "";
      $("cols").value = data.shape?.[1] ?? "";
      $("shape").hidden = false;
      if (data.shape) applyCalibration();
      else $("poni-status").textContent = "Enter the calibrated image shape for " + file.name + ".";
    } catch (error) {
      if (version === calibrationVersion) $("poni-status").textContent = error.message;
    }
  };
  $("shape").onsubmit = (e) => {
    e.preventDefault();
    try {
      applyCalibration();
    } catch (error) {
      $("poni-status").textContent = error.message;
    }
  };
  $("clear-poni").onclick = () =>
    safely(() => {
      activeCalibration = panel = pendingCalibration = null;
      calibrationVersion++;
      $("poni").value = "";
      $("poni-status").textContent = "";
      $("shape").hidden = $("clear-poni").hidden = true;
      $("distance").disabled = $("diameter").disabled = false;
      $("outline").disabled = false;
      $("outline").value = previousGeometry.outline;
      showDimensions();
      $("distance").value = previousGeometry.distance;
      $("wavelength").value = previousGeometry.wavelength;
      configure(model?.requested?.hkl ?? null);
      message = "";
      render();
    });
  $("link").onchange = syncMain;
  document.getElementById("ewald-beam").onclick = sphereCamera.alongBeam;
  document.getElementById("ewald-in").onclick = () => sphereCamera.zoom(1.25);
  document.getElementById("ewald-out").onclick = () => sphereCamera.zoom(0.8);
  document.getElementById("ewald-reset").onclick = sphereCamera.reset;
  $("point-size").oninput = () => {
    $("point-scale").value = $("point-size").value + "%";
    redrawSphere();
  };
  $("ring").onchange = redrawDetector;
  $("save").onclick = async () => {
    $("save-error").textContent = "";
    try {
      await saveDetectorPNG({
        sphere: $("ewald"),
        detector: $("image"),
        detectorSize: model.detector.caption,
        sample: $("sample").textContent,
        settings: `λ = ${model.wavelength} Å · Distance ${model.distance} mm · ω = ${$("omega-value").textContent} · Beam rotation ${$("azimuth-value").textContent}`,
      });
    } catch {
      $("save-error").textContent = "Could not save the diffraction image. Please try again.";
    }
  };
  $("spots").onchange = () => select(spots[$("spots").selectedIndex]);
  $("explain").onclick = () => {
    if (chosen) onExplain(chosen.point.hkl, model.wavelength);
  };
  const api = {
    open,
    exportState() {
      if (!model) return null;
      return {open:win.open, mounting, spindle, customMount, tilt:model.tilt, rock, azimuth,
        hkl:model.requested?.hkl, selected:chosen?.point.hkl, tracked:tracked?.hkl, query:$("hkl").value,
        calibration:activeCalibration, manual: panel ? previousGeometry : null,
        outline:$("outline").value, wavelength:model.wavelength, distance:model.distance,
        diameter:$("diameter").value, width:$("width").value, height:$("height").value,
        camera:{...sphereCamera.view}, ring:$("ring").checked, link:$("link").checked,
        pointSize:$("point-size").value, animate:$("animate").checked,
        wedge:$("wedge").open, from:$("from").value, to:$("to").value, cone:$("cone").value};
    },
    restoreState(state) {
      if (win.open) close();
      stopStep();
      resetMountForm();
      closedRotation = null;
      model = activeCalibration = pendingCalibration = panel = null;
      calibrationVersion++;
      $("shape").hidden = $("clear-poni").hidden = true;
      $("poni").value = $("poni-status").textContent = "";
      $("outline").disabled = $("distance").disabled = $("diameter").disabled = false;
      $("outline").value = "circle";
      $("link").checked = false;
      for (const id of ["wavelength", "distance", "width", "height", "diameter", "from", "to", "cone"])
        $(id).value = state?.[id] ?? $(id).defaultValue;
      $("wedge").open = state?.wedge === true;
      if (!state) {
        $("point-size").value = $("point-size").defaultValue;
        $("point-scale").value = $("point-size").value + "%";
        $("ring").checked = $("ring").defaultChecked;
        $("animate").checked = $("animate").defaultChecked;
        showDimensions();
        return;
      }
      if (state.open) show();
      safely(() => {
        // Saved mounting is already in the internal Cartesian frame.
        mountingMatrix(state.mounting, "U", identity, identity);
        mounting = state.mounting;
        spindle = unitAxis(state.spindle);
        customMount = Boolean(state.customMount);
        $("matrix").value = mounting.map(row => row.join(" ")).join("\n");
        $("axis").value = spindle.join(" ");
        $("outline").value = state.outline === "rectangle" ? "rectangle" : "circle";
        rock = Number.isFinite(state.rock) ? state.rock : 0;
        azimuth = Number.isFinite(state.azimuth) ? state.azimuth : 0;
        const hkl = state.hkl == null ? null : parseMillerIndices(state.hkl.join(" "));
        const tilt = Number.isFinite(state.tilt) ? state.tilt : 0;
        if (state.calibration) {
          const {text,name,shape} = state.calibration;
          pendingCalibration = {text,name,data:readPoni(text)};
          $("rows").value = shape[0]; $("cols").value = shape[1];
          $("shape").hidden = false;
          applyCalibration(hkl, tilt);
          previousGeometry = state.manual ?? previousGeometry;
        } else configure(hkl, tilt);
        $("hkl").value = state.query ?? "2 0 0";
        $("point-size").value = state.pointSize ?? 100;
        $("point-scale").value = $("point-size").value + "%";
        $("ring").checked = state.ring !== false;
        $("animate").checked = state.animate === true;
        $("link").checked = state.link === true;
        sphereCamera.restore(state.camera);
        message = "";
        updateCrossings();
        const active = model.spots(rock,azimuth);
        const selected = active.find(s => s.point.hkl.join() === state.selected?.join());
        tracked = active.find(s => s.point.hkl.join() === state.tracked?.join())?.point ?? model.requested;
        render(selected?.point);
      });
    },
    beginSpecimenDrag() {
      snapRemainder = null;
    },
    rotateSpecimen(cameraFromCrystal, degreesPerPixel) {
      if (!model || !win.open || !$("link").checked) return;
      stopStep();
      const { right, up, eye } = cameraAxes(sphereCamera.view);
      let end = matMul(transpose([right, up, eye]), cameraFromCrystal);
      const start = model.orientation(rock, azimuth);
      // Each sample starts from the current trackball orientation. Restore
      // just the motion held back at the preceding reflection.
      if (degreesPerPixel && snapRemainder) end = matMul(end, snapRemainder);
      const crossing = degreesPerPixel
        ? model.crossedDuringTurn(start, end, dragSnapPixels * degreesPerPixel, chosen?.point)
        : null;
      snapRemainder = crossing?.remainder ?? null;
      ({ rock, azimuth } = model.followTurn(start, crossing?.orientation ?? end, rock, azimuth));
      if (mounting !== model.mounting) {
        mounting = model.mounting;
        customMount = true;
        $("convention").value = "U";
        $("frame").value = "viewer";
        $("axis").value = model.axis.map((v) => Number(v.toPrecision(12))).join(" ");
        $("matrix").value = mounting
          .map((row) => row.map((v) => Number(v.toPrecision(12))).join(" "))
          .join("\n");
        $("mount-status").textContent = "Mounting set by rotating the linked main crystal.";
      }
      updateCrossings();
      tracked = null;
      message = "";
      render(crossing?.point ?? chosen?.point, Boolean(crossing));
    },
    setStructure() {
      stopStep();
      if (closedRotation) $("link").checked = false;
      closedRotation = null;
      model = null;
      resetMountForm();
      rock = azimuth = 0;
      $("hkl").value = "2 0 0";
      if (win.open) open();
    },
  };
  return api;
}
