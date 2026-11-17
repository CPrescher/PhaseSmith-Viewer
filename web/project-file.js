import { validateRanges } from "./plot-range.js";

// Portable projects embed the original CIF, not a path or a library URL.
// Keep this version independent of the browser's local session schema.
export const PROJECT_FORMAT = "phasesmith-viewer-project";
export const PROJECT_VERSION = 1;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const triple = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

function validateProject(project) {
  if (!record(project) || project.format !== PROJECT_FORMAT)
    throw Error("This is not a PhaseSmith Viewer project (.psv).");
  if (project.version !== PROJECT_VERSION)
    throw Error(`Project version ${project.version} is not supported by this viewer.`);
  const { document, state } = project;
  if (!record(document) || typeof document.text !== "string" || !document.text.trim() ||
      typeof document.filename !== "string" || !document.filename.trim())
    throw Error("The project is missing its embedded CIF structure.");
  if (!record(state) || typeof state.block !== "string" || !Array.isArray(state.ranges) ||
      !Array.isArray(state.rules) || !record(state.appearance) || !record(state.atoms) ||
      !record(state.lattice) || !record(state.camera) || !record(state.measure))
    throw Error("The project is missing its viewer settings.");
  validateRanges(state.ranges);
  if (![state.camera.position, state.camera.up, state.camera.target].every(triple))
    throw Error("The project's camera settings are invalid.");
  return project;
}

export function serializeProject({ document, state, theme }) {
  const project = validateProject({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    document,
    state,
    ...(theme === "light" || theme === "dark" ? { theme } : {}),
  });
  return JSON.stringify(project, null, 2) + "\n";
}

export function parseProject(text) {
  let project;
  try {
    project = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw Error("The project file is not valid JSON. Choose a saved .psv project.");
  }
  return validateProject(project);
}

export function projectFilename(name) {
  const stem = String(name || "structure").replace(/\.(?:psv|m?cif)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim();
  return `${stem || "structure"}.psv`;
}
