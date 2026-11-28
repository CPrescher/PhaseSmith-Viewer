// Shared X-ray radiation state for the Diffraction workspace (Powder,
// Reflection, Detector). Pure state store with no DOM dependencies.

export const RADIATION_LIMITS = Object.freeze({ min: 0.01, max: 5 }); // Å

export const RADIATION_PRESETS = Object.freeze([
  Object.freeze({ id: "cu-ka1", label: "Cu Kα₁", wavelength: 1.540598 }),
  Object.freeze({ id: "mo-ka1", label: "Mo Kα₁", wavelength: 0.709300 }),
  Object.freeze({ id: "mo-ka", label: "Mo Kα", wavelength: 0.71073 }),
  Object.freeze({ id: "ag-ka1", label: "Ag Kα₁", wavelength: 0.559421 }),
  Object.freeze({ id: "ag-ka", label: "Ag Kα", wavelength: 0.56087 }),
]);

const PRESET_BY_ID = new Map(RADIATION_PRESETS.map((p) => [p.id, p]));
const PRESET_TOLERANCE = 5e-5; // Å (matches 4-decimal displays like 1.5406, 0.7093, 0.5594)
const DEFAULT_WAVELENGTH = RADIATION_PRESETS[0].wavelength;

/** Photon energy in keV for a wavelength in Å (hc = 12.398420 keV·Å). */
export const keV = (lambda) => 12.398420 / lambda;

/** Return the matching preset ID for `wavelength`, or "custom". */
export function matchRadiationPreset(wavelength) {
  if (!Number.isFinite(wavelength)) return "custom";
  for (const preset of RADIATION_PRESETS) {
    if (Math.abs(wavelength - preset.wavelength) < PRESET_TOLERANCE) return preset.id;
  }
  return "custom";
}

export function validateWavelength(wavelength) {
  const value = Number(wavelength);
  if (!Number.isFinite(value) || value < RADIATION_LIMITS.min || value > RADIATION_LIMITS.max) {
    throw Error(
      `Wavelength must be between ${RADIATION_LIMITS.min} and ${RADIATION_LIMITS.max} Å.`,
    );
  }
  return value;
}

function sameLock(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.name === b.name;
}

/**
 * Shared radiation store.
 *
 * State shape: `{ preset, wavelength, lockedBy: null | { kind: "poni", name } }`.
 * Emits to subscribers only when state actually changes; never recomputes
 * diffraction data itself.
 */
export function createRadiation(initial = { preset: "cu-ka1", wavelength: DEFAULT_WAVELENGTH }) {
  let wavelength = DEFAULT_WAVELENGTH;
  let preset = "cu-ka1";
  let lockedBy = null;
  const listeners = new Set();

  function resolveInitial(input) {
    if (!input || typeof input !== "object") return { preset: "cu-ka1", wavelength: DEFAULT_WAVELENGTH };
    if (input.wavelength != null) {
      const value = Number(input.wavelength);
      if (Number.isFinite(value) && value >= RADIATION_LIMITS.min && value <= RADIATION_LIMITS.max) {
        return { preset: matchRadiationPreset(value), wavelength: value };
      }
    }
    if (typeof input.preset === "string" && PRESET_BY_ID.has(input.preset)) {
      const entry = PRESET_BY_ID.get(input.preset);
      return { preset: entry.id, wavelength: entry.wavelength };
    }
    return { preset: "cu-ka1", wavelength: DEFAULT_WAVELENGTH };
  }

  ({ preset, wavelength } = resolveInitial(initial));

  const snapshot = () =>
    Object.freeze({
      preset,
      wavelength,
      lockedBy: lockedBy ? Object.freeze({ ...lockedBy }) : null,
    });

  function emit() {
    const current = snapshot();
    for (const fn of [...listeners]) fn(current);
  }

  function set(patch, { force = false } = {}) {
    if (!patch || typeof patch !== "object") return false;
    if (lockedBy && !force) return false;
    let nextWavelength = wavelength;
    let nextPreset = preset;
    if (patch.wavelength !== undefined) {
      nextWavelength = validateWavelength(patch.wavelength);
      nextPreset = matchRadiationPreset(nextWavelength);
    } else if (patch.preset !== undefined) {
      if (patch.preset === "custom") {
        nextPreset = "custom";
      } else {
        const entry = PRESET_BY_ID.get(patch.preset);
        if (!entry) throw Error(`Unknown radiation preset: ${patch.preset}`);
        nextPreset = entry.id;
        nextWavelength = entry.wavelength;
      }
    }
    if (Math.abs(nextWavelength - wavelength) < 1e-12 && nextPreset === preset) return false;
    wavelength = nextWavelength;
    preset = nextPreset;
    emit();
    return true;
  }

  function lock(info, nextWavelength) {
    const nextLock =
      info && typeof info === "object"
        ? { kind: String(info.kind || "poni"), name: String(info.name || "") }
        : { kind: "poni", name: "" };
    let changed = !sameLock(lockedBy, nextLock);
    if (nextWavelength !== undefined && nextWavelength !== null) {
      const valid = validateWavelength(nextWavelength);
      const matched = matchRadiationPreset(valid);
      if (Math.abs(valid - wavelength) >= 1e-12 || matched !== preset) {
        wavelength = valid;
        preset = matched;
        changed = true;
      }
    }
    lockedBy = nextLock;
    if (changed) emit();
    return changed;
  }

  function unlock() {
    if (!lockedBy) return false;
    lockedBy = null;
    emit();
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") throw TypeError("Radiation subscriber must be a function.");
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function exportState() {
    return { preset, wavelength };
  }

  function restoreState(raw) {
    const next = resolveInitial(raw);
    const changed =
      Math.abs(next.wavelength - wavelength) >= 1e-12 ||
      next.preset !== preset ||
      lockedBy !== null;
    wavelength = next.wavelength;
    preset = next.preset;
    lockedBy = null;
    if (changed) emit();
    return changed;
  }

  return {
    get state() {
      return snapshot();
    },
    get wavelength() {
      return wavelength;
    },
    get preset() {
      return preset;
    },
    get lockedBy() {
      return lockedBy ? { ...lockedBy } : null;
    },
    get locked() {
      return lockedBy !== null;
    },
    set,
    lock,
    unlock,
    subscribe,
    exportState,
    restoreState,
  };
}
