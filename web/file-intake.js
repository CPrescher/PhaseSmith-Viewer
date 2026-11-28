// Full-window drag-and-drop file intake and clipboard paste (CIF / .psv).
// Files stay local: nothing is uploaded or fetched.

import { PROJECT_FORMAT } from "./project-file.js";

const TRACE_EXTENSION = /\.(xy|xye|dat|csv|txt)$/i;
const PONI_EXTENSION = /\.poni$/i;

/** Classify plain text from the clipboard as a CIF, a .psv project, or null. */
export function classifyPastedText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed.replace(/^\uFEFF/, ""));
      if (parsed && typeof parsed === "object" && parsed.format === PROJECT_FORMAT) {
        return { kind: "project", text };
      }
    } catch {
      /* not valid JSON; fall through */
    }
  }
  if (/^\s*data_\S+/m.test(text) && /_cell_length_a|_atom_site_/i.test(text)) {
    return { kind: "cif", text };
  }
  return null;
}

function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  if (target.isContentEditable) return true;
  if (target.closest?.('textarea, [role="textbox"], [contenteditable="true"]')) return true;
  if (target.tagName === "INPUT") {
    return !["range", "checkbox", "radio", "button", "submit", "color", "file"].includes(target.type);
  }
  return false;
}

function hasFileTransfer(event) {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

/**
 * Wire full-window drag-and-drop and clipboard paste intake.
 *
 * Options:
 *   overlay         – #drop-overlay element
 *   isBusy()        – true while an export is running
 *   isPowderActive() – true when the Powder panel is visible/active
 *   onBeforeOpen()  – called before opening a dropped/pasted structure (e.g. close library)
 *   onStructureFile(file)
 *   onTraceFile(file)
 *   onPoniFile(file)
 *   onPasteCif(text)
 *   onPasteProject(text)
 *   onToast(message)
 */
export function createFileIntake({
  overlay = null,
  isBusy = () => false,
  isPowderActive = () =>
    Boolean(document.querySelector("#xrd-workspace:not([hidden]) #xrd-panel-powder:not([hidden])")),
  onBeforeOpen = () => {},
  onStructureFile = () => {},
  onTraceFile = () => {},
  onPoniFile = () => {},
  onPasteCif = () => {},
  onPasteProject = () => {},
  onToast = () => {},
} = {}) {
  let dragDepth = 0;

  function showOverlay() {
    if (overlay) overlay.hidden = false;
  }
  function hideOverlay() {
    dragDepth = 0;
    if (overlay) overlay.hidden = true;
  }

  function onDragEnter(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    dragDepth++;
    showOverlay();
    if (event.dataTransfer) event.dataTransfer.dropEffect = isBusy() ? "none" : "copy";
  }

  function onDragOver(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = isBusy() ? "none" : "copy";
  }

  function onDragLeave(event) {
    if (!hasFileTransfer(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOverlay();
  }

  function onDrop(event) {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    const target = event.target;
    hideOverlay();
    if (isBusy()) {
      onToast("Wait for the export to finish.");
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const [file] = files;
    if (files.length > 1) {
      onToast(`Opened ${file.name}. Drop one file at a time.`);
    }
    const inPowder =
      Boolean(target?.closest?.("#xrd-workspace:not([hidden]) #xrd-panel-powder:not([hidden])")) &&
      isPowderActive();
    if (inPowder && TRACE_EXTENSION.test(file.name)) {
      onTraceFile(file);
      return;
    }
    const inDetector = Boolean(target?.closest?.("#detector-window, #detector-options"));
    if (inDetector && PONI_EXTENSION.test(file.name)) {
      onPoniFile(file);
      return;
    }
    onBeforeOpen();
    onStructureFile(file);
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && dragDepth > 0) hideOverlay();
  }

  function onPaste(event) {
    if (isBusy() || isEditableTarget(event.target)) return;
    const text = event.clipboardData?.getData("text/plain");
    const classified = classifyPastedText(text);
    if (!classified) return;
    event.preventDefault();
    onBeforeOpen();
    if (classified.kind === "project") {
      onPasteProject(classified.text);
    } else {
      onPasteCif(classified.text);
      onToast("Opened pasted CIF.");
    }
  }

  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("paste", onPaste);
  window.addEventListener("blur", hideOverlay);

  return {
    hideOverlay,
    destroy() {
      hideOverlay();
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", hideOverlay);
    },
  };
}
